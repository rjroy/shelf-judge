---
title: "Commission: Previously Owned: Review Foundation (Phases 1-3)"
date: 2026-04-13
status: pending
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the foundation implementation of the previously-owned feature (Phases 1-3).\n\n**Read these for context:**\n- `.lore/plans/previously-owned.md` (full plan, especially Phase 2 review attention points)\n- `.lore/specs/previously-owned.md` (requirements REQ-PREV-1 through REQ-PREV-18)\n\n**Review attention points from the plan:**\n1. The ownership filter and the niche/redundancy computation universe must be independently maintained. The response can include previously-owned games (`ownership=all`) while niche/redundancy always use owned-only. This is the most error-prone integration point.\n2. The `GET /games/:id` path fetches `allGames` and passes to niche/redundancy engines. Verify the owned-only filter is applied there too.\n3. Verify ownership filtering happens at call sites in `games.ts`, NOT inside `computeRedundancyAdjustments` or `computeNichePositions` (REQ-PREV-8, REQ-PREV-9).\n4. Verify `GET /games` default returns only owned games (backward compatibility, REQ-PREV-17).\n5. Verify test coverage matches the plan's Phase 2 test list.\n6. Verify both web client helpers cover the new endpoint.\n\n**Files to review:**\n- `packages/shared/src/types.ts`\n- `packages/shared/src/schemas.ts`\n- `packages/daemon/src/services/game-service.ts`\n- `packages/daemon/src/routes/games.ts`\n- `packages/daemon/tests/` (new ownership tests)\n- `packages/web/lib/api.ts`\n\nRun `bun run typecheck` and `bun run lint` if you have shell access. Record all findings."
dependencies:
  - commission-Dalton-20260412-174410
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-13T00:44:19.417Z
    event: created
    reason: "Commission created"
current_progress: ""
projectName: shelf-judge
---
