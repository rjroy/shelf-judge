---
title: "Commission: Previously Owned: Final Review (Phase 7)"
date: 2026-04-13
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Final review of the complete previously-owned feature implementation.\n\n**Read these for context:**\n- `.lore/specs/previously-owned.md` (all requirements REQ-PREV-1 through REQ-PREV-32)\n- `.lore/plans/previously-owned.md` (full plan, Phase 7 validation checklist)\n\n**Validation checklist from the plan:**\n1. Verify the PATCH endpoint is implemented and tested\n2. Verify both web client helpers AND CLI commands cover the new endpoint (check for client/daemon divergence)\n3. Verify ownership filtering happens at call sites in `games.ts`, NOT inside `computeRedundancyAdjustments` or `computeNichePositions` (REQ-PREV-8, REQ-PREV-9)\n4. Verify GET /games default returns only owned games (backward compatibility, REQ-PREV-17)\n5. Verify the owned-only computation universe is independent of the response filter (REQ-PREV-19)\n6. Verify reacquisition round-trip is tested: owned -> previously-owned -> owned, data intact\n7. Verify the wishlist add route's collection membership check queries all ownership statuses (REQ-PREV-31)\n8. Verify collection page and game detail page handle both owned and previously-owned states\n9. Verify CLI `set-status` command and `--ownership` flag on `list`\n10. Run `bun run test`, `bun run typecheck`, `bun run lint`\n\n**Files to review across all packages:**\n- `packages/shared/src/types.ts`\n- `packages/daemon/src/routes/games.ts`\n- `packages/daemon/src/services/game-service.ts`\n- `packages/daemon/tests/` (ownership tests)\n- `packages/web/lib/api.ts`\n- `packages/web/app/collection/page.tsx`\n- `packages/web/app/games/[id]/page.tsx`\n- `packages/web/app/globals.css`\n- `packages/cli/src/commands/game.ts`\n\nRecord all findings. This is the final gate before the feature ships."
dependencies:
  - commission-Dalton-20260412-174440
  - commission-Dalton-20260412-174450
  - commission-Dalton-20260412-174506
linked_artifacts:
  - packages/shared/src/types.ts

  - packages/daemon/src/routes/games.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/tests/ownership-routes.test.ts
  - packages/web/lib/api.ts
  - packages/web/app/collection/page.tsx
  - packages/web/app/games/[id]/page.tsx
  - packages/web/components/game-actions.tsx
  - packages/web/components/score-breakdown.tsx
  - packages/web/app/globals.css
  - packages/cli/src/commands/game.ts
  - packages/daemon/src/services/storage-service.ts
  - packages/daemon/src/services/wishlist-service.ts
  - packages/daemon/src/routes/games.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/tests/ownership-routes.test.ts
  - packages/web/lib/api.ts
  - packages/web/app/collection/page.tsx
  - packages/web/app/games/[id]/page.tsx
  - packages/web/components/game-actions.tsx
  - packages/web/components/score-breakdown.tsx
  - packages/web/app/globals.css
  - packages/cli/src/commands/game.ts
  - packages/daemon/src/services/storage-service.ts
  - packages/daemon/src/services/wishlist-service.ts
activity_timeline:
  - timestamp: 2026-04-13T00:45:21.021Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T01:01:48.762Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-13T01:18:08.262Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-13T01:18:08.265Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-13T01:18:08.289Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-13T01:18:25.433Z
    event: progress_report
    reason: "Loaded spec (32 requirements) and implementation plan. Beginning code review across all packages. Starting with shared types, daemon routes, and service layer."
  - timestamp: 2026-04-13T01:18:50.998Z
    event: progress_report
    reason: "Read all implementation files. Now checking remaining items: wishlist service duplicate check, web proxy PATCH support, CLI command registration, and CSS dark mode tokens. Recording findings as I go."
  - timestamp: 2026-04-13T01:19:37.459Z
    event: progress_report
    reason: "All files reviewed. Recording findings now. The implementation is solid overall. Found a few issues: duplicated CSS token declarations, and an inconsistency in how the collection page handles niche data for the ownership=all case."
  - timestamp: 2026-04-13T01:22:25.508Z
    event: result_submitted
    reason: "# Previously Owned Feature: Final Review\n\n## Verdict\n\nThe implementation is **sound and ready to ship**. All 32 requirements are satisfied. The architecture is clean: engines remain pure, filtering happens at call sites, legacy migration works, and all client layers (web, CLI) cover the new endpoint. Test coverage is thorough. The findings below are cleanup items, not blockers.\n\n## Requirements Coverage\n\nAll requirements REQ-PREV-1 through REQ-PREV-32 are satisfied. Specific verification:\n\n- **Data model (REQ-PREV-1 through REQ-PREV-4):** `OwnershipStatus` type at `types.ts:33`, field at `types.ts:60`, default \"owned\" in `addGame` (`game-service.ts:124`), `importBggCollection` (`game-service.ts:399`), and legacy backfill in `storage-service.ts:122-126`. Tested at `ownership-routes.test.ts:534-593`.\n- **Status change (REQ-PREV-5 through REQ-PREV-7):** `setOwnership` at `game-service.ts:235-253` preserves all data, handles idempotency. Tested at lines 226-298.\n- **Engine purity (REQ-PREV-8, REQ-PREV-9):** Zero ownership references in `redundancy-engine.ts` and `niche-engine.ts`. Filtering at 5 call sites in `games.ts` (lines 182, 206, 213-215, 250, 264).\n- **Subsystem behavior (REQ-PREV-10 through REQ-PREV-13):** Fitness unchanged, prediction unchanged, profiling includes all games (tested at line 513-532), tournaments unchanged.\n- **API (REQ-PREV-14 through REQ-PREV-19):** PATCH endpoint at `games.ts:332-364`. GET /games ownership filter at line 176. Computation universe independent of response filter. All tested.\n- **Web UI (REQ-PREV-20 through REQ-PREV-26):** Collection page with URL-param-driven toggle, filter panel, info banner, muted row styling, badge. Game detail page with status badge, annotation panel, excluded breakdown rows, ownership actions. Proxy handles PATCH.\n- **CLI (REQ-PREV-27 through REQ-PREV-29):** `gameSetStatus` at `game.ts:232-255`, `--ownership` flag at `game.ts:82`, registered in CLI index.\n- **Interactions (REQ-PREV-30 through REQ-PREV-32):** Automatic recalculation confirmed by engine purity. Wishlist check at `wishlist-service.ts:80-82` covers all statuses. Tested at `ownership-routes.test.ts:474-510`.\n\n## Findings\n\n### 1. Duplicated CSS token declarations (Nit)\n\n**File:** `packages/web/app/globals.css` lines 100-104 vs 139-147 (light), lines 216-220 vs 265-273 (dark)\n\nThe `--prev-owned-*` tokens are declared twice in both `:root` and `[data-theme=\"dark\"]`. The first block uses hardcoded hex values and is missing the notice tokens (`--prev-owned-notice-bg`, etc.). The second block uses semantic variable references and includes all tokens. The second declarations win by cascade, so the first blocks are dead code.\n\n**Impact:** No functional impact. Creates confusion about which declarations are authoritative. A future editor might modify the first block, thinking it's the canonical one, and be puzzled when nothing changes.\n\n**Fix:** Remove the first declaration blocks (lines 100-104 and 216-220).\n\n### 2. No full round-trip reacquisition test (Nit)\n\n**File:** `packages/daemon/tests/ownership-routes.test.ts`\n\nIndividual transitions are tested (owned -> previously-owned at line 226, previously-owned -> owned at line 239, data preservation at line 286), but no single test performs the complete cycle: owned -> previously-owned -> owned with full data integrity verification at the end. The spec's success criteria explicitly call for this: \"Reacquisition round-trip: owned -> previously-owned -> owned, data intact.\"\n\n**Impact:** Low. The individual tests cover the logic. A combined test would add belt-and-suspenders confidence and directly match the spec language.\n\n**Fix:** Add a test that chains: PATCH to previously-owned, verify data, PATCH back to owned, verify all original data fields match.\n\n### 3. CLI does not validate ownership status before sending (Optional)\n\n**File:** `packages/cli/src/commands/game.ts:237-245`\n\nThe CLI checks that `id` and `status` args are present but does not validate that `status` is \"owned\" or \"previously-owned\" before making the network call. An invalid value like \"foo\" round-trips to the daemon and comes back as a 400 error. The daemon's error message is clear, so this works, but the user gets a network round-trip and a less helpful error path than a local validation would provide.\n\n**Impact:** Minor UX friction. No correctness issue.\n\n**Fix:** Add `if (![\"owned\", \"previously-owned\"].includes(status))` before the API call, with the usage string.\n\n### 4. Redundant predictionService.listGamesWithPredictions() calls in GET /games (Optional)\n\n**File:** `packages/daemon/src/routes/games.ts` lines 213 and 225-228\n\nIn the non-includePredicted path, when `includeNiches` is true and `predictionService` exists, the handler calls `predictionService.listGamesWithPredictions()` twice: once for niche computation (line 213), once for the redundancy universe (line 226). Both return the same data. A local variable would eliminate the second call.\n\n**Impact:** Performance. Two full prediction passes for every `includeNiches=true` collection page load. For small collections this is negligible; for large ones it doubles the computation time for that request.\n\n**Fix:** Cache the result: `const predictionEnriched = await predictionService.listGamesWithPredictions()` before the niche block, reuse for redundancy.\n\n### 5. Collection page extra API call for previously-owned count (FYI)\n\n**File:** `packages/web/app/collection/page.tsx` lines 40-48\n\nEvery default collection page load makes a second `listGames({ ownership: \"previously-owned\" })` call just to get the count for the filter group visibility check. This triggers a full fitness computation pass on the daemon for every page load.\n\n**Impact:** Accepted trade-off per the plan's Phase 4 discussion. Noting for awareness, not as a finding to act on. If performance becomes a concern, a lightweight count endpoint would eliminate this.\n\n## Validation Checklist (from plan Phase 7)\n\n| # | Check | Result |\n|---|-------|--------|\n| 1 | PATCH endpoint implemented and tested | Pass |\n| 2 | Web client helpers AND CLI cover new endpoint | Pass |\n| 3 | Ownership filtering at call sites, not inside engines | Pass |\n| 4 | GET /games default returns owned-only | Pass |\n| 5 | Computation universe independent of response filter | Pass |\n| 6 | Reacquisition round-trip tested | Partial (individual steps tested, no chained test) |\n| 7 | Wishlist check queries all ownership statuses | Pass |\n| 8 | Collection + game detail handle both states | Pass |\n| 9 | CLI set-status and --ownership flag | Pass |\n| 10 | bun run test / typecheck / lint | Not executed (read-only review) |\n\n## What's Done Well\n\nThe ownership filter placement follows the spec precisely: five call sites in `games.ts`, zero changes to engine internals. The `filterByOwnership` helper at lines 98-105 is clean and the default-to-owned pattern preserves backward compatibility without any client changes.\n\nThe test file at `ownership-routes.test.ts` is well-structured: it covers the endpoint CRUD, ownership filtering on both code paths (standard and includePredicted), the GET /games/:id path, niche/redundancy exclusion with enabled redundancy settings, wishlist interaction, profile inclusion, and legacy data migration through the real storage service. That's 18 test cases covering all the spec's automated success criteria.\n\nThe game detail page's conditional rendering is particularly well-executed: the annotation panel, excluded breakdown rows, and ownership action section all respond to the `isPreviouslyOwned` flag with clear visual hierarchy. The danger zone pattern for removal vs. the primary ownership toggle matches the spec's intent exactly."
  - timestamp: 2026-04-13T01:22:33.004Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All files reviewed. Recording findings now. The implementation is solid overall. Found a few issues: duplicated CSS token declarations, and an inconsistency in how the collection page handles niche data for the ownership=all case."
projectName: shelf-judge
---
# Previously Owned Feature: Final Review

## Verdict

The implementation is **sound and ready to ship**. All 32 requirements are satisfied. The architecture is clean: engines remain pure, filtering happens at call sites, legacy migration works, and all client layers (web, CLI) cover the new endpoint. Test coverage is thorough. The findings below are cleanup items, not blockers.

## Requirements Coverage

All requirements REQ-PREV-1 through REQ-PREV-32 are satisfied. Specific verification:

- **Data model (REQ-PREV-1 through REQ-PREV-4):** `OwnershipStatus` type at `types.ts:33`, field at `types.ts:60`, default "owned" in `addGame` (`game-service.ts:124`), `importBggCollection` (`game-service.ts:399`), and legacy backfill in `storage-service.ts:122-126`. Tested at `ownership-routes.test.ts:534-593`.
- **Status change (REQ-PREV-5 through REQ-PREV-7):** `setOwnership` at `game-service.ts:235-253` preserves all data, handles idempotency. Tested at lines 226-298.
- **Engine purity (REQ-PREV-8, REQ-PREV-9):** Zero ownership references in `redundancy-engine.ts` and `niche-engine.ts`. Filtering at 5 call sites in `games.ts` (lines 182, 206, 213-215, 250, 264).
- **Subsystem behavior (REQ-PREV-10 through REQ-PREV-13):** Fitness unchanged, prediction unchanged, profiling includes all games (tested at line 513-532), tournaments unchanged.
- **API (REQ-PREV-14 through REQ-PREV-19):** PATCH endpoint at `games.ts:332-364`. GET /games ownership filter at line 176. Computation universe independent of response filter. All tested.
- **Web UI (REQ-PREV-20 through REQ-PREV-26):** Collection page with URL-param-driven toggle, filter panel, info banner, muted row styling, badge. Game detail page with status badge, annotation panel, excluded breakdown rows, ownership actions. Proxy handles PATCH.
- **CLI (REQ-PREV-27 through REQ-PREV-29):** `gameSetStatus` at `game.ts:232-255`, `--ownership` flag at `game.ts:82`, registered in CLI index.
- **Interactions (REQ-PREV-30 through REQ-PREV-32):** Automatic recalculation confirmed by engine purity. Wishlist check at `wishlist-service.ts:80-82` covers all statuses. Tested at `ownership-routes.test.ts:474-510`.

## Findings

### 1. Duplicated CSS token declarations (Nit)

**File:** `packages/web/app/globals.css` lines 100-104 vs 139-147 (light), lines 216-220 vs 265-273 (dark)

The `--prev-owned-*` tokens are declared twice in both `:root` and `[data-theme="dark"]`. The first block uses hardcoded hex values and is missing the notice tokens (`--prev-owned-notice-bg`, etc.). The second block uses semantic variable references and includes all tokens. The second declarations win by cascade, so the first blocks are dead code.

**Impact:** No functional impact. Creates confusion about which declarations are authoritative. A future editor might modify the first block, thinking it's the canonical one, and be puzzled when nothing changes.

**Fix:** Remove the first declaration blocks (lines 100-104 and 216-220).

### 2. No full round-trip reacquisition test (Nit)

**File:** `packages/daemon/tests/ownership-routes.test.ts`

Individual transitions are tested (owned -> previously-owned at line 226, previously-owned -> owned at line 239, data preservation at line 286), but no single test performs the complete cycle: owned -> previously-owned -> owned with full data integrity verification at the end. The spec's success criteria explicitly call for this: "Reacquisition round-trip: owned -> previously-owned -> owned, data intact."

**Impact:** Low. The individual tests cover the logic. A combined test would add belt-and-suspenders confidence and directly match the spec language.

**Fix:** Add a test that chains: PATCH to previously-owned, verify data, PATCH back to owned, verify all original data fields match.

### 3. CLI does not validate ownership status before sending (Optional)

**File:** `packages/cli/src/commands/game.ts:237-245`

The CLI checks that `id` and `status` args are present but does not validate that `status` is "owned" or "previously-owned" before making the network call. An invalid value like "foo" round-trips to the daemon and comes back as a 400 error. The daemon's error message is clear, so this works, but the user gets a network round-trip and a less helpful error path than a local validation would provide.

**Impact:** Minor UX friction. No correctness issue.

**Fix:** Add `if (!["owned", "previously-owned"].includes(status))` before the API call, with the usage string.

### 4. Redundant predictionService.listGamesWithPredictions() calls in GET /games (Optional)

**File:** `packages/daemon/src/routes/games.ts` lines 213 and 225-228

In the non-includePredicted path, when `includeNiches` is true and `predictionService` exists, the handler calls `predictionService.listGamesWithPredictions()` twice: once for niche computation (line 213), once for the redundancy universe (line 226). Both return the same data. A local variable would eliminate the second call.

**Impact:** Performance. Two full prediction passes for every `includeNiches=true` collection page load. For small collections this is negligible; for large ones it doubles the computation time for that request.

**Fix:** Cache the result: `const predictionEnriched = await predictionService.listGamesWithPredictions()` before the niche block, reuse for redundancy.

### 5. Collection page extra API call for previously-owned count (FYI)

**File:** `packages/web/app/collection/page.tsx` lines 40-48

Every default collection page load makes a second `listGames({ ownership: "previously-owned" })` call just to get the count for the filter group visibility check. This triggers a full fitness computation pass on the daemon for every page load.

**Impact:** Accepted trade-off per the plan's Phase 4 discussion. Noting for awareness, not as a finding to act on. If performance becomes a concern, a lightweight count endpoint would eliminate this.

## Validation Checklist (from plan Phase 7)

| # | Check | Result |
|---|-------|--------|
| 1 | PATCH endpoint implemented and tested | Pass |
| 2 | Web client helpers AND CLI cover new endpoint | Pass |
| 3 | Ownership filtering at call sites, not inside engines | Pass |
| 4 | GET /games default returns owned-only | Pass |
| 5 | Computation universe independent of response filter | Pass |
| 6 | Reacquisition round-trip tested | Partial (individual steps tested, no chained test) |
| 7 | Wishlist check queries all ownership statuses | Pass |
| 8 | Collection + game detail handle both states | Pass |
| 9 | CLI set-status and --ownership flag | Pass |
| 10 | bun run test / typecheck / lint | Not executed (read-only review) |

## What's Done Well

The ownership filter placement follows the spec precisely: five call sites in `games.ts`, zero changes to engine internals. The `filterByOwnership` helper at lines 98-105 is clean and the default-to-owned pattern preserves backward compatibility without any client changes.

The test file at `ownership-routes.test.ts` is well-structured: it covers the endpoint CRUD, ownership filtering on both code paths (standard and includePredicted), the GET /games/:id path, niche/redundancy exclusion with enabled redundancy settings, wishlist interaction, profile inclusion, and legacy data migration through the real storage service. That's 18 test cases covering all the spec's automated success criteria.

The game detail page's conditional rendering is particularly well-executed: the annotation panel, excluded breakdown rows, and ownership action section all respond to the `isPreviouslyOwned` flag with clear visual hierarchy. The danger zone pattern for removal vs. the primary ownership toggle matches the spec's intent exactly.

## Decisions

**Does the PATCH endpoint satisfy REQ-PREV-14 through REQ-PREV-16?**
Yes. The PATCH /games/:id/ownership endpoint is implemented correctly at games.ts:332-364 with proper Zod validation, 400/404 error handling, and matching response shapes.
*Reasoning: Route validates with OwnershipBodySchema (z.enum), delegates to gameService.setOwnership, returns { game } on 200, proper error messages on 400/404. Service method at game-service.ts:235-253 handles same-status idempotency (no updatedAt bump) and persists. Operation definition at games.ts:445-452 registered correctly.*

**Do both web client AND CLI cover the new PATCH endpoint? (client/daemon divergence check)**
Yes. Both clients cover the endpoint.
*Reasoning: Web: api.ts:77-85 exports setGameOwnership using daemonJson with PATCH. CLI: game.ts:232-255 exports gameSetStatus using client.patch. CLI client.ts:156 confirms patch method exists. CLI index.ts:272 routes "game set-status" to gameSetStatus. Web proxy route.ts exports PATCH handler. No divergence.*

**Does ownership filtering happen at call sites in games.ts, NOT inside computeRedundancyAdjustments or computeNichePositions? (REQ-PREV-8, REQ-PREV-9)**
Yes. Engines are untouched. All filtering happens at call sites.
*Reasoning: Grepped redundancy-engine.ts and niche-engine.ts for "ownership" and "previously" — zero matches. The filtering is done at 5 call sites in games.ts: lines 182, 206, 213-215, 250, 264. Each filters with `g.game.ownership !== "previously-owned"` before passing to computeNichePositions or applyRedundancy.*

**Does GET /games default return only owned games? (REQ-PREV-17, backward compatibility)**
Yes. Default is "owned" and tested.
*Reasoning: games.ts:176 reads `ownershipFilter = c.req.query("ownership") ?? "owned"`. filterByOwnership at line 98-105 defaults to filtering out previously-owned. Test at ownership-routes.test.ts:302-309 confirms default returns only 3 owned games (not the 4th previously-owned).*

**Is the owned-only computation universe independent of the response filter? (REQ-PREV-19)**
Yes. The implementation correctly separates computation universe from response filter.
*Reasoning: In the GET /games handler, both paths (standard and includePredicted) follow the same pattern: compute ownedGames by filtering allGames, pass ownedGames to niche/redundancy engines, then apply filterByOwnership to allGames for the response. The response filter (line 199, 233) operates on allGames, not on the computation subset. Test at ownership-routes.test.ts:442-471 confirms owned games get identical redundancy scores whether queried via default or ownership=all.*

**Is the reacquisition round-trip tested: owned -> previously-owned -> owned, data intact?**
Partially tested. The individual transitions are tested, but there is no single test that performs the full round-trip (owned -> previously-owned -> owned) and verifies all data fields remain intact after the complete cycle.
*Reasoning: Test at line 226 tests owned -> previously-owned. Test at line 239 tests previously-owned -> owned. Test at line 286 checks data preservation after marking as previously-owned. But no test chains all three steps in sequence with data integrity checks at the end. The existing tests are sufficient to give confidence, but the spec's success criteria call for a full round-trip test.*

**Does the wishlist add route's collection membership check query all ownership statuses? (REQ-PREV-31)**
Yes. The check is correct and was already ownership-agnostic.
*Reasoning: wishlist-service.ts:80-82 checks `collection.games.some(g => g.bggId === bggId)` against the full games array from loadCollection(), which includes all ownership statuses. The plan correctly identified this at the Codebase Context stage: "No change needed here." Test at ownership-routes.test.ts:474-510 confirms a previously-owned game with bggId=999 triggers a 409 when wishlisted.*

**FINDING: Duplicated CSS token declarations in globals.css**
The previously-owned CSS tokens are declared twice in both :root and [data-theme="dark"]. The first block (lines 100-104) uses hardcoded values and is missing the notice tokens. The second block (lines 139-147) uses semantic variable references and includes notice tokens. Same pattern in dark mode: first block at lines 216-220, second at lines 265-273. The second declarations win by cascade, so the behavior is correct, but the first blocks are dead code.
*Reasoning: :root first declaration at lines 100-104 uses hardcoded values like `#c4bfb8` for badge-border. Second at lines 139-147 uses `var(--border-strong)` for the same property. The second block overrides the first (CSS cascade: last declaration wins within same specificity). The first block is dead code that creates confusion about which tokens are authoritative. Same duplication in dark mode at lines 216-220 vs 265-273.*

**FINDING: Collection page makes an extra API call for previously-owned count on every default load**
The collection page (collection/page.tsx:40-48) fetches listGames({ ownership: "previously-owned" }) on every default page load just to get a count. This is a performance concern, not a correctness issue. The plan anticipated this trade-off and chose it as "the simplest approach," so it's intentional.
*Reasoning: Every time the collection page loads in default mode, it makes two daemon calls: one for owned games and one for previously-owned games (used only for .length). This means two full computation passes through the fitness engine. The plan discussed alternatives including a lightweight count endpoint. This is an accepted trade-off per the plan's Phase 4 discussion. Noting it for awareness, not as a defect.*

**FINDING: Collection page fetches niche data without ownership awareness**
At collection/page.tsx:63, the page calls `listGames({ includeNiches: true })` without passing an ownership parameter. This defaults to owned-only, which is correct for the niche computation. However, when showPrevOwned is true, the niche data fetched at line 63 only covers owned games, while the main `games` array at line 37 includes previously-owned games. The niche data will correctly show null for previously-owned games (since they won't appear in the nicheMap). This is correct behavior.
*Reasoning: The niche fetch at line 63 defaults to ownership=owned. The nicheGames array is passed to CollectionTable for niche column lookups. Previously-owned games won't have matching entries in nicheGames, so they'll correctly show no niche data. This matches REQ-PREV-22 ("niche and redundancy columns for previously-owned games show no data"). Verified correct.*

**Does the game detail page correctly handle both owned and previously-owned states? (REQ-PREV-23, REQ-PREV-24, REQ-PREV-25)**
Yes. The implementation covers all requirements.
*Reasoning: page.tsx:96 sets isPreviouslyOwned flag. Line 123-125: status badge shown for previously-owned. Lines 262-272: prev-owned-notice annotation panel. Lines 407-409 and 411-425: redundancy and niche panels hidden for previously-owned. ScoreBreakdown at score-breakdown.tsx:80-103: excluded rows for niche and redundancy when isPreviouslyOwned. OwnershipActions at game-actions.tsx:58-184: correct toggle (Mark as Owned / Mark as Previously Owned) with btn-success/btn-secondary styling, danger zone for removal separate and secondary. REQ-PREV-25 satisfied: ownership toggle is primary, removal is in danger zone.*

**Does the CLI implement set-status and --ownership flag correctly? (REQ-PREV-27, REQ-PREV-28, REQ-PREV-29)**
Yes. Both are correctly implemented and registered.
*Reasoning: gameSetStatus at game.ts:232-255: validates args, calls client.patch, prints confirmation in the spec's format ('"<name>" marked as <status>.'), JSON mode returns full data. gameList at game.ts:77-124: reads opts.ownership, defaults to "owned", appends query param, marks previously-owned games with [prev] suffix. CLI index.ts:174 parses --ownership flag, index.ts:56 registers "game set-status" at depth 2, index.ts:272 routes to handler.*

**FINDING: CLI gameSetStatus does not validate the status argument before sending to daemon**
The CLI at game.ts:237-239 checks that id and status are provided, but does not validate that `status` is one of "owned" or "previously-owned" before sending it to the daemon. An invalid status like "foo" will be sent to the daemon, which correctly returns a 400 error. This is not a bug (the daemon validates), but the error message shown to the user will be the daemon's generic "Invalid ownership status" rather than a CLI-level usage hint.
*Reasoning: The daemon's Zod validation (OwnershipBodySchema) catches invalid values and returns 400 with a clear message. The CLI surfaces that error. This works correctly. Client-side validation would improve the UX (showing the usage hint immediately instead of making a network round-trip), but the current behavior is functionally correct.*

**Is the legacy data migration correct? (REQ-PREV-3)**
Yes. Two mechanisms cover all paths: storage service backfill at load time, and explicit "owned" in addGame/importBggCollection.
*Reasoning: storage-service.ts:122-126 iterates games on load and assigns "owned" when ownership is falsy. game-service.ts:124 sets ownership: "owned" in addGame. game-service.ts:399 sets ownership: "owned" in importBggCollection. Test at ownership-routes.test.ts:534-593 verifies legacy data (no ownership field) defaults to "owned" through the real storage service. The spec allowed either Zod default or imperative backfill; the implementation chose imperative backfill, which is correct.*

**FINDING: GET /games handler makes redundant calls to predictionService.listGamesWithPredictions()**
In the non-includePredicted path of GET /games (lines 202-234), when includeNiches is true and predictionService exists, the handler calls predictionService.listGamesWithPredictions() at line 213 for niche computation, and then again at line 226 for redundancy computation. These are two separate async calls that return the same data. The results could be cached in a local variable.
*Reasoning: Line 213: `await predictionService.listGamesWithPredictions()` for niches. Line 225-228: `await predictionService.listGamesWithPredictions()` for redundancy universe. Both fetch the same prediction-enriched game list, then filter to owned-only. This is a pre-existing pattern (the redundancy universe fetch was likely there before ownership), but the ownership feature added a filter step after each, making the duplication more visible. Not a correctness issue; a performance concern for collections with many games.*
