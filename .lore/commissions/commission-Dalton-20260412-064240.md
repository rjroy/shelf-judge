---
title: "Commission: Fix: Redundancy scoring final review findings"
date: 2026-04-12
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Read Thorne's final review of the complete redundancy scoring feature. The review commission is `commission-Thorne-20260412-064235`. Check `.lore/commissions/` for the review artifact.\n\nAddress ALL findings. The plan is at `.lore/plans/redundancy-scoring.md` and the spec at `.lore/specs/redundancy-scoring.md`.\n\nRun `bun run test`, `bun run typecheck`, and `bun run lint` after all fixes."
dependencies:
  - commission-Thorne-20260412-064235
linked_artifacts:
  - packages/daemon/src/routes/games.ts

  - packages/daemon/src/services/feature-vector.ts
  - packages/daemon/tests/redundancy-integration.test.ts
  - packages/daemon/src/services/feature-vector.ts
  - packages/daemon/tests/redundancy-integration.test.ts
activity_timeline:
  - timestamp: 2026-04-12T13:42:40.506Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T13:45:52.840Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T14:33:38.152Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T14:33:38.157Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T14:33:38.180Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T14:33:45.908Z
    event: progress_report
    reason: "Reading Thorne's review commission to identify all findings that need addressing."
  - timestamp: 2026-04-12T14:36:02.992Z
    event: progress_report
    reason: "Identified 3 findings from Thorne's review. Finding 1 (inconsistent game set for redundancy) is a real bug requiring code fix. Finding 2 (nicheRank filter) is documented intentional behavior. Finding 3 (ComponentWeights duplication) is a drift risk worth eliminating. Reading source files to plan fixes."
  - timestamp: 2026-04-12T14:36:47.493Z
    event: progress_report
    reason: "Implementing fixes: (1) Add universe parameter to applyRedundancy for consistent game set across routes, (2) Deduplicate ComponentWeights by importing from shared in feature-vector.ts."
  - timestamp: 2026-04-12T14:38:34.865Z
    event: result_submitted
    reason: "Addressed all findings from Thorne's review (commission-Thorne-20260412-064235):\n\n**Finding 1 (bug fix): Inconsistent game set for redundancy across routes.** GET /games/:id used `gameService.listGames()` (actual-scored only) while GET /games?includePredicted=true used prediction-enriched games, producing different penalties for the same game on different pages. Fixed by:\n- Adding a `universe` parameter to `applyRedundancy()` so the computation universe can differ from the annotated game set\n- GET /games (non-predicted path) now passes prediction-enriched games as the universe\n- GET /games/:id now uses prediction-enriched games when predictionService is available\n- All three route paths now compute penalties against the same game set\n- Added 2 consistency tests: detail-vs-list penalty match, and plain-vs-predicted penalty match\n\n**Finding 2 (no action): nicheRank predicted-authority filter.** Documented design choice, implementation comment at redundancy-engine.ts:183-184 explicitly acknowledges keeping rank and penalty in agreement. No change needed.\n\n**Finding 3 (dedup): ComponentWeights type duplication.** Removed the duplicate `ComponentWeights` interface from `feature-vector.ts` and replaced it with an import from `@shelf-judge/shared`. Re-exported for existing consumers. Eliminates silent drift risk.\n\nVerification: typecheck clean, 984 tests pass (0 fail), lint clean."
  - timestamp: 2026-04-12T14:38:41.735Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Implementing fixes: (1) Add universe parameter to applyRedundancy for consistent game set across routes, (2) Deduplicate ComponentWeights by importing from shared in feature-vector.ts."
projectName: shelf-judge
---
Addressed all findings from Thorne's review (commission-Thorne-20260412-064235):

**Finding 1 (bug fix): Inconsistent game set for redundancy across routes.** GET /games/:id used `gameService.listGames()` (actual-scored only) while GET /games?includePredicted=true used prediction-enriched games, producing different penalties for the same game on different pages. Fixed by:
- Adding a `universe` parameter to `applyRedundancy()` so the computation universe can differ from the annotated game set
- GET /games (non-predicted path) now passes prediction-enriched games as the universe
- GET /games/:id now uses prediction-enriched games when predictionService is available
- All three route paths now compute penalties against the same game set
- Added 2 consistency tests: detail-vs-list penalty match, and plain-vs-predicted penalty match

**Finding 2 (no action): nicheRank predicted-authority filter.** Documented design choice, implementation comment at redundancy-engine.ts:183-184 explicitly acknowledges keeping rank and penalty in agreement. No change needed.

**Finding 3 (dedup): ComponentWeights type duplication.** Removed the duplicate `ComponentWeights` interface from `feature-vector.ts` and replaced it with an import from `@shelf-judge/shared`. Re-exported for existing consumers. Eliminates silent drift risk.

Verification: typecheck clean, 984 tests pass (0 fail), lint clean.
