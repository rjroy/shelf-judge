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
- 15:42 commission-Dalton-20260406-153803 result: Phases 1 and 2 implemented. All checks pass: 281 tests green, typecheck clean, lint clean.

**Phase 1: Data Model and Shared Types**
- Added 11 tournament types to `packages/shared/src/types.ts`: Tour...

- 15:42 commission-Dalton-20260406-153803 completed
- 15:46 commission-Thorne-20260406-153813 result: ## Review: Tournament Phase 1+2 (Types + ELO Engine)

### Findings by Priority

**1. DEFECT — "Incremental matches recalculate" test is vacuous**
File: `packages/daemon/tests/elo-engine.test.ts:234-25...
- 15:46 commission-Thorne-20260406-153813 completed
- 15:49 commission-Dalton-20260406-153819 result: Addressed all four findings from Thorne's review of tournament Phases 1-2.

**Finding 1 (DEFECT) - Vacuous incremental test**: Rewrote to manually apply `calculateNewRatings` step by step (starting at...
- 15:49 commission-Dalton-20260406-153819 completed
- 16:03 commission-Dalton-20260406-153834 result: Phase 3 complete. 317 tests pass, typecheck clean, lint clean.

**Storage changes** (`packages/daemon/src/services/storage-service.ts`):
- Added `loadTournament()`/`saveTournament()` to `StorageServic...
- 16:03 commission-Dalton-20260406-153834 completed
- 16:06 commission-Thorne-20260406-153843 result: ## Tournament Service Review (Phase 3)

### Defects

**1. submitComparison accepts invalid winnerId — data integrity bug**
File: `packages/daemon/src/services/tournament-service.ts:347`

`winnerId` is...
- 16:06 commission-Thorne-20260406-153843 completed
- 16:08 commission-Dalton-20260406-153848 result: Addressed all 4 actionable findings from Thorne's review:

**Defect #1 - winnerId validation**: Added guard in `submitComparison` that throws if `winnerId` is not one of `gameAId` or `gameBId`. Preven...
- 16:08 commission-Dalton-20260406-153848 completed
- 16:13 commission-Dalton-20260406-153859 result: Phase 4 complete: tournament API routes, app/index wiring, and route tests.

**New files:**
- `packages/daemon/src/routes/tournament.ts` — 11 endpoints matching the plan's endpoint specification table...
- 16:13 commission-Dalton-20260406-153859 completed