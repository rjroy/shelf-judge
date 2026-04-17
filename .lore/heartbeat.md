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
- 20:38 commission-Dalton-20260413-150333 result: Phases 10b-10e and 11 complete.

**Phase 10b — Collection indicator:** Added `CapacityIndicator` client-agnostic component rendering four states (success/warning/danger/neutral). Wired into `app/colle...

- 20:38 commission-Dalton-20260413-150333 completed
- 20:46 commission-Thorne-20260413-150348 result: 
# Review: Shelf Capacity Integration (Phases 9–11)

Scope: capacity-service adapter, GET /shelf/capacity endpoint, web collection indicator, web /capacity detail page, client helpers, CLI shelf comma...
- 20:46 commission-Thorne-20260413-150348 completed