# OpenLore Spec 11 — MCP Tool Surface Audit & Consolidation

> A Claude Code prompt. Paste into a fresh session opened at the OpenLore repo root.

---

## Progress

Branch: `openlore-spec-11-mcp-tool-surface-audit`. **DONE** (in PR #117).

> M1 audit matrix committed: [docs/specs/mcp-tool-audit.md](mcp-tool-audit.md) covering all 49 tools
> (purpose, overlap, recommendation). M2/M5: names already follow a consistent `verb_noun`/`get_<noun>`
> convention and every overlap is an intentional scope/granularity variant → **no renames or merges**
> (no alias map needed). M3: every tool now carries complete MCP `annotations`
> (`title` + `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`) via `toolAnnotations`
> in [mcp.ts](../../src/cli/commands/mcp.ts), tested in mcp-presets.test.ts. M4: descriptions follow
> the WHEN-to-use / WHEN-NOT pattern. M6: [docs/mcp-tools.md](../mcp-tools.md) and the project
> `CLAUDE.md` tool table synced to the 49-tool surface.

> Status: **implemented** (commit `387a3f1`). Verified 2026-06-09: audit matrix at
> `docs/specs/mcp-tool-audit.md`; `annotations` (title + 4 hints) on every tool via
> `toolAnnotations()` in `mcp.ts`; WHEN-to-use descriptions; `mcp-presets.test.ts` asserts
> annotations are present and tool names are unique. M2/M5: names are already coherent so no
> renames/aliases were needed — documented in the audit.

- [x] M1 — Audit matrix committed: `docs/specs/mcp-tool-audit.md` covering all ~45 tools (purpose, inputs, overlap-with, recommendation).
- [x] M2 — Naming normalization rules pinned + every rename wired through a non-breaking alias map (old name -> new handler + one-time deprecation marker).
- [x] M3 — `annotations` added to every `TOOL_DEFINITIONS` entry (`title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).
- [x] M4 — Descriptions rewritten per Anthropic best practice (WHEN to use, WHEN NOT to vs the overlapping tool, what it returns, cost/latency), tied to the orient-first workflow.
- [x] M5 — Consolidation decisions executed (merge / keep-with-justification) for the search_* family, decisions read tools, and the context/graph families — each behind an alias so nothing breaks.
- [x] M6 — `docs/mcp-tools.md` and the CLAUDE.md tool table brought back in sync with the final surface.
- [x] M7 — Tests: alias resolution + deprecation marker, annotations present and correct, no duplicate/empty tool names; `lint`, `typecheck`, `test:run`, `build` green.

## Context for you (the agent)

OpenLore is a static-analysis MCP server. Its entire value reaches Claude Code through one array: the exported `TOOL_DEFINITIONS` in [src/cli/commands/mcp.ts](../../src/cli/commands/mcp.ts), about **45** tools, each `{ name, description, inputSchema }`. That array is the catalog the model reads when it decides which tool to call. When the catalog is noisy — overlapping tools, inconsistent names, descriptions that do not say when NOT to use a tool — the model picks wrong, wastes a round trip, or calls three tools where one (`orient`) would do.

This spec is the **catalog pass**. It improves the *shape and discoverability* of the tool surface so Claude picks the right tool the first time, aligned with how Anthropic and Claude Code build MCP servers: small, well-named, well-annotated tools with descriptions optimized for an LLM choosing among many.

This is one of four sibling specs hardening the OpenLore MCP server. Stay in your lane:

- **spec-09 (Live-data test harness)** — how tools are exercised against real analysis data. Not your concern except that your alias/annotation tests should fit that harness.
- **spec-10 (MCP tool response hardening)** — input validation, timeouts, output-size limits, error normalization, the *internals* of a tool response. **You must not touch response internals or error handling.**
- **spec-11 (THIS ONE)** — tool NAMES, DESCRIPTIONS, ANNOTATIONS, overlap/consolidation, and the deprecation/alias path.
- **spec-12 (MCP protocol conformance)** — protocol negotiation, capabilities, transport. **You must not touch protocol negotiation.**

The current tool name set (the audit covers exactly these):

```
orient, analyze_codebase, get_architecture_overview, get_refactor_report,
get_call_graph, get_duplicate_report, get_signatures, get_subgraph,
trace_execution_path, get_mapping, check_spec_drift, analyze_impact,
get_low_risk_refactor_candidates, get_leaf_functions, get_critical_hubs,
get_function_skeleton, get_god_functions, suggest_insertion_points, search_code,
list_spec_domains, search_specs, search_unified, get_spec, get_function_body,
get_file_dependencies, generate_change_proposal, annotate_story, get_decisions,
get_route_inventory, get_middleware_inventory, get_schema_inventory,
get_ui_components, get_env_vars, get_external_packages, audit_spec_coverage,
generate_tests, get_test_coverage, get_minimal_context, get_cluster,
detect_changes, record_decision, list_decisions, approve_decision,
reject_decision, sync_decisions
```

Known overlap candidates to *analyze* (do not prejudge — the audit decides):

- **Search family:** `search_code` vs `search_unified` vs `search_specs`. `search_unified` looks like a superset; decide whether the others become thin presets or stay as distinct entry points.
- **Decisions read:** `get_decisions` vs `list_decisions` — these read very similar data with different verbs.
- **Context / orientation:** `get_minimal_context` vs `orient` vs `get_cluster`. CLAUDE.md already positions `orient` as the *one-call entry point* that bundles functions, files, specs, call-paths, and insertion points. The other two must justify their existence against that.
- **Graph queries:** `get_subgraph`, `analyze_impact`, `trace_execution_path`, `get_call_graph` — overlapping graph traversals with different framings. Keep the ones that answer genuinely different questions; document the distinction sharply in their descriptions.

The MCP SDK in use is `@modelcontextprotocol/sdk@^1.27.1`, which supports **tool annotations** on each definition: `annotations: { title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint }`. Almost every OpenLore tool is a read-only analysis query (`readOnlyHint: true`). The decision-mutation and artifact-producing tools write or generate: `record_decision`, `approve_decision`, `reject_decision`, `sync_decisions`, `generate_change_proposal`, `annotate_story`, `generate_tests`. Annotations let Claude Code reason about safety and idempotency before calling.

CLAUDE.md (repo root) has its own "when to use which tool" table, and [docs/mcp-tools.md](../../docs/mcp-tools.md) (~29 KB) documents every tool. Both are downstream of `TOOL_DEFINITIONS` and must end this PR in sync with it.

## Scope contract — do not break these things

This PR must NOT:

- Change any tool's **response internals**, JSON result shape, error handling, validation, timeouts, or output-size behavior. That is spec-10. The only result-shape change you may make is adding a small, additive, one-time **deprecation marker** when an aliased old name is called (see below) — and only if spec-10 has not already reserved that field; coordinate, do not collide.
- Touch MCP protocol negotiation, capabilities advertisement, or transport. That is spec-12.
- Hard-break **any** existing tool name. Clients (the user's own Claude Code config and others) have names wired up. Every rename and every consolidation keeps the old name working as an alias.
- Change tool *behavior* or *inputs* in a way that alters results for an unchanged call. Renaming a tool must not change what it returns for the same arguments.
- Remove a tool outright. "Deprecate" here means: keep it working, mark it deprecated, point to the replacement. Removal is a future major-version decision, not this PR.
- Invent new analysis capabilities. This is a catalog/naming/annotation pass, not a feature pass.

This PR must:

- Produce a committed **audit matrix** covering all ~45 tools and drive concrete code changes from it (not just a doc).
- Add **annotations** to every `TOOL_DEFINITIONS` entry, with `readOnlyHint`/`destructiveHint`/`idempotentHint` set correctly per the read-only vs mutating split above.
- Rewrite **descriptions** to the Anthropic best-practice shape: WHEN to use, WHEN NOT to (vs the nearest overlapping tool), what it returns, and a cost/latency hint — optimized for an LLM choosing among 45 tools, and reinforcing the orient-first workflow.
- Apply **naming normalization** and any renames through a non-breaking **alias map**, so old names keep working and emit a one-time deprecation note.
- Make concrete **consolidation** decisions for the redundant families, each with an alias path so nothing breaks.
- Keep `docs/mcp-tools.md` and the CLAUDE.md tool table **in sync** with the final surface.

## The deliverable

### 1. The audit matrix (`docs/specs/mcp-tool-audit.md`)

Commit a doc with one row per tool: `name | purpose (one line) | key inputs | overlaps with | recommendation`. Recommendation is one of: **keep** / **merge** / **rename** / **deprecate** / **improve-description**. A genuine merge or rename row must name the surviving tool and the alias. This doc is the rationale of record for every code change in M2–M5; reviewers read it first. A best-effort starter matrix is in the appendix below — refine it against the real handlers, do not take it as final.

### 2. Naming normalization rules

Pin these rules in the audit doc and apply them:

- **Read queries** that return existing analysis data are `get_*` (single subject) or `list_*` (enumerations) or `search_*` (ranked text search).
- **`get_*`** = fetch a specific, named thing (`get_spec`, `get_function_body`, `get_subgraph`). **`list_*`** = enumerate a set with no query (`list_spec_domains`, `list_decisions`). **`search_*`** = ranked retrieval from a query string (`search_code`, `search_specs`, `search_unified`).
- **Mutating / artifact-producing** tools are verb-first imperatives (`record_decision`, `approve_decision`, `generate_tests`, `generate_change_proposal`). Keep them imperative; do not `get_`/`list_`-ify them.
- Inventory tools stay `get_*_inventory` / `get_*` for the inventory family (`get_route_inventory`, `get_schema_inventory`, `get_env_vars`, `get_external_packages`, `get_ui_components`, `get_middleware_inventory`) — they already form a consistent group; the audit should confirm consistency, not churn them.
- Resolve `get_decisions` vs `list_decisions`: one is canonical, the other becomes an alias. Default recommendation: keep `list_decisions` (it enumerates), make `get_decisions` an alias, because the rest of the decisions tools are verb-first and `list_*` matches the enumeration convention. The audit may override with a stated reason.
- Every rename ships with the old name retained as a working alias. **No hard breaks.**

### 3. The alias + deprecation mechanism

Add a small, explicit **alias map** in `src/cli/commands/mcp.ts`:

```ts
// old name -> canonical (current) tool name
const TOOL_ALIASES: Record<string, string> = {
  get_decisions: 'list_decisions',
  // ...one entry per rename/merge decided in the audit
};
```

Wire it at the single dispatch point where an incoming `CallTool` name is resolved to a handler:

- If the requested name is in `TOOL_ALIASES`, resolve to the canonical handler and run it normally.
- Attach a **one-time, additive deprecation marker** to that response (for example a `_deprecation: { alias, use, since }` field) so the model learns the new name without the call failing. Keep it additive and out of the way of spec-10's response contract — coordinate field naming with spec-10 if both touch the envelope.
- Aliases are **not** listed in `TOOL_DEFINITIONS` (so the catalog the model sees only shows canonical names), but they **are** accepted by the dispatcher (so wired-up clients keep working).
- A deprecation note also goes in `docs/mcp-tools.md` under each aliased name.

This is the only sanctioned result-shape change in this spec, and it is purely additive.

### 4. Tool annotations on every definition

Add an `annotations` object to every entry in `TOOL_DEFINITIONS`:

- **Read-only analysis tools** (the large majority): `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`, plus a short human `title`.
- **Mutating / artifact tools** — `record_decision`, `approve_decision`, `reject_decision`, `sync_decisions`, `generate_change_proposal`, `annotate_story`, `generate_tests` — set `readOnlyHint: false`. Set `destructiveHint` and `idempotentHint` per the actual behavior of each handler (for example `sync_decisions` writing specs is non-idempotent the first time; `approve_decision` flips a flag and is effectively idempotent once approved). Verify each against its handler before asserting a hint; do not guess.
- `openWorldHint`: `true` only for tools that reach outside the analyzed repo (none should today, since OpenLore is local static analysis — default `false` and justify any `true`).
- Keep annotations consistent with the read-only vs mutating split and with the descriptions.

### 5. Description rewrites (Anthropic best practice)

Rewrite each `description` to four beats, in order, kept tight:

1. **WHEN to use** — the trigger condition in the model's terms ("USE THIS WHEN ...").
2. **WHEN NOT to / instead use** — the boundary against the nearest overlapping tool ("For point-to-point tracing use `trace_execution_path`; for neighborhood exploration use this").
3. **What it returns** — the shape in one phrase.
4. **Cost/latency hint** — "fast, cached"; "may be slow at depth >= 3 on large repos"; "requires `analyze_codebase` first".

Reinforce the orient-first workflow: non-`orient` tools whose job `orient` partially covers should say so ("`orient` already returns this for a task; use this tool only when you need X specifically"). The existing descriptions are already partway there (see `orient`, `get_subgraph`, `trace_execution_path` in `mcp.ts`); bring all 45 to the same bar and sharpen the boundaries between overlapping tools.

### 6. Consolidation decisions

Make concrete calls, each with an alias so nothing breaks:

- **Search family:** decide whether `search_unified` is the canonical search entry and `search_code` / `search_specs` become documented presets (still listed, descriptions cross-referencing `search_unified`), or whether all three stay as first-class entry points with sharpened "when NOT to" boundaries. Either way, every description must tell the model which to reach for. If any merges, the merged-away name becomes an alias.
- **Decisions read:** collapse `get_decisions` / `list_decisions` to one canonical name + alias (per the naming rule above).
- **Context / orientation:** state clearly in `get_minimal_context` and `get_cluster` descriptions how they differ from `orient` and when the model should prefer `orient`. If one is strictly subsumed by `orient`, deprecate it via alias; otherwise keep with a sharp boundary.
- **Graph family:** keep `get_subgraph`, `analyze_impact`, `trace_execution_path`, `get_call_graph` if each answers a distinct question, and encode the distinction in descriptions (neighborhood vs impact-of-change vs point-to-point path vs global graph). If two are truly the same query with different defaults, merge to one + alias.

Document each decision and its rationale in the audit doc.

### 7. Keep docs in sync

`docs/mcp-tools.md` and the CLAUDE.md tool table are part of this PR's surface. After the code changes, update both so the documented names, descriptions, and the "when to use which" guidance match `TOOL_DEFINITIONS` exactly, including a clearly marked "Deprecated aliases" section listing each old -> new mapping.

## Files you will create or modify (approximate)

```
src/cli/commands/mcp.ts                 # annotations on every TOOL_DEFINITIONS entry; rewritten descriptions;
                                        #   TOOL_ALIASES map + dispatch resolution + one-time deprecation marker
docs/specs/mcp-tool-audit.md            # NEW: the audit matrix + naming rules + consolidation rationale
docs/mcp-tools.md                       # bring names/descriptions in sync; add "Deprecated aliases" section
CLAUDE.md                               # update the "when to use which tool" table to the final surface
src/cli/commands/mcp.test.ts            # (or co-located) alias resolution, deprecation marker, annotations present/correct,
                                        #   no duplicate or empty tool names, every definition has annotations
```

No handler logic files change — handlers keep their current behavior. Only the catalog (`TOOL_DEFINITIONS`), the dispatch alias resolution, and docs change.

## Acceptance criteria

1. `docs/specs/mcp-tool-audit.md` exists and has exactly one row per tool in the current set (all ~45), each with purpose, key inputs, overlaps-with, and a recommendation from {keep, merge, rename, deprecate, improve-description}.
2. Every entry in `TOOL_DEFINITIONS` has an `annotations` object with `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. A test asserts: annotations present on all entries; every tool in the mutating set has `readOnlyHint: false`; every other tool has `readOnlyHint: true`.
3. Every renamed or merged tool has its old name in `TOOL_ALIASES`. Calling an old name through the dispatcher resolves to the canonical handler, returns the same result as the canonical name for identical inputs, and includes a one-time additive deprecation marker. A test proves both the resolution and the marker.
4. No alias name appears in `TOOL_DEFINITIONS`; every canonical name does. A test asserts there are no duplicate names and no empty names/descriptions in `TOOL_DEFINITIONS`.
5. Every `description` follows the four-beat shape (WHEN to use / WHEN NOT to vs the overlapping tool / what it returns / cost-latency), and overlapping tools cross-reference each other by name. (Spot-checked in review against the audit doc; the search family, decisions read, context family, and graph family boundaries are explicit.)
6. Response internals, validation, timeouts, error handling, and protocol negotiation are **unchanged** — the only result-shape delta is the additive deprecation marker on aliased calls. Confirm no spec-10 / spec-12 surface was modified.
7. `docs/mcp-tools.md` and the CLAUDE.md tool table match `TOOL_DEFINITIONS` (names + intent), and both include a "Deprecated aliases" mapping.
8. `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build` all pass.

## Git workflow — read carefully

1. Branch `openlore-spec-11-mcp-tool-surface-audit` off the default branch.
2. Record the architectural decision before writing code (per the repo decision-gate workflow): *renames and consolidations are non-breaking — old names are retained as dispatcher aliases that resolve to the canonical handler and emit a one-time additive deprecation marker; `TOOL_DEFINITIONS` lists only canonical names + annotations.*
3. Open **exactly one PR** titled `spec-11: MCP tool surface audit & consolidation`. The body must link the committed `docs/specs/mcp-tool-audit.md` and summarize the renames/merges/deprecations and the annotation split.
4. All follow-up commits push to the same PR. Never open a second PR.
5. Coordinate the deprecation-marker field name with spec-10 if both are in flight, so the response envelope does not collide.
6. Run `lint`, `typecheck`, `test:run`, `build` before every push.

## When you are done

Reply with: PR URL, summary, follow-ups, files changed. Nothing else.

---

## Appendix — starter audit matrix (best-effort; refine against the real handlers)

| Tool | Purpose | Key inputs | Overlaps with | Recommendation |
|---|---|---|---|---|
| `orient` | One-call entry point: relevant functions, files, specs, call-paths, insertion points for a task | directory, task | get_minimal_context, get_cluster | keep (canonical entry) + improve-description |
| `analyze_codebase` | Build/refresh call graph, dep graph, refactor priorities (no LLM); cached | directory, force | detect_changes | keep |
| `get_architecture_overview` | Domain clusters, cross-cluster deps, entry points, hubs | directory | get_cluster, get_mapping | keep + improve-description |
| `get_refactor_report` | Prioritized refactor candidates from static metrics | directory | get_low_risk_refactor_candidates | keep |
| `get_call_graph` | Hubs, entry points, layer violations (global) | directory | get_subgraph, get_critical_hubs | keep + sharpen boundary |
| `get_duplicate_report` | Clone groups (type 1/2/3) | directory | — | keep |
| `get_signatures` | Compact function/class signatures | directory, filePattern | get_function_skeleton | keep + sharpen boundary |
| `get_subgraph` | Neighborhood around one function (up/down/both) | directory, functionName, direction, maxDepth | analyze_impact, trace_execution_path | keep (neighborhood) |
| `trace_execution_path` | All paths between two functions | directory, from, to | get_subgraph | keep (point-to-point) |
| `get_mapping` | Codebase map | directory | get_architecture_overview | keep or merge (audit) |
| `check_spec_drift` | Detect code/spec drift | directory | audit_spec_coverage | keep |
| `analyze_impact` | Blast radius of changing a symbol | directory, symbol | get_subgraph (upstream) | keep (impact framing) |
| `get_low_risk_refactor_candidates` | Safe refactor targets | directory | get_refactor_report | keep or merge (audit) |
| `get_leaf_functions` | Functions with no internal callees | directory | — | keep |
| `get_critical_hubs` | High fan-in functions | directory | get_call_graph | keep or merge (audit) |
| `get_function_skeleton` | Function structure without full body | directory, functionName | get_function_body, get_signatures | keep |
| `get_god_functions` | High fan-out orchestrators | directory | get_refactor_report | keep or merge (audit) |
| `suggest_insertion_points` | Where to add a feature | directory, task | orient | keep + cross-ref orient |
| `search_code` | Ranked code search | directory, query | search_unified, search_specs | keep-as-preset or merge (audit) |
| `list_spec_domains` | Enumerate spec domains | directory | get_spec | keep (canonical list_*) |
| `search_specs` | Ranked spec search | directory, query | search_unified, search_code | keep-as-preset or merge (audit) |
| `search_unified` | Ranked search across code + specs | directory, query | search_code, search_specs | keep (canonical search) |
| `get_spec` | Fetch one spec domain | directory, domain | list_spec_domains | keep |
| `get_function_body` | Full source of one function | directory, functionName | get_function_skeleton | keep |
| `get_file_dependencies` | Imports/dependents of a file | directory, file | get_subgraph | keep |
| `generate_change_proposal` | Produce an OpenSpec change proposal (artifact) | directory, ... | — | keep (mutating: readOnlyHint false) |
| `annotate_story` | Produce story annotations (artifact) | directory, ... | — | keep (mutating) |
| `get_decisions` | Read recorded decisions | directory | list_decisions | rename -> alias of list_decisions |
| `get_route_inventory` | HTTP routes | directory | — | keep |
| `get_middleware_inventory` | Middleware | directory | — | keep |
| `get_schema_inventory` | Data schemas/models | directory | — | keep |
| `get_ui_components` | UI components | directory | — | keep |
| `get_env_vars` | Environment variables | directory | get_external_packages | keep |
| `get_external_packages` | Third-party dependencies | directory | — | keep |
| `audit_spec_coverage` | Spec coverage gaps | directory | check_spec_drift | keep + sharpen boundary |
| `generate_tests` | Generate tests (artifact) | directory, target | — | keep (mutating) |
| `get_test_coverage` | Read test coverage | directory | — | keep |
| `get_minimal_context` | Minimal context for a target | directory, ... | orient, get_cluster | keep-with-boundary or deprecate (audit) |
| `get_cluster` | One domain cluster | directory, cluster | get_architecture_overview, orient | keep-with-boundary or merge (audit) |
| `detect_changes` | What changed since last analyze | directory | analyze_codebase | keep |
| `record_decision` | Record an architectural decision (mutating) | title, rationale, ... | — | keep (mutating) |
| `list_decisions` | Enumerate decisions | directory | get_decisions | keep (canonical) |
| `approve_decision` | Approve a decision (mutating) | id | — | keep (mutating) |
| `reject_decision` | Reject a decision (mutating) | id | — | keep (mutating) |
| `sync_decisions` | Write approved decisions into specs (mutating) | directory | — | keep (mutating) |
