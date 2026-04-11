---
title: "Commission: Reduce Tournament Overhead Phase 4: Remove Recalculate + Client Grep"
date: 2026-04-10
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 4 of `.lore/plans/reduce-tournament-overhead.md`: Remove Recalculate and Client Grep.\n\n1. **Route removal**: Remove `POST /tournament/recalculate` route and operation definition from `packages/daemon/src/routes/tournament.ts`\n2. **ELO engine cleanup**: Remove `recalculateAllRatings` from `packages/daemon/src/services/elo-engine.ts` and its tests\n3. **CLI removal**: Remove `tournamentRecalculate` from `packages/cli/src/commands/tournament.ts` and its registration in `packages/cli/src/index.ts`, plus tests\n4. **Web removal**: Remove `recalculateElo()` helper from `packages/web/lib/api.ts`\n5. **Route/integration test updates**: Remove recalculate test scenarios, update fixtures to post-migration format\n6. **Client grep** (spec requirement): After all removals, grep for `recalculate`, `data.comparisons` in production code. Report results.\n\nRun full suite: `bun run test`, `bun run typecheck`, `bun run lint`. Everything must pass clean."
dependencies:
  - commission-Dalton-20260410-070846
linked_artifacts:
  - packages/daemon/src/routes/tournament.ts

  - packages/daemon/src/services/elo-engine.ts
  - packages/cli/src/commands/tournament.ts
  - packages/cli/src/index.ts
  - packages/web/lib/api.ts
  - packages/daemon/tests/elo-engine.test.ts
  - packages/daemon/tests/routes/tournament.test.ts
  - packages/cli/tests/commands/tournament.test.ts
  - packages/daemon/tests/tournament-migration.test.ts
  - packages/daemon/src/services/elo-engine.ts
  - packages/cli/src/commands/tournament.ts
  - packages/cli/src/index.ts
  - packages/web/lib/api.ts
  - packages/daemon/tests/elo-engine.test.ts
  - packages/daemon/tests/routes/tournament.test.ts
  - packages/cli/tests/commands/tournament.test.ts
  - packages/daemon/tests/tournament-migration.test.ts
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
  - timestamp: 2026-04-10T18:10:54.882Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T18:11:10.054Z
    event: progress_report
    reason: "Starting Phase 4: Remove Recalculate and Client Grep. Reading all target files."
  - timestamp: 2026-04-10T18:11:39.130Z
    event: progress_report
    reason: "Making all removals: route + operation def, elo-engine function, CLI command + registration, web helper, and test cleanup."
  - timestamp: 2026-04-10T18:14:57.236Z
    event: result_submitted
    reason: "Phase 4 (Remove Recalculate and Client Grep) complete. All changes implemented per plan:\n\n**Route removal** (`packages/daemon/src/routes/tournament.ts`):\n- Removed `POST /tournament/recalculate` route handler\n- Removed `shelf.tournament.recalculate` operation definition\n\n**ELO engine cleanup** (`packages/daemon/src/services/elo-engine.ts`):\n- Removed `recalculateAllRatings` function and its `Comparison`/`TournamentGameStats` type import\n- Updated module header comment to remove REQ-TOURN-7 reference\n\n**CLI removal** (`packages/cli/src/commands/tournament.ts`, `packages/cli/src/index.ts`):\n- Removed `tournamentRecalculate` function and its export\n- Removed command registration for `tournament recalculate`\n- Removed import of `tournamentRecalculate`\n\n**Web removal** (`packages/web/lib/api.ts`):\n- Removed `recalculateElo()` helper function\n\n**Test updates**:\n- `packages/daemon/tests/elo-engine.test.ts`: Removed all `recalculateAllRatings` test suites (5-game worked example, incremental vs batch, K-factor transition, edge cases). Rewrote edge cases as `calculateNewRatings` tests.\n- `packages/daemon/tests/routes/tournament.test.ts`: Removed `POST /api/tournament/recalculate` test\n- `packages/cli/tests/commands/tournament.test.ts`: Removed `tournament recalculate` test suite and import\n\n**Pre-existing fix**: Fixed type error in `packages/daemon/tests/tournament-migration.test.ts` (line 255) where `status: \"completed\"` was inferred as `string` instead of `SessionStatus`. Added `TournamentData` type assertion.\n\n**Client grep results** (spec requirement):\n- `recalculate`: only match is axis-related test (`end-to-end.test.ts:298`), not tournament\n- `data.comparisons`: only match is validation test checking old field is absent post-migration\n\n**Verification**: 618 tests pass (1 skip), typecheck clean, lint clean."
  - timestamp: 2026-04-10T18:15:01.394Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Making all removals: route + operation def, elo-engine function, CLI command + registration, web helper, and test cleanup."
projectName: shelf-judge
---
Phase 4 (Remove Recalculate and Client Grep) complete. All changes implemented per plan:

**Route removal** (`packages/daemon/src/routes/tournament.ts`):
- Removed `POST /tournament/recalculate` route handler
- Removed `shelf.tournament.recalculate` operation definition

**ELO engine cleanup** (`packages/daemon/src/services/elo-engine.ts`):
- Removed `recalculateAllRatings` function and its `Comparison`/`TournamentGameStats` type import
- Updated module header comment to remove REQ-TOURN-7 reference

**CLI removal** (`packages/cli/src/commands/tournament.ts`, `packages/cli/src/index.ts`):
- Removed `tournamentRecalculate` function and its export
- Removed command registration for `tournament recalculate`
- Removed import of `tournamentRecalculate`

**Web removal** (`packages/web/lib/api.ts`):
- Removed `recalculateElo()` helper function

**Test updates**:
- `packages/daemon/tests/elo-engine.test.ts`: Removed all `recalculateAllRatings` test suites (5-game worked example, incremental vs batch, K-factor transition, edge cases). Rewrote edge cases as `calculateNewRatings` tests.
- `packages/daemon/tests/routes/tournament.test.ts`: Removed `POST /api/tournament/recalculate` test
- `packages/cli/tests/commands/tournament.test.ts`: Removed `tournament recalculate` test suite and import

**Pre-existing fix**: Fixed type error in `packages/daemon/tests/tournament-migration.test.ts` (line 255) where `status: "completed"` was inferred as `string` instead of `SessionStatus`. Added `TournamentData` type assertion.

**Client grep results** (spec requirement):
- `recalculate`: only match is axis-related test (`end-to-end.test.ts:298`), not tournament
- `data.comparisons`: only match is validation test checking old field is absent post-migration

**Verification**: 618 tests pass (1 skip), typecheck clean, lint clean.
