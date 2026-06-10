# Add call-distance scoping

## Why

OpenLore's call edges are unweighted: traversals use raw hop-count and resolution `confidence` is
recorded per edge but never used for distance. Context scoping therefore relies on fixed
caller/callee *counts* — `get_minimal_context` returns 12/18/24 direct neighbors by risk tier
(`src/core/services/mcp-handlers/analysis.ts:906-1020`), with no notion of which neighbors are
*nearest* in call structure. That over-includes weakly-resolved, far-apart calls and under-includes
tightly-coupled chains two hops away.

A deterministic **call-distance** — hop count weighted by edge resolution confidence — lets scoping
and pathfinding rank neighbors by how structurally close they actually are, instead of by arbitrary
caps.

## What changes

- A pure function `callDistance(edge)` mapping each `CallEdge.confidence` level to a fixed cost
  (high-confidence resolved call = 1; weaker resolutions cost more), defined once in the analyzer.
- A `weightedBfs` over the existing adjacency that accumulates call-distance as it expands, yielding
  `Map<nodeId, distance>` instead of `Map<nodeId, depth>`.
- `get_minimal_context` scopes by **k-nearest in call-distance** (within a distance budget) rather
  than fixed per-tier neighbor counts, while keeping the existing risk tiers as the *budget* selector.

## Research basis

Implements the "edges carry a reachability/distance estimate, planning uses cost not a boolean"
principle (arXiv:2011.12491; see `openspec/changes/README.md`). The distance is deterministic and
derived from static resolution confidence — no learned value function.

## Application to OpenLore

- Builds directly on existing primitives: `CallEdge.confidence` / `EdgeConfidence` enum
  (`src/core/analyzer/call-graph.ts`), `buildAdjacency` (`graph.ts:56`), and `bfsFromDB`
  (`graph.ts:123`).
- The distance metric is consumed by `add-landmark-pathfinding` (shortest-path selection) and
  `add-hierarchical-map-navigation` (ranking drill-in candidates). Ship this first.
- Keeps all existing hop-count traversals working; weighted traversal is additive.

## Out of scope

- Re-resolving or re-scoring edges. Confidence values are taken as-is.
- Changing `get_subgraph` / `analyze_impact` traversal defaults (they keep hop-depth semantics;
  call-distance is offered as an additional ranking, not a replacement).
