---
title: "Commission: Previously Owned: Review Foundation (Phases 1-3)"
date: 2026-04-13
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the foundation implementation of the previously-owned feature (Phases 1-3).\n\n**Read these for context:**\n- `.lore/plans/previously-owned.md` (full plan, especially Phase 2 review attention points)\n- `.lore/specs/previously-owned.md` (requirements REQ-PREV-1 through REQ-PREV-18)\n\n**Review attention points from the plan:**\n1. The ownership filter and the niche/redundancy computation universe must be independently maintained. The response can include previously-owned games (`ownership=all`) while niche/redundancy always use owned-only. This is the most error-prone integration point.\n2. The `GET /games/:id` path fetches `allGames` and passes to niche/redundancy engines. Verify the owned-only filter is applied there too.\n3. Verify ownership filtering happens at call sites in `games.ts`, NOT inside `computeRedundancyAdjustments` or `computeNichePositions` (REQ-PREV-8, REQ-PREV-9).\n4. Verify `GET /games` default returns only owned games (backward compatibility, REQ-PREV-17).\n5. Verify test coverage matches the plan's Phase 2 test list.\n6. Verify both web client helpers cover the new endpoint.\n\n**Files to review:**\n- `packages/shared/src/types.ts`\n- `packages/shared/src/schemas.ts`\n- `packages/daemon/src/services/game-service.ts`\n- `packages/daemon/src/routes/games.ts`\n- `packages/daemon/tests/` (new ownership tests)\n- `packages/web/lib/api.ts`\n\nRun `bun run typecheck` and `bun run lint` if you have shell access. Record all findings."
dependencies:
  - commission-Dalton-20260412-174410
linked_artifacts:
  - packages/shared/src/types.ts

  - packages/daemon/src/services/game-service.ts
  - packages/daemon/src/routes/games.ts
  - packages/daemon/tests/ownership-routes.test.ts
  - packages/web/lib/api.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/src/routes/games.ts
  - packages/daemon/tests/ownership-routes.test.ts
  - packages/web/lib/api.ts
activity_timeline:
  - timestamp: 2026-04-13T00:44:19.417Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T01:01:48.763Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-13T01:01:48.789Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-13T01:01:55.467Z
    event: progress_report
    reason: "Starting review of previously-owned feature (Phases 1-3). Reading spec and plan first."
  - timestamp: 2026-04-13T01:02:47.791Z
    event: progress_report
    reason: "Read all implementation files. Starting systematic review against spec requirements and plan attention points."
  - timestamp: 2026-04-13T01:04:16.255Z
    event: progress_report
    reason: "Core implementation review complete. All attention points verified. Recording remaining findings and preparing final report."
  - timestamp: 2026-04-13T01:05:46.316Z
    event: progress_report
    reason: "All files reviewed. Compiling final report with findings organized by severity."
  - timestamp: 2026-04-13T01:06:48.800Z
    event: result_submitted
    reason: "# Review: Previously-Owned Feature (Phases 1-3)\n\n## Verdict\n\nThe foundation implementation is solid. The critical integration point (ownership filter vs. niche/redundancy computation universe) is correctly handled across all code paths. No defects found. Four test coverage gaps and one test quality concern.\n\n---\n\n## Requirement Coverage\n\n### Satisfied\n\n| Requirement | Evidence |\n|---|---|\n| **REQ-PREV-1** (OwnershipStatus type) | `types.ts:33` defines `OwnershipStatus = \"owned\" \\| \"previously-owned\"`. `Game` interface has `ownership: OwnershipStatus` at line 60. |\n| **REQ-PREV-2** (shared type) | `types.ts` in `packages/shared/src/`, exported via `index.ts:4`. Imported by daemon (`game-service.ts:6`) and web (`api.ts:5`). |\n| **REQ-PREV-3** (schema default) | `storage-service.ts:122-126` backfills `ownership: \"owned\"` for games without the field at load time. `addGame` at `game-service.ts:124` sets `ownership: \"owned\"` explicitly. `importBggCollection` at line 399 does the same. |\n| **REQ-PREV-4** (persistence) | `setOwnership` at `game-service.ts:247-249` updates both `ownership` and `updatedAt`, then saves. |\n| **REQ-PREV-5** (ownership change preserves data) | `setOwnership` only modifies `ownership` and `updatedAt`. All other fields untouched. Test at line 281-293 verifies ratings, bggData, numPlays, name are preserved. |\n| **REQ-PREV-6** (separate from delete) | Delete route at `games.ts:318-330` remains unchanged. PATCH ownership at `games.ts:333-364` is a separate endpoint. |\n| **REQ-PREV-7** (reacquisition) | `setOwnership` accepts `\"owned\"` to reverse. Test at line 234-244 verifies. |\n| **REQ-PREV-8** (redundancy filter at call site) | `redundancy-engine.ts` has zero references to \"ownership\". Filtering at `games.ts:182,206,227,264`. |\n| **REQ-PREV-9** (niche filter at call site) | `niche-engine.ts` has zero references to \"ownership\". Filtering at `games.ts:182,206,213-215,250`. |\n| **REQ-PREV-10** (fitness unchanged) | No ownership filtering in fitness computation. Previously-owned games score normally. Test at line 396-405 verifies. |\n| **REQ-PREV-11** (prediction unchanged) | `prediction-service.ts` has no ownership filtering of the reference pool. Only reference is `ownership: \"owned\"` at line 249 when constructing temporary prediction targets (unrelated). |\n| **REQ-PREV-12** (profiling unchanged) | `profile-service.ts` has zero references to \"ownership\". All games contribute. |\n| **REQ-PREV-13** (tournaments unchanged) | No ownership filtering in tournament logic. |\n| **REQ-PREV-14** (PATCH endpoint) | `games.ts:333-364`, path `/games/:id/ownership`, method PATCH. |\n| **REQ-PREV-15** (request/response shapes) | Request parsed via `OwnershipBodySchema` at line 33-35. Response: `{ game }` on success (line 356), `{ error }` on 400 (line 349) and 404 (line 360). Error messages match spec. |\n| **REQ-PREV-16** (route in games.ts) | Implemented in `games.ts` after DELETE route. Calls `gameService.setOwnership`. |\n| **REQ-PREV-17** (GET /games ownership param) | Line 176: `c.req.query(\"ownership\") ?? \"owned\"`. `filterByOwnership` at lines 98-105 handles `\"all\"`, `\"previously-owned\"`, and default `\"owned\"`. |\n| **REQ-PREV-18** (GET /games/:id returns any game) | `gameService.getGame(id)` at line 244 finds by ID regardless of ownership. No ownership guard. |\n| **REQ-PREV-19** (computation universe independent of response) | GET /games: `ownedGames` computed at lines 182/206 for niche/redundancy; `filterByOwnership(allGames, ownershipFilter)` at lines 199/233 for response. GET /games/:id: owned-only set at lines 250/264 for computation; result returned regardless of ownership. |\n| **REQ-PREV-31** (wishlist blocks previously-owned) | `wishlist-service.ts:81` checks `collection.games.some(g => g.bggId === bggId)` without ownership filter. Previously-owned games are still in `collection.games`, so the check correctly blocks wishlisting. |\n\n### Phase 3 (web helpers)\n\n| Requirement | Evidence |\n|---|---|\n| **REQ-PREV-20** (partial, client helper) | `listGames` at `api.ts:27-36` accepts `ownership` parameter. Default omission maps to daemon's `\"owned\"` default. |\n| **REQ-PREV-21** (partial, client helper) | `listGames({ ownership: \"all\" })` supported. |\n| **REQ-PREV-24** (partial, client helper) | `setGameOwnership` at `api.ts:77-85` calls PATCH endpoint. |\n| **REQ-PREV-26** (proxy handles PATCH) | `route.ts` exports PATCH handler at line 63. |\n\n### Operation definition\n\n`shelf.game.set-status` operation at `games.ts:445-452` is correctly defined with method PATCH, path `/api/games/:id/ownership`, and `idempotent: true`.\n\n---\n\n## Findings\n\n### F1: Missing test — previously-owned game cannot be wishlisted (REQ-PREV-31)\n\n**Severity:** Test gap\n**File:** `packages/daemon/tests/ownership-routes.test.ts`\n**Impact:** The spec success criteria explicitly lists \"A previously-owned game cannot be wishlisted (returns 409 per REQ-WISH-6).\" The wishlist check works correctly (verified by code inspection), but there is no test exercising this interaction. If someone adds ownership filtering to the wishlist duplicate check, this gap would let the regression through.\n**Recommendation:** Add a test that marks a game as previously-owned and verifies that `POST /api/wishlist` with that game's bggId returns 409.\n\n### F2: Missing test — previously-owned games in ownership=all have redundancyAdjustment: null\n\n**Severity:** Test gap\n**File:** `packages/daemon/tests/ownership-routes.test.ts`\n**Impact:** The spec success criteria lists \"Previously-owned games in a GET /games?ownership=all response have nichePosition: null and redundancyAdjustment: null.\" The test at line 375 verifies `nichePosition: null` but does not check `redundancyAdjustment: null`. The behavior is correct (verified by code inspection of `applyRedundancy`), but only half the assertion exists.\n**Recommendation:** Add `expect(prevGame!.score!.redundancyAdjustment).toBeNull()` to the existing niche test or create a parallel test with redundancy enabled.\n\n### F3: Missing test — previously-owned games contribute to profile computation (REQ-PREV-12)\n\n**Severity:** Test gap\n**File:** `packages/daemon/tests/ownership-routes.test.ts`\n**Impact:** The spec success criteria lists this. Profile service has no ownership filtering (verified), so the behavior is correct. But there's no test that would catch a regression if someone added ownership filtering to the profile computation.\n**Recommendation:** A lightweight test: compute a profile, verify the game count includes previously-owned games.\n\n### F4: Missing test — GET /games/:id for previously-owned game returns null niche and redundancy\n\n**Severity:** Test gap\n**File:** `packages/daemon/tests/ownership-routes.test.ts`\n**Impact:** The GET /games/:id tests at lines 345-363 verify that both owned and previously-owned games are returned, but don't check that niche/redundancy are null for the previously-owned game. The code is correct (verified: previously-owned game won't appear in `ownedGames` passed to niche/redundancy computation, and `nicheMap.get(id) ?? null` returns null), but no test guards this.\n**Recommendation:** Extend the \"returns previously-owned game\" test to assert `data.nichePosition === null`.\n\n### F5: Legacy migration test doesn't exercise actual storage service code\n\n**Severity:** Test quality\n**File:** `packages/daemon/tests/ownership-routes.test.ts:447-472`\n**Impact:** The test titled \"game without ownership field defaults to owned at parse time\" simulates the backfill pattern inline (`if (!legacyGame.ownership) legacyGame.ownership = \"owned\"`) rather than loading through the actual `storage-service.ts:122-126` code path. If the backfill is removed from storage-service.ts, this test still passes. The test documents intent but doesn't verify implementation.\n**Recommendation:** Create a test that writes a `collection.json` fixture without `ownership` fields, loads it through `storageService.loadCollection()`, and verifies all games have `ownership: \"owned\"`.\n\n---\n\n## Verified Attention Points (from plan)\n\n1. **Ownership filter vs. niche/redundancy computation universe (plan attention point #1):** Independently maintained across all three code paths (includePredicted, standard, single-game). Response includes previously-owned games when `ownership=all`; niche/redundancy always use owned-only.\n\n2. **GET /games/:id applies owned-only filter (plan attention point #2):** Lines 250 and 264 both filter to owned-only before passing to engines. Previously-owned game gets null niche/redundancy.\n\n3. **Filtering at call sites, not engines (plan attention point #3):** `niche-engine.ts` and `redundancy-engine.ts` have zero references to \"ownership\". All six filtering call sites are in `games.ts`.\n\n4. **GET /games default backward compatibility (plan attention point #4):** Default query parameter is `\"owned\"`. `filterByOwnership` returns owned-only for any value that isn't `\"all\"` or `\"previously-owned\"`.\n\n5. **Both web client helpers cover new endpoint (plan attention point #6):** `listGames` at `api.ts:27-36` accepts ownership parameter. `setGameOwnership` at `api.ts:77-85` is a new helper for the PATCH endpoint. `OwnershipStatus` is re-exported at line 343.\n\n---\n\n## Summary\n\nFive findings total, all in the test gap / test quality category. Zero defects in the implementation code. The critical integration point (REQ-PREV-19, independent computation universe) is handled correctly across all paths. All Phase 1-3 spec requirements are satisfied."
  - timestamp: 2026-04-13T01:06:55.552Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All files reviewed. Compiling final report with findings organized by severity."
projectName: shelf-judge
---
# Review: Previously-Owned Feature (Phases 1-3)

## Verdict

The foundation implementation is solid. The critical integration point (ownership filter vs. niche/redundancy computation universe) is correctly handled across all code paths. No defects found. Four test coverage gaps and one test quality concern.

---

## Requirement Coverage

### Satisfied

| Requirement | Evidence |
|---|---|
| **REQ-PREV-1** (OwnershipStatus type) | `types.ts:33` defines `OwnershipStatus = "owned" \| "previously-owned"`. `Game` interface has `ownership: OwnershipStatus` at line 60. |
| **REQ-PREV-2** (shared type) | `types.ts` in `packages/shared/src/`, exported via `index.ts:4`. Imported by daemon (`game-service.ts:6`) and web (`api.ts:5`). |
| **REQ-PREV-3** (schema default) | `storage-service.ts:122-126` backfills `ownership: "owned"` for games without the field at load time. `addGame` at `game-service.ts:124` sets `ownership: "owned"` explicitly. `importBggCollection` at line 399 does the same. |
| **REQ-PREV-4** (persistence) | `setOwnership` at `game-service.ts:247-249` updates both `ownership` and `updatedAt`, then saves. |
| **REQ-PREV-5** (ownership change preserves data) | `setOwnership` only modifies `ownership` and `updatedAt`. All other fields untouched. Test at line 281-293 verifies ratings, bggData, numPlays, name are preserved. |
| **REQ-PREV-6** (separate from delete) | Delete route at `games.ts:318-330` remains unchanged. PATCH ownership at `games.ts:333-364` is a separate endpoint. |
| **REQ-PREV-7** (reacquisition) | `setOwnership` accepts `"owned"` to reverse. Test at line 234-244 verifies. |
| **REQ-PREV-8** (redundancy filter at call site) | `redundancy-engine.ts` has zero references to "ownership". Filtering at `games.ts:182,206,227,264`. |
| **REQ-PREV-9** (niche filter at call site) | `niche-engine.ts` has zero references to "ownership". Filtering at `games.ts:182,206,213-215,250`. |
| **REQ-PREV-10** (fitness unchanged) | No ownership filtering in fitness computation. Previously-owned games score normally. Test at line 396-405 verifies. |
| **REQ-PREV-11** (prediction unchanged) | `prediction-service.ts` has no ownership filtering of the reference pool. Only reference is `ownership: "owned"` at line 249 when constructing temporary prediction targets (unrelated). |
| **REQ-PREV-12** (profiling unchanged) | `profile-service.ts` has zero references to "ownership". All games contribute. |
| **REQ-PREV-13** (tournaments unchanged) | No ownership filtering in tournament logic. |
| **REQ-PREV-14** (PATCH endpoint) | `games.ts:333-364`, path `/games/:id/ownership`, method PATCH. |
| **REQ-PREV-15** (request/response shapes) | Request parsed via `OwnershipBodySchema` at line 33-35. Response: `{ game }` on success (line 356), `{ error }` on 400 (line 349) and 404 (line 360). Error messages match spec. |
| **REQ-PREV-16** (route in games.ts) | Implemented in `games.ts` after DELETE route. Calls `gameService.setOwnership`. |
| **REQ-PREV-17** (GET /games ownership param) | Line 176: `c.req.query("ownership") ?? "owned"`. `filterByOwnership` at lines 98-105 handles `"all"`, `"previously-owned"`, and default `"owned"`. |
| **REQ-PREV-18** (GET /games/:id returns any game) | `gameService.getGame(id)` at line 244 finds by ID regardless of ownership. No ownership guard. |
| **REQ-PREV-19** (computation universe independent of response) | GET /games: `ownedGames` computed at lines 182/206 for niche/redundancy; `filterByOwnership(allGames, ownershipFilter)` at lines 199/233 for response. GET /games/:id: owned-only set at lines 250/264 for computation; result returned regardless of ownership. |
| **REQ-PREV-31** (wishlist blocks previously-owned) | `wishlist-service.ts:81` checks `collection.games.some(g => g.bggId === bggId)` without ownership filter. Previously-owned games are still in `collection.games`, so the check correctly blocks wishlisting. |

### Phase 3 (web helpers)

| Requirement | Evidence |
|---|---|
| **REQ-PREV-20** (partial, client helper) | `listGames` at `api.ts:27-36` accepts `ownership` parameter. Default omission maps to daemon's `"owned"` default. |
| **REQ-PREV-21** (partial, client helper) | `listGames({ ownership: "all" })` supported. |
| **REQ-PREV-24** (partial, client helper) | `setGameOwnership` at `api.ts:77-85` calls PATCH endpoint. |
| **REQ-PREV-26** (proxy handles PATCH) | `route.ts` exports PATCH handler at line 63. |

### Operation definition

`shelf.game.set-status` operation at `games.ts:445-452` is correctly defined with method PATCH, path `/api/games/:id/ownership`, and `idempotent: true`.

---

## Findings

### F1: Missing test — previously-owned game cannot be wishlisted (REQ-PREV-31)

**Severity:** Test gap
**File:** `packages/daemon/tests/ownership-routes.test.ts`
**Impact:** The spec success criteria explicitly lists "A previously-owned game cannot be wishlisted (returns 409 per REQ-WISH-6)." The wishlist check works correctly (verified by code inspection), but there is no test exercising this interaction. If someone adds ownership filtering to the wishlist duplicate check, this gap would let the regression through.
**Recommendation:** Add a test that marks a game as previously-owned and verifies that `POST /api/wishlist` with that game's bggId returns 409.

### F2: Missing test — previously-owned games in ownership=all have redundancyAdjustment: null

**Severity:** Test gap
**File:** `packages/daemon/tests/ownership-routes.test.ts`
**Impact:** The spec success criteria lists "Previously-owned games in a GET /games?ownership=all response have nichePosition: null and redundancyAdjustment: null." The test at line 375 verifies `nichePosition: null` but does not check `redundancyAdjustment: null`. The behavior is correct (verified by code inspection of `applyRedundancy`), but only half the assertion exists.
**Recommendation:** Add `expect(prevGame!.score!.redundancyAdjustment).toBeNull()` to the existing niche test or create a parallel test with redundancy enabled.

### F3: Missing test — previously-owned games contribute to profile computation (REQ-PREV-12)

**Severity:** Test gap
**File:** `packages/daemon/tests/ownership-routes.test.ts`
**Impact:** The spec success criteria lists this. Profile service has no ownership filtering (verified), so the behavior is correct. But there's no test that would catch a regression if someone added ownership filtering to the profile computation.
**Recommendation:** A lightweight test: compute a profile, verify the game count includes previously-owned games.

### F4: Missing test — GET /games/:id for previously-owned game returns null niche and redundancy

**Severity:** Test gap
**File:** `packages/daemon/tests/ownership-routes.test.ts`
**Impact:** The GET /games/:id tests at lines 345-363 verify that both owned and previously-owned games are returned, but don't check that niche/redundancy are null for the previously-owned game. The code is correct (verified: previously-owned game won't appear in `ownedGames` passed to niche/redundancy computation, and `nicheMap.get(id) ?? null` returns null), but no test guards this.
**Recommendation:** Extend the "returns previously-owned game" test to assert `data.nichePosition === null`.

### F5: Legacy migration test doesn't exercise actual storage service code

**Severity:** Test quality
**File:** `packages/daemon/tests/ownership-routes.test.ts:447-472`
**Impact:** The test titled "game without ownership field defaults to owned at parse time" simulates the backfill pattern inline (`if (!legacyGame.ownership) legacyGame.ownership = "owned"`) rather than loading through the actual `storage-service.ts:122-126` code path. If the backfill is removed from storage-service.ts, this test still passes. The test documents intent but doesn't verify implementation.
**Recommendation:** Create a test that writes a `collection.json` fixture without `ownership` fields, loads it through `storageService.loadCollection()`, and verifies all games have `ownership: "owned"`.

---

## Verified Attention Points (from plan)

1. **Ownership filter vs. niche/redundancy computation universe (plan attention point #1):** Independently maintained across all three code paths (includePredicted, standard, single-game). Response includes previously-owned games when `ownership=all`; niche/redundancy always use owned-only.

2. **GET /games/:id applies owned-only filter (plan attention point #2):** Lines 250 and 264 both filter to owned-only before passing to engines. Previously-owned game gets null niche/redundancy.

3. **Filtering at call sites, not engines (plan attention point #3):** `niche-engine.ts` and `redundancy-engine.ts` have zero references to "ownership". All six filtering call sites are in `games.ts`.

4. **GET /games default backward compatibility (plan attention point #4):** Default query parameter is `"owned"`. `filterByOwnership` returns owned-only for any value that isn't `"all"` or `"previously-owned"`.

5. **Both web client helpers cover new endpoint (plan attention point #6):** `listGames` at `api.ts:27-36` accepts ownership parameter. `setGameOwnership` at `api.ts:77-85` is a new helper for the PATCH endpoint. `OwnershipStatus` is re-exported at line 343.

---

## Summary

Five findings total, all in the test gap / test quality category. Zero defects in the implementation code. The critical integration point (REQ-PREV-19, independent computation universe) is handled correctly across all paths. All Phase 1-3 spec requirements are satisfied.

## Decisions

**Does GET /games/:id apply owned-only filter for niche/redundancy computation?**
Yes, correctly implemented. Lines 250 and 264 both filter to owned-only before passing to niche/redundancy engines.
*Reasoning: Line 250: `const ownedGames = allGames.filter((g) => g.game.ownership !== "previously-owned")`. Line 264: same filter applied before `applyRedundancy`. A previously-owned game requested via GET /games/:id will have nichePosition: null (won't be in nicheMap) and no redundancy adjustment (won't be in ownedGames passed to applyRedundancy).*

**Does filtering happen at call sites in games.ts, NOT inside niche/redundancy engines?**
Yes, correctly implemented. Niche and redundancy engines contain zero references to 'ownership'. All filtering is at call sites in games.ts.
*Reasoning: Grep for 'ownership' in niche-engine.ts and redundancy-engine.ts returned no matches. The filter `g.game.ownership !== "previously-owned"` appears at lines 182, 206, 213-215, 227, 250, 264 of games.ts, all at call sites before passing to computeNichePositions or applyRedundancy.*

**Does GET /games default return only owned games (backward compatibility, REQ-PREV-17)?**
Yes, correctly implemented. Line 176: `const ownershipFilter = c.req.query("ownership") ?? "owned"`. The filterByOwnership function at line 98-105 filters to owned-only when the value is "owned" (or any value that isn't "all" or "previously-owned").
*Reasoning: The default query parameter value is "owned" when not provided. The filterByOwnership function at line 103-104 filters `g.game.ownership !== "previously-owned"` for the default case. This matches existing behavior since all existing games are "owned".*

**Does the test coverage match the plan's Phase 2 test list?**
Partial coverage. Several test cases from the plan and spec success criteria are missing.
*Reasoning: The plan lists 17 test cases for Phase 2. The test file covers: PATCH status change (5 tests), GET /games ownership filtering (5 tests), GET /games/:id regardless of ownership (2 tests), niche/redundancy exclusion (4 tests), legacy migration (1 test). Total: 17 tests.

Comparing against the spec's success criteria list:
- PATCH with "previously-owned" changes status and updates updatedAt: COVERED (line 221)
- PATCH with "owned" reverses status (reacquisition): COVERED (line 234)
- PATCH with invalid status returns 400: COVERED (line 246)
- PATCH for nonexistent game returns 404: COVERED (line 258)
- PATCH with current status returns 200 without changing updatedAt: COVERED (line 268)
- GET /games (default) returns only owned games: COVERED (line 297)
- GET /games?ownership=all returns both: COVERED (line 306)
- GET /games?ownership=previously-owned returns only previously-owned: COVERED (line 317)
- GET /games/:id returns game regardless of ownership: COVERED (line 345)
- Redundancy adjustments exclude previously-owned: NOT DIRECTLY TESTED (tested indirectly via identical-scores test)
- Niche positions exclude previously-owned: COVERED (line 375, null nichePosition)
- Redundancy/niche use owned-only set even when ownership=all: COVERED (line 415)
- Fitness scores computed for previously-owned: COVERED (line 396)
- Previously-owned in prediction reference pool: COVERED (line 407)
- Previously-owned contribute to profile computation: NOT TESTED
- Previously-owned in ownership=all have nichePosition: null and redundancyAdjustment: null: nichePosition COVERED (line 375), redundancyAdjustment NOT EXPLICITLY TESTED
- Redundancy/niche scores identical between default and ownership=all: COVERED (line 415)
- Marking as previously-owned does not delete data: COVERED (line 281)
- Previously-owned games cannot be wishlisted (REQ-PREV-31): NOT TESTED

Missing tests:
1. Profile computation includes previously-owned games
2. Previously-owned games in ownership=all have redundancyAdjustment: null
3. Previously-owned game cannot be wishlisted (409 per REQ-WISH-6)
4. GET /games/:id for previously-owned game returns null niche/redundancy*

**Do both web client helpers cover the new endpoint?**
Yes. The web client at packages/web/lib/api.ts has both: listGames updated with ownership parameter (lines 27-36) and setGameOwnership helper (lines 77-85). OwnershipStatus is re-exported from shared types (line 343).
*Reasoning: listGames at lines 27-36 accepts `ownership?: "owned" | "previously-owned" | "all"` and appends it as a query parameter. setGameOwnership at lines 77-85 calls PATCH on `/api/games/${id}/ownership` with the ownership body. Both match the daemon API contract.*

**Is there a redundancy computation asymmetry between includePredicted=true and standard paths?**
No issue. The asymmetry is intentional. In the includePredicted path, ownedGames already contains prediction-enriched scores, so no separate universe is needed. In the standard path, ownedGames has only actual scores, so a prediction-enriched universe is fetched separately.
*Reasoning: Line 179: allGames from predictionService already has predictions. Line 182: ownedGames is filtered from that set. Line 196: applyRedundancy uses ownedGames as both target and universe, which is correct because it's already prediction-enriched. Line 225-229: In the standard path, a separate universe is needed because allGames (line 203) only has actual scores.*

**Is the ownership default handled for legacy data at storage load time (REQ-PREV-3)?**
Yes. The storage service at lines 122-126 backfills ownership to "owned" for any game missing the field. This uses a truthy check (`if (!game.ownership)`) which handles both undefined and empty string.
*Reasoning: The spec allows either Zod schema default or load-time backfill. The implementation uses load-time backfill in storage-service.ts. The test at ownership-routes.test.ts:447-472 ("legacy data migration") simulates this pattern and verifies it works. Note: there is no Zod schema for Game objects at storage parse time (the validation.ts file has no GameSchema). The backfill approach is the correct one for this codebase.*

**Does the legacy data migration test actually test the storage service backfill?**
Finding: The test simulates the backfill pattern inline but doesn't exercise the actual storage service code. It's a demonstration, not an integration test.
*Reasoning: The test at line 448-472 creates a game object without ownership, then manually applies the backfill logic (`if (!legacyGame.ownership) legacyGame.ownership = "owned"`). This proves the pattern works but doesn't test that storage-service.ts actually does it. If someone removes the backfill from storage-service.ts, this test would still pass. A stronger test would load a collection JSON fixture without ownership fields through the actual storage service and verify the backfill.*
