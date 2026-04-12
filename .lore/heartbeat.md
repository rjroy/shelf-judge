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
- 07:08 commission-Dalton-20260412-064151 result: Implemented Phases 5 and 6 of the redundancy scoring plan.

**Phase 5: Game Route Integration**
- Wired redundancy engine into three route handlers: GET /games, GET /games/:id, GET /predictions/bgg/:b...

- 07:09 commission-Dalton-20260412-064151 completed
- 07:14 commission-Thorne-20260412-064159 result: ## Redundancy Scoring Route Integration Review (Phases 5-6)

### Findings by Priority

**1. DEFECT: Score source inconsistency between list and detail endpoints**
File: `packages/daemon/src/routes/gam...
- 07:14 commission-Thorne-20260412-064159 completed
- 07:20 commission-Dalton-20260412-064203 result: ## Thorne's Review Findings: All 6 Addressed

### Finding 1 (DEFECT) + Finding 5 (CONCERN) + Finding 6 (STYLE): Score source inconsistency, predictionService gating, non-null assertions
**File**: `pac...
- 07:20 commission-Dalton-20260412-064203 completed
- 07:25 commission-Dalton-20260412-064217 result: ## Phases 7-10 Complete

### Phase 7: RedundancyPanel on game detail page
**File**: `packages/web/app/games/[id]/page.tsx`

Added `RedundancyPanel` component above `NichePositionPanel`. Shows:
- Penal...
- 07:25 commission-Dalton-20260412-064217 completed
- 07:26 commission-Dalton-20260412-064226 result: Phase 11 (CLI) of the redundancy scoring plan is implemented and verified.

**11a: Redundancy command group** (`packages/cli/src/commands/redundancy.ts`, new file):
- `redundancy settings` - displays ...
- 07:26 commission-Dalton-20260412-064226 completed