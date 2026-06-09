# Change set: graph-native navigation for coding agents

This directory holds five related change proposals. Together they sharpen one thing OpenLore
already does — hand coding agents *conclusions* about code structure instead of raw graphs to
walk — and extend it with navigation primitives borrowed from planning research.

## The motivating observation

Coding agents reason over text well but traverse graphs poorly. Multi-hop navigation done *inside*
the model degrades as hops accumulate: earlier hops fall out of the context window, and the model
begins to confabulate edges. The reliable pattern is to do all traversal, reachability, and
pathfinding **deterministically and server-side**, returning only the computed answer (a path, a
set, a verdict, a ranked landmark) — never a node-and-edge dump for the model to BFS by hand.

This is exactly OpenLore's north star: *deterministic, locally-computed structural context as a
substrate for coding agents, grounding all capabilities in static analysis rather than LLM
inference* (`openspec/specs/overview/spec.md`, decision `c6d1ad07`). These proposals are additive
to that mission. They do not add a new product surface or domain.

## Research basis

The navigation primitives draw on **"World Model as a Graph: Learning Latent Landmarks for
Planning"** (Lunjun Zhang, Ge Yang, Bradly Stadie; ICML 2021; arXiv:2011.12491). Three transferable
ideas:

1. **Sparse landmarks, not every node.** A planner navigates a *sparse* graph of salient landmarks
   rather than the full state space. → OpenLore should let an agent navigate clusters and
   high-salience functions first, then drill in (proposals 1 and 4).
2. **Edges carry a reachability/distance estimate.** Planning uses edge cost, not a boolean
   reachable/not. → OpenLore's call edges are currently unweighted; a deterministic call-distance
   gives better context scoping and shortest-path selection (proposal 2).
3. **Hierarchical, goal-conditioned planning.** A high-level planner hops landmark-to-landmark; a
   low-level layer executes each hop; queries are framed as "get from A to B." → OpenLore should
   expose coarse-to-fine map navigation and goal-conditioned pathfinding (proposals 1 and 3).

One deliberate non-borrow: in the source paper the landmark graph is *learned* from raw experience
because the environment's structure is implicit. OpenLore's structure is **explicit** — tree-sitter
extracts the call graph deterministically from source. So OpenLore skips the learned-perception
layer entirely and invests only in the navigation/planning layer on top of a map it already has for
free. Nothing here introduces a learned or predictive model; everything stays deterministic and
local.

## Reading order (dependencies)

| # | Change | Depends on | Primary domain |
|---|--------|-----------|----------------|
| 1 | `enforce-conclusion-over-graph-tool-contract` | — (governance; do first) | mcp-quality |
| 2 | `add-call-distance-scoping` | — (foundation) | analyzer |
| 3 | `add-structural-landmark-salience` | — | analyzer |
| 4 | `add-hierarchical-map-navigation` | 1 | mcp-handlers |
| 5 | `add-landmark-pathfinding` | 1, 2, 3 | mcp-handlers |

Each proposal is independently shippable; the dependency column lists what makes it *better*, not
what blocks it. At implementation time, call `record_decision` before writing code for any proposal
that introduces a new tool, data structure, or scoring formula (per project `CLAUDE.md`).

## Tool-surface discipline

These proposals add three tools (`get_map`, `get_landmarks`, `find_path`). The total MCP surface
already trends past ~50, in tension with the `mcp-quality` "minimize the number of tools an agent
must consider" requirement. The discipline (per that requirement): **new tools default to opt-in.**
All three land in the `navigation` preset (`TOOL_PRESETS`, `mcp.ts:1430`) and none enters
`MINIMAL_TOOLS` or any first-run default. The lean/first-run surface stays constant in size as the
registry grows; only the opt-in `navigation` surface widens.

One design correction folded into this set: `add-structural-landmark-salience` returns **labeled
signals** (`hub` / `chokepoint` / `volatile`, each with raw evidence), **not** a blended composite
salience score. A single weighted number would be deterministic but arbitrary — a tuning knob the
north star exists to exclude. Every label is produced by a classifier OpenLore already has; ranking
is the agent's, not a hidden formula's.

## Out of scope for the whole set

- No new threat-modeling, security, or red-team surface. These are coding-agent navigation
  primitives over the existing call graph.
- No learned, statistical, or predictive models. Determinism is a hard constraint.
- No new external dependencies, services, or network calls.
- No composite/weighted salience score or any new tuning constant (centrality cutoffs, salience
  weights). Signals are labels from existing classifiers; ranking is the caller's.
