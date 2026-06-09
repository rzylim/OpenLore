# Tasks: enforce the conclusion-over-graph tool contract

## 1. Inventory and classify the tool surface
- [x] Enumerate every tool name in `TOOL_DEFINITIONS` (`src/cli/commands/mcp.ts:138+`) and its
      dispatch branch (`src/core/services/tool-dispatch.ts:99-286` — note: dispatch lives at
      `src/core/services/tool-dispatch.ts`, not under `mcp-handlers/`).
- [x] For each, record its return shape (read the handler's return statement) and tag it
      `conclusion` or `explicit-topology`.
      → verified: audit of all 50 dispatched handlers found only `get_subgraph` emits a raw
      `nodes[]`+`edges[]` dump. `get_call_graph` currently returns bounded summary lists but is kept
      `explicit-topology` (it is the designated graph-level tool); everything else is `conclusion`
      and already compliant — zero existing handler outputs change.
- [x] Write the classification table into `src/core/services/mcp-handlers/tool-contract.ts` as a
      typed constant `TOOL_OUTPUT_CLASS: Record<string, 'conclusion' | 'explicit-topology'>`.
      → verified: completeness test asserts every registered tool name has an entry and there are no
      stale entries.

## 2. Define the contract predicate
- [x] In the same module, add `assertConclusionShape(toolName, response)` that, for `conclusion`
      tools, checks: (a) no top-level array of id-reference edge objects (`{from,to}` /
      `{callerId,calleeId}` / `{source,target}`) larger than `MAX_PROVENANCE_EDGES = 25`, and
      (b) no top-level `nodes[]`+`edges[]` pair requiring a join. Resolved `{caller,callee}`
      name-pairs are intentionally NOT flagged — they are self-describing conclusions (e.g.
      `structural_diff`'s changelog), documented as the boundary in the module.
      → verified: throws on a hand-built graph-dump; passes on path/list/metric responses.
- [x] Keep the bound a named constant in `src/constants.ts` so it is tunable in one place.

## 3. Regression test across the live surface
- [x] Add `src/core/services/mcp-handlers/tool-contract.test.ts`.
      → DEVIATION: the test does NOT invoke handlers against the `.openlore/analysis` fixture —
      that directory is gitignored and unavailable in CI, so a fixture-invoking test would be
      green locally but broken/skipped in CI. Instead the test is synthetic and deterministic: it
      cross-checks `TOOL_OUTPUT_CLASS` against the exported `TOOL_DEFINITIONS` (the real regression
      guard for an unclassified new tool) and exercises `assertConclusionShape` against hand-built
      conclusion/graph-dump shapes.
      → verified: `vitest run src/core/services/mcp-handlers/tool-contract.test.ts` passes (14 tests).
- [x] Confirmed this is a plain `.test.ts` (not `.integration.test.ts`) so CI enforces it.

## 4. Author rule in the spec
- [x] Added the `ToolsReturnConclusionsNotGraphs` requirement in `specs/mcp-quality/spec.md`.
- [x] Added a one-line note to `CLAUDE.md`'s MCP table area pointing at the contract module.

## 5. Close the loop
- [x] Run `check_spec_drift` for `mcp-quality` after implementation.
- [x] `record_decision` titled "MCP conclusion-over-graph output contract" recorded (id `4b88176d`)
      with the two explicit-topology exceptions named in consequences.
