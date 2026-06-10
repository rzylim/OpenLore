# Add structural landmark signals

> Directory slug kept as `add-structural-landmark-salience` for history; the design now
> surfaces **labeled signals**, not a blended salience score (see "What changes").

## Why

OpenLore already computes every ingredient of "structurally interesting points" — critical hubs
(`graph.ts:661`), god functions (`graph.ts:733`), leaf risk (`graph.ts:618`), dead code
(`reachability.ts:120`), and change coupling / churn (`change-coupling.ts`). But they are exposed as
separate tools an agent must know to call individually. There is no single answer to "which functions
are the structural anchors for this task, and *why*?" — so orientation depends on the agent guessing
which structural query to run.

Surfacing a *sparse set of salient landmarks* is the precondition for hierarchical navigation
(proposal `add-hierarchical-map-navigation`) and goal-conditioned pathfinding (proposal
`add-landmark-pathfinding`). This change produces that sparse set deterministically.

## What changes

This change **does not** blend the signals into a composite salience number. Returning a single
weighted score would require inventing a weighting (`hub*40 + orchestrator*20 + …`) that is
deterministic but arbitrary — exactly the kind of tuning knob the north star (decision `c6d1ad07`,
"static analysis, not guessing") exists to keep out. A deterministic-but-arbitrary number is still a
black box the agent must trust. Instead we hand the agent the **facts** and let it rank by what its
task needs:

- A `computeLandmarkSignals(graph)` pass in the analyzer that, for each function, attaches the set of
  **structural-interest labels** it earns — `hub`, `orchestrator`, `chokepoint`, `volatile`,
  `entrypoint`, `dead` — where **each label is produced by an existing deterministic classifier**
  (the same thresholds already behind `get_critical_hubs`, `get_god_functions`, leaf/dead-code
  analysis, and change-coupling). Each label carries the raw evidence that earned it (e.g.
  `hub: { fanIn: 49 }`, `volatile: { coChangedWith: 12, commits: 17 }`). **No new threshold or
  weighting constant is introduced**, and no composite rank is emitted — ranking is the caller's.
- A small `landmarks[]` section added to the `orient` response. It is the subset of labeled functions
  nearest to the functions orient already matched, **ordered only by structural proximity** (a single
  well-defined call-distance / hop count, not a blended salience), so the first call surfaces the
  relevant anchors without extra round-trips.
- An optional `get_landmarks` tool (see "Tool surface" below) returning the **whole-repo** set of
  labeled landmarks, optionally filtered to one label — the union view no single existing tool gives.

## Tool surface (discipline)

`get_landmarks` has a **distinct trigger** from `orient`'s `landmarks[]`, so the two do not overlap:

- `orient` → `landmarks[]` answers *"for THIS task, what are the nearby anchors?"* (task-scoped,
  proximity-ordered, returned automatically with an orient call the agent was already making).
- `get_landmarks` answers *"with no task in hand, what are the structural anchors of the WHOLE repo,
  optionally just the `hub`s / just the `volatile` ones?"* (repo-global, filterable by label). It is
  the one call that returns the **union** of all structural-interest signals as labels; the existing
  per-signal tools (`get_critical_hubs`, `get_god_functions`, …) each return only one signal.

Per the `mcp-quality` "Tool Surface Size and Progressive Disclosure" requirement, `get_landmarks`
SHALL ship **in the opt-in `navigation` preset, not the default-recommended surface** — it widens the
always-listed tool set, so it must earn its way in by being requested, not added by default.

## Research basis

Implements "navigate a sparse set of salient landmarks, not the full state space" (arXiv:2011.12491;
see `openspec/changes/README.md`). The deliberate non-borrow: the paper *learns* a saliency model;
OpenLore's structure is explicit, so salience here is just the labels existing deterministic
classifiers already assign — no learned or weighted model.

## Application to OpenLore

- Pure recombination of existing classifiers; no new scorer and no `LANDMARK_WEIGHTS` constant.
- `landmarks[]` slots into the existing `orient` enrichment phase (`orient.ts:319-489`), behind the
  same `lean` flag, so the lean path stays cheap.
- Output is conclusion-shaped (a labeled set with evidence), satisfying the tool contract from
  proposal `enforce-conclusion-over-graph-tool-contract`.

## Out of scope

- A composite/blended salience score or any tunable weighting. Explicitly rejected above.
- New structural metrics or thresholds. This composes the classifiers that already exist.
- Cross-repo or historical trend analysis beyond the churn already provided by change-coupling.
