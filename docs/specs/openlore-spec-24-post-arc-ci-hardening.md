# OpenLore Spec 24 — Post-Arc CI/Release Hygiene (Dogfood Findings)

> A maintenance spec, **not** a feature of the 13–23 context-substrate arc (that arc closed with
> Spec 23 / v2.0.8). This captures issues found while dogfooding the published **v2.0.8** release
> end-to-end, plus two CI annotations surfaced by the release run, and fixes them.

---

## Progress

Branch: `chore/post-arc-ci-hardening`. **In progress** — PR pending. CI/test/workflow hygiene only;
**no product code change and nothing user-facing**, so this does not warrant a version bump or npm
publish.

- [x] **F1** — Bump GitHub Actions off the deprecated Node 20 runtime — checkout@v6, setup-node@v6, upload-artifact@v7 in `ci.yml` + `release.yml`
- [ ] **F2** — Stop `preflight.test.ts` leaking GitHub workflow-command annotations into the CI log

---

## Context — the dogfood pass (what we verified)

Installed the **published** `openlore@2.0.8` from npm into a clean directory and exercised it
end-to-end against a throwaway sample repo (a deliberate `core → cli` layer violation + an unused
leaf function + an `.openlore/architecture.json`):

- `openlore init` → `openlore analyze` produced the full v5 artifact set (call-graph.db,
  dependency-graph.json, llm-context.json, CODEBASE.md, …). ✅
- `openlore mcp` over stdio negotiated protocol `2025-11-25`, advertised **50 tools** including the
  new `check_architecture`. ✅
- `check_architecture` **scan** found both expected violations (`forbidden` + `layers` on
  `src/core/service.ts → src/cli/view.ts`); **pre-edit** (`from`/`to`) returned `allowed: false`. ✅
- `orient` surfaced the additive `architectureViolations` block (2) and suggested
  `check_architecture`. ✅
- `find_dead_code` flagged the unused leaf at low confidence. ✅

**Conclusion: the published package is healthy.** No functional regression was found in 2.0.8. The
only issues are CI/repo-hygiene items the release run surfaced as annotations — fixed below.

---

## F1 — GitHub Actions on the deprecated Node 20 runtime

**Symptom.** Every workflow run prints:
> Node.js 20 actions are deprecated. … `actions/checkout@v4`, `actions/setup-node@v4` … Actions will
> be forced to run with Node.js 24 by default starting June 16th, 2026. Node.js 20 will be removed …
> September 16th, 2026.

**Root cause.** `actions/checkout@v4`, `actions/setup-node@v4`, and `actions/upload-artifact@v4` all
run on the Node 20 action runtime, which GitHub is sunsetting.

**Fix.** Bump each to its current latest major (all Node 24):

| Action | From | To |
|--------|------|----|
| `actions/checkout` | `@v4` | `@v6` |
| `actions/setup-node` | `@v4` | `@v6` |
| `actions/upload-artifact` | `@v4` | `@v7` |

Compatibility is safe for our usage: `setup-node` keeps `node-version` + `cache: npm`; `checkout`
uses defaults (+ `ref:` in release.yml, unchanged across majors); `upload-artifact` uses only
`name` / `path` / `retention-days`, stable across v4→v7.

**Files / sites:**
- `.github/workflows/ci.yml` — checkout/setup-node at lines 17/19, 39/41, 55/57; upload-artifact at 68.
- `.github/workflows/release.yml` — checkout/setup-node at 36/42, 86, 126/130.

**Verify:** push the branch; the deprecation annotation must be gone from the run and all jobs stay
green.

---

## F2 — Preflight test leaks GHA workflow-command annotations into the CI log

**Symptom.** A *passing* "Validate Release" (and CI) run carries spurious GitHub annotations like:
> ✗ OpenLore preflight: staleness score 6 > threshold 0 (1 hub, 0 leaf changes). Run `openlore analyze`.
> ⚠ OpenLore graph is stale for this file — run `openlore analyze` to refresh  (`src/foo.ts`)

referencing fixture paths (`src/foo.ts`, `src/leaf.ts`) that don't exist in the repo. They look like
failures but the jobs concluded `success`.

**Root cause.** `renderGithubAnnotations` in
[src/cli/preflight/report.ts](../../src/cli/preflight/report.ts) emits GitHub *workflow-command*
lines (`::error::…`, `::warning file=…::…`) when `process.env.GITHUB_ACTIONS === 'true'` and the
graph is STALE. [src/cli/preflight/index.ts](../../src/cli/preflight/index.ts) (`runPreflight`, line
~144) writes that string to **`process.stdout`**. The preflight unit tests
([src/cli/preflight/preflight.test.ts](../../src/cli/preflight/preflight.test.ts)) call
`runPreflight()` over fixtures that are deliberately STALE. When the test suite runs **inside CI**,
`GITHUB_ACTIONS` is already `'true'`, so those STALE `runPreflight` calls write real `::error::` /
`::warning::` lines to the job's stdout, and GitHub parses them as run annotations. The product
behavior (emit annotations during a real `openlore preflight` in CI) is correct and desired — the
leak is purely a test-environment artifact.

`GITHUB_ACTIONS` is read by **no other source file** (only `src/cli/preflight/*`), and only
`preflight.test.ts` exercises this path — so the blast radius is one test file.

**Fix.** Neutralize `GITHUB_ACTIONS` for the duration of the preflight test file so no `runPreflight`
fixture inadvertently writes workflow commands to the job log. The one test that explicitly verifies
GHA rendering sets `GITHUB_ACTIONS='true'` locally in a `try/finally` and calls the **pure**
`renderGithubAnnotations()` (which returns a string and writes nothing) — so it keeps working and
does not leak. Add a `beforeAll`/`afterAll` (or `beforeEach`/`afterEach`) in `preflight.test.ts` that
saves and clears `process.env.GITHUB_ACTIONS`, restoring it afterward.

**Verify:**
- `grep` the captured CI test-job log for `::error::OpenLore preflight` / `::warning file=src/foo` →
  zero matches (locally: run the suite with `GITHUB_ACTIONS=true` and confirm those lines no longer
  reach stdout).
- The explicit "emits GHA annotations" test still passes (asserts the pure-function output contains
  the tokens).
- All preflight tests pass; full suite stays green.

---

## Execution order

1. **F1** — edit `ci.yml` + `release.yml`; one commit.
2. **F2** — edit `preflight.test.ts`; reproduce the leak locally (`GITHUB_ACTIONS=true vitest run
   src/cli/preflight`), confirm the fix removes the `::error::`/`::warning::` lines from stdout; one
   commit with the reasoning.
3. Full gate (lint + typecheck + `test:run` + build); update this spec's Progress; push; open PR;
   confirm the pushed run is green **and** annotation-free.

## Acceptance

- Workflow runs show **no** Node 20 deprecation warning.
- A green CI/release run carries **no** spurious `OpenLore preflight: staleness` annotations.
- No product/runtime behavior changes; the published-package e2e remains healthy; no version bump.
