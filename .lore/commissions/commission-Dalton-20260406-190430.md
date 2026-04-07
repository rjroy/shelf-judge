---
title: "Commission: Fix: Consolidate Duplicated Web/Daemon Types into Shared Package"
date: 2026-04-07
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Fix the issue described in `.lore/issues/duplicated-web-daemon-types.md`.\n\n**Problem:** `packages/web/lib/api.ts` independently defines interfaces that mirror daemon types: `GameWithScore`, `AddGameResult`, `ImportProgress`, `ImportComplete`, `BggSearchResult`. These duplicate the daemon's versions in `packages/daemon/src/services/game-service.ts`. If response shapes change, the web types silently drift.\n\n**Task:**\n1. Read both files to understand the current type definitions on each side.\n2. Move the shared types into `packages/shared/` (that workspace exists for exactly this purpose). Follow existing patterns in `packages/shared/` for how types are organized and exported.\n3. Update `packages/daemon/` to import from shared instead of defining locally.\n4. Update `packages/web/lib/api.ts` to import from shared instead of defining locally.\n5. SSE event shapes (`ImportProgress`, `ImportComplete`) should also be shared so the frontend parser and daemon emitter stay in sync.\n6. Grep the entire codebase for any other imports of the old type locations and update them.\n7. Run `bun run typecheck`, `bun run lint`, and `bun run test` to verify nothing broke.\n8. Update the issue file status to `resolved` when complete."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-07T02:04:30.944Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T02:04:30.946Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
