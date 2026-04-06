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
- 16:20 commission-Dalton-20260406-153912 result: All three actionable findings from Thorne's review addressed:

**Finding 1 (DEFECT): PUT /settings Zod validation**
- Added `TournamentSettingsUpdateSchema` in `packages/shared/src/validation.ts` usin...

- 16:20 commission-Dalton-20260406-153912 completed
- 16:29 commission-Dalton-20260406-153930 result: Phase 5 (Web UI) implemented. All verification passes: 349 tests, typecheck clean, lint clean, format clean.

**New files (3):**
- `packages/web/app/tournament/page.tsx` - Session start page: active s...
- 16:29 commission-Dalton-20260406-153930 completed