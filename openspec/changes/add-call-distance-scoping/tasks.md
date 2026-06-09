# Tasks: add call-distance scoping

## 1. Define the deterministic distance metric
- [x] Locate the `EdgeConfidence` enum and `CallEdge` type in `src/core/analyzer/call-graph.ts`
      (confidence values include `import`, `type_inference`, `type_name`, `name_only`, `self_cls`,
      `same_file`, `external`, and `http_endpoint` — the proposal's draft list missed
      `http_endpoint`; the exhaustive switch surfaced it).
- [x] Add `export function callDistance(edge: CallEdge): number` mapping confidence → cost:
      `import`/`same_file`/`self_cls`/`http_endpoint` = 1 (strongly resolved),
      `type_inference`/`type_name` = 2, `name_only` = 3 (heuristic match),
      `external` = `Infinity` (excluded from internal scoping). Costs live in a named constant
      `CALL_DISTANCE_COSTS` next to the enum.
      → verified: unit test pins each confidence level to its cost; the switch is exhaustive
      (`never` default for compile-time safety) with a finite runtime fallback for malformed data.

## 2. Weighted traversal
- [x] In `src/core/services/mcp-handlers/graph.ts`, added `weightedBfs(seeds, adjacency, maxDistance)`
      next to `bfs` / `bfsFromDB`, plus `buildWeightedAdjacency(cg)`. Dijkstra over the weighted
      adjacency returns `Map<nodeId, { distance, hops, predecessor }>`.
      → verified: on a fixture chain A→B→C with mixed confidences, distances are monotonic and the
      predecessor map reconstructs the path; a strong 2-hop path beats a weak 1-hop one.
- [x] In-memory path uses `buildWeightedAdjacency`. The DB-streaming (`EdgeStore`) variant is
      DEFERRED to `add-landmark-pathfinding`, the first consumer that needs off-heap traversal —
      `get_minimal_context` already loads the graph in memory, so shipping an unused DB path now
      would be speculative. Noted in the decision.

## 3. Scope get_minimal_context by nearest-in-distance
- [x] In `handleGetMinimalContext`, kept the risk-tier selection but reinterpreted each tier as a
      **distance budget + k cap** (high = budget 4 / k≤24, medium = 3 / k≤18, low = 2 / k≤12).
- [x] Replaced the direct callers/callees gather with `weightedBfs` in each direction, returning the
      k nearest by `distance`, tie-broken by fanIn (callers) / fanOut (callees). Direct external
      callees are still surfaced (the weighted pass skips synthetic leaves) so external-dependency
      visibility is preserved.
      → verified: a target whose tightest coupling is 2 hops away includes that chain; a weakly
      `name_only` direct caller is dropped under a tight budget. `analysis.test.ts` updated.
- [x] Added `distance` and `hops` to each returned caller/callee entry (bounded provenance —
      satisfies the conclusion-over-graph contract).

## 4. Spec + close the loop
- [x] Landed the `specs/analyzer/spec.md` delta (`ConfidenceWeightedCallDistance`,
      `MinimalContextScopedByNearestDistance`).
- [x] Ran `vitest run src/core/analyzer/call-graph.test.ts src/core/services/mcp-handlers/graph.test.ts
      src/core/services/mcp-handlers/analysis.test.ts` → 179 passed.
- [x] `record_decision` "Confidence-weighted call-distance metric" recorded (id `106b2895`) noting the
      cost table and that `external` edges are excluded from internal scoping.
