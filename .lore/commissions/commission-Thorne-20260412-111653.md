---
title: "Commission: Wishlist: Review Backend (Phases 1-5)"
date: 2026-04-12
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the backend implementation of the wishlist feature (Phases 1-5).\n\nRead the plan at `.lore/plans/wishlist.md` and spec at `.lore/specs/wishlist.md` first.\n\nThen review the implementation across:\n- `packages/shared/src/types.ts` (new wishlist types)\n- `packages/daemon/src/services/storage-service.ts` (loadWishlist/saveWishlist)\n- `packages/daemon/src/services/wishlist-service.ts` (new file)\n- `packages/daemon/src/routes/wishlist.ts` (new file)\n- `packages/daemon/src/routes/games.ts` (auto-removal addition)\n- `packages/daemon/src/app.ts` (wiring)\n- `packages/web/lib/api.ts` (client helpers)\n- All new test files\n\nReview attention points from the plan:\n1. Phase 3b: Does the mapping from `PredictedGameResult` + `NicheImpact` to `WishlistEntry` cover all fields correctly, especially null cases (Stage 0, no niche impact)?\n2. Phase 4b: Is auto-removal fire-and-forget? Does it only trigger when `bggId` is present?\n3. Route ordering: Is `POST /wishlist/refresh` registered before `POST /wishlist/:id/refresh`?\n4. Do client helpers in `packages/web/lib/api.ts` cover ALL six endpoints?\n5. Test coverage: Are all test cases from the plan's Phase 10 section present?\n6. Does the web proxy handle DELETE?\n\nSurface ALL findings. Do not triage or defer anything."
dependencies:
  - commission-Dalton-20260412-111644
linked_artifacts:
  - .lore/specs/wishlist.md

  - .lore/plans/wishlist.md
  - packages/daemon/src/services/wishlist-service.ts
  - packages/daemon/src/routes/wishlist.ts
  - packages/daemon/src/routes/games.ts
  - packages/daemon/src/app.ts
  - packages/web/lib/api.ts
  - packages/daemon/tests/wishlist-service.test.ts
  - packages/daemon/tests/wishlist-routes.test.ts
  - .lore/plans/wishlist.md
  - packages/daemon/src/services/wishlist-service.ts
  - packages/daemon/src/routes/wishlist.ts
  - packages/daemon/src/routes/games.ts
  - packages/daemon/src/app.ts
  - packages/web/lib/api.ts
  - packages/daemon/tests/wishlist-service.test.ts
  - packages/daemon/tests/wishlist-routes.test.ts
activity_timeline:
  - timestamp: 2026-04-12T18:16:53.654Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T18:16:53.656Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T18:24:50.788Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T18:24:50.790Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T18:24:50.812Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T18:25:01.438Z
    event: progress_report
    reason: "Read spec and plan. Now reading implementation files across all packages."
  - timestamp: 2026-04-12T18:25:25.076Z
    event: progress_report
    reason: "Read all implementation and test files. Now checking prediction service types and niche impact handling to verify the snapshot extraction logic."
  - timestamp: 2026-04-12T18:26:34.111Z
    event: progress_report
    reason: "All source files read. Compiling findings against spec requirements and plan attention points."
  - timestamp: 2026-04-12T18:28:45.691Z
    event: result_submitted
    reason: "# Wishlist Backend Review (Phases 1-5)\n\n## Summary\n\nThe implementation is solid and follows established project patterns. Types, storage, service, routes, and client helpers are all correctly wired. Two findings require action, one is a code clarity improvement, and the rest are passes.\n\n---\n\n## Findings (Priority Order)\n\n### 1. DEFECT — Auto-removal race condition in POST /games\n\n**File:** `packages/daemon/src/routes/games.ts:144-145`\n\n```typescript\n// REQ-WISH-10: auto-remove matching wishlist entry (fire-and-forget)\nif (parsed.data.bggId && wishlistService) {\n  wishlistService.removeByBggId(parsed.data.bggId).catch(() => {});\n}\n```\n\nThe `removeByBggId` promise is not awaited. The HTTP response at line 148 returns before the wishlist write completes. A client that adds a game and immediately GETs the wishlist will see a stale entry. The `.catch(() => {})` is correct (prevents add-game from failing if wishlist removal fails), but `await` is missing.\n\n**Fix:** `await wishlistService.removeByBggId(parsed.data.bggId).catch(() => {});`\n\n**Impact:** The web UI flow (REQ-WISH-23) navigates to the game detail page after add, so users are unlikely to observe this in practice. But the race is real and would surface in CLI workflows or automated testing.\n\n---\n\n### 2. GAP — Four test cases from the plan's Phase 10 are missing\n\n**File:** `packages/daemon/tests/wishlist-routes.test.ts`\n\nThe plan's Phase 10 lists these route-level tests that are absent:\n\n| Missing Test | Plan Reference | Priority |\n|---|---|---|\n| POST /games auto-removes matching wishlist entry | \"Adding a game to collection auto-removes matching wishlist entry\" | High — covers the cross-feature integration point (REQ-WISH-10). Would have caught finding #1. |\n| POST /api/wishlist with bggId in collection returns 409 | \"POST in-collection returns 409\" | Medium — the service-level test covers this, but there's no route-level validation that the 409 status is returned correctly through the error-matching logic. |\n| Wishlist entries do not appear in GET /games | \"Wishlist entries do not appear in GET /games\" | Low — this is structurally guaranteed (separate storage), but the spec success criteria lists it. |\n| Wishlist entries do not affect profile computation | \"Wishlist entries do not affect profile computation\" | Low — same structural guarantee. |\n\nThe first case is highest priority because it exercises the only cross-module integration point.\n\n---\n\n### 3. STYLE — predictionConfidence null value is coincidental, not explicit\n\n**File:** `packages/daemon/src/services/wishlist-service.ts:48-49`\n\n```typescript\npredictedScore: isUnavailable ? null : result.score.score,\npredictionConfidence: result.score.predictionMeta?.confidence ?? null,\n```\n\n`predictedScore` is explicitly gated on `isUnavailable`. `predictionConfidence` is not. These arrive at the same result because the prediction engine sets `predictionMeta: null` when unavailable, but the code relies on an invariant from a different module rather than expressing intent directly.\n\n**Suggested fix:** `predictionConfidence: isUnavailable ? null : result.score.predictionMeta?.confidence ?? null`\n\n**Impact:** No runtime defect given current prediction engine behavior. Code clarity improvement that makes the null contract self-documenting.\n\n---\n\n## Verified Requirements\n\n| Requirement | Status | Evidence |\n|---|---|---|\n| REQ-WISH-1 (entry shape) | PASS | types.ts:515-534 matches spec exactly |\n| REQ-WISH-2 (shared types) | PASS | Types in packages/shared, consumed by daemon and web |\n| REQ-WISH-3 (BGG-only, duplicate rejection) | PASS | wishlist-service.ts:76-78, tested |\n| REQ-WISH-4 (snapshot, not live) | PASS | Entry stores snapshot fields, no live refresh mechanism |\n| REQ-WISH-5 (add with prediction) | PASS | wishlist-service.ts:74-96, Stage 0 null case handled |\n| REQ-WISH-6 (reject if in collection) | PASS | wishlist-service.ts:80-83, tested |\n| REQ-WISH-7 (no BGG data persistence) | PASS | Only WishlistEntry fields persisted |\n| REQ-WISH-8 (remove) | PASS | wishlist-service.ts:98-106 |\n| REQ-WISH-9 (clear) | PASS | wishlist-service.ts:108-113 |\n| REQ-WISH-10 (auto-remove on collection add) | PARTIAL | Implemented but has race condition (finding #1) |\n| REQ-WISH-11 (refresh preserves addedAt) | PASS | wishlist-service.ts:131-133, tested |\n| REQ-WISH-12 (bulk refresh with error reporting) | PASS | wishlist-service.ts:140-168, tested |\n| REQ-WISH-13 (separate wishlist.json) | PASS | storage-service.ts uses data dir + wishlist.json |\n| REQ-WISH-14 (atomic write) | PASS | Uses atomicWrite pattern |\n| REQ-WISH-15 (six API endpoints) | PASS | All six in wishlist.ts |\n| REQ-WISH-16 (request/response shapes) | PASS | Match spec |\n| REQ-WISH-17 (route module pattern) | PASS | Follows RouteModule + OperationDefinition pattern |\n| REQ-WISH-28 (no collection side effects) | PASS | Wishlist service reads collection but doesn't modify it |\n| REQ-WISH-29 (read-only prediction) | PASS | Uses predictBggGame which doesn't persist |\n\n### Plan Attention Points\n\n| Point | Status |\n|---|---|\n| Phase 3b mapping correctness | PASS (with style note on predictionConfidence) |\n| Phase 4b fire-and-forget | DEFECT (race condition, finding #1) |\n| Route ordering | PASS (refresh before :id/refresh) |\n| Client helpers cover all six endpoints | PASS |\n| Phase 10 test cases present | PARTIAL (four missing, finding #2) |\n| Web proxy handles DELETE | PASS |\n"
  - timestamp: 2026-04-12T18:28:52.179Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All source files read. Compiling findings against spec requirements and plan attention points."
projectName: shelf-judge
---
# Wishlist Backend Review (Phases 1-5)

## Summary

The implementation is solid and follows established project patterns. Types, storage, service, routes, and client helpers are all correctly wired. Two findings require action, one is a code clarity improvement, and the rest are passes.

---

## Findings (Priority Order)

### 1. DEFECT — Auto-removal race condition in POST /games

**File:** `packages/daemon/src/routes/games.ts:144-145`

```typescript
// REQ-WISH-10: auto-remove matching wishlist entry (fire-and-forget)
if (parsed.data.bggId && wishlistService) {
  wishlistService.removeByBggId(parsed.data.bggId).catch(() => {});
}
```

The `removeByBggId` promise is not awaited. The HTTP response at line 148 returns before the wishlist write completes. A client that adds a game and immediately GETs the wishlist will see a stale entry. The `.catch(() => {})` is correct (prevents add-game from failing if wishlist removal fails), but `await` is missing.

**Fix:** `await wishlistService.removeByBggId(parsed.data.bggId).catch(() => {});`

**Impact:** The web UI flow (REQ-WISH-23) navigates to the game detail page after add, so users are unlikely to observe this in practice. But the race is real and would surface in CLI workflows or automated testing.

---

### 2. GAP — Four test cases from the plan's Phase 10 are missing

**File:** `packages/daemon/tests/wishlist-routes.test.ts`

The plan's Phase 10 lists these route-level tests that are absent:

| Missing Test | Plan Reference | Priority |
|---|---|---|
| POST /games auto-removes matching wishlist entry | "Adding a game to collection auto-removes matching wishlist entry" | High — covers the cross-feature integration point (REQ-WISH-10). Would have caught finding #1. |
| POST /api/wishlist with bggId in collection returns 409 | "POST in-collection returns 409" | Medium — the service-level test covers this, but there's no route-level validation that the 409 status is returned correctly through the error-matching logic. |
| Wishlist entries do not appear in GET /games | "Wishlist entries do not appear in GET /games" | Low — this is structurally guaranteed (separate storage), but the spec success criteria lists it. |
| Wishlist entries do not affect profile computation | "Wishlist entries do not affect profile computation" | Low — same structural guarantee. |

The first case is highest priority because it exercises the only cross-module integration point.

---

### 3. STYLE — predictionConfidence null value is coincidental, not explicit

**File:** `packages/daemon/src/services/wishlist-service.ts:48-49`

```typescript
predictedScore: isUnavailable ? null : result.score.score,
predictionConfidence: result.score.predictionMeta?.confidence ?? null,
```

`predictedScore` is explicitly gated on `isUnavailable`. `predictionConfidence` is not. These arrive at the same result because the prediction engine sets `predictionMeta: null` when unavailable, but the code relies on an invariant from a different module rather than expressing intent directly.

**Suggested fix:** `predictionConfidence: isUnavailable ? null : result.score.predictionMeta?.confidence ?? null`

**Impact:** No runtime defect given current prediction engine behavior. Code clarity improvement that makes the null contract self-documenting.

---

## Verified Requirements

| Requirement | Status | Evidence |
|---|---|---|
| REQ-WISH-1 (entry shape) | PASS | types.ts:515-534 matches spec exactly |
| REQ-WISH-2 (shared types) | PASS | Types in packages/shared, consumed by daemon and web |
| REQ-WISH-3 (BGG-only, duplicate rejection) | PASS | wishlist-service.ts:76-78, tested |
| REQ-WISH-4 (snapshot, not live) | PASS | Entry stores snapshot fields, no live refresh mechanism |
| REQ-WISH-5 (add with prediction) | PASS | wishlist-service.ts:74-96, Stage 0 null case handled |
| REQ-WISH-6 (reject if in collection) | PASS | wishlist-service.ts:80-83, tested |
| REQ-WISH-7 (no BGG data persistence) | PASS | Only WishlistEntry fields persisted |
| REQ-WISH-8 (remove) | PASS | wishlist-service.ts:98-106 |
| REQ-WISH-9 (clear) | PASS | wishlist-service.ts:108-113 |
| REQ-WISH-10 (auto-remove on collection add) | PARTIAL | Implemented but has race condition (finding #1) |
| REQ-WISH-11 (refresh preserves addedAt) | PASS | wishlist-service.ts:131-133, tested |
| REQ-WISH-12 (bulk refresh with error reporting) | PASS | wishlist-service.ts:140-168, tested |
| REQ-WISH-13 (separate wishlist.json) | PASS | storage-service.ts uses data dir + wishlist.json |
| REQ-WISH-14 (atomic write) | PASS | Uses atomicWrite pattern |
| REQ-WISH-15 (six API endpoints) | PASS | All six in wishlist.ts |
| REQ-WISH-16 (request/response shapes) | PASS | Match spec |
| REQ-WISH-17 (route module pattern) | PASS | Follows RouteModule + OperationDefinition pattern |
| REQ-WISH-28 (no collection side effects) | PASS | Wishlist service reads collection but doesn't modify it |
| REQ-WISH-29 (read-only prediction) | PASS | Uses predictBggGame which doesn't persist |

### Plan Attention Points

| Point | Status |
|---|---|
| Phase 3b mapping correctness | PASS (with style note on predictionConfidence) |
| Phase 4b fire-and-forget | DEFECT (race condition, finding #1) |
| Route ordering | PASS (refresh before :id/refresh) |
| Client helpers cover all six endpoints | PASS |
| Phase 10 test cases present | PARTIAL (four missing, finding #2) |
| Web proxy handles DELETE | PASS |


## Decisions

**Is the auto-removal in POST /games properly implemented?**
DEFECT: Auto-removal is fire-and-forget but not awaited, creating a race condition.
*Reasoning: At games.ts:144-145, `wishlistService.removeByBggId(parsed.data.bggId).catch(() => {})` is called without `await`. The HTTP response at line 148 returns before the wishlist write completes. A client that adds a game and immediately GETs the wishlist could see a stale entry. The `.catch(() => {})` is correct (prevents add-game from failing if wishlist removal fails), but the `await` is missing. Should be `await wishlistService.removeByBggId(parsed.data.bggId).catch(() => {})`. The plan says "fire-and-forget" meaning "don't error if removal fails," not "don't wait for it to complete."*

**Are all test cases from Phase 10 present?**
GAP: Four route-level test cases from the plan's Phase 10 are missing.
*Reasoning: The plan's Phase 10 lists these route-level tests that are absent from wishlist-routes.test.ts:
1. "POST in-collection returns 409" — the mock service doesn't simulate collection conflict, only wishlist duplicate
2. "Wishlist entries do not appear in GET /games" — no integration test verifying collection isolation
3. "Wishlist entries do not affect profile computation" — no test verifying REQ-WISH-28
4. "Adding a game to collection auto-removes matching wishlist entry" — the most critical missing test, would have caught the race condition in finding #1

Cases 2-4 require integration-level tests crossing route boundaries. The route test file tests only the wishlist routes in isolation. The auto-removal test is the highest priority gap because it covers the only cross-feature integration point (REQ-WISH-10).*

**Is the predictionConfidence null handling consistent with predictedScore for Stage 0?**
STYLE: predictionConfidence derives its null value by coincidence rather than by explicit gate.
*Reasoning: In wishlist-service.ts buildEntry (lines 48-49):
- `predictedScore: isUnavailable ? null : result.score.score` — explicitly gated on `isUnavailable`
- `predictionConfidence: result.score.predictionMeta?.confidence ?? null` — NOT gated on `isUnavailable`

These arrive at the same result because the prediction engine sets `predictionMeta: null` when unavailable. But the code relies on an invariant from a different module rather than expressing intent directly. If the prediction engine ever set `predictionMeta` on an unavailable result, `predictionConfidence` would be non-null while `predictedScore` is null. The fix is trivial: `predictionConfidence: isUnavailable ? null : result.score.predictionMeta?.confidence ?? null`.*

**Does the route ordering prevent /refresh from being parsed as :id?**
PASS: Route ordering is correct.
*Reasoning: In wishlist.ts, `POST /wishlist/refresh` is registered at line 70, before `POST /wishlist/:id/refresh` at line 80. This prevents "refresh" from being captured as `:id`. Same pattern as games.ts where `POST /games/refresh` precedes `POST /games/:id/refresh`.*

**Do client helpers cover all six endpoints?**
PASS: All six endpoints have corresponding client helpers.
*Reasoning: api.ts:298-323 defines: listWishlist (GET /api/wishlist), addToWishlist (POST /api/wishlist), removeFromWishlist (DELETE /api/wishlist/:id), clearWishlist (DELETE /api/wishlist), refreshWishlistEntry (POST /api/wishlist/:id/refresh), refreshAllWishlist (POST /api/wishlist/refresh). Types are re-exported at lines 348-349.*

**Does the web proxy handle DELETE for wishlist?**
PASS: DELETE is handled by the proxy.
*Reasoning: packages/web/app/api/daemon/[...path]/route.ts exports a DELETE handler at lines 70-75. The proxy forwards all HTTP methods including DELETE to the daemon.*

**Does the WishlistEntry type match the spec (REQ-WISH-1)?**
PASS: Types match the spec exactly.
*Reasoning: packages/shared/src/types.ts:515-534 defines WishlistBreakdownEntry and WishlistEntry with all fields matching REQ-WISH-1: id, bggId, name, yearPublished, thumbnailUrl, predictedScore, predictionConfidence, predictedBreakdown, nicheImpact, addedAt. Types are correct including nullability.*

**Does the storage layer follow the atomic write pattern (REQ-WISH-14)?**
PASS: Storage uses atomicWrite and returns [] for missing file.
*Reasoning: storage-service.ts lines 232-244: loadWishlist returns [] when file doesn't exist (correct for empty wishlist). saveWishlist writes via atomicWrite (temp file + rename pattern). File path is wishlist.json in the data directory per REQ-WISH-13.*

**Does the wishlist service correctly map NicheImpact including the null case?**
PASS: NicheImpact null handling is correct.
*Reasoning: wishlist-service.ts:51: `nicheImpact: nicheImpact.wouldJoin.length > 0 ? nicheImpact : null`. When no niches are impacted (empty wouldJoin array), the entry stores null. This matches REQ-WISH-1's `nicheImpact: NicheImpact | null` and the plan's instruction "Null if no entries."*

**Does the app.ts wiring correctly connect wishlist service to both wishlist routes and game routes?**
PASS: Wiring is correct.
*Reasoning: app.ts:54-58 creates wishlistService. Line 66 passes it to createGameRoutes. Line 76 passes it to createWishlistRoutes. The wishlist route module is registered at line 115. The game routes receive wishlistService for auto-removal (REQ-WISH-10).*

**Does the GET /wishlist route return entries sorted by addedAt descending per the spec's success criteria?**
OBSERVATION: Sorting happens in the route, not the service. The service list() returns unsorted entries.
*Reasoning: wishlist.ts:18-19 sorts entries by addedAt descending after fetching from service. This means any internal caller of wishlistService.list() (e.g., the add method's duplicate check, the removeByBggId method) operates on unsorted data. This is functionally fine because those methods don't need sorted data. But if a future consumer expects list() to return sorted results, it won't. This is an architectural choice, not a defect. The route-level test at wishlist-routes.test.ts:108-121 verifies the sorting.*

**Does refreshAll save the wishlist even when some entries error?**
OBSERVATION: refreshAll always saves at end, even if some entries failed to refresh.
*Reasoning: wishlist-service.ts:140-168. The loop at lines 145-164 catches per-entry errors and continues. Line 166 saves unconditionally after the loop. This means successful refreshes are persisted alongside unchanged-due-to-error entries. This is correct behavior: partial success should be saved. However, the entries that errored keep their old prediction data, which matches the expected behavior of "errors don't wipe existing data."*
