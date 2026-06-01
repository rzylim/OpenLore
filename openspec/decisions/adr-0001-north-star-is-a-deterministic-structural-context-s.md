# ADR-0001: North star is a deterministic structural context substrate for coding agents

## Status

accepted

**Domains**: overview

## Context

OpenLore is positioned as local-first plumbing (like tree-sitter/SCIP/LSP) that agents build on, not a breadth product; every capability is additive to the coding-agent use case and grounded in static analysis rather than LLM guessing (Spec 13).

## Decision

The system SHALL provide deterministic, locally-computed structural context as a substrate for coding agents, grounding all capabilities in static analysis rather than LLM inference.

## Consequences

Features must make the coding-agent case more useful or they do not ship; retrieval stays token-scoped and local-first.

> Recorded by openlore decisions on 2026-06-01
> Decision ID: c6d1ad07
