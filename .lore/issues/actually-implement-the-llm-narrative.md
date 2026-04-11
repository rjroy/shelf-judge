---
title: "Actually Implement the LLM Narrative"
date: 2026-04-11
status: resolved
tags: [feature, llm, profiling, agent-sdk]
---

The LLM narrative in `.lore/specs/collection-profiling.md` was deferred during collection profiling planning.

Requirements are REQ-PROFILE-18 through REQ-PROFILE-28 in the collection profiling spec. Key items:

- REQ-PROFILE-18: Claude Agent SDK integration for natural-language narrative
- REQ-PROFILE-19: Structured outputs with named sections (summary, surprises, tensions, blind spots)
- REQ-PROFILE-20: In-process MCP tools for collection data access
- REQ-PROFILE-21: Budget control (`maxBudgetUsd`)
- REQ-PROFILE-22: Interpretation layer (surprises, tensions, blind spots, naming unnamed preferences)
- REQ-PROFILE-23: LLM narrates scores, never determines them
- REQ-PROFILE-26: Three-state narration cache (fresh, stale, empty)
- REQ-PROFILE-27: Regeneration is always user-initiated
- REQ-PROFILE-28: Agent SDK handles its own auth; Shelf Judge does not manage API keys
