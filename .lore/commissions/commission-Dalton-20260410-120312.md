---
title: "Commission: Collection Profiling Phase 4: Service, Storage, Routes"
date: 2026-04-10
status: pending
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 4 of `.lore/plans/collection-profiling.md`: Profile Service, Storage, and Daemon Routes.\n\nKey deliverables:\n1. **Storage**: Add `loadProfile/saveProfile` to StorageService for `~/.shelf-judge/profile.json`\n2. **Profile service**: `createProfileService(deps)` with `getProfile()` implementing lazy recompute via timestamp comparison (collection.updatedAt and tournament timestamps vs profile.computedAt)\n3. **Route**: `GET /api/profile` returning `CollectionProfile`\n4. **App wiring**: Register profile service and routes in app.ts and index.ts\n5. **Client updates** (both in this phase per retro lesson): Web API helper in `packages/web/lib/api.ts`, CLI client helper in `packages/cli/src/client.ts`\n\nRead the full Phase 4 section for ProfileInput assembly details, stale detection logic, and test requirements.\n\nRun `bun run test`, `bun run typecheck` across all packages."
dependencies:
  - commission-Dalton-20260410-120301
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T19:03:12.222Z
    event: created
    reason: "Commission created"
current_progress: ""
projectName: shelf-judge
---
