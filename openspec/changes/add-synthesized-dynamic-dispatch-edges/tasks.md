# Tasks — Synthesized dynamic-dispatch edges with provenance

Ordered so each step is independently verifiable. Call `record_decision` before writing code for
step 1 (it extends a core data structure — `EdgeConfidence` / `CallEdge`).

> **Implementation status (PR: feat/synthesized-dynamic-dispatch-edges):** ALL steps (1–6) done.
> - §1: `EdgeConfidence` gains `'synthesized'`; `CallEdge` gains `synthesizedBy?`; `CALL_DISTANCE_COSTS`
>   + `callDistance` give synthesized a strictly-higher cost (4) than any directly-resolved confidence.
> - §2–4: a deterministic post-resolution pass (`synthesizeDynamicDispatchEdges` in `call-graph.ts`,
>   run as build Pass 2d) with two independent rules — **event-channel** (`on/once/addListener/
>   addEventListener` ↔ `emit/dispatch` on a shared static-literal key, cross-file, fan-out capped at 8
>   with over-cap channels dropped + logged) and **route-handler** (reuses the existing route extractors,
>   wiring each route's enclosing function to its handler). Decision recorded: `1f1af089`.
> - §5: synthesized edges are traversed by default (so handlers stop being false-dead — the
>   `reachability.ts` HONEST-LIMITS false positive is retired); a `directResolvedOnly` strict mode is
>   threaded through `buildAdjacency`/`bfsFromDB` to `find_dead_code`, `analyze_impact`, `get_subgraph`,
>   `find_path`, and `select_tests`; a candidate reached only via a synthesized edge is downgraded to
>   `low` with the rule named.
> - §6: regression suites + a real-analyze e2e (through the compiled CLI) pass.
>
> Tests: `edge-synthesis.test.ts` (rules, provenance, fan-out cap, cross-file, route→handler),
> `reachability-synthesis.test.ts` (no false dead, strict mode, downgrade), `call-graph.test.ts`
> (distance exhaustiveness + synthesized > direct). No MCP tool added; default/minimal surface
> unchanged in size.

## 1. Provenance on the edge model
- [ ] Add `'synthesized'` to `EdgeConfidence` (`call-graph.ts:30`) and `synthesizedBy?: string` to
      `CallEdge` (`call-graph.ts:106-118`).
- [ ] Add a `'synthesized'` arm to `CALL_DISTANCE_COSTS` (`call-graph.ts:100`) with a cost strictly
      greater than any directly-resolved confidence, and an exhaustive switch arm in `callDistance`
      (`call-graph.ts:125`). → verify: `call-graph.test.ts` exhaustiveness test stays green.
- [ ] Confirm graph serialization round-trips edges with and without `synthesizedBy`.

## 2. Synthesis pass scaffold
- [ ] Add a deterministic post-resolution pass that runs after direct edges are built, structured as
      a registry of independent per-pattern rules. → verify: pass is a no-op when no patterns match
      (directly-resolved graph byte-identical).

## 3. Event-channel rule
- [ ] Pair `on(k, fn)` / `addEventListener(k, fn)` registrations with `emit(k)` / `dispatch(k)`
      dispatch sites on a shared static-literal key; emit edges dispatcher → each handler, tagged
      `synthesizedBy: 'event-channel'`. → verify: scenarios "Event handler is reachable", "Mismatched
      channel keys produce no edge".
- [ ] Enforce the fan-out cap (default 8); drop + log over-cap channels. → verify: "Over-cap channel
      is dropped, not guessed".

## 4. Route → handler rule
- [ ] Wire each route detected by route inventory to its bound handler as a `calls`-kind edge tagged
      `synthesizedBy: 'route-handler'`. → verify: "Route is wired to its handler".

## 5. Reachability & traversal provenance
- [ ] In `reachability.ts`, exclude synthesized-only-reachable nodes from `high`-confidence dead
      (reclassify reachable or downgrade to `low` with rule-named reason). → verify:
      "Callback-only-reachable symbol is not high-confidence dead"; retire the matching false-positive
      called out in the `reachability.ts` header.
- [ ] Add a directly-resolved-only traversal option to reachability, `analyze_impact`, `select_tests`,
      `get_subgraph`, `find_path`; default includes synthesized edges. → verify: "Strict mode excludes
      synthesized edges".

## 6. Regression & docs
- [ ] Run the analyzer + mcp-handlers suites: `npx vitest run src examples`.
- [ ] Update the `reachability.ts` HONEST LIMITS comment to note that callback/event/route dispatch is
      now partially recovered (single-language, statically-paired) and which limits remain (reflection,
      computed dispatch, cross-language).
