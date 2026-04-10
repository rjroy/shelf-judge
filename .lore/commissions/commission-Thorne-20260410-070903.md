---
title: "Commission: Review: Tournament Overhead Phase 3+4"
date: 2026-04-10
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review Phases 3 and 4 of the tournament overhead reduction.\n\n**Spec**: `.lore/specs/reduce-tournament-overhead.md`\n**Plan**: `.lore/plans/reduce-tournament-overhead.md`\n\nFocus areas:\n1. **submitComparison**: Does it correctly update cached wins/losses/recentComparisons? Is the FIFO cap enforced?\n2. **deriveDisplayStats**: Reads from cache, not from scanning comparisons?\n3. **getNextPair**: Pair dedup reads from session.comparisons only?\n4. **Session completion**: All 5 locations (endSession + 4 auto-complete paths) clear session.comparisons?\n5. **Game deletion**: recentComparisons left intact per REQ-RTO-11?\n6. **Recalculate removal**: Fully removed from routes, CLI, web, elo-engine? No stale references in production code?\n7. **Client grep results**: Confirm `recalculate` and `data.comparisons` don't appear in production code\n8. **Test coverage**: All new behaviors tested? All fixtures updated?\n\nWalk each REQ-RTO requirement against the implementation."
dependencies:
  - commission-Dalton-20260410-070855
linked_artifacts:
  - packages/daemon/src/services/tournament-service.ts

  - packages/daemon/src/services/storage-service.ts
  - packages/daemon/src/routes/tournament.ts
  - packages/daemon/src/services/elo-engine.ts
  - packages/daemon/src/services/tournament-migration.ts
  - packages/shared/src/types.ts
  - packages/shared/src/validation.ts
  - packages/cli/src/commands/tournament.ts
  - packages/web/lib/api.ts
  - packages/daemon/src/services/storage-service.ts
  - packages/daemon/src/routes/tournament.ts
  - packages/daemon/src/services/elo-engine.ts
  - packages/daemon/src/services/tournament-migration.ts
  - packages/shared/src/types.ts
  - packages/shared/src/validation.ts
  - packages/cli/src/commands/tournament.ts
  - packages/web/lib/api.ts
activity_timeline:
  - timestamp: 2026-04-10T14:09:03.314Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T14:09:54.550Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-10T18:15:01.557Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-10T18:15:01.560Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T18:15:01.581Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T18:15:10.097Z
    event: progress_report
    reason: "Starting review. Reading spec, plan, and predecessor commission artifact."
  - timestamp: 2026-04-10T18:15:35.685Z
    event: progress_report
    reason: "Read spec, plan, both commission artifacts, tournament-service.ts, and storage-service.ts. Now reading remaining files: elo-engine, routes, CLI, web api, shared types, validation, and tests."
  - timestamp: 2026-04-10T18:15:58.109Z
    event: progress_report
    reason: "Read all production code. Now reading test files to verify coverage."
  - timestamp: 2026-04-10T18:16:30.460Z
    event: progress_report
    reason: "Read all production and test code. Now running the grep checks and recording findings."
  - timestamp: 2026-04-10T18:20:40.619Z
    event: progress_report
    reason: "All findings recorded. Compiling final review with requirement-by-requirement walkthrough."
  - timestamp: 2026-04-10T18:21:10.323Z
    event: result_submitted
    reason: "## Review: Phases 3 & 4 of Tournament Overhead Reduction\n\n### Findings (priority order)\n\n**1. DEFECT: All-stats endpoint no longer enriches `opponentGameName`**\nFile: `packages/daemon/src/routes/tournament.ts:188-207`\n\nThe `GET /tournament/stats` route builds a `nameMap` but only uses it for the top-level `gameName` field (line 199). It does NOT enrich `stats.recentComparisons[].opponentGameName`. The single-game route at lines 169-186 does enrich. Before this change, `deriveDisplayStats` resolved game names internally. Now it returns `opponentGameName: null` (tournament-service.ts:130) and relies on route-layer enrichment, but only the single-game route performs it.\n\nImpact: Any consumer of the all-stats endpoint that displays recent comparisons will show `null` for opponent names. The web UI at `app/games/[id]/page.tsx:239` has a fallback (`c.opponentGameName ?? c.opponentGameId.slice(0, 8)`) that would show truncated IDs instead of names. The CLI's all-stats view doesn't display recentComparisons, so it's unaffected. The spec says \"No changes to display or API response shapes\" (scope exclusion), but this IS a semantic change to the all-stats response.\n\nFix: Add enrichment loop to the all-stats route, mirroring the single-game route pattern:\n```typescript\nfor (const entry of result) {\n  for (const comp of entry.stats.recentComparisons) {\n    comp.opponentGameName = nameMap.get(comp.opponentGameId) ?? null;\n  }\n}\n```\n\n**2. TEST GAP: `onGameDeleted` auto-complete path never exercises comparison clearing**\nFile: `packages/daemon/tests/tournament-service.test.ts:736-744`\n\nThe test verifies that deleting a game auto-completes the session (status becomes \"completed\"), but no comparisons are submitted before the deletion. Since `session.comparisons` starts as `[]`, the test passes regardless of whether `active.comparisons = []` (tournament-service.ts:464) exists. Removing that line would not cause any test to fail.\n\nAll other auto-complete paths have explicit tests for comparison clearing: endSession (line 594), startSession (line 606), getNextPair pair-exhaustion (line 618).\n\nFix: Submit at least one comparison before the game deletion, then verify `session.comparisons` is `[]` after auto-complete.\n\n---\n\n### Requirement Walkthrough\n\n| Requirement | Status | Evidence |\n|---|---|---|\n| REQ-RTO-1: `wins`, `losses` on `TournamentGameStats` | Satisfied | types.ts:169-170 |\n| REQ-RTO-2: `recentComparisons` capped at 10, FIFO | Satisfied | types.ts:171, tournament-service.ts:395-402 |\n| REQ-RTO-3: Top-level `comparisons` removed | Satisfied | types.ts:174-178, no `comparisons` field |\n| REQ-RTO-4: Session-scoped `comparisons` | Satisfied | types.ts:148, cleared on completion |\n| REQ-RTO-5: `Comparison` type unchanged | Satisfied | types.ts:151-158 |\n| REQ-RTO-6: `submitComparison` updates all cached fields | Satisfied | tournament-service.ts:337-402 |\n| REQ-RTO-7: `deriveDisplayStats` reads from cache | Satisfied | tournament-service.ts:97-145, comment updated on types.ts:197 |\n| REQ-RTO-8: `getNextPair` dedup from `session.comparisons` | Satisfied | tournament-service.ts:276-280 |\n| REQ-RTO-9: `recalculate` removed | Satisfied | grep confirms no tournament recalculate in production code |\n| REQ-RTO-10: Session completion clears comparisons | Satisfied | All 6 paths verified (endSession, startSession, getNextPair x3, onGameDeleted) |\n| REQ-RTO-11: Game deletion leaves `recentComparisons` intact | Satisfied | onGameDeleted does not touch other games' recentComparisons |\n| REQ-RTO-14: Zod schema accepts both formats | Satisfied | validation.ts:144-149, optional fields with defaults |\n\n(REQ-RTO-12, REQ-RTO-13 are migration requirements reviewed in the Phase 2 review, not this commission's scope.)\n\n### Client Grep Results (confirmed)\n\n- `recalculate`: Only match in `packages/daemon/tests/integration/end-to-end.test.ts:298` (axis-related, not tournament). Clean.\n- `data.comparisons`: Only match in `packages/shared/tests/validation.test.ts:610` (checking absence post-migration). Clean.\n\n### Summary\n\nThe implementation satisfies all 12 applicable REQ-RTO requirements. The code is clean, well-structured, and the test coverage is substantial (9 new service tests, 13 migration tests). Two findings:\n\n1. The all-stats endpoint has a behavioral regression where `opponentGameName` is always null in `recentComparisons`. This needs a fix before the all-stats endpoint can be trusted by consumers that display recent comparisons.\n2. The `onGameDeleted` auto-complete path lacks a test that exercises the comparison-clearing behavior. The code is correct; the test doesn't prove it."
  - timestamp: 2026-04-10T18:21:21.298Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All findings recorded. Compiling final review with requirement-by-requirement walkthrough."
projectName: shelf-judge
---
## Review: Phases 3 & 4 of Tournament Overhead Reduction

### Findings (priority order)

**1. DEFECT: All-stats endpoint no longer enriches `opponentGameName`**
File: `packages/daemon/src/routes/tournament.ts:188-207`

The `GET /tournament/stats` route builds a `nameMap` but only uses it for the top-level `gameName` field (line 199). It does NOT enrich `stats.recentComparisons[].opponentGameName`. The single-game route at lines 169-186 does enrich. Before this change, `deriveDisplayStats` resolved game names internally. Now it returns `opponentGameName: null` (tournament-service.ts:130) and relies on route-layer enrichment, but only the single-game route performs it.

Impact: Any consumer of the all-stats endpoint that displays recent comparisons will show `null` for opponent names. The web UI at `app/games/[id]/page.tsx:239` has a fallback (`c.opponentGameName ?? c.opponentGameId.slice(0, 8)`) that would show truncated IDs instead of names. The CLI's all-stats view doesn't display recentComparisons, so it's unaffected. The spec says "No changes to display or API response shapes" (scope exclusion), but this IS a semantic change to the all-stats response.

Fix: Add enrichment loop to the all-stats route, mirroring the single-game route pattern:
```typescript
for (const entry of result) {
  for (const comp of entry.stats.recentComparisons) {
    comp.opponentGameName = nameMap.get(comp.opponentGameId) ?? null;
  }
}
```

**2. TEST GAP: `onGameDeleted` auto-complete path never exercises comparison clearing**
File: `packages/daemon/tests/tournament-service.test.ts:736-744`

The test verifies that deleting a game auto-completes the session (status becomes "completed"), but no comparisons are submitted before the deletion. Since `session.comparisons` starts as `[]`, the test passes regardless of whether `active.comparisons = []` (tournament-service.ts:464) exists. Removing that line would not cause any test to fail.

All other auto-complete paths have explicit tests for comparison clearing: endSession (line 594), startSession (line 606), getNextPair pair-exhaustion (line 618).

Fix: Submit at least one comparison before the game deletion, then verify `session.comparisons` is `[]` after auto-complete.

---

### Requirement Walkthrough

| Requirement | Status | Evidence |
|---|---|---|
| REQ-RTO-1: `wins`, `losses` on `TournamentGameStats` | Satisfied | types.ts:169-170 |
| REQ-RTO-2: `recentComparisons` capped at 10, FIFO | Satisfied | types.ts:171, tournament-service.ts:395-402 |
| REQ-RTO-3: Top-level `comparisons` removed | Satisfied | types.ts:174-178, no `comparisons` field |
| REQ-RTO-4: Session-scoped `comparisons` | Satisfied | types.ts:148, cleared on completion |
| REQ-RTO-5: `Comparison` type unchanged | Satisfied | types.ts:151-158 |
| REQ-RTO-6: `submitComparison` updates all cached fields | Satisfied | tournament-service.ts:337-402 |
| REQ-RTO-7: `deriveDisplayStats` reads from cache | Satisfied | tournament-service.ts:97-145, comment updated on types.ts:197 |
| REQ-RTO-8: `getNextPair` dedup from `session.comparisons` | Satisfied | tournament-service.ts:276-280 |
| REQ-RTO-9: `recalculate` removed | Satisfied | grep confirms no tournament recalculate in production code |
| REQ-RTO-10: Session completion clears comparisons | Satisfied | All 6 paths verified (endSession, startSession, getNextPair x3, onGameDeleted) |
| REQ-RTO-11: Game deletion leaves `recentComparisons` intact | Satisfied | onGameDeleted does not touch other games' recentComparisons |
| REQ-RTO-14: Zod schema accepts both formats | Satisfied | validation.ts:144-149, optional fields with defaults |

(REQ-RTO-12, REQ-RTO-13 are migration requirements reviewed in the Phase 2 review, not this commission's scope.)

### Client Grep Results (confirmed)

- `recalculate`: Only match in `packages/daemon/tests/integration/end-to-end.test.ts:298` (axis-related, not tournament). Clean.
- `data.comparisons`: Only match in `packages/shared/tests/validation.test.ts:610` (checking absence post-migration). Clean.

### Summary

The implementation satisfies all 12 applicable REQ-RTO requirements. The code is clean, well-structured, and the test coverage is substantial (9 new service tests, 13 migration tests). Two findings:

1. The all-stats endpoint has a behavioral regression where `opponentGameName` is always null in `recentComparisons`. This needs a fix before the all-stats endpoint can be trusted by consumers that display recent comparisons.
2. The `onGameDeleted` auto-complete path lacks a test that exercises the comparison-clearing behavior. The code is correct; the test doesn't prove it.

## Decisions

**Does the all-stats route (`GET /tournament/stats`) enrich `opponentGameName` in `recentComparisons`?**
No. The all-stats route at tournament.ts:188-207 builds a nameMap but only uses it for the top-level `gameName` field (line 199). It does NOT iterate over each game's `recentComparisons` to populate `opponentGameName`. The single-game route at lines 169-186 does enrich. This means the all-stats endpoint returns `opponentGameName: null` for all recent comparisons, which is a regression from the old behavior where `deriveDisplayStats` resolved game names internally.
*Reasoning: Evidence: tournament.ts:197-201 maps entries to `{ gameId, gameName, stats: gameStats }` without touching `gameStats.recentComparisons`. The `opponentGameName` enrichment at line 179 only executes in the single-game route handler. The web UI at `app/games/[id]/page.tsx:239` uses `c.opponentGameName ?? c.opponentGameId.slice(0, 8)` which would fall back to ID prefix if the name is null. The CLI's all-stats display doesn't show recentComparisons so the CLI isn't affected, but any web component using the all-stats endpoint for recent comparison display would show IDs instead of names.*

**Does the `onGameDeleted` auto-complete path have test coverage for clearing session comparisons?**
No. The test at tournament-service.test.ts:736-744 verifies that deleting a game auto-completes the session (status becomes "completed"), but it does not verify that `session.comparisons` is cleared to `[]`. The test starts a session, deletes a game, and checks status. Because no comparisons are submitted before the deletion, `session.comparisons` is already `[]` at test time regardless of whether line 464 exists.
*Reasoning: Evidence: The test at line 736-744 only asserts `status === "completed"`. The production code at tournament-service.ts:462-465 sets both `active.status = "completed"` and `active.comparisons = []`. Removing the `active.comparisons = []` line would not cause any existing test to fail because the session starts with an empty comparisons array and no comparison is submitted before the game deletion. The endSession and getNextPair auto-complete paths have explicit tests for clearing comparisons (lines 594, 606, 618) but onGameDeleted does not.*

**Does `submitComparison` correctly update cached wins/losses/recentComparisons with FIFO cap?**
Yes. The implementation at tournament-service.ts:379-402 correctly increments wins for the winner and losses for the loser, creates `CachedRecentComparison` entries for both games, uses `unshift` to prepend (most-recent-first ordering), and `pop` to drop the oldest when length exceeds 10. The FIFO cap enforcement is correct: unshift adds to front, pop removes from back.
*Reasoning: Evidence: Lines 381-382 use `data.gameStats[winnerId].wins++` and `data.gameStats[loserId].losses++`. Lines 395-402 use `unshift` (prepend to array = most-recent-first) then check `length > 10` and `pop` (remove last = oldest). This correctly maintains the invariant from REQ-RTO-2. Test at line 567-580 confirms the cap by submitting 12 comparisons and verifying length is 10.*

**Does `deriveDisplayStats` read from cache and not scan comparisons?**
Yes. The rewritten function at tournament-service.ts:97-145 reads `wins`, `losses`, and `recentComparisons` directly from `data.gameStats[gameId]` (lines 126-133). There is no comparisons array to scan. The function maps `CachedRecentComparison` to `RecentComparison` by adding `opponentGameName: null`, which is enriched at the route layer.
*Reasoning: Evidence: Lines 126-133 read from `cached?.wins`, `cached?.losses`, and `cached?.recentComparisons`. No iteration over any comparisons collection occurs. The function is now O(1) per game instead of O(n) where n was the total comparison count.*

**Do all 5 session completion paths (endSession + 4 auto-complete) clear session.comparisons?**
Yes, all 6 locations that transition a session to "completed" also set `session.comparisons = []`. The 6 locations are: endSession (line 207), startSession auto-complete (line 161), getNextPair < 4 games (line 230), getNextPair selectedA null (line 259), getNextPair all pairs exhausted (line 295), and onGameDeleted auto-complete (line 464).
*Reasoning: Evidence: Every location in tournament-service.ts that sets `session.status = "completed"` or `active.status = "completed"` also sets the corresponding `.comparisons = []`. Verified by reading each code path. Note: the commission prompt asks about "5 locations (endSession + 4 auto-complete paths)" but there are actually 6: endSession + startSession + getNextPair x3 + onGameDeleted.*

**Is the `recalculate` operation fully removed from routes, CLI, web, and elo-engine?**
Yes. Grep confirms `recalculate` appears only in an unrelated test (axis recalculation) and in lore docs. The route file has no recalculate handler or operation definition. The elo-engine exports only `calculateExpectedScore`, `calculateNewRatings`, `normalizeElo`, and `shouldDisplayRanking`. The CLI has no recalculate command. The web API helper has no recalculate function.
*Reasoning: Evidence: `grep -r recalculate packages/` returns only `packages/daemon/tests/integration/end-to-end.test.ts:298` which is about axis deletion, not tournament. All tournament-related recalculate references have been removed.*

**Does game deletion leave `recentComparisons` intact per REQ-RTO-11?**
Yes. The `onGameDeleted` method at tournament-service.ts:448-469 deletes `data.gameStats[gameId]` (line 452) but does not touch other games' `recentComparisons` arrays. Entries referencing the deleted game persist in surviving games' stats. The `opponentGameName` resolves to `null` at display time when the game doesn't exist, falling back to a truncated ID in both CLI (line 270) and web UI (page.tsx:239).
*Reasoning: Evidence: The `onGameDeleted` function only modifies `data.gameStats` via `delete data.gameStats[gameId]` and the active session's `gameIds`. No iteration over other games' `recentComparisons` occurs. Test at line 707-717 confirms: after deleting g1, g2's recentComparisons still references g1.*
