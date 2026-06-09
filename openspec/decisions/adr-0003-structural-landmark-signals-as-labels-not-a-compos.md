# ADR-0003: Structural landmark signals as labels, not a composite score

## Status

accepted

**Domains**: analyzer, cli

## Context

Surface 'which functions are structural anchors and why' as a set of labeled signals with raw evidence, not a blended salience score. A composite (hub*40+orchestrator*20+...) would be deterministic-but-arbitrary — a black box the agent must trust — violating the north-star principle (c6d1ad07). computeLandmarkSignals reuses existing classifiers with no new thresholds: hub (fanIn>=5), orchestrator (fanOut>=GOD_FUNCTION_FAN_OUT_THRESHOLD), chokepoint (hub ∧ ¬orchestrator), entrypoint, volatile (reuses volatilityLevel from change-coupling), dead (reuses dead-code roots+forward-BFS). Each signal carries raw evidence. No score, no rank field; ordering is the caller's responsibility. A get_landmarks tool is classified conclusion under the tool contract and ships in the opt-in navigation preset only.

## Decision

The system SHALL expose structural landmark signals (hub, orchestrator, chokepoint, entrypoint, volatile, dead) as individually labeled classifications with raw evidence, without computing a composite salience score.

## Consequences

No LANDMARK_WEIGHTS constant or composite salience introduced (explicitly rejected). computeLandmarkSignals takes optional opts (volatilityByFile, deadIds) so pure structural labels need only the graph while volatile/dead are injected from git/reachability — keeping core unit-testable. A deadCodeIds helper added to reachability.ts shares the documented roots definition with handleFindDeadCode. Phase 1 (signals) + Phase 3 (get_landmarks tool) ship now; Phase 2 (orient landmarks[] proximity-ordered enrichment) deferred to follow-up.

> Recorded by openlore decisions on 2026-06-09
> Decision ID: bb57d41e
