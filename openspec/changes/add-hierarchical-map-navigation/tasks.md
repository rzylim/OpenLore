# Tasks: add hierarchical map navigation

## 1. Aggregate communities into a super-graph
- [x] Added `src/core/analyzer/cluster-graph.ts` exporting `buildClusterGraph(graph): ClusterGraph`,
      where a super-node is `{ communityId, label, memberCount, fileCount, topFiles, topLandmark }`
      and a super-edge is `{ fromCommunity, toCommunity, callCount }`.
- [x] Super-nodes derive from the existing `communityId`/`communityLabel` on `FunctionNode` (the
      label-propagation pass populates these). No re-clustering.
- [x] Super-edges group `CallEdge`s whose endpoints are in different communities, counting distinct
      cross-community calls per (from, to). External/test nodes excluded; self-edges excluded.
      → verified: unit test on a two-cluster fixture asserts the super-edge count equals the number
      of distinct cross-cluster calls and that no self-edge is emitted.
- [x] `topLandmark` is the highest-fan-in member name (the `get_cluster` naming convention).
      (Did NOT couple to add-structural-landmark-salience: labels carry no single "top" without a
      composite score, which that change explicitly rejected.)

## 2. get_map tool — region view
- [x] Added `handleGetMap(directory, communityId?)` in `src/core/services/mcp-handlers/map.ts`.
      - No `communityId`: returns the region super-graph only (super-nodes + super-edges, no function
        bodies), bounded to the top-K regions by member count with a `truncated` count (no silent cap).
      - With `communityId`: delegates to the shared `buildClusterView` extracted from
        `handleGetCluster`, so the region-internal view reuses proven code.
- [x] Registered in `TOOL_DEFINITIONS` and the dispatch chain, following the `get_cluster` wiring.
      → verified: `get_map` with no args returns only regions/connections; with a `communityId`
      returns the `get_cluster` shape. Live on the repo: 709 regions → top 40 (truncated 669), 39
      connections, drill-in yields function granularity.

## 3. Contract classification
- [x] Classified the whole-repo `get_map` as `conclusion` in the contract table (its super-edges are
      resolved community labels, not id-reference raw topology; the drill-in inherits `get_cluster`'s
      class). Added `get_map` to the `navigation` preset only (NOT `MINIMAL_TOOLS`); nav payload
      ceiling consciously bumped 9_800 → 10_700 (spec-28).
      → verified: `tool-contract.test.ts` completeness passes for `get_map`; `map.test.ts` runs
      `assertConclusionShape` on the real region-view shape.

## 4. Spec + close the loop
- [x] Landed the `CoarseToFineMapNavigation` requirement in a new `specs/mcp-handlers/spec.md` domain.
- [x] Ran `vitest run src/core/analyzer/cluster-graph.test.ts src/core/services/mcp-handlers/map.test.ts`
      → passing.
- [x] Added a "lay of the land / where do regions connect?" → `get_map` row to the `CLAUDE.md` tool table.
- [x] `record_decision` "Two-tier hierarchical map navigation over communities" recorded (id `c683d90d`)
      noting region→function granularity and the deliberate non-recursive scope.
