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
- 12:09 commission-Dalton-20260410-120227 result: Phases 1 and 2 of collection-profiling plan implemented.

**Phase 1: Shared Types and Validation**
- Added `subdomains: BggTag[]` to `BggGameData` interface in `packages/shared/src/types.ts`
- Added a...

- 12:09 commission-Dalton-20260410-120227 completed
- 12:15 commission-Dalton-20260410-120242 result: Phase 3 of collection-profiling plan implemented.

**Created**: `packages/daemon/src/services/profile-engine.ts` (pure-function module, no I/O, no service dependencies)
- `computeProfile(input: Profil...
- 12:15 commission-Dalton-20260410-120242 completed
- 12:22 commission-Thorne-20260410-120257 result: ## Review: Collection Profiling Phases 1-3

Reviewed against spec (`.lore/specs/collection-profiling.md`), plan (`.lore/plans/collection-profiling.md`), and research (`.lore/research/outlier-distance-...
- 12:22 commission-Thorne-20260410-120257 completed