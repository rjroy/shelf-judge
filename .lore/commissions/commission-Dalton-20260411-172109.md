---
title: "Commission: Implement LLM narrative (Phases 1-4)"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement the LLM narrative feature following the plan at `.lore/plans/llm-narrative.md`. Read the full plan before starting, including all technical decisions and cross-cutting concerns.\n\nThis is a 4-phase implementation. Execute Phases 1 through 4 sequentially.\n\n## Phase 1: Types and Cache State\n- Add `ProfileNarration`, `NarrationCacheState` types to `packages/shared/src/types.ts`\n- Extend `CollectionProfile` with `narration` and `narrationState` fields\n- Extend `ProfileData` with `narration` and `narrationComputedAt` fields\n- Implement cache state derivation in `profile-service.ts` (fresh/stale/empty logic)\n- Unit tests on cache state transitions\n\n## Phase 2: Agent SDK Integration\n- **CRITICAL**: Install `@anthropic-ai/claude-agent-sdk@latest` first and verify the API surface (query(), outputFormat, MCP tool registration with Zod) before writing code. Do not rely on stale research docs.\n- Create `packages/daemon/src/services/narration-service.ts` with `createNarrationService(deps)` factory\n- Implement `generateNarration()` using `query()` one-shot (not persistent sessions)\n- Register two in-process MCP tools: `get_collection_games` and `get_profile_detail`\n- System prompt per decision 7 (narrate only, never determine scores, trace claims to data)\n- `maxBudgetUsd: 0.05`, `maxTurns: 10`, model `sonnet`\n- `isAvailable()` checks `ANTHROPIC_API_KEY` presence\n- Wire into `index.ts` and `app.ts`\n- Unit tests with SDK mocked at `query()` boundary\n\n## Phase 3: Daemon Route and Profile Service Wiring\n- Add `generateNarration()` to profile service interface\n- Add `POST /api/profile/narrate` endpoint (200/503/502 responses)\n- Update existing `GET /api/profile` to include narration fields\n- Route-level tests covering all response codes and staleness transitions\n\n## Phase 4: CLI and Web Client Updates\n- CLI: Add `generateNarration()` to `client.ts`, `narrate` subcommand to `profile.ts`, register in `index.ts`\n- Web: Add `generateNarration()` to `lib/api.ts`\n- Web: Replace existing `NarrationEmpty` stub component with full narration section (fresh/stale/empty states, generate/regenerate button as client component)\n- Update `app/page.tsx` import\n- CLI tests with mocked client responses\n\n## Cross-cutting reminders from the plan\n- Narration NEVER affects scores (read-only agent, no write MCP tools)\n- Auth is external via `ANTHROPIC_API_KEY` env var, daemon does not manage it\n- Update BOTH web `lib/api.ts` AND CLI `client.ts` in the same phase to prevent divergence\n- `NarrationEmpty` component already exists at `packages/web/components/profile/narration-empty.tsx`, used in `app/page.tsx` line 71\n\n## Verification\n- `bun run typecheck` must pass\n- `bun run lint` must pass\n- `bun run test` must pass\n- Verify each REQ-PROFILE (18-28, 34) is addressed per the traceability checklist in Phase 5 of the plan"
dependencies: []
linked_artifacts: []

resource_overrides:
  model: opus

activity_timeline:
  - timestamp: 2026-04-12T00:21:09.161Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T00:21:09.163Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
