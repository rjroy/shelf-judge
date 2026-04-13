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
- 15:10 commission-Dalton-20260413-150005 result: Phase 1 complete. All shared types added and all Game construction sites updated.

**Types added** (`packages/shared/src/types.ts`):
- `BoxDimensions` (width/height/depth in inches)
- `Shelf` (id, nam...

- 15:10 commission-Dalton-20260413-150005 completed
- 15:13 commission-Thorne-20260413-150014 result: ## Limitation: No Shell Access

I cannot run `bun run typecheck` or `bun run lint` directly. I do not have shell/bash execution capability in this environment. I performed a thorough manual static ana...
- 15:15 commission-Thorne-20260413-150014 result: ## Review: Shelf Capacity Foundation Types (Phase 1)

**Verdict: Approved with one required fix for Phase 2 readiness.**

### Spec Compliance (REQ-SHELF-1 through REQ-SHELF-3, REQ-SHELF-8 through REQ-...
- 15:15 commission-Thorne-20260413-150014 completed
- 15:16 commission-Dalton-20260413-150034 result: Both Thorne findings addressed:

1. **[Required] Missing barrel exports** — Added `BoxDimensions`, `Shelf`, `ShelfUnit`, `ShelfConfiguration` to the type export block in `packages/shared/src/index.ts`...
- 15:16 commission-Dalton-20260413-150034 completed
- 15:21 commission-Dalton-20260413-150049 result: Phase 5d complete: added box dimension flags to the CLI.

Changes made to two files:

1. `packages/cli/src/commands/game.ts` - Added `gameEdit` function after `gameSetStatus`. Validates that all three...
- 15:22 commission-Dalton-20260413-150049 result: Implemented Phase 5a-5c: box dimensions display and edit in the web UI.

Changes made:

1. **packages/web/lib/api.ts** - Added `setGameDimensions` function after `setGameOwnership`, imported `BoxDimen...
- 15:22 commission-Dalton-20260413-150240 result: Implemented Phase 8: standalone bin-packing algorithm in `packages/daemon/src/services/bin-packing.ts` with 51 tests in `packages/daemon/tests/bin-packing.test.ts`.

**Module**: `packages/daemon/src/s...
- 15:22 commission-Dalton-20260413-150240 completed
- 15:23 commission-Dalton-20260413-150131 result: Implemented Phases 3 and 4 of the shelf capacity feature: shelf configuration backend.

**Phase 3: Storage + Service**
- Added `loadShelfConfig`/`saveShelfConfig` to `StorageService` interface and imp...
- 15:23 commission-Dalton-20260413-150049 result: Implemented PUT /games/:id/dimensions endpoint for Phase 2 of the shelf capacity feature.

Changes:
1. Added `setBoxDimensions(id, dimensions)` to the `GameService` interface and its implementation in...
- 15:23 commission-Dalton-20260413-150131 completed