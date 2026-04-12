---
title: "Commission: Review: Redundancy scoring Phases 5-6"
date: 2026-04-12
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the redundancy scoring route integration (Phases 5-6) against the plan at `.lore/plans/redundancy-scoring.md` and spec at `.lore/specs/redundancy-scoring.md`.\n\nThis is the highest-risk phase. Check:\n1. All THREE route handlers updated: GET /games, GET /games/:id, GET /predictions/bgg/:bggId\n2. Computation order in each handler: scores → niches (pre-redundancy) → redundancy (REQ-REDUN-26)\n3. In integrated mode, `score.score` updated to `adjustedScore` AFTER niche computation\n4. In annotation mode, `score.score` unchanged, `redundancyAdjustment` populated\n5. Prediction route creates temporary GameWithScore for candidate and runs full pass (REQ-REDUN-22)\n6. Pre-redundancy scores used for existing games in prediction preview (REQ-REDUN-23)\n7. `PredictedGameResponse` has `redundancyPreview` field (REQ-REDUN-22)\n8. Feature vector caching per-request (Open Question 1)\n9. `getFeatureVector` callback built correctly (vocabulary, ranges, axes from collection)\n10. Web helpers in api.ts match the route paths\n11. Type re-exports updated\n12. Integration tests cover annotation mode, integrated mode, disabled mode, prediction preview\n\nReport ALL findings."
dependencies:
  - commission-Dalton-20260412-064151
linked_artifacts:
  - packages/daemon/src/routes/games.ts

  - packages/daemon/src/routes/prediction.ts
  - packages/shared/src/types.ts
  - packages/web/lib/api.ts
  - packages/daemon/tests/redundancy-integration.test.ts
  - packages/daemon/src/services/redundancy-engine.ts
  - packages/daemon/src/routes/prediction.ts
  - packages/shared/src/types.ts
  - packages/web/lib/api.ts
  - packages/daemon/tests/redundancy-integration.test.ts
  - packages/daemon/src/services/redundancy-engine.ts
activity_timeline:
  - timestamp: 2026-04-12T13:41:59.277Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T13:45:52.839Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T14:09:01.704Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T14:09:01.707Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T14:09:01.733Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T14:09:08.611Z
    event: progress_report
    reason: "Starting review of redundancy scoring route integration (Phases 5-6). Reading plan, spec, and dependency commission first."
  - timestamp: 2026-04-12T14:09:37.116Z
    event: progress_report
    reason: "Read plan, spec, commission result, all route handlers, types, web helpers, engine, and integration tests. Now analyzing against the 12 review criteria."
  - timestamp: 2026-04-12T14:13:54.994Z
    event: progress_report
    reason: "All 12 review criteria examined. Recording final findings and submitting result."
  - timestamp: 2026-04-12T14:14:30.150Z
    event: result_submitted
    reason: "## Redundancy Scoring Route Integration Review (Phases 5-6)\n\n### Findings by Priority\n\n**1. DEFECT: Score source inconsistency between list and detail endpoints**\nFile: `packages/daemon/src/routes/games.ts`\n\n`GET /games` (without `includePredicted`) runs the redundancy pass on `gameService.listGames()` (line 167), which returns non-prediction-enriched scores. `GET /games/:id` runs redundancy on `predictionService.listGamesWithPredictions()` (line 202), which returns prediction-enriched scores. The same game can receive different redundancy adjustments depending on which endpoint is queried.\n\nImpact: When a user views the collection list, game C shows penalty X. When they click into game C's detail view, the penalty is recomputed against different neighbor scores and may show penalty Y. This creates a visible inconsistency between the two views.\n\nFix: Either always use prediction-enriched scores for redundancy (even in the non-predicted list path, by loading allGames from predictionService), or document this as intentional behavior where redundancy reflects the scoring context of the current view.\n\n**2. DEFECT: `PredictedGameResponse.redundancyPreview` declared optional instead of required nullable**\nFile: `packages/shared/src/types.ts:420`\n\nThe spec (REQ-REDUN-22) and plan (Phase 5e) define `redundancyPreview: RedundancyAdjustment | null`. The implementation uses `redundancyPreview?: RedundancyAdjustment | null`. The `?` makes the field optional, meaning consumers see `RedundancyAdjustment | null | undefined` instead of `RedundancyAdjustment | null`.\n\nImpact: TypeScript consumers cannot distinguish \"field was never sent\" from \"field is null.\" The route handler at prediction.ts:120 always includes the field, so the wire format is correct, but the type contract is looser than specified. This follows the precedent set by `nicheImpact?`, but the spec explicitly defines this as required nullable.\n\nFix: Remove the `?` from `redundancyPreview`. Update any existing code that constructs `PredictedGameResponse` without the field to include `redundancyPreview: null`.\n\n**3. GAP: Integration test for niche pre-redundancy scores has a weak assertion**\nFile: `packages/daemon/tests/redundancy-integration.test.ts:335`\n\nThe test at line 335 guards niche comparison with `if (bodyAnnotation.nichePosition && bodyIntegrated.nichePosition)`. If both happen to be null (e.g., because no games share mechanics in the test fixtures, or the niche engine returns empty for this game), the assertion block is skipped entirely and the test passes vacuously.\n\nFix: Assert that `nichePosition` is non-null before entering the comparison block: `expect(bodyAnnotation.nichePosition).not.toBeNull()`.\n\n**4. GAP: No integration test for REQ-REDUN-23 (pre-redundancy scores in prediction preview)**\nFile: `packages/daemon/tests/redundancy-integration.test.ts:297-318`\n\nThe spec success criteria include: \"Redundancy preview for a candidate game computes against pre-redundancy collection scores.\" The test only verifies the preview is non-null and has neighbors. It does not assert that the neighbor fitness scores in the preview are the original (pre-redundancy) scores rather than post-redundancy scores.\n\nImpact: If a future change accidentally applied redundancy to existing games before computing the preview, this test would not catch it.\n\nFix: Assert that `redundancyPreview.nicheNeighbors[n].fitnessScore` matches the known original scores of the fixture games (8.0, 6.0, 4.0).\n\n**5. CONCERN: Redundancy gated by predictionService in GET /games/:id**\nFile: `packages/daemon/src/routes/games.ts:200-225`\n\nThe redundancy computation is nested inside `if (predictionService)`. If predictionService were absent, redundancy would silently not run even when storageService is present and redundancy is enabled. In production, all deps are provided, so this is not a runtime bug. But it creates a structural coupling: redundancy's execution depends on predictionService, which is not a logical dependency. The coupling is an artifact of sharing the `allGames` variable from niche computation.\n\n**6. STYLE: Non-null assertions on `result.score!` without guarding result.score**\nFile: `packages/daemon/src/routes/games.ts:213, 218`\n\nLines 213 and 218 use `result.score!` (non-null assertion). The guard at line 212 checks `thisGame?.score` (the allGames entry), not `result.score`. While `getGame` always returns a computed score in practice, the assertion hides the assumption. A null check on `result.score` before the assignment would be explicit.\n\n### Requirements Checklist\n\n| Criterion | Status |\n|---|---|\n| All three route handlers updated | PASS |\n| Computation order: scores → niches → redundancy (REQ-REDUN-26) | PASS |\n| Integrated mode: score.score updated after niche computation | PASS |\n| Annotation mode: score.score unchanged, redundancyAdjustment populated | PASS |\n| Prediction route: temporary GameWithScore, full pass (REQ-REDUN-22) | PASS |\n| Pre-redundancy scores for existing games in preview (REQ-REDUN-23) | PASS (code correct, test weak) |\n| PredictedGameResponse has redundancyPreview field | PASS (type optionality deviates from spec) |\n| Feature vector caching per-request (Open Question 1) | PASS |\n| getFeatureVector callback built correctly | PASS |\n| Web helpers match route paths | PASS |\n| Type re-exports updated | PASS |\n| Integration tests cover annotation/integrated/disabled/preview | PASS (gaps noted in findings 3-4) |\n\n### Summary\n\nThe implementation is functionally correct. The redundancy engine integration follows the plan's design: shared `applyRedundancy` helper for game routes, custom logic for the prediction route, per-request feature vector caching, and correct ordering (scores → niches → redundancy). All three route handlers, the web client helpers, and the type re-exports are in place.\n\nTwo defects require attention: the score source inconsistency between list and detail endpoints (finding 1, highest priority), and the optional type declaration that deviates from the spec (finding 2). The test suite covers the critical paths but has two weak spots that should be tightened (findings 3-4)."
  - timestamp: 2026-04-12T14:14:39.331Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All 12 review criteria examined. Recording final findings and submitting result."
projectName: shelf-judge
---
## Redundancy Scoring Route Integration Review (Phases 5-6)

### Findings by Priority

**1. DEFECT: Score source inconsistency between list and detail endpoints**
File: `packages/daemon/src/routes/games.ts`

`GET /games` (without `includePredicted`) runs the redundancy pass on `gameService.listGames()` (line 167), which returns non-prediction-enriched scores. `GET /games/:id` runs redundancy on `predictionService.listGamesWithPredictions()` (line 202), which returns prediction-enriched scores. The same game can receive different redundancy adjustments depending on which endpoint is queried.

Impact: When a user views the collection list, game C shows penalty X. When they click into game C's detail view, the penalty is recomputed against different neighbor scores and may show penalty Y. This creates a visible inconsistency between the two views.

Fix: Either always use prediction-enriched scores for redundancy (even in the non-predicted list path, by loading allGames from predictionService), or document this as intentional behavior where redundancy reflects the scoring context of the current view.

**2. DEFECT: `PredictedGameResponse.redundancyPreview` declared optional instead of required nullable**
File: `packages/shared/src/types.ts:420`

The spec (REQ-REDUN-22) and plan (Phase 5e) define `redundancyPreview: RedundancyAdjustment | null`. The implementation uses `redundancyPreview?: RedundancyAdjustment | null`. The `?` makes the field optional, meaning consumers see `RedundancyAdjustment | null | undefined` instead of `RedundancyAdjustment | null`.

Impact: TypeScript consumers cannot distinguish "field was never sent" from "field is null." The route handler at prediction.ts:120 always includes the field, so the wire format is correct, but the type contract is looser than specified. This follows the precedent set by `nicheImpact?`, but the spec explicitly defines this as required nullable.

Fix: Remove the `?` from `redundancyPreview`. Update any existing code that constructs `PredictedGameResponse` without the field to include `redundancyPreview: null`.

**3. GAP: Integration test for niche pre-redundancy scores has a weak assertion**
File: `packages/daemon/tests/redundancy-integration.test.ts:335`

The test at line 335 guards niche comparison with `if (bodyAnnotation.nichePosition && bodyIntegrated.nichePosition)`. If both happen to be null (e.g., because no games share mechanics in the test fixtures, or the niche engine returns empty for this game), the assertion block is skipped entirely and the test passes vacuously.

Fix: Assert that `nichePosition` is non-null before entering the comparison block: `expect(bodyAnnotation.nichePosition).not.toBeNull()`.

**4. GAP: No integration test for REQ-REDUN-23 (pre-redundancy scores in prediction preview)**
File: `packages/daemon/tests/redundancy-integration.test.ts:297-318`

The spec success criteria include: "Redundancy preview for a candidate game computes against pre-redundancy collection scores." The test only verifies the preview is non-null and has neighbors. It does not assert that the neighbor fitness scores in the preview are the original (pre-redundancy) scores rather than post-redundancy scores.

Impact: If a future change accidentally applied redundancy to existing games before computing the preview, this test would not catch it.

Fix: Assert that `redundancyPreview.nicheNeighbors[n].fitnessScore` matches the known original scores of the fixture games (8.0, 6.0, 4.0).

**5. CONCERN: Redundancy gated by predictionService in GET /games/:id**
File: `packages/daemon/src/routes/games.ts:200-225`

The redundancy computation is nested inside `if (predictionService)`. If predictionService were absent, redundancy would silently not run even when storageService is present and redundancy is enabled. In production, all deps are provided, so this is not a runtime bug. But it creates a structural coupling: redundancy's execution depends on predictionService, which is not a logical dependency. The coupling is an artifact of sharing the `allGames` variable from niche computation.

**6. STYLE: Non-null assertions on `result.score!` without guarding result.score**
File: `packages/daemon/src/routes/games.ts:213, 218`

Lines 213 and 218 use `result.score!` (non-null assertion). The guard at line 212 checks `thisGame?.score` (the allGames entry), not `result.score`. While `getGame` always returns a computed score in practice, the assertion hides the assumption. A null check on `result.score` before the assignment would be explicit.

### Requirements Checklist

| Criterion | Status |
|---|---|
| All three route handlers updated | PASS |
| Computation order: scores → niches → redundancy (REQ-REDUN-26) | PASS |
| Integrated mode: score.score updated after niche computation | PASS |
| Annotation mode: score.score unchanged, redundancyAdjustment populated | PASS |
| Prediction route: temporary GameWithScore, full pass (REQ-REDUN-22) | PASS |
| Pre-redundancy scores for existing games in preview (REQ-REDUN-23) | PASS (code correct, test weak) |
| PredictedGameResponse has redundancyPreview field | PASS (type optionality deviates from spec) |
| Feature vector caching per-request (Open Question 1) | PASS |
| getFeatureVector callback built correctly | PASS |
| Web helpers match route paths | PASS |
| Type re-exports updated | PASS |
| Integration tests cover annotation/integrated/disabled/preview | PASS (gaps noted in findings 3-4) |

### Summary

The implementation is functionally correct. The redundancy engine integration follows the plan's design: shared `applyRedundancy` helper for game routes, custom logic for the prediction route, per-request feature vector caching, and correct ordering (scores → niches → redundancy). All three route handlers, the web client helpers, and the type re-exports are in place.

Two defects require attention: the score source inconsistency between list and detail endpoints (finding 1, highest priority), and the optional type declaration that deviates from the spec (finding 2). The test suite covers the critical paths but has two weak spots that should be tightened (findings 3-4).

## Decisions

**Are all three route handlers updated with redundancy integration?**
SATISFIED. GET /games (games.ts:143), GET /games/:id (games.ts:194), and GET /predictions/bgg/:bggId (prediction.ts:69) all integrate the redundancy engine.
*Reasoning: games.ts imports computeRedundancyAdjustments and feature-vector helpers. Both GET /games paths (predicted and non-predicted) call applyRedundancy. GET /games/:id does the same via applyRedundancy on allGames. prediction.ts builds its own feature vector provider and runs the redundancy pass with the candidate included.*

**Is the computation order correct: scores → niches (pre-redundancy) → redundancy (REQ-REDUN-26)?**
SATISFIED. In all three route handlers, niches are computed first on pre-redundancy scores, then the redundancy pass runs.
*Reasoning: GET /games (predicted path): lines 149-163, niches at 150-158, redundancy at 160-163. GET /games (non-predicted): lines 167-185, niches at 169-178, redundancy at 182-185. GET /games/:id: lines 200-222, niches at 201-204, redundancy at 207-222. In all cases, applyRedundancy runs after computeNichePositions.*

**In integrated mode, is score.score updated to adjustedScore AFTER niche computation?**
SATISFIED. The applyRedundancy helper (games.ts:78-80) only modifies score.score after the engine returns adjustments. Since applyRedundancy is called after niche computation, the score mutation happens post-niches.
*Reasoning: applyRedundancy at line 78: `if (adj && settings.stage === "integrated") { gws.score.score = adj.adjustedScore; }`. This mutation occurs only inside applyRedundancy, which is always invoked after computeNichePositions in all three handlers.*

**In annotation mode, is score.score unchanged with redundancyAdjustment populated?**
SATISFIED. applyRedundancy at games.ts:78 only modifies score.score when stage === "integrated". In annotation mode, the conditional is false, so score.score remains unchanged while redundancyAdjustment is set at line 77.
*Reasoning: Line 77: `gws.score.redundancyAdjustment = adj;` (always set). Line 78: `if (adj && settings.stage === "integrated")` gates the score mutation. Tests at redundancy-integration.test.ts:241-252 verify this.*

**Does the prediction route create a temporary GameWithScore and run the full pass? (REQ-REDUN-22)**
SATISFIED. prediction.ts:104-116 creates candidateGws, spreads it into [...allGames, candidateGws], runs computeRedundancyAdjustments, and extracts the candidate's adjustment as redundancyPreview.
*Reasoning: Lines 104-107: `const candidateGws: GameWithScore = { game: result.game, score: result.score };`. Lines 111-115: full pass with candidate included. Line 116: `redundancyPreview = adjustments.get(result.game.id) ?? null;`*

**Are pre-redundancy scores used for existing games in the prediction preview? (REQ-REDUN-23)**
SATISFIED. The allGames at prediction.ts:80 come from listGamesWithPredictions() which returns pre-redundancy scores. The redundancy engine reads score.score from these unmodified entries. The engine does not mutate scores (it only returns a Map), and the route discards adjustments for existing games at line 116.
*Reasoning: computeRedundancyAdjustments returns a Map without mutating inputs. The route handler only extracts the candidate's adjustment. Existing games' adjustments are computed but discarded, and their scores are never modified.*

**FINDING: PredictedGameResponse.redundancyPreview type declaration**
DEFECT. types.ts:420 declares `redundancyPreview?: RedundancyAdjustment | null` (optional). REQ-REDUN-22 specifies `redundancyPreview: RedundancyAdjustment | null` (required, nullable). The route at prediction.ts:120 always includes the field in the response, so the wire format is correct, but the TypeScript type is weaker than the spec requires. Consumers using the type see `RedundancyAdjustment | null | undefined` instead of `RedundancyAdjustment | null`.
*Reasoning: Spec REQ-REDUN-22 shows the field without `?`. The plan at Phase 5e says "Add `redundancyPreview: RedundancyAdjustment | null`" (no `?`). The `?` was likely added for backwards compatibility with existing code that constructs PredictedGameResponse without the field, but this creates a type that's looser than the spec intends. The existing `nicheImpact?` field sets this precedent, but the spec explicitly defined this as required nullable.*

**FINDING: Redundancy scoring inconsistency between GET /games (non-predicted) and GET /games/:id**
DEFECT. GET /games without includePredicted runs redundancy on `gameService.listGames()` (non-prediction-enriched scores). GET /games/:id runs redundancy on `predictionService.listGamesWithPredictions()` (prediction-enriched scores). The same game can receive different redundancy adjustments depending on which endpoint is queried. When a user views the collection list (non-predicted), a game's penalty is computed against non-enriched neighbor scores. When they click into the detail view, the penalty is recomputed against prediction-enriched scores. The numbers may disagree.
*Reasoning: games.ts:167 uses `gameService.listGames()`. games.ts:202 uses `predictionService.listGamesWithPredictions()`. These return different score values for games with predicted axes. The redundancy engine's "better neighbors" count changes when neighbor scores change, producing different penalties. REQ-REDUN-21 says the single-game path "requires computing fitness scores for all games" but doesn't specify which score source. The plan says to use the existing data, but doesn't call out the mismatch between list and detail paths.*

**FINDING: GET /games/:id redundancy path gated by predictionService existence**
CONCERN. In GET /games/:id (games.ts:200-225), the redundancy computation is nested inside `if (predictionService)`. If predictionService were absent, redundancy would silently not run, even when storageService is present and redundancy is enabled. In practice, all deps are always provided, so this is not a runtime bug. But it creates a structural dependency that the plan doesn't intend: redundancy should depend on storageService (for settings and collection), not on predictionService. The coupling is an artifact of sharing the allGames variable from the niche computation.
*Reasoning: The redundancy pass in GET /games/:id needs allGames, which is fetched inside the predictionService block. Moving the redundancy code outside the predictionService block would require a separate allGames fetch (e.g., from gameService.listGames()), which is the pattern used in the GET /games non-predicted path.*

**FINDING: Feature vector caching per-request (Open Question 1)**
SATISFIED. Both games.ts (applyRedundancy, line 63) and prediction.ts (line 94) implement per-request Map<string, FeatureVector> caches. The cache is constructed in the callback closure, populated on first access, and scoped to the request lifecycle. No cross-request leakage.
*Reasoning: applyRedundancy creates `const vectorCache = new Map<string, FeatureVector>()` at line 63, used in the getFeatureVector closure at lines 64-70. prediction.ts mirrors this at lines 94-101. Both are local to the handler invocation.*

**FINDING: getFeatureVector callback construction correctness**
SATISFIED with one observation. Both handlers build vocabulary and ranges from `collection.games.filter(g => g.bggData)`, then encode using `encodeGame(game, vocabulary, game.ratings, ranges, collection.axes)`. This matches the plan's Phase 5a design. The callback correctly passes game.ratings (from the GameWithScore's game object) and collection.axes.
*Reasoning: applyRedundancy at games.ts:58-60 filters for bggData, builds vocabulary and ranges. Line 67: `encodeGame(game, vocabulary, game.ratings, ranges, collection.axes)` matches the signature from feature-vector.ts. prediction.ts:90-98 mirrors this exactly.*

**FINDING: Web helpers in api.ts match the route paths**
SATISFIED. getRedundancySettings uses `/api/redundancy/settings` (GET), updateRedundancySettings uses `/api/redundancy/settings` (PATCH). These match the route registration pattern for redundancy CRUD endpoints.
*Reasoning: api.ts:282 and api.ts:288 use the correct paths. The redundancy route module registers at `/api` prefix with `/redundancy/settings` path in the Hono router.*

**FINDING: Type re-exports updated**
SATISFIED. index.ts exports ComponentWeights, RedundancyNeighbor, RedundancyAdjustment, RedundancySettings (lines 63-66). api.ts re-exports RedundancySettings, RedundancyAdjustment, RedundancyNeighbor (lines 314-316).
*Reasoning: All three redundancy-specific types plus ComponentWeights are exported from both the shared package index and the web client api.ts.*

**FINDING: Integration test coverage gaps**
GAP. Tests cover the main cases well (10 tests, all critical paths). Two spec success criteria are not explicitly tested: (1) "Redundancy preview for a candidate game computes against pre-redundancy collection scores" (REQ-REDUN-23) - the test only verifies the preview is non-null, not that it uses pre-redundancy scores. (2) No test for disabled mode short-circuiting without computing pairwise similarities (a performance guarantee from REQ-REDUN-5). Additionally, the niche position pre-redundancy test (lines 322-346) has a weak assertion: it only compares niche data when both are non-null (line 335 `if` guard), which could silently pass when both are null.
*Reasoning: Spec success criteria line: "Redundancy preview for a candidate game computes against pre-redundancy collection scores." The test at line 298-308 asserts `body.redundancyPreview` is not null and has neighbors, but doesn't assert the scores used are pre-redundancy. This would require comparing neighbor fitness scores in the preview against the collection's original scores. The niche position test at line 335 uses an `if` that could skip the assertions entirely if both nichePositions happen to be null.*

**FINDING: Non-null assertion on result.score in GET /games/:id**
STYLE CONCERN. games.ts:213 uses `result.score!.redundancyAdjustment` and line 218 uses `result.score!.score`. The `!` non-null assertions bypass TypeScript's null safety. GameWithScore.score is typed as `FitnessResult | null`. If a game has no computable score, these lines throw at runtime. In practice, getGame always returns a computed score, but the assertion hides the assumption rather than proving it.
*Reasoning: The guard at line 212 checks `thisGame?.score` (the allGames entry), not `result.score`. If thisGame has a score but result somehow doesn't (e.g., getGame returned a game without scores due to edge case), the `!` would crash. A guard on `result.score` would be safer.*
