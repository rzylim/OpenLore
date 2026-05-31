# OpenLore Spec 22 — Change-Coupling & Volatility Analysis

> A Claude Code prompt. Paste into a fresh session opened at the OpenLore repo root.
> Parent direction: [Spec 13](openlore-spec-13-context-substrate.md). Layer-3 analysis instrument.
> Builds on [Spec 18](openlore-spec-18-local-provenance-edges.md) (git ingestion).

---

## Progress

Branch: `openlore-spec-22-change-coupling-volatility`. Not started.

- [ ] Co-change coupling (files/functions that change together) from local git history
- [ ] Volatility/churn metrics (how often a unit changes)
- [ ] Surfaced in `orient` as a caution signal; deterministic for a fixed git state
- [ ] Documented thresholds + bulk-commit noise filtering
- [ ] Tests over a fixture repo with crafted history

---

## Context for you (the agent)

**The instrument:** two facts the call graph structurally cannot see, both computed from git:

1. **Change coupling** — "these files/functions almost always change together." This surfaces the
   *invisible* coupling that has no import or call edge: the config and the parser that must move
   in lockstep, the handler and the migration. An agent editing one is warned about the sibling it
   would otherwise miss.
2. **Volatility / churn** — "this unit changed 40 times in six months." A caution flag: high-churn
   code is where edits are riskiest.

**Prior art:** logical/change coupling and behavioral code analysis (CodeScene). Their own framing
is decisive for us: *change coupling "isn't possible to calculate from code alone — it is mined
from git."* That is exactly why it is a distinct instrument and a real complement to the structural
graph, and it is deterministic from history.

**Why it complements the labs and the MCP cohort:** none of the code-graph tools compute co-change
(they read code, not history), and the frontier agents do not mine your git log for coupling. It
is local, free, deterministic, and unclaimed.

**Honest limits:** co-change is *correlation, not causation*; it is statistical and needs
sufficient history; and bulk commits (formatting sweeps, mass renames, vendored drops) create false
coupling. The instrument must apply support/confidence thresholds and filter implausibly large
commits, and present coupling as a *signal*, not a rule.

## Scope contract — do not break these things

This PR must NOT:

- Require a remote, a network call, or any upload — local git history only (builds on Spec 18).
- Treat coupling as causation or as a hard constraint.
- Fail on shallow or short history — degrade and say so.

This PR must:

- Compute co-change coupling (pairs above documented support/confidence thresholds) and churn
  metrics from the local git log, reusing Spec 18's git-reading machinery.
- Filter bulk commits above a documented size so they do not manufacture coupling.
- Surface results in `orient` as additive caution signals ("frequently changes with …",
  "volatility: high"), not as blockers.
- Be deterministic for a fixed git state.

## The deliverable

- Co-change computation over commit history with thresholding and bulk-commit filtering.
- Churn/volatility metric per file/function.
- Additive surfacing in `orient`; documented thresholds and noise handling.
- Tests over a fixture repo with crafted history (coupled pairs, a volatile file, a bulk commit
  that must be filtered out).

## Acceptance

- The fixture's intended coupled pairs and volatile units are reported; the bulk commit does not
  create spurious coupling.
- Runs offline and deterministically for a fixed git state; degrades cleanly on shallow history.

## Compatibility note

Builds on Spec 18's local git ingestion; adds an analysis pass and additive `orient` signals. No
network, no schema break to existing tools; results are advisory.
