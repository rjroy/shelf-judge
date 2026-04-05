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
- 18:37 commission-Octavia-20260404-183308 result: Revised `.lore/specs/mvp.md` to align with the standard `specify` skill format. All content and decisions preserved; this was purely structural.

**Changes made:**

1. **Numbering scheme** (primary is...

- 18:37 commission-Octavia-20260404-183308 completed
- 18:56 commission-Octavia-20260404-184930 result: Restructured the MVP spec into a proper requirements document with extracted design documents.

**Part 1: Design extraction.** Created 6 design documents under `.lore/designs/`:
- `mvp-data-model.md` ...
- 18:56 commission-Octavia-20260404-184930 completed