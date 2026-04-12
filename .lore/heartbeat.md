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
- 11:10 commission-Octavia-20260412-110822 result: Plan written to `.lore/plans/redundancy-setting-move.md`.

Four phases:
1. **New page + sidebar entry** — Create `packages/web/app/redundancy/page.tsx`, add "Redundancy" to sidebar Settings group
2. *...

- 11:10 commission-Octavia-20260412-110822 completed
- 11:24 commission-Dalton-20260412-111644 result: Phases 1-5 of the wishlist feature implemented and verified.

**Phase 1: Shared Types** (`packages/shared/src/types.ts`)
- Added `WishlistBreakdownEntry` and `WishlistEntry` interfaces after redundanc...
- 11:24 commission-Dalton-20260412-111644 completed
- 11:28 commission-Thorne-20260412-111653 result: # Wishlist Backend Review (Phases 1-5)

- 11:28 commission-Thorne-20260412-111653 completed
## Summary

The implementation is solid and follows established project patterns. Types, storage, service, routes, and client helpers are all correctly wired. T...