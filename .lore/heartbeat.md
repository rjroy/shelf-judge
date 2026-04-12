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
- 11:59 commission-Dalton-20260412-115042 result: Phases 3-4 complete.

**Phase 3 (Remove from Collection page):**
- Removed `RedundancySettingsPanel` import (line 15) and render (line 119) from `packages/web/app/collection/page.tsx`
- Kept `getRedun...

- 12:00 commission-Dalton-20260412-115042 completed
- 12:05 commission-Thorne-20260412-115052 result: # Redundancy Settings Page Move: Review

- 12:05 commission-Thorne-20260412-115052 completed
## Verdict

Implementation is solid. All plan requirements satisfied. Two low-severity findings, one unverifiable item.

## Requirement Compliance

| # | Requi...