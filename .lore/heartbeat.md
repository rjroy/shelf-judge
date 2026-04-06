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
- 08:13 commission-Dalton-20260406-062857 result: Step 8 complete. CSS cleanup and responsive audit done.

**Changes made:**
- Added `html { overflow-x: hidden; }` safety net to `packages/web/app/globals.css` (line 75)

**Audit findings (no issues fo...

- 08:13 commission-Dalton-20260406-062857 completed