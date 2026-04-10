---
title: "Commission: Reduce Tournament Overhead Phase 4: Remove Recalculate + Client Grep"
date: 2026-04-10
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 4 of `.lore/plans/reduce-tournament-overhead.md`: Remove Recalculate and Client Grep.\n\n1. **Route removal**: Remove `POST /tournament/recalculate` route and operation definition from `packages/daemon/src/routes/tournament.ts`\n2. **ELO engine cleanup**: Remove `recalculateAllRatings` from `packages/daemon/src/services/elo-engine.ts` and its tests\n3. **CLI removal**: Remove `tournamentRecalculate` from `packages/cli/src/commands/tournament.ts` and its registration in `packages/cli/src/index.ts`, plus tests\n4. **Web removal**: Remove `recalculateElo()` helper from `packages/web/lib/api.ts`\n5. **Route/integration test updates**: Remove recalculate test scenarios, update fixtures to post-migration format\n6. **Client grep** (spec requirement): After all removals, grep for `recalculate`, `data.comparisons` in production code. Report results.\n\nRun full suite: `bun run test`, `bun run typecheck`, `bun run lint`. Everything must pass clean."
dependencies:
  - commission-Dalton-20260410-070846
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T14:08:55.034Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T14:09:54.550Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-10T18:10:54.858Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-10T18:10:54.860Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
