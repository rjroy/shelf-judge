---
title: "Prediction Engine for Unrated Games"
date: 2026-04-10
status: implemented 
tags: [spec, prediction, fitness, similarity, k-nn, confidence]
modules: [daemon, shared, web, cli]
related:
  - .lore/brainstorms/prediction-engine.md
  - .lore/brainstorms/collection-profiling.md
  - .lore/specs/mvp.md
  - .lore/specs/utility-curves.md
  - .lore/specs/tournament-ranking.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/issues/deferred-prediction-engine.md
  - .lore/issues/deferred-collection-profiling.md
  - .lore/issues/deferred-redundancy-scoring.md
  - .lore/vision.md
req-prefix: PRED
---

# Spec: Prediction Engine for Unrated Games

## Overview

The fitness model scores games the user has rated. The prediction engine estimates what unrated games would score if the user rated them, using their existing ratings as training data and BGG attributes as the feature space.

The core approach is k-nearest-neighbor estimation: for each personal axis, find the most similar rated games (measured by BGG mechanic, category, weight, and player count overlap) and use their ratings to predict what the unrated game would score. Tournament ELO data provides a second signal, surfacing tension between what the user says they value (axis predictions) and what they actually choose (tournament patterns). A confidence architecture makes every prediction honest about how much data backs it.

This satisfies the MVP exit point `[STUB: prediction-engine]` ("user wants scores for unowned games") and connects to the vision's Principle 2 (transparent derivation), Principle 4 (data serves judgment), and the tension table's rule that prediction honesty always beats coverage.

## Entry Points

- User views a game detail page for a game with missing personal axis ratings (owned or searched via BGG)
- User requests predicted fitness for a game via CLI (`shelf-judge predict <game-id>`)
- Collection list displays predicted scores alongside actual scores for partially-rated games

## Requirements

### Feature Vector Encoding

- REQ-PRED-1: Each game with BGG data is representable as a feature vector composed of: mechanics (binary flags per mechanic present in the collection vocabulary), categories (binary flags per category), BGG weight (normalized to 0-1 using the 1-5 native scale), community rating (normalized to 0-1 using the 1-10 native scale), min players, max players, and playing time (each normalized over observed collection ranges via `computeContinuousRanges`). Personal axis ratings are included as a separate nullable component (normalized 0-1 over the 1-10 rating scale), null when the game has no ratings. The vector vocabulary (which mechanics/categories have columns) is derived from the union of all mechanic and category names present across all games in the collection. **Implementation**: `packages/daemon/src/services/feature-vector.ts` exports the `FeatureVector` interface (`{ binary, continuous, personalAxes }`) and the `encodeGame`, `buildVocabulary`, and `computeContinuousRanges` functions.

- REQ-PRED-2: Families are excluded from the initial feature vector. They are noisier than mechanics and categories (publisher families, series groupings) and can be added later if prediction quality is insufficient with the core features.

- REQ-PRED-3: Games without BGG data (manually added, no `bggData`) cannot be used as reference games for prediction and cannot receive predictions. The system reports "no BGG data available for prediction" for these games.

- REQ-PRED-4: The feature vector encoding module is a pure-function module (no side effects, no service dependencies), following the pattern of `curve-engine.ts` and `elo-engine.ts`. It exposes the encoded vectors and the vocabulary mapping for use by both prediction and collection profiling. **Implemented**: `packages/daemon/src/services/feature-vector.ts` already exists (built during collection profiling). It exports: `buildVocabulary`, `encodeGame`, `computeContinuousRanges`, `cosineSimilarity`, `jaccardDistance`, `normalizedManhattanDistance`, `compositeDistance`, `computeCentroid`, and associated types (`FeatureVector`, `Vocabulary`, `ContinuousRanges`, `ComponentWeights`). Prediction consumes `buildVocabulary`, `encodeGame`, `computeContinuousRanges`, and `cosineSimilarity`. The other exports serve collection profiling's outlier detection.

### Similarity Computation

- REQ-PRED-5: Similarity between two games for prediction purposes is computed as cosine similarity between their full feature vectors (concatenation of binary, continuous, and personalAxes components). The result is a value between 0 (no overlap) and 1 (identical features). **Note**: `cosineSimilarity` is already exported from `feature-vector.ts`. The prediction engine should concatenate the `FeatureVector` components into a flat array before calling `cosineSimilarity`, since the function operates on flat `number[]` arrays. Collection profiling uses `compositeDistance` (weighted Jaccard + Manhattan) on the structured `FeatureVector` for a different purpose (outlier detection).

- REQ-PRED-6: Only games that have at least one personal axis rating contribute as reference games. A game in the collection with BGG data but no personal ratings is not a useful training example.

### k-NN Estimation

- REQ-PRED-7: For each personal axis on an unrated game, the system finds the k most similar reference games that have a rating on that axis (not the k most similar overall, filtered afterward). Default k = 5. The predicted rating is the similarity-weighted average of those games' ratings. If fewer than k reference games have a rating on the axis, all available games contribute. If zero reference games have a rating, the axis is "insufficient."

- REQ-PRED-8: All BGG-derived axes produce "actual" confidence regardless of whether a utility curve is configured. The raw BGG value is resolved and the curve (or default linear map) produces a deterministic effective rating. This is not a prediction; the mapping from BGG data to effective rating is fully defined by the user's curve configuration or the default normalization.

- REQ-PRED-9: A predicted fitness score uses the same weighted average formula as actual fitness: `sum(effective_rating * weight) / sum(weights)`. The formula runs over all axes that have either an actual rating (personal or BGG-derived) or a predicted rating. Axes with "insufficient" confidence are excluded from both numerator and denominator, same as unrated axes in the current model.

- REQ-PRED-10: Veto thresholds apply to predicted scores the same way they apply to actual scores. If a BGG-derived axis has a veto and the game's BGG value triggers it, the predicted fitness is 0 with the same veto breakdown as actual fitness. If a personal axis is predicted and the predicted value would trigger a veto, the veto does NOT fire. Vetoes on predicted personal ratings would create false confidence in an estimate. Only actual ratings and deterministic BGG-derived values can trigger vetoes.

### Confidence Architecture

- REQ-PRED-11: Each axis in a predicted fitness breakdown carries a confidence level. When criteria point to different levels, the lowest (least confident) level wins.
  - **actual**: The rating comes from the user (personal rating) or from deterministic BGG data + curve. Not a prediction.
  - **strong**: All three conditions met: 5+ reference games contributed, rating variance among them is < 1.5, and average similarity of contributing neighbors is > 0.7.
  - **moderate**: Does not qualify as strong, but has 3+ reference games, variance <= 3.0, and average similarity >= 0.4.
  - **weak**: Does not qualify as moderate. Has at least 1 reference game within the minimum similarity threshold.
  - **insufficient**: No reference games have a rating on this axis, or no neighbor within the minimum similarity threshold (0.2). The axis is excluded from the predicted score.

  Games with BGG data but no mechanics or categories produce feature vectors composed only of continuous dimensions (weight, rating, player counts). Similarity against mechanic-heavy games will be low, likely producing "insufficient" or "weak" confidence. This is expected behavior, not a gap.

- REQ-PRED-12: Each predicted axis entry in the breakdown includes the reference games that contributed: game ID, game name, and similarity score. This is the explanation layer. The user can see "predicted 7.2 based on Azul (0.87, rated 8), Patchwork (0.81, rated 7), Kingdomino (0.79, rated 6)."

- REQ-PRED-13: The overall predicted fitness result includes prediction metadata:
  - Overall confidence (the lowest confidence level among all contributing predicted axes, or "actual" if no axes are predicted)
  - Count of predicted axes vs. actual axes
  - Count of reference games that informed any prediction
  - Coverage percent: what fraction of total axis weight is covered by actual or strong-confidence data

- REQ-PRED-14: The UI always visually distinguishes predicted scores from actual scores. A predicted score is never presented identically to an actual score. The specific visual treatment is an implementation decision, but the distinction must be unambiguous.

### Tournament ELO as Prediction Prior

- REQ-PRED-15: When computing k-NN similarity, reference games with stable tournament data (comparison count >= the configured `provisionalThreshold`, default 6) have their similarity scores weighted by a tournament stability factor. The factor is > 1.0 for stable games and 1.0 for provisional or unranked games. The exact multiplier is an implementation decision, but a reference game with stable tournament data must have a measurably higher effective similarity than the same game would with provisional or no tournament data.

- REQ-PRED-16: After computing the predicted overall fitness score, the system checks whether the user has tournament-ranked games similar to the target. It computes the average `normalizedScore` (from `TournamentGameStatsDisplay`, already on the 1-10 scale) of the k nearest tournament-ranked neighbors. If this average differs from the predicted overall fitness score by more than 1.0 point, the system surfaces a "revealed preference tension" indicator showing: the predicted fitness score, the tournament-cluster average, and a plain-language note ("Your axis ratings predict 8.2 for games like this. In tournament matchups, similar games average 6.5."). Only neighbors with a non-null `normalizedScore` (5+ games ranked, game has comparisons) contribute.

- REQ-PRED-17: The revealed preference tension is informational only. It does not modify the predicted score. Both numbers are visible; the user interprets the gap. The tournament signal is always secondary to the axis prediction.

- REQ-PRED-18: Tournament prior features are only active when the user has tournament data. If no tournament sessions exist or no games have been compared, all tournament-related prediction features are silently inactive (no error, no empty UI elements).

### Cold Start and Prediction Readiness

- REQ-PRED-19: The system reports prediction readiness as one of four stages based on the number of games with at least one personal axis rating:
  - **Stage 0** (< 5 rated games): No personal-axis predictions. BGG-derived axes with curves still produce actual scores.
  - **Stage 1** (5-14 rated games): Experimental predictions. Clients derive the "experimental" label from the readiness stage at render time; it is not a separate field on breakdown entries. All predicted scores at this stage are displayed with an experimental marker.
  - **Stage 2** (15-29 rated games): Usable predictions. Experimental marker drops for strong-confidence predictions.
  - **Stage 3** (30+ rated games): Reliable predictions. Strong-confidence predictions are expected to be common.

- REQ-PRED-20: The readiness response includes: current stage, rated game count, games needed for the next stage, axes with the fewest rated games (weak axes), and suggested actions. Suggested actions identify axes with the fewest contributing reference games and name the mechanic/category clusters that are underrepresented (e.g., "Rate a deck-building game to improve predictions for that mechanic cluster").

- REQ-PRED-21: The stage thresholds (5, 15, 30) are configurable in the daemon, not hardcoded as magic numbers. They can be adjusted as prediction quality is observed in practice.

- REQ-PRED-22: At Stage 0, the prediction API still returns results for BGG-derived axes (actual confidence from curves). It does not return predicted personal axis ratings. The response clearly indicates that personal-axis prediction is not yet available and how many more rated games are needed.

### API

- REQ-PRED-23: A new daemon endpoint accepts a game ID and returns the predicted fitness result for that game. The response uses the same `FitnessResult` structure as actual fitness, extended with `PredictionMeta` and per-axis `PredictionConfidence`. If the game already has full actual ratings on all axes, the response returns the actual fitness score with all confidence levels set to "actual."

- REQ-PRED-24: The collection list endpoint gains an optional parameter to include predicted scores alongside actual scores. When enabled, games with missing ratings receive predicted scores. The response distinguishes predicted from actual at both the game level and the per-axis level.

- REQ-PRED-25: A prediction readiness endpoint returns the current `PredictionReadiness` object (stage, rated count, weak axes, suggested actions). This is a lightweight query, not a full prediction computation.

### Web UI

- REQ-PRED-26: The game detail view shows predicted axis ratings inline with actual ratings, visually distinguished. Clicking a predicted rating shows the reference games and confidence level.

- REQ-PRED-27: The collection list can be sorted by predicted fitness. Games with predicted scores sort among games with actual scores. The sort treats a predicted 7.5 the same as an actual 7.5 for ordering purposes, but the visual distinction (REQ-PRED-14) prevents confusion about which is which.

- REQ-PRED-28: When revealed preference tension exists (REQ-PRED-16), the game detail view shows both the predicted fitness score and the tournament-cluster context. The display makes clear that the tournament signal is contextual, not a correction.

- REQ-PRED-29: The prediction readiness stage is visible somewhere in the UI (location is an implementation decision). At Stages 0 and 1, the display includes the suggested actions from REQ-PRED-20 to guide the user toward better predictions.

### CLI

- REQ-PRED-30: `shelf-judge predict <game-id>` displays the predicted fitness breakdown for a game. The output distinguishes predicted from actual axis ratings, shows confidence levels, and lists reference games for each predicted axis. Supports `--json` for structured output.

- REQ-PRED-31: `shelf-judge predict readiness` displays the current prediction readiness stage, rated game count, weak axes, and suggested actions. Supports `--json`.

- REQ-PRED-32: `shelf-judge scores` gains a `--include-predicted` flag that includes predicted scores in the ranked list output, with a visual marker distinguishing predicted from actual.

### Type Extensions

- REQ-PRED-33: `FitnessBreakdownSource` gains a `"predicted"` value. Predicted axis entries use `source: "predicted"` in the breakdown.

- REQ-PRED-34: `FitnessBreakdownEntry` gains two nullable fields: `predictionConfidence` (`PredictionConfidence | null`) and `referenceGames` (`Array<{ gameId: string; gameName: string; similarity: number }> | null`). Both are null for non-predicted entries. Existing code that reads `FitnessBreakdownEntry` is unaffected because the fields are nullable and additive.

- REQ-PRED-35: `FitnessResult` gains an optional `predictionMeta` field (`PredictionMeta | null`). Null for fully-actual results. The existing `ratedAxisCount` field counts axes with actual ratings only (personal or BGG-derived). In predicted results, `ratedAxisCount` may be 0 even when a valid predicted score exists. Clients that currently treat `ratedAxisCount == 0` as "unscored" must check `predictionMeta` before making that determination. The `predictionMeta.actualAxisCount + predictionMeta.predictedAxisCount` gives the full count of contributing axes.

### Data and Storage

- REQ-PRED-36: Prediction does not introduce new persistent storage. Feature vectors are computed on demand from existing game and BGG data. Prediction results are not cached. The computation is local math over the existing collection, expected to be fast enough for collections up to several hundred games without caching.

- REQ-PRED-37: If prediction computation becomes a performance concern (measured, not assumed), the feature vector vocabulary and per-game vectors can be cached and invalidated when the collection changes. This is an optimization, not a requirement. Do not build caching infrastructure preemptively.

## Exit Points

| Exit                      | Triggers When                                                         | Target                                                                      |
| ------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Collection profiling      | User wants taste profile inference from the same feature vectors      | **Implemented**: `.lore/specs/collection-profiling.md`, `profile-engine.ts` |
| Redundancy scoring        | Feature vector overlap computation feeds mechanic/category redundancy | [STUB: redundancy-scoring]                                                  |
| Prediction caching        | Computation becomes slow for large collections                        | [STUB: prediction-caching]                                                  |
| Custom k/threshold tuning | User wants to adjust k, similarity thresholds, or stage boundaries    | [STUB: prediction-tuning]                                                   |

## Success Criteria

### Automated Tests (bun test)

- [ ] Feature vector encoding produces correct binary flags for mechanics and categories, correct normalization for weight (1-5 to 0-1) and community rating (1-10 to 0-1)
- [ ] Cosine similarity returns 1.0 for identical vectors, 0.0 for orthogonal vectors, and correct values for partial overlap
- [ ] k-NN estimation with k=5 returns the similarity-weighted average of the 5 most similar games' ratings on a given axis
- [ ] k-NN estimation correctly excludes reference games that lack a rating on the target axis
- [ ] BGG-derived axes with curves produce "actual" confidence, not "predicted"
- [ ] Confidence levels are assigned correctly: strong (5+ refs, low variance, high similarity), moderate, weak, insufficient
- [ ] Insufficient-confidence axes are excluded from the predicted score (not counted in numerator or denominator)
- [ ] Vetoes fire on BGG-derived axis values but not on predicted personal axis values
- [ ] A reference game with stable tournament data has a higher effective similarity score than the same game would with provisional or no tournament data
- [ ] Revealed preference tension is surfaced when predicted overall fitness and tournament cluster `normalizedScore` average differ by > 1.0, and not surfaced when they differ by <= 1.0
- [ ] Prediction readiness stages gate output correctly: Stage 0 returns only BGG-derived actual scores, Stages 1-2 mark experimental, Stage 3 is unrestricted
- [ ] When stage thresholds are changed from defaults, the readiness stage reported matches the new thresholds
- [ ] `PredictionMeta` correctly reports predicted vs. actual axis counts, reference game count, and coverage percent
- [ ] Predicted fitness uses the same weighted average formula as actual fitness (verified against hand-calculated examples)
- [ ] Games without BGG data return "no BGG data available for prediction" rather than an empty or zero result

### Manual Verification (demonstration)

- [ ] Add a game via BGG search that has not been rated on any personal axis. View its detail page and see predicted scores with confidence indicators and reference games listed.
- [ ] Rate a game that previously had strong-confidence predictions on most axes. Compare the predicted score to the actual score. If the prediction is off by more than 3 points on most axes, flag as a calibration concern.
- [ ] View the collection list with predicted scores enabled. Predicted and actual scores are visually distinct.
- [ ] With tournament data: view a predicted game where the tournament cluster average diverges from the axis prediction. Both numbers are visible.
- [ ] CLI: run `shelf-judge predict <id>` and verify the breakdown shows reference games, confidence levels, and the same score as the web UI.
- [ ] CLI: run `shelf-judge predict readiness` and verify the stage, weak axes, and suggested actions are correct.

## AI Validation

**Defaults** (apply unless overridden):

- Unit tests with mocked time/network/filesystem
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom:**

- Feature vector math validated against hand-calculated examples (known mechanic overlap, known similarity score)
- k-NN estimation verified with a controlled test collection (5 rated games with known ratings and BGG attributes, predict a 6th, verify the weighted average matches)
- Confidence level boundaries tested at exact thresholds (4 vs 5 reference games, variance at 1.5, similarity at 0.7)
- Tournament stability weighting tested with and without tournament data present
- Revealed preference tension tested with known divergence (> 1.0) and non-divergence (<= 1.0) cases
- Type extensions verified as backward-compatible: existing `FitnessResult` consumers (web game detail, CLI scores, collection list) render correctly when prediction fields are null

## Constraints

- The fitness formula (`sum(effective_rating * weight) / sum(weights)`) does not change. Prediction produces per-axis ratings that feed into the same aggregation. No new aggregation math.
- Prediction is read-only. It does not modify any stored data: no game ratings, no tournament data, no axis configurations.
- The feature vector module is designed for reuse. Collection profiling and redundancy scoring will consume the same vectors and similarity computations. The module's API should not be prediction-specific.
- No external services beyond what the system already uses. Prediction is local math over cached BGG data and stored ratings.
- The prediction engine does not predict tournament ELO scores. Tournament data is an input to prediction weighting, not a prediction target.
- Single-user constraint holds. No collaborative filtering across users. The prediction uses one user's ratings to predict one user's scores.

## Open Questions

1. **k value tuning.** Starting at k=5. This may need adjustment based on how collection size and mechanic diversity affect prediction quality. The value should be easy to change (constant, not deeply embedded). Whether to expose it as a user setting is deferred to [STUB: prediction-tuning].

2. **Minimum similarity threshold.** REQ-PRED-11 defines "insufficient" as including neighbors below 0.2 similarity. The right threshold depends on how the feature vectors behave in practice. If most games in a diverse collection have similarity > 0.3, then 0.2 is fine. If similarity scores cluster near 0.5, the threshold may need raising. Calibrate against the actual collection during implementation.

3. **Feature vector performance.** REQ-PRED-36 says no caching preemptively. For a 100-game collection with ~50 unique mechanics and ~20 categories, the vector is ~75 dimensions per game and similarity computation is ~100 dot products per prediction. This should be sub-millisecond. If collection size grows significantly, revisit per [STUB: prediction-caching].

## Context

**Origin:** Deferred from MVP spec as `[STUB: prediction-engine]`. The brainstorm (`.lore/brainstorms/prediction-engine.md`, revised 2026-04-10) evaluated six proposals and concluded with four accepted approaches: k-NN estimation (core), tournament ELO prior (extension), confidence architecture (extension), and cold start progressive unlock (completeness). Two proposals were rejected: curve-first prediction (subsumed by k-NN, since curves produce "actual" scores for BGG-derived axes automatically) and BGG "fans also like" discovery (API not accessible, single-user data too sparse for collaborative filtering).

**Shared infrastructure:** Collection profiling is now implemented. The feature vector module (`packages/daemon/src/services/feature-vector.ts`) was built during profiling and already exposes: vocabulary building, per-game encoding into `FeatureVector` structs, centroid computation, cosine similarity, Jaccard distance, and normalized Manhattan distance. The profiling engine (`packages/daemon/src/services/profile-engine.ts`) consumes this module for outlier detection via composite distance. The prediction engine consumes the same module differently: cosine similarity on full (flattened) vectors for k-NN neighbor finding, rather than weighted component distances for outlier detection. Shared types (`ComponentDistances`, `CollectionProfile`, `CollectionOutlier`, etc.) are already in `packages/shared/src/types.ts`. The redundancy scoring issue (`.lore/issues/deferred-redundancy-scoring.md`) needs the same mechanic/category overlap computation.

**Key design documents:**

- `.lore/brainstorms/prediction-engine.md` (source brainstorm, concluded)
- `.lore/brainstorms/collection-profiling.md` (shares feature vector infrastructure)
- `.lore/specs/collection-profiling.md` (implemented, shares feature-vector.ts)
- `.lore/designs/mvp-fitness-model.md` (current FitnessResult types being extended)
- `.lore/specs/utility-curves.md` (curves make BGG-derived prediction exact)
- `.lore/specs/tournament-ranking.md` (tournament data as prediction input)

**Implementation artifacts (post-profiling):**

- `packages/daemon/src/services/feature-vector.ts` (shared feature vector module, already exists)
- `packages/daemon/src/services/profile-engine.ts` (profiling consumer, reference for how to use feature-vector.ts)
- `packages/shared/src/types.ts` (profile types already added: `ComponentDistances`, `CollectionProfile`, `CollectionOutlier`, `AxisDistribution`, etc.)
- `packages/web/components/sidebar.tsx` (sidebar navigation structure with "Profile" at `/`)
