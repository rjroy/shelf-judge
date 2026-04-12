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
- 22:19 commission-Dalton-20260411-221107 result: Phases 1-5 implemented. All 925 tests pass, typecheck and lint clean.

**Phase 1**: Added `NicheTagFilter` and `NicheSettings` types to `packages/shared/src/types.ts`, exported from index.

**Phase 2*...

- 22:19 commission-Dalton-20260411-221107 completed
- 22:22 commission-Thorne-20260411-221118 result: ## Review: Niche Tag Filtering (Phases 1-5)

### Verdict

Solid implementation. Follows the plan faithfully with one confirmed defect and two coverage gaps. The niche engine stays pure, the storage pa...
- 22:22 commission-Thorne-20260411-221118 completed