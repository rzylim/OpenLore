# OpenLore Spec 16 — Architectural Decisions as First-Class Graph Nodes

> A Claude Code prompt. Paste into a fresh session opened at the OpenLore repo root.
> Parent direction: [Spec 13](openlore-spec-13-context-substrate.md).
> Depends on [Spec 15](openlore-spec-15-governance-dogfooding.md) (needs real decisions to project).

---

## Progress

Branch: `openlore-spec-16-decisions-as-graph-nodes`. Not started.

- [ ] Add a decision node type and an `affects` edge kind
- [ ] Project the existing decision store onto graph nodes/edges (derived, like IaC)
- [ ] Make `analyze_impact` / `get_subgraph` return governing decisions as neighbors
- [ ] Keep `orient`'s existing decision-surfacing working; upgrade it additively
- [ ] Bump `SCHEMA_VERSION`; confirm clean rebuild and backward compatibility

---

## Context for you (the agent)

Today decisions are stored in a side-file and surfaced by a runtime string set-membership test
on `affectedFiles` / `affectedDomains`
([orient.ts](../../src/core/services/mcp-handlers/orient.ts#L355-L380)). That is a filter, not a
graph relationship: decisions are not nodes, not traversable, and invisible to
`analyze_impact` / `get_subgraph`.

Promoting `Decision` to a first-class graph node with `affects` edges to the function/file nodes
it governs turns the filter into the deterministic join Spec 13 calls for, and makes
"what decisions govern this code, and what does changing it implicate?" answerable by the same
impact machinery as code edges. This is the relationship no navigation competitor offers.

The pattern already exists in the repo: the IaC subsystem projects external records onto the
existing `FunctionNode` / `CallEdge` / `ClassNode` primitives via a parser→projector split
([iac/types.ts](../../src/core/analyzer/iac/types.ts),
[iac/project.ts](../../src/core/analyzer/iac/project.ts)). Decisions follow the same shape: the
JSON store remains the authored source of truth; the graph projection is derived and regenerable.

## Scope contract — do not break these things

This PR must NOT:

- Change the decision authoring workflow (`record_decision` → consolidate → gate → sync) or its
  on-disk format. The store stays the source of truth.
- Break `orient`'s current decision output — preserve the existing field; add to it.
- Require an API key. Decisions already exist; this is pure graph wiring, fully deterministic.
- Destabilize the call-graph / edge-store hubs (highest fan-in/out in the repo). Changes are
  additive: a new edge kind and a derived projection, no rewrite of call edges.

This PR must:

- Extend `EdgeKind` ([call-graph.ts:39](../../src/core/analyzer/call-graph.ts#L39)) with an
  `affects` (or `decided_by`) kind, and represent decision nodes in the node store.
- Add a projector that maps the loaded decision store onto decision nodes + `affects` edges at
  analyze/load time (mirroring `iac/project.ts`).
- Update `analyze_impact` / `get_subgraph` and the analysis handlers to include decision
  neighbors, clearly typed so callers can distinguish them from code nodes.
- Keep `orient`'s response additive: the existing `pendingDecisions` surfacing continues to work;
  graph-derived decisions are an addition, not a replacement.
- Bump `SCHEMA_VERSION`; the edge store rebuilds from source on bump, so existing users incur one
  re-analyze and no migration.

## The deliverable

- A decision-node + `affects`-edge projection of the decision store, derived and regenerable.
- Impact/subgraph queries that return governing decisions as graph neighbors.
- Tests: a fixture decision store projects into nodes/edges; `analyze_impact(file)` returns the
  intersecting decision as a neighbor (not a post-hoc filter); legacy stores project cleanly.

## Acceptance

- `analyze_impact(file)` and `get_subgraph` surface governing decisions as typed graph neighbors.
- `orient` still returns decisions (existing behavior intact).
- `SCHEMA_VERSION` bumped; a re-analyze produces the projected nodes/edges; no data loss.

## Compatibility note

The decision JSON store remains authoritative and unchanged; the graph projection is derived and
rebuilt from it. `orient`'s output is additive. The schema bump costs users a single re-analyze.
