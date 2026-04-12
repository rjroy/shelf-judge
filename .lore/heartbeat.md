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
- 06:54 commission-Dalton-20260412-064124 result: Phases 1-4 of redundancy scoring implemented and verified.

**Phase 1 (Types)**: Added `ComponentWeights`, `RedundancyNeighbor`, `RedundancyAdjustment`, `RedundancySettings` to `packages/shared/src/ty...

- 06:55 commission-Dalton-20260412-064124 completed
- 06:55 commission-Sienna-20260412-064945 result: Created two HTML mockups for the Wishlist feature:

**`.lore/mockups/mockup-search-wishlist.html`** — Search page with wishlist integration
- Shows the updated Library nav group: Collection → Wishlist...
- 06:55 commission-Sienna-20260412-064945 completed