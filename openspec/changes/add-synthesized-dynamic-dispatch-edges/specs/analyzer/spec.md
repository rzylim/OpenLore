# analyzer spec delta

## ADDED Requirements

### Requirement: SynthesizedDynamicDispatchEdges

The system SHALL augment the directly-resolved call graph with a deterministic synthesis pass that
adds call edges for dynamic-dispatch patterns that direct name resolution cannot recover, deriving
each edge from statically-paired sites in the AST. The pass SHALL NOT use an LLM, SHALL run after
direct resolution, and SHALL only add edges — it SHALL NOT modify or remove any directly-resolved
edge. At minimum the pass SHALL recover:

- **Event channels** — an edge from a dispatch site (`emit(k)` / `dispatch(k)`) to every handler
  registered on the same channel key `k` (`on(k, fn)` / `addEventListener(k, fn)`), when the key is a
  static literal shared by both sites.
- **Route → handler** — an edge from a route node already detected by route inventory to the handler
  function the route binds.

The pass SHALL be structured as independent per-pattern rules so that each rule is testable in
isolation and adding a rule does not alter the output of existing rules.

#### Scenario: Event handler is reachable through a synthesized edge

- **GIVEN** a handler function registered with `on('mount', handler)` and a separate site calling
  `emit('mount')`, with no direct call to `handler`
- **WHEN** the call graph is built
- **THEN** a synthesized edge exists from the `emit('mount')` site's enclosing function to `handler`

#### Scenario: Route is wired to its handler

- **GIVEN** a route that route inventory detects and the handler function it binds
- **WHEN** the call graph is built
- **THEN** a synthesized `calls`-kind edge exists from the route node to the handler function

#### Scenario: Mismatched channel keys produce no edge

- **GIVEN** a handler registered with `on('open', handler)` and a dispatch site calling `emit('close')`
- **WHEN** the call graph is built
- **THEN** no synthesized edge is created between the dispatch site and `handler`

#### Scenario: Direct edges are unchanged by synthesis

- **GIVEN** a call graph built with the synthesis pass enabled and the same graph built with it disabled
- **WHEN** the two graphs are compared
- **THEN** every directly-resolved edge is identical in both, and the synthesis-enabled graph differs
  only by added edges

### Requirement: EdgeProvenanceLabeling

The system SHALL label every synthesized edge with a provenance distinct from directly-resolved
edges, by setting its `confidence` to `synthesized` and recording the rule that produced it in an
optional `synthesizedBy` property naming the pattern (for example `event-channel`, `route-handler`,
`callback-arg`). Directly-resolved edges SHALL retain their existing `confidence` value and SHALL NOT
carry `synthesizedBy`. A serialized call graph that predates this property SHALL load unchanged, with
absent `synthesizedBy` treated as a directly-resolved edge.

#### Scenario: Synthesized edge carries provenance

- **GIVEN** a synthesized event-channel edge
- **WHEN** the edge is inspected
- **THEN** its `confidence` is `synthesized` and its `synthesizedBy` names the producing rule

#### Scenario: Directly-resolved edge is distinguishable

- **GIVEN** a directly-resolved import edge
- **WHEN** the edge is inspected
- **THEN** its `confidence` is its resolution method (not `synthesized`) and it has no `synthesizedBy`

#### Scenario: Synthesized edges cost more in call distance

- **GIVEN** two paths from A to B, one entirely directly-resolved and one that traverses a synthesized edge
- **WHEN** call distance is computed for each path
- **THEN** the path traversing the synthesized edge has the greater total cost

### Requirement: HighPrecisionSynthesisBounds

The system SHALL bias edge synthesis toward false-negatives over false-positives: it SHALL emit an
edge only when a registration site and a dispatch site are statically paired on a shared key or
binding, and SHALL NOT fan a dispatch site out to functions it cannot pair. Per-channel handler
fan-out SHALL be capped by a fixed bound (default 8); a channel whose registered-handler count
exceeds the bound SHALL be dropped (no edges emitted for it) rather than partially or speculatively
wired, and the drop SHALL be logged with the channel key and count.

#### Scenario: Unpaired dispatch emits nothing

- **GIVEN** a dispatch site `emit('change')` with no statically-visible registration on `'change'`
- **WHEN** the synthesis pass runs
- **THEN** no synthesized edge is emitted for that dispatch site

#### Scenario: Over-cap channel is dropped, not guessed

- **GIVEN** a channel key with more registered handlers than the fan-out cap
- **WHEN** the synthesis pass runs
- **THEN** no synthesized edges are emitted for that channel and the drop is logged with the key and count

### Requirement: ProvenanceAwareReachability

The system SHALL prevent synthesized edges from manufacturing false dead-code positives while still
benefiting from them: a symbol reachable from a root only through one or more synthesized edges SHALL
NOT be reported as `high`-confidence dead by dead-code analysis. Such a symbol SHALL be reclassified
as reachable, or at minimum reported at `low` confidence with a reason that names the synthesizing
rule. A symbol reachable through at least one fully directly-resolved path is unaffected.

The system SHALL include synthesized edges by default when computing reachability, impact, subgraphs,
and paths, and SHALL provide an option to restrict traversal to directly-resolved edges only, so a
caller can trade completeness for certainty.

#### Scenario: Callback-only-reachable symbol is not high-confidence dead

- **GIVEN** a function reachable from an entry point only through a synthesized event-channel edge
- **WHEN** dead-code analysis runs
- **THEN** the function is not reported as `high`-confidence dead, and if reported at all it is `low`
  confidence with a reason naming the synthesizing rule

#### Scenario: Strict mode excludes synthesized edges

- **GIVEN** a traversal requested in directly-resolved-only mode
- **WHEN** reachability is computed
- **THEN** synthesized edges are not traversed and a symbol reachable only through them is treated as
  unreached
