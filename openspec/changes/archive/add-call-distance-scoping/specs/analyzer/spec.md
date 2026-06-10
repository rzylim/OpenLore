# analyzer spec delta

## ADDED Requirements

### Requirement: ConfidenceWeightedCallDistance

The analyzer SHALL expose a deterministic `callDistance` for each call edge, derived solely from the
edge's resolution confidence, and a weighted traversal that accumulates this distance. The metric
SHALL be a pure function of static analysis with no learned or stochastic component.

#### Scenario: Strongly resolved edges are nearer than heuristic ones

- **GIVEN** two callees of the same function, one reached by an `import`-resolved edge and one by a
  `name_only` edge
- **WHEN** call-distance is computed
- **THEN** the `import`-resolved callee has a strictly smaller distance than the `name_only` callee

#### Scenario: Weighted traversal reconstructs the cheapest path

- **GIVEN** a call graph with multiple paths between two functions
- **WHEN** `weightedBfs` runs from the source
- **THEN** each reached node carries its minimal accumulated distance, hop count, and a predecessor
  sufficient to reconstruct the cheapest path

### Requirement: MinimalContextScopedByNearestDistance

`get_minimal_context` SHALL select neighbors by nearest call-distance within a risk-derived distance
budget, rather than by a fixed neighbor count, and SHALL report each included neighbor's distance and
hop count.

#### Scenario: A tightly coupled two-hop chain is preferred over a weak direct neighbor

- **GIVEN** a target function with a weakly-resolved direct caller and a strongly-resolved caller two
  hops away, under a constrained budget
- **WHEN** `get_minimal_context` is invoked
- **THEN** the two-hop strongly-resolved chain is included and the weak direct caller is dropped, and
  each returned neighbor includes its `distance` and `hops`
