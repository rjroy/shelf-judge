---
status: active
---
# Heartbeat

This file controls what the guild does autonomously. Every hour (configurable),
a Guild Master session reads this file and decides which standing orders warrant
action: creating commissions, dispatching work, or starting meetings.

**Standing Orders** are lines starting with `- `. Write them in plain language.
If you want the guild to check with you before acting on an order, say so in the
order itself.

**Watch Items** are things to monitor. The guild reads these for context but won't
create commissions from them directly.

**Context Notes** are operational context the guild should know (merge freezes, priorities).

**Recent Activity** is managed by the daemon. Don't edit this section manually.
Workers can also add entries to this file during their sessions.

## Standing Orders

## Watch Items

## Context Notes

## Recent Activity
- 17:20 commission-Dalton-20260410-171703 result: Phase 1 complete. All three files modified:

1. `packages/shared/src/types.ts`: Added `"predicted"` to `FitnessBreakdownSource`. Added `predictionConfidence` and `referenceGames` nullable fields to `F...

- 17:20 commission-Dalton-20260410-171703 completed
- 17:26 commission-Dalton-20260410-171716 result: Phase 2 complete. Two files created:

1. `packages/daemon/src/services/prediction-engine.ts` — Pure-function prediction module with 5 exports:
   - `findKNearestForAxis` — k-NN search filtered by axis...
- 17:26 commission-Dalton-20260410-171716 completed
- 17:29 commission-Dalton-20260410-171726 result: Phase 3 (Tournament Prior) implemented. Two files touched:

**Modified**: `packages/daemon/src/services/prediction-engine.ts`
- Added `TournamentRankedGame` interface (`{ gameId, gameName, vector, nor...
- 17:29 commission-Dalton-20260410-171726 completed
- 17:34 commission-Thorne-20260410-171740 result: ## Review: Prediction Engine Phases 1-3

### Requirement Coverage (REQ-PRED-1 through REQ-PRED-22)

**Satisfied**: REQ-PRED-1 through 13, 15 through 19, 21, 22, 33, 34. The core k-NN math, confidence ...
- 17:34 commission-Thorne-20260410-171740 completed
- 17:37 commission-Dalton-20260410-171748 result: All four findings from Thorne's review addressed:

**1. DEFECT FIXED: `ratedAxisCount` now actual-only (REQ-PRED-35)**
`prediction-engine.ts:332-374` - Changed `ratedAxisCount` on `FitnessResult` to u...
- 17:37 commission-Dalton-20260410-171748 completed
- 17:47 commission-Dalton-20260410-171758 result: Phase 4 complete. 794 tests pass, 1 skip (pre-existing), 0 fail. Typecheck and lint clean.

**Files created:**
- `packages/daemon/src/services/prediction-service.ts` — service with `predictGame`, `get...
- 17:47 commission-Dalton-20260410-171758 completed