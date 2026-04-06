---
title: "Commission: Fix: Extract toErrorMessage Utility"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Resolve `.lore/issues/error-message-utility.md`.\n\n## What to do\n\n1. Create `toErrorMessage(err: unknown): string` in `packages/shared/src/` (alongside existing shared types/schemas). It returns `err instanceof Error ? err.message : String(err)`.\n\n2. Export it from the shared package's public API.\n\n3. Write tests in `packages/shared/tests/` covering: Error instance, string, number, null, undefined, object.\n\n4. Replace every inline `err instanceof Error ? err.message : String(err)` across all files listed in the issue:\n   - `packages/daemon/src/routes/games.ts` (10)\n   - `packages/daemon/src/routes/scores.ts` (2)\n   - `packages/daemon/src/routes/config.ts` (2)\n   - `packages/daemon/src/routes/axes.ts` (4)\n   - `packages/daemon/src/services/game-service.ts` (6)\n   - `packages/daemon/src/services/bgg-client.ts` (6)\n   - `packages/cli/src/index.ts` (1)\n\n5. Grep for the pattern across the entire codebase to catch any the issue missed.\n\n6. Run `bun run test`, `bun run typecheck`, `bun run lint`.\n\n7. Update `.lore/issues/error-message-utility.md` status to `resolved`."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T20:08:42.408Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T20:08:42.410Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
