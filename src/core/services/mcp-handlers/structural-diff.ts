/**
 * Structural Change Analysis — graph diff (spec-21).
 *
 * Given a change (working tree vs a ref, or two refs), compute what changed
 * *structurally*: which functions/edges were added or removed, which signatures
 * changed, and which existing callers are now STALE because a callee's signature
 * moved under them. A review/refactor agent gets a precise structural changelog
 * instead of re-deriving consequences from a raw text diff.
 *
 * The difference between "these 40 lines changed" (git diff) and "this removed
 * function C, altered the signature of D, and 5 of D's callers are now stale"
 * (graph diff) — a computed consequence (Layer 3), not retrieval.
 *
 * Bounded: only the changed files are re-parsed (old content via `git show`, new
 * via the working tree / ref), so two in-memory snapshots are cheap. The canonical
 * graph is never mutated. Stale callers come from the cached graph (all callers).
 *
 * Honest limits: rename/move detection is heuristic — a renamed function looks like
 * delete + add — so both interpretations are reported, never silently guessed.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { validateDirectory, readCachedContext, safeJoin } from './utils.js';
import { isGitRepository, resolveBaseRef, validateGitRef, getChangedFiles } from '../../drift/git-diff.js';
import { CallGraphBuilder, serializeCallGraph } from '../../analyzer/call-graph.js';
import { detectLanguage } from '../../analyzer/signature-extractor.js';
import type { SerializedCallGraph, FunctionNode } from '../../analyzer/call-graph.js';

const execFileAsync = promisify(execFile);

export interface StructuralDiffInput {
  directory: string;
  /** Old state (default "HEAD"). */
  baseRef?: string;
  /** New state. Omit to use the working tree. */
  headRef?: string;
  /** Cap reported items per category (default 200). */
  maxResults?: number;
}

interface InFile { path: string; content: string; language: string }

/** Content of a file at a git ref, or '' if it didn't exist there. */
async function fileAtRef(rootPath: string, ref: string, path: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['show', `${ref}:${path}`], {
      cwd: rootPath, maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return '';
  }
}

/** Signature shape with the identifier removed — for rename matching. */
function signatureShape(signature: string | undefined): string {
  if (!signature) return '';
  const paren = signature.indexOf('(');
  return (paren >= 0 ? signature.slice(paren) : signature).replace(/\s+/g, ' ').trim();
}

function nodeRef(n: FunctionNode) {
  return { name: n.name, file: n.filePath, className: n.className ?? null, signature: n.signature ?? n.name };
}

export async function handleStructuralDiff(input: StructuralDiffInput): Promise<unknown> {
  const absDir = await validateDirectory(input.directory);
  if (!(await isGitRepository(absDir))) {
    return { error: 'Not a git repository. Structural diff requires git.' };
  }
  const baseRaw = input.baseRef ?? 'HEAD';
  try {
    validateGitRef(baseRaw);
    if (input.headRef) validateGitRef(input.headRef);
  } catch (err) {
    return { error: `Invalid git ref: ${err instanceof Error ? err.message : String(err)}` };
  }
  const resolvedBase = await resolveBaseRef(absDir, baseRaw);

  // ── Changed files ───────────────────────────────────────────────────────────
  let changed: Array<{ path: string; status: string; oldPath?: string }>;
  try {
    if (input.headRef) {
      const { stdout } = await execFileAsync(
        'git', ['diff', '--name-status', '--diff-filter=ACDMR', `${resolvedBase}..${input.headRef}`],
        { cwd: absDir, maxBuffer: 16 * 1024 * 1024 },
      );
      changed = stdout.split('\n').filter(Boolean).map(line => {
        const parts = line.split('\t');
        const s = parts[0].charAt(0);
        const status = s === 'A' ? 'added' : s === 'D' ? 'deleted' : s === 'R' ? 'renamed' : 'modified';
        return status === 'renamed' && parts.length >= 3
          ? { path: parts[2], status, oldPath: parts[1] }
          : { path: parts[1], status };
      });
    } else {
      const diff = await getChangedFiles({ rootPath: absDir, baseRef: resolvedBase, includeUnstaged: true });
      changed = diff.files.map(f => ({ path: f.path, status: f.status, oldPath: f.oldPath }));
      // git diff excludes untracked files; a brand-new file's functions are all
      // structural additions, so fold them in for the working-tree comparison.
      try {
        const { stdout } = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], {
          cwd: absDir, maxBuffer: 16 * 1024 * 1024,
        });
        const seen = new Set(changed.map(c => c.path));
        for (const path of stdout.split('\n').map(s => s.trim()).filter(Boolean)) {
          if (!seen.has(path)) changed.push({ path, status: 'added' });
        }
      } catch { /* untracked enumeration is best-effort */ }
    }
  } catch (err) {
    return { error: `git diff failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Code files only; logical path = the new path (so a file move doesn't explode
  // into all-removed + all-added at the function level).
  const codeChanged = changed.filter(c => {
    const lang = detectLanguage(c.path);
    return lang && lang !== 'Unknown' && lang !== 'unknown';
  });
  if (codeChanged.length === 0) {
    return {
      base: resolvedBase, head: input.headRef ?? 'working tree',
      message: 'No changed code files between the two states (only non-code or no changes).',
      summary: emptySummary(),
      soundness: diffSoundness(true),
    };
  }

  // ── Build old + new snapshots from just the changed files ───────────────────
  const oldFiles: InFile[] = [];
  const newFiles: InFile[] = [];
  for (const c of codeChanged) {
    const lang = detectLanguage(c.path);
    const oldSrcPath = c.oldPath ?? c.path;
    const oldContent = c.status === 'added' ? '' : await fileAtRef(absDir, resolvedBase, oldSrcPath);
    let newContent = '';
    if (c.status !== 'deleted') {
      newContent = input.headRef
        ? await fileAtRef(absDir, input.headRef, c.path)
        // Confine the working-tree read to the root (defense-in-depth: c.path is
        // git-derived, but safeJoin guarantees no escape — mcp-security).
        : await (async () => {
            try { return await readFile(safeJoin(absDir, c.path), 'utf-8'); }
            catch { return ''; }
          })();
    }
    if (oldContent) oldFiles.push({ path: c.path, content: oldContent, language: lang });
    if (newContent) newFiles.push({ path: c.path, content: newContent, language: lang });
  }

  const oldGraph = await safeBuild(oldFiles);
  const newGraph = await safeBuild(newFiles);

  const oldNodes = new Map(oldGraph.nodes.filter(isCode).map(n => [n.id, n]));
  const newNodes = new Map(newGraph.nodes.filter(isCode).map(n => [n.id, n]));

  // ── Node-level delta ────────────────────────────────────────────────────────
  const added: FunctionNode[] = [];
  const removed: FunctionNode[] = [];
  const signatureChanged: Array<{ node: FunctionNode; before: string; after: string }> = [];
  for (const [id, n] of newNodes) if (!oldNodes.has(id)) added.push(n);
  for (const [id, n] of oldNodes) {
    const nu = newNodes.get(id);
    if (!nu) { removed.push(n); continue; }
    if ((n.signature ?? '') !== (nu.signature ?? '')) {
      signatureChanged.push({ node: nu, before: n.signature ?? n.name, after: nu.signature ?? n.name });
    }
  }

  // ── Rename/move candidates — removed↔added with matching signature shape ─────
  const renameCandidates: Array<{ from: ReturnType<typeof nodeRef>; to: ReturnType<typeof nodeRef>; confidence: string; note: string }> = [];
  for (const r of removed) {
    for (const a of added) {
      const sameShape = signatureShape(r.signature) && signatureShape(r.signature) === signatureShape(a.signature);
      const sameFile = r.filePath === a.filePath;
      if (!sameShape) continue;
      const confidence = sameFile ? 'high' : 'medium';
      renameCandidates.push({
        from: nodeRef(r), to: nodeRef(a), confidence,
        note: `"${r.name}" may have been renamed/moved to "${a.name}" (matching signature shape${sameFile ? ', same file' : ''}). Reported as both remove+add and this rename candidate — verify.`,
      });
    }
  }

  // ── Edge delta (calls among / out of the changed files) ─────────────────────
  const edgeKey = (e: { callerId: string; calleeName: string }) => `${e.callerId}\0${e.calleeName}`;
  const oldEdges = new Map(oldGraph.edges.filter(isCallEdge).map(e => [edgeKey(e), e]));
  const newEdges = new Map(newGraph.edges.filter(isCallEdge).map(e => [edgeKey(e), e]));
  const addedEdges = [...newEdges].filter(([k]) => !oldEdges.has(k)).map(([, e]) => edgePair(e, newGraph));
  const removedEdges = [...oldEdges].filter(([k]) => !newEdges.has(k)).map(([, e]) => edgePair(e, oldGraph));

  // ── Stale callers — callers (in the canonical graph) of a node whose signature
  //    changed or that was removed, that are NOT themselves in the changed set ──
  const ctx = await readCachedContext(absDir);
  const changedPaths = new Set(codeChanged.map(c => c.path));
  const staleCallerNote = ctx?.edgeStore
    ? undefined
    : 'No cached graph — stale-caller analysis skipped. Run analyze_codebase to enable it.';
  const collectStaleCallers = (nodeId: string): Array<{ name: string; file: string }> => {
    if (!ctx?.edgeStore) return [];
    const out = new Map<string, { name: string; file: string }>();
    for (const e of ctx.edgeStore.getCallers(nodeId)) {
      if (e.kind && e.kind !== 'calls') continue;
      const caller = ctx.edgeStore.getNode(e.callerId);
      if (!caller || caller.isExternal) continue;
      if (changedPaths.has(caller.filePath)) continue; // updated in this change
      out.set(caller.id, { name: caller.name, file: caller.filePath });
    }
    return [...out.values()].sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
  };

  const limit = Math.max(1, Math.min(input.maxResults ?? 200, 1000));
  const sigChangedOut = signatureChanged
    .map(s => ({ ...nodeRef(s.node), before: s.before, after: s.after, staleCallers: collectStaleCallers(s.node.id) }))
    .sort((a, b) => b.staleCallers.length - a.staleCallers.length || a.file.localeCompare(b.file));
  const removedOut = removed
    .map(n => ({ ...nodeRef(n), staleCallers: collectStaleCallers(n.id) }))
    .sort((a, b) => b.staleCallers.length - a.staleCallers.length || a.file.localeCompare(b.file));

  const totalStale = new Set(
    [...sigChangedOut, ...removedOut].flatMap(x => x.staleCallers.map(c => `${c.file}::${c.name}`)),
  ).size;

  return {
    base: resolvedBase,
    head: input.headRef ?? 'working tree',
    changedFiles: codeChanged.map(c => ({ path: c.path, status: c.status, ...(c.oldPath ? { oldPath: c.oldPath } : {}) })),
    summary: {
      addedFunctions: added.length,
      removedFunctions: removed.length,
      signatureChanges: signatureChanged.length,
      addedEdges: addedEdges.length,
      removedEdges: removedEdges.length,
      staleCallers: totalStale,
      renameCandidates: renameCandidates.length,
    },
    added: added.map(nodeRef).sort(byFileName).slice(0, limit),
    removed: removedOut.slice(0, limit),
    signatureChanged: sigChangedOut.slice(0, limit),
    renameCandidates: renameCandidates.slice(0, limit),
    edges: { added: addedEdges.slice(0, limit), removed: removedEdges.slice(0, limit) },
    ...(staleCallerNote ? { note: staleCallerNote } : {}),
    soundness: diffSoundness(false),
  };
}

// ── helpers ────────────────────────────────────────────────────────────────────
function isCode(n: FunctionNode): boolean { return !n.isExternal; }
function isCallEdge(e: { kind?: string; calleeId?: string }): boolean {
  return (!e.kind || e.kind === 'calls') && !!e.calleeId;
}
function byFileName(a: { file: string; name: string }, b: { file: string; name: string }) {
  return a.file.localeCompare(b.file) || a.name.localeCompare(b.name);
}
function edgePair(e: { callerId: string; calleeId: string; calleeName: string }, g: SerializedCallGraph) {
  const caller = g.nodes.find(n => n.id === e.callerId);
  return { caller: caller?.name ?? e.callerId, callee: e.calleeName, file: caller?.filePath ?? '' };
}
async function safeBuild(files: InFile[]): Promise<SerializedCallGraph> {
  if (files.length === 0) return emptyGraph();
  try {
    return serializeCallGraph(await new CallGraphBuilder().build(files));
  } catch {
    return emptyGraph();
  }
}
function emptyGraph(): SerializedCallGraph {
  return { nodes: [], edges: [], classes: [], inheritanceEdges: [], hubFunctions: [], entryPoints: [], layerViolations: [],
    stats: { totalNodes: 0, totalEdges: 0, avgFanIn: 0, avgFanOut: 0 } };
}
function emptySummary() {
  return { addedFunctions: 0, removedFunctions: 0, signatureChanges: 0, addedEdges: 0, removedEdges: 0, staleCallers: 0, renameCandidates: 0 };
}
function diffSoundness(empty: boolean): { posture: string; caveats: string[] } {
  const caveats = [
    'Rename/move detection is heuristic — a renamed function appears as remove+add. Candidates are reported separately; never assume a rename without verifying.',
    'Signature-change detection is limited to what the analyzer extracts per language; cross-language signature notions differ.',
    'Edge deltas cover calls among/out of the changed files; calls into unchanged files resolve against the canonical graph for stale callers only.',
  ];
  if (empty) caveats.push('No code files changed — the structural delta is empty.');
  return { posture: 'structural-complement-to-git-diff', caveats };
}
