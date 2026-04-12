---
title: "Commission: Plan LLM narrative implementation"
date: 2026-04-11
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Use the `/lore-development:prep-plan` skill to create an implementation plan for the LLM narrative feature.\n\nThe issue is at `.lore/issues/actually-implement-the-llm-narrative.md`. Requirements are REQ-PROFILE-18 through REQ-PROFILE-28 in `.lore/specs/collection-profiling.md`. Key items:\n\n- REQ-PROFILE-18: Claude Agent SDK integration for natural-language narrative\n- REQ-PROFILE-19: Structured outputs with named sections (summary, surprises, tensions, blind spots)\n- REQ-PROFILE-20: In-process MCP tools for collection data access\n- REQ-PROFILE-21: Budget control (`maxBudgetUsd`)\n- REQ-PROFILE-22: Interpretation layer (surprises, tensions, blind spots, naming unnamed preferences)\n- REQ-PROFILE-23: LLM narrates scores, never determines them\n- REQ-PROFILE-26: Three-state narration cache (fresh, stale, empty)\n- REQ-PROFILE-27: Regeneration is always user-initiated\n- REQ-PROFILE-28: Agent SDK handles its own auth; Shelf Judge does not manage API keys\n\nRead the full spec, the existing profiling implementation, and the project architecture (CLAUDE.md) to ground the plan in reality. This is a daemon-side feature that the web and CLI will consume.\n\nOutput the plan to `.lore/plans/` following the prep-plan skill conventions."
dependencies: []
linked_artifacts:
  - .lore/plans/llm-narrative.md

activity_timeline:
  - timestamp: 2026-04-11T17:00:52.320Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T17:00:52.322Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-11T17:00:52.347Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-11T17:00:58.301Z
    event: progress_report
    reason: "Reading the issue, spec requirements, and existing profiling implementation to ground the plan."
  - timestamp: 2026-04-11T17:03:27.418Z
    event: progress_report
    reason: "Finished reading spec, Agent SDK research, and existing profiling implementation. Now checking plan conventions and existing artifacts before invoking prep-plan."
  - timestamp: 2026-04-11T17:04:14.669Z
    event: progress_report
    reason: "All context gathered. Invoking prep-plan skill to draft the implementation plan for LLM narrative."
  - timestamp: 2026-04-11T17:08:52.175Z
    event: progress_report
    reason: "Plan drafted and reviewed. Addressing three findings from fresh-context review: NarrationEmpty component conflict, utility curve coverage gap, and MCP API verification step."
  - timestamp: 2026-04-11T17:10:57.872Z
    event: result_submitted
    reason: "Created implementation plan at `.lore/plans/llm-narrative.md` for the LLM narrative feature (REQ-PROFILE-18 through REQ-PROFILE-28, REQ-PROFILE-34).\n\n**Plan structure**: 5 phases across all four workspace packages.\n\n- **Phase 1**: Types and cache state (shared types + daemon storage). Foundation phase, no SDK dependency.\n- **Phase 2**: Agent SDK integration (narration service). Starts with API verification step. In-process MCP tools, structured outputs, budget control.\n- **Phase 3**: Daemon route wiring. `POST /api/profile/narrate` endpoint. Profile service gains `generateNarration()`.\n- **Phase 4**: CLI + Web client updates in one change. Replaces existing `NarrationEmpty` stub component. First client component with POST mutation pattern in web package.\n- **Phase 5**: Integration tests, requirement traceability, fresh-context review.\n\n**7 technical decisions** documented: query() over ClaudeSDKClient, two MCP tools, structured output schema (5 sections including curveInsights), cache-in-ProfileData, $0.05 budget default, Sonnet model, system prompt design with utility curve directives.\n\n**Review findings addressed**: Added `curveInsights` field for REQ-PROFILE-22 utility curve connection, made MCP API verification the explicit first step of Phase 2, documented NarrationEmpty component conflict in Phase 4, clarified key-present-but-invalid auth handling, fixed staleness test description accuracy."
  - timestamp: 2026-04-11T17:11:02.033Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Plan drafted and reviewed. Addressing three findings from fresh-context review: NarrationEmpty component conflict, utility curve coverage gap, and MCP API verification step."
projectName: shelf-judge
---
Created implementation plan at `.lore/plans/llm-narrative.md` for the LLM narrative feature (REQ-PROFILE-18 through REQ-PROFILE-28, REQ-PROFILE-34).

**Plan structure**: 5 phases across all four workspace packages.

- **Phase 1**: Types and cache state (shared types + daemon storage). Foundation phase, no SDK dependency.
- **Phase 2**: Agent SDK integration (narration service). Starts with API verification step. In-process MCP tools, structured outputs, budget control.
- **Phase 3**: Daemon route wiring. `POST /api/profile/narrate` endpoint. Profile service gains `generateNarration()`.
- **Phase 4**: CLI + Web client updates in one change. Replaces existing `NarrationEmpty` stub component. First client component with POST mutation pattern in web package.
- **Phase 5**: Integration tests, requirement traceability, fresh-context review.

**7 technical decisions** documented: query() over ClaudeSDKClient, two MCP tools, structured output schema (5 sections including curveInsights), cache-in-ProfileData, $0.05 budget default, Sonnet model, system prompt design with utility curve directives.

**Review findings addressed**: Added `curveInsights` field for REQ-PROFILE-22 utility curve connection, made MCP API verification the explicit first step of Phase 2, documented NarrationEmpty component conflict in Phase 4, clarified key-present-but-invalid auth handling, fixed staleness test description accuracy.
