# OpenLore Spec 21 — Structural Change Analysis (Graph Diff)

> A Claude Code prompt. Paste into a fresh session opened at the OpenLore repo root.
> Parent direction: [Spec 13](openlore-spec-13-context-substrate.md). Layer-3 analysis instrument.

---

## Progress

Branch: `openlore-spec-21-structural-change-analysis`. **DONE** (PR pending).

- [x] Graph delta between two states — `structural_diff` builds two in-memory snapshots from just
      the changed files (old via `git show <base>:<file>`, new via working tree / `headRef`),
      including untracked new files; the canonical graph is never mutated.
      [structural-diff.ts](../../src/core/services/mcp-handlers/structural-diff.ts).
- [x] Report: functions + edges added/removed, signature changes (before→after), and **stale
      callers** — callers in the canonical graph (`getCallers`, depth-1 backward) of a
      signature-changed/removed callee that are NOT part of this change. Rename/move candidates
      (matching signature shape) flagged, reported as both remove+add and a rename — never guessed.
- [x] Surfaced through the MCP layer — new read-only `structural_diff` tool (48 total); aimed at
      review/refactor flows; no schema change.
- [x] Deterministic for two fixed states; tests over a real temp git repo v1→v2 change
      (added/removed/signature-changed, stale callers, rename candidate, untracked file, no-cache
      degradation) — [structural-diff.test.ts](../../src/core/services/mcp-handlers/structural-diff.test.ts).
      Full suite green (3018 passing / 137 files). Doc: [docs/structural-diff.md](../structural-diff.md).

---

## Context for you (the agent)

**The instrument:** given a change (working tree vs `HEAD`, or two commits), compute what changed
*structurally* — which functions/edges were added or removed, which signatures changed, and which
existing callers are now **stale** because a callee's signature moved under them. A review or
refactor agent gets a precise structural changelog instead of re-deriving consequences from a raw
text diff.

This is the difference between *"these 40 lines changed"* (git diff) and *"this change removed
function C, altered the signature of D, and 5 of D's callers are now stale"* (structural diff).
The latter is a computed consequence — Layer 3 — not retrieval.

**Prior art:** structural/AST diffing (e.g. difftastic) compares syntax trees instead of lines.
OpenLore goes one level up: it diffs the **graph** (the call/dependency relationships), which is
where the consequences of a change actually live.

**Why it is cheap here:** the analyzer is fast and incremental, so producing a graph for two
states and diffing them is inexpensive relative to the value.

**Honest limits:** rename/move detection is heuristic (a renamed function can look like a delete +
add); say so, and prefer reporting both interpretations over guessing one. Cross-language signature
notions differ; keep the signature-change check to what the analyzer reliably extracts.

## Scope contract — do not break these things

This PR must NOT:

- Replace or wrap `git diff`; this is a structural *complement* to it.
- Require an LLM or network; the diff is deterministic graph computation.
- Mutate the canonical graph while diffing (operate on snapshots).

This PR must:

- Compute a graph delta between two states (working tree vs a ref, or two refs), reusing the
  existing analyzer to produce each snapshot.
- Report added/removed nodes and edges, changed signatures, and newly-stale callers of changed
  callees.
- Be deterministic for two fixed states and surface through the existing MCP handler layer.
- Flag rename/move ambiguity rather than silently guessing.

## The deliverable

- Snapshot-and-diff over two analyzed states; a typed delta (added/removed/changed + stale callers).
- MCP surfacing aimed at review/refactor flows, additive to current tools.
- Tests: a fixture change produces the correct structural delta, including the stale-caller set.

## Implementation approach (where it lives)

- **Two snapshots, one diff.** Produce a graph for each state (working tree vs a ref, or two refs)
  via the existing analyzer, then diff node sets (by stable id), edge sets, and `FunctionNode.signature`.
- **Stale callers** = `bfsFromDB(changedCallee, 'backward', 1)` for any callee whose signature
  changed ([graph.ts](../../src/core/services/mcp-handlers/graph.ts)).
- **Resolve the two states** with `resolveBaseRef()` / `validateGitRef()`
  ([git-diff.ts](../../src/core/drift/git-diff.ts)); operate on snapshots so the canonical graph is
  never mutated.
- **Surface:** a new read-only handler returning `Promise<unknown>`, aimed at review/refactor flows.

## Compatibility verification (grounded 2026-05-30)

- **No schema change**; operates on analyzer output for two states and never mutates the canonical
  graph.
- Reuses the analyzer, `bfsFromDB`, and `git-diff.ts`; additive handler.

## Edge cases & failure modes

- **Rename / move** looks like delete + add. Report both interpretations (heuristic match on
  name/signature/file proximity); never silently guess one.
- **Two-state analysis cost** is bounded by the incremental analyzer — document it.
- **Cross-language signatures differ:** restrict signature-change detection to what
  `FunctionNode.signature` reliably captures per language.

## Acceptance

- A known fixture change yields the correct added/removed/changed sets and the correct stale-caller
  list.
- Rename/move ambiguity is reported, not hidden.
- Runs offline and deterministically.

## Compatibility note

Read-only analysis over analyzer output for two states. No change to the canonical graph, no
change to existing tools; the delta is an additive, typed result.
