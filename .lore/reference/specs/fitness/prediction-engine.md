---
title: "Prediction Engine for Unrated Games"
date: 2026-04-11
status: implemented
tags: [spec, prediction, fitness, similarity, k-nn, confidence]
modules: [daemon, shared, web, cli]
related:
  - .lore/work/brainstorm/prediction-engine.md
  - .lore/work/brainstorm/collection-profiling.md
  - .lore/work/specs/mvp.md
  - .lore/work/specs/fitness/utility-curves.md
  - .lore/work/specs/tournament/tournament-ranking.md
  - .lore/reference/designs/mvp-fitness-model.md
  - .lore/work/issues/deferred-prediction-engine.md
  - .lore/work/issues/deferred-collection-profiling.md
  - .lore/work/issues/deferred-redundancy-scoring.md
  - .lore/reference/vision.md
req-prefix: PRED
---

# Spec: Prediction Engine for Unrated Games

## Overview

The fitness model scores games the user has rated. The prediction engine estimates what unrated games would score if the user rated them, using their existing ratings as training data and BGG attributes as the feature space.

The core approach is k-nearest-neighbor estimation: for each missing personal or tournament axis, find the most similar eligible rated games (based on BGG mechanics, categories, and factual continuous attributes) and use their available rating on that axis to predict the target. Tournament data participates as an axis source (per `.lore/reference/specs/tournament/elo-axis-source.md`), so the tournament axis is predicted on the same code path as personal axes when its value is missing. The confidence architecture communicates how much data backs each prediction.

This satisfies the MVP exit point `[STUB: prediction-engine]` ("user wants scores for unowned games") and connects to the vision's Principle 2 (transparent derivation) and Principle 4 (data serves judgment).

## Entry Points

- User views a game detail page for a game with missing personal axis ratings (owned or searched via BGG)
- User requests predicted fitness for a game via CLI (`shelf-judge predict <game-id>`)
- User previews predicted fitness for a BGG game before adding it, via search page preview panel or CLI (`shelf-judge predict bgg <bgg-id>`)
- Collection list displays predicted scores alongside actual scores for partially-rated games
- Sidebar readiness widget shows prediction stage on every page

## Requirements

### Feature Vector Encoding

- REQ-PRED-1: A prediction feature vector contains binary mechanics/category flags and continuous factual game attributes. Mechanics and categories have one binary column per term in the collection-wide vocabulary. Continuous dimensions are BGG weight (1-5 normalized to 0-1), community rating (1-10 normalized to 0-1), min players, max players, best players, and published playing time; the player/time dimensions are normalized over collection-observed ranges via `computeContinuousRanges`. Missing/non-finite feature inputs use the encoder's documented finite fallback values; missing derived-axis source values remain missing for scoring and are not inferred from feature-vector fallbacks. Personal and tournament axis values may be present in the shared `FeatureVector` for other consumers, but prediction similarity excludes all axis dimensions. Derived-axis values are never feature-vector axis slots, per `.lore/reference/specs/current/derived-bgg-axes.md` REQ-DERIVED-22. The vocabulary is the union of mechanic/category names across games with BGG data. **Implementation**: `packages/daemon/src/services/feature-vector.ts` exports `FeatureVector` (`{ binary, continuous, personalAxes }`), `encodeGame`, `buildVocabulary`, and `computeContinuousRanges`.

- REQ-PRED-2: Families are excluded from the initial feature vector. They are noisier than mechanics and categories (publisher families, series groupings) and can be added later if prediction quality is insufficient with the core features.

- REQ-PRED-3: Games without BGG data (manually added, no `bggData`) cannot be used as reference games for prediction and cannot receive predictions. The system reports "no BGG data available for prediction" for these games.

- REQ-PRED-4: Feature-vector and distance functions are pure functions without side effects or service dependencies. The shared module exposes the vocabulary, encoded vectors, binary Jaccard distance, normalized Manhattan distance, and weighted composite distance for reuse. Prediction uses the structured factual binary and continuous components; it does not concatenate axis dimensions or use cosine similarity.

### Similarity Computation

- REQ-PRED-5: Prediction neighbor similarity uses the same composite-distance mechanics as collection similarity: binary mechanics/categories use Jaccard distance, continuous factual dimensions use normalized Manhattan distance, and the weighted component distances form a composite distance in [0,1]. Prediction deliberately excludes personal-axis and tournament-axis dimensions from this comparison, even when values exist, so the target's similarity is not conditioned on the rating being predicted or on other axis ratings. With default component weights (binary 0.4, continuous 0.3, axis 0.3), the absent axis component's weight is redistributed proportionally across the factual components: binary weight 4/7 and continuous weight 3/7. Convert distance to similarity as `1 - compositeDistance`, also in [0,1] (1 means identical, 0 maximally distant). A neighbor is eligible only when its similarity is positive and at least the configured minimum: `similarity > 0 && similarity >= minSimilarityThreshold`. Thus a positive similarity exactly at the threshold is eligible, but zero similarity is never eligible, including when the threshold is 0. This differs from profile distance use only in that prediction does not compare axis dimensions.

- REQ-PRED-6: Only games with BGG data and at least one eligible personal or tournament-axis value can be reference games. A game with BGG data but no value on any prediction target is not a useful training example. Derived-axis values are not prediction-reference ratings.

### k-NN Estimation

- REQ-PRED-7: For each missing personal or tournament axis on a target game, the system selects the k most similar eligible reference games that have a value on that axis (not the k most similar overall, filtered afterward). Default k = 5. A reference must have BGG data and at least one personal or available tournament-axis value; only references with a value on the target axis and positive similarity meeting the configured threshold are considered. The predicted rating is their similarity-weighted average, so every selected neighbor has positive weight. If fewer than k eligible references remain, all contribute; if none remain—including when all axis-rated references have zero similarity—the axis is insufficient. Tournament is a prediction target and reference source per `.lore/reference/specs/tournament/elo-axis-source.md` REQ-TAXIS-8/17; a missing tournament value may instead be null because the cohort-floor rules there govern whether it is available.

- REQ-PRED-8: All BGG-derived axes produce "actual" confidence regardless of whether a utility curve is configured. The raw BGG value is resolved and the curve (or default linear map) produces a deterministic effective rating. This is not a prediction; the mapping from BGG data to effective rating is fully defined by the user's curve configuration or the default normalization.

- REQ-PRED-9: A predicted fitness score uses the same weighted average formula as actual fitness: `sum(effective_rating * weight) / sum(weights)`. The formula runs over all axes that have either an actual rating (personal or BGG-derived) or a predicted rating. Axes with "insufficient" confidence are excluded from both numerator and denominator, same as unrated axes in the current model.

- REQ-PRED-10: Veto thresholds apply to predicted scores the same way they apply to actual scores. If a BGG-derived axis has a veto and the game's BGG value triggers it, the predicted fitness is 0 with the same veto breakdown as actual fitness. If a personal axis is predicted and the predicted value would trigger a veto, the veto does NOT fire. Vetoes on predicted personal ratings would create false confidence in an estimate. Only actual ratings and deterministic BGG-derived values can trigger vetoes.

### Confidence Architecture

- REQ-PRED-11: Each predicted axis in a prediction breakdown carries a confidence level based only on selected positive-similarity neighbors that contribute to its weighted prediction. The code assigns strong when all of these hold: at least 5 selected neighbors, population variance of their ratings around the similarity-weighted predicted mean is < 1.5, and average similarity is > 0.7. Otherwise it assigns moderate when at least 3 neighbors, variance <= 3.0, and average similarity >= 0.4; otherwise any non-empty selected match set is weak. Zero-similarity references do not contribute to the estimate, neighbor count, variance, or average-similarity confidence criteria. No selected matches (including when the threshold is 0 but all axis-rated references have zero similarity) is insufficient and excluded from the predicted score.
  - **actual**: The rating comes from the user (personal rating) or from deterministic BGG data + curve. Not a prediction.
  - **strong**: All three conditions met: 5+ reference games contributed, population variance around the similarity-weighted predicted rating is < 1.5, and average similarity of contributing neighbors is > 0.7.
  - **moderate**: Does not qualify as strong, but has 3+ reference games, population variance around the similarity-weighted predicted rating <= 3.0, and average similarity >= 0.4.
  - **weak**: Does not qualify as moderate and has at least 1 reference game with positive similarity at or above the minimum threshold.
  - **insufficient**: No reference games have a rating on this axis, or no positive-similarity neighbor meets the minimum threshold (default 0.2). A zero threshold does not make zero-similarity neighbors eligible. The axis is excluded from the predicted score.

  Games with BGG data but no mechanics or categories have no binary overlap with mechanic-heavy games; their continuous factual dimensions still contribute to similarity. This may produce weak or insufficient predictions depending on the composite distance and threshold.

- REQ-PRED-12: Each predicted axis entry in the breakdown includes the reference games that contributed: game ID, game name, and similarity score. This is the explanation layer. The user can see "predicted 7.2 based on Azul (0.87, rated 8), Patchwork (0.81, rated 7), Kingdomino (0.79, rated 6)."

- REQ-PRED-13: The overall predicted fitness result includes prediction metadata (`PredictionMeta`):
  - `readinessStage`: current prediction readiness stage (0-3)
  - `confidence`: overall confidence (the lowest confidence level among all contributing predicted axes, or "actual" if no axes are predicted)
  - `predictedAxisCount` and `actualAxisCount`
  - `referenceGameCount`: count of distinct reference games that informed any prediction
  - `coveragePercent`: fraction of total axis weight covered by actual or strong-confidence data

- REQ-PRED-14: The UI always visually distinguishes predicted scores from actual scores. A predicted score is never presented identically to an actual score. The specific visual treatment is an implementation decision, but the distinction must be unambiguous.

### Tournament ELO as Prediction Prior


- REQ-PRED-16: [SUPERSEDED by REQ-TAXIS-16 in `.lore/reference/specs/tournament/elo-axis-source.md`] ~~After computing the predicted overall fitness score, the system checks whether the user has tournament-ranked games similar to the target. It computes the average `normalizedScore` (from `TournamentGameStatsDisplay`, already on the 1-10 scale) of the k nearest tournament-ranked neighbors. If this average differs from the predicted overall fitness score by more than 1.0 point, the system surfaces a "revealed preference tension" indicator showing: the predicted fitness score, the tournament-cluster average, and a plain-language note ("Your axis ratings predict 8.2 for games like this. In tournament matchups, similar games average 6.5."). Only neighbors with a non-null `normalizedScore` (5+ games ranked, game has comparisons) contribute.~~ The revealed preference tension surface has been removed; tournament is now an axis source contributing to a single unified fitness score.

- REQ-PRED-17: [SUPERSEDED by REQ-TAXIS-16 in `.lore/reference/specs/tournament/elo-axis-source.md`] ~~The revealed preference tension is informational only. It does not modify the predicted score. Both numbers are visible; the user interprets the gap. The tournament signal is always secondary to the axis prediction.~~

- REQ-PRED-18: Tournament prior features are only active when the user has tournament data. If no tournament sessions exist or no games have been compared, all tournament-related prediction features are silently inactive (no error, no empty UI elements).

### Cold Start and Prediction Readiness

- REQ-PRED-19: The system reports prediction readiness as one of four stages based on the number of collection games with at least one available personal or tournament-axis value. This readiness count is distinct from the eligible k-NN reference pool, which additionally requires BGG data:
  - **Stage 0** "Not Ready" (< 5 rated games): No personal-axis predictions. BGG-derived axes with curves still produce actual scores.
  - **Stage 1** "Basic" (5-14 rated games): Basic predictions available. Confidence is limited by the small reference pool. All predictions carry confidence badges; no separate "experimental" marker.
  - **Stage 2** "Moderate" (15-29 rated games): Moderate predictions. Most axes have enough reference data for useful estimates.
  - **Stage 3** "Strong" (30+ rated games): Strong prediction confidence. Rich reference pool across rated axes.

  Stage labels ("Not Ready", "Basic", "Moderate", "Strong") are presentation-level. The daemon returns the numeric stage; clients render the labels.

- REQ-PRED-20: The readiness response (`PredictionReadiness`) includes: `stage`, `ratedGameCount`, `nextStageAt` (the threshold for the next stage, not the count of games needed; clients compute the difference), `weakAxes` (personal and tournament axes with fewer than k rated examples, each with `axisId`, `axisName`, `ratedCount`), and `suggestedActions` (plain-text strings). Suggested actions identify axes with the fewest rated examples and mechanic/category clusters that are underrepresented (e.g., "Rate a Deck Building game to improve predictions for that cluster (2/7 rated)").

- REQ-PRED-21: All prediction parameters are configurable via `PredictionSettings`, persisted to `prediction-settings.json`. Settings include `stageThresholds` ([5, 15, 30] defaults), `defaultK` (5), and `minSimilarityThreshold` (0.2). A GET/PATCH API at `/predictions/settings` allows reading and updating settings at runtime.

- REQ-PRED-22: At Stage 0, deterministic derived-axis values can still contribute actual scores, but no personal or tournament axis is predicted. The response carries `predictionUnavailable: { reason: "stage-0", ratedGameCount, gamesNeeded }`; the count and threshold are the configured readiness basis. A BGG preview uses the same behavior. An axis with missing factual metadata and no applicable override remains unrated; a feature-vector fallback does not turn it into an actual score.

### API

- REQ-PRED-23: `GET /predictions/:gameId` returns a `PredictedGameResponse` containing `{ game, score, predictionUnavailable }`. The `score` field is a standard `FitnessResult` with `predictionMeta` and per-axis `predictionConfidence`/`referenceGames` populated. The `predictionUnavailable` field is non-null at Stage 0, containing `{ reason: "stage-0", ratedGameCount, gamesNeeded }`. If the game has full actual ratings on all axes, the response returns the actual fitness score with `predictionMeta: null`. (The previous `tension` field was removed by REQ-TAXIS-16.)

- REQ-PRED-23a: `GET /predictions/bgg/:bggId` accepts a BGG game ID and returns the same `PredictedGameResponse` shape. If the game already exists in the collection, it delegates to the standard prediction path. Otherwise, the daemon fetches BGG data, creates a temporary non-persisted `Game` object (ID prefixed with `preview-`), encodes it against the current collection vocabulary and observed ranges, and predicts without adding it to the collection. The preview result may additionally include `bggObservations` (metadata, player-range, suggested-player-poll, collection-data, and entity-metadata observations) when supplied by BGG. These observations describe source evidence, not extra prediction values. Missing or invalid factual inputs stay missing for derived-axis scoring; feature-vector fallback values are only for finite similarity encoding and must not be presented as factual derived-axis values. Existing derived-axis resolver/override/missing semantics remain governed by `.lore/reference/specs/current/derived-bgg-axes.md`.

- REQ-PRED-24: The existing `GET /games` endpoint gains an optional `?includePredicted=true` query parameter. When enabled, games with missing ratings receive predicted scores via the prediction service's `listGamesWithPredictions()` method. The response is `GameWithScore[]` with `FitnessResult` including `predictionMeta` where applicable.

- REQ-PRED-25: `GET /predictions/readiness` returns the current `PredictionReadiness` object (stage, rated count, next stage threshold, weak axes, suggested actions). This is a lightweight query, not a full prediction computation.

- REQ-PRED-25a: `GET /predictions/settings` returns the current `PredictionSettings`. `PATCH /predictions/settings` accepts a partial settings object and merges it with current settings. Both endpoints support runtime tuning of k, thresholds, and similarity minimum.

### Web UI

- REQ-PRED-26: The game detail view shows predicted axis ratings inline with actual ratings, visually distinguished. The score breakdown table shows a "Predicted" source badge and per-axis confidence badges. Clicking a confidence badge expands an inline panel showing the reference games, their similarity scores, and an average similarity stat.

- REQ-PRED-27: The collection list can be sorted by predicted fitness. Games with predicted scores sort among games with actual scores. The sort treats a predicted 7.5 the same as an actual 7.5 for ordering purposes, but the visual distinction (REQ-PRED-14) prevents confusion about which is which.

- REQ-PRED-28: [SUPERSEDED by REQ-TAXIS-16 in `.lore/reference/specs/tournament/elo-axis-source.md`] ~~When revealed preference tension exists (REQ-PRED-16), the game detail view shows a "Revealed Preference Tension" panel below the score breakdown. The panel displays the axis prediction score, the tournament pattern score, the delta, and the plain-language note. The display makes clear that the tournament signal is contextual, not a correction.~~ The tension panel has been removed; the tournament axis now appears as a row in the standard fitness breakdown.

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

- REQ-PRED-35a: `PredictionSettings` is a shared type: `{ stageThresholds: [number, number, number], defaultK: number, minSimilarityThreshold: number }`. Persisted to `prediction-settings.json` in the daemon data directory. Defaults are [5, 15, 30], 5, and 0.2 respectively.

- REQ-PRED-35b: `PredictionUnavailable` is a new shared type: `{ reason: "stage-0", ratedGameCount: number, gamesNeeded: number }`. Returned in prediction responses at Stage 0 to communicate why personal-axis predictions are absent.

- REQ-PRED-35c: `PredictedGameResponse` is a new shared type: `{ game: Game, score: FitnessResult, predictionUnavailable: PredictionUnavailable | null }`. This is the response envelope for all prediction endpoints (REQ-PRED-23, REQ-PRED-23a). (The `tension: RevealedPreferenceTension | null` field was removed by REQ-TAXIS-16; the `RevealedPreferenceTension` type is no longer part of the shared types.)

### Data and Storage

- REQ-PRED-36: Prediction results and feature vectors are computed on demand from existing game and BGG data. Prediction results are not cached. The computation is local math over the existing collection. One new persistent file is introduced: `prediction-settings.json` stores `PredictionSettings` (stage thresholds, k, and similarity threshold). This follows the existing storage pattern and is necessary for settings to survive daemon restarts.

- REQ-PRED-37: If prediction computation becomes a performance concern (measured, not assumed), the feature vector vocabulary and per-game vectors can be cached and invalidated when the collection changes. This is an optimization, not a requirement. Do not build caching infrastructure preemptively.

## Exit Points

| Exit                      | Triggers When                                                         | Target                                                                                                  |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Collection profiling      | User wants taste profile inference from the same feature vectors      | **Implemented**: `.lore/archive/specs/collection/collection-profiling.md`, `profile-engine.ts`                  |
| Redundancy scoring        | Feature vector overlap computation feeds mechanic/category redundancy | [STUB: redundancy-scoring]                                                                              |
| Prediction caching        | Computation becomes slow for large collections                        | [STUB: prediction-caching]                                                                              |
| Custom k/threshold tuning | User wants a UI for adjusting prediction settings                     | API-level tuning implemented (REQ-PRED-25a); a dedicated UI is deferred to [STUB: prediction-tuning-ui] |

## Success Criteria

### Automated Tests (bun test)

- [ ] Feature vector encoding produces correct binary flags for mechanics and categories, correct normalization for weight (1-5 to 0-1) and community rating (1-10 to 0-1)
- [ ] Prediction similarity is 1.0 for identical factual components, 0.0 at maximum composite distance, and agrees with hand-calculated binary Jaccard + normalized Manhattan values weighted 4/7 and 3/7; changing personal/tournament axis values does not change similarity
- [ ] k-NN estimation with k=5 returns the similarity-weighted average of the 5 most similar games' ratings on a given axis
- [ ] k-NN estimation correctly excludes reference games that lack a rating on the target axis
- [ ] BGG-derived axes with curves produce "actual" confidence, not "predicted"
- [ ] Confidence levels are assigned correctly: strong (5+ refs, population variance < 1.5, average similarity > 0.7), moderate (3+ refs, variance <= 3, average similarity >= 0.4), weak, insufficient
- [ ] Insufficient-confidence axes are excluded from the predicted score (not counted in numerator or denominator)
- [ ] Vetoes fire on BGG-derived axis values but not on predicted personal axis values
- [ ] ~~Revealed preference tension is surfaced when predicted overall fitness and tournament cluster `normalizedScore` average differ by > 1.0, and not surfaced when they differ by <= 1.0~~ (Superseded by REQ-TAXIS-16; tension surface removed)
- [ ] Prediction readiness stages gate output correctly: Stage 0 returns only BGG-derived actual scores with `predictionUnavailable` populated, Stages 1+ include predicted personal axes with confidence badges
- [ ] When stage thresholds are changed from defaults, the readiness stage reported matches the new thresholds
- [ ] `PredictionMeta` correctly reports predicted vs. actual axis counts, reference game count, and coverage percent
- [ ] Predicted fitness uses the same weighted average formula as actual fitness (verified against hand-calculated examples)
- [ ] Games without BGG data return "no BGG data available for prediction" rather than an empty or zero result

### Manual Verification (demonstration)

- [ ] Add a game via BGG search that has not been rated on any personal axis. View its detail page and see predicted scores with confidence indicators and reference games listed.
- [ ] Rate a game that previously had strong-confidence predictions on most axes. Compare the predicted score to the actual score. If the prediction is off by more than 3 points on most axes, flag as a calibration concern.
- [ ] View the collection list with predicted scores enabled. Predicted and actual scores are visually distinct.
- [ ] ~~With tournament data: view a predicted game where the tournament cluster average diverges from the axis prediction. Both numbers are visible in the tension panel.~~ (Superseded by REQ-TAXIS-16; tension panel removed)
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

- Prediction distance/similarity math validated against hand-calculated mechanic/category overlap and normalized continuous distances; axis dimensions are excluded and default factual weights are 4/7 and 3/7
- k-NN estimation verified with a controlled test collection (5 rated games with known ratings and BGG attributes, predict a 6th, verify the weighted average matches)
- Confidence level boundaries tested at exact thresholds (4 vs 5 reference games, variance at 1.5, similarity at 0.7)
- ~~Revealed preference tension tested with known divergence (> 1.0) and non-divergence (<= 1.0) cases~~ (Superseded by REQ-TAXIS-16; tension surface removed)
- Type extensions verified as backward-compatible: existing `FitnessResult` consumers (web game detail, CLI scores, collection list) render correctly when prediction fields are null

## Constraints

- The fitness formula (`sum(effective_rating * weight) / sum(weights)`) does not change. Prediction produces per-axis ratings that feed into the same aggregation. No new aggregation math.
- Prediction is read-only. It does not modify any stored data: no game ratings, no tournament data, no axis configurations.
- The feature vector module is designed for reuse. Collection profiling and redundancy scoring will consume the same vectors and similarity computations. The module's API should not be prediction-specific.
- No external services beyond what the system already uses. Prediction is local math over cached BGG data and stored ratings.
- The tournament axis IS a prediction target (per REQ-TAXIS-17 in `.lore/reference/specs/tournament/elo-axis-source.md`): the prediction engine fills missing tournament axis values for unrated games on the same code path it uses for personal axes. When available, tournament-axis ratings are reference data for that prediction.
- Single-user constraint holds. No collaborative filtering across users. The prediction uses one user's ratings to predict one user's scores.

## Open Questions

1. ~~**k value tuning.**~~ **Resolved.** k=5 is the default. Now configurable at runtime via `PredictionSettings.defaultK` and the settings API (REQ-PRED-25a). No UI for tuning yet; deferred to [STUB: prediction-tuning-ui].

2. ~~**Minimum similarity threshold.**~~ **Resolved.** Threshold is 0.2 default, configurable via `PredictionSettings.minSimilarityThreshold`. Can be adjusted at runtime through the settings API.

3. **Feature vector performance.** No caching built. Similarity evaluates factual binary and continuous components across collection references; if collection size makes this slow in measurement, revisit per [STUB: prediction-caching].

## Context

**Origin:** Deferred from MVP spec as `[STUB: prediction-engine]`. The brainstorm (`.lore/work/brainstorm/prediction-engine.md`, revised 2026-04-10) evaluated six proposals and concluded with four accepted approaches: k-NN estimation (core), tournament ELO prior (extension), confidence architecture (extension), and cold start progressive unlock (completeness). Two proposals were rejected: curve-first prediction (subsumed by k-NN, since curves produce "actual" scores for BGG-derived axes automatically) and BGG "fans also like" discovery (API not accessible, single-user data too sparse for collaborative filtering).

**Shared infrastructure:** Collection profiling is implemented. The shared feature-vector module (`packages/daemon/src/services/feature-vector.ts`) provides vocabulary building, per-game encoding, centroid computation, Jaccard distance, normalized Manhattan distance, and composite distance. Prediction uses composite distance over factual binary/continuous dimensions and converts it to similarity; it excludes personal and tournament axis values from neighbor comparison. Derived axis values are not feature-vector dimensions, per `.lore/reference/specs/current/derived-bgg-axes.md` REQ-DERIVED-22.

**Key design documents:**

- `.lore/work/brainstorm/prediction-engine.md` (source brainstorm, concluded)
- `.lore/work/brainstorm/collection-profiling.md` (shares feature vector infrastructure)
- `.lore/archive/specs/collection/collection-profiling.md` (implemented, shares feature-vector.ts)
- `.lore/reference/designs/mvp-fitness-model.md` (current FitnessResult types being extended)
- `.lore/work/specs/fitness/utility-curves.md` (reconciliation input for curves)
- `.lore/work/specs/tournament/tournament-ranking.md` (reconciliation input for tournament data)

**Implementation artifacts:**

- `packages/daemon/src/services/feature-vector.ts` (shared feature vector module, built during profiling)
- `packages/daemon/src/services/prediction-engine.ts` (pure-function prediction math: k-NN, confidence, readiness)
- `packages/daemon/src/services/prediction-service.ts` (service layer: context loading, DI wiring, BGG preview)
- `packages/daemon/src/routes/prediction.ts` (HTTP routes for prediction, readiness, settings)
- `packages/shared/src/types.ts` (prediction types: `PredictionConfidence`, `PredictionMeta`, `PredictionReadiness`, `PredictionSettings`, `PredictionUnavailable`, `PredictedGameResponse`, `ReferenceGame`)
- `packages/web/app/games/[id]/page.tsx` (game detail with prediction display)
- `packages/web/app/search/page.tsx` (BGG search with prediction preview panel)
- `packages/web/app/readiness/page.tsx` (dedicated readiness page)
- `packages/web/app/collection/page.tsx` (collection list with predicted scores)
- `packages/web/components/score-breakdown.tsx` (breakdown table with prediction confidence UI)
- `packages/web/components/sidebar.tsx` (readiness widget)
- `packages/cli/src/commands/predict.ts` (CLI predict, predict bgg, predict readiness)

## Revision History

- 2026-04-11: Back-propagated from implementation (PR #14). Stage labels changed from "Experimental/Usable/Reliable" to "Not Ready/Basic/Moderate/Strong". Added BGG preview prediction (REQ-PRED-23a, 29a, 30a), settings CRUD API (REQ-PRED-25a), PredictionUnavailable type (REQ-PRED-35b), PredictedGameResponse envelope (REQ-PRED-35c). Updated REQ-PRED-13 to include readinessStage field. Updated REQ-PRED-20 to reflect nextStageAt vs games-needed-count. Updated REQ-PRED-21 to document full PredictionSettings scope. Updated REQ-PRED-36 to acknowledge prediction-settings.json. Resolved open questions 1-2 (now runtime-configurable). Updated exit point for prediction tuning (API exists, UI deferred).
