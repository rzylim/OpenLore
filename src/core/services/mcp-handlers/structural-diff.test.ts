/**
 * Spec-21 — Structural Change Analysis (graph diff) over a real temp git repo.
 * A v1→v2 change exercises added/removed/signature-changed functions, the
 * stale-caller set (via a mocked canonical graph), and rename-candidate flagging.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

vi.mock('./utils.js', async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return { ...actual, validateDirectory: vi.fn(async (d: string) => d), readCachedContext: vi.fn() };
});

import { handleStructuralDiff } from './structural-diff.js';
import { readCachedContext } from './utils.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
}
function write(cwd: string, rel: string, content: string): void {
  const p = join(cwd, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content);
}

const V1 = `export function alpha(a: string): number { return a.length; }
export function beta(): void { alpha("x"); }
export function gamma(): void {}
export function oldName(x: number): boolean { return x > 0; }
`;
const V2 = `export function alpha(a: string, b: number): number { return a.length + b; }
export function beta(): void { alpha("x", 1); }
export function delta(z: string): void {}
export function newName(x: number): boolean { return x > 0; }
`;

describe('handleStructuralDiff', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'struct-diff-'));
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.name', 'T']); git(repo, ['config', 'user.email', 't@e.com']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    write(repo, 'src/mod.ts', V1);
    git(repo, ['add', '.']); git(repo, ['commit', '-q', '-m', 'v1', '--no-gpg-sign']);
    write(repo, 'src/mod.ts', V2); // working-tree change = v2
    // Canonical graph: alpha has an external caller in an UNCHANGED file.
    vi.mocked(readCachedContext).mockResolvedValue({
      edgeStore: {
        getCallers: (id: string) => id === 'src/mod.ts::alpha'
          ? [{ callerId: 'src/other.ts::consumer', calleeId: id, calleeName: 'alpha', confidence: 'import', kind: 'calls' }]
          : [],
        getNode: (id: string) => id === 'src/other.ts::consumer'
          ? { id, name: 'consumer', filePath: 'src/other.ts', isExternal: false, isAsync: false, language: 'TypeScript', startIndex: 0, endIndex: 9, fanIn: 0, fanOut: 1 }
          : null,
      },
    } as never);
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('reports added, removed, and signature-changed functions', async () => {
    const r = await handleStructuralDiff({ directory: repo, baseRef: 'HEAD' }) as {
      summary: Record<string, number>;
      added: Array<{ name: string }>; removed: Array<{ name: string }>;
      signatureChanged: Array<{ name: string; before: string; after: string }>;
    };
    expect(r.added.map(n => n.name).sort()).toEqual(['delta', 'newName']);
    expect(r.removed.map(n => n.name).sort()).toEqual(['gamma', 'oldName']);
    expect(r.signatureChanged.map(n => n.name)).toEqual(['alpha']);
    const alpha = r.signatureChanged[0];
    expect(alpha.before).toContain('a: string): number');
    expect(alpha.after).toContain('b: number');
    expect(r.summary.signatureChanges).toBe(1);
  });

  it('lists stale callers of a signature-changed function from the canonical graph', async () => {
    const r = await handleStructuralDiff({ directory: repo, baseRef: 'HEAD' }) as {
      signatureChanged: Array<{ name: string; staleCallers: Array<{ name: string; file: string }> }>;
      summary: { staleCallers: number };
    };
    const alpha = r.signatureChanged.find(s => s.name === 'alpha')!;
    // beta (same file, updated) is excluded; consumer (other file) is stale.
    expect(alpha.staleCallers.map(c => c.name)).toEqual(['consumer']);
    expect(r.summary.staleCallers).toBe(1);
  });

  it('flags a rename/move candidate without dropping the remove+add', async () => {
    const r = await handleStructuralDiff({ directory: repo, baseRef: 'HEAD' }) as {
      renameCandidates: Array<{ from: { name: string }; to: { name: string }; confidence: string; note: string }>;
      removed: Array<{ name: string }>; added: Array<{ name: string }>;
    };
    const rename = r.renameCandidates.find(c => c.from.name === 'oldName' && c.to.name === 'newName');
    expect(rename).toBeDefined();
    expect(rename!.confidence).toBe('high'); // same signature shape, same file
    // Both interpretations remain present.
    expect(r.removed.map(n => n.name)).toContain('oldName');
    expect(r.added.map(n => n.name)).toContain('newName');
  });

  it('notes when no cached graph is available (stale callers skipped)', async () => {
    vi.mocked(readCachedContext).mockResolvedValueOnce(null as never);
    const r = await handleStructuralDiff({ directory: repo, baseRef: 'HEAD' }) as { note?: string; signatureChanged: Array<{ staleCallers: unknown[] }> };
    expect(r.note).toMatch(/analyze_codebase/);
    expect(r.signatureChanged[0].staleCallers).toEqual([]);
  });

  it('includes untracked new files (their functions are all additions)', async () => {
    write(repo, 'src/brand-new.ts', 'export function freshFn(): void {}\n'); // untracked
    const r = await handleStructuralDiff({ directory: repo, baseRef: 'HEAD' }) as {
      added: Array<{ name: string }>; changedFiles: Array<{ path: string; status: string }>;
    };
    expect(r.added.map(n => n.name)).toContain('freshFn');
    expect(r.changedFiles.find(f => f.path === 'src/brand-new.ts')?.status).toBe('added');
  });

  it('errors on a non-git directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'struct-nogit-'));
    try {
      const r = await handleStructuralDiff({ directory: dir }) as { error: string };
      expect(r.error).toMatch(/git repository/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns an empty delta when nothing changed', async () => {
    git(repo, ['checkout', '--', 'src/mod.ts']); // revert working tree to v1
    const r = await handleStructuralDiff({ directory: repo, baseRef: 'HEAD' }) as { summary: Record<string, number>; message?: string };
    expect(r.summary.addedFunctions).toBe(0);
    expect(r.summary.removedFunctions).toBe(0);
  });
});
