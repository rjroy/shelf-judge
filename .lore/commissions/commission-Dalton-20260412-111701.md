---
title: "Commission: Wishlist: Fix Backend Review Findings"
date: 2026-04-12
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Read Thorne's review of the wishlist backend implementation. The review commission is `commission-Thorne-20260412-111653`. Check its result for findings.\n\nAlso read the plan at `.lore/plans/wishlist.md` and spec at `.lore/specs/wishlist.md` for context.\n\nAddress ALL findings from the review before doing anything else. Every finding gets fixed, no exceptions.\n\nAfter fixing all findings, run `bun run test`, `bun run typecheck`, and `bun run lint` to verify everything passes."
dependencies:
  - commission-Thorne-20260412-111653
linked_artifacts:
  - packages/daemon/src/routes/games.ts

  - packages/daemon/src/services/wishlist-service.ts
  - packages/daemon/tests/wishlist-routes.test.ts
  - packages/daemon/tests/wishlist-service.test.ts
  - packages/shared/src/index.ts
  - packages/daemon/tests/profile-service.test.ts
  - packages/daemon/tests/tournament-service.test.ts
  - packages/daemon/src/services/wishlist-service.ts
  - packages/daemon/tests/wishlist-routes.test.ts
  - packages/daemon/tests/wishlist-service.test.ts
  - packages/shared/src/index.ts
  - packages/daemon/tests/profile-service.test.ts
  - packages/daemon/tests/tournament-service.test.ts
activity_timeline:
  - timestamp: 2026-04-12T18:17:01.782Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T18:17:01.783Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T18:28:52.378Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T18:28:52.383Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T18:28:52.405Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T18:29:06.589Z
    event: progress_report
    reason: "Read Thorne's review. Three findings: (1) DEFECT: missing await on auto-removal in POST /games, (2) GAP: four missing test cases, (3) STYLE: predictionConfidence null gate. Reading affected files now."
  - timestamp: 2026-04-12T18:30:49.806Z
    event: progress_report
    reason: "All three findings fixed: (1) awaited auto-removal in games.ts, (2) explicit isUnavailable gate on predictionConfidence, (3) added four missing test cases plus auto-removal edge case. Running test/typecheck/lint."
  - timestamp: 2026-04-12T18:37:23.562Z
    event: result_submitted
    reason: "# Thorne's Review Findings: All Fixed\n\n## Finding 1: DEFECT — Auto-removal race condition (games.ts:144-145)\n**Fix:** Added `await` to `wishlistService.removeByBggId()` call. The `.catch(() => {})` stays (error suppression is intentional), but the response now waits for the wishlist write to complete before returning 201.\n\n## Finding 2: GAP — Four missing test cases (wishlist-routes.test.ts)\n**Added 5 new tests** (17 total, up from 12):\n- POST /api/wishlist with bggId in collection returns 409\n- POST /games auto-removes matching wishlist entry (REQ-WISH-10)\n- POST /games without bggId does not touch wishlist (edge case)\n- Wishlist entries do not appear in GET /games\n- Wishlist entries do not affect profile computation\n\n## Finding 3: STYLE — predictionConfidence null gate (wishlist-service.ts:49)\n**Fix:** Changed `result.score.predictionMeta?.confidence ?? null` to `isUnavailable ? null : (result.score.predictionMeta?.confidence ?? null)`, making the null contract explicit and consistent with `predictedScore`.\n\n## Additional fixes discovered during verification\n- Exported `WishlistEntry` and `WishlistBreakdownEntry` from `packages/shared/src/index.ts` (missing from initial implementation)\n- Fixed `FitnessBreakdownEntry.confidence` → `predictionConfidence` mapping in `wishlist-service.ts:38` (type mismatch, field was renamed)\n- Fixed stale type fixtures in `wishlist-service.test.ts` (BggGameData, FitnessResult, FitnessBreakdownEntry, PredictionMeta shapes)\n- Added `importBggCollection` to GameService mocks in `wishlist-service.test.ts`\n- Added `loadWishlist`/`saveWishlist` stubs to StorageService mocks in `profile-service.test.ts` and `tournament-service.test.ts`\n- Removed unused `gameService` destructuring in `wishlist-service.ts`\n\n## Verification\n- `bun run test`: 1013 pass, 1 skip, 0 fail\n- `bun run typecheck`: clean\n- `bun run lint`: clean"
  - timestamp: 2026-04-12T18:37:27.236Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All three findings fixed: (1) awaited auto-removal in games.ts, (2) explicit isUnavailable gate on predictionConfidence, (3) added four missing test cases plus auto-removal edge case. Running test/typecheck/lint."
projectName: shelf-judge
---
# Thorne's Review Findings: All Fixed

## Finding 1: DEFECT — Auto-removal race condition (games.ts:144-145)
**Fix:** Added `await` to `wishlistService.removeByBggId()` call. The `.catch(() => {})` stays (error suppression is intentional), but the response now waits for the wishlist write to complete before returning 201.

## Finding 2: GAP — Four missing test cases (wishlist-routes.test.ts)
**Added 5 new tests** (17 total, up from 12):
- POST /api/wishlist with bggId in collection returns 409
- POST /games auto-removes matching wishlist entry (REQ-WISH-10)
- POST /games without bggId does not touch wishlist (edge case)
- Wishlist entries do not appear in GET /games
- Wishlist entries do not affect profile computation

## Finding 3: STYLE — predictionConfidence null gate (wishlist-service.ts:49)
**Fix:** Changed `result.score.predictionMeta?.confidence ?? null` to `isUnavailable ? null : (result.score.predictionMeta?.confidence ?? null)`, making the null contract explicit and consistent with `predictedScore`.

## Additional fixes discovered during verification
- Exported `WishlistEntry` and `WishlistBreakdownEntry` from `packages/shared/src/index.ts` (missing from initial implementation)
- Fixed `FitnessBreakdownEntry.confidence` → `predictionConfidence` mapping in `wishlist-service.ts:38` (type mismatch, field was renamed)
- Fixed stale type fixtures in `wishlist-service.test.ts` (BggGameData, FitnessResult, FitnessBreakdownEntry, PredictionMeta shapes)
- Added `importBggCollection` to GameService mocks in `wishlist-service.test.ts`
- Added `loadWishlist`/`saveWishlist` stubs to StorageService mocks in `profile-service.test.ts` and `tournament-service.test.ts`
- Removed unused `gameService` destructuring in `wishlist-service.ts`

## Verification
- `bun run test`: 1013 pass, 1 skip, 0 fail
- `bun run typecheck`: clean
- `bun run lint`: clean
