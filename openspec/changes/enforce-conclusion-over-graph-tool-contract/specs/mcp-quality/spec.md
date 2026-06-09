# mcp-quality spec delta

## ADDED Requirements

### Requirement: ToolsReturnConclusionsNotGraphs

Every MCP tool SHALL be classified as either `conclusion` (returns a path, ranked list, set, metric,
or verdict that directly answers the query) or `explicit-topology` (intentionally returns a
node-and-edge graph). Conclusion tools SHALL NOT require the caller to traverse a returned graph to
extract the answer, and SHALL bound any included edge provenance to a small fixed limit.

#### Scenario: Conclusion tool returns a direct answer

- **GIVEN** a tool classified `conclusion` (e.g. `trace_execution_path`, `analyze_impact`,
  `select_tests`, `get_minimal_context`)
- **WHEN** the tool is invoked
- **THEN** the response contains the answer field directly (the path chain, the ranked list, the
  metric) and contains no top-level edge array larger than `MAX_PROVENANCE_EDGES`

#### Scenario: Explicit-topology tools are the only graph emitters

- **GIVEN** the tool classification table
- **WHEN** the set of `explicit-topology` tools is read
- **THEN** it equals exactly `{ get_subgraph, get_call_graph }`, and any other tool emitting raw
  topology is a contract violation surfaced by the regression test

#### Scenario: New tool must declare its class

- **GIVEN** a newly dispatched tool name
- **WHEN** the contract test runs
- **THEN** the test fails if the tool has no entry in the classification table, forcing the author to
  declare `conclusion` or `explicit-topology`
