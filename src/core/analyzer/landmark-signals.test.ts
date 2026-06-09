/**
 * Tests for computeLandmarkSignals — labeled structural signals, no composite score.
 */

import { describe, it, expect } from 'vitest';
import { computeLandmarkSignals } from './landmark-signals.js';
import type { FunctionNode, SerializedCallGraph } from './call-graph.js';

function node(over: Partial<FunctionNode> & { id: string }): FunctionNode {
  return {
    name: over.id.split('::')[1] ?? over.id,
    filePath: over.id.split('::')[0] ?? 'x.ts',
    isAsync: false, language: 'typescript', startIndex: 0, endIndex: 1,
    fanIn: 0, fanOut: 0, ...over,
  };
}
function graph(nodes: FunctionNode[], over: Partial<SerializedCallGraph> = {}): SerializedCallGraph {
  return {
    nodes, edges: [], classes: [], inheritanceEdges: [],
    hubFunctions: [], entryPoints: [], layerViolations: [],
    stats: { totalNodes: nodes.length, totalEdges: 0, avgFanIn: 0, avgFanOut: 0 },
    ...over,
  };
}

describe('computeLandmarkSignals', () => {
  it('labels a hub with its real fanIn and never emits a score', () => {
    const hub = node({ id: 'a.ts::hubFn', fanIn: 49, fanOut: 2 });
    const lm = computeLandmarkSignals(graph([hub], { hubFunctions: [hub] }));
    expect(lm).toHaveLength(1);
    const hubSig = lm[0].signals.find(s => s.label === 'hub')!;
    expect(hubSig.evidence).toEqual({ fanIn: 49 });
    // No composite score / rank field anywhere.
    expect('score' in lm[0]).toBe(false);
    expect(JSON.stringify(lm[0])).not.toMatch(/"score"|"rank"|"salience"/);
  });

  it('labels an orchestrator by the god-function fan-out threshold (>=8)', () => {
    const orch = node({ id: 'a.ts::orchestrate', fanIn: 1, fanOut: 12 });
    const below = node({ id: 'a.ts::small', fanIn: 1, fanOut: 7 });
    const lm = computeLandmarkSignals(graph([orch, below]));
    expect(lm.find(l => l.name === 'orchestrate')!.signals.find(s => s.label === 'orchestrator')!.evidence).toEqual({ fanOut: 12 });
    expect(lm.find(l => l.name === 'small')).toBeUndefined(); // fanOut 7 earns nothing
  });

  it('derives chokepoint as hub ∧ ¬orchestrator (parameter-free), not for a wide-branching hub', () => {
    const funnel = node({ id: 'a.ts::funnel', fanIn: 30, fanOut: 2 });   // hub, not orchestrator
    const wide = node({ id: 'a.ts::wide', fanIn: 30, fanOut: 20 });      // hub AND orchestrator
    const lm = computeLandmarkSignals(graph([funnel, wide], { hubFunctions: [funnel, wide] }));
    const funnelLabels = lm.find(l => l.name === 'funnel')!.signals.map(s => s.label);
    const wideLabels = lm.find(l => l.name === 'wide')!.signals.map(s => s.label);
    expect(funnelLabels).toContain('chokepoint');
    expect(wideLabels).toContain('orchestrator');
    expect(wideLabels).not.toContain('chokepoint'); // also an orchestrator → not a chokepoint
  });

  it('labels entrypoints from the precomputed entryPoints set', () => {
    const entry = node({ id: 'a.ts::main', fanIn: 0, fanOut: 5 });
    const lm = computeLandmarkSignals(graph([entry], { entryPoints: [entry] }));
    expect(lm[0].signals.map(s => s.label)).toContain('entrypoint');
  });

  it('labels volatile and dead from injected classifier data', () => {
    const vol = node({ id: 'churny.ts::touched', fanIn: 1, fanOut: 1 });
    const dead = node({ id: 'orphan.ts::unused', fanIn: 0, fanOut: 0 });
    const lm = computeLandmarkSignals(graph([vol, dead]), {
      volatilityByFile: new Map([['churny.ts', { level: 'high', churn: 17, coChangedWith: 4 }]]),
      deadIds: new Set(['orphan.ts::unused']),
    });
    expect(lm.find(l => l.name === 'touched')!.signals.find(s => s.label === 'volatile')!.evidence)
      .toEqual({ level: 'high', commits: 17, coChangedWith: 4 });
    expect(lm.find(l => l.name === 'unused')!.signals.map(s => s.label)).toContain('dead');
  });

  it('excludes external (synthetic leaf) nodes and functions with no labels', () => {
    const ext = node({ id: 'external::fetch', isExternal: true, fanIn: 99 });
    const plain = node({ id: 'a.ts::plain', fanIn: 1, fanOut: 1 });
    const lm = computeLandmarkSignals(graph([ext, plain], { hubFunctions: [ext] }));
    expect(lm).toHaveLength(0);
  });
});
