# ADR-0002: MCP conclusion-over-graph output contract

## Status

accepted

**Domains**: mcp-quality

## Context

Make the implicit "server does traversal, agent gets a conclusion" convention an explicit, CI-checked invariant. Every dispatched MCP tool is classified in a typed TOOL_OUTPUT_CLASS table as 'conclusion' or 'explicit-topology'. A predicate assertConclusionShape flags a conclusion tool only when it (a) returns a top-level array of id-reference edge objects ({from,to} or {callerId,calleeId}) longer than MAX_PROVENANCE_EDGES (25), or (b) returns both a top-level nodes[] and edges[] requiring a join to extract the answer. The id-reference edge shape — not resolved {caller,callee} name-pairs — is the deliberate discriminator: it targets graphs the agent must traverse/join, while leaving self-describing resolved edge changelogs (e.g. structural_diff's {caller,callee,file} added/removed list) compliant. A completeness test cross-checks the table against the exported TOOL_DEFINITIONS so any future tool that omits a class fails CI. Tests are synthetic/deterministic rather than invoking handlers against .openlore/analysis because that fixture is gitignored and unavailable in CI.

## Decision

The system SHALL classify every MCP tool as 'conclusion' or 'explicit-topology' and enforce via CI that conclusion tools do not return raw id-reference edge graphs or unjoined nodes[]+edges[] payloads.

## Consequences

Two tools are classified explicit-topology and exempt from the predicate: get_subgraph (true nodes[]+edges[] dump) and get_call_graph (graph-level summary; kept explicit-topology to preserve the spec's two-graph-tools model even though it currently returns bounded lists). All other 48 tools are conclusion and already comply — zero existing handler outputs change. New tools must add a TOOL_OUTPUT_CLASS entry or the contract test fails. The predicate intentionally does not flag resolved {caller,callee} name-pair arrays, so a hypothetical future resolved-adjacency dump without a node table would pass; this boundary is documented in tool-contract.ts.

> Recorded by openlore decisions on 2026-06-08
> Decision ID: 4b88176d
