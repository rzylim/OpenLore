# OpenLore Spec 15 — Decision & Drift Governance Dogfooding

> A Claude Code prompt. Paste into a fresh session opened at the OpenLore repo root.
> Parent direction: [Spec 13](openlore-spec-13-context-substrate.md).

---

## Progress

Branch: `openlore-spec-15-governance-dogfooding`. Not started.

- [ ] Activate the decisions pre-commit gate in OpenLore's own repo
- [ ] Retroactively record the genuinely-architectural decisions already made
- [ ] Consolidate, then sync into `openspec/specs/`
- [ ] Verify the gate blocks/passes correctly on a test commit
- [ ] Document the dogfood result

---

## Context for you (the agent)

The decision store and spec-drift gate are OpenLore's genuinely differentiated asset — no code
navigation tool in the field pairs a code graph with recorded architectural decisions and a
drift gate. The full workflow exists in code:
[src/core/decisions/](../../src/core/decisions/) (`extractor`, `consolidator`, `store`,
`syncer`, `verifier`) plus the gate documented in [CLAUDE.md](../../CLAUDE.md).

But it is not exercised in this repository — `.openlore/decisions/` is empty and the gate is not
active here. An unused differentiator reads as "a feature even the authors do not run." Spec 16
(promoting decisions to graph nodes) also depends on there being real decisions to project.
This spec turns the system on, on ourselves, and produces the evidence.

## Scope contract — do not break these things

This PR must NOT:

- Change the decision data model or file format in ways that invalidate existing stores.
- Make the gate mandatory for downstream users — it stays opt-in, exactly as today.
- Add LLM cost to commits beyond what the gate already documents.

This PR must:

- Activate the pre-commit decisions gate in this repo's hook config.
- Record the real architectural decisions already embedded in the codebase via the existing
  `record_decision` path — for example: SCIP as one-way export only
  ([src/cli/export/scip.ts:6](../../src/cli/export/scip.ts#L6)); IaC resources projecting onto
  the existing graph primitives ([iac/project.ts](../../src/core/analyzer/iac/project.ts)); the
  edge-store `SCHEMA_VERSION` rebuild-on-bump strategy
  ([edge-store.ts](../../src/core/services/edge-store.ts)); BM25-without-embeddings as the
  zero-network retrieval floor (Spec 06).
- Run consolidation and sync the results into `openspec/specs/`.
- Verify the gate behaves correctly (blocks when decisions are pending/unsynced, passes when
  clean), then document what was recorded and synced.

## The deliverable

- A non-empty, consolidated decision store in `.openlore/decisions/`.
- Synced decision sections in the relevant `openspec/specs/` domains.
- The gate wired into this repo's hooks, with a short `docs/` note describing the dogfood run
  and the decision IDs/domains produced.

## Acceptance

- `openlore decisions` lists real, consolidated decisions for this repo.
- The corresponding spec domains contain synced decision content.
- A deliberate test commit demonstrates the gate blocking and then passing after sync.

## Compatibility note

Affects only OpenLore's own repository configuration and its self-authored specs/decisions.
Zero change to the shipped product's behavior for users.
