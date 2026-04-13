---
title: "Commission: Shelf Capacity: Foundation Types (Phase 1)"
date: 2026-04-13
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 1 of the shelf capacity feature: shared types.\n\n**Read these first:**\n- `.lore/plans/shelf-capacity.md` (Phase 1 in detail)\n- `.lore/specs/shelf-capacity.md` (REQ-SHELF-1 through REQ-SHELF-3, REQ-SHELF-8 through REQ-SHELF-10)\n- `packages/shared/src/types.ts` (current Game type)\n- `packages/daemon/src/services/storage-service.ts` (backfill pattern, see ownership backfill)\n- `packages/daemon/src/services/game-service.ts` (addGame construction)\n\n**What to build:**\n- Add `BoxDimensions` interface (width/height/depth in inches)\n- Add `Shelf`, `ShelfUnit`, `ShelfConfiguration` interfaces\n- Add `boxDimensions: BoxDimensions | null` to `Game` interface\n- Add storage backfill: legacy games without `boxDimensions` get `null` at load time (follow the ownership backfill pattern)\n- Set `boxDimensions: null` in `addGame`\n\n**Verification:** `bun run test`, `bun run typecheck`, `bun run lint` must all pass."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-13T22:00:05.609Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T22:04:16.772Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
