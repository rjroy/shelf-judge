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
- 19:16 commission-Dalton-20260405-190619 result: Implemented Steps 4-8 of the visual transition plan. All 5 screens restyled from inline styles to CSS class-based styling using design tokens from globals.css:

- **Collection View** (page.tsx): Stats...

- 19:16 commission-Dalton-20260405-190619 completed
- 19:26 commission-Dalton-20260405-190626 result: Steps 9-10 of the visual transition plan are complete.

**Step 9: Icon and Favicon**
- Copied `.lore/art/icon.webp` to `packages/web/public/icon.webp` (favicon-32.png and favicon-16.png do not exist y...
- 19:26 commission-Dalton-20260405-190626 completed
- 19:31 commission-Thorne-20260405-190638 result: # Visual Validation Review — Shelf Judge Web UI

- 19:32 commission-Thorne-20260405-190638 completed
- 19:37 commission-Dalton-20260405-190645 result: All 7 findings from Thorne's visual validation review addressed:

**Defects fixed:**
1. **Missing scroll wrapper** — Collection page content now wrapped in `<div className="main-scroll">` after the to...
- 19:37 commission-Dalton-20260405-190645 completed
## Summary

The visual transition is substantially complete. Token system, font loading, sidebar, buttons, badges, score spectrum, and all five screens...