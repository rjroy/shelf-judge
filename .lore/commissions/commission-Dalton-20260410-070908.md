---
title: "Commission: Fix: Tournament Overhead Phase 3+4 Review Findings"
date: 2026-04-10
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Read Thorne's review of Tournament Overhead Phases 3+4. Address ALL findings.\n\nCheck `.lore/reviews/` for the review artifact, or read the most recent Thorne commission result.\n\nAfter fixing all findings, run the full suite: `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check`. Everything must pass clean."
dependencies:
  - commission-Thorne-20260410-070903
linked_artifacts:
  - packages/daemon/src/routes/tournament.ts

  - packages/daemon/tests/tournament-service.test.ts
  - packages/daemon/tests/tournament-service.test.ts
activity_timeline:
  - timestamp: 2026-04-10T14:09:08.125Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T14:09:54.550Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-10T18:21:21.461Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-10T18:21:21.464Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T18:21:21.486Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T18:21:35.180Z
    event: progress_report
    reason: "Read Thorne's review. Two findings to fix: (1) DEFECT: all-stats endpoint missing opponentGameName enrichment in recentComparisons, (2) TEST GAP: onGameDeleted auto-complete path doesn't exercise comparison clearing. Reading the relevant files now."
  - timestamp: 2026-04-10T18:22:31.218Z
    event: result_submitted
    reason: "Fixed both findings from Thorne's Phase 3+4 review:\n\n1. **DEFECT: all-stats endpoint opponentGameName enrichment** (`packages/daemon/src/routes/tournament.ts:197-203`): Added enrichment loop inside the `.map()` callback that populates `opponentGameName` from the `nameMap` for each game's `recentComparisons`, mirroring the single-game route pattern. Without this, the all-stats endpoint returned `null` for all opponent names.\n\n2. **TEST GAP: onGameDeleted comparison clearing** (`packages/daemon/tests/tournament-service.test.ts:736-749`): Strengthened the auto-complete test to submit a comparison before deleting the game, then assert that `session.comparisons` is cleared to `[]`. Previously the test started with an empty array, so the clearing behavior was never exercised.\n\nVerification: 618 tests pass (1 skip), typecheck clean, lint clean, formatting clean on changed files."
  - timestamp: 2026-04-10T18:22:35.428Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Read Thorne's review. Two findings to fix: (1) DEFECT: all-stats endpoint missing opponentGameName enrichment in recentComparisons, (2) TEST GAP: onGameDeleted auto-complete path doesn't exercise comparison clearing. Reading the relevant files now."
projectName: shelf-judge
---
Fixed both findings from Thorne's Phase 3+4 review:

1. **DEFECT: all-stats endpoint opponentGameName enrichment** (`packages/daemon/src/routes/tournament.ts:197-203`): Added enrichment loop inside the `.map()` callback that populates `opponentGameName` from the `nameMap` for each game's `recentComparisons`, mirroring the single-game route pattern. Without this, the all-stats endpoint returned `null` for all opponent names.

2. **TEST GAP: onGameDeleted comparison clearing** (`packages/daemon/tests/tournament-service.test.ts:736-749`): Strengthened the auto-complete test to submit a comparison before deleting the game, then assert that `session.comparisons` is cleared to `[]`. Previously the test started with an empty array, so the clearing behavior was never exercised.

Verification: 618 tests pass (1 skip), typecheck clean, lint clean, formatting clean on changed files.
