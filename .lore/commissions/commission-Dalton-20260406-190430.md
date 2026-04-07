---
title: "Commission: Fix: Consolidate Duplicated Web/Daemon Types into Shared Package"
date: 2026-04-07
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Fix the issue described in `.lore/issues/duplicated-web-daemon-types.md`.\n\n**Problem:** `packages/web/lib/api.ts` independently defines interfaces that mirror daemon types: `GameWithScore`, `AddGameResult`, `ImportProgress`, `ImportComplete`, `BggSearchResult`. These duplicate the daemon's versions in `packages/daemon/src/services/game-service.ts`. If response shapes change, the web types silently drift.\n\n**Task:**\n1. Read both files to understand the current type definitions on each side.\n2. Move the shared types into `packages/shared/` (that workspace exists for exactly this purpose). Follow existing patterns in `packages/shared/` for how types are organized and exported.\n3. Update `packages/daemon/` to import from shared instead of defining locally.\n4. Update `packages/web/lib/api.ts` to import from shared instead of defining locally.\n5. SSE event shapes (`ImportProgress`, `ImportComplete`) should also be shared so the frontend parser and daemon emitter stay in sync.\n6. Grep the entire codebase for any other imports of the old type locations and update them.\n7. Run `bun run typecheck`, `bun run lint`, and `bun run test` to verify nothing broke.\n8. Update the issue file status to `resolved` when complete."
dependencies: []
linked_artifacts:
  - packages/shared/src/types.ts

  - packages/shared/src/index.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/src/services/bgg-xml-parser.ts
  - packages/daemon/src/services/bgg-client.ts
  - packages/daemon/src/services/tournament-service.ts
  - packages/web/lib/api.ts
  - packages/web/app/import/page.tsx
  - packages/cli/src/commands/import.ts
  - packages/daemon/tests/tournament-service.test.ts
  - packages/daemon/tests/routes/games.test.ts
  - packages/daemon/tests/integration/end-to-end.test.ts
  - .lore/issues/duplicated-web-daemon-types.md
  - packages/shared/src/index.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/src/services/bgg-xml-parser.ts
  - packages/daemon/src/services/bgg-client.ts
  - packages/daemon/src/services/tournament-service.ts
  - packages/web/lib/api.ts
  - packages/web/app/import/page.tsx
  - packages/cli/src/commands/import.ts
  - packages/daemon/tests/tournament-service.test.ts
  - packages/daemon/tests/routes/games.test.ts
  - packages/daemon/tests/integration/end-to-end.test.ts
  - .lore/issues/duplicated-web-daemon-types.md
activity_timeline:
  - timestamp: 2026-04-07T02:04:30.944Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T02:04:30.946Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-07T02:04:30.967Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-07T02:04:42.492Z
    event: progress_report
    reason: "Starting work: reading the issue file and both source files to understand current type definitions."
  - timestamp: 2026-04-07T02:05:51.570Z
    event: progress_report
    reason: "Analysis complete. Adding 5 shared types (GameWithScore, AddGameResult, BggSearchResult, ImportProgress, ImportComplete) to packages/shared, then updating all consumers across daemon, web, and CLI."
  - timestamp: 2026-04-07T02:10:23.249Z
    event: result_submitted
    reason: "Consolidated 5 duplicated types into `packages/shared/src/types.ts`:\n\n- `GameWithScore`, `AddGameResult`, `BggSearchResult` (API response types)\n- `ImportProgress`, `ImportComplete` (SSE wire format types)\n\nUpdated 10 files across all three packages:\n- **shared**: Added types to `types.ts`, exported from `index.ts`\n- **daemon**: `game-service.ts`, `bgg-xml-parser.ts`, `bgg-client.ts`, `tournament-service.ts` now import from shared\n- **web**: `lib/api.ts` and `app/import/page.tsx` now import from shared\n- **cli**: `commands/import.ts` now imports from shared\n- **tests**: `tournament-service.test.ts`, `routes/games.test.ts`, `integration/end-to-end.test.ts` updated to use shared types\n\nAll 380 tests pass. Typecheck and lint clean. Issue marked resolved."
  - timestamp: 2026-04-07T02:10:27.716Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Analysis complete. Adding 5 shared types (GameWithScore, AddGameResult, BggSearchResult, ImportProgress, ImportComplete) to packages/shared, then updating all consumers across daemon, web, and CLI."
projectName: shelf-judge
---
Consolidated 5 duplicated types into `packages/shared/src/types.ts`:

- `GameWithScore`, `AddGameResult`, `BggSearchResult` (API response types)
- `ImportProgress`, `ImportComplete` (SSE wire format types)

Updated 10 files across all three packages:
- **shared**: Added types to `types.ts`, exported from `index.ts`
- **daemon**: `game-service.ts`, `bgg-xml-parser.ts`, `bgg-client.ts`, `tournament-service.ts` now import from shared
- **web**: `lib/api.ts` and `app/import/page.tsx` now import from shared
- **cli**: `commands/import.ts` now imports from shared
- **tests**: `tournament-service.test.ts`, `routes/games.test.ts`, `integration/end-to-end.test.ts` updated to use shared types

All 380 tests pass. Typecheck and lint clean. Issue marked resolved.
