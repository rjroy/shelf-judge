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
- 14:45 commission-Celeste-20260411-143938 result: Brainstorm artifact written to `.lore/brainstorms/redundancy-scoring.md` with 6 proposals for redundancy/collection-awareness scoring:

1. **Post-Score Redundancy Penalty via Pairwise Similarity** (Me...

- 14:45 commission-Celeste-20260411-143938 completed
- 14:47 commission-Dalton-20260411-143524 result: Dark mode implemented across all 9 plan steps. All verification checks pass: typecheck, lint, tests (834 tests, 0 failures), and both color enforcement greps return zero matches.

**What was built:**
...
- 14:47 commission-Octavia-20260411-144148 result: Created implementation plan at `.lore/plans/game-links.md` for the game links feature. The plan covers all 8 requirements (REQ-GLINK-1 through REQ-GLINK-8) across 8 steps:

- Steps 1-4: Add `<Link>` c...
- 14:47 commission-Dalton-20260411-143524 completed
- 14:47 commission-Octavia-20260411-144148 completed