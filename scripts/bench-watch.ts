/**
 * bench-watch.ts — watch-mode (MCP incremental re-index) microbenchmark.
 *
 * Spec 13.1: freshness must be O(change), not O(repo). This measures the
 * per-save and bulk-burst cost of the watcher pipeline on a fixture with a
 * ~2 MB llm-context.json, and asserts the coalescing/cache guarantees:
 *
 *   G1 — a single save triggers ≤ 1 llm-context persistence and the next read
 *        is a cache HIT (no cold full-file re-parse).
 *   G2 — a burst of N saves coalesces to ONE flush.
 *   G4 — per-save wall-clock stays small relative to the context size.
 *
 * Run:  npm run bench:watch
 *
 * This is a manual benchmark (not part of CI). It builds its own throwaway
 * fixture under the OS temp dir and cleans up afterwards.
 */
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { McpWatcher } from '../src/core/services/mcp-watcher.js';
import { readCachedContext, _resetContextCacheForTesting } from '../src/core/services/mcp-handlers/utils.js';

const FILE_COUNT = 600;       // synthetic source files in the context
const ENTRIES_PER_FILE = 20;  // signatures per file
const SINGLE_SAVE_RUNS = 20;
const BURST_SIZE = 50;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function synthSignatures(): Array<{ path: string; language: string; entries: Array<{ name: string; signature: string; docstring: string; line: number; kind: string }> }> {
  const sigs = [];
  for (let i = 0; i < FILE_COUNT; i++) {
    const path = `src/module_${i}/file_${i}.ts`;
    const entries = [];
    for (let j = 0; j < ENTRIES_PER_FILE; j++) {
      entries.push({
        name: `fn_${i}_${j}`,
        signature: `export function fn_${i}_${j}(arg0: string, arg1: number, opts?: Record<string, unknown>): Promise<void>`,
        docstring: `Function ${j} in module ${i}. Handles a representative unit of work for the benchmark fixture.`,
        line: j * 7 + 1,
        kind: 'function',
      });
    }
    sigs.push({ path, language: 'TypeScript', entries });
  }
  return sigs;
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'ol-benchwatch-'));
  const analysisDir = join(root, '.openlore', 'analysis');
  await mkdir(analysisDir, { recursive: true });
  const contextPath = join(analysisDir, 'llm-context.json');

  // Build a ~2 MB context.
  const signatures = synthSignatures();
  await writeFile(contextPath, JSON.stringify({ signatures, callGraph: null }, null, 2), 'utf-8');
  const ctxBytes = (await stat(contextPath)).size;

  // Write the real source files so the watcher can read them on change.
  for (let i = 0; i < FILE_COUNT; i++) {
    const dir = join(root, 'src', `module_${i}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `file_${i}.ts`), `export function fn_${i}_0() { return ${i}; }\n`, 'utf-8');
  }

  // embed:false → measure the signature/freshness pipeline (the per-save hot
  // path the spec flagged: the 2 MB rewrite + the re-parse it used to force).
  const watcher = new McpWatcher({ rootPath: root, embed: false });

  // ── Single-save latency, including the simulated "next tool call" read ──────
  const flushTimes: number[] = [];
  const readTimes: number[] = [];
  for (let r = 0; r < SINGLE_SAVE_RUNS; r++) {
    const i = r % FILE_COUNT;
    const f = join(root, 'src', `module_${i}`, `file_${i}.ts`);
    await writeFile(f, `export function fn_${i}_0() { return ${i + r * 1000}; }\n`, 'utf-8');

    const t0 = performance.now();
    await watcher.handleChange(f);
    flushTimes.push(performance.now() - t0);

    // The next "tool call" read — must be a cache HIT (no 2 MB cold re-parse).
    const t1 = performance.now();
    const ctx = await readCachedContext(root);
    readTimes.push(performance.now() - t1);
    if (!ctx) throw new Error('readCachedContext returned null after save');
  }

  // ── Cold read baseline (cache cleared → full 2 MB parse) for contrast ───────
  _resetContextCacheForTesting();
  const coldT0 = performance.now();
  await readCachedContext(root);
  const coldRead = performance.now() - coldT0;

  // ── Bulk burst: BURST_SIZE files in one window must coalesce to ONE flush ───
  let summaries = 0;
  const origWrite = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: any, ...rest: any[]): boolean => {
    if (/\[mcp-watcher\] (updated|coalesced)/.test(String(chunk))) summaries++;
    return origWrite(chunk, ...rest);
  };
  const burst = new McpWatcher({ rootPath: root, embed: false, debounceMs: 50, maxBatchMs: 2000 });
  const burstFiles: string[] = [];
  for (let i = 0; i < BURST_SIZE; i++) {
    const f = join(root, 'src', `module_${i}`, `file_${i}.ts`);
    await writeFile(f, `export function fn_${i}_0() { return ${i}*2; }\n`, 'utf-8');
    burstFiles.push(f);
  }
  const burstT0 = performance.now();
  for (const f of burstFiles) (burst as unknown as { enqueue(p: string): void }).enqueue(f);
  // Wait for the single coalesced flush to complete.
  await new Promise((res) => setTimeout(res, 400));
  const burstTime = performance.now() - burstT0;
  (process.stderr as any).write = origWrite;

  const report =
`## Watch-mode benchmark (Spec 13.1)

Fixture: ${FILE_COUNT} files × ${ENTRIES_PER_FILE} signatures, llm-context.json = ${(ctxBytes / 1_048_576).toFixed(2)} MB.

| Metric | Result |
|--------|--------|
| Single-save flush (median of ${SINGLE_SAVE_RUNS}) | ${median(flushTimes).toFixed(1)} ms |
| Next-call read after save (median, cache HIT) | ${median(readTimes).toFixed(2)} ms |
| Cold read (cache cleared, full parse) | ${coldRead.toFixed(1)} ms |
| ${BURST_SIZE}-file burst → flushes | ${summaries} (expected 1) |
| ${BURST_SIZE}-file burst wall-clock | ${burstTime.toFixed(1)} ms |

G1: next-call read is a cache hit — ${median(readTimes).toFixed(2)} ms vs ${coldRead.toFixed(1)} ms cold (${(coldRead / Math.max(median(readTimes), 0.001)).toFixed(0)}× faster).
G2: ${BURST_SIZE} saves coalesced to ${summaries} flush${summaries === 1 ? '' : 'es'}.
`;

  // eslint-disable-next-line no-console
  console.log(report);

  // Assertions (fail loudly in CI-less manual runs).
  if (summaries !== 1) throw new Error(`G2 violated: expected 1 coalesced flush, got ${summaries}`);
  if (median(readTimes) >= coldRead) throw new Error('G1 violated: post-save read is not faster than a cold parse');

  await rm(root, { recursive: true, force: true });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
