# OpenLore Spec 20 — Reachability & Dead-Code Analysis

> A Claude Code prompt. Paste into a fresh session opened at the OpenLore repo root.
> Parent direction: [Spec 13](openlore-spec-13-context-substrate.md). Layer-3 analysis instrument.

---

## Progress

Branch: `openlore-spec-20-reachability-dead-code`. Not started.

- [ ] Reachability from declared/detected entry points over the existing graph
- [ ] Candidate dead-code report (unreachable symbols) with confidence + caveats
- [ ] "What becomes dead if I delete X?" — downstream-only-reachable set
- [ ] Cross-language (rides the existing tree-sitter graph), offline, MCP-surfaced
- [ ] Tests over a fixture with known live/dead regions

---

## Context for you (the agent)

**The instrument:** "is this function reachable from any entry point?", "what is dead?", and
"what becomes dead if I delete X?" — classic graph reachability questions the model burns tokens
guessing at and grep cannot answer (it sees text, not reach).

OpenLore is well placed: the analysis already identifies **entry points** (functions with no
internal callers — see [CODEBASE.md](../../.openlore/analysis/CODEBASE.md)) and holds a call graph
across 15+ languages. Reachability is BFS from entry points; candidate dead code is the
unreachable remainder; "what dies if I delete X" is the set reachable *only* through X.

**Prior art:** knip and ts-prune do exactly this — mark-and-sweep from entry points — but are
**TypeScript/JavaScript-only**, and ts-prune is in maintenance mode. OpenLore's contribution is
the **cross-language** version over the unified graph.

**Honest limits — frame output as *candidates*, never deletion authority.** Entry points are not
always statically visible: dynamic entry points, framework magic (routes, DI, plugin registries),
reflection, and public-API exports consumed externally all produce false "dead" positives. The
instrument must:

- treat exported/public-API symbols and detected framework entry points as roots,
- report confidence and the reason a symbol looks dead,
- and explicitly **not** auto-delete or assert certainty.

## Scope contract — do not break these things

This PR must NOT:

- Auto-delete code or present results as certain.
- Require a build, a run, or a network/API key.
- Regress entry-point detection used elsewhere.

This PR must:

- Compute reachability from declared + detected entry points (including exported/public symbols)
  over the existing graph.
- Report candidate-dead symbols with a confidence level and the reason (e.g. "no static caller;
  not exported; not a detected entry point").
- Answer "what becomes dead if I delete X?" as the set reachable only via X.
- Be cross-language, deterministic, and offline; surface through the existing MCP handler layer.

## The deliverable

- Reachability pass (BFS from roots) + the unreachable-set computation, reusing graph traversal.
- A "delete impact" query: nodes whose only path to a root runs through the target.
- MCP surfacing, additive; results typed and confidence-tagged.

## Acceptance

- A fixture with known live and dead regions yields the correct candidate-dead set, with caveats
  for dynamically-reached symbols.
- "Delete X" returns the correct downstream-dead set.
- Runs offline and deterministically across at least two languages.

## Compatibility note

Pure addition: a read-only analysis over the existing graph. No schema change, no behavior change
to existing tools; results are an additive, confidence-tagged output.
