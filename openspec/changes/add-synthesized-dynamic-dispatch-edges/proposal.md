# Synthesized dynamic-dispatch edges with provenance

> Status: DRAFT — proposal + spec delta for the next unit of work. No code yet.
> One sentence: **close the call-graph's dynamic-dispatch blind spots with deterministic,
> provenance-labeled edges so reachability, impact, and test selection stop being wrong about
> callbacks, events, and framework routing.**

## Why

OpenLore's north star is *deterministic, locally-computed structural context as a substrate for
coding agents, grounded in static analysis rather than LLM inference* (`overview/spec.md`, decision
`c6d1ad07`). Every downstream conclusion — `find_dead_code`, `select_tests`, `analyze_impact`,
`get_subgraph`, `find_path` — is only as complete as the call graph underneath it. Today that graph
is built purely by **direct name resolution**: an edge exists when a call site names a callee that
resolves to a node (`EdgeConfidence` is entirely resolution-method labels — `import`,
`type_inference`, `same_file`, `name_only`, with one cross-language exception, `http_endpoint`;
`call-graph.ts:30-38`).

That misses every call that does not flow through a directly-named callee. The reachability engine
already confesses the gap in its own header:

> *"HONEST LIMITS — Dynamic entry points, framework magic (routes, DI, plugin registries),
> reflection, and externally-consumed public exports all produce false 'dead' positives."*
> (`src/core/services/mcp-handlers/reachability.ts`)

Concretely, the call graph is blind to:

- **Callback / observer dispatch.** A handler registered with `emitter.on('mount', onMount)` and
  fired by `emitter.emit('mount')` has no edge from the emit site to `onMount`. The handler looks
  unreachable.
- **Framework route → handler.** A route bound to a controller method through a decorator, a
  registration table, or a file-based router has no caller in the graph. `get_route_inventory`
  already *finds* these routes — but the route is not wired to its handler as a call edge, so
  reachability still treats the handler as dead.
- **Registry / plugin / DI dispatch.** A function placed in a lookup table or resolved by an
  injection container and invoked indirectly has no naming call site.

The cost is not abstract. `find_dead_code` reports these live functions as **candidate-dead with
`high` confidence**, `select_tests` omits tests that only reach the changed code through a callback,
and `analyze_impact` under-counts blast radius across the same edge. The graph is confidently
incomplete, and the agent has no signal that a given conclusion sits on top of a known blind spot.

### Why OpenLore specifically can fix this, and stay honest

These edges are recoverable **deterministically from the AST** — a registration site plus a dispatch
site is a structural pattern, not an inference. The discipline that keeps this on-mission is the
same one the navigation set adopted (`changes/README.md`, "labeled signals, not a blended score"):
a synthesized edge is **never silently mixed into the directly-resolved graph**. It carries its own
provenance (`confidence: 'synthesized'`) and the name of the rule that produced it
(`synthesizedBy`), so every consumer — and every agent reading a result — can see exactly which
conclusions lean on a heuristic and which rest on direct resolution. No LLM is involved at any step;
synthesis is pattern-matching over the same tree-sitter trees the graph is already built from.

## What changes

1. **A synthesis pass over the existing graph.** After direct resolution completes, a new
   deterministic pass adds edges for dynamic-dispatch patterns it can prove from AST structure:
   - **Event channels** — pair `on('x', fn)` / `addEventListener('x', fn)` registrations with
     `emit('x')` / `dispatch('x')` sites *on the same channel literal*, edge from the dispatcher to
     each registered handler.
   - **Callback registration** — a value passed as a callback argument to a registrar, paired with
     the registrar's later invocation of its stored callback, when both sites are statically visible.
   - **Route → handler** — wire each route node `get_route_inventory` already detects to the handler
     function it binds, as a `calls`-kind edge from the route to the handler.
   Each pattern is a separate, independently-testable rule; the pass is additive and order-independent
   with respect to existing resolution.

2. **Provenance becomes a first-class edge property.** Extend `EdgeConfidence` with `'synthesized'`
   and add an optional `synthesizedBy?: string` to `CallEdge` (`call-graph.ts:106-118`) naming the
   rule (e.g. `'event-channel'`, `'route-handler'`, `'callback-arg'`). Direct edges are untouched and
   carry no `synthesizedBy`. `CALL_DISTANCE_COSTS` (`call-graph.ts:100`) gains a deliberately
   *higher* cost for `'synthesized'` so `find_path` and call-distance scoping prefer a directly-resolved
   path when one exists.

3. **High-precision bounds, not best-effort.** Synthesis only emits an edge when a registration site
   and a dispatch site are statically paired on a shared key; it SHALL NOT fan an emit out to every
   function in the file. Per-channel handler fan-out is capped (default 8) and over-cap channels
   (typically generic names like `'error'`, `'change'`) are dropped rather than guessed, with the
   drop logged. The bias is false-negatives over false-positives: a missed dynamic edge is the
   status quo; a fabricated edge would poison every downstream conclusion.

4. **Reachability and impact honor provenance.** `find_dead_code` SHALL NOT report a symbol that is
   reachable from a root *only through synthesized edges* as `high`-confidence dead — it is
   reclassified as live, or at minimum downgraded to `low` confidence with the reason naming the
   synthesizing rule (this directly retires the false-positive its header documents). `analyze_impact`,
   `select_tests`, `get_subgraph`, and `find_path` SHALL include synthesized edges by default and
   SHALL expose an option to restrict traversal to directly-resolved edges, so an agent can ask for
   the strict graph when it wants certainty over completeness.

## What does NOT change

- **No LLM anywhere in the synthesis or provenance path.** Patterns are AST-structural; the north
  star (`overview/spec.md`, `c6d1ad07`) is preserved.
- **No new tuning score or threshold.** A synthesized edge either has a statically-paired
  registration+dispatch or it is not emitted — the only constant is a fan-out cap, which *drops*
  rather than scores. This mirrors the memory-staleness set's "boolean inputs, no weighted score"
  discipline.
- **No new MCP tool, and no change to the default or `minimal` tool surface.** This enriches the
  graph that existing tools already read; it adds zero tools to consider, consistent with the
  `mcp-quality` "minimize tools an agent must consider" requirement.
- **Direct-resolution edges are byte-for-byte unchanged.** Synthesis only *adds* edges; existing
  edges keep their existing `confidence`. Serialized graphs without `synthesizedBy` load unchanged.
- **No new external dependency, service, or network call.** Synthesis runs over trees OpenLore
  already parses.

## Research basis

This applies the navigation set's governing principle (`changes/README.md`) to graph *construction*
rather than traversal: the server computes a structural conclusion deterministically and labels its
provenance so the agent never has to guess whether an edge is real. A synthesized edge is the
edge-construction analogue of a `drifted` freshness verdict — a deterministic signal that says
"this is grounded, and here is exactly how grounded it is."

## Application to OpenLore

- **Route → handler** reuses the route detection already feeding `get_route_inventory`
  (`get_route_inventory` handler / route inventory) — this change wires the detected route to its
  handler node as an edge; it does not add route detection.
- **Provenance** extends the existing `EdgeConfidence` union and `CALL_DISTANCE_COSTS` map rather
  than introducing a parallel edge type; `callDistance` (`call-graph.ts:125`) gains one exhaustive
  switch arm.
- **Reachability** reuses `reachability.ts`'s mark-and-sweep; the only change is that a node reached
  solely via `confidence: 'synthesized'` edges is excluded from `high`-confidence dead, closing the
  false-positive its header already names.

## Out of scope

- **Cross-language bridging** (e.g. native ↔ scripting selector mapping). Valuable, but a much larger
  surface; this change stays within single-language dynamic dispatch where the registration and
  dispatch sites are both visible.
- **Reflection and string-built dispatch** (`obj[methodName]()` where `methodName` is computed at
  runtime). Not statically pairable; remains a documented blind spot, not a guessed edge.
- **A confidence-weighted ranking of synthesized edges.** Provenance is a label, not a score; an
  edge is synthesized or it is not.
- **Changing how routes are detected.** This consumes existing route detection; it does not extend it.
