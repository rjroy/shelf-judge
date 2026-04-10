---
title: "Commission: Collection Profiling Phase 6: CLI"
date: 2026-04-10
status: blocked
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 6 of `.lore/plans/collection-profiling.md`: CLI.\n\n- Create `packages/cli/src/commands/profile.ts` with `profileCommand` function\n- Add `profile` to the `COMMANDS` map in `packages/cli/src/index.ts`\n- Calls `GET /api/profile` via CLI client, outputs `CollectionProfile` as JSON\n- `--json` flag accepted (no behavioral difference, default is JSON)\n\nRun `bun run test`, `bun run typecheck`, `bun run lint`."
dependencies:
  - commission-Dalton-20260410-120350
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T19:03:57.295Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T19:10:00.062Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
current_progress: ""
projectName: shelf-judge
---
