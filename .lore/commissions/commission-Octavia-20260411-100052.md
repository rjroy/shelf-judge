---
title: "Commission: Plan LLM narrative implementation"
date: 2026-04-11
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Use the `/lore-development:prep-plan` skill to create an implementation plan for the LLM narrative feature.\n\nThe issue is at `.lore/issues/actually-implement-the-llm-narrative.md`. Requirements are REQ-PROFILE-18 through REQ-PROFILE-28 in `.lore/specs/collection-profiling.md`. Key items:\n\n- REQ-PROFILE-18: Claude Agent SDK integration for natural-language narrative\n- REQ-PROFILE-19: Structured outputs with named sections (summary, surprises, tensions, blind spots)\n- REQ-PROFILE-20: In-process MCP tools for collection data access\n- REQ-PROFILE-21: Budget control (`maxBudgetUsd`)\n- REQ-PROFILE-22: Interpretation layer (surprises, tensions, blind spots, naming unnamed preferences)\n- REQ-PROFILE-23: LLM narrates scores, never determines them\n- REQ-PROFILE-26: Three-state narration cache (fresh, stale, empty)\n- REQ-PROFILE-27: Regeneration is always user-initiated\n- REQ-PROFILE-28: Agent SDK handles its own auth; Shelf Judge does not manage API keys\n\nRead the full spec, the existing profiling implementation, and the project architecture (CLAUDE.md) to ground the plan in reality. This is a daemon-side feature that the web and CLI will consume.\n\nOutput the plan to `.lore/plans/` following the prep-plan skill conventions."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-11T17:00:52.320Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T17:00:52.322Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
