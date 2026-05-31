# OpenLore Spec 17 — Cross-Domain Impact Analysis (Code ↔ Infrastructure)

> A Claude Code prompt. Paste into a fresh session opened at the OpenLore repo root.
> Parent direction: [Spec 13](openlore-spec-13-context-substrate.md).

---

## Progress

Branch: `openlore-spec-17-cross-domain-impact`. Not started.

- [ ] End-to-end traversal across the existing code↔infra edges
- [ ] Surface it through `analyze_impact` (blast radius now spans infra) and `orient`
- [ ] One published, reproducible code→infra example
- [ ] Deterministic and offline; tests over existing IaC fixtures

---

## Context for you (the agent)

OpenLore already parses seven IaC ecosystems (terraform, pulumi, kubernetes, cloudformation,
cdk, ansible, helm) and projects their resources onto the *same* `FunctionNode` / `CallEdge` /
`ClassNode` primitives as code ([iac/types.ts](../../src/core/analyzer/iac/types.ts),
[iac/project.ts](../../src/core/analyzer/iac/project.ts)). The data to cross the code↔infra
boundary is therefore already in one unified graph.

What is missing is a query that *traverses* that boundary end-to-end: route → handler → the
Terraform/K8s resource that deploys it, and the reverse — "if I change this resource, which code
paths are affected?" This is the most distinctive capability OpenLore can demonstrate: a
code-only navigation tool or a grep-based agent structurally cannot answer it. The work is
wiring and surfacing, not new parsing.

In the Spec 13 layering this is the **first cross-domain Layer-3 analysis instrument**: a
consequence *computed* over the unified graph, not a retrieval.

## Scope contract — do not break these things

This PR must NOT:

- Re-architect IaC parsing or change the shared graph primitives.
- Add a parallel "god tool" that fragments the surface — extend the existing `analyze_impact` /
  `orient` rather than inventing a competing entry point.
- Introduce any network dependency; this is offline graph traversal.

This PR must:

- Implement an end-to-end traversal across existing code↔infra edges, reusing the existing
  graph traversal (BFS/DFS) and edge store.
- Surface results through `analyze_impact` so blast radius includes infrastructure neighbors,
  clearly typed so a caller can tell code from infra, and ensure `orient` can return the
  cross-domain neighbors when relevant.
- Ship one reproducible example (a fixture or pinned OSS repo containing both code and IaC)
  tracing a code→infra blast radius, committed as documentation.

## The deliverable

- Traversal logic that crosses the code↔infra edge boundary, built on existing primitives.
- Handler updates exposing cross-domain neighbors through `analyze_impact` (and `orient` where
  relevant), with node typing so consumers can distinguish domains.
- A committed example + tests over the existing `iac/fixtures`.

## Acceptance

- A query of the form "what infrastructure does this handler reach / what code breaks if I change
  this resource?" returns cross-domain neighbors from the unified graph.
- The published example reproduces deterministically and offline.
- Existing `analyze_impact` behavior for code-only queries is unchanged; infra neighbors are
  additive and typed.

## Compatibility note

Additive query path over data the analyzer already produces. Existing impact results are
preserved; infrastructure neighbors are additional, typed results.
