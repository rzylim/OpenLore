/**
 * Spec 13.1 — VectorIndex.updateFiles row-level incremental update.
 *
 * Proves the watch path replaces ONLY the changed file's rows (delete + add)
 * instead of the full-table read+overwrite build() performs: a sibling file's
 * rows survive an update untouched, and the changed file's rows are replaced.
 * Runs BM25-only (embedSvc = null) so it needs no embedding service.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VectorIndex,
  _resetVectorIndexCachesForTesting,
} from './vector-index.js';
import type { FunctionNode } from './call-graph.js';

function node(filePath: string, name: string): FunctionNode {
  return {
    id: `${filePath}::${name}`,
    name,
    filePath,
    className: '',
    language: 'TypeScript',
    signature: `function ${name}()`,
    docstring: '',
    fanIn: 0,
    fanOut: 0,
    startIndex: 0,
    endIndex: 0,
  } as unknown as FunctionNode;
}

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), 'ol-vi-update-'));
  _resetVectorIndexCachesForTesting();
});

afterEach(async () => {
  _resetVectorIndexCachesForTesting();
  await rm(outputDir, { recursive: true, force: true });
});

async function names(query: string): Promise<Set<string>> {
  const results = await VectorIndex.search(outputDir, query, null, { limit: 20 });
  return new Set(results.map((r) => r.record.name));
}

describe('VectorIndex.updateFiles — Spec 13.1 (BM25-only)', () => {
  it('replaces only the changed file rows; sibling file rows survive', async () => {
    // Build a BM25-only index with two files.
    const initial = [node('alpha.ts', 'alphafn'), node('beta.ts', 'betafn')];
    const built = await VectorIndex.build(
      outputDir, initial, [], new Set(), new Set(), null, undefined, false,
    );
    expect(built.hasEmbeddings).toBe(false);
    expect(built.total).toBe(2);
    _resetVectorIndexCachesForTesting();

    // Sanity: both functions are findable.
    expect(await names('alphafn')).toContain('alphafn');
    expect(await names('betafn')).toContain('betafn');
    _resetVectorIndexCachesForTesting();

    // Rename alpha.ts's function → updateFiles should drop the old row and add new.
    const result = await VectorIndex.updateFiles(
      outputDir,
      [node('alpha.ts', 'gammafn')],
      new Set(['alpha.ts']),
      [],
      new Set(),
      new Set(),
      null,
      undefined,
    );
    expect(result.hasEmbeddings).toBe(false);
    _resetVectorIndexCachesForTesting();

    // beta.ts is untouched (its row survived the row-level op).
    expect(await names('betafn')).toContain('betafn');
    _resetVectorIndexCachesForTesting();
    // alpha.ts now has gammafn …
    expect(await names('gammafn')).toContain('gammafn');
    _resetVectorIndexCachesForTesting();
    // … and the old alphafn row is gone (the delete predicate actually matched).
    expect(await names('alphafn')).not.toContain('alphafn');
  });
});
