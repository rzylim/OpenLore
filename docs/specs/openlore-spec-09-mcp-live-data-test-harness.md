# OpenLore Spec 09 — MCP Live-Data Test Harness

> A Claude Code prompt. Paste into a fresh session opened at the OpenLore repo root.

---

## Progress

Branch: `openlore-spec-09-mcp-live-data-test-harness`. Status: not started.

- [ ] Curated repo manifest (`fixture-repos.ts`): real OSS repos pinned by git URL + commit SHA, one per supported language family, sized small.
- [ ] Repo cache layer: shallow-clone-at-SHA into a gitignored cache dir; verify SHA; offline-friendly skip-with-loud-log when network is unavailable (never silent pass).
- [ ] Analyze step: run `openlore analyze` against each cached repo, fail loudly if artifacts are missing.
- [ ] Tool driver: invoke every tool in `TOOL_DEFINITIONS` against each analyzed repo with programmatically derived realistic args.
- [ ] Invariant assertions: no throw, valid MCP result shape, no leaked secrets / absolute-path noise, within byte/token budget, required fields present, expected-non-empty tools return data.
- [ ] Golden snapshots for the small, stable outputs only (architecture overview counts) keyed by repo + commit.
- [ ] Coverage gate: assert every tool in `TOOL_DEFINITIONS` is exercised at least once; fail (not skip) when a new tool lacks coverage.
- [ ] Summary report: tool x repo x pass/fail x output-size matrix, written to a gitignored artifact and printed.
- [ ] Wired into `vitest.integration.config.ts` only; default `test:run` stays fast and offline.
- [ ] `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build` all green.
- [ ] One PR opened, titled `spec-09: MCP live-data test harness`.

## Context for you (the agent)

OpenLore is a TypeScript CLI plus an MCP server (`src/cli/commands/mcp.ts`, `startMcpServer`) that exposes roughly 45 static-analysis tools over the Model Context Protocol — `orient`, `search_code`, `get_subgraph`, `analyze_impact`, `trace_execution_path`, `suggest_insertion_points`, the spec tools, the decision tools, and more. They are listed in the exported `TOOL_DEFINITIONS` array in `mcp.ts` and handled by functions in `src/core/services/mcp-handlers/{graph,semantic,orient,change,decisions,analysis}.ts` (`handleOrient`, `handleSearchCode`, `handleGetSubgraph`, and siblings). These tools are consumed primarily from Claude Code; they are the user's own daily-driver MCP server.

The tools have unit tests co-located next to source (`orient.test.ts`, `semantic.test.ts`, and so on). Those tests run against tiny synthetic fixtures or the OpenLore repo itself. That is good coverage for logic, but it is a poor proxy for the real world. The tools' actual job is to behave sanely on **messy, large, multi-language real repositories** — repos with generated code, vendored directories, deeply nested call graphs, unusual identifiers, mixed languages, and the long tail of constructs that synthetic fixtures never contain. Detection-style tools (impact analysis, insertion-point suggestion, drift, subgraph extraction) that are never run against live data are exactly the kind that ship subtle bugs: they pass on the toy fixture, then return empty, oversized, malformed, or path-leaking output on a real codebase, and nobody notices until a Claude Code session degrades.

This spec adds a **live-data integration test harness** that exercises every MCP tool against a curated set of real open-source repositories and asserts invariants that must hold on any real codebase. The goal is confidence: after this lands, a regression in any tool's real-world output, or the addition of a new tool with no real-world coverage, fails CI instead of leaking into a Claude Code session.

This is one of four sibling specs hardening the MCP server, aligned with how Anthropic / Claude Code build MCP servers:

- **spec-09 (this one):** Live-data test harness — validate all MCP tools against real repositories.
- **spec-10:** MCP tool response hardening — uniform input validation, timeouts, output size limits, error normalization.
- **spec-11:** MCP tool surface audit / consolidation — overlap, naming, LLM-facing descriptions, MCP tool annotations, deprecation.
- **spec-12:** MCP protocol conformance — initialize handshake, capabilities, JSON-RPC error codes, protocol version handling.

This spec **tests existing behavior**. It is a verification harness, not a behavior change. Crucially: any bug the harness uncovers is **filed as a follow-up and handed to spec-10**, not fixed here. Mixing a fix into this PR muddies the "this only adds tests" contract and makes the harness's first run untrustworthy. The harness's first job is to tell the truth about what the tools do today.

## Scope contract — do not break these things

This PR must NOT:

- Change the behavior of any MCP tool, any handler in `src/core/services/mcp-handlers/`, `TOOL_DEFINITIONS`, or `startMcpServer`. If a test fails because a tool misbehaves on real data, that is a **finding**, not a license to edit the tool. Record it (see below) and, where needed, write the assertion as a documented known-failure so the suite stays green while the bug is tracked — do not loosen an invariant to hide a real defect, and do not patch the tool.
- Add or change per-tool input validation, argument coercion, timeouts, output truncation, or error normalization. That is **spec-10**. The harness observes current behavior; it does not impose new behavior.
- Touch protocol-level concerns: the initialize handshake, capabilities, JSON-RPC error codes, or protocol version handling. That is **spec-12**. This harness calls the handler functions (and/or drives the server) to test tool output, not the wire protocol.
- Rename, merge, deprecate, or re-describe tools. That is **spec-11**.
- Make the default `npm run test:run` slower or network-dependent. The live-data suite runs only under the integration config and must be opt-in for the fast path.
- Commit cloned repositories, large fixtures, or analysis artifacts into the repo. Real repos are fetched into a **gitignored cache** at run time and pinned by SHA.
- Require any network access for the unit suite, the build, lint, or typecheck.

This PR must:

- Exercise **every** tool in `TOOL_DEFINITIONS` at least once against at least one real repo, and **fail the coverage gate** if a tool is added later without harness coverage. This is the core anti-rot mechanism — treat it as the headline deliverable.
- Use a small **curated, version-pinned** set of real OSS repos spanning the supported languages, fetched deterministically (URL + commit SHA), cached, and offline-friendly (skip with a loud, explicit log when the network is unavailable — **never** silently pass).
- Assert **invariants** that hold across any real repo (no throw, valid MCP result shape, no leaked secrets or absolute-path noise, within a byte/token budget, required fields present, expected-non-empty tools return data) rather than exact golden values for large or nondeterministic outputs. Reserve golden **snapshots** for small, stable outputs (for example architecture overview counts) keyed by repo + commit.
- Derive tool arguments **programmatically** from each repo's own analysis output (pick a real function name from the analysis to feed `get_subgraph` / `get_function_body`, a real file path for file-scoped tools, a real search term, and so on) so the harness adapts to whatever repo it is pointed at.
- Run under `vitest.integration.config.ts`, gated so it does not slow the default suite, and emit a diagnosable summary report (tool x repo, pass/fail, output size).
- Reuse and extend the existing prior art: `scripts/bench-mcp.ts` (run via `npm run bench:mcp`) already imports handlers directly (`handleOrient`, `handleSearchCode`, `readCachedContext`) and runs them against an analyzed project. Lift its handler-invocation and "is this repo analyzed" patterns rather than reinventing them.

## The deliverable

A live-data integration suite that, for each repo in a pinned manifest, ensures the repo is analyzed, drives every MCP tool against it, asserts invariants, and reports a matrix of results.

### 1. The curated repo manifest

A typed manifest listing a **small** set of real OSS repos, one per supported language family, each pinned to a specific commit SHA for determinism. Keep each repo small (prefer libraries and CLIs in the low-thousands-of-lines, or shallow-clone a single commit of a larger repo so only that snapshot is materialized). Supported languages to cover (per the tree-sitter set): typescript/js, python, go, rust, ruby, java, kotlin, swift, c/c++, c#, php, scala, elixir, bash. You do **not** need one repo per language in the first PR — pick a representative subset that maximizes language and shape diversity (aim for at least 5 to 8 repos covering TS/JS, Python, Go, Rust, and at least two of the others) and leave `TODO(spec-09-followup): add <language> repo` markers for the rest. Each manifest entry records:

```
{
  id: string;            // stable short id, e.g. "ts-commander"
  url: string;           // git clone URL
  sha: string;           // pinned commit SHA (full or unambiguous prefix)
  primaryLanguage: string;
  // optional: a known good function name / file path the harness can prefer,
  // and an "expectNonEmpty" flag for tools that must return data on this repo.
  hints?: { knownFunction?: string; knownFile?: string };
  expectNonEmpty?: string[];   // tool names that MUST return data on this repo
}
```

Prefer permissively licensed repos (MIT / Apache-2.0 / BSD) and note the license per entry in a comment. Do not vendor their source into OpenLore; fetch at run time.

### 2. The repo cache and fetch layer

A helper that, given a manifest entry, ensures `<cacheDir>/<id>@<sha>/` exists and is checked out at exactly that SHA:

- Cache dir lives under a **gitignored** path (for example `.openlore-live-cache/` at repo root, or under the OS temp dir keyed by the repo). Add the chosen path to `.gitignore`.
- Fetch deterministically: shallow `git clone --depth 1` is insufficient for an arbitrary SHA, so clone then `fetch` + `checkout` the pinned SHA, or `clone --filter=blob:none` then checkout. After checkout, **assert the resolved HEAD equals the pinned SHA**; fail loudly on mismatch (a moved tag or rewritten history must not silently change inputs).
- Offline behavior: if the cache entry is already present and valid, use it with no network. If it is absent and the network is unavailable (clone fails), the suite must **skip that repo with a clear, single, explicit log line** (for example `live-data: SKIP <id> — repo not cached and network unavailable`) and the coverage gate must account for the skip rather than reporting a false pass. Never let an offline run report green coverage it did not actually achieve — if zero repos are available, the suite fails (or, behind an explicit `OPENLORE_LIVE_ALLOW_NO_REPOS=1` escape hatch for sandboxed CI, it reports SKIPPED loudly rather than PASSED).

### 3. The analyze step

For each cached repo, run `openlore analyze` so the tools have artifacts to read. Tools read cached analysis from `<dir>/.openlore/analysis/` (`llm-context.json`, `mapping.json`, the SQLite `call-graph.db` via `EdgeStore`); without analysis they return nothing. Reuse the existing programmatic analyze entry point (`src/api/run.ts` `openloreRun`, or the analyze command path) rather than shelling out to a built binary, so the suite runs against the working tree. Assert the expected artifacts exist after analyze and fail loudly if they do not (the bench script's `existsSync(... 'llm-context.json')` check at `scripts/bench-mcp.ts:36` is the pattern to follow). Analyze output (the `.openlore/` dir inside each cached repo) stays in the gitignored cache.

### 4. The tool driver

A driver that iterates `TOOL_DEFINITIONS` and, for each tool, builds realistic args and invokes the corresponding handler against the analyzed repo:

- **Map tool name to handler + args.** Build a small registry mapping each tool name to (a) the handler call and (b) an arg-builder that derives realistic inputs from the repo's analysis. Required args: `directory` is always the cached repo path. For tools needing a function name, file, or query, read the repo's `llm-context.json` / `mapping.json` (or call `orient` / `search_code` first) to pick a **real** function name, a **real** file path, and a plausible search term. Feed those into `get_subgraph`, `get_function_body`, `get_function_skeleton`, `analyze_impact`, `trace_execution_path`, `suggest_insertion_points`, and so on.
- **Drive via handlers, optionally via the server.** Primary path: import and call the exported handlers directly (as `bench-mcp.ts` does) — this is fast and stable and is what tests should assert on. Optionally add one thin "round-trip through `CallToolRequest`" smoke check for a couple of representative tools to confirm the dispatch wiring in `mcp.ts` still maps names to handlers, but do **not** turn this into a protocol-conformance suite (that is spec-12).
- **Determinism of args.** Pick args deterministically (for example the alphabetically-first hub function, or the function named in the manifest `hints`) so a given repo + SHA always drives a tool the same way and snapshots stay stable.

### 5. The assertions (invariants over goldens)

For every tool x repo invocation, assert the invariants that must hold on any real repo:

1. **No throw / no crash.** The handler resolves; it does not reject or throw. A throw is a finding.
2. **Valid MCP result shape.** The result is a well-formed tool result (a `content` array of typed parts as the SDK expects, or the handler's documented return shape). No `undefined`/`null` where a structured result is required.
3. **No secret / path leakage.** The serialized output contains no obvious secrets (scan for `AKIA`-style keys, `-----BEGIN ... PRIVATE KEY-----`, `xox[baprs]-` Slack tokens, long hex/base64 that looks like a token, env-var-shaped `SECRET`/`TOKEN`/`PASSWORD=` lines) and no machine-specific absolute-path noise (for example the runner's home dir, the cache dir's absolute prefix) — tool output should be repo-relative. A leak is a finding.
4. **Within budget.** The serialized output is under a generous byte budget and an estimated-token budget (reuse `estimateTokens` from `src/core/services/llm-service.ts`). Over-budget output is a finding (handed to spec-10's output-size-limit work). Set the budget high enough that today's normal output passes; the point is to catch pathological blowups, not to impose spec-10's limits.
5. **Required fields present.** Per-tool, assert the fields that tool's contract promises exist (for example `orient` returns functions/files/specs sections; `get_subgraph` returns nodes and edges). Keep these assertions to the documented shape — do not invent stricter contracts.
6. **Expected-non-empty returns data.** For tools listed in a repo's `expectNonEmpty`, assert the output is non-trivial (for example `search_code` for a term known to exist returns at least one hit; `orient` on a known repo returns at least one function). Empty output from a tool that should have data on a real repo is exactly the silent-bug class this spec targets.

Use **golden snapshots only** for small, stable, deterministic outputs — primarily architecture-overview-style counts (function count, edge count, entry-point count, hub count) keyed by `repo@sha`. Store these as committed snapshot files or `toMatchInlineSnapshot`, regenerated only when a SHA is bumped. Do **not** snapshot large or nondeterministic outputs (full subgraphs, search rankings, embeddings-influenced ordering) — assert their invariants instead.

### 6. The coverage gate

After driving all tools across all available repos, assert that **every** name in `TOOL_DEFINITIONS` was exercised at least once. Compute the set of driven tool names, diff it against `TOOL_DEFINITIONS.map(t => t.name)`, and **fail** with a clear message listing any uncovered tool (`live-data: tool "<name>" has no harness coverage — add it to the driver registry`). This makes adding a tool without a real-world test a CI failure, which is the durable value of this spec. If a repo was skipped (offline), the gate must distinguish "not covered because no repo was available" (skip, loud) from "not covered because the driver has no entry for it" (hard fail).

### 7. The summary report

Emit a machine- and human-readable summary: for each tool x repo, pass/fail/skip and the serialized output size in bytes and estimated tokens. Print a compact table to the console (model it on `bench-mcp.ts`'s table formatting) and write a JSON artifact to the gitignored cache dir (for example `<cacheDir>/live-data-report.json`) so a regression is diagnosable after the fact. The report should make it obvious which tool, on which repo, regressed.

## Files you will create or modify (approximate)

```
src/core/services/mcp-handlers/live-data/
  fixture-repos.ts                 # the pinned manifest (url + sha + language + hints + expectNonEmpty)
  repo-cache.ts                    # clone/checkout-at-SHA into gitignored cache; SHA verify; offline skip
  analyze-repo.ts                  # run analyze against a cached repo via openloreRun; assert artifacts
  tool-driver.ts                   # registry: tool name -> handler + arg-builder derived from analysis
  invariants.ts                    # shared assertions: shape, secret/path scan, budget, required fields
  report.ts                        # collect + print table + write JSON report to cache
  live-data.integration.test.ts    # the suite: for each repo -> analyze -> drive all tools -> assert -> coverage gate
  __snapshots__/                   # small golden snapshots keyed by repo@sha (overview counts only)
.gitignore                         # add the live-data cache dir (e.g. .openlore-live-cache/)
package.json                       # optional: add "test:live" script (alias into the integration config, filtered)
docs/specs/openlore-spec-09-mcp-live-data-test-harness.md  # this file (already present)
```

Notes on placement, verified against this repo:

- The integration config (`vitest.integration.config.ts`) globs `src/**/*.integration.test.ts`, so the suite file **must** end in `.integration.test.ts` and live under `src/` to be picked up. The default `vitest.config` does not match that pattern, so the live suite stays out of `npm run test:run`.
- The top-level `test/` directory is **gitignored** in this repo (`.gitignore` line 136). Do **not** put harness code or the suite under `test/` — it would not be committed. Co-locate everything under `src/core/services/mcp-handlers/live-data/` as above.
- The fetched-repo cache and the per-repo `.openlore/` analysis output must live under a gitignored path; add that path to `.gitignore` explicitly.
- Reuse `scripts/bench-mcp.ts` patterns (direct handler imports, the analyzed-repo precondition check, the table formatting, `estimateTokens`) rather than duplicating them.

## Acceptance criteria

1. **Every tool is exercised.** Running the live suite drives every tool in `TOOL_DEFINITIONS` at least once against at least one real repo. The coverage gate **fails** (does not skip) if any tool name in `TOOL_DEFINITIONS` has no driver entry, with a message naming the uncovered tool.
2. **Real, pinned repos.** The manifest contains a curated set of real OSS repos (at least 5 to 8) pinned by URL + commit SHA, spanning at least TS/JS, Python, Go, Rust, and two more supported languages. Each entry notes its license. No repo source is committed to OpenLore.
3. **Deterministic + offline-friendly.** A given repo + SHA produces stable derived args and stable snapshots. A second run with a warm cache makes no network calls. When a repo is absent and the network is unavailable, the suite **skips it with a single explicit log line** and the coverage gate distinguishes skip from missing-driver; an all-skipped run never reports a false PASS (it fails, or reports SKIPPED loudly behind the documented `OPENLORE_LIVE_ALLOW_NO_REPOS` escape hatch).
4. **Analyze precondition enforced.** Each repo is analyzed before tools run; the suite asserts `.openlore/analysis/` artifacts (`llm-context.json`, `mapping.json`, `call-graph.db`) exist and fails loudly if analyze produced nothing.
5. **Args derived from real data.** Tools needing a function/file/query are fed values read from the repo's own analysis output (or from a prior `orient`/`search_code` call), not hard-coded names — verified by pointing the harness at two different repos and seeing different derived args drive the same tool.
6. **Invariants asserted.** For every tool x repo: no throw, valid MCP result shape, no secret/absolute-path leakage, output within byte + estimated-token budget, required fields present, and `expectNonEmpty` tools return non-trivial data. Each invariant has a clear failure message identifying the tool, repo, and which invariant failed.
7. **Goldens only where stable.** Golden snapshots are used only for small stable outputs (overview counts) keyed by `repo@sha`; large/nondeterministic outputs are asserted by invariant, not snapshot. Bumping a repo SHA is the only thing that legitimately changes a snapshot.
8. **Gated from the fast path.** `npm run test:run` does not run the live suite, makes no network calls, and is not slowed by this PR. The live suite runs only under `vitest.integration.config.ts` (via `npm run test:integration` / `npm run test:e2e`, or an added filtered `test:live` script).
9. **Diagnosable report.** A run prints a tool x repo pass/fail/skip table with output sizes and writes a JSON report to the gitignored cache dir.
10. **No behavior change.** No tool handler, `TOOL_DEFINITIONS`, `startMcpServer`, validation, timeout, truncation, error-normalization, or protocol code is modified. Any defect the harness uncovers is recorded as a `TODO(spec-09-followup)` / a tracked finding handed to spec-10 — **not fixed in this PR** — and, if it would otherwise redden the suite, captured as an explicit documented known-failure assertion (never by silently weakening an invariant).
11. **Green checks.** `npm run lint`, `npm run typecheck`, `npm run test:run`, and `npm run build` all pass. Harness fixtures/artifacts are excluded from `tsconfig` / `eslint` where appropriate (follow the existing fixture-exclusion pattern used for `src/core/scip/fixtures` and `src/core/analyzer/iac/fixtures`).

## Out of scope (do not start these here)

- Adding or changing per-tool input validation, timeouts, output size limits, or error normalization — **spec-10**. The harness only observes today's behavior.
- Renaming, merging, deprecating, or re-describing tools, or adding MCP tool annotations — **spec-11**.
- The initialize handshake, capabilities negotiation, JSON-RPC error codes, protocol version handling — **spec-12**.
- Fixing any bug the harness finds. Record it; hand it to spec-10. The contract is "this PR only adds tests."
- Performance benchmarking (`scripts/bench-mcp.ts` already owns that). The live harness asserts correctness invariants, not latency.
- One repo per supported language. Cover a representative subset now; leave `TODO(spec-09-followup): add <language> repo` for the rest.

## Git workflow — read carefully

1. Branch: `openlore-spec-09-mcp-live-data-test-harness` off the default branch.
2. **Open exactly ONE pull request** titled `spec-09: MCP live-data test harness` for ALL of this work — manifest, cache/fetch layer, analyze step, tool driver, invariants, coverage gate, report, snapshots, `.gitignore` and config wiring, and docs. Every commit for this spec — every repo added, every reviewer-requested change, every follow-up revision — pushes to that single branch and that single PR. Never open a second PR. If the design changes mid-flight or a reviewer requests changes, push more commits to the same branch. If you split the work across sessions, resume on the same branch and the same PR.
3. A reasonable commit sequence: (a) manifest + repo-cache + analyze step with one repo end to end; (b) the tool driver + arg derivation covering the easy tools; (c) the invariant assertions + secret/path scan + budget; (d) the coverage gate + report; (e) snapshots for overview counts; (f) the remaining repos; (g) `.gitignore` / config / docs. Each commit keeps `lint` / `typecheck` / `test:run` / `build` green.
4. Run `npm run lint`, `npm run typecheck`, `npm run test:run`, and `npm run build` before every push. Run the live suite locally (with network) at least once to confirm coverage passes and to generate the report.
5. If a tool turns out to be hard to drive without changing it, do **not** change it — drive it with the most realistic args you can, assert the invariants you can, and record a `TODO(spec-09-followup)` plus a finding for spec-10. Still count it toward coverage only if it was genuinely exercised.
6. Record the architectural decision (live-data harness as an integration-only, behavior-neutral verification layer that drives exported handlers, fetches pinned real repos into a gitignored cache, and gates on full `TOOL_DEFINITIONS` coverage) via `record_decision` **before** writing code, per the repo's decision-gate workflow.

## When you are done

Reply with: PR URL, summary, follow-ups, files changed. Nothing else.
