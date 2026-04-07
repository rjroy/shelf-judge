---
title: "Commission: Fix: Extract toErrorMessage Utility"
date: 2026-04-06
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Resolve `.lore/issues/error-message-utility.md`.\n\n## What to do\n\n1. Create `toErrorMessage(err: unknown): string` in `packages/shared/src/` (alongside existing shared types/schemas). It returns `err instanceof Error ? err.message : String(err)`.\n\n2. Export it from the shared package's public API.\n\n3. Write tests in `packages/shared/tests/` covering: Error instance, string, number, null, undefined, object.\n\n4. Replace every inline `err instanceof Error ? err.message : String(err)` across all files listed in the issue:\n   - `packages/daemon/src/routes/games.ts` (10)\n   - `packages/daemon/src/routes/scores.ts` (2)\n   - `packages/daemon/src/routes/config.ts` (2)\n   - `packages/daemon/src/routes/axes.ts` (4)\n   - `packages/daemon/src/services/game-service.ts` (6)\n   - `packages/daemon/src/services/bgg-client.ts` (6)\n   - `packages/cli/src/index.ts` (1)\n\n5. Grep for the pattern across the entire codebase to catch any the issue missed.\n\n6. Run `bun run test`, `bun run typecheck`, `bun run lint`.\n\n7. Update `.lore/issues/error-message-utility.md` status to `resolved`."
dependencies: []
linked_artifacts:
  - packages/shared/src/errors.ts

  - packages/shared/src/index.ts
  - packages/shared/tests/errors.test.ts
  - packages/daemon/src/routes/games.ts
  - packages/daemon/src/routes/scores.ts
  - packages/daemon/src/routes/config.ts
  - packages/daemon/src/routes/axes.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/src/services/bgg-client.ts
  - packages/cli/src/index.ts
  - .lore/issues/error-message-utility.md
  - packages/shared/src/index.ts
  - packages/shared/tests/errors.test.ts
  - packages/daemon/src/routes/games.ts
  - packages/daemon/src/routes/scores.ts
  - packages/daemon/src/routes/config.ts
  - packages/daemon/src/routes/axes.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/src/services/bgg-client.ts
  - packages/cli/src/index.ts
  - .lore/issues/error-message-utility.md
activity_timeline:
  - timestamp: 2026-04-06T20:08:42.408Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T20:08:42.410Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-06T20:08:42.428Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-06T20:09:00.925Z
    event: progress_report
    reason: "Starting implementation: creating toErrorMessage utility, tests, then replacing all inline copies across the codebase."
  - timestamp: 2026-04-06T20:11:35.922Z
    event: result_submitted
    reason: "Created `toErrorMessage(err: unknown): string` in `packages/shared/src/errors.ts`, exported from the shared package's public API. Wrote 7 tests covering Error, TypeError, string, number, null, undefined, and object inputs. Replaced 31 inline `err instanceof Error ? err.message : String(err)` occurrences across 7 files (games.ts, scores.ts, config.ts, axes.ts, game-service.ts, bgg-client.ts, cli/index.ts). Full grep confirms zero remaining inline copies outside the utility itself. 237 tests pass, typecheck clean, lint clean. Issue status updated to resolved."
  - timestamp: 2026-04-06T20:11:42.541Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Starting implementation: creating toErrorMessage utility, tests, then replacing all inline copies across the codebase."
projectName: shelf-judge
---
Created `toErrorMessage(err: unknown): string` in `packages/shared/src/errors.ts`, exported from the shared package's public API. Wrote 7 tests covering Error, TypeError, string, number, null, undefined, and object inputs. Replaced 31 inline `err instanceof Error ? err.message : String(err)` occurrences across 7 files (games.ts, scores.ts, config.ts, axes.ts, game-service.ts, bgg-client.ts, cli/index.ts). Full grep confirms zero remaining inline copies outside the utility itself. 237 tests pass, typecheck clean, lint clean. Issue status updated to resolved.
