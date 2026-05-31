# OpenLore Spec 23 — Architecture Invariant Guardrails

> A Claude Code prompt. Paste into a fresh session opened at the OpenLore repo root.
> Parent direction: [Spec 13](openlore-spec-13-context-substrate.md). Layer-3 analysis instrument.
> Builds on [Spec 16](openlore-spec-16-decisions-as-graph-nodes.md) (decisions as graph data).

---

## Progress

Branch: `openlore-spec-23-architecture-invariants`. Not started.

- [ ] A declarative rule format for dependency/layer constraints (opt-in)
- [ ] A deterministic checker over the dependency graph
- [ ] A pre-edit query the agent consults *before* writing a violating import
- [ ] Continuous violation reporting; rules optionally sourced from recorded decisions
- [ ] Tests over a fixture with a declared rule and a known violation

---

## Context for you (the agent)

**The instrument:** let a repo declare architectural constraints — "the domain layer must not
import infrastructure," "nothing may depend on `legacy/`" — and have OpenLore answer, *before* the
agent writes the code, *"may I add this import here?"* with a deterministic yes/no, the rule that
applies, and why. Plus continuous reporting of existing violations.

The distinctive angle is **when** the check happens. Existing tools enforce architecture in CI,
*after* the violating code is written. OpenLore can answer the agent at **edit time**, turning an
architectural rule from a post-hoc failure into a pre-write guardrail — a computed Layer-3 fact
("this edit would violate rule R"), not a retrieval.

**Prior art:** architecture fitness functions — ArchUnit (Java), dependency-cruiser (JS),
import-linter (Python) — express rules as test-like assertions ("classes in X must not depend on
Y") and run them in CI. OpenLore's contributions are (a) **cross-language** rules over the unified
dependency graph, and (b) **agent-facing, pre-edit** evaluation. The analyzer already surfaces
"layer violations" in [CODEBASE.md](../../.openlore/analysis/CODEBASE.md), so the detection
primitive exists; this spec makes the rules explicit, queryable, and consulted in the loop.

**Optional tie to decisions (Spec 16):** a recorded architectural decision can *carry* an
invariant ("we decided the API layer stays transport-agnostic"). Where it does, the guardrail can
source the rule from the decision node, so the "why" (Layer 2) and the "may I?" (Layer 3) share one
source of truth.

**Honest limits:** rules must be authored — the instrument is opt-in and inert until a repo
declares constraints; do **not** invent rules with an LLM. Keep the rule vocabulary to the
well-understood, deterministic kind (dependency/layer/module-boundary constraints); do not drift
into fuzzy "semantic" rules a graph cannot decide.

## Scope contract — do not break these things

This PR must NOT:

- Infer or generate rules via an LLM; rules are author-declared (optionally from recorded decisions).
- Block or burden users who declare no rules — fully opt-in, inert by default.
- Replace existing linters/CI tools; this is an additional, agent-facing checker.
- Require a network or API key.

This PR must:

- Define a small declarative rule format for dependency/layer/module-boundary constraints.
- Implement a deterministic checker over the existing dependency graph, reusing the layer-violation
  detection primitive.
- Expose a pre-edit query through the MCP layer ("is an import from A to B allowed?") returning a
  verdict + the governing rule + rationale, and a continuous report of current violations.
- Optionally source rules from decision nodes (Spec 16) when a decision encodes an invariant.
- Be deterministic and offline.

## The deliverable

- Rule format + parser (opt-in config; optional decision-sourced rules).
- Deterministic dependency-graph checker (verdict for a hypothetical edge; full violation scan).
- MCP pre-edit query + violation report, additive to existing tools.
- Tests: a declared "domain must not import infra" rule flags an existing violation and correctly
  answers an allowed vs. disallowed pre-edit query.

## Implementation approach (where it lives)

- **Reuse the existing detector.** Layer violations are already computed by
  `detectLayerViolations(edges, nodes, layers)` in
  [call-graph.ts](../../src/core/analyzer/call-graph.ts) (≈lines 2876–2917), where
  `layers: Record<layerName, pathPrefixes[]>` and key order defines the hierarchy. Generalize the
  rule input to a small declarative config (forbidden dependency directions, module boundaries)
  that compiles down to this check, plus the file-level dependency graph
  ([dependency-graph.ts](../../src/core/analyzer/dependency-graph.ts)).
- **Pre-edit query:** given `(fromFile, toFileOrSymbol)`, resolve layers/modules and answer
  allowed/denied + the governing rule + reason, writing nothing.
- **Optional decision-sourced rules:** read invariants from **synced ADR files**
  (`openspec/decisions/adr-*.md`) and/or active decisions — *not* from `pending.json` fields, which
  are purged on sync (see Edge cases). Keeps Spec 16's "why" and this "may I?" on one source.
- **Surface:** a new read-only handler (pre-edit verdict + a full violation scan reusing
  `detectLayerViolations`).

## Compatibility verification (grounded 2026-05-30)

- **Opt-in and inert** with no rules declared; the existing layer-violation reporting is unchanged.
- Reuses `detectLayerViolations` + the dependency graph; new handler returns `unknown`.
- **Decision integration reads ADR files / active decisions** and does not alter the decision file
  format or the gate — specifically avoiding the purge-on-sync pitfall below.

## Edge cases & failure modes

- **No rules declared** → fully inert: no output, no behavior change.
- **Purge-on-sync hazard:** `INACTIVE_STATUSES` (`synced`/`rejected`/`phantom`) decisions are
  removed from `pending.json` ([store.ts](../../src/core/decisions/store.ts)), so invariants must
  live in the synced ADR files, not in pending decision fields.
- **Rules referencing non-existent paths** → reported as config warnings, never a crash.
- **Keep the vocabulary deterministic** (dependency / layer / module-boundary). Reject fuzzy
  "semantic" rules a graph cannot decide.

## Acceptance

- With a declared rule, the checker flags existing violations and answers a pre-edit import query
  correctly (allowed / disallowed + the rule + why).
- With no rules declared, behavior is unchanged and nothing is reported.
- Runs offline and deterministically.

## Compatibility note

Opt-in and additive: inert until a repo declares rules. Reuses the existing dependency graph and
the Spec 16 decision data; no change to existing tools or behavior for repos that declare nothing.
