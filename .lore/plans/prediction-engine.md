---
title: "Implementation plan: prediction-engine"
date: 2026-04-10
status: approved
tags: [plan, prediction, fitness, similarity, k-nn, confidence, tournament, feature-vector]
modules: [shared, daemon, web, cli]
related:
  - .lore/specs/prediction-engine.md
  - .lore/brainstorms/prediction-engine.md
  - .lore/specs/collection-profiling.md
  - .lore/research/outlier-distance-metric.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/specs/utility-curves.md
  - .lore/specs/tournament-ranking.md
---

# Plan: Prediction Engine for Unrated Games

## Spec Reference

**Spec**: `.lore/specs/prediction-engine.md`
**Brainstorm**: `.lore/brainstorms/prediction-engine.md`
**Shared infrastructure context**: `.lore/specs/collection-profiling.md` (consumes same feature vectors)
**Distance metric research**: `.lore/research/outlier-distance-metric.md`

Requirements addressed:

- REQ-PRED-1: Feature vector encoding → Phase 1
- REQ-PRED-2: Families excluded from feature vector → Phase 1
- REQ-PRED-3: Games without BGG data excluded → Phase 1, Phase 3
- REQ-PRED-4: Feature vector as pure-function module → Phase 1
- REQ-PRED-5: Cosine similarity computation → Phase 1
- REQ-PRED-6: Only rated games as reference → Phase 2
- REQ-PRED-7: k-NN estimation per axis → Phase 2
- REQ-PRED-8: BGG-derived axes produce "actual" confidence → Phase 2
- REQ-PRED-9: Predicted fitness uses same weighted average → Phase 2
- REQ-PRED-10: Veto behavior for predicted vs. actual → Phase 2
- REQ-PRED-11: Confidence level assignment → Phase 2
- REQ-PRED-12: Reference game attribution per predicted axis → Phase 2
- REQ-PRED-13: Overall prediction metadata → Phase 2
- REQ-PRED-14: Visual distinction of predicted vs. actual → Phase 5
- REQ-PRED-15: Tournament stability weighting → Phase 3
- REQ-PRED-16: Revealed preference tension → Phase 3
- REQ-PRED-17: Tension is informational only → Phase 3
- REQ-PRED-18: Tournament features silently inactive without data → Phase 3
- REQ-PRED-19: Prediction readiness stages → Phase 2
- REQ-PRED-20: Readiness response with weak axes and suggestions → Phase 2
- REQ-PRED-21: Configurable stage thresholds → Phase 2
- REQ-PRED-22: Stage 0 behavior → Phase 2
- REQ-PRED-23: Predict game endpoint → Phase 4
- REQ-PRED-24: Collection list with predictions → Phase 4
- REQ-PRED-25: Readiness endpoint → Phase 4
- REQ-PRED-26: Web game detail predicted scores → Phase 5
- REQ-PRED-27: Collection list sorted by predicted fitness → Phase 5
- REQ-PRED-28: Revealed preference tension display → Phase 5
- REQ-PRED-29: Prediction readiness in UI → Phase 5
- REQ-PRED-30: CLI `predict` command → Phase 6
- REQ-PRED-31: CLI `predict readiness` → Phase 6
- REQ-PRED-32: CLI `scores --include-predicted` → Phase 6
- REQ-PRED-33: `FitnessBreakdownSource` gains `"predicted"` → Phase 1
- REQ-PRED-34: `FitnessBreakdownEntry` gains prediction fields → Phase 1
- REQ-PRED-35: `FitnessResult` gains `predictionMeta` → Phase 1
- REQ-PRED-36: No new persistent storage → Phase 2 (architectural constraint)
- REQ-PRED-37: Caching deferred → not implemented

## Codebase Context

### Architecture

Bun monorepo, four workspace packages. The daemon owns all data via services injected through factory functions. Web talks to daemon via Unix socket (`lib/daemon.ts`). CLI talks to daemon via Unix socket (Bun `fetch` with `unix` option). Shared types and Zod schemas in `packages/shared/`.

### Existing Patterns

**Service layer**: Each domain has a service interface and `create*Service(deps)` factory. Services receive `StorageService` and peer services via dependency injection. No classes, just closures over deps. See `game-service.ts`, `axis-service.ts`, `fitness-service.ts`, `tournament-service.ts`.

**Pure math modules**: `curve-engine.ts` and `elo-engine.ts` establish the pattern for pure-function math modules. Exported functions, no service dependencies, no I/O. Heavy unit test coverage. The feature vector engine and prediction engine follow this pattern.

**Routes**: Each route module exports `{ routes: Hono, operations: OperationDefinition[] }` via `createXRoutes(deps)`. Routes parse/validate input, call service, map errors to HTTP status codes.

**CLI**: Hand-rolled arg parser in `index.ts` with a `COMMANDS` map. Each command module exports async functions that take `(client, args, opts)`. Output via `formatTable` and `printOutput` helpers.

**Web**: Next.js 16 with App Router. Server components fetch from daemon via `lib/api.ts`. Client components use the `/api/daemon/[...path]` proxy route for mutations. CSS in a global stylesheet.

### Key Files That Will Change

**Shared types** (`packages/shared/src/types.ts`):

- `FitnessBreakdownSource` (line 91): add `"predicted"` value
- `FitnessBreakdownEntry` (line 93): add `predictionConfidence` and `referenceGames` nullable fields
- `FitnessResult` (line 107): add `predictionMeta` nullable field
- New types: `PredictionConfidence`, `PredictionMeta`, `PredictionReadiness`, `FeatureVector`, `ReferenceGame`

**Shared validation** (`packages/shared/src/validation.ts`): No prediction-specific validation schemas needed. Prediction is read-only; no user input to validate beyond game IDs.

**Daemon services**:

- `packages/daemon/src/services/feature-vector-engine.ts` (new): pure-function module for vector encoding, vocabulary building, similarity computation
- `packages/daemon/src/services/prediction-engine.ts` (new): pure-function module for k-NN estimation, confidence calculation, readiness assessment
- `packages/daemon/src/services/prediction-service.ts` (new): service that wires engines together with data access
- `packages/daemon/src/services/fitness-service.ts` (line 46): no changes to the existing `calculateScore` path. Prediction produces its own `FitnessResult` with `predictionMeta` populated.

**Daemon routes**:

- `packages/daemon/src/routes/prediction.ts` (new): predict game, readiness, collection with predictions

**Web**:

- `packages/web/app/games/[id]/page.tsx`: predicted score display, reference games, confidence, tension
- `packages/web/components/collection-table.tsx`: predicted score column, sort by predicted fitness
- `packages/web/lib/api.ts`: new API calls for prediction endpoints

**CLI**:

- `packages/cli/src/commands/predict.ts` (new): predict and readiness commands
- `packages/cli/src/commands/score.ts`: `--include-predicted` flag
- `packages/cli/src/index.ts`: register predict commands

### Cross-Cutting Concerns

**Backward compatibility**: All type extensions are additive nullable fields. `predictionConfidence`, `referenceGames`, and `predictionMeta` are null for non-predicted results. Existing code that reads `FitnessBreakdownEntry` and `FitnessResult` is unaffected. The one compatibility risk: clients that treat `score === null` as "unscored" in the collection list. When the `includePredicted` query parameter is enabled, games that currently return `score: null` will instead return a `FitnessResult` with `ratedAxisCount: 0` and `predictionMeta` populated. The web `CollectionTable` and CLI `scoreList` must handle this shape.

**Shared infrastructure for collection profiling**: The feature vector module is intentionally not prediction-specific. It exposes:

- Vocabulary building (which mechanics/categories have columns)
- Per-game vector encoding
- Cosine similarity (for prediction's k-NN)
- Binary flag extraction (profiling needs Jaccard distance on the binary portion separately)
- Continuous feature extraction (profiling needs normalized Manhattan on the continuous portion separately)

The profiling spec (`REQ-PROFILE-11`) needs Jaccard on mechanics/categories and normalized Manhattan on continuous attributes. The prediction spec (`REQ-PRED-5`) needs cosine similarity on the full vector. Both need the same underlying encoding. The module exposes the components so each consumer composes what it needs.

**Web UI local type duplication**: The web game detail page (`packages/web/app/games/[id]/page.tsx`) and axes page both have local type definitions that duplicate shared types. When prediction fields are added to shared types, the web pages' local types must also be updated. This is a known issue (`.lore/issues/axes-page-local-type.md`).

**Prediction readiness config**: Stage thresholds (5, 15, 30) need a storage location. The `TournamentSettings` interface on `TournamentData` is the precedent for feature-specific settings. Prediction settings go on a new `PredictionSettings` interface stored alongside the existing config. The `StorageService` gains `loadPredictionSettings()` and `savePredictionSettings()` methods following the same pattern as tournament settings.

## Technical Decisions

### 1. Feature vector module split: binary vs. continuous

**Decision**: The feature vector module stores mechanics and categories as separate binary flag arrays, and continuous attributes (weight, community rating, player count min/max) as a separate normalized array. The full cosine similarity vector is the concatenation of both, but consumers can access the binary and continuous portions independently.

**Rationale**: Prediction needs cosine similarity over the full concatenated vector. Collection profiling needs Jaccard distance on the binary portion and normalized Manhattan on the continuous portion (per the outlier research at `.lore/research/outlier-distance-metric.md` and `REQ-PROFILE-11`). Exposing the components avoids recomputation and keeps the module's API honest about what it contains.

### 2. Prediction service vs. extending fitness service

**Decision**: Create a separate `prediction-service.ts` rather than extending `FitnessService.calculateScore`. The prediction service calls the existing `calculateScore` for BGG-derived axes (which produce "actual" confidence), then runs k-NN estimation for personal axes that lack ratings.

**Rationale**: The existing `calculateScore` function is clean and well-tested. Prediction is a different operation: it reads across the entire collection to find neighbors, while `calculateScore` operates on a single game. Mixing them would complicate both. The prediction service composes `calculateScore` output with k-NN estimates to produce a unified `FitnessResult`.

### 3. Tournament stability multiplier

**Decision**: The tournament stability factor is `1.0 + 0.2 * min(comparisonCount / provisionalThreshold, 1.0)` for games with `comparisonCount >= provisionalThreshold`, and `1.0` otherwise. This gives stable games a maximum 20% similarity boost (factor of 1.2).

**Rationale**: The spec says the factor must be "> 1.0 for stable games" and "measurably higher." A 20% boost is enough to break ties between otherwise-equal neighbors without overwhelming the base cosine similarity. The multiplier scales linearly up to the threshold then caps, avoiding unbounded growth for heavily-compared games. The exact value (0.2) is a calibration constant that can be adjusted without structural changes.

### 4. Prediction settings storage

**Decision**: Add a `prediction-settings.json` file in the daemon's data directory, alongside `tournament.json`. Load and save via `StorageService` methods. Default values are defined in the prediction engine (not the storage layer), matching the `curve-engine.ts` pattern where defaults live with the math.

**Rationale**: Stage thresholds (5, 15, 30), default k value (5), and minimum similarity threshold (0.2) need to be configurable per REQ-PRED-21. A separate file keeps prediction config isolated from tournament config. The `StorageService` already handles JSON file persistence for games, axes, tournament data, and app config.

### 5. Collection list extension approach

**Decision**: The existing `GET /api/games` endpoint gains an optional `?includePredicted=true` query parameter (REQ-PRED-24). When enabled, the response shape changes: `GameWithScore.score` is non-null for games that have predictions (even if they have zero actual ratings). The `predictionMeta` field on the `FitnessResult` distinguishes predicted from actual. This keeps the collection list as a single endpoint rather than splitting into two.

**Rationale**: The web `CollectionTable` already receives `GameWithScore[]` and renders based on `score`. Adding a second endpoint for "games with predictions" would require the client to merge two lists. A single endpoint with an opt-in parameter is simpler. The parameter defaults to false, so existing clients are unaffected.

## Phases

### Phase 1: Shared Types and Feature Vector Engine

**What changes**: Extend shared types with prediction fields. Create the feature vector encoding module as a pure-function module in the daemon. Write comprehensive tests for vector math.

**Files created**:

- `packages/daemon/src/services/feature-vector-engine.ts` -- pure vector encoding, vocabulary, similarity
- `packages/daemon/tests/services/feature-vector-engine.test.ts`

**Files modified**:

- `packages/shared/src/types.ts` -- type extensions
- `packages/shared/src/index.ts` -- re-exports
- `packages/daemon/src/services/fitness-service.ts` -- add `predictionMeta: null` to both return paths (vetoed and non-vetoed) so the existing `calculateScore` satisfies the extended `FitnessResult` type

#### Type extensions

Add to `packages/shared/src/types.ts`:

```typescript
// Prediction types

export type PredictionConfidence = "actual" | "strong" | "moderate" | "weak" | "insufficient";

export interface ReferenceGame {
  gameId: string;
  gameName: string;
  similarity: number;
}

export interface PredictionMeta {
  readinessStage: 0 | 1 | 2 | 3;
  confidence: PredictionConfidence;
  predictedAxisCount: number;
  actualAxisCount: number;
  referenceGameCount: number;
  coveragePercent: number; // fraction of total axis weight covered by actual or strong-confidence data
}

export interface PredictionReadiness {
  stage: 0 | 1 | 2 | 3;
  ratedGameCount: number;
  nextStageAt: number;
  weakAxes: { axisId: string; axisName: string; ratedCount: number }[];
  suggestedActions: string[];
}

export interface RevealedPreferenceTension {
  predictedFitness: number;
  tournamentClusterAverage: number;
  note: string;
}

export interface PredictionSettings {
  stageThresholds: [number, number, number]; // [stage1, stage2, stage3] defaults [5, 15, 30]
  defaultK: number; // default 5
  minSimilarityThreshold: number; // default 0.2
  tournamentStabilityBoost: number; // default 0.2
}
```

Extend `FitnessBreakdownSource`:

```typescript
export type FitnessBreakdownSource = "personal" | "bgg" | "override" | "predicted";
```

Add to `FitnessBreakdownEntry`:

```typescript
  predictionConfidence: PredictionConfidence | null; // null for non-predicted
  referenceGames: ReferenceGame[] | null; // null for non-predicted
```

Add to `FitnessResult`:

```typescript
predictionMeta: PredictionMeta | null; // null for fully-actual results
```

#### Feature vector engine

`feature-vector-engine.ts` exports pure functions:

- `buildVocabulary(games: Game[]): Vocabulary` -- scans all games' `bggData.mechanics` and `bggData.categories`, builds a sorted list of unique tag IDs for each. Returns `{ mechanicIds: number[], categoryIds: number[] }`. Only games with `bggData` contribute.

- `encodeBinaryFlags(game: Game, vocabulary: Vocabulary): number[]` -- binary flag array where each position is 1 if the game has that mechanic/category, 0 otherwise. Mechanics first, then categories. Games without `bggData` return an empty array.

- `encodeContinuousFeatures(game: Game): number[]` -- `[normalizedWeight, normalizedCommunityRating, normalizedMinPlayers, normalizedMaxPlayers]`. Weight: `(weight - 1) / 4` (1-5 to 0-1). Community rating: `(communityRating - 1) / 9` (1-10 to 0-1). Player counts: `min(minPlayers, 12) / 12` and `min(maxPlayers, 12) / 12`. Null weight produces 0.5 (midpoint). Games without `bggData` return an empty array.

- `encodeFullVector(game: Game, vocabulary: Vocabulary): number[]` -- concatenation of `encodeBinaryFlags` and `encodeContinuousFeatures`.

- `cosineSimilarity(a: number[], b: number[]): number` -- standard cosine similarity. Returns 0 if either vector is all zeros.

- `jaccardDistance(a: number[], b: number[]): number` -- `1 - |intersection| / |union|` on binary arrays. For profiling reuse.

- `normalizedManhattanDistance(a: number[], b: number[]): number` -- `sum(|a_i - b_i|) / n`. For profiling reuse.

The `Vocabulary` type is exported for consumers to inspect which mechanics/categories are encoded and at which positions.

**Profiling interface boundary**: `jaccardDistance` and `normalizedManhattanDistance` are designed for game-to-game comparison on binary and continuous arrays respectively. Collection profiling's centroid is a float frequency vector (e.g., 0.6 means 60% of games have that mechanic), not a binary vector. The profiling team will need to adapt Jaccard for game-vs-centroid comparison (threshold the centroid or use a frequency-weighted variant). This module does not solve that problem, but the binary flag encoding and vocabulary are reusable as inputs to whatever centroid distance the profiler chooses.

**Depends on**: Nothing. This is the foundation.

**Verification**:

- Feature vector encodes known mechanics/categories as correct binary flags at correct positions.
- Normalization produces correct 0-1 values for weight (1-5), community rating (1-10), and player counts.
- Cosine similarity returns 1.0 for identical vectors, 0.0 for orthogonal vectors, and correct intermediate values for partial overlap.
- Cosine similarity returns 0.0 when either vector is all zeros (no BGG data).
- Jaccard distance returns 0.0 for identical sets, 1.0 for disjoint sets.
- Games without `bggData` produce empty vectors.
- Vocabulary built from a known collection contains exactly the expected mechanic/category IDs.
- Typecheck clean. Existing tests still pass.

**Reqs covered**: REQ-PRED-1, 2, 3, 4, 5, 33, 34, 35.

---

### Phase 2: k-NN Estimation, Confidence, and Readiness

**What changes**: Create the prediction engine as a pure-function module. Implements k-NN estimation, confidence level assignment, prediction readiness assessment, and the core prediction flow that produces a `FitnessResult` with `predictionMeta`.

**Files created**:

- `packages/daemon/src/services/prediction-engine.ts` -- pure prediction math
- `packages/daemon/tests/services/prediction-engine.test.ts`

**Files modified**: None.

#### Prediction engine

`prediction-engine.ts` exports pure functions:

- `findKNearestForAxis(targetVector: number[], referenceGames: ReferenceGameCandidate[], axisId: string, k: number, minSimilarity: number): SimilarityMatch[]` -- finds the k most similar games that have a rating on `axisId`. `ReferenceGameCandidate` is `{ gameId: string; gameName: string; vector: number[]; ratings: Record<string, number>; tournamentStability: number }`. The similarity score is `cosineSimilarity(target, candidate) * tournamentStability`. Returns matches sorted by effective similarity descending. Excludes candidates below `minSimilarity`. If fewer than k qualify, returns all that do.

- `predictAxisRating(matches: SimilarityMatch[]): { rating: number; confidence: PredictionConfidence; variance: number; avgSimilarity: number }` -- similarity-weighted average of matches' ratings. Confidence assigned per REQ-PRED-11:
  - `actual`: not produced here (handled separately for BGG-derived axes)
  - `strong`: 5+ matches, variance < 1.5, average similarity > 0.7
  - `moderate`: 3+ matches, variance <= 3.0, average similarity >= 0.4
  - `weak`: at least 1 match above minimum similarity
  - `insufficient`: zero matches (returns null rating)
    When multiple criteria point to different levels, the lowest (least confident) wins.

- `computePredictedFitness(game: Game, axes: Axis[], bggData: BggGameData | null, referenceGames: ReferenceGameCandidate[], settings: PredictionSettings, calculateActualScore: (game: Game, axes: Axis[], bggData: BggGameData | null) => FitnessResult | null): PredictedFitnessResult` -- the core prediction entry point.

  This function:
  1. Calls `calculateActualScore` to get the actual fitness result (which handles BGG-derived axes with curves). If the result is non-null and all axes are rated, returns it with `predictionMeta: null` (no prediction needed).
  2. For each axis without an actual rating, runs `findKNearestForAxis` and `predictAxisRating`.
  3. Assembles a combined `FitnessBreakdownEntry[]` where actual entries have `source: "personal"/"bgg"/"override"` and `predictionConfidence: "actual"`, and predicted entries have `source: "predicted"` with the computed confidence.
  4. Computes the overall fitness score using the same `sum(effective_rating * weight) / sum(weights)` formula. Axes with `insufficient` confidence are excluded.
  5. Applies veto rules: BGG-derived actual vetoes fire normally. Predicted personal axis values do NOT trigger vetoes (REQ-PRED-10).
  6. Builds `PredictionMeta`: `readinessStage` from the current stage, overall confidence = lowest non-actual confidence among contributing axes, counts, and `coveragePercent` = fraction of total axis weight covered by "actual" or "strong" confidence data (moderate and weak do not count toward coverage).
  7. Returns a `FitnessResult` with `predictionMeta` populated.

- `assessReadiness(ratedGameCount: number, axes: Axis[], gameRatings: Map<string, Record<string, number>>, vocabulary: Vocabulary, settings: PredictionSettings): PredictionReadiness` -- computes the current readiness stage and suggested actions.
  - Stage derived from `ratedGameCount` against `settings.stageThresholds`.
  - Weak axes: for each personal axis, count how many games have a rating on it. Sort ascending. Report the bottom ones.
  - Suggested actions: identify mechanic/category clusters that are underrepresented among rated games. For example, if the collection has 10 deck-building games but only 1 is rated, suggest "Rate a deck-building game to improve predictions for that mechanic cluster."

**Depends on**: Phase 1 (feature vector engine, shared types).

**Verification**:

- k-NN with k=5 returns the 5 most similar games that have the target axis rating, not the 5 most similar overall filtered afterward.
- Similarity-weighted average produces correct values against hand-calculated examples (5 games with known ratings and similarities, verify the weighted average).
- Confidence levels assigned correctly at exact boundaries: 4 vs 5 reference games, variance at 1.49 vs 1.51, similarity at 0.69 vs 0.71.
- Insufficient-confidence axes excluded from score (not counted in numerator or denominator).
- BGG-derived axes with curves produce `predictionConfidence: "actual"`, not predicted.
- Vetoes fire on BGG-derived actual values but not on predicted personal values.
- Predicted fitness score matches hand-calculated `sum(effective_rating * weight) / sum(weights)`.
- Readiness stages gate correctly: Stage 0 (< 5 rated) returns no personal-axis predictions. Stage 1 marks experimental. Stages 2-3 unrestricted.
- Custom stage thresholds are respected.
- `PredictionMeta` correctly reports predicted vs. actual axis counts, reference game count, and coverage percent.
- Games without BGG data return a clear "no BGG data" indication.
- Typecheck clean.

**Reqs covered**: REQ-PRED-6, 7, 8, 9, 10, 11, 12, 13, 19, 20, 21, 22, 36.

---

### Phase 3: Tournament Prior

**What changes**: Integrate tournament data into the prediction flow. Add tournament stability weighting to similarity scores and revealed preference tension detection. Tests for tournament-specific prediction behavior.

**Files modified**:

- `packages/daemon/src/services/prediction-engine.ts` -- tournament stability factor is already wired via `ReferenceGameCandidate.tournamentStability`. This phase adds the revealed preference tension computation.

**Files created**:

- `packages/daemon/tests/services/prediction-engine-tournament.test.ts` -- tournament-specific prediction tests (kept separate from the core prediction tests for clarity)

#### Tournament stability weighting

The `tournamentStability` field on `ReferenceGameCandidate` is populated by the prediction service (Phase 4) when building candidates. For games with `comparisonCount >= provisionalThreshold`: `1.0 + settings.tournamentStabilityBoost * min(comparisonCount / provisionalThreshold, 1.0)`. For provisional or unranked games: `1.0`. This is already consumed by `findKNearestForAxis` in Phase 2 as a similarity multiplier. Phase 3 adds the tension detection.

#### Revealed preference tension

Add to `prediction-engine.ts`:

- `detectRevealedPreferenceTension(predictedOverallFitness: number, targetVector: number[], tournamentRankedGames: TournamentRankedGame[], k: number, minSimilarity: number): RevealedPreferenceTension | null` -- finds the k nearest tournament-ranked neighbors of the target game (using cosine similarity on feature vectors). Computes the average `normalizedScore` of those neighbors. If the difference exceeds 1.0 point, returns the tension object with both numbers and a plain-language note. Returns null when no tension (difference <= 1.0) or when no qualifying neighbors exist.

  `TournamentRankedGame` is `{ gameId: string; gameName: string; vector: number[]; normalizedScore: number }`. Only games with non-null `normalizedScore` (5+ games ranked, game has comparisons) qualify.

**Depends on**: Phase 2 (prediction engine).

**Verification** (unit tests with hand-crafted `ReferenceGameCandidate` and `TournamentRankedGame` values; end-to-end integration verified in Phase 4):

- A reference game with `tournamentStability: 1.2` has a higher effective similarity than the same game with `tournamentStability: 1.0`, verified via `findKNearestForAxis` output ordering.
- Tournament stability factor caps at `1.0 + boost` and doesn't grow unbounded.
- Revealed preference tension is surfaced when predicted fitness and tournament cluster average differ by > 1.0.
- Tension is not surfaced when difference is <= 1.0.
- Tension is not surfaced when no tournament-ranked neighbors exist (empty `tournamentRankedGames` array).
- Typecheck clean.

**Reqs covered**: REQ-PRED-15, 16, 17, 18.

---

### Phase 4: Prediction Service and Daemon API

**What changes**: Create the prediction service that wires the pure engines together with data access. Add prediction routes to the daemon. The service reads games, axes, tournament data, builds feature vectors, and delegates to the prediction engine.

**Files created**:

- `packages/daemon/src/services/prediction-service.ts` -- service layer
- `packages/daemon/src/routes/prediction.ts` -- HTTP routes
- `packages/daemon/tests/services/prediction-service.test.ts`
- `packages/daemon/tests/routes/prediction.test.ts`

**Files modified**:

- `packages/daemon/src/services/storage-service.ts` -- add `loadPredictionSettings()` and `savePredictionSettings()`
- `packages/daemon/src/index.ts` -- register prediction routes and service
- `packages/daemon/src/routes/games.ts` -- add `?includePredicted=true` query parameter to list endpoint

#### Prediction service interface

```typescript
export interface PredictionService {
  predictGame(gameId: string): Promise<PredictedGameResult>;
  getReadiness(): Promise<PredictionReadiness>;
  listGamesWithPredictions(): Promise<GameWithScore[]>;
  getSettings(): Promise<PredictionSettings>;
  updateSettings(patch: Partial<PredictionSettings>): Promise<PredictionSettings>;
}
```

`PredictedGameResult` is `{ game: Game; score: FitnessResult; tension: RevealedPreferenceTension | null }`.

The service depends on `StorageService`, `FitnessService`, and `TournamentService`. It follows the `createPredictionService(deps)` factory pattern.

**`predictGame` flow**:

1. Load the target game and its BGG data.
2. Load all games in the collection. Load all axes.
3. Build the vocabulary from all games.
4. Encode feature vectors for all games.
5. Build `ReferenceGameCandidate[]` from games that have at least one personal axis rating and BGG data.
6. Load tournament stats via `TournamentService`. Read `provisionalThreshold` from `TournamentService.getSettings()` (not from `PredictionSettings`). Populate `tournamentStability` on each candidate using: for games with `comparisonCount >= provisionalThreshold`, factor = `1.0 + predictionSettings.tournamentStabilityBoost * min(comparisonCount / provisionalThreshold, 1.0)`. Otherwise `1.0`. When no tournament data exists, all candidates get `1.0` (REQ-PRED-18).
7. Load prediction settings. Compute readiness stage from rated game count.
8. Call `computePredictedFitness` from the prediction engine, passing settings and readiness stage.
9. If Stage 0, strip predicted personal axis entries from the breakdown but preserve BGG-derived actual entries (REQ-PRED-22). The response clearly indicates personal-axis prediction is not yet available and how many more rated games are needed.
10. The `readinessStage` is included in `PredictionMeta` so clients can derive the "experimental" marker at render time (REQ-PRED-19) without a second API call.
11. Call `detectRevealedPreferenceTension` if tournament data exists.
12. Return the combined result.

**`listGamesWithPredictions` flow**:

1. Load all games with actual scores (existing `gameService.listGames()`).
2. For games where `score === null` or `score` has fewer rated axes than total axes, run prediction.
3. Return the combined list with predicted scores filling gaps.

#### Routes

`POST /api/predictions/:gameId` (or `GET`) -- returns `PredictedGameResult`. 404 if game not found. Returns actual fitness with `predictionMeta: null` if all axes are rated.

`GET /api/predictions/readiness` -- returns `PredictionReadiness`.

`GET /api/predictions/settings` -- returns `PredictionSettings`. Note: settings endpoints are not required by the spec but are included for future tooling (e.g., [STUB: prediction-tuning]). If they ship without a consumer, consider deferring them.

`PATCH /api/predictions/settings` -- updates prediction settings (stage thresholds, k, similarity threshold).

The existing `GET /api/games` route gains `?includePredicted=true`. When enabled, calls `predictionService.listGamesWithPredictions()` instead of `gameService.listGames()`.

#### Storage extension

`StorageService` gains `loadPredictionSettings(): Promise<PredictionSettings>` and `savePredictionSettings(settings: PredictionSettings): Promise<void>`. Default settings returned when file doesn't exist: `{ stageThresholds: [5, 15, 30], defaultK: 5, minSimilarityThreshold: 0.2, tournamentStabilityBoost: 0.2 }`.

**Depends on**: Phases 1, 2, 3 (all engines).

**Verification**:

- `GET /api/predictions/:gameId` returns a predicted fitness result with breakdown showing predicted and actual entries.
- A fully-rated game returns actual fitness with `predictionMeta: null`.
- A game without BGG data returns an appropriate error message.
- `GET /api/predictions/readiness` returns correct stage, rated count, weak axes, and suggested actions.
- `GET /api/games?includePredicted=true` returns predicted scores for games that would otherwise have `score: null`.
- `GET /api/games` (without parameter) behaves identically to before (no prediction).
- Prediction settings persist and apply correctly.
- Typecheck clean. `bun run lint` clean.

**Reqs covered**: REQ-PRED-3, 23, 24, 25.

---

### Phase 5: Web UI

**What changes**: Display predicted scores in the game detail view and collection list. Show confidence levels, reference games, revealed preference tension, and prediction readiness. Visually distinguish predicted from actual scores.

**Files modified**:

- `packages/web/lib/api.ts` -- add prediction API calls
- `packages/web/app/games/[id]/page.tsx` -- predicted score display, confidence, reference games, tension
- `packages/web/components/collection-table.tsx` -- predicted score column, sort by predicted fitness
- `packages/web/components/score-breakdown.tsx` -- predicted axis entries with confidence badges
- `packages/web/app/globals.css` -- prediction visual treatment styles
- `packages/web/lib/collection-utils.ts` (line 155) -- the `ratedStatus === "rated"` filter checks `score === null`. When `includePredicted` is active, a predicted-only game has `score !== null` but `ratedAxisCount === 0`. This filter must check `predictionMeta` to correctly classify predicted-only games as "unrated" for filter purposes.
- `packages/web/app/page.tsx` (line 33) -- the average fitness computation filters by `score !== null`. With predictions enabled, predicted-only scores should not be mixed into the "actual" average. Check `predictionMeta === null` (or `ratedAxisCount > 0`) before including in the average.

#### Web API additions

Add to `packages/web/lib/api.ts`:

- `predictGame(id: string): Promise<PredictedGameResult>` -- calls `GET /api/predictions/{id}`
- `getReadiness(): Promise<PredictionReadiness>` -- calls `GET /api/predictions/readiness`
- `listGamesWithPredictions(): Promise<GameWithScore[]>` -- calls `GET /api/games?includePredicted=true`

#### Game detail view

The game detail page already shows the fitness breakdown. For games with predicted axes:

- Each predicted axis entry shows a confidence badge (strong/moderate/weak) next to the rating. The badge is a small pill with text and background color distinguishing confidence levels.
- Clicking or hovering over a predicted rating reveals the reference games: a list of game name + similarity score, matching the spec's example ("predicted 7.2 based on Azul (0.87, rated 8), Patchwork (0.81, rated 7)").
- The overall score section shows "Predicted" label when `predictionMeta` is non-null.
- When `RevealedPreferenceTension` is present, a separate section shows both numbers with context (REQ-PRED-28).

The visual distinction between predicted and actual: predicted scores use a dashed border or different background tint (implementation decision for the implementer, but the distinction must be unambiguous per REQ-PRED-14).

#### Collection list

The `CollectionTable` gains a toggle or option to include predicted scores. When enabled:

- The page fetches from `listGamesWithPredictions()` instead of `listGames()`.
- Games with predicted scores show the prediction visual marker in the score column.
- Sorting by fitness treats predicted and actual scores equally for ordering, but the visual marker prevents confusion.
- The prediction readiness stage is shown in a small status indicator (location is an implementation decision, likely near the stats strip or as a banner at Stage 0/1).
- At Stages 0 and 1, suggested actions from readiness are displayed to guide the user.

#### CSS

New CSS classes for prediction visual treatment:

- `.predicted-score` -- visual distinction (dashed border, tinted background, or similar)
- `.confidence-badge`, `.confidence-strong`, `.confidence-moderate`, `.confidence-weak` -- confidence level pills
- `.reference-games-tooltip` or `.reference-games-panel` -- expandable reference game list
- `.prediction-tension` -- revealed preference tension section
- `.prediction-readiness` -- readiness stage indicator
- `.experimental-marker` -- Stage 1 experimental label

**Depends on**: Phase 4 (API endpoints).

**Verification**:

- Game detail shows predicted scores visually distinct from actual scores.
- Confidence badges appear on predicted axes.
- Reference games are visible on click/hover for predicted axes.
- Revealed preference tension is shown when present, not shown when absent.
- Collection list can toggle predictions on/off.
- Collection list sorted by predicted fitness includes predicted scores.
- Prediction readiness stage is visible. At Stages 0/1, suggested actions appear.
- `collection-utils.ts` `ratedStatus` filter correctly classifies predicted-only games (score non-null, ratedAxisCount 0) as "unrated."
- `app/page.tsx` average fitness computation excludes predicted-only scores from the "actual" average.
- Typecheck clean.

**Reqs covered**: REQ-PRED-14, 26, 27, 28, 29.

---

### Phase 6: CLI

**What changes**: Add `predict` command with subcommands. Extend `scores` command with `--include-predicted` flag.

**Files created**:

- `packages/cli/src/commands/predict.ts` -- predict and readiness commands
- `packages/cli/tests/commands/predict.test.ts`

**Files modified**:

- `packages/cli/src/index.ts` -- register predict commands in COMMANDS map
- `packages/cli/src/commands/score.ts` -- add `--include-predicted` flag
- `packages/cli/src/output.ts` -- update `BreakdownEntry` type alias if needed for predicted fields

#### Commands

`shelf-judge predict <game-id>` (and alias `sj predict <game-id>`):

- Calls `GET /api/predictions/{gameId}`.
- Displays the predicted fitness breakdown: each axis with source (actual/predicted), confidence level, and rating value.
- For predicted axes, lists reference games with similarity scores.
- Shows overall prediction metadata (predicted vs. actual count, coverage).
- Shows revealed preference tension if present.
- `--json` outputs the raw API response.

`shelf-judge predict readiness` (and alias `sj predict readiness`):

- Calls `GET /api/predictions/readiness`.
- Displays stage, rated game count, next stage threshold, weak axes, and suggested actions.
- `--json` outputs the raw API response.

`shelf-judge scores --include-predicted` (applies to the list variant `scoreList`, not the single-game `scoreGet`):

- Calls `GET /api/games?includePredicted=true` and formats as a ranked list.
- Predicted scores show a `[P]` marker in the table.
- `--json` outputs the full response.

**Depends on**: Phase 4 (API endpoints).

**Verification**:

- `sj predict <game-id>` shows breakdown with predicted axes, confidence, reference games, and overall metadata.
- `sj predict readiness` shows stage, counts, weak axes, and suggested actions.
- `sj scores --include-predicted` includes predicted scores with visual marker.
- All three commands support `--json`.
- Typecheck clean. `bun run lint` clean.

**Reqs covered**: REQ-PRED-30, 31, 32.

---

### Phase 7: Tests and Final Verification

**What changes**: Run full test suite, typecheck, and lint. Verify all success criteria from the spec. Perform code review.

**Files modified**: None (test-only phase).

#### Full verification checklist (from spec success criteria)

Automated tests:

1. Feature vector encoding: correct binary flags, correct normalization for weight (1-5 to 0-1) and community rating (1-10 to 0-1).
2. Cosine similarity: 1.0 for identical, 0.0 for orthogonal, correct partial overlap.
3. k-NN estimation with k=5: similarity-weighted average of 5 most similar games' ratings on a given axis.
4. k-NN excludes reference games lacking a rating on the target axis.
5. BGG-derived axes with curves: "actual" confidence.
6. Confidence levels at exact thresholds.
7. Insufficient-confidence axes excluded from predicted score.
8. Vetoes fire on BGG-derived values, not on predicted personal values.
9. Tournament stability weighting: higher effective similarity for stable games.
10. Revealed preference tension: surfaced at > 1.0, not surfaced at <= 1.0.
11. Readiness stages gate output correctly.
12. Custom stage thresholds respected.
13. PredictionMeta reports correct counts and coverage.
14. Predicted fitness uses same weighted average formula as actual fitness.
15. Games without BGG data: clear error, not empty/zero result.

Manual verification (demonstration):

1. Add a game via BGG search, unrated on all personal axes. View detail page: predicted scores with confidence and reference games.
2. Rate that game. Compare predicted score to actual. Flag if off by > 3 on most axes.
3. Collection list with predictions: predicted and actual visually distinct.
4. With tournament data: game showing tension between predicted fitness and tournament cluster.
5. CLI: `sj predict <id>` matches web UI breakdown.
6. CLI: `sj predict readiness` shows correct stage and actions.

**Depends on**: All previous phases.

**Verification**: `bun run test`, `bun run typecheck`, `bun run lint` all clean. Launch a code review sub-agent with fresh context to verify implementation against spec.

**Reqs covered**: Verification of all 37 requirements.

## Delegation Guide

All seven phases are assigned to **Dalton** (implementation). Phases 1-3 are the engine layers (pure math, heavily tested). Phases 4-6 are the integration layers (service, API, clients). Phase 7 is verification.

**Review gates**:

- After Phase 3: invoke **Thorne** (review) to check the engine implementation against the spec's core math requirements (REQ-PRED-1 through REQ-PRED-18). The engines are the hardest code to fix retroactively.
- After Phase 6: invoke **Thorne** (review) to check the full implementation against all 37 spec requirements before the final verification phase.
- Phase 7 includes a fresh-context sub-agent review as its primary deliverable.

Phases are sequential. Each depends on the previous, except Phases 5 and 6 (web and CLI) which are independent of each other and can run in parallel after Phase 4.

## Risk Notes

1. **Feature vector performance at scale.** REQ-PRED-36 says no caching preemptively. For a 100-game collection with ~50 unique mechanics and ~20 categories, each prediction requires building the vocabulary, encoding all vectors, and computing ~100 cosine similarities. This is sub-millisecond math. The risk is the collection list with predictions (REQ-PRED-24): computing predictions for every unrated game multiplies by the number of unrated games. For a 200-game collection with 150 rated and 50 unrated, that's 50 \* 150 = 7,500 similarity computations. Still fast, but worth monitoring. If it becomes slow, the vocabulary and reference vectors can be cached and invalidated on collection change (REQ-PRED-37).

2. **FitnessResult backward compatibility.** The `predictionMeta` field is nullable and additive, so existing consumers are safe. The one risk is the `?includePredicted=true` collection list: clients that previously assumed `score === null` means "unscored" will now see non-null scores with `ratedAxisCount: 0`. The web `CollectionTable` and CLI `scoreList` must check `predictionMeta` to distinguish predicted-only from fully-actual results. This is called out in the spec (REQ-PRED-35) and must be verified in Phase 7.

3. **Client/daemon divergence.** This is the most common bug class in this project (per operational notes). When the prediction type extensions land in shared, every client rendering path that reads `FitnessBreakdownEntry` or `FitnessResult` must handle the new nullable fields gracefully. Grep for all consumers of these types at the start of Phase 5 and Phase 6 to catch any that would break with the new shape.

4. **Prediction readiness suggested actions.** The suggested actions (REQ-PRED-20) require identifying underrepresented mechanic/category clusters. The logic needs the vocabulary, the set of rated games per mechanic, and the set of all games per mechanic. This is the most complex part of the readiness computation. If it proves too complex for the initial implementation, the suggested actions can be simplified to "Rate more games" with mechanic-specific suggestions as a follow-up.

5. **Web component size.** The game detail page will grow with prediction display, confidence badges, reference game panels, and tension sections. If the page exceeds ~300 lines, extract prediction-specific display into a sub-component (e.g., `PredictionBreakdown`). The `CollectionTable` already has a lot of responsibility; the prediction toggle should be a simple prop, not a structural change.

## Open Questions

1. **Tournament stability boost value.** The plan proposes 0.2 (20% max boost). This is a calibration constant. The right value depends on how tournament data density correlates with rating reliability in the actual collection. Start with 0.2, adjust based on Phase 7 manual verification.

2. **Minimum similarity threshold behavior at 0.2.** The spec says 0.2 is the floor. If most cosine similarities in the actual collection cluster above 0.5, then 0.2 is generous (many neighbors qualify). If similarities are lower (diverse collection with little mechanic overlap), the threshold may need raising. Calibrate during Phase 2 testing with the actual 200-game collection if available.

3. **Prediction route method.** The plan proposes `GET /api/predictions/:gameId` for prediction. `GET` is idempotent and appropriate since prediction is a read-only computation. However, if the vocabulary building or vector encoding becomes expensive, `POST` with a cache key would be more conventional for "expensive read" operations. Start with `GET`; reconsider if performance monitoring shows it's too expensive for repeated calls.
