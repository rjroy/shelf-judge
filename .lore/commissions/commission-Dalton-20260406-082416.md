---
title: "Commission: Implement: Daemon Logger Factory (Steps 1-3)"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement the daemon logger factory per `.lore/plans/daemon-logger.md`, all three steps in one pass.\n\n**Step 1: Create logger factory + tests**\n- Create `packages/daemon/src/services/logger.ts` with `Logger` interface and `createLogger(name)` function\n- Create `packages/daemon/tests/services/logger.test.ts` with spy-based tests covering all three methods, multi-arg passthrough, and prefix formatting\n\n**Step 2: Replace all console.* calls**\n- `bgg-client.ts` (18 calls, prefix \"bgg\") — logger inside createBggClient()\n- `game-service.ts` (6 calls, prefix \"import\") — logger inside createGameService()\n- `routes/import.ts` (3 calls, prefix \"route\") — logger inside createImportRoutes()\n- `index.ts` (5 calls, no current prefix → \"daemon\") — module-level logger so the .catch() handler can use it too\n\nStrip the existing manual prefix from each message string. The logger adds it.\n\n**Step 3: Validate**\n- Run `rg 'console\\.(log|warn|error)' packages/daemon/src/` and confirm zero results\n- Run `bun run test`, `bun run typecheck`, `bun run lint`\n\nRead the plan carefully for file-by-file details and the index.ts module-level logger decision."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T15:24:16.039Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T15:24:16.041Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
