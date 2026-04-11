---
title: "Commission: Review: Prediction Engine Phase 1-3"
date: 2026-04-11
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review Phases 1-3 of the prediction engine implementation.\n\n**Spec**: `.lore/specs/prediction-engine.md`\n**Plan**: `.lore/plans/prediction-engine.md`\n\nFocus areas:\n1. **k-NN math**: Cosine similarity on flattened feature vectors, similarity-weighted average, correct k selection per axis (only games rated on that axis)\n2. **Confidence assignment**: Exact threshold boundaries (5+ matches, variance < 1.5, similarity > 0.7 for strong; etc.)\n3. **Veto behavior**: BGG-derived actual vetoes fire, predicted personal axis values do NOT trigger vetoes (REQ-PRED-10)\n4. **Tournament stability**: Factor formula correct, caps properly, doesn't override base similarity\n5. **Revealed preference tension**: Threshold at 1.0, null when no tournament neighbors\n6. **Type extensions**: `FitnessBreakdownEntry` and `FitnessResult` extended correctly, backward compatible (nullable fields)\n7. **Readiness assessment**: Stage gating, weak axis identification, suggested actions\n8. **Test coverage**: Hand-calculated examples, boundary conditions, edge cases (no BGG data, no ratings, empty collection)\n\nWalk REQ-PRED-1 through REQ-PRED-22 against the implementation.\n\nFiles to review:\n- `packages/shared/src/types.ts` (prediction type extensions)\n- `packages/daemon/src/services/prediction-engine.ts`\n- `packages/daemon/src/services/fitness-service.ts` (predictionMeta: null backfill)\n- All new test files"
dependencies:
  - commission-Dalton-20260410-171726
linked_artifacts:
  - packages/daemon/src/services/prediction-engine.ts

  - packages/shared/src/types.ts
  - packages/daemon/src/services/fitness-service.ts
  - packages/daemon/tests/services/prediction-engine.test.ts
  - packages/daemon/tests/services/prediction-engine-tournament.test.ts
  - packages/shared/src/types.ts
  - packages/daemon/src/services/fitness-service.ts
  - packages/daemon/tests/services/prediction-engine.test.ts
  - packages/daemon/tests/services/prediction-engine-tournament.test.ts
activity_timeline:
  - timestamp: 2026-04-11T00:17:40.126Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T00:20:46.077Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-11T00:29:19.846Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-11T00:29:19.848Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-11T00:29:19.869Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-11T00:29:33.765Z
    event: progress_report
    reason: "Starting review. Reading spec, plan, and implementation files."
  - timestamp: 2026-04-11T00:30:38.231Z
    event: progress_report
    reason: "All files read. Reviewing prediction-engine.ts, types.ts, fitness-service.ts, and both test files against spec requirements REQ-PRED-1 through REQ-PRED-22 (Phases 1-3 scope). Analyzing now."
  - timestamp: 2026-04-11T00:33:01.497Z
    event: progress_report
    reason: "Core analysis complete. Walking REQ-PRED-1 through REQ-PRED-22 against implementation for final requirement mapping. One confirmed defect (ratedAxisCount), one functional gap (cluster suggestions), several test coverage gaps identified."
  - timestamp: 2026-04-11T00:34:14.991Z
    event: result_submitted
    reason: "## Review: Prediction Engine Phases 1-3\n\n### Requirement Coverage (REQ-PRED-1 through REQ-PRED-22)\n\n**Satisfied**: REQ-PRED-1 through 13, 15 through 19, 21, 22, 33, 34. The core k-NN math, confidence architecture, veto behavior, tournament stability, revealed preference tension, and readiness staging all implement the spec correctly.\n\n**Defect**: REQ-PRED-35 (ratedAxisCount semantics).\n**Partial**: REQ-PRED-20 (cluster suggestions missing).\n\n---\n\n### Findings (priority order)\n\n#### 1. DEFECT: `ratedAxisCount` includes predicted axes, violating REQ-PRED-35\n\n**File**: `packages/daemon/src/services/prediction-engine.ts:332,357,366`\n\nThe spec states: \"The existing `ratedAxisCount` field counts axes with actual ratings only (personal or BGG-derived). In predicted results, `ratedAxisCount` may be 0 even when a valid predicted score exists.\"\n\nThe implementation sets `ratedCount = actualAxisCount + predictedAxisCount` and uses this as `ratedAxisCount` on the `FitnessResult`. This inflates `ratedAxisCount` with predicted data, breaking the backward-compatibility contract. Clients that use `ratedAxisCount` to gauge how much user-confirmed data backs a score will get misleading numbers.\n\nThe fix needs to be careful: line 366 uses `ratedCount > 0` as the guard for assigning a non-zero score. If `ratedAxisCount` becomes actual-only, this guard must use the combined count (`actualAxisCount + predictedAxisCount > 0`) while the `FitnessResult` field uses `actualAxisCount` alone.\n\nNo test asserts that `ratedAxisCount === actualAxisCount`, which is why this wasn't caught.\n\n#### 2. GAP: `assessReadiness` omits mechanic/category cluster suggestions (REQ-PRED-20)\n\n**File**: `packages/daemon/src/services/prediction-engine.ts:467-479`\n\nREQ-PRED-20 requires suggested actions that \"name the mechanic/category clusters that are underrepresented (e.g., 'Rate a deck-building game to improve predictions for that mechanic cluster').\" The implementation generates weak-axis suggestions (\"Rate games on Theme\") but never identifies mechanic/category clusters.\n\nThe code has a comment at line 467 acknowledging this: \"This needs game data, but we only have vocabulary and ratings here.\" The function signature receives `vocabulary` (mechanic/category names) and `gameRatings` (per-game axis ratings), but not the actual `Game[]` objects needed to cross-reference which mechanics appear on which games.\n\n**Recommendation**: Either expand the `assessReadiness` signature to accept `Game[]`, or pass a pre-computed `Map<string, Set<string>>` (mechanic name to set of game IDs that have it) so the function can identify which clusters are underrepresented among rated games without taking a full games array.\n\n#### 3. TEST COVERAGE GAPS\n\n**File**: `packages/daemon/tests/services/prediction-engine.test.ts`\n\nMissing test cases from the spec's success criteria and plan verification items:\n\n- **No `ratedAxisCount` assertion**: Would have caught Finding #1. Tests check `predictionMeta.actualAxisCount` and `predictionMeta.predictedAxisCount` but never assert on `fitnessResult.ratedAxisCount` in predicted results.\n\n- **No mixed-confidence overall confidence test**: `PredictionMeta.confidence` should be the lowest non-actual confidence among contributing predicted axes. The existing meta test (line 690) gets all-strong confidence and doesn't exercise the \"lowest wins\" path.\n\n- **No test where all predictions are insufficient**: When every personal axis gets insufficient confidence, `predictedAxisCount` should be 0 and `predictionMeta` should be null. This edge case isn't tested.\n\n- **No BGG-only-data game test for feature vector edge case**: REQ-PRED-11 notes that \"Games with BGG data but no mechanics or categories produce feature vectors composed only of continuous dimensions.\" No test constructs this scenario to verify low similarity / insufficient confidence results.\n\n- **Misleading test name**: `prediction-engine-tournament.test.ts:64` (\"tournamentStability caps at 1.0 + boost and does not grow unbounded\") tests that `findKNearestForAxis` treats the value as a multiplier. The actual capping logic is in Phase 4. The test name claims to test capping behavior it doesn't exercise.\n\n#### 4. OBSERVATION: Variance is computed around the similarity-weighted mean\n\n**File**: `packages/daemon/src/services/prediction-engine.ts:122-126`\n\nThe variance calculation uses the similarity-weighted average as the mean, not the arithmetic mean of ratings. This is a reasonable choice: it measures how spread out ratings are around the predicted value. However, the confidence thresholds (1.5 for strong, 3.0 for moderate) were presumably calibrated against some expectation of spread. If they were intended for arithmetic variance, the weighted-mean variance will be slightly different.\n\nNot a defect. Worth noting for the [STUB: prediction-tuning] calibration work.\n\n### What's solid\n\n- **k-NN math is correct**: `findKNearestForAxis` correctly filters by axis, applies minimum similarity threshold, sorts descending, and slices to k. The per-axis selection (not \"top-k overall, filtered after\") matches the spec exactly.\n\n- **Confidence boundaries are precise**: The boundary tests (4 vs 5 refs, variance at 1.49 vs 1.6, similarity at 0.69 vs 0.71) test the exact threshold edges from REQ-PRED-11.\n\n- **Veto behavior is correct**: BGG-derived vetoes propagate from `calculateActualScore`. The predicted branch never checks veto. The separation is clean.\n\n- **Tournament stability is correctly treated as a simple multiplier**: The engine is agnostic to how the value is computed, making it testable in isolation. Phase 4 owns the formula.\n\n- **Revealed preference tension**: Thresholds, null returns, top-k selection, and directional messaging all match the spec. The tournament test file covers all the boundary conditions.\n\n- **Pure-function discipline maintained**: No I/O, no service dependencies. The `calculateActualScore` callback cleanly separates actual-fitness computation from prediction. Follows the curve-engine/elo-engine pattern.\n\n- **Type extensions are backward-compatible**: `predictionConfidence`, `referenceGames`, and `predictionMeta` are all nullable, and `fitness-service.ts` correctly backfills them as null on existing return paths."
  - timestamp: 2026-04-11T00:34:24.537Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Core analysis complete. Walking REQ-PRED-1 through REQ-PRED-22 against implementation for final requirement mapping. One confirmed defect (ratedAxisCount), one functional gap (cluster suggestions), several test coverage gaps identified."
projectName: shelf-judge
---
## Review: Prediction Engine Phases 1-3

### Requirement Coverage (REQ-PRED-1 through REQ-PRED-22)

**Satisfied**: REQ-PRED-1 through 13, 15 through 19, 21, 22, 33, 34. The core k-NN math, confidence architecture, veto behavior, tournament stability, revealed preference tension, and readiness staging all implement the spec correctly.

**Defect**: REQ-PRED-35 (ratedAxisCount semantics).
**Partial**: REQ-PRED-20 (cluster suggestions missing).

---

### Findings (priority order)

#### 1. DEFECT: `ratedAxisCount` includes predicted axes, violating REQ-PRED-35

**File**: `packages/daemon/src/services/prediction-engine.ts:332,357,366`

The spec states: "The existing `ratedAxisCount` field counts axes with actual ratings only (personal or BGG-derived). In predicted results, `ratedAxisCount` may be 0 even when a valid predicted score exists."

The implementation sets `ratedCount = actualAxisCount + predictedAxisCount` and uses this as `ratedAxisCount` on the `FitnessResult`. This inflates `ratedAxisCount` with predicted data, breaking the backward-compatibility contract. Clients that use `ratedAxisCount` to gauge how much user-confirmed data backs a score will get misleading numbers.

The fix needs to be careful: line 366 uses `ratedCount > 0` as the guard for assigning a non-zero score. If `ratedAxisCount` becomes actual-only, this guard must use the combined count (`actualAxisCount + predictedAxisCount > 0`) while the `FitnessResult` field uses `actualAxisCount` alone.

No test asserts that `ratedAxisCount === actualAxisCount`, which is why this wasn't caught.

#### 2. GAP: `assessReadiness` omits mechanic/category cluster suggestions (REQ-PRED-20)

**File**: `packages/daemon/src/services/prediction-engine.ts:467-479`

REQ-PRED-20 requires suggested actions that "name the mechanic/category clusters that are underrepresented (e.g., 'Rate a deck-building game to improve predictions for that mechanic cluster')." The implementation generates weak-axis suggestions ("Rate games on Theme") but never identifies mechanic/category clusters.

The code has a comment at line 467 acknowledging this: "This needs game data, but we only have vocabulary and ratings here." The function signature receives `vocabulary` (mechanic/category names) and `gameRatings` (per-game axis ratings), but not the actual `Game[]` objects needed to cross-reference which mechanics appear on which games.

**Recommendation**: Either expand the `assessReadiness` signature to accept `Game[]`, or pass a pre-computed `Map<string, Set<string>>` (mechanic name to set of game IDs that have it) so the function can identify which clusters are underrepresented among rated games without taking a full games array.

#### 3. TEST COVERAGE GAPS

**File**: `packages/daemon/tests/services/prediction-engine.test.ts`

Missing test cases from the spec's success criteria and plan verification items:

- **No `ratedAxisCount` assertion**: Would have caught Finding #1. Tests check `predictionMeta.actualAxisCount` and `predictionMeta.predictedAxisCount` but never assert on `fitnessResult.ratedAxisCount` in predicted results.

- **No mixed-confidence overall confidence test**: `PredictionMeta.confidence` should be the lowest non-actual confidence among contributing predicted axes. The existing meta test (line 690) gets all-strong confidence and doesn't exercise the "lowest wins" path.

- **No test where all predictions are insufficient**: When every personal axis gets insufficient confidence, `predictedAxisCount` should be 0 and `predictionMeta` should be null. This edge case isn't tested.

- **No BGG-only-data game test for feature vector edge case**: REQ-PRED-11 notes that "Games with BGG data but no mechanics or categories produce feature vectors composed only of continuous dimensions." No test constructs this scenario to verify low similarity / insufficient confidence results.

- **Misleading test name**: `prediction-engine-tournament.test.ts:64` ("tournamentStability caps at 1.0 + boost and does not grow unbounded") tests that `findKNearestForAxis` treats the value as a multiplier. The actual capping logic is in Phase 4. The test name claims to test capping behavior it doesn't exercise.

#### 4. OBSERVATION: Variance is computed around the similarity-weighted mean

**File**: `packages/daemon/src/services/prediction-engine.ts:122-126`

The variance calculation uses the similarity-weighted average as the mean, not the arithmetic mean of ratings. This is a reasonable choice: it measures how spread out ratings are around the predicted value. However, the confidence thresholds (1.5 for strong, 3.0 for moderate) were presumably calibrated against some expectation of spread. If they were intended for arithmetic variance, the weighted-mean variance will be slightly different.

Not a defect. Worth noting for the [STUB: prediction-tuning] calibration work.

### What's solid

- **k-NN math is correct**: `findKNearestForAxis` correctly filters by axis, applies minimum similarity threshold, sorts descending, and slices to k. The per-axis selection (not "top-k overall, filtered after") matches the spec exactly.

- **Confidence boundaries are precise**: The boundary tests (4 vs 5 refs, variance at 1.49 vs 1.6, similarity at 0.69 vs 0.71) test the exact threshold edges from REQ-PRED-11.

- **Veto behavior is correct**: BGG-derived vetoes propagate from `calculateActualScore`. The predicted branch never checks veto. The separation is clean.

- **Tournament stability is correctly treated as a simple multiplier**: The engine is agnostic to how the value is computed, making it testable in isolation. Phase 4 owns the formula.

- **Revealed preference tension**: Thresholds, null returns, top-k selection, and directional messaging all match the spec. The tournament test file covers all the boundary conditions.

- **Pure-function discipline maintained**: No I/O, no service dependencies. The `calculateActualScore` callback cleanly separates actual-fitness computation from prediction. Follows the curve-engine/elo-engine pattern.

- **Type extensions are backward-compatible**: `predictionConfidence`, `referenceGames`, and `predictionMeta` are all nullable, and `fitness-service.ts` correctly backfills them as null on existing return paths.

## Decisions

**Does ratedAxisCount in computePredictedFitness comply with REQ-PRED-35?**
DEFECT: ratedAxisCount includes predicted axes, contradicting REQ-PRED-35 which says it should count only actual axes.
*Reasoning: prediction-engine.ts:332 sets `ratedCount = actualAxisCount + predictedAxisCount` and uses this as `ratedAxisCount` on the FitnessResult. REQ-PRED-35 explicitly states: "The existing ratedAxisCount field counts axes with actual ratings only (personal or BGG-derived). In predicted results, ratedAxisCount may be 0 even when a valid predicted score exists. Clients that currently treat ratedAxisCount == 0 as 'unscored' must check predictionMeta before making that determination." The implementation adds predicted axis counts to ratedAxisCount, which violates both the spec and the backward-compatibility contract. Clients relying on ratedAxisCount to mean "user-confirmed data" will get inflated numbers.*

**Does assessReadiness satisfy REQ-PRED-20's requirement for mechanic/category cluster suggestions?**
GAP: assessReadiness generates per-axis suggestions ("Rate games on Theme") but does not identify underrepresented mechanic/category clusters as the spec requires.
*Reasoning: REQ-PRED-20 says: "Suggested actions identify axes with the fewest contributing reference games and name the mechanic/category clusters that are underrepresented (e.g., 'Rate a deck-building game to improve predictions for that mechanic cluster')." The implementation at prediction-engine.ts:467-469 has a comment acknowledging this: "This needs game data, but we only have vocabulary and ratings here." The function generates weak-axis suggestions but omits the cluster identification entirely. The function receives a `vocabulary` parameter (which has mechanic/category names) but doesn't receive the actual games to cross-reference which mechanics are underrepresented among rated games. This is a data availability gap in the function signature, not just a TODO.*

**Does the variance calculation use the correct mean?**
OBSERVATION: Variance is computed around the similarity-weighted mean, not the arithmetic mean. This is a reasonable choice but has implications for confidence threshold calibration.
*Reasoning: prediction-engine.ts:122-126 computes population variance as sum((rating - weightedMean)^2) / n. The "rating" variable is the similarity-weighted average. The spec doesn't specify which mean to use. Using the weighted mean means the variance measures spread around the predicted value itself, which is conceptually correct for confidence assessment. However, if a future calibrator expects arithmetic variance, the thresholds (1.5 for strong, 3.0 for moderate) may need adjustment. This is not a defect, just worth documenting for the calibration conversation in the prediction-tuning stub.*

**Is the similarity rounding in referenceGames entries correct?**
OBSERVATION: The reference game similarity is rounded twice: first to one decimal of the percentage value, then divided by 100. This produces values like 0.87, 0.81, etc. which is reasonable for display.
*Reasoning: prediction-engine.ts:229: `similarity: roundToOneDecimal(m.similarity * 100) / 100`. This converts e.g. 0.8734 to 87.3 to 0.873. It preserves 3 decimal places of the original. The spec (REQ-PRED-12) shows "Azul (0.87, rated 8)" which implies 2 decimal places. The rounding gives 3 decimal places, but that's a display concern for clients. Not a defect.*

**Are there test coverage gaps in the prediction test suite?**
GAPS: Several edge cases from the spec's success criteria and plan verification items are untested.
*Reasoning: Missing test cases:
1. No test for a game with BGG data but no mechanics/categories (REQ-PRED-11 note: "Games with BGG data but no mechanics or categories produce feature vectors composed only of continuous dimensions"). The prediction engine tests never construct this scenario.
2. No test for mixed actual+predicted veto behavior where a predicted value would trigger a veto but an actual BGG veto also fires. The test at line 562 tests BGG veto only, and line 634 tests predicted non-veto only, but never combines them.
3. No test asserting `ratedAxisCount` equals `actualAxisCount` (which would have caught the REQ-PRED-35 defect).
4. The readiness test at line 843 checks "2 more games" but doesn't verify Stage 0 behavior end-to-end through computePredictedFitness with BGG-derived axes producing actual scores (REQ-PRED-22).
5. No test for `overallConfidence` on the PredictionMeta (should be the lowest non-actual confidence). The meta test at line 690 gets strong confidence and doesn't verify the "lowest wins" logic.
6. No test where all predictions are insufficient and predictionMeta should be null (since predictedAxisCount would be 0).*

**Does the tournament stability cap test actually test capping?**
OBSERVATION: The test "tournamentStability caps at 1.0 + boost and does not grow unbounded" (prediction-engine-tournament.test.ts:64) is misleadingly named. It verifies that findKNearestForAxis multiplies by the given stability value, but doesn't test that stability values are capped. The capping formula lives in Phase 4's prediction service.
*Reasoning: The test constructs candidates with hardcoded tournamentStability values (1.2 and 1.0) and verifies the multiplier effect. It doesn't test that the formula `1.0 + boost * min(comparisonCount / provisionalThreshold, 1.0)` caps at `1.0 + boost`. The test name claims to verify capping, but it only verifies the engine treats the number as a straight multiplier. The actual cap enforcement is in Phase 4 code (prediction-service.ts), which is not in scope for this review. The test comment at line 66-68 acknowledges this: "The stability factor is computed by the prediction service (Phase 4)." The test name should be more accurate.*

**REQ-PRED-1 through REQ-PRED-22 compliance status?**
Detailed requirement compliance map for Phases 1-3 scope.
*Reasoning: 
**SATISFIED (in scope):**
- REQ-PRED-1: Feature vector encoding (pre-existing from profiling, not new in this PR)
- REQ-PRED-2: Families excluded (pre-existing)
- REQ-PRED-3: Games without BGG data cannot be reference games or receive predictions. computePredictedFitness depends on calculateActualScore for BGG resolution; games without BGG data return score 0.
- REQ-PRED-4: Feature vector is pure-function module (pre-existing)
- REQ-PRED-5: Cosine similarity used correctly. prediction-engine.ts:74 calls cosineSimilarity on flat vectors.
- REQ-PRED-6: Only games with ratings contribute as reference games. findKNearestForAxis filters on candidate.ratings[axisId] at line 71.
- REQ-PRED-7: k-NN per axis, similarity-weighted average, correct behavior when fewer than k. Tested at lines 72-159.
- REQ-PRED-8: BGG-derived axes produce "actual" confidence. computePredictedFitness:199 sets predictionConfidence: "actual" for actual entries. Tested at line 462.
- REQ-PRED-9: Predicted fitness uses same weighted average formula. Tested at line 501 with hand-calculated example.
- REQ-PRED-10: Vetoes on predicted personal values don't fire. The predicted branch (line 210-283) never checks veto. Only the actualResult's veto status is forwarded (line 306). Tested at line 634.
- REQ-PRED-11: Confidence levels assigned correctly. Strong/moderate/weak/insufficient boundaries match spec. Boundary tests at lines 210-311.
- REQ-PRED-12: Reference games included per predicted axis. Lines 226-228 build refGames array. Tested at line 458.
- REQ-PRED-13: PredictionMeta populated correctly (with caveat on coverage). Tested at line 690.
- REQ-PRED-15: Tournament stability weighting in similarity. findKNearestForAxis multiplies by tournamentStability at line 75. The formula itself is Phase 4 scope.
- REQ-PRED-16: Revealed preference tension detection. detectRevealedPreferenceTension correctly computes average normalizedScore of k nearest, checks > 1.0 difference. Tested comprehensively in tournament test file.
- REQ-PRED-17: Tension is informational only. detectRevealedPreferenceTension returns data but doesn't modify any scores. Correct by construction.
- REQ-PRED-18: Tournament features silently inactive without data. detectRevealedPreferenceTension returns null for empty tournamentRankedGames. findKNearestForAxis treats tournamentStability=1.0 as neutral. Tested.
- REQ-PRED-19: Readiness stages gated correctly. assessReadiness uses configurable thresholds. computePredictedFitness checks readinessStage > 0 at line 210. Tested at lines 665-688 (stage 0) and 773-888.
- REQ-PRED-21: Stage thresholds configurable. PredictionSettings.stageThresholds used throughout. Tested at line 863.
- REQ-PRED-22: Stage 0 returns BGG-derived actual scores only. At stage 0, personal axes get no prediction (line 210 condition). BGG axes flow through calculateActualScore. Tested at line 665.
- REQ-PRED-33: FitnessBreakdownSource gains "predicted". types.ts:92.
- REQ-PRED-34: FitnessBreakdownEntry gains predictionConfidence and referenceGames. types.ts:106-107.

**DEFECT:**
- REQ-PRED-35: ratedAxisCount should be actual-only. Implementation includes predicted count. prediction-engine.ts:332,357,366.

**PARTIAL:**
- REQ-PRED-20: Readiness response has weak axes and suggested actions, but misses mechanic/category cluster identification. Function signature lacks game data needed for cluster analysis.

**NOT IN SCOPE (Phase 4+):**
- REQ-PRED-14, 23-32, 36-37
*
