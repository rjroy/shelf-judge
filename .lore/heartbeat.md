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
- 15:15 commission-Dalton-20260411-150729 result: ## Game Links Spec Compliance Review

### Requirement Status

All eight requirements pass. All negative requirements pass. All success criteria are met in the implementation code. Test quality has two...

- 15:17 commission-Dalton-20260411-150729 completed
- 15:30 commission-Octavia-20260411-152612 result: Wrote the Niche Champion Display spec at `.lore/specs/niche-champion-display.md`. 33 requirements (REQ-NICHE-1 through REQ-NICHE-33) covering:

- **Niche definition** (REQ-NICHE-1 through 3): Cluster-...
- 15:30 commission-Octavia-20260411-152612 completed
- 15:58 commission-Dalton-20260411-154717 result: ## Review: Fix Empty Community Stats Implementation

All 6 plan goals are satisfied. All 861 tests pass. One defect found, one observation.

### Defect: Histogram bucketing incorrect for non-1-10 scal...
- 15:59 commission-Dalton-20260411-154717 completed