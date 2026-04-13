---
title: "Commission: Previously Owned: Foundation (Phases 1-3)"
date: 2026-04-13
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 1-3 of the previously-owned feature.\n\n**Read these first:**\n- `.lore/plans/previously-owned.md` (the full plan — read Phases 1, 2, and 3 in detail)\n- `.lore/specs/previously-owned.md` (the spec — requirements REQ-PREV-1 through REQ-PREV-18)\n- `packages/shared/src/types.ts` (current Game type)\n- `packages/shared/src/schemas.ts` (Zod schemas)\n- `packages/daemon/src/services/game-service.ts` (game CRUD)\n- `packages/daemon/src/routes/games.ts` (route handlers)\n- `packages/web/lib/api.ts` (web client helpers)\n\n**Phase 1: Shared Types and Schema Default**\n- Add `OwnershipStatus` type and `ownership` field to `Game` in `types.ts`\n- Add Zod schema default for the field (`.default(\"owned\")`)\n- Set `ownership: \"owned\"` in `addGame` implementation\n- Tests: new game has `ownership: \"owned\"`, legacy data without field gets `\"owned\"` at parse time\n\n**Phase 2: Daemon API**\n- Add `setOwnership` method to game service\n- Add `PATCH /games/:id/ownership` endpoint\n- Add `ownership` query parameter to `GET /games` (values: `owned`, `previously-owned`, `all`; default: `owned`)\n- Filter previously-owned games from niche/redundancy computation at call sites (NOT inside engines)\n- The owned-only computation universe must be independent of the response filter (REQ-PREV-19)\n- Apply the filter to BOTH code paths in GET /games (standard and includePredicted)\n- Apply the filter in GET /games/:id as well (niche/redundancy computed against owned-only set)\n- Add operation definition for the new endpoint\n- All tests listed in the plan's Phase 2 section\n\n**Phase 3: Web Client Helpers**\n- Update `listGames` helper to accept `ownership` parameter\n- Add `setGameOwnership` helper\n- Export `OwnershipStatus` from shared type re-exports\n\n**Verification:** `bun run test`, `bun run typecheck`, `bun run lint` must all pass."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-13T00:44:10.049Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T00:45:24.250Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
