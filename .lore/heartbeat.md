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
- 10:08 commission-Octavia-20260411-100005 result: Created implementation plan for dark mode at `.lore/plans/dark-mode.md`.

The plan covers 9 steps: dark-mode CSS token overrides via `[data-theme="dark"]` block, theme context and localStorage persist...

- 10:09 commission-Octavia-20260411-100005 completed
- 10:10 commission-Octavia-20260411-100052 result: Created implementation plan at `.lore/plans/llm-narrative.md` for the LLM narrative feature (REQ-PROFILE-18 through REQ-PROFILE-28, REQ-PROFILE-34).

**Plan structure**: 5 phases across all four works...
- 10:10 commission-Dalton-20260411-100844 result: Color system migration verified complete. The previous commission had already applied all file changes correctly:

1. **`:root` block** - Already matches the canonical spec exactly (77 tokens, darkene...
- 10:11 commission-Octavia-20260411-100052 completed
- 10:11 commission-Dalton-20260411-100844 completed
- 10:15 commission-Octavia-20260411-100133 result: Created implementation plan at `.lore/plans/fix-community-stats.md` for fixing the empty community stats bug.

**Root cause identified:** BGG-sourced axis values (community rating, weight) are compute...
- 10:15 commission-Octavia-20260411-100133 completed
- 10:17 commission-Octavia-20260411-101401 result: Updated `.lore/plans/dark-mode.md` to reflect the post-migration color system state.

**Changes made:**

1. **Added post-migration baseline note** (line 32) documenting that the color consolidation la...
- 10:17 commission-Octavia-20260411-101401 completed