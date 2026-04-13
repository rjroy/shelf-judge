---
title: "Commission: Previously Owned: Foundation (Phases 1-3)"
date: 2026-04-13
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 1-3 of the previously-owned feature.\n\n**Read these first:**\n- `.lore/plans/previously-owned.md` (the full plan — read Phases 1, 2, and 3 in detail)\n- `.lore/specs/previously-owned.md` (the spec — requirements REQ-PREV-1 through REQ-PREV-18)\n- `packages/shared/src/types.ts` (current Game type)\n- `packages/shared/src/schemas.ts` (Zod schemas)\n- `packages/daemon/src/services/game-service.ts` (game CRUD)\n- `packages/daemon/src/routes/games.ts` (route handlers)\n- `packages/web/lib/api.ts` (web client helpers)\n\n**Phase 1: Shared Types and Schema Default**\n- Add `OwnershipStatus` type and `ownership` field to `Game` in `types.ts`\n- Add Zod schema default for the field (`.default(\"owned\")`)\n- Set `ownership: \"owned\"` in `addGame` implementation\n- Tests: new game has `ownership: \"owned\"`, legacy data without field gets `\"owned\"` at parse time\n\n**Phase 2: Daemon API**\n- Add `setOwnership` method to game service\n- Add `PATCH /games/:id/ownership` endpoint\n- Add `ownership` query parameter to `GET /games` (values: `owned`, `previously-owned`, `all`; default: `owned`)\n- Filter previously-owned games from niche/redundancy computation at call sites (NOT inside engines)\n- The owned-only computation universe must be independent of the response filter (REQ-PREV-19)\n- Apply the filter to BOTH code paths in GET /games (standard and includePredicted)\n- Apply the filter in GET /games/:id as well (niche/redundancy computed against owned-only set)\n- Add operation definition for the new endpoint\n- All tests listed in the plan's Phase 2 section\n\n**Phase 3: Web Client Helpers**\n- Update `listGames` helper to accept `ownership` parameter\n- Add `setGameOwnership` helper\n- Export `OwnershipStatus` from shared type re-exports\n\n**Verification:** `bun run test`, `bun run typecheck`, `bun run lint` must all pass."
dependencies: []
linked_artifacts:
  - packages/shared/src/types.ts

  - packages/shared/src/index.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/src/services/storage-service.ts
  - packages/daemon/src/services/prediction-service.ts
  - packages/daemon/src/routes/games.ts
  - packages/web/lib/api.ts
  - packages/daemon/tests/ownership-routes.test.ts
  - packages/shared/src/index.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/src/services/storage-service.ts
  - packages/daemon/src/services/prediction-service.ts
  - packages/daemon/src/routes/games.ts
  - packages/web/lib/api.ts
  - packages/daemon/tests/ownership-routes.test.ts
activity_timeline:
  - timestamp: 2026-04-13T00:44:10.049Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T00:45:24.250Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-13T00:45:24.275Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-13T00:45:31.239Z
    event: progress_report
    reason: "Starting implementation. Reading plan, spec, and source files."
  - timestamp: 2026-04-13T00:46:40.561Z
    event: progress_report
    reason: "Context gathered. Starting Phase 1: adding OwnershipStatus type and ownership field to Game."
  - timestamp: 2026-04-13T00:53:50.181Z
    event: progress_report
    reason: "Phase 1 complete: OwnershipStatus type added, ownership field on Game, defaults in addGame/import/loadCollection, all 16 test fixtures updated. 1018 tests pass, typecheck clean. Starting Phase 2: daemon API."
  - timestamp: 2026-04-13T00:59:11.079Z
    event: progress_report
    reason: "Phase 2 complete: PATCH /games/:id/ownership endpoint, setOwnership service method, ownership query param on GET /games, owned-only niche/redundancy filtering at call sites in both GET /games paths and GET /games/:id. 18 new tests, all 1036 pass. Starting Phase 3: web client helpers."
  - timestamp: 2026-04-13T01:01:41.275Z
    event: result_submitted
    reason: "Phases 1-3 of the previously-owned feature are implemented and verified.\n\n**Phase 1: Shared Types and Schema Default**\n- Added `OwnershipStatus` type (\"owned\" | \"previously-owned\") and `ownership` field to `Game` in `types.ts`\n- Exported `OwnershipStatus` from shared `index.ts`\n- Set `ownership: \"owned\"` in `addGame` (game-service.ts) and BGG import path\n- Set `ownership: \"owned\"` in prediction-service.ts temp game construction\n- Added legacy data backfill in `loadCollection` (storage-service.ts): games without `ownership` field get \"owned\"\n- Updated all 16 test fixture `makeGame` helpers across the codebase to include `ownership: \"owned\"`\n\n**Phase 2: Daemon API**\n- Added `setOwnership(id, ownership)` method to `GameService` interface and implementation. Returns game unchanged (no updatedAt bump) when status matches current.\n- Added `PATCH /games/:id/ownership` endpoint with Zod validation. Returns `{ game }` on success, proper 400/404 errors.\n- Added `ownership` query parameter to `GET /games` (values: \"owned\", \"previously-owned\", \"all\"; default: \"owned\")\n- Ownership filter applied to BOTH code paths (standard and includePredicted) in GET /games\n- Niche/redundancy computation uses owned-only set regardless of response filter (REQ-PREV-19), filtering at call sites not inside engines (REQ-PREV-8, REQ-PREV-9)\n- GET /games/:id filters to owned-only for niche/redundancy computation; returns game regardless of ownership (REQ-PREV-18)\n- Added operation definition for `shelf.game.set-status`\n- 18 new tests in `ownership-routes.test.ts` covering: status change, reacquisition, invalid status (400), not found (404), idempotent no-op, data preservation, default/all/previously-owned filters, includePredicted path filtering, GET by id regardless of ownership, null nichePosition for prev-owned in ownership=all, fitness scores for prev-owned, prediction pool inclusion, redundancy consistency between default and all views, legacy data migration\n\n**Phase 3: Web Client Helpers**\n- Updated `listGames` to accept `ownership?: \"owned\" | \"previously-owned\" | \"all\"` parameter\n- Added `setGameOwnership(id, ownership)` helper using `PATCH` via `daemonJson`\n- Exported `OwnershipStatus` from shared type re-exports in `api.ts`\n\n**Verification**: `bun run typecheck`, `bun run lint`, and `bun test` (1036 pass, 0 fail) all clean."
  - timestamp: 2026-04-13T01:01:48.554Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Phase 2 complete: PATCH /games/:id/ownership endpoint, setOwnership service method, ownership query param on GET /games, owned-only niche/redundancy filtering at call sites in both GET /games paths and GET /games/:id. 18 new tests, all 1036 pass. Starting Phase 3: web client helpers."
projectName: shelf-judge
---
Phases 1-3 of the previously-owned feature are implemented and verified.

**Phase 1: Shared Types and Schema Default**
- Added `OwnershipStatus` type ("owned" | "previously-owned") and `ownership` field to `Game` in `types.ts`
- Exported `OwnershipStatus` from shared `index.ts`
- Set `ownership: "owned"` in `addGame` (game-service.ts) and BGG import path
- Set `ownership: "owned"` in prediction-service.ts temp game construction
- Added legacy data backfill in `loadCollection` (storage-service.ts): games without `ownership` field get "owned"
- Updated all 16 test fixture `makeGame` helpers across the codebase to include `ownership: "owned"`

**Phase 2: Daemon API**
- Added `setOwnership(id, ownership)` method to `GameService` interface and implementation. Returns game unchanged (no updatedAt bump) when status matches current.
- Added `PATCH /games/:id/ownership` endpoint with Zod validation. Returns `{ game }` on success, proper 400/404 errors.
- Added `ownership` query parameter to `GET /games` (values: "owned", "previously-owned", "all"; default: "owned")
- Ownership filter applied to BOTH code paths (standard and includePredicted) in GET /games
- Niche/redundancy computation uses owned-only set regardless of response filter (REQ-PREV-19), filtering at call sites not inside engines (REQ-PREV-8, REQ-PREV-9)
- GET /games/:id filters to owned-only for niche/redundancy computation; returns game regardless of ownership (REQ-PREV-18)
- Added operation definition for `shelf.game.set-status`
- 18 new tests in `ownership-routes.test.ts` covering: status change, reacquisition, invalid status (400), not found (404), idempotent no-op, data preservation, default/all/previously-owned filters, includePredicted path filtering, GET by id regardless of ownership, null nichePosition for prev-owned in ownership=all, fitness scores for prev-owned, prediction pool inclusion, redundancy consistency between default and all views, legacy data migration

**Phase 3: Web Client Helpers**
- Updated `listGames` to accept `ownership?: "owned" | "previously-owned" | "all"` parameter
- Added `setGameOwnership(id, ownership)` helper using `PATCH` via `daemonJson`
- Exported `OwnershipStatus` from shared type re-exports in `api.ts`

**Verification**: `bun run typecheck`, `bun run lint`, and `bun test` (1036 pass, 0 fail) all clean.
