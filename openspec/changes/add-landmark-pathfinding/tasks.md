# Tasks: add landmark pathfinding

## 1. Endpoint resolution
- [x] Added `resolveEndpoint(spec, cg, forward): ResolvedEndpoint` in
      `src/core/services/mcp-handlers/pathfind.ts`. Supports:
      - exact / fuzzy name → case-insensitive substring match (like `trace_execution_path`).
      - `landmark:<id>` → resolve a node by exact id/name, else id-substring.
      - `role:entrypoint` = `cg.entryPoints`; `role:hub` = `cg.hubFunctions`; `role:sink` = a called
        leaf (zero outgoing internal call edges AND `fanIn >= 1`) — parameter-free, no new threshold.
      - `file:<path>` → functions whose `filePath` matches.
      → verified: unit tests resolve each selector to a non-empty seed set; an unknown role yields an
      `error` kind (the handler turns it into a clear message, not a silent empty result).

## 2. Cost-based pathfinding
- [x] Added `findCheapestPath(cg, fromSeeds, toSeeds, opts)` running `weightedBfs` forward from the
      `from` seeds, stopping at the nearest reached `to` seed and reconstructing via the predecessor
      map. Call-distance weights by default; unit-cost adjacency (distance == hops) when
      `useCallDistance=false`, so both modes share one traversal.
- [x] Returns the single cheapest path plus up to `MAX_ALTERNATES` (3) next-best paths (to other
      resolved `to` seeds), each `{ ids, hops, distance }`.
      → verified: on a fixture with a short weak path and a longer strong path, the strong path wins
      under call-distance and the short path wins under hop-count.

## 3. find_path tool
- [x] Added `handleFindPath(directory, from, to, opts)` composing resolution + cheapest-path.
      Response: `{ from, to, resolvedFrom, resolvedTo, path: {chain,hops,distance}, alternates[], reason }`.
- [x] Registered in `TOOL_DEFINITIONS` and the dispatch chain (mirrors `trace_execution_path`).
- [x] Added `find_path` to the **`navigation` preset only** (NOT `MINIMAL_TOOLS`); nav payload ceiling
      bumped 10_700 → 11_800 and full-surface ceiling 48_000 → 50_000 (spec-28, conscious decisions).
- [x] Classified `find_path` as `conclusion` in the contract table.
      → verified: `tool-contract.test.ts` completeness passes; `pathfind.test.ts` runs
      `assertConclusionShape` on the real response (chain + bounded alternates, no edge dump).

## 4. Graceful degradation + guardrails
- [x] No connected path within budget returns a structured `{ path: null, noPath: { reason,
      reachedNodes, hint } }`, not an empty array.
- [x] Bounded by `SUBGRAPH_MAX_DEPTH_LIMIT` (hop mode) and a call-distance cap (`PATH_MAX_DISTANCE`),
      so the tool cannot force an unbounded traversal.

## 5. Spec + close the loop
- [x] Landed the `GoalConditionedLandmarkPathfinding` requirement in `specs/mcp-handlers/spec.md`.
- [x] Ran `vitest run src/core/services/mcp-handlers/pathfind.test.ts` → passing; verified `find_path`
      live on the repo (role→name, name→sink with alternates, distance/hop modes, structured no-path).
- [x] Added a "find the route from A to B (by name, role, or landmark)" → `find_path` row to `CLAUDE.md`.
- [x] `record_decision` "Goal-conditioned landmark pathfinding" recorded (id `539ee661`) noting the
      selector grammar and the call-distance-then-hop-count fallback.
