# Add hierarchical map navigation

## Why

The repo's call graph is far too large to hold in a context window (the codebase digest reports
~3,582 functions / ~7,716 edges). An agent that wants the lay of the land has no coarse view: it can
fetch one function's neighborhood (`get_subgraph`), or one community's full membership
(`get_cluster`, `analysis.ts:1031-1097`), but it cannot see the *map of regions and how they connect*
and then descend. So orientation either over-fetches or proceeds blind, and multi-hop questions force
the model to stitch many `get_subgraph` calls — the exact context-exhausting traversal the substrate
should prevent.

OpenLore already computes communities (label-propagation, `call-graph.ts:2914-2969`, with
`communityId`/`communityLabel` on every `FunctionNode`). This change exposes them as a navigable
**coarse-to-fine map**: regions as super-nodes first, drill into one region on demand.

## What changes

- A `get_map` tool returning the **cluster-level graph**: each community as a super-node
  (id, label, size, dominant files, top landmark) with aggregated super-edges (counts of inter-cluster
  calls), and nothing else. This is the high-level planner's view.
- A drill-in mode (`get_map` with a `communityId`, or extending `get_cluster`) that returns the
  inside of one region at function granularity — the low-level view — still bounded.
- Super-edges weighted by inter-cluster call volume so the agent can see which regions are coupled
  without reading any function.

## Research basis

Implements hierarchical, coarse-to-fine planning: a high-level planner hops between regions, a
low-level layer resolves the chosen region (arXiv:2011.12491; see `openspec/changes/README.md`).
Clusters here play the role of the paper's sparse landmarks at the macro scale.

## Application to OpenLore

- Reuses the existing label-propagation communities and the `get_cluster` handler/registration as the
  drill-in primitive; the new work is the *aggregation* into a super-node/super-edge graph.
- `get_map` (whole-repo, region granularity) is conclusion-shaped for navigation; the region-internal
  view is the one place we intentionally return more structure, mirroring `get_cluster`'s existing
  contract. Document both classes per `enforce-conclusion-over-graph-tool-contract`.
- Pairs naturally with `add-structural-landmark-salience` (each super-node names its top landmark) and
  `add-call-distance-scoping` (super-edge weights).
- Per the `mcp-quality` "Tool Surface Size and Progressive Disclosure" requirement, `get_map` SHALL
  ship in the opt-in `navigation` preset, not `MINIMAL_TOOLS`. It widens the always-listed surface, so
  it is enabled by request, not by default.

## Out of scope

- A new clustering algorithm. Label propagation already exists and is used as-is.
- Multi-level hierarchy beyond two tiers (regions → functions). Recursive nesting is a future
  question, not this change.
- Any visual/rendering surface; this is a data tool, the viewer is unaffected.
