# Tasks: add structural landmark signals

## 1. Labeled-signal pass (no composite score)
- [x] Added `src/core/analyzer/landmark-signals.ts` exporting
      `computeLandmarkSignals(graph, opts?): Landmark[]`, where
      `Landmark = { id, name, filePath, signals: LandmarkSignal[] }` and
      `LandmarkSignal = { label, evidence }`. No `score` field; a function appears iff it earns ≥1 label.
- [x] Each label derives from the EXISTING classifier — no new threshold:
      - `hub`: the precomputed `graph.hubFunctions` set; evidence `{ fanIn }`
      - `orchestrator`: `fanOut >= GOD_FUNCTION_FAN_OUT_THRESHOLD`; evidence `{ fanOut }`
      - `chokepoint`: parameter-free `hub ∧ ¬orchestrator`; evidence `{ fanIn, fanOut }`
      - `volatile`: `volatilityLevel(churn)` from change-coupling (level ≠ low); evidence `{ level, commits, coChangedWith }`
      - `entrypoint`: `graph.entryPoints`; evidence `{ fanOut }`
      - `dead`: `deadCodeIds` (reachability classifier), narrowed to no-caller candidates; evidence `{ fanIn }`
      → verified: unit test asserts a known hub carries `hub` with its real `fanIn`, volatile/dead come
      from injected classifier data, and **no `score` field is present**.

## 2. Surface in orient (task-scoped, proximity-ordered)
- [x] In `handleOrient`, after function matching, attached a `landmarks[]` enrichment: the labeled
      landmarks nearest the matched functions, ranked by call-distance proximity over an undirected
      weighted adjacency (reuses `weightedBfs` / `buildWeightedAdjacency`), each entry carrying its
      `signals` + evidence and its `distance`/`hops`. The matched seeds are excluded from their own
      landmark list; `dead` is omitted (an anchor is a point to navigate toward, not dead code).
- [x] Gated behind `!lean` (computed in the enrichment region, added only to the full return), so
      `lean=true` skips the work.
      → verified: `orient.test.ts` shows `landmarks[]` present in full mode with labels+evidence and
      absent in lean mode; verified live on the repo (6 proximity-ordered anchors, distance asc).
- [x] Landed the `OrientSurfacesTaskScopedLandmarks` spec requirement.

## 3. Optional global tool (opt-in preset only)
- [x] Added `handleGetLandmarks(directory, { limit, label? })` in
      `src/core/services/mcp-handlers/landmarks.ts`, returning the whole-repo labeled landmarks,
      optionally filtered to one label, ordered by fan-in (a single transparent metric, not a blended
      salience). Registered in `TOOL_DEFINITIONS` and the dispatch chain.
- [x] Added `get_landmarks` to the **`navigation` preset only**; it is NOT in `MINIMAL_TOOLS`.
- [x] Classified `get_landmarks` as `conclusion` in the contract table.
      → verified: `tool-contract.test.ts` completeness passes for `get_landmarks`; a preset test
      asserts it is in `navigation` and absent from `minimal`.

## 4. Spec + close the loop
- [x] Landed the `specs/analyzer/spec.md` delta (`StructuralLandmarkSignals`).
      (`OrientSurfacesTaskScopedLandmarks` deferred with Phase 2.)
- [x] Ran `vitest run src/core/analyzer/landmark-signals.test.ts
      src/core/services/mcp-handlers/landmarks.test.ts` → passing; verified `get_landmarks` live on
      the repo's own graph (37 hubs matches the digest; all 6 labels present; contract holds).
- [x] `record_decision` "Structural landmark signals as labels, not a composite score" recorded
      (id `bb57d41e`) with the label→classifier mapping and the explicit rejection of a composite score.
