/**
 * remember / recall handlers — end-to-end over a real edge store + source files.
 * (change: add-code-anchored-memory-staleness)
 *
 * Guards the mcp-handlers-spec requirements AnchoredMemoryWriteAndRecall and
 * NoSilentStaleMemory: an orphaned memory is never returned as authoritative.
 * Plain .test.ts so CI runs it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EdgeStore } from '../edge-store.js';
import { OPENLORE_DIR, OPENLORE_ANALYSIS_SUBDIR } from '../../../constants.js';
import { handleRemember, handleRecall } from './memory.js';
import type { FunctionNode } from '../../analyzer/call-graph.js';

let root: string;

const FOO_SRC = 'export function foo() {\n  return 1;\n}\n';

function fooNode(filePath: string, src: string): FunctionNode {
  return {
    id: `${filePath}::foo`,
    name: 'foo',
    filePath,
    isAsync: false,
    language: 'typescript',
    startIndex: 0,
    endIndex: Buffer.byteLength(src, 'utf-8'),
    fanIn: 0,
    fanOut: 0,
  };
}

async function buildStore(nodes: FunctionNode[]): Promise<void> {
  const dir = join(root, OPENLORE_DIR, OPENLORE_ANALYSIS_SUBDIR);
  await mkdir(dir, { recursive: true });
  const store = EdgeStore.open(EdgeStore.dbPath(dir));
  store.clearAll();
  store.insertNodes(nodes);
  store.close();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openlore-mem-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'foo.ts'), FOO_SRC, 'utf-8');
  await buildStore([fooNode('src/foo.ts', FOO_SRC)]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('handleRemember', () => {
  it('resolves a symbol hint to a symbol-level anchor', async () => {
    const r = (await handleRemember(root, 'foo must stay pure', [{ symbol: 'foo', file: 'src/foo.ts' }])) as {
      anchored: boolean; anchors: Array<{ level: string; symbol?: string }>;
    };
    expect(r.anchored).toBe(true);
    expect(r.anchors[0]).toMatchObject({ level: 'symbol', symbol: 'foo' });
  });

  it('records an unanchored memory when no analysis can resolve the hint', async () => {
    const r = (await handleRemember(root, 'a free-floating note')) as { anchored: boolean };
    expect(r.anchored).toBe(false);
  });
});

describe('handleRecall — bullet-proof guarantee', () => {
  it('returns a fresh memory as authoritative', async () => {
    await handleRemember(root, 'foo must stay pure', [{ symbol: 'foo', file: 'src/foo.ts' }]);
    const r = (await handleRecall(root, 'foo')) as {
      authoritative: Array<{ id: string; freshness: string }>; needsReanchoring: unknown[];
    };
    expect(r.authoritative).toHaveLength(1);
    expect(r.authoritative[0].freshness).toBe('fresh');
    expect(r.needsReanchoring).toHaveLength(0);
  });

  it('marks a memory drifted (verify) when the anchored code changes', async () => {
    await handleRemember(root, 'foo must stay pure', [{ symbol: 'foo', file: 'src/foo.ts' }]);
    // Change the function body in place so its span hash differs.
    await writeFile(join(root, 'src', 'foo.ts'), 'export function foo() {\n  return 999;\n}\n', 'utf-8');
    const r = (await handleRecall(root, 'foo')) as {
      authoritative: Array<{ freshness: string; verify?: boolean }>;
    };
    expect(r.authoritative[0].freshness).toBe('drifted');
    expect(r.authoritative[0].verify).toBe(true);
  });

  it('NEVER serves an orphaned memory as authoritative', async () => {
    await handleRemember(root, 'foo must stay pure', [{ symbol: 'foo', file: 'src/foo.ts' }]);
    // The anchored symbol disappears from the graph.
    await buildStore([]);
    const r = (await handleRecall(root, 'foo')) as {
      authoritative: Array<{ freshness: string }>;
      needsReanchoring: Array<{ id: string; freshness: string }>;
      summary: { orphaned: number };
    };
    expect(r.authoritative).toHaveLength(0);
    expect(r.needsReanchoring).toHaveLength(1);
    expect(r.needsReanchoring[0].freshness).toBe('orphaned');
    expect(r.summary.orphaned).toBe(1);
  });

  it('with no task, scans all memory for staleness', async () => {
    await handleRemember(root, 'first note', [{ symbol: 'foo', file: 'src/foo.ts' }]);
    await handleRemember(root, 'second unrelated note');
    const r = (await handleRecall(root)) as { total: number };
    expect(r.total).toBe(2);
  });
});
