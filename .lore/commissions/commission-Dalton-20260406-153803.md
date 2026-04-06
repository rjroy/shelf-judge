---
title: "Commission: Tournament Phase 1+2: Types + ELO Engine"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 1 and 2 from `.lore/plans/tournament-ranking.md`.\n\n**Phase 1: Data Model and Shared Types**\n- Add all tournament types to `packages/shared/src/types.ts`: TournamentSettings, SessionFilter, SessionFilterType, SessionStatus, TournamentSession, Comparison, TournamentGameStats, TournamentData, RecentComparison, TournamentGameStatsDisplay\n- Add Zod schemas to `packages/shared/src/validation.ts`: SessionFilterSchema, StartSessionSchema, SubmitComparisonSchema\n- Re-export from `packages/shared/src/index.ts`\n- Tests: Zod schema validation (invalid filter types, missing winnerId, null filters)\n\n**Phase 2: ELO Engine (Pure Math, No I/O)**\n- Create `packages/daemon/src/services/elo-engine.ts` with pure functions: calculateExpectedScore, calculateNewRatings, recalculateAllRatings, normalizeElo, shouldDisplayRanking\n- Create `packages/daemon/tests/elo-engine.test.ts`\n- Tests: hand-calculated 5-game 10-comparison worked example (document each step), K-factor transition, recalculate matches incremental, normalization edge cases (< 5 games, clamping, all-equal-ELO), both winner directions\n\nRead the plan carefully for exact type definitions, function signatures, and the spec inconsistency note about K-factor threshold (use 15 per REQ-TOURN-6, not 30).\n\nRun `bun run test`, `bun run typecheck`, `bun run lint`."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T22:38:03.513Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T22:38:03.515Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
