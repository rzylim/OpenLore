/**
 * Tests for buildClusterGraph — community aggregation into a region super-graph.
 */

import { describe, it, expect } from 'vitest';
import { buildClusterGraph } from './cluster-graph.js';
import type { FunctionNode, CallEdge, SerializedCallGraph } from './call-graph.js';

function node(over: Partial<FunctionNode> & { id: string }): FunctionNode {
  return {
    name: over.id.split('::')[1] ?? over.id, filePath: over.id.split('::')[0] ?? 'x.ts',
    isAsync: false, language: 'typescript', startIndex: 0, endIndex: 1, fanIn: 0, fanOut: 0, ...over,
  };
}
function edge(callerId: string, calleeId: string): CallEdge {
  return { callerId, calleeId, calleeName: calleeId.split('::')[1] ?? calleeId, confidence: 'import' };
}
function graph(nodes: FunctionNode[], edges: CallEdge[]): SerializedCallGraph {
  return {
    nodes, edges, classes: [], inheritanceEdges: [], hubFunctions: [], entryPoints: [],
    layerViolations: [], stats: { totalNodes: nodes.length, totalEdges: edges.length, avgFanIn: 0, avgFanOut: 0 },
  };
}

describe('buildClusterGraph', () => {
  // Community A: a1 (file a.ts, fanIn 9), a2 (a.ts). Community B: b1 (b.ts), b2 (c.ts).
  const a1 = node({ id: 'a.ts::a1', communityId: 'A', communityLabel: 'Region A', fanIn: 9 });
  const a2 = node({ id: 'a.ts::a2', communityId: 'A', communityLabel: 'Region A', fanIn: 1 });
  const b1 = node({ id: 'b.ts::b1', communityId: 'B', communityLabel: 'Region B', fanIn: 2 });
  const b2 = node({ id: 'c.ts::b2', communityId: 'B', communityLabel: 'Region B', fanIn: 1 });

  it('builds one super-node per community with member/file counts and the top-fan-in anchor', () => {
    const { superNodes } = buildClusterGraph(graph([a1, a2, b1, b2], []));
    const A = superNodes.find(s => s.communityId === 'A')!;
    const B = superNodes.find(s => s.communityId === 'B')!;
    expect(A.memberCount).toBe(2);
    expect(A.fileCount).toBe(1);        // both in a.ts
    expect(A.label).toBe('Region A');
    expect(A.topLandmark).toBe('a1');   // highest fan-in member
    expect(B.fileCount).toBe(2);        // b.ts + c.ts
  });

  it('counts cross-community calls as super-edges and excludes self (intra-community) edges', () => {
    const edges = [
      edge(a1.id, a2.id),  // intra-A → not a super-edge
      edge(a1.id, b1.id),  // A → B
      edge(a2.id, b2.id),  // A → B (second distinct cross edge)
      edge(b1.id, a1.id),  // B → A
    ];
    const { superEdges } = buildClusterGraph(graph([a1, a2, b1, b2], edges));
    const aToB = superEdges.find(e => e.fromCommunity === 'A' && e.toCommunity === 'B');
    const bToA = superEdges.find(e => e.fromCommunity === 'B' && e.toCommunity === 'A');
    expect(aToB?.callCount).toBe(2);
    expect(bToA?.callCount).toBe(1);
    // no self-edge
    expect(superEdges.some(e => e.fromCommunity === e.toCommunity)).toBe(false);
  });

  it('ignores external and test nodes, and nodes without a community', () => {
    const ext = node({ id: 'external::fetch', isExternal: true, communityId: 'A' });
    const test = node({ id: 'a.test.ts::t', isTest: true, communityId: 'A' });
    const orphan = node({ id: 'z.ts::z' }); // no communityId
    const { superNodes } = buildClusterGraph(graph([a1, ext, test, orphan], []));
    expect(superNodes.find(s => s.communityId === 'A')!.memberCount).toBe(1); // only a1
    expect(superNodes).toHaveLength(1);
  });
});
