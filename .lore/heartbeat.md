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
- 16:17 commission-Dalton-20260410-120312 result: ## Phase 4: Profile Service, Storage, and Daemon Routes

All deliverables implemented and verified.

### Storage Extension
Added `loadProfile()` and `saveProfile()` to `StorageService`. Profile stored...

- 16:17 commission-Dalton-20260410-120312 completed
- 16:26 commission-Dalton-20260410-120329 result: ## Phase 5: Web UI — Complete

All deliverables implemented and verified.

### Navigation Restructuring (REQ-PROFILE-29)
- Collection list moved from `/` to `/collection/page.tsx`
- Profile Overview n...
- 16:26 commission-Dalton-20260410-120329 completed
- 16:33 commission-Thorne-20260410-120343 result: ## Review: Phases 4 and 5 of Collection Profiling

### Verdict

Structurally sound. The service layer, storage, routing, app wiring, navigation restructuring, and component extraction all follow estab...
- 16:33 commission-Thorne-20260410-120343 completed
- 16:40 commission-Dalton-20260410-120350 result: All 5 findings from Thorne's review addressed. 708 tests pass, typecheck clean, lint clean.

**Finding 1 (CRITICAL): Histogram uses Gaussian approximation** — Fixed. Added `histogram: number[]` field ...
- 16:40 commission-Dalton-20260410-120350 completed
- 16:43 commission-Dalton-20260410-120357 result: Phase 6 (CLI) complete. Created `packages/cli/src/commands/profile.ts` with `profileCommand` that calls `client.getProfile()` and outputs JSON. Added `profile` to the `COMMANDS` map in `index.ts` with...
- 16:43 commission-Dalton-20260410-120357 completed