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
- 18:01 commission-Dalton-20260412-174410 result: Phases 1-3 of the previously-owned feature are implemented and verified.

**Phase 1: Shared Types and Schema Default**
- Added `OwnershipStatus` type ("owned" | "previously-owned") and `ownership` fie...

- 18:01 commission-Dalton-20260412-174410 completed
- 18:06 commission-Thorne-20260412-174419 result: # Review: Previously-Owned Feature (Phases 1-3)

- 18:06 commission-Thorne-20260412-174419 completed
- 18:11 commission-Dalton-20260412-174425 result: All five Thorne findings addressed in `packages/daemon/tests/ownership-routes.test.ts`:

**F1** (wishlist blocks previously-owned): Added test that marks a game as previously-owned and verifies `POST ...
- 18:11 commission-Dalton-20260412-174425 completed
- 18:14 commission-Dalton-20260412-174506 result: Phase 6 CLI commands implemented. All three requirements covered:

**6a: `gameSetStatus` command** (`packages/cli/src/commands/game.ts:232-257`)
- `shelf-judge game set-status <id> <owned|previously-o...
- 18:14 commission-Dalton-20260412-174506 completed
- 18:15 commission-Dalton-20260412-174450 result: Phase 5 (game detail page UI) implemented. Changes:

**`packages/web/app/games/[id]/page.tsx`**:
- Added `isPreviouslyOwned` flag derived from `game.ownership`
- Hero section now uses a title row (`ga...
- 18:15 commission-Dalton-20260412-174450 completed
- 18:17 commission-Dalton-20260412-174440 result: Phase 4 (collection page UI) implemented across 3 files.

**`packages/web/app/collection/page.tsx`:**
- Accepts `searchParams` prop (Next.js 16 async pattern)
- Reads `?ownership=all` to determine whe...
- 18:18 commission-Dalton-20260412-174440 completed
## Verdict

The foundation implementation is solid. The critical integration point (ownership filter vs. niche/redundancy computation universe) is corr...