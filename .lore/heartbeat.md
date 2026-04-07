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
- 08:05 commission-Octavia-20260407-075859 result: Wrote spec at `.lore/specs/collection-filter-sort.md` with 30 requirements (CFS-1 through CFS-30) and 10 success criteria.

**Open questions from brainstorm, resolved:**
- Axis sort grouping: Yes, the...

- 08:05 commission-Octavia-20260407-075859 completed
- 08:11 commission-Octavia-20260407-080800 result: Implementation plan written to `.lore/plans/collection-filter-sort.md`.

Five sequential phases covering all 30 requirements from the spec:

1. **Sort State and Dropdown** — Creates `CollectionTable` ...
- 08:11 commission-Octavia-20260407-080800 completed
- 08:20 commission-Dalton-20260407-081514 result: Phases 1 and 2 of collection filter/sort implemented. All verification passes: typecheck clean, lint clean, 398 tests pass (0 fail).

**Phase 1 (Sort State and Dropdown):**
- Created `packages/web/lib...
- 08:20 commission-Dalton-20260407-081514 completed