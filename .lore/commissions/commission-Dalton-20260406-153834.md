---
title: "Commission: Tournament Phase 3: Tournament Service"
date: 2026-04-06
status: blocked
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 3 from `.lore/plans/tournament-ranking.md`.\n\n**Storage changes:**\n- Add `loadTournament()`/`saveTournament()` to StorageService (same atomic write pattern as collection)\n- Default TournamentData with settings { kFactorThreshold: 15, normalizationHalfWidth: 400, provisionalThreshold: 6 }\n\n**Tournament service:**\n- Create `packages/daemon/src/services/tournament-service.ts` with `createTournamentService(deps)` factory\n- Full interface: startSession, getActiveSession, endSession, getNextPair, submitComparison, getGameStats, getAllGameStats, listSessions, recalculate, onGameDeleted, getSettings, updateSettings\n- Session start: apply filters (name, minFitness, bggTag, staleness), AND-combine, reject < 4 games, auto-complete previous active session\n- Adaptive pairing: prioritize low comparison count, prefer similar ELO (within 200 points), no repeat pairs per session, random tiebreak\n- Game deletion hook: retain comparisons, remove cached ELO, check active session, auto-complete if < 4 remain\n\n**Game service modification:**\n- Add `onGameDeleted?: (gameId: string) => Promise<void>` to GameServiceDeps\n- Call it in removeGame after splicing from collection\n\n**Tests** (`packages/daemon/tests/tournament-service.test.ts`):\n- Session start with each filter type and combined\n- < 4 games rejection\n- New session completes previous active\n- Adaptive pairing: 0-comparison games first, no repeat pairs\n- Game deletion: comparisons retained, ELO removed, session auto-complete\n- Atomic writes\n\nRead the plan for exact type signatures, filter logic, and pairing algorithm details.\n\nRun `bun run test`, `bun run typecheck`, `bun run lint`."
dependencies:
  - commission-Dalton-20260406-153819
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T22:38:34.012Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T22:38:34.015Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
current_progress: ""
projectName: shelf-judge
---
