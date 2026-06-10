# Enforce the conclusion-over-graph tool contract

## Why

OpenLore's value proposition is that the *server* does graph traversal so the *agent* never has to.
When a tool returns a raw node-and-edge list, it silently pushes the BFS back onto the model — the
exact failure mode (multi-hop context exhaustion, edge confabulation) the substrate exists to
prevent. Today this is an implicit convention, not a checked contract. `get_subgraph` (`json`
format) and `get_call_graph` legitimately emit raw topology; other tools should not, and there is no
guard preventing a future tool from regressing into a graph-dump shape.

This change makes "return a conclusion, not a graph" an explicit, testable tool-output contract and
audits the current surface against it.

## What changes

- A documented classification of every MCP tool as either **conclusion-shaped** (returns a path,
  ranked list, set, metric, or verdict) or **explicit-topology** (intentionally returns nodes/edges,
  e.g. `get_subgraph`, `get_call_graph`).
- A `mcp-quality` test that asserts each conclusion-shaped tool's response does **not** exceed a
  raw-edge budget and does **not** require the caller to join nodes to edges to extract the answer.
- A short authoring rule in the tool-quality spec that new tools must declare their class and, if
  conclusion-shaped, return the traversal *result* with at most a bounded provenance trail.

## Research basis

Follows the planning-research principle that the agent navigates a *sparse, pre-digested* structure,
not the raw graph (arXiv:2011.12491; see `openspec/changes/README.md`). The contract operationalizes
that principle as a regression guard.

## Application to OpenLore

- Reuses the existing `mcp-quality` spec domain and its test harness
  (`src/core/services/mcp-handlers/*.test.ts`).
- No tool behavior changes for already-compliant tools; the audit may shrink one or two responses
  that over-return topology.
- Establishes the invariant the other four proposals build on (their new tools must be
  conclusion-shaped by construction).

## Out of scope

- Rewriting `get_subgraph` / `get_call_graph` — these are explicitly allowed to return topology.
- Any change to transport, schema registration, or tool naming.
