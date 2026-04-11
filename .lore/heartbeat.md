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
- 12:28 commission-Octavia-20260411-102358 result: Wrote the game-links spec at `.lore/specs/game-links.md`. The spec catalogs all 10 surfaces where game names appear in the web UI, makes explicit decisions about which ones get links (4 surfaces: prof...

- 12:29 commission-Octavia-20260411-102358 completed