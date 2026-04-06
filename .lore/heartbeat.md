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
- 06:18 commission-Octavia-20260406-061358 result: Created responsive web plan at `.lore/plans/responsive-web.md`.

The plan covers:

**Audit findings:** Identified 7 specific layout failures at phone width (375px) and 4 at tablet (768px). The sidebar...

- 06:18 commission-Octavia-20260406-061358 completed