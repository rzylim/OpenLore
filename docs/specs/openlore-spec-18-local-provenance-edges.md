# OpenLore Spec 18 — Local Provenance Edges (Git & PR Metadata, No OAuth)

> A Claude Code prompt. Paste into a fresh session opened at the OpenLore repo root.
> Parent direction: [Spec 13](openlore-spec-13-context-substrate.md).

---

## Progress

Branch: `openlore-spec-18-local-provenance-edges`. Not started.

- [ ] `authored_by` and `changed_in_pr` edges sourced from local git / `gh`
- [ ] Projected onto existing function/file nodes (derived, regenerable)
- [ ] Surfaced additively in `orient`
- [ ] Graceful degradation: git-only when `gh` is absent or unauthenticated
- [ ] Deterministic given a fixed git state; no network upload

---

## Context for you (the agent)

This is the "code ↔ organizational context" join made real **without any cloud surface**. Today
git is used only for changed-file diffing in drift detection; pull requests are never parsed and
no provenance edges exist. Yet the most valuable provenance — "who last changed this function,
in which PR, citing which decision" — is sitting in the local `.git` history and reachable via
the local `gh` CLI under the user's existing authentication.

Parsing that locally yields `authored_by` (code → person) and `changed_in_pr` (code → PR) edges
that let `orient` answer provenance questions grep cannot. Crucially, this stays inside Spec 13's
prime constraint: **local, deterministic, nothing uploaded.** It is the deliberate alternative to
cloud OAuth connectors, which Spec 13 fences to an optional far-horizon plugin precisely because
they would forfeit this local-only guarantee.

## Scope contract — do not break these things

This PR must NOT:

- Introduce OAuth, cloud connectors, or any network upload. Reads are local git plus local `gh`
  using the user's own credentials; nothing is sent anywhere.
- Require `gh`. When `gh` is absent or unauthenticated, degrade gracefully to git-only provenance.
- Fail or block `analyze` when git history is shallow or absent.
- Bloat the graph. Cap provenance (for example, last-touch author plus top-N recent authors per
  node) and document the cap; do not import unbounded history.

This PR must:

- Add a local provenance extractor (parser→projector pattern) producing `authored_by` and
  `changed_in_pr` edges, optionally `references` edges for issue/SHA mentions in commit messages.
- Project these onto existing function/file nodes as derived, regenerable graph data.
- Surface provenance additively in `orient` ("last changed by X in PR #N").
- Be deterministic for a fixed git state and fully offline (git-only path requires no network).
- Document the no-OAuth / no-upload guarantee prominently.

## The deliverable

- A git/`gh` provenance extractor + projector, mirroring the existing parser→projector split.
- `EdgeKind` extensions for the new provenance edges.
- `orient` surfacing of last-author / PR provenance, additive to its current response.
- Tests over a fixture repository with commit history, covering both the `gh`-present and
  git-only paths.

## Acceptance

- `orient` / impact surfaces last-author and originating PR for a function as graph edges.
- The git-only path works with no network and no `gh`.
- No network upload occurs on any path; the guarantee is documented and tested.

## Compatibility note

Additive and local-only. `gh` is optional with graceful degradation. The graph projection is
derived and rebuilt on the `SCHEMA_VERSION` bump; no user data leaves the machine.
