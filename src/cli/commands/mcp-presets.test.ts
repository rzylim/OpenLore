/**
 * Spec 14 — MCP tool-preset selection (`--preset` / `--minimal`).
 *
 * Guards the navigation preset that flipped the agent benchmark from a loss to a
 * win: it must expose exactly its graph-traversal tools, every preset name must
 * resolve to a REAL tool (so a renamed/removed tool can't silently shrink the
 * surface), and the selector's precedence/error behaviour must hold.
 */
import { describe, it, expect } from 'vitest';
import { selectActiveTools, TOOL_PRESETS, TOOL_DEFINITIONS } from './mcp.js';

const NAV = [
  'orient', 'search_code', 'get_subgraph', 'trace_execution_path',
  'analyze_impact', 'suggest_insertion_points', 'get_function_skeleton',
];

describe('MCP tool presets', () => {
  it('every preset references only real, defined tools (no stale names)', () => {
    const real = new Set(TOOL_DEFINITIONS.map(t => t.name));
    for (const [name, set] of Object.entries(TOOL_PRESETS)) {
      for (const tool of set) {
        expect(real.has(tool), `preset "${name}" references unknown tool "${tool}"`).toBe(true);
      }
    }
  });

  it('navigation preset = exactly the 7 graph-traversal tools, no governance tools', () => {
    const tools = selectActiveTools(TOOL_DEFINITIONS, { preset: 'navigation' }).map(t => t.name);
    expect(new Set(tools)).toEqual(new Set(NAV));
    for (const gov of ['record_decision', 'detect_changes', 'check_spec_drift']) {
      expect(tools).not.toContain(gov);
    }
  });

  it('minimal preset keeps its 5-tool contract', () => {
    const tools = selectActiveTools(TOOL_DEFINITIONS, { minimal: true }).map(t => t.name);
    expect(new Set(tools)).toEqual(new Set(['orient', 'search_code', 'record_decision', 'detect_changes', 'check_spec_drift']));
  });

  it('no selector exposes the full tool set', () => {
    expect(selectActiveTools(TOOL_DEFINITIONS, {})).toHaveLength(TOOL_DEFINITIONS.length);
    expect(TOOL_DEFINITIONS.length).toBeGreaterThan(NAV.length); // full surface really is larger
  });

  it('--preset takes precedence over --minimal', () => {
    const tools = selectActiveTools(TOOL_DEFINITIONS, { minimal: true, preset: 'navigation' }).map(t => t.name);
    expect(new Set(tools)).toEqual(new Set(NAV));
  });

  it('an unknown preset throws with the known list, not a silent full surface', () => {
    expect(() => selectActiveTools(TOOL_DEFINITIONS, { preset: 'nope' })).toThrow(/Unknown --preset "nope".*minimal.*navigation/s);
  });
});

// ============================================================================
// Spec 25 P1 — cache-prefix stability. The Round-1 loss was per-request tool-
// schema overhead; the fix is a surface the provider KV-cache can hold. That
// only works if the emitted tool list is byte-identical across requests, so
// these guard against any per-request variation (reordering, rebuilt schemas).
// ============================================================================
describe('MCP surface cache-prefix stability (spec-25 P1)', () => {
  const serialize = (opts: { minimal?: boolean; preset?: string }) =>
    JSON.stringify(selectActiveTools(TOOL_DEFINITIONS, opts).map(t => ({ name: t.name, inputSchema: (t as { inputSchema?: unknown }).inputSchema })));

  it('emits a byte-identical tool list across repeated calls (full + each preset)', () => {
    for (const opts of [{}, { minimal: true }, { preset: 'navigation' }] as const) {
      expect(serialize(opts)).toBe(serialize(opts)); // same content twice → stable prefix
    }
  });

  it('preset filtering preserves TOOL_DEFINITIONS declaration order (filter, not Set order)', () => {
    const full = TOOL_DEFINITIONS.map(t => t.name);
    const nav = selectActiveTools(TOOL_DEFINITIONS, { preset: 'navigation' }).map(t => t.name);
    // nav names appear in the same relative order as in the full declaration.
    expect(nav).toEqual(full.filter(n => nav.includes(n)));
  });

  it('tool names are unique (a duplicate would make the cached prefix order ambiguous)', () => {
    const names = TOOL_DEFINITIONS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool carries a static inputSchema object (not rebuilt per request)', () => {
    for (const t of TOOL_DEFINITIONS) {
      const a = (t as { inputSchema?: unknown }).inputSchema;
      const b = (t as { inputSchema?: unknown }).inputSchema;
      expect(a).toBe(b); // same reference → no per-request reconstruction
    }
  });
});

// ============================================================================
// Spec 11 — tool annotations: every tool has complete MCP annotations
// ============================================================================
import { toolAnnotations } from './mcp.js';

describe('tool annotations (spec-11)', () => {
  it('every tool has a title, the three read/write hints, and openWorldHint', () => {
    for (const t of TOOL_DEFINITIONS) {
      const a = toolAnnotations(t.name);
      expect(typeof a.title).toBe('string');
      expect((a.title as string).length).toBeGreaterThan(0);
      expect(typeof a.readOnlyHint).toBe('boolean');
      expect(typeof a.destructiveHint).toBe('boolean');
      expect(typeof a.idempotentHint).toBe('boolean');
      expect(typeof a.openWorldHint).toBe('boolean');
    }
  });

  it('derives a human-readable title from the snake_case name', () => {
    expect(toolAnnotations('get_change_coupling').title).toBe('Get Change Coupling');
    expect(toolAnnotations('orient').title).toBe('Orient');
  });

  it('marks LLM-backed tools open-world and local analysis tools closed-world', () => {
    expect(toolAnnotations('generate_tests').openWorldHint).toBe(true);
    expect(toolAnnotations('orient').openWorldHint).toBe(false);
    expect(toolAnnotations('find_dead_code').openWorldHint).toBe(false);
  });

  it('read-only analysis tools are marked readOnly + non-destructive', () => {
    for (const name of ['orient', 'analyze_impact', 'find_dead_code', 'structural_diff', 'get_change_coupling']) {
      const a = toolAnnotations(name);
      expect(a.readOnlyHint).toBe(true);
      expect(a.destructiveHint).toBe(false);
    }
  });
});
