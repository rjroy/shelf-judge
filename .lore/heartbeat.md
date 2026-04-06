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
- 13:03 commission-Dalton-20260406-125612 result: All 8 BGG client robustness issues verified and resolved. 230 tests pass, typecheck and lint clean.

**Item 1** (429 unbounded recursion): Already fixed. No change needed.

**Item 2** (429 recovery): ...

- 13:03 commission-Dalton-20260406-125612 completed
- 13:11 commission-Octavia-20260406-130316 result: Wrote tournament ranking specification at `.lore/specs/tournament-ranking.md` (20 requirements, REQ-TOURN-1 through REQ-TOURN-20 plus REQ-TOURN-15a).

**Positions taken on the three open questions:**
...
- 13:11 commission-Octavia-20260406-130316 completed
- 13:11 commission-Dalton-20260406-130842 result: Created `toErrorMessage(err: unknown): string` in `packages/shared/src/errors.ts`, exported from the shared package's public API. Wrote 7 tests covering Error, TypeError, string, number, null, undefin...
- 13:11 commission-Dalton-20260406-130842 completed