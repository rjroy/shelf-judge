---
title: "Commission: Final Validation: Prediction Engine"
date: 2026-04-11
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Final validation pass for the prediction engine. This is Phase 7 from `.lore/plans/prediction-engine.md`.\n\nWalk all 37 REQ-PRED requirements from `.lore/specs/prediction-engine.md` against the final implementation. The plan's Phase 7 has a 15-item automated test checklist and a 6-item manual verification checklist. Check each one.\n\nKey areas:\n- REQ-PRED-1 through 5: Feature vectors and similarity (already existed from profiling, verify prediction consumes correctly)\n- REQ-PRED-6 through 13: k-NN estimation, confidence, metadata\n- REQ-PRED-14: Visual distinction predicted vs. actual\n- REQ-PRED-15 through 18: Tournament prior and tension\n- REQ-PRED-19 through 22: Readiness stages\n- REQ-PRED-23 through 25: API endpoints\n- REQ-PRED-26 through 29: Web UI\n- REQ-PRED-30 through 32: CLI\n- REQ-PRED-33 through 37: Type extensions, no storage, caching deferred\n\nAlso verify:\n- Mockup fidelity (teal color language, tilde prefix, confidence panels, tension display, readiness page)\n- Backward compatibility (existing FitnessResult consumers unaffected)\n- Client/daemon sync (web and CLI both updated)\n\nFlag any unmet requirement."
dependencies:
  - commission-Dalton-20260410-171838
linked_artifacts:
  - .lore/specs/prediction-engine.md

  - .lore/plans/prediction-engine.md
  - .lore/commissions/commission-Dalton-20260410-171838.md
  - .lore/plans/prediction-engine.md
  - .lore/commissions/commission-Dalton-20260410-171838.md
activity_timeline:
  - timestamp: 2026-04-11T00:18:50.578Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T00:20:46.078Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-11T04:40:55.344Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-11T04:40:55.347Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-11T04:40:55.371Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-11T04:41:01.866Z
    event: progress_report
    reason: "Starting Phase 7 validation. Reading spec, plan, and implementation commission artifact."
  - timestamp: 2026-04-11T04:41:42.445Z
    event: progress_report
    reason: "Previous review found 6 findings, all addressed by Dalton. Now beginning full 37-requirement validation pass against current code. Starting with core engine files."
  - timestamp: 2026-04-11T04:43:22.384Z
    event: progress_report
    reason: "Sub-agents completed. Core engine, web UI, CLI, and tests all examined. Now spot-checking specific areas for accuracy before compiling the requirement-by-requirement walkthrough."
  - timestamp: 2026-04-11T04:44:38.453Z
    event: progress_report
    reason: "All implementation files verified. Previous 6 findings all confirmed fixed. Now running the Phase 7 automated test checklist and manual verification checklist against the code. Building requirement-by-requirement assessment."
  - timestamp: 2026-04-11T04:48:50.999Z
    event: progress_report
    reason: "Validation complete. Found 2 new findings and 1 cosmetic observation. All 37 requirements walked. Compiling final submission now."
  - timestamp: 2026-04-11T04:50:15.130Z
    event: result_submitted
    reason: "# Prediction Engine Final Validation (Phase 7)\n\n## Requirement Coverage: 37/37 addressed, 34 satisfied, 1 unmet, 2 partial\n\nPrevious review's 6 findings: all confirmed fixed by Dalton's commission (commission-Dalton-20260410-171838). Tension renders in web UI. Stage 0 response includes predictionUnavailable. Route tests cover success path. CLI imports from shared. Dead code removed. Redundant Math.min simplified.\n\n---\n\n## New Findings (Priority Order)\n\n### F1: Experimental marker absent from predicted scores (REQ-PRED-19 unmet)\n\nREQ-PRED-19 states: \"Stage 1: Experimental predictions. Clients derive the 'experimental' label from the readiness stage at render time. All predicted scores at this stage are displayed with an experimental marker.\" It further says Stage 2 drops the experimental marker for strong-confidence predictions.\n\nGrep for \"experimental\" across `packages/web/` and `packages/cli/` returns zero matches. No client derives an experimental label from the readiness stage. The `readinessStage` field is available in `PredictionMeta`, so the data is present. The rendering logic was never implemented.\n\nThe PREDICTED badge and per-axis confidence badges exist and are correct, but they serve a different purpose (predicted vs actual distinction and confidence granularity). The experimental marker is a stage-level overlay that warns users the entire prediction system has limited training data. Without it, Stage 1 predictions with \"strong\" confidence badges look identical to Stage 3 predictions with \"strong\" badges.\n\n**Impact**: Users at Stage 1 (5-14 rated games) see predicted scores with confidence levels but no warning that the prediction system itself is in an early, low-data state. The readiness page and sidebar widget show stage info, but the per-score marker the spec requires is missing.\n\n**Fix**: In the game detail page and collection table, check `displayScore.predictionMeta?.readinessStage`. At Stage 1, append an \"Experimental\" tag to predicted scores. At Stage 2, append it only when `predictionConfidence !== \"strong\"`.\n\n---\n\n### F2: predictionUnavailable field never consumed by clients (REQ-PRED-22 partial)\n\nREQ-PRED-22 says the predict-game response should \"clearly indicate that personal-axis prediction is not yet available and how many more rated games are needed.\"\n\nDalton's fix added the `PredictionUnavailable` interface to shared types and populated it in `prediction-service.ts:201-210`. The route test verifies it's present. But grep for \"predictionUnavailable\" or \"PredictionUnavailable\" across `packages/web/` and `packages/cli/` returns zero matches.\n\nThe web game detail page (`games/[id]/page.tsx:58`) checks `predicted.score?.predictionMeta` and ignores the `predictionUnavailable` field. At Stage 0, `predictionMeta` is null, so the entire prediction UI is skipped. The user sees no prediction-related content and no explanation of why.\n\nThe sidebar readiness widget partially compensates with global stage information, but the per-game predict response's context (\"rate N more games to unlock predictions for this game\") is orphaned in the response JSON.\n\n**Impact**: Low for most users because the sidebar provides global context. Higher for the CLI path where `shelf-judge predict <id>` at Stage 0 could return a score from BGG-derived axes with no indication that personal-axis predictions are gated.\n\n**Fix**: In the game detail page, when `predicted.predictionUnavailable` is present, show a banner with the reason and games needed. In the CLI predict command, check the same field and print the guidance.\n\n---\n\n### F3: Stage 1 label is \"Basic\" instead of \"Experimental\" (cosmetic, connected to F1)\n\nBoth clients label Stage 1 as \"Basic\" in their readiness displays:\n- `packages/web/app/readiness/page.tsx:11`: `STAGE_LABELS[1] = \"Basic\"`\n- `packages/cli/src/commands/predict.ts:105`: same label\n\nThe spec says \"Stage 1: Experimental predictions.\" The mockup at `.lore/mockups/prediction-engine.html:2613` says \"Experimental predictions. All marked as such.\" The word \"Experimental\" carries specific meaning: it warns users the predictions are low-confidence due to limited training data.\n\n**Impact**: Cosmetic. Connected to F1 because the experimental marker and the stage label together form the spec's \"experimental\" treatment.\n\n**Fix**: Change STAGE_LABELS[1] to \"Experimental\" in both files.\n\n---\n\n## Phase 7 Automated Test Checklist\n\n| # | Check | Status | Evidence |\n|---|-------|--------|----------|\n| 1 | Feature vector encoding: correct binary flags, normalization | PASS | 47 tests in prediction-engine.test.ts, feature-vector.ts tests |\n| 2 | Cosine similarity: 1.0 identical, 0.0 orthogonal | PASS | cosineSimilarity tested in feature-vector.test.ts |\n| 3 | k-NN estimation: similarity-weighted average of k=5 | PASS | findKNearestForAxis (6 tests), predictAxisRating (14 tests) |\n| 4 | k-NN excludes games lacking target axis rating | PASS | prediction-engine.ts:72 `if (rating === undefined) continue` |\n| 5 | BGG-derived axes: \"actual\" confidence | PASS | prediction-engine.ts:201 `predictionConfidence: \"actual\"` |\n| 6 | Confidence thresholds: strong/moderate/weak/insufficient | PASS | Boundary tests at 4 vs 5 refs, variance at 1.49/1.5, similarity at 0.69/0.71 |\n| 7 | Insufficient axes excluded from score | PASS | prediction-engine.ts:267 pushes entry with null rating, contribution |\n| 8 | Vetoes on BGG-derived, not on predicted personal | PASS | prediction-engine.ts:305-308 only from actualResult |\n| 9 | Tournament stability: higher effective similarity | PASS | 4 tournament tests, stability as multiplier |\n| 10 | Tension: surfaced at >1.0, not at <=1.0 | PASS | prediction-engine.ts:574, 7 tension tests |\n| 11 | Readiness stages gate output | PASS | Stage 0 blocks personal predictions (line 210) |\n| 12 | Custom thresholds respected | PASS | Test confirms custom thresholds change stage computation |\n| 13 | PredictionMeta: counts and coverage | PASS | prediction-engine.ts:343-353, tested |\n| 14 | Weighted average formula matches actual | PASS | Both use `sum(rating*weight)/sum(weights)` |\n| 15 | No BGG data: clear error | PASS | prediction-service.ts:171 throws descriptive error |\n\n## Phase 7 Manual Verification Checklist (code-level assessment)\n\n| # | Check | Status | Evidence |\n|---|-------|--------|----------|\n| 1 | Unrated game detail shows predicted scores | PASS | page.tsx fetches prediction, displays with badges/breakdown |\n| 2 | Predicted vs actual score comparison | PASS | Fully rated games return actual (prediction-engine.ts:169) |\n| 3 | Collection list: visual distinction | PASS | teal color, tilde prefix, predicted-row class, confidence column |\n| 4 | Tournament tension display | PASS | Tension panel in page.tsx:392-430 (F1 from previous review fixed) |\n| 5 | CLI predict matches web breakdown | PASS | Both consume same PredictedGameResponse from daemon |\n| 6 | CLI predict readiness | PASS | Registered in index.ts, shows stage/weak axes/actions |\n\n## Full Requirement Walkthrough\n\n| Req | Status | Notes |\n|-----|--------|-------|\n| REQ-PRED-1 | PASS | Feature vector: binary mechanics/categories, continuous weight/rating/players/time, nullable personal axes |\n| REQ-PRED-2 | PASS | Families excluded from buildVocabulary (only mechanics and categories) |\n| REQ-PRED-3 | PASS | prediction-service.ts:171 throws \"no BGG data\" error |\n| REQ-PRED-4 | PASS | prediction-engine.ts is pure functions, no I/O, imports only types and cosineSimilarity |\n| REQ-PRED-5 | PASS | cosineSimilarity on flattened vectors (binary + continuous + personalAxes) |\n| REQ-PRED-6 | PASS | prediction-service.ts:102 skips games without ratings or vector |\n| REQ-PRED-7 | PASS | findKNearestForAxis filters by axis first (line 72), then top-k (line 88) |\n| REQ-PRED-8 | PASS | Actual entries get `predictionConfidence: \"actual\"` (line 201) |\n| REQ-PRED-9 | PASS | Same `sum(rating*weight)/sum(weights)` formula |\n| REQ-PRED-10 | PASS | Vetoes only from actualResult (line 305-308), predicted values excluded (line 249 comment) |\n| REQ-PRED-11 | PASS | Confidence thresholds match spec exactly. Lowest wins (line 260-264) |\n| REQ-PRED-12 | PASS | refGames array per predicted axis (line 225-229) |\n| REQ-PRED-13 | PASS | PredictionMeta: readinessStage, confidence, counts, referenceGameCount, coveragePercent |\n| REQ-PRED-14 | PASS | PREDICTED badge, teal color class, tilde prefix, confidence badges |\n| REQ-PRED-15 | PASS | Tournament stability factor: `1.0 + tournamentStabilityBoost` for stable games, 1.0 for provisional |\n| REQ-PRED-16 | PASS | detectRevealedPreferenceTension checks normalizedScore average, surfaces at >1.0 diff |\n| REQ-PRED-17 | PASS | Tension does not modify score, both numbers visible |\n| REQ-PRED-18 | PASS | tournamentStability=1.0 and empty list when no tournament data (line 108-112) |\n| REQ-PRED-19 | FAIL | Experimental marker missing from all predicted scores at Stages 1-2 (F1) |\n| REQ-PRED-20 | PASS | Weak axes, cluster suggestions, action strings in assessReadiness |\n| REQ-PRED-21 | PASS | Thresholds in PredictionSettings, stored in prediction-settings.json |\n| REQ-PRED-22 | PARTIAL | Daemon populates predictionUnavailable, but no client consumes it (F2) |\n| REQ-PRED-23 | PASS | GET /predictions/:gameId returns PredictedGameResponse |\n| REQ-PRED-24 | PASS | GET /games?includePredicted=true delegates to predictionService |\n| REQ-PRED-25 | PASS | GET /predictions/readiness returns PredictionReadiness |\n| REQ-PRED-26 | PASS | Game detail shows predicted scores inline with badges and expandable reference games |\n| REQ-PRED-27 | PASS | Collection table toggles predictions, sorts by fitness (predicted sorts among actual) |\n| REQ-PRED-28 | PASS | Tension panel displays predicted fitness vs tournament cluster average (fixed) |\n| REQ-PRED-29 | PASS | Sidebar readiness widget + dedicated readiness page with actions |\n| REQ-PRED-30 | PASS | CLI predict: breakdown, confidence, reference games, --json |\n| REQ-PRED-31 | PASS | CLI predict readiness: stage, weak axes, suggested actions, --json |\n| REQ-PRED-32 | PASS | CLI scores --include-predicted with [P] marker |\n| REQ-PRED-33 | PASS | \"predicted\" added to FitnessBreakdownSource union |\n| REQ-PRED-34 | PASS | predictionConfidence and referenceGames as nullable fields on FitnessBreakdownEntry |\n| REQ-PRED-35 | PASS | predictionMeta nullable on FitnessResult, ratedAxisCount reflects actual only |\n| REQ-PRED-36 | PASS | No new persistent storage (prediction-settings.json is configuration, not prediction data) |\n| REQ-PRED-37 | PASS | Caching not implemented (deferred per spec) |\n\n## Backward Compatibility\n\nVerified clean:\n- `fitness-service.ts` backfills `predictionMeta: null` on both return paths (lines 182, 194) and `predictionConfidence: null, referenceGames: null` on breakdown entries (lines 137-138)\n- `collection-utils.ts` correctly classifies predicted-only games as \"unrated\" for filter purposes\n- All new fields are nullable/additive. Existing consumers unaffected.\n\n## Test Coverage\n\n70 prediction-specific tests across 3 files:\n- `prediction-engine.test.ts`: 47 tests (core algorithm, confidence boundaries, veto behavior, readiness stages, PredictionMeta)\n- `prediction-engine-tournament.test.ts`: 11 tests (stability weighting, tension detection/non-detection)\n- `prediction.test.ts` (routes): 12 tests (endpoints, error cases, success path, Stage 0 unavailability)\n\n## Architecture Assessment\n\nClean separation maintained: pure math in prediction-engine.ts (587 lines), data wiring in prediction-service.ts, thin HTTP in routes. Factory/DI pattern consistent with daemon conventions. Feature vector module properly shared between prediction and profiling. No circular dependencies introduced.\n\n## Summary\n\n34 of 37 requirements fully satisfied. REQ-PRED-19 unmet (experimental markers). REQ-PRED-22 partially met (data present, clients don't consume). Stage label cosmetic divergence (F3). The core prediction math, confidence architecture, tournament integration, API layer, and backward compatibility are all correct. The gap is in the client-side rendering of stage-specific prediction warnings."
  - timestamp: 2026-04-11T04:50:22.640Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Validation complete. Found 2 new findings and 1 cosmetic observation. All 37 requirements walked. Compiling final submission now."
projectName: shelf-judge
---
# Prediction Engine Final Validation (Phase 7)

## Requirement Coverage: 37/37 addressed, 34 satisfied, 1 unmet, 2 partial

Previous review's 6 findings: all confirmed fixed by Dalton's commission (commission-Dalton-20260410-171838). Tension renders in web UI. Stage 0 response includes predictionUnavailable. Route tests cover success path. CLI imports from shared. Dead code removed. Redundant Math.min simplified.

---

## New Findings (Priority Order)

### F1: Experimental marker absent from predicted scores (REQ-PRED-19 unmet)

REQ-PRED-19 states: "Stage 1: Experimental predictions. Clients derive the 'experimental' label from the readiness stage at render time. All predicted scores at this stage are displayed with an experimental marker." It further says Stage 2 drops the experimental marker for strong-confidence predictions.

Grep for "experimental" across `packages/web/` and `packages/cli/` returns zero matches. No client derives an experimental label from the readiness stage. The `readinessStage` field is available in `PredictionMeta`, so the data is present. The rendering logic was never implemented.

The PREDICTED badge and per-axis confidence badges exist and are correct, but they serve a different purpose (predicted vs actual distinction and confidence granularity). The experimental marker is a stage-level overlay that warns users the entire prediction system has limited training data. Without it, Stage 1 predictions with "strong" confidence badges look identical to Stage 3 predictions with "strong" badges.

**Impact**: Users at Stage 1 (5-14 rated games) see predicted scores with confidence levels but no warning that the prediction system itself is in an early, low-data state. The readiness page and sidebar widget show stage info, but the per-score marker the spec requires is missing.

**Fix**: In the game detail page and collection table, check `displayScore.predictionMeta?.readinessStage`. At Stage 1, append an "Experimental" tag to predicted scores. At Stage 2, append it only when `predictionConfidence !== "strong"`.

---

### F2: predictionUnavailable field never consumed by clients (REQ-PRED-22 partial)

REQ-PRED-22 says the predict-game response should "clearly indicate that personal-axis prediction is not yet available and how many more rated games are needed."

Dalton's fix added the `PredictionUnavailable` interface to shared types and populated it in `prediction-service.ts:201-210`. The route test verifies it's present. But grep for "predictionUnavailable" or "PredictionUnavailable" across `packages/web/` and `packages/cli/` returns zero matches.

The web game detail page (`games/[id]/page.tsx:58`) checks `predicted.score?.predictionMeta` and ignores the `predictionUnavailable` field. At Stage 0, `predictionMeta` is null, so the entire prediction UI is skipped. The user sees no prediction-related content and no explanation of why.

The sidebar readiness widget partially compensates with global stage information, but the per-game predict response's context ("rate N more games to unlock predictions for this game") is orphaned in the response JSON.

**Impact**: Low for most users because the sidebar provides global context. Higher for the CLI path where `shelf-judge predict <id>` at Stage 0 could return a score from BGG-derived axes with no indication that personal-axis predictions are gated.

**Fix**: In the game detail page, when `predicted.predictionUnavailable` is present, show a banner with the reason and games needed. In the CLI predict command, check the same field and print the guidance.

---

### F3: Stage 1 label is "Basic" instead of "Experimental" (cosmetic, connected to F1)

Both clients label Stage 1 as "Basic" in their readiness displays:
- `packages/web/app/readiness/page.tsx:11`: `STAGE_LABELS[1] = "Basic"`
- `packages/cli/src/commands/predict.ts:105`: same label

The spec says "Stage 1: Experimental predictions." The mockup at `.lore/mockups/prediction-engine.html:2613` says "Experimental predictions. All marked as such." The word "Experimental" carries specific meaning: it warns users the predictions are low-confidence due to limited training data.

**Impact**: Cosmetic. Connected to F1 because the experimental marker and the stage label together form the spec's "experimental" treatment.

**Fix**: Change STAGE_LABELS[1] to "Experimental" in both files.

---

## Phase 7 Automated Test Checklist

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | Feature vector encoding: correct binary flags, normalization | PASS | 47 tests in prediction-engine.test.ts, feature-vector.ts tests |
| 2 | Cosine similarity: 1.0 identical, 0.0 orthogonal | PASS | cosineSimilarity tested in feature-vector.test.ts |
| 3 | k-NN estimation: similarity-weighted average of k=5 | PASS | findKNearestForAxis (6 tests), predictAxisRating (14 tests) |
| 4 | k-NN excludes games lacking target axis rating | PASS | prediction-engine.ts:72 `if (rating === undefined) continue` |
| 5 | BGG-derived axes: "actual" confidence | PASS | prediction-engine.ts:201 `predictionConfidence: "actual"` |
| 6 | Confidence thresholds: strong/moderate/weak/insufficient | PASS | Boundary tests at 4 vs 5 refs, variance at 1.49/1.5, similarity at 0.69/0.71 |
| 7 | Insufficient axes excluded from score | PASS | prediction-engine.ts:267 pushes entry with null rating, contribution |
| 8 | Vetoes on BGG-derived, not on predicted personal | PASS | prediction-engine.ts:305-308 only from actualResult |
| 9 | Tournament stability: higher effective similarity | PASS | 4 tournament tests, stability as multiplier |
| 10 | Tension: surfaced at >1.0, not at <=1.0 | PASS | prediction-engine.ts:574, 7 tension tests |
| 11 | Readiness stages gate output | PASS | Stage 0 blocks personal predictions (line 210) |
| 12 | Custom thresholds respected | PASS | Test confirms custom thresholds change stage computation |
| 13 | PredictionMeta: counts and coverage | PASS | prediction-engine.ts:343-353, tested |
| 14 | Weighted average formula matches actual | PASS | Both use `sum(rating*weight)/sum(weights)` |
| 15 | No BGG data: clear error | PASS | prediction-service.ts:171 throws descriptive error |

## Phase 7 Manual Verification Checklist (code-level assessment)

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | Unrated game detail shows predicted scores | PASS | page.tsx fetches prediction, displays with badges/breakdown |
| 2 | Predicted vs actual score comparison | PASS | Fully rated games return actual (prediction-engine.ts:169) |
| 3 | Collection list: visual distinction | PASS | teal color, tilde prefix, predicted-row class, confidence column |
| 4 | Tournament tension display | PASS | Tension panel in page.tsx:392-430 (F1 from previous review fixed) |
| 5 | CLI predict matches web breakdown | PASS | Both consume same PredictedGameResponse from daemon |
| 6 | CLI predict readiness | PASS | Registered in index.ts, shows stage/weak axes/actions |

## Full Requirement Walkthrough

| Req | Status | Notes |
|-----|--------|-------|
| REQ-PRED-1 | PASS | Feature vector: binary mechanics/categories, continuous weight/rating/players/time, nullable personal axes |
| REQ-PRED-2 | PASS | Families excluded from buildVocabulary (only mechanics and categories) |
| REQ-PRED-3 | PASS | prediction-service.ts:171 throws "no BGG data" error |
| REQ-PRED-4 | PASS | prediction-engine.ts is pure functions, no I/O, imports only types and cosineSimilarity |
| REQ-PRED-5 | PASS | cosineSimilarity on flattened vectors (binary + continuous + personalAxes) |
| REQ-PRED-6 | PASS | prediction-service.ts:102 skips games without ratings or vector |
| REQ-PRED-7 | PASS | findKNearestForAxis filters by axis first (line 72), then top-k (line 88) |
| REQ-PRED-8 | PASS | Actual entries get `predictionConfidence: "actual"` (line 201) |
| REQ-PRED-9 | PASS | Same `sum(rating*weight)/sum(weights)` formula |
| REQ-PRED-10 | PASS | Vetoes only from actualResult (line 305-308), predicted values excluded (line 249 comment) |
| REQ-PRED-11 | PASS | Confidence thresholds match spec exactly. Lowest wins (line 260-264) |
| REQ-PRED-12 | PASS | refGames array per predicted axis (line 225-229) |
| REQ-PRED-13 | PASS | PredictionMeta: readinessStage, confidence, counts, referenceGameCount, coveragePercent |
| REQ-PRED-14 | PASS | PREDICTED badge, teal color class, tilde prefix, confidence badges |
| REQ-PRED-15 | PASS | Tournament stability factor: `1.0 + tournamentStabilityBoost` for stable games, 1.0 for provisional |
| REQ-PRED-16 | PASS | detectRevealedPreferenceTension checks normalizedScore average, surfaces at >1.0 diff |
| REQ-PRED-17 | PASS | Tension does not modify score, both numbers visible |
| REQ-PRED-18 | PASS | tournamentStability=1.0 and empty list when no tournament data (line 108-112) |
| REQ-PRED-19 | FAIL | Experimental marker missing from all predicted scores at Stages 1-2 (F1) |
| REQ-PRED-20 | PASS | Weak axes, cluster suggestions, action strings in assessReadiness |
| REQ-PRED-21 | PASS | Thresholds in PredictionSettings, stored in prediction-settings.json |
| REQ-PRED-22 | PARTIAL | Daemon populates predictionUnavailable, but no client consumes it (F2) |
| REQ-PRED-23 | PASS | GET /predictions/:gameId returns PredictedGameResponse |
| REQ-PRED-24 | PASS | GET /games?includePredicted=true delegates to predictionService |
| REQ-PRED-25 | PASS | GET /predictions/readiness returns PredictionReadiness |
| REQ-PRED-26 | PASS | Game detail shows predicted scores inline with badges and expandable reference games |
| REQ-PRED-27 | PASS | Collection table toggles predictions, sorts by fitness (predicted sorts among actual) |
| REQ-PRED-28 | PASS | Tension panel displays predicted fitness vs tournament cluster average (fixed) |
| REQ-PRED-29 | PASS | Sidebar readiness widget + dedicated readiness page with actions |
| REQ-PRED-30 | PASS | CLI predict: breakdown, confidence, reference games, --json |
| REQ-PRED-31 | PASS | CLI predict readiness: stage, weak axes, suggested actions, --json |
| REQ-PRED-32 | PASS | CLI scores --include-predicted with [P] marker |
| REQ-PRED-33 | PASS | "predicted" added to FitnessBreakdownSource union |
| REQ-PRED-34 | PASS | predictionConfidence and referenceGames as nullable fields on FitnessBreakdownEntry |
| REQ-PRED-35 | PASS | predictionMeta nullable on FitnessResult, ratedAxisCount reflects actual only |
| REQ-PRED-36 | PASS | No new persistent storage (prediction-settings.json is configuration, not prediction data) |
| REQ-PRED-37 | PASS | Caching not implemented (deferred per spec) |

## Backward Compatibility

Verified clean:
- `fitness-service.ts` backfills `predictionMeta: null` on both return paths (lines 182, 194) and `predictionConfidence: null, referenceGames: null` on breakdown entries (lines 137-138)
- `collection-utils.ts` correctly classifies predicted-only games as "unrated" for filter purposes
- All new fields are nullable/additive. Existing consumers unaffected.

## Test Coverage

70 prediction-specific tests across 3 files:
- `prediction-engine.test.ts`: 47 tests (core algorithm, confidence boundaries, veto behavior, readiness stages, PredictionMeta)
- `prediction-engine-tournament.test.ts`: 11 tests (stability weighting, tension detection/non-detection)
- `prediction.test.ts` (routes): 12 tests (endpoints, error cases, success path, Stage 0 unavailability)

## Architecture Assessment

Clean separation maintained: pure math in prediction-engine.ts (587 lines), data wiring in prediction-service.ts, thin HTTP in routes. Factory/DI pattern consistent with daemon conventions. Feature vector module properly shared between prediction and profiling. No circular dependencies introduced.

## Summary

34 of 37 requirements fully satisfied. REQ-PRED-19 unmet (experimental markers). REQ-PRED-22 partially met (data present, clients don't consume). Stage label cosmetic divergence (F3). The core prediction math, confidence architecture, tournament integration, API layer, and backward compatibility are all correct. The gap is in the client-side rendering of stage-specific prediction warnings.

## Decisions

**Does the web UI or CLI display the predictionUnavailable field from the predict-game response (REQ-PRED-22)?**
Neither client consumes predictionUnavailable. The field exists in PredictedGameResponse (shared types) and is populated by the daemon at Stage 0, but grep for "predictionUnavailable" across packages/web and packages/cli returns zero matches. The sidebar readiness widget provides global stage context, but no per-game "prediction unavailable, rate N more games" message appears.
*Reasoning: F2 from the previous review correctly identified the gap. Dalton added the field to the daemon response (prediction-service.ts:201-210) and the shared type (PredictionUnavailable interface, PredictedGameResponse includes it). Route tests verify the field is present. But the client side of the fix was never completed. The web game detail page only checks predicted.score?.predictionMeta (line 58) and ignores predictionUnavailable. The CLI predict.ts has no reference to the field either.*

**Do clients display an "experimental" marker for predictions at Stage 1 (and non-strong predictions at Stage 2) per REQ-PRED-19?**
Neither client implements the experimental marker. Grep for "experimental" across packages/web and packages/cli returns zero matches. At Stage 1, all predicted scores should display an "experimental" marker per the spec. At Stage 2, the marker should drop for strong-confidence predictions. This visual treatment is entirely absent.
*Reasoning: REQ-PRED-19 explicitly states: "Clients derive the 'experimental' label from the readiness stage at render time; it is not a separate field on breakdown entries. All predicted scores at this stage are displayed with an experimental marker." The readinessStage is available in PredictionMeta, so the data is present. The rendering logic was never implemented. The PREDICTED badge and confidence badges exist, but the spec-required "experimental" overlay for Stages 1-2 is missing.*

**Do the readiness page and CLI use "Experimental" for Stage 1 as the spec requires?**
Both clients label Stage 1 as "Basic" instead of "Experimental". The spec uses "Experimental predictions" for Stage 1. The label difference reduces the signal the spec intended: "Experimental" warns users predictions are low-confidence; "Basic" suggests a capability tier.
*Reasoning: readiness/page.tsx line 11: STAGE_LABELS[1] = "Basic". predict.ts line 105: STAGE_LABELS[1] = "Basic". The spec at REQ-PRED-19: "Stage 1 (5-14 rated games): Experimental predictions. Clients derive the 'experimental' label from the readiness stage at render time." The intent is that the word "experimental" reaches the user. Cosmetic-level divergence but connected to the larger issue of missing experimental markers on predicted scores themselves.*
