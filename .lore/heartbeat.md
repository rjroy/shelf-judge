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
- 06:16 commission-Dalton-20260410-061208 result: Fixed both bugs. Root cause was shared: the `rateGame` API only accepted numeric values, so there was no way to express "clear this rating."

**Changes:**

1. **`packages/daemon/src/routes/games.ts`**...

- 06:16 commission-Dalton-20260410-061208 completed
- 06:28 commission-Octavia-20260410-062055 result: Wrote the Collection Identity and Taste Profiling specification at `.lore/specs/collection-profiling.md`.

The spec covers all five brainstorm proposals as 38 requirements (REQ-PROFILE-1 through REQ-P...
- 06:28 commission-Octavia-20260410-062055 completed
- 06:30 commission-Octavia-20260410-062248 result: Wrote specification at `.lore/specs/reduce-tournament-overhead.md` (14 requirements, REQ-RTO-1 through REQ-RTO-14).

The spec makes three key decisions:
1. **Full history recalculability (REQ-TOURN-7)...
- 06:30 commission-Octavia-20260410-062248 completed
- 06:33 commission-Octavia-20260410-063144 result: Filed 5 issues from the commission cleanup retro's loose threads:

1. `.lore/issues/deferred-filter-types.md` — 8 deferred filter types from filter/sort spec with no backlog visibility
2. `.lore/issue...
- 06:33 commission-Octavia-20260410-063144 completed