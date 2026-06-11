/**
 * Provenance-aware reachability (spec: add-synthesized-dynamic-dispatch-edges).
 * Verifies that find_dead_code does not manufacture false dead-positives from
 * synthesized edges, and that strict (directResolvedOnly) mode excludes them.
 * Drives the real handler over an llm-context fixture. Plain .test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPENLORE_DIR, OPENLORE_ANALYSIS_SUBDIR, ARTIFACT_LLM_CONTEXT } from '../../../constants.js';
import { handleFindDeadCode } from './reachability.js';
import type { FunctionNode, CallEdge } from '../../analyzer/call-graph.js';

let root: string;

function node(id: string, name: string, extra: Partial<FunctionNode> = {}): FunctionNode {
  return {
    id, name, filePath: id.split('::')[0], isAsync: false, language: 'TypeScript',
    startIndex: 0, endIndex: 10, fanIn: 0, fanOut: 0, ...extra,
  };
}

async function writeContext(nodes: FunctionNode[], edges: CallEdge[]): Promise<void> {
  // fanIn/fanOut so "no internal caller" reasoning matches the edges.
  for (const n of nodes) { n.fanIn = 0; n.fanOut = 0; }
  for (const e of edges) {
    const c = nodes.find(n => n.id === e.callerId); if (c) c.fanOut++;
    const t = nodes.find(n => n.id === e.calleeId); if (t) t.fanIn++;
  }
  const callGraph = {
    nodes, edges, classes: [], inheritanceEdges: [],
    hubFunctions: [], entryPoints: [], layerViolations: [],
    stats: { totalNodes: nodes.length, totalEdges: edges.length, avgFanIn: 0, avgFanOut: 0 },
  };
  const dir = join(root, OPENLORE_DIR, OPENLORE_ANALYSIS_SUBDIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ARTIFACT_LLM_CONTEXT), JSON.stringify({ callGraph }), 'utf-8');
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'ol-reach-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('provenance-aware reachability', () => {
  // test (root) → dispatcher → [synthesized] → handler
  const graph = (): { nodes: FunctionNode[]; edges: CallEdge[] } => {
    const nodes = [
      node('x.test.ts::test_x', 'test_x', { isTest: true }),
      node('a.ts::dispatcher', 'dispatcher'),
      node('a.ts::handler', 'handler'),
    ];
    const edges: CallEdge[] = [
      { callerId: 'x.test.ts::test_x', calleeId: 'a.ts::dispatcher', calleeName: 'dispatcher', confidence: 'import', kind: 'calls' },
      { callerId: 'a.ts::dispatcher', calleeId: 'a.ts::handler', calleeName: 'handler', confidence: 'synthesized', kind: 'calls', synthesizedBy: 'event-channel' },
    ];
    return { nodes, edges };
  };

  it('Callback-only-reachable symbol is not reported high-confidence dead (default)', async () => {
    const { nodes, edges } = graph();
    await writeContext(nodes, edges);
    const r = (await handleFindDeadCode({ directory: root })) as {
      candidateDead: Array<{ name: string; confidence: string }>; byConfidence: { high: number };
    };
    // handler is reached through the synthesized edge → not dead at all.
    expect(r.candidateDead.find(c => c.name === 'handler')).toBeUndefined();
    expect(r.byConfidence.high).toBe(0);
  });

  it('Strict mode excludes synthesized edges → handler becomes unreached/dead', async () => {
    const { nodes, edges } = graph();
    await writeContext(nodes, edges);
    const r = (await handleFindDeadCode({ directory: root, directResolvedOnly: true })) as {
      candidateDead: Array<{ name: string }>;
    };
    expect(r.candidateDead.find(c => c.name === 'handler')).toBeDefined();
  });

  it('A synthesized-dispatch target whose dispatcher is itself dead is downgraded to low with the rule named', async () => {
    // No edge reaches the dispatcher → both dispatcher and handler are candidate-dead.
    const nodes = [
      node('x.test.ts::test_x', 'test_x', { isTest: true }),
      node('a.ts::dispatcher', 'dispatcher'),
      node('a.ts::handler', 'handler'),
    ];
    const edges: CallEdge[] = [
      { callerId: 'a.ts::dispatcher', calleeId: 'a.ts::handler', calleeName: 'handler', confidence: 'synthesized', kind: 'calls', synthesizedBy: 'event-channel' },
    ];
    await writeContext(nodes, edges);
    const r = (await handleFindDeadCode({ directory: root })) as {
      candidateDead: Array<{ name: string; confidence: string; reason: string }>;
    };
    const handler = r.candidateDead.find(c => c.name === 'handler');
    expect(handler).toBeDefined();
    expect(handler!.confidence).toBe('low');
    expect(handler!.reason).toContain('event-channel');
  });
});
