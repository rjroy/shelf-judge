---
title: "Commission: Fix: Redundancy scoring P5-6 review findings"
date: 2026-04-12
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Read Thorne's review of redundancy scoring Phases 5-6. The review commission is `commission-Thorne-20260412-064159`. Check `.lore/commissions/` for the review artifact.\n\nAddress ALL findings. The plan is at `.lore/plans/redundancy-scoring.md` and the spec at `.lore/specs/redundancy-scoring.md`.\n\nRun `bun run test`, `bun run typecheck`, and `bun run lint` after all fixes."
dependencies:
  - commission-Thorne-20260412-064159
linked_artifacts:
  - packages/daemon/src/routes/games.ts

  - packages/shared/src/types.ts
  - packages/daemon/tests/redundancy-integration.test.ts
  - packages/shared/src/types.ts
  - packages/daemon/tests/redundancy-integration.test.ts
activity_timeline:
  - timestamp: 2026-04-12T13:42:03.624Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T13:45:52.839Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T14:14:39.524Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T14:14:39.528Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T14:14:39.552Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T14:14:45.388Z
    event: progress_report
    reason: "Reading Thorne's review commission for redundancy scoring Phases 5-6."
  - timestamp: 2026-04-12T14:15:00.905Z
    event: progress_report
    reason: "Thorne raised 6 findings: 2 defects (score source inconsistency, optional type), 2 test gaps (weak assertion, missing REQ-REDUN-23 assertion), 1 concern (predictionService gating), 1 style (non-null assertions). Reading source files now."
  - timestamp: 2026-04-12T14:18:28.523Z
    event: progress_report
    reason: "Starting fixes. Finding 1+5+6: restructure GET /games/:id to use gameService.listGames() for redundancy (consistency + decouple from predictionService + proper null guard). Finding 2: fix type optionality. Findings 3-4: strengthen test assertions."
  - timestamp: 2026-04-12T14:20:47.901Z
    event: result_submitted
    reason: "## Thorne's Review Findings: All 6 Addressed\n\n### Finding 1 (DEFECT) + Finding 5 (CONCERN) + Finding 6 (STYLE): Score source inconsistency, predictionService gating, non-null assertions\n**File**: `packages/daemon/src/routes/games.ts`\n\nRestructured GET /games/:id to decouple redundancy from the predictionService block. Redundancy now uses `gameService.listGames()` (non-enriched scores), matching the GET /games list endpoint. This fixes three findings at once:\n- **Consistency**: Both list and detail endpoints now compute redundancy against the same non-enriched score source. No more visible penalty mismatches between views.\n- **Decoupling**: Redundancy is gated by `storageService` (its logical dependency), not `predictionService`. Runs independently of whether prediction service is present.\n- **Null safety**: Replaced `result.score!` non-null assertions with a proper `result.score &&` guard.\n\n### Finding 2 (DEFECT): PredictedGameResponse.redundancyPreview optional vs required nullable\n**File**: `packages/shared/src/types.ts:420`\n\nChanged `redundancyPreview?: RedundancyAdjustment | null` to `redundancyPreview: RedundancyAdjustment | null`, matching the spec (REQ-REDUN-22). The route handler at prediction.ts:120 always includes the field, so no runtime changes needed.\n\n### Finding 3 (GAP): Weak niche pre-redundancy assertion\n**File**: `packages/daemon/tests/redundancy-integration.test.ts:335`\n\nAdded `expect(bodyAnnotation.nichePosition).not.toBeNull()` and `expect(bodyIntegrated.nichePosition).not.toBeNull()` before the comparison block. The test now fails explicitly if niche positions aren't computed, instead of passing vacuously.\n\n### Finding 4 (GAP): Missing REQ-REDUN-23 assertion\n**File**: `packages/daemon/tests/redundancy-integration.test.ts:307-313`\n\nAdded assertions that `redundancyPreview.nicheNeighbors[n].fitnessScore` values match the known fixture scores (8.0, 6.0, 4.0). This proves the preview uses pre-redundancy scores for existing games.\n\n### Cleanup\n- Removed unused `RedundancyAdjustment` import from redundancy-integration.test.ts\n- Simplified type assertions from `PredictedGameResponse & { redundancyPreview: ... }` to `PredictedGameResponse`\n\n### Verification\n- `bun run typecheck`: clean\n- `bun run test`: 982 pass, 0 fail\n- `bun run lint`: clean"
  - timestamp: 2026-04-12T14:20:56.605Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Starting fixes. Finding 1+5+6: restructure GET /games/:id to use gameService.listGames() for redundancy (consistency + decouple from predictionService + proper null guard). Finding 2: fix type optionality. Findings 3-4: strengthen test assertions."
projectName: shelf-judge
---
## Thorne's Review Findings: All 6 Addressed

### Finding 1 (DEFECT) + Finding 5 (CONCERN) + Finding 6 (STYLE): Score source inconsistency, predictionService gating, non-null assertions
**File**: `packages/daemon/src/routes/games.ts`

Restructured GET /games/:id to decouple redundancy from the predictionService block. Redundancy now uses `gameService.listGames()` (non-enriched scores), matching the GET /games list endpoint. This fixes three findings at once:
- **Consistency**: Both list and detail endpoints now compute redundancy against the same non-enriched score source. No more visible penalty mismatches between views.
- **Decoupling**: Redundancy is gated by `storageService` (its logical dependency), not `predictionService`. Runs independently of whether prediction service is present.
- **Null safety**: Replaced `result.score!` non-null assertions with a proper `result.score &&` guard.

### Finding 2 (DEFECT): PredictedGameResponse.redundancyPreview optional vs required nullable
**File**: `packages/shared/src/types.ts:420`

Changed `redundancyPreview?: RedundancyAdjustment | null` to `redundancyPreview: RedundancyAdjustment | null`, matching the spec (REQ-REDUN-22). The route handler at prediction.ts:120 always includes the field, so no runtime changes needed.

### Finding 3 (GAP): Weak niche pre-redundancy assertion
**File**: `packages/daemon/tests/redundancy-integration.test.ts:335`

Added `expect(bodyAnnotation.nichePosition).not.toBeNull()` and `expect(bodyIntegrated.nichePosition).not.toBeNull()` before the comparison block. The test now fails explicitly if niche positions aren't computed, instead of passing vacuously.

### Finding 4 (GAP): Missing REQ-REDUN-23 assertion
**File**: `packages/daemon/tests/redundancy-integration.test.ts:307-313`

Added assertions that `redundancyPreview.nicheNeighbors[n].fitnessScore` values match the known fixture scores (8.0, 6.0, 4.0). This proves the preview uses pre-redundancy scores for existing games.

### Cleanup
- Removed unused `RedundancyAdjustment` import from redundancy-integration.test.ts
- Simplified type assertions from `PredictedGameResponse & { redundancyPreview: ... }` to `PredictedGameResponse`

### Verification
- `bun run typecheck`: clean
- `bun run test`: 982 pass, 0 fail
- `bun run lint`: clean
