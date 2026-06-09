/**
 * mcp-quality — the conclusion-over-graph tool contract.
 *
 * Plain `.test.ts` (NOT `.integration.test.ts`) so CI enforces it. The checks
 * are synthetic and deterministic: they do not invoke handlers against the live
 * `.openlore/analysis` fixture, which is gitignored and unavailable in CI. The
 * regression that actually matters — a new tool that forgets to declare a class,
 * or a response shaped like a graph dump — is caught by the completeness
 * cross-check and the predicate below.
 */

import { describe, it, expect } from 'vitest';

import { TOOL_DEFINITIONS } from '../../../cli/commands/mcp.js';
import {
  TOOL_OUTPUT_CLASS,
  EXPLICIT_TOPOLOGY_TOOLS,
  assertConclusionShape,
  ToolContractViolationError,
} from './tool-contract.js';
import { MAX_PROVENANCE_EDGES } from '../../../constants.js';

const registeredToolNames = TOOL_DEFINITIONS.map(t => t.name);

describe('TOOL_OUTPUT_CLASS completeness', () => {
  it('classifies every registered tool (no tool is unclassified)', () => {
    const unclassified = registeredToolNames.filter(name => !(name in TOOL_OUTPUT_CLASS));
    expect(unclassified).toEqual([]);
  });

  it('has no stale entries for tools that are no longer registered', () => {
    const registered = new Set(registeredToolNames);
    const stale = Object.keys(TOOL_OUTPUT_CLASS).filter(name => !registered.has(name));
    expect(stale).toEqual([]);
  });

  it('classifies each tool as exactly conclusion or explicit-topology', () => {
    for (const cls of Object.values(TOOL_OUTPUT_CLASS)) {
      expect(['conclusion', 'explicit-topology']).toContain(cls);
    }
  });
});

describe('explicit-topology set', () => {
  it('is exactly { get_call_graph, get_subgraph }', () => {
    expect([...EXPLICIT_TOPOLOGY_TOOLS]).toEqual(['get_call_graph', 'get_subgraph']);
  });
});

describe('assertConclusionShape', () => {
  it('throws for a tool that is not classified', () => {
    expect(() => assertConclusionShape('not_a_real_tool', { ok: true })).toThrow(
      ToolContractViolationError,
    );
  });

  it('exempts explicit-topology tools even when they return a graph dump', () => {
    const dump = { nodes: [{ id: 'a' }], edges: [{ from: 'a', to: 'b' }] };
    expect(() => assertConclusionShape('get_subgraph', dump)).not.toThrow();
    expect(() => assertConclusionShape('get_call_graph', dump)).not.toThrow();
  });

  it('passes a conclusion tool that returns a direct answer (path chain)', () => {
    const response = {
      paths: [{ chain: ['entry', 'mid', 'target'], hops: 2 }],
      reason: 'shortest reaching chain',
    };
    expect(() => assertConclusionShape('trace_execution_path', response)).not.toThrow();
  });

  it('passes a conclusion tool that returns a ranked list', () => {
    const response = { hubs: [{ name: 'validateDirectory', fanIn: 49 }] };
    expect(() => assertConclusionShape('get_critical_hubs', response)).not.toThrow();
  });

  it('passes a conclusion tool that returns a bare metric', () => {
    expect(() => assertConclusionShape('analyze_impact', { blastRadius: 12 })).not.toThrow();
  });

  it('passes an error/guidance response', () => {
    expect(() => assertConclusionShape('get_minimal_context', { error: 'No analysis found.' })).not.toThrow();
  });

  it('throws when a conclusion tool returns both top-level nodes[] and edges[]', () => {
    const dump = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'b' }] };
    expect(() => assertConclusionShape('get_minimal_context', dump)).toThrow(/nodes\[\] and edges\[\]/);
  });

  it('throws when a conclusion tool returns more than MAX_PROVENANCE_EDGES id-reference edges', () => {
    const edges = Array.from({ length: MAX_PROVENANCE_EDGES + 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));
    expect(() => assertConclusionShape('analyze_impact', { trail: edges })).toThrow(/raw edge objects/);
  });

  it('allows bounded provenance up to MAX_PROVENANCE_EDGES id-reference edges', () => {
    const edges = Array.from({ length: MAX_PROVENANCE_EDGES }, (_, i) => ({ callerId: `n${i}`, calleeId: `n${i + 1}` }));
    expect(() => assertConclusionShape('analyze_impact', { provenance: edges })).not.toThrow();
  });

  it('does not flag a resolved {caller,callee} changelog (the structural_diff boundary)', () => {
    // Resolved name-pairs are self-describing conclusions, not a graph to join.
    const changelog = {
      edges: {
        added: Array.from({ length: 200 }, (_, i) => ({ caller: `f${i}`, callee: `g${i}`, file: 'x.ts' })),
        removed: [],
      },
    };
    expect(() => assertConclusionShape('structural_diff', changelog)).not.toThrow();
  });
});
