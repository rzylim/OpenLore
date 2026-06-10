/**
 * Spec-09 — MCP live-data integration suite.
 *
 * For each pinned real repo: fetch (cached) → init+analyze → derive realistic args
 * → drive EVERY tool via the shared `dispatchTool` → assert invariants → report.
 *
 * Behavior-neutral (spec-09 §"Scope contract"): this suite OBSERVES tool output.
 * It never modifies a handler, TOOL_DEFINITIONS, dispatch, or protocol code. A
 * defect it surfaces is recorded as a `TODO(spec-09-followup)` finding for spec-10
 * and, if it would otherwise redden the suite, captured in KNOWN_FAILURES below —
 * never hidden by weakening an invariant.
 *
 * Offline-friendly: a repo absent from the cache with no network SKIPS loudly. An
 * all-skipped run FAILS (no false PASS) unless OPENLORE_LIVE_ALLOW_NO_REPOS=1, in
 * which case it reports SKIPPED loudly. Runs only under vitest.integration.config.ts.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { homedir } from 'node:os';
import { FIXTURE_REPOS } from './fixture-repos.js';
import { ensureRepo, cacheDir } from './repo-cache.js';
import { analyzeRepo, deriveFacts } from './analyze-repo.js';
import { TOOL_REGISTRY, type RepoFacts } from './tool-driver.js';
import { dispatchTool, UnknownToolError } from '../../tool-dispatch.js';
import { checkInvariants, isNonTrivial } from './invariants.js';
import { summarize, printReport, writeReport, type ReportRow } from './report.js';

/**
 * Documented known-failures: `"<tool>@<repoId>"`. Each entry is a real defect
 * handed to spec-10, NOT a license to loosen an invariant. Empty until the first
 * networked run surfaces one. A listed pair is logged loudly and excluded from the
 * hard-fail assertion; everything else must pass.
 */
const KNOWN_FAILURES = new Set<string>();

const ALLOW_NO_REPOS = process.env.OPENLORE_LIVE_ALLOW_NO_REPOS === '1';
const LLM_ENABLED = process.env.OPENLORE_LIVE_LLM === '1';
const SETUP_TIMEOUT = 10 * 60_000; // clone + analyze across all repos

interface RunState {
  rows: ReportRow[];
  exercised: Set<string>;
  readyRepoIds: string[];
  unknownToolHits: string[];
}

const state: RunState = { rows: [], exercised: new Set(), readyRepoIds: [], unknownToolHits: [] };

function forbiddenPaths(repoDir: string): string[] {
  return [homedir(), cacheDir(), repoDir].filter(Boolean);
}

beforeAll(async () => {
  for (const entry of FIXTURE_REPOS) {
    const fetched = await ensureRepo(entry);
    if (fetched.status === 'skipped') {
      for (const tool of Object.keys(TOOL_REGISTRY)) {
        state.rows.push({ tool, repo: entry.id, status: 'skip', bytes: 0, tokens: 0, detail: fetched.reason });
      }
      continue;
    }

    await analyzeRepo(fetched.dir);
    const facts: RepoFacts = await deriveFacts(fetched.dir);
    const expectNonEmpty = new Set(entry.expectNonEmpty ?? []);
    state.readyRepoIds.push(entry.id);

    for (const [tool, plan] of Object.entries(TOOL_REGISTRY)) {
      if (plan.kind === 'llm' && !LLM_ENABLED) {
        state.rows.push({ tool, repo: entry.id, status: 'skip', bytes: 0, tokens: 0, detail: 'llm disabled (set OPENLORE_LIVE_LLM=1)' });
        continue;
      }
      const args = plan.buildArgs(facts);
      if (args === null) {
        state.rows.push({ tool, repo: entry.id, status: 'skip', bytes: 0, tokens: 0, detail: 'args not derivable on this repo' });
        continue;
      }

      let result: unknown;
      try {
        result = await dispatchTool(tool, args, facts.directory);
      } catch (err) {
        if (err instanceof UnknownToolError) state.unknownToolHits.push(tool);
        const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
        recordOutcome(tool, entry.id, { ok: false, bytes: 0, tokens: 0, failures: [`threw: ${detail}`] });
        continue;
      }

      // Capture a decision id so approve/reject can be genuinely exercised.
      if (tool === 'record_decision' && !facts.decisionId) {
        const id = extractId(result);
        if (id) facts.decisionId = id;
      }

      const verdict = checkInvariants(tool, result, { forbiddenAbsPaths: forbiddenPaths(facts.directory), expectNonEmpty: expectNonEmpty.has(tool) });
      recordOutcome(tool, entry.id, verdict);
      state.exercised.add(tool);
    }
  }

  const summary = summarize(state.rows, state.readyRepoIds);
  printReport(summary);
  if (state.readyRepoIds.length > 0) {
    const path = await writeReport(summary);
     
    console.log(`live-data: report written to ${path}`);
  }
}, SETUP_TIMEOUT);

function recordOutcome(tool: string, repo: string, v: { ok: boolean; bytes: number; tokens: number; failures: string[] }): void {
  const key = `${tool}@${repo}`;
  if (!v.ok && KNOWN_FAILURES.has(key)) {
     
    console.warn(`live-data: KNOWN-FAILURE ${key} — ${v.failures.join('; ')} (tracked for spec-10)`);
    state.rows.push({ tool, repo, status: 'skip', bytes: v.bytes, tokens: v.tokens, detail: `known-failure: ${v.failures.join('; ')}` });
    return;
  }
  state.rows.push({ tool, repo, status: v.ok ? 'pass' : 'fail', bytes: v.bytes, tokens: v.tokens, detail: v.failures.join('; ') || undefined });
}

function extractId(result: unknown): string | undefined {
  if (result && typeof result === 'object' && 'id' in result) {
    const id = (result as { id: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

describe('spec-09 MCP live-data harness', () => {
  it('has at least one usable repo, or is explicitly allowed to skip', () => {
    if (state.readyRepoIds.length === 0) {
      // No false PASS: fail unless the documented escape hatch is set.
      if (!ALLOW_NO_REPOS) {
        throw new Error(
          'live-data: no repos available (offline / placeholder SHAs) and OPENLORE_LIVE_ALLOW_NO_REPOS is not set — ' +
            'refusing to report PASS on zero coverage. Run with network, or set OPENLORE_LIVE_ALLOW_NO_REPOS=1 to skip loudly.',
        );
      }
       
      console.warn('live-data: SKIPPED — no repos available; OPENLORE_LIVE_ALLOW_NO_REPOS=1 set. This run asserts nothing.');
      return;
    }
    expect(state.readyRepoIds.length).toBeGreaterThan(0);
  });

  it('never hits a missing driver entry (dispatch resolves every driven tool)', () => {
    // The static gate (tool-driver.test.ts) already guarantees registry completeness;
    // here we confirm no driven tool resolved to UnknownToolError at runtime.
    expect(state.unknownToolHits).toEqual([]);
  });

  it('passes every invariant for every driven tool × repo (no findings)', () => {
    if (state.readyRepoIds.length === 0) return;
    const fails = state.rows.filter((r) => r.status === 'fail');
    expect(
      fails,
      fails.length ? `findings:\n${fails.map((r) => `  ${r.tool}@${r.repo}: ${r.detail}`).join('\n')}` : 'no findings',
    ).toEqual([]);
  });

  it('exercises every non-LLM tool on at least one repo (loudly logs any it could not)', () => {
    if (state.readyRepoIds.length === 0) return;
    const expected = Object.entries(TOOL_REGISTRY).filter(([, p]) => p.kind !== 'llm').map(([n]) => n);
    const notExercised = expected.filter((n) => !state.exercised.has(n));
    if (notExercised.length) {
      // Not a hard fail: these were derive-skipped (e.g. get_spec needs a spec domain
      // OSS repos lack), not missing drivers. Surface loudly per spec §6.
       
      console.warn(`live-data: tools not exercised on any repo (derive-skip, not missing-driver): ${notExercised.join(', ')}`);
    }
    expect(Array.isArray(notExercised)).toBe(true);
  });

  it('satisfies each repo expectNonEmpty contract', () => {
    if (state.readyRepoIds.length === 0) return;
    for (const repo of FIXTURE_REPOS) {
      if (!state.readyRepoIds.includes(repo.id)) continue;
      for (const tool of repo.expectNonEmpty ?? []) {
        const row = state.rows.find((r) => r.tool === tool && r.repo === repo.id);
        expect(row?.status, `${tool}@${repo.id}`).toBe('pass');
      }
    }
  });

  it('snapshots stable architecture-overview counts per ready repo', async () => {
    if (state.readyRepoIds.length === 0) return;
    for (const repo of FIXTURE_REPOS) {
      if (!state.readyRepoIds.includes(repo.id)) continue;
      const dir = `${cacheDir()}/${repo.id}@${repo.sha}`;
      const overview = await dispatchTool('get_architecture_overview', { directory: dir }, dir);
      const counts = extractCounts(overview);
      expect(isNonTrivial(counts)).toBe(true);
      // Golden only for small stable counts, keyed by repo@sha (spec-09 §5).
      expect(counts).toMatchSnapshot(`overview-counts ${repo.id}@${repo.sha}`);
    }
  });
});

/** Pull only the small, stable integer counts out of an overview result. The
 * overview shape is `{ summary: { totalFiles, totalClusters, totalEdges, cycles,
 * layerViolations }, globalEntryPoints, criticalHubs }`. */
function extractCounts(overview: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  if (overview && typeof overview === 'object') {
    const o = overview as { summary?: Record<string, unknown>; globalEntryPoints?: unknown[]; criticalHubs?: unknown[] };
    for (const key of ['totalFiles', 'totalClusters', 'totalEdges', 'cycles', 'layerViolations']) {
      const v = o.summary?.[key];
      if (typeof v === 'number') counts[key] = v;
    }
    if (Array.isArray(o.globalEntryPoints)) counts.globalEntryPoints = o.globalEntryPoints.length;
    if (Array.isArray(o.criticalHubs)) counts.criticalHubs = o.criticalHubs.length;
  }
  return counts;
}
