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
- 13:54 commission-Octavia-20260412-135401 result: Color palette consolidation documentation updated. Status frontmatter changed to "completed" in `.lore/notes/color-system-consolidation.md` and all checklist items marked done. No dedicated issue file...

- 13:55 commission-Octavia-20260412-135401 completed
- 13:57 commission-Octavia-20260412-135052 result: Specification written at `.lore/specs/previously-owned.md` (32 requirements, REQ-PREV-1 through REQ-PREV-32).

Implements brainstorm Proposals 3 (Narrow Fix) and 5 (Collection Views):
- Data model: `o...
- 13:57 commission-Octavia-20260412-135052 completed