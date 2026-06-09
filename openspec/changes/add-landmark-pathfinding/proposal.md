# Add landmark pathfinding

## Why

`trace_execution_path` (`graph.ts:854-941`) already answers "how does A reach B?" — but it requires
the agent to name both endpoints exactly, and it returns up to `maxPaths` raw DFS chains. Two gaps
remain for goal-conditioned navigation:

1. **Endpoints often aren't known by name.** An agent reasoning about a change knows *kinds* of
   endpoints ("from an entry point into this file", "from this function to whatever DB write it
   reaches"), not exact function names. Pairing free-form endpoints with landmarks closes this.
2. **Selection, not enumeration.** Planning wants the *best* path by cost, not ten chains to read.
   With unweighted DFS, "shortest" means fewest hops; with call-distance it means structurally
   closest.

This change adds goal-conditioned pathfinding that resolves endpoints (including landmark/role-based
ones), returns the single cheapest path plus a few bounded alternates, and explains the choice.

## What changes

- A `find_path` tool taking `from` and `to` as either exact names or **selectors**
  (`landmark:<id>`, `role:entrypoint|hub|sink`, `file:<path>`), resolving each to concrete seed nodes
  via the landmark set and existing fuzzy node search.
- Path selection by call-distance (from `add-call-distance-scoping`) when available, hop-count
  otherwise, returning the cheapest path with its cost and a bounded set of alternates.
- A conclusion-shaped response: the chosen chain, its cost/hops, and a short reason — never a raw
  multi-path graph dump.

## Research basis

Implements goal-conditioned navigation between landmarks: frame the query as "get from A to B" and let
the server plan over the structure (arXiv:2011.12491; see `openspec/changes/README.md`). The
endpoints are the paper's start/goal landmarks; call-distance is its edge-cost estimate.

## Application to OpenLore

- Extends, not replaces, `trace_execution_path`: reuses its `buildAdjacency` (`graph.ts:56`) and
  DFS/traversal plumbing, adding endpoint resolution and cost-based selection on top.
- Depends on `add-structural-landmark-salience` only for the `landmark:<id>` selector; the `role:`
  selectors resolve directly from existing classifiers (entry points, critical-hub set, leaf
  analysis) and need nothing new. Depends on `add-call-distance-scoping` for cheapest-path selection.
  Degrades gracefully to name-only endpoints and hop-count if either is absent.
- Output respects `enforce-conclusion-over-graph-tool-contract` (single path + bounded alternates +
  reason).

## Out of scope

- Taint/dataflow analysis. `find_path` is call-graph reachability between endpoints, not a dataflow
  tracer; `sink` selectors resolve to landmark functions, not to tainted variables.
- Cross-repository paths.
