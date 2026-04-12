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
- 11:28 commission-Celeste-20260412-112407 result: Brainstorm written to `.lore/brainstorms/previously-owned-state.md`. Six proposals exploring the previously-owned state from different angles:

1. **Ownership Status Field on Game** (Medium) - The ful...
- 11:28 commission-Celeste-20260412-112407 completed
- 11:37 commission-Dalton-20260412-111701 result: # Thorne's Review Findings: All Fixed

- 11:37 commission-Dalton-20260412-111701 completed
- 11:39 commission-Dalton-20260412-111723 result: Phase 9 complete. Created `packages/cli/src/commands/wishlist.ts` (5 commands) and registered them in `packages/cli/src/index.ts`.

Commands implemented:
- `wishlist list` - GET /api/wishlist, table o...
- 11:39 commission-Dalton-20260412-111723 completed
- 11:44 commission-Dalton-20260412-111714 result: # Phases 6-8: Web UI Complete

- 11:45 commission-Dalton-20260412-111714 completed
- 11:49 commission-Thorne-20260412-111733 result: # Wishlist Feature Review

- 11:49 commission-Thorne-20260412-111733 completed
- 11:53 commission-Dalton-20260412-111740 result: All six findings from Thorne's review addressed:

**Defect #1 (Refresh button stuck):** Changed `onRefresh` prop type to `Promise<void>` and added `.finally(() => setRefreshing(false))` to both refres...
- 11:53 commission-Dalton-20260412-111740 completed
## Verdict

The implementation satisfies all 29 spec requirements (REQ-WISH-1 through REQ-WISH-29). The backend is clean, well-tested, and correctly structured. Two UI state...
## Phase 6: Search Page Wishlist Button (`packages/web/app/search/page.tsx`)
- Added `wishlistedIds` state (`Set<number>`) populated from `GET /api/daemon/wishlist` on m...
## Finding 1: DEFECT — Auto-removal race condition (games.ts:144-145)
**Fix:** Added `await` to `wishlistService.removeByBggId()` call. The `.catch(() => {})` st...
## Summary

The implementation is solid and follows established project patterns. Types, storage, service, routes, and client helpers are all correctly wired. T...