# OpenLore Spec 19 — Deterministic Test Impact Selection

> A Claude Code prompt. Paste into a fresh session opened at the OpenLore repo root.
> Parent direction: [Spec 13](openlore-spec-13-context-substrate.md). The headline Layer-3 instrument.

---

## Progress

Branch: `openlore-spec-19-test-impact-selection`. Not started.

- [ ] Backward reachability from changed functions/files to the tests that exercise them
- [ ] Input from an explicit symbol set **or** a git diff (reuse drift's changed-file logic)
- [ ] Output: the test set + the reaching path + an explicit soundness note
- [ ] Surfaced through the MCP layer; deterministic and offline
- [ ] Tests over a fixture with known test→code reachability

---

## Context for you (the agent)

**The instrument:** an agent changes `parseConfig()` and asks OpenLore *"which tests should I
run?"* — and gets, deterministically, the exact set of tests that transitively reach that
function, by walking the call graph backward from the change to every test that can hit it.

This is the clearest demonstration of the Layer-3 thesis (Spec 13):

- **grep cannot do it** — the tests reach the code through indirect call paths, not text matches.
- **the model is expensive and unreliable at it** — it would have to read the whole suite and guess.
- **a deterministic graph does it instantly** — it is backward reachability over edges we already store.
- **it saves real money** — agents running full suites or guessing wrong is a major time/token sink.
- **no MCP competitor ships it.**

It is also ~80% built: the graph already has `tested_by` edges and test detection
([EdgeKind](../../src/core/analyzer/call-graph.ts#L39); test-file detection in
[call-graph.ts](../../src/core/analyzer/call-graph.ts)), plus working graph traversal in the
existing `analyze_impact`/`get_subgraph` handlers.

**Prior art (this is established CS, not novelty):** regression test selection (RTS). Dynamic RTS
(Ekstazi) collects file dependencies at runtime; static RTS (RTS++, building on Ryder & Tip's
call-graph change-impact analysis) selects tests from the call graph. OpenLore's flavor is
**static, call-graph-based RTS served to the agent at edit time** rather than to CI after the
fact — the same algorithm, a different consumer.

**Soundness — state it honestly.** Static call-graph RTS is an approximation:

- For direct/static dispatch it is a safe *over-approximation* (it may select a few extra tests —
  acceptable, the agent runs slightly more).
- Dynamic dispatch, reflection, dependency injection, and runtime wiring can cause
  *under-approximation* (a relevant test is missed). This is the classic RTS hazard.

The instrument must **prefer over-approximation, surface its confidence, and never claim it is a
sound replacement for the full suite.** It is a *prioritizer* — "run these first / these are
almost certainly the relevant ones" — not a guarantee.

## Scope contract — do not break these things

This PR must NOT:

- Change `tested_by` extraction semantics in a way that regresses existing graphs.
- Run the test suite, replace the test runner, or require a build.
- Claim soundness the analysis does not have. Document over/under-approximation explicitly.
- Add a network or API-key dependency. This is pure graph traversal, deterministic and offline.

This PR must:

- Add an MCP capability (extend `analyze_impact`, or a focused tool surfaced through the existing
  handler layer) that takes a set of changed functions/files **or** a git diff and returns the
  tests that transitively reach the change, each with the reaching path and a confidence note.
- Reuse the changed-file logic the drift subsystem already has for the git-diff input path.
- Degrade gracefully where `tested_by` coverage is sparse (some languages detect tests better than
  others) — say so in the response rather than returning a falsely-confident empty set.
- Be deterministic for a fixed graph state.

## The deliverable

- **Backward reachability**: from each changed node, BFS over call edges to reachable test nodes.
- **Inputs**: an explicit symbol/file set, or a git diff (HEAD vs working tree, or two refs).
- **Output**: the selected tests, the path that connects each test to the change, and a soundness
  banner (approximation posture + coverage caveats for the languages involved).
- **Surface**: through the existing MCP handler layer, additive to current tools.

## Acceptance

- Changing a function in a fixture returns exactly the tests that reach it, with paths.
- The response documents when it may over- or under-select.
- Runs offline, deterministically, with no API key.

## Compatibility note

Pure addition over existing edges (`calls`, `tested_by`). No schema change required if the edges
already exist; if a new typed result field is added to `orient`/`analyze_impact`, it is additive
and optional. Existing behavior is untouched.
