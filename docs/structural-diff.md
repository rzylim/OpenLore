# Structural Change Analysis (Graph Diff)

> Spec 21. Deterministic, offline, no API key. A structural **complement** to `git diff`.

`structural_diff` answers what a change did *structurally*, not textually. The difference between:

- **git diff** — "these 40 lines changed"
- **structural_diff** — "this removed function `gamma`, changed the signature of `alpha`, and 5 of
  `alpha`'s callers in other files are now **stale**"

The second is a *computed consequence* — Layer 3 — that a review or refactor agent would otherwise
re-derive by hand from a raw text diff.

Prior art is AST diffing (difftastic) — comparing syntax trees instead of lines. This goes one
level up and diffs the **graph** (the call relationships), which is where the consequences of a
change actually live.

## What it reports

Between two states (working tree vs a ref, or two refs):

- **added / removed functions** — by stable node id.
- **signature changes** — same function, changed signature (`before` → `after`).
- **stale callers** — for each signature-changed or removed function, the callers **in the
  canonical graph that are NOT part of this change** — i.e. callers that may now be broken because
  the callee moved under them.
- **rename/move candidates** — a removed function and an added function with the same signature
  shape (same file → high confidence, different file → medium). **Reported as both** the remove+add
  and a rename candidate — never silently guessed.
- **edge deltas** — calls added/removed among the changed files.

## Tool contract

```jsonc
// Working tree vs HEAD (the default)
{ "directory": "/abs/path" }
// vs another ref
{ "directory": "/abs/path", "baseRef": "main" }
// two committed refs
{ "directory": "/abs/path", "baseRef": "v1.0.0", "headRef": "v1.1.0" }
```

Output:

```jsonc
{
  "base": "abc1234", "head": "working tree",
  "changedFiles": [{ "path": "src/mod.ts", "status": "modified" }],
  "summary": { "addedFunctions": 1, "removedFunctions": 2, "signatureChanges": 1,
               "addedEdges": 3, "removedEdges": 1, "staleCallers": 5, "renameCandidates": 1 },
  "added":   [{ "name": "delta", "file": "src/mod.ts", "signature": "function delta(z: string): void" }],
  "removed": [{ "name": "gamma", "file": "src/mod.ts", "staleCallers": [] }],
  "signatureChanged": [
    { "name": "alpha", "file": "src/mod.ts",
      "before": "function alpha(a: string): number",
      "after":  "function alpha(a: string, b: number): number",
      "staleCallers": [{ "name": "consumer", "file": "src/other.ts" }] }
  ],
  "renameCandidates": [
    { "from": { "name": "oldName", "file": "src/mod.ts" }, "to": { "name": "newName", "file": "src/mod.ts" },
      "confidence": "high", "note": "…reported as both remove+add and this rename candidate — verify." }
  ],
  "edges": { "added": [...], "removed": [...] },
  "soundness": { "posture": "structural-complement-to-git-diff", "caveats": ["Rename/move detection is heuristic…", "…"] }
}
```

## How it works — bounded, never mutating

- **Two snapshots, one diff.** Only the **changed files** are re-parsed: old content from
  `git show <base>:<file>`, new content from the working tree (or `git show <headRef>:<file>`).
  Two in-memory graphs are built from just those files — cheap, and the canonical graph is never
  touched. Untracked new files are folded in (their functions are all additions).
- **Node/edge/signature diff** by stable id over the two snapshots.
- **Stale callers** come from the cached canonical graph (`getCallers`, the spec's
  `bfsFromDB(changedCallee, 'backward', 1)`), filtered to callers outside the changed set — the
  ones not updated alongside the callee.

## Honest limits

- **Rename/move is heuristic.** A renamed function looks like delete + add; the signature-shape
  match is a hint, not a fact. Both interpretations are always reported.
- **Cross-language signatures differ.** Signature-change detection is limited to what the analyzer
  extracts per language.
- **Edge deltas** cover calls among/out of the changed files; calls into unchanged files are used
  only for the stale-caller lookup.
- **Stale-caller analysis needs a current `analyze_codebase`.** Without the cached graph the diff
  still works, but stale callers are skipped and the response says so.

Implementation: [`structural-diff.ts`](../src/core/services/mcp-handlers/structural-diff.ts).
Tested over a real temporary git repo with a v1→v2 change (added/removed/signature-changed
functions, the stale-caller set, rename candidates, untracked files) in
[`structural-diff.test.ts`](../src/core/services/mcp-handlers/structural-diff.test.ts).
