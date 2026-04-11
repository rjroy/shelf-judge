---
title: "Prediction Engine for Unrated Games"
date: 2026-04-11
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
- User previews predicted fitness for a BGG game before adding it, via search page preview panel or CLI (`shelf-judge predict bgg <bgg-id>`)
- Collection list displays predicted scores alongside actual scores for partially-rated games
- Sidebar readiness widget shows prediction stage on every page

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

- REQ-PRED-13: The overall predicted fitness result includes prediction metadata (`PredictionMeta`):
  - `readinessStage`: current prediction readiness stage (0-3)
  - `confidence`: overall confidence (the lowest confidence level among all contributing predicted axes, or "actual" if no axes are predicted)
  - `predictedAxisCount` and `actualAxisCount`
  - `referenceGameCount`: count of distinct reference games that informed any prediction
  - `coveragePercent`: fraction of total axis weight covered by actual or strong-confidence data

- REQ-PRED-14: The UI always visually distinguishes predicted scores from actual scores. A predicted score is never presented identically to an actual score. The specific visual treatment is an implementation decision, but the distinction must be unambiguous.

### Tournament ELO as Prediction Prior

- REQ-PRED-15: When computing k-NN similarity, reference games with stable tournament data (comparison count >= the configured `provisionalThreshold`, default 6) have their similarity scores weighted by a tournament stability factor. Effective similarity = cosine similarity \* tournament stability, where stability is `1.0 + tournamentStabilityBoost` (default 0.2) for stable games and 1.0 for provisional or unranked games. The `tournamentStabilityBoost` is a configurable field in `PredictionSettings`.

- REQ-PRED-16: After computing the predicted overall fitness score, the system checks whether the user has tournament-ranked games similar to the target. It computes the average `normalizedScore` (from `TournamentGameStatsDisplay`, already on the 1-10 scale) of the k nearest tournament-ranked neighbors. If this average differs from the predicted overall fitness score by more than 1.0 point, the system surfaces a "revealed preference tension" indicator showing: the predicted fitness score, the tournament-cluster average, and a plain-language note ("Your axis ratings predict 8.2 for games like this. In tournament matchups, similar games average 6.5."). Only neighbors with a non-null `normalizedScore` (5+ games ranked, game has comparisons) contribute.

- REQ-PRED-17: The revealed preference tension is informational only. It does not modify the predicted score. Both numbers are visible; the user interprets the gap. The tournament signal is always secondary to the axis prediction.

- REQ-PRED-18: Tournament prior features are only active when the user has tournament data. If no tournament sessions exist or no games have been compared, all tournament-related prediction features are silently inactive (no error, no empty UI elements).

### Cold Start and Prediction Readiness

- REQ-PRED-19: The system reports prediction readiness as one of four stages based on the number of games with at least one personal axis rating:
  - **Stage 0** "Not Ready" (< 5 rated games): No personal-axis predictions. BGG-derived axes with curves still produce actual scores.
  - **Stage 1** "Basic" (5-14 rated games): Basic predictions available. Confidence is limited by the small reference pool. All predictions carry confidence badges; no separate "experimental" marker.
  - **Stage 2** "Moderate" (15-29 rated games): Moderate predictions. Most axes have enough reference data for useful estimates.
  - **Stage 3** "Strong" (30+ rated games): Strong prediction confidence. Rich reference pool across rated axes.

  Stage labels ("Not Ready", "Basic", "Moderate", "Strong") are presentation-level. The daemon returns the numeric stage; clients render the labels.

- REQ-PRED-20: The readiness response (`PredictionReadiness`) includes: `stage`, `ratedGameCount`, `nextStageAt` (the threshold for the next stage, not the count of games needed; clients compute the difference), `weakAxes` (personal axes with fewer than k rated games, each with `axisId`, `axisName`, `ratedCount`), and `suggestedActions` (plain-text strings). Suggested actions identify axes with the fewest contributing reference games and name the mechanic/category clusters that are underrepresented (e.g., "Rate a Deck Building game to improve predictions for that cluster (2/7 rated)").

- REQ-PRED-21: All prediction parameters are configurable via `PredictionSettings`, persisted to `prediction-settings.json`. Settings include `stageThresholds` ([5, 15, 30] defaults), `defaultK` (5), `minSimilarityThreshold` (0.2), and `tournamentStabilityBoost` (0.2). A GET/PATCH API at `/predictions/settings` allows reading and updating settings at runtime.

- REQ-PRED-22: At Stage 0, the prediction API still returns results for BGG-derived axes (actual confidence from curves). It does not return predicted personal axis ratings. The response clearly indicates that personal-axis prediction is not yet available and how many more rated games are needed.

### API

- REQ-PRED-23: `GET /predictions/:gameId` returns a `PredictedGameResponse` containing `{ game, score, tension, predictionUnavailable }`. The `score` field is a standard `FitnessResult` with `predictionMeta` and per-axis `predictionConfidence`/`referenceGames` populated. The `tension` field carries revealed preference tension when detected (null otherwise). The `predictionUnavailable` field is non-null at Stage 0, containing `{ reason: "stage-0", ratedGameCount, gamesNeeded }`. If the game has full actual ratings on all axes, the response returns the actual fitness score with `predictionMeta: null`.

- REQ-PRED-23a: `GET /predictions/bgg/:bggId` accepts a BGG game ID and returns the same `PredictedGameResponse` shape. If the game already exists in the collection, it delegates to the standard prediction path. If not, the daemon fetches BGG data, creates a temporary non-persisted `Game` object (ID prefixed with `preview-`), encodes it against the collection's vocabulary and ranges, and runs prediction. This enables search-time preview without adding the game to the collection.

- REQ-PRED-24: The existing `GET /games` endpoint gains an optional `?includePredicted=true` query parameter. When enabled, games with missing ratings receive predicted scores via the prediction service's `listGamesWithPredictions()` method. The response is `GameWithScore[]` with `FitnessResult` including `predictionMeta` where applicable.

- REQ-PRED-25: `GET /predictions/readiness` returns the current `PredictionReadiness` object (stage, rated count, next stage threshold, weak axes, suggested actions). This is a lightweight query, not a full prediction computation.

- REQ-PRED-25a: `GET /predictions/settings` returns the current `PredictionSettings`. `PATCH /predictions/settings` accepts a partial settings object and merges it with current settings. Both endpoints support runtime tuning of k, thresholds, similarity minimum, and tournament boost.

### Web UI

- REQ-PRED-26: The game detail view shows predicted axis ratings inline with actual ratings, visually distinguished. The score breakdown table shows a "Predicted" source badge and per-axis confidence badges. Clicking a confidence badge expands an inline panel showing the reference games, their similarity scores, and an average similarity stat.

- REQ-PRED-27: The collection list can be sorted by predicted fitness. Games with predicted scores sort among games with actual scores. The sort treats a predicted 7.5 the same as an actual 7.5 for ordering purposes, but the visual distinction (REQ-PRED-14) prevents confusion about which is which.

- REQ-PRED-28: When revealed preference tension exists (REQ-PRED-16), the game detail view shows a "Revealed Preference Tension" panel below the score breakdown. The panel displays the axis prediction score, the tournament pattern score, the delta, and the plain-language note. The display makes clear that the tournament signal is contextual, not a correction.

- REQ-PRED-29: The prediction readiness stage is visible in two locations: (1) a compact readiness widget in the sidebar, showing stage number, label, a progress bar, rated count, and games to next stage, visible on every page; and (2) a dedicated `/readiness` page with a stage banner, stage timeline, axis coverage bars, and suggested actions. At all stages, the suggested actions from REQ-PRED-20 guide the user toward better predictions.

- REQ-PRED-29a: The BGG search page (`/search`) shows an inline prediction preview panel when the user clicks a search result. The panel calls `GET /predictions/bgg/:bggId` and displays the predicted fitness score, confidence badge, per-axis breakdown with confidence indicators, and reference games. If the game is already in the collection, the panel links to the game detail page. If prediction is unavailable (Stage 0), the panel shows the BGG-derived score and a message about how many more rated games are needed.

### CLI

- REQ-PRED-30: `shelf-judge predict <game-id>` displays the predicted fitness breakdown for a game. The output distinguishes predicted from actual axis ratings, shows confidence levels, and lists reference games for each predicted axis. Supports `--json` for structured output.

- REQ-PRED-30a: `shelf-judge predict bgg <bgg-id>` displays the predicted fitness for a game by BGG ID, using the same preview mechanism as the search page (REQ-PRED-23a). If the game is already in the collection, it notes this. If prediction is unavailable (Stage 0), it shows the BGG-derived score and the games-needed count. Supports `--json`.

- REQ-PRED-31: `shelf-judge predict readiness` displays the current prediction readiness stage, rated game count, weak axes, and suggested actions. Supports `--json`.

- REQ-PRED-32: `shelf-judge scores` gains a `--include-predicted` flag that includes predicted scores in the ranked list output, with a visual marker distinguishing predicted from actual.

### Type Extensions

- REQ-PRED-33: `FitnessBreakdownSource` gains a `"predicted"` value. Predicted axis entries use `source: "predicted"` in the breakdown.

- REQ-PRED-34: `FitnessBreakdownEntry` gains two nullable fields: `predictionConfidence` (`PredictionConfidence | null`) and `referenceGames` (`Array<{ gameId: string; gameName: string; similarity: number }> | null`). Both are null for non-predicted entries. Existing code that reads `FitnessBreakdownEntry` is unaffected because the fields are nullable and additive.

- REQ-PRED-35: `FitnessResult` gains an optional `predictionMeta` field (`PredictionMeta | null`). Null for fully-actual results. The existing `ratedAxisCount` field counts axes with actual ratings only (personal or BGG-derived). In predicted results, `ratedAxisCount` may be 0 even when a valid predicted score exists. Clients that currently treat `ratedAxisCount == 0` as "unscored" must check `predictionMeta` before making that determination. The `predictionMeta.actualAxisCount + predictionMeta.predictedAxisCount` gives the full count of contributing axes.

### Additional Types

- REQ-PRED-35a: `PredictionSettings` is a new shared type: `{ stageThresholds: [number, number, number], defaultK: number, minSimilarityThreshold: number, tournamentStabilityBoost: number }`. Persisted to `prediction-settings.json` in the daemon data directory. Defaults are [5, 15, 30], 5, 0.2, 0.2 respectively.

- REQ-PRED-35b: `PredictionUnavailable` is a new shared type: `{ reason: "stage-0", ratedGameCount: number, gamesNeeded: number }`. Returned in prediction responses at Stage 0 to communicate why personal-axis predictions are absent.

- REQ-PRED-35c: `PredictedGameResponse` is a new shared type: `{ game: Game, score: FitnessResult, tension: RevealedPreferenceTension | null, predictionUnavailable: PredictionUnavailable | null }`. This is the response envelope for all prediction endpoints (REQ-PRED-23, REQ-PRED-23a).

### Data and Storage

- REQ-PRED-36: Prediction results and feature vectors are computed on demand from existing game and BGG data. Prediction results are not cached. The computation is local math over the existing collection. One new persistent file is introduced: `prediction-settings.json` stores `PredictionSettings` (stage thresholds, k, similarity threshold, tournament boost). This follows the existing storage pattern and is necessary for settings to survive daemon restarts.

- REQ-PRED-37: If prediction computation becomes a performance concern (measured, not assumed), the feature vector vocabulary and per-game vectors can be cached and invalidated when the collection changes. This is an optimization, not a requirement. Do not build caching infrastructure preemptively.

## Exit Points

| Exit                      | Triggers When                                                         | Target                                                                                                  |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Collection profiling      | User wants taste profile inference from the same feature vectors      | **Implemented**: `.lore/specs/collection-profiling.md`, `profile-engine.ts`                             |
| Redundancy scoring        | Feature vector overlap computation feeds mechanic/category redundancy | [STUB: redundancy-scoring]                                                                              |
| Prediction caching        | Computation becomes slow for large collections                        | [STUB: prediction-caching]                                                                              |
| Custom k/threshold tuning | User wants a UI for adjusting prediction settings                     | API-level tuning implemented (REQ-PRED-25a); a dedicated UI is deferred to [STUB: prediction-tuning-ui] |

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
- [ ] Prediction readiness stages gate output correctly: Stage 0 returns only BGG-derived actual scores with `predictionUnavailable` populated, Stages 1+ include predicted personal axes with confidence badges
- [ ] When stage thresholds are changed from defaults, the readiness stage reported matches the new thresholds
- [ ] `PredictionMeta` correctly reports predicted vs. actual axis counts, reference game count, and coverage percent
- [ ] Predicted fitness uses the same weighted average formula as actual fitness (verified against hand-calculated examples)
- [ ] Games without BGG data return "no BGG data available for prediction" rather than an empty or zero result

### Manual Verification (demonstration)

- [ ] Add a game via BGG search that has not been rated on any personal axis. View its detail page and see predicted scores with confidence indicators and reference games listed.
- [ ] Rate a game that previously had strong-confidence predictions on most axes. Compare the predicted score to the actual score. If the prediction is off by more than 3 points on most axes, flag as a calibration concern.
- [ ] View the collection list with predicted scores enabled. Predicted and actual scores are visually distinct.
- [ ] With tournament data: view a predicted game where the tournament cluster average diverges from the axis prediction. Both numbers are visible in the tension panel.
- [ ] On the search page, click a BGG search result and see the prediction preview panel with score, confidence badge, and breakdown.
- [ ] CLI: run `shelf-judge predict <id>` and verify the breakdown shows reference games, confidence levels, and the same score as the web UI.
- [ ] CLI: run `shelf-judge predict bgg <bgg-id>` and verify preview prediction for a game not in the collection.
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

1. ~~**k value tuning.**~~ **Resolved.** k=5 is the default. Now configurable at runtime via `PredictionSettings.defaultK` and the settings API (REQ-PRED-25a). No UI for tuning yet; deferred to [STUB: prediction-tuning-ui].

2. ~~**Minimum similarity threshold.**~~ **Resolved.** Threshold is 0.2 default, configurable via `PredictionSettings.minSimilarityThreshold`. Can be adjusted at runtime through the settings API.

3. **Feature vector performance.** No caching built. For a 100-game collection with ~50 unique mechanics and ~20 categories, the vector is ~75 dimensions per game and similarity computation is ~100 dot products per prediction. This should be sub-millisecond. If collection size grows significantly, revisit per [STUB: prediction-caching].

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

**Implementation artifacts:**

- `packages/daemon/src/services/feature-vector.ts` (shared feature vector module, built during profiling)
- `packages/daemon/src/services/prediction-engine.ts` (pure-function prediction math: k-NN, confidence, readiness, tension)
- `packages/daemon/src/services/prediction-service.ts` (service layer: context loading, DI wiring, BGG preview)
- `packages/daemon/src/routes/prediction.ts` (HTTP routes for prediction, readiness, settings)
- `packages/shared/src/types.ts` (prediction types: `PredictionConfidence`, `PredictionMeta`, `PredictionReadiness`, `PredictionSettings`, `PredictionUnavailable`, `PredictedGameResponse`, `RevealedPreferenceTension`, `ReferenceGame`)
- `packages/web/app/games/[id]/page.tsx` (game detail with prediction display and tension panel)
- `packages/web/app/search/page.tsx` (BGG search with prediction preview panel)
- `packages/web/app/readiness/page.tsx` (dedicated readiness page)
- `packages/web/app/collection/page.tsx` (collection list with predicted scores)
- `packages/web/components/score-breakdown.tsx` (breakdown table with prediction confidence UI)
- `packages/web/components/sidebar.tsx` (readiness widget)
- `packages/cli/src/commands/predict.ts` (CLI predict, predict bgg, predict readiness)

## Revision History

- 2026-04-11: Back-propagated from implementation (PR #14). Stage labels changed from "Experimental/Usable/Reliable" to "Not Ready/Basic/Moderate/Strong". Added BGG preview prediction (REQ-PRED-23a, 29a, 30a), settings CRUD API (REQ-PRED-25a), PredictionUnavailable type (REQ-PRED-35b), PredictedGameResponse envelope (REQ-PRED-35c). Updated REQ-PRED-13 to include readinessStage field. Updated REQ-PRED-15 to document configurable tournamentStabilityBoost. Updated REQ-PRED-20 to reflect nextStageAt vs games-needed-count. Updated REQ-PRED-21 to document full PredictionSettings scope. Updated REQ-PRED-36 to acknowledge prediction-settings.json. Resolved open questions 1-2 (now runtime-configurable). Updated exit point for prediction tuning (API exists, UI deferred).
