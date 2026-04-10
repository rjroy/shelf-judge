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
- 07:13 commission-Dalton-20260410-070820 result: Phases 1 and 2 implemented. All tests pass.

**Phase 1: Shared Types and Validation**
- Added `CachedRecentComparison` interface to `packages/shared/src/types.ts`
- Expanded `TournamentGameStats` with...

- 07:13 commission-Dalton-20260410-070820 completed
- 07:17 commission-Thorne-20260410-070829 result: ## Review: Phases 1-2 of Tournament Overhead Reduction

**Verdict: Approved to proceed to Phase 3.** No defects found. One test gap worth closing before moving on.

---

### Requirement Coverage

All ...
- 07:17 commission-Thorne-20260410-070829 completed