# OpenLore Spec 14 — Agent Token-Efficiency Benchmark Harness (WITH vs WITHOUT)

> A Claude Code prompt. Paste into a fresh session opened at the OpenLore repo root.
> Parent direction: [Spec 13](openlore-spec-13-context-substrate.md). **Do this spec first.**

---

## Progress

Branch: `openlore-spec-14-agent-benchmark-harness`. Not started.

- [ ] Task suite (relational queries where a graph beats grep) + a control task
- [ ] Harness: drive a headless agent WITH and WITHOUT the openlore MCP server
- [ ] Metric capture: tokens, tool-calls, cost, wall-clock — per repo and aggregate
- [ ] Pinned repo set (fixed commit SHAs) for reproducibility
- [ ] Committed results doc with a one-command reproduce path
- [ ] Demote the unmeasured README token claim to a hypothesis until results land

---

## Context for you (the agent)

OpenLore's headline value claim — that `orient()` replaces a costly file-by-file orientation
pass — is currently **unmeasured**. The figure in [README.md:19](../../README.md#L19) and
[README.md:50](../../README.md#L50) is an assertion, not a result; [scripts/BENCHMARKS.md](../../scripts/BENCHMARKS.md)
measures only raw EdgeStore query latency (~429µs p50), which is plumbing, not an end-to-end
agent outcome.

This is the single most falsifiable claim in the project, and a competitor (CodeGraph) already
publishes the exact benchmark we lack: median of 4 runs across 7 OSS repos, headless agent,
with/without its MCP server, reporting cost / tokens / tool-calls / wall-clock. We need our own,
apples-to-apples. This harness is also the **kill-signal instrument** from Spec 13: if the
measured reduction on relational queries is small, that is the earliest signal to re-weight
toward the governance layer.

## Scope contract — do not break these things

This PR must NOT:

- Change any runtime behavior of `orient`, the graph, or the analyzer.
- Modify or remove the existing micro-benchmarks (`scripts/bench.ts`, `scripts/bench-mcp.ts`,
  `npm run bench`, `npm run bench:mcp`) — add alongside them.
- Make network calls part of the core product; the harness is a dev/CI tool only.
- Inflate or hand-pick results. Pin inputs, publish methodology, report losses honestly.

This PR must:

- Add a separate harness (e.g. `scripts/bench-agent.ts`, `npm run bench:agent`) that runs a
  fixed task suite against pinned OSS repos, once WITH the openlore MCP server configured and
  once WITHOUT, capturing tokens / tool-calls / cost / wall-clock.
- Produce a committed, reproducible results document (`docs/AGENT-BENCHMARKS.md`) with the full
  methodology (repos + SHAs, task list, run count, agent + model, how metrics were captured).
- Update the README to cite the measured numbers, and until they exist, mark the token-savings
  line explicitly as a hypothesis pending this benchmark.

## The deliverable

- **Task suite** — queries where a relational graph is structurally cheaper than iterative
  grep+read: enumerate callers of a symbol, blast radius of a signature change, a call path
  between two functions, plus a "find where feature X lives" control task. Tasks must have
  checkable answers so a run can be scored, not just measured.
- **Harness** — toggles the openlore MCP server in the agent config, runs each task N≥4 times
  per repo across ≥5 pinned repos, and records the metrics. Determinism: pin repo SHAs; fix the
  model; record the agent/CLI version.
- **Results** — a per-repo table plus aggregate, mirroring the competitor's published format so
  comparison is fair. Include variance, not just medians.

## Acceptance

- A reviewer runs one documented command and reproduces the table.
- Numbers are committed in `docs/AGENT-BENCHMARKS.md`; the README cites them (or marks the claim
  as a pending hypothesis).
- If the reduction on relational queries is below the Spec 13 kill-signal threshold, open a
  follow-up to re-weight toward the governance layer — do not bury the result.

## Compatibility note

Pure addition: a new dev/CI script and a docs file. No user-facing or runtime change.
