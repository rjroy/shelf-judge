---
title: "Commission: Phase 4 Fix: Address Review Findings"
date: 2026-04-05
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Read Thorne's review of Phase 4 implementation. The review commission is commission-Thorne-20260405-121642. Check the commission result for findings.\n\nAddress ALL findings from the review. Fix every issue: route mismatches, missing validation, SSE format errors, DI wiring bugs, anything Thorne identified.\n\nAfter fixing, run `bun test` and confirm all tests pass."
dependencies:
  - commission-Thorne-20260405-121642
linked_artifacts:
  - packages/shared/src/validation.ts

  - packages/daemon/src/services/game-service.ts
  - packages/daemon/src/routes/import.ts
  - packages/daemon/src/routes/games.ts
  - packages/daemon/src/routes/scores.ts
  - packages/daemon/src/app.ts
  - packages/daemon/src/index.ts
  - packages/daemon/tests/helpers/test-app.ts
  - packages/daemon/tests/routes/games.test.ts
  - .lore/designs/mvp-api-surface.md
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/src/routes/import.ts
  - packages/daemon/src/routes/games.ts
  - packages/daemon/src/routes/scores.ts
  - packages/daemon/src/app.ts
  - packages/daemon/src/index.ts
  - packages/daemon/tests/helpers/test-app.ts
  - packages/daemon/tests/routes/games.test.ts
  - .lore/designs/mvp-api-surface.md
activity_timeline:
  - timestamp: 2026-04-05T19:16:47.050Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-05T19:22:19.171Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-05T20:31:41.018Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-05T20:31:41.020Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-05T20:31:41.030Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-05T20:31:47.052Z
    event: progress_report
    reason: "Reading Thorne's review commission to identify all findings."
  - timestamp: 2026-04-05T20:32:23.325Z
    event: progress_report
    reason: "All findings read. Now implementing fixes for F1-F5 and observations O1-O3."
  - timestamp: 2026-04-05T20:36:50.232Z
    event: result_submitted
    reason: "# Phase 4 Review Fixes: All Findings Addressed\n\n## Findings Fixed\n\n**F1: SSE progress writes not awaited** - Changed `onProgress` callback type to `(event) => Promise<void> | void` in both interface and implementation (`game-service.ts`). All `onProgress?.()` calls are now awaited in the service. The route handler's callback is now `async` and awaits `stream.writeSSE()` (`import.ts`).\n\n**F2: AddGameSchema requires name unconditionally** - Replaced the rigid schema with a `.refine()` union: `name` is now optional, and the schema validates that at least one of `name` or `bggId` is provided (`validation.ts`). Game service handles `parsed.name ?? \"\"` for bggId-only adds.\n\n**F3: POST /api/games response missing bggImported** - Added `bggImported: boolean` to `AddGameResult` interface and set it in the implementation: `true` when BGG data is successfully fetched, `false` otherwise (`game-service.ts`). Updated tests to verify the field.\n\n**F4: SSE progress imported field wrong value** - Added `importedSoFar: number` to `ImportProgressEvent`. The route now sends `event.importedSoFar` (actual count of imported games) instead of `event.current` (which was a progress counter including skipped items). The `current` field in the progress event was corrected to `skipped + i + 1` for consistent progress tracking.\n\n**F5: Import route API surface design drift** - Updated `mvp-api-surface.md` to show `POST /api/import/bgg` (body-based) instead of query parameter, matching the implementation and Technical Decision #7.\n\n## Observations Fixed\n\n**O1: Dead code in app factory** - Removed all fallback service creation logic from `createApp()`. `AppDeps` now requires `storageService`, `axisService`, and `gameService` (no optional fields for these). Removed unused imports of config resolution, service factories, and file-ops.\n\n**O2: bggNotConfiguredResponse bypasses Hono context** - Changed `bggNotConfiguredResponse()` to accept a `Context` parameter and use `c.json()` instead of `Response.json()`. All three call sites updated.\n\n**O3: Score list sort implicit coupling** - Added explicit `.sort((a, b) => b.score!.score - a.score!.score)` in the scores route so it doesn't depend on `listGames()` sort order.\n\n## Verification\n- 150 tests pass, 0 failures\n- TypeScript type check clean (zero errors)"
  - timestamp: 2026-04-05T20:36:55.255Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All findings read. Now implementing fixes for F1-F5 and observations O1-O3."
projectName: shelf-judge
---

# Phase 4 Review Fixes: All Findings Addressed

## Findings Fixed

**F1: SSE progress writes not awaited** - Changed `onProgress` callback type to `(event) => Promise<void> | void` in both interface and implementation (`game-service.ts`). All `onProgress?.()` calls are now awaited in the service. The route handler's callback is now `async` and awaits `stream.writeSSE()` (`import.ts`).

**F2: AddGameSchema requires name unconditionally** - Replaced the rigid schema with a `.refine()` union: `name` is now optional, and the schema validates that at least one of `name` or `bggId` is provided (`validation.ts`). Game service handles `parsed.name ?? ""` for bggId-only adds.

**F3: POST /api/games response missing bggImported** - Added `bggImported: boolean` to `AddGameResult` interface and set it in the implementation: `true` when BGG data is successfully fetched, `false` otherwise (`game-service.ts`). Updated tests to verify the field.

**F4: SSE progress imported field wrong value** - Added `importedSoFar: number` to `ImportProgressEvent`. The route now sends `event.importedSoFar` (actual count of imported games) instead of `event.current` (which was a progress counter including skipped items). The `current` field in the progress event was corrected to `skipped + i + 1` for consistent progress tracking.

**F5: Import route API surface design drift** - Updated `mvp-api-surface.md` to show `POST /api/import/bgg` (body-based) instead of query parameter, matching the implementation and Technical Decision #7.

## Observations Fixed

**O1: Dead code in app factory** - Removed all fallback service creation logic from `createApp()`. `AppDeps` now requires `storageService`, `axisService`, and `gameService` (no optional fields for these). Removed unused imports of config resolution, service factories, and file-ops.

**O2: bggNotConfiguredResponse bypasses Hono context** - Changed `bggNotConfiguredResponse()` to accept a `Context` parameter and use `c.json()` instead of `Response.json()`. All three call sites updated.

**O3: Score list sort implicit coupling** - Added explicit `.sort((a, b) => b.score!.score - a.score!.score)` in the scores route so it doesn't depend on `listGames()` sort order.

## Verification

- 150 tests pass, 0 failures
- TypeScript type check clean (zero errors)
