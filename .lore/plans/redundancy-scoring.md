---
title: "Implementation plan: redundancy-scoring"
date: 2026-04-12
status: executed
tags: [plan, redundancy, fitness, scoring, collection-awareness]
modules: [shared, daemon, web, cli]
related:
  - .lore/specs/redundancy-scoring.md
  - .lore/plans/niche-tag-filtering.md
  - .lore/specs/niche-champion-display.md
  - .lore/designs/mvp-fitness-model.md
---

# Plan: Redundancy Scoring

## Goal

Implement the redundancy scoring penalty specified in `.lore/specs/redundancy-scoring.md` (REQ-REDUN-1 through REQ-REDUN-41). The feature adds pairwise cosine-similarity-based redundancy penalties to the fitness scoring pipeline, with a three-stage graduated engagement model: disabled (default), annotation (what-if penalties shown alongside unmodified scores), and integrated (penalties applied to primary scores).

The implementation follows the established settings pattern (shared type, storage, CRUD API, clients) and the pure-function engine pattern (no I/O, no service dependencies). The redundancy engine is a new module that operates as a post-processing step on computed fitness scores.

## Codebase Context

### Settings Pattern (PredictionSettings)

Three layers, well-established:

1. **Shared type**: `PredictionSettings` at `packages/shared/src/types.ts:400-405`. Numeric fields with documented defaults.
2. **Storage**: `StorageService` interface exposes `loadPredictionSettings()` / `savePredictionSettings()` (`storage-service.ts:28-29`). Implementation at lines 180-193 reads/writes `prediction-settings.json` in `~/.shelf-judge/data/`. Returns defaults when file doesn't exist. Full object overwrite on save.
3. **API**: `GET /predictions/settings` returns settings. `PATCH /predictions/settings` merges partial update, validates, persists (`prediction.ts:28-58`).
4. **Defaults**: `DEFAULT_PREDICTION_SETTINGS` constant exported from `prediction-engine.ts`, imported by storage service.

`NicheSettings` follows this exact pattern (`storage-service.ts:195-208`, `niche-engine.ts:17`). `RedundancySettings` will be the third instance.

### Engine Pattern (niche-engine.ts)

Pure-function modules at `packages/daemon/src/services/`. No service-layer dependencies, no I/O. Take scored games and settings as input, return computed results. Called from route handlers that load settings and pass them as parameters.

- `niche-engine.ts` (305 lines): `computeNichePositions(gamesWithScores, settings?)` at line 160. `computeNicheImpact(existing, candidate, score, settings?)` at line 235. Both take `GameWithScore[]` input.
- `prediction-engine.ts`: `computePredictedFitness()` at line 152. Takes game, axes, reference games, settings. Returns augmented `FitnessResult`.

### Feature Vector Module (feature-vector.ts)

Key types and functions the redundancy engine needs:

- `FeatureVector` (line 19): `{ binary: number[]; continuous: number[]; personalAxes: number[] | null }`
- `ComponentWeights` (line 25): `{ binary: number; continuous: number; personalAxes: number }` (already exported)
- `cosineSimilarity(a: number[], b: number[])` at line 315: Dot product / (|a| \* |b|). Operates on flat arrays.
- `encodeGame(game, vocabulary, axisRatings?, ranges?, axes?)` at line 110: Creates `FeatureVector` from a game's BGG data and ratings.
- `buildVocabulary(games)` at line 43: Builds mechanic/category vocabulary for binary encoding.
- `computeContinuousRanges(games)` at line 72: Min/max ranges for normalization.

The redundancy engine needs to flatten `FeatureVector` components into a single array with `componentWeights` applied, then call `cosineSimilarity` on those flat vectors. The flattening logic is new (not in feature-vector.ts today). It belongs in the redundancy engine because it's specific to the weighted-composite similarity computation.

### Fitness Computation Flow

1. `game-service.ts:listGames()` (line 159): Loads collection, computes fitness per game via `fitnessService.calculateScore()`, sorts descending. Returns `GameWithScore[]`.
2. `prediction-service.ts:listGamesWithPredictions()` (line 353): Wraps game service. For each game, computes actual fitness, augments with predictions where axes are unrated. Returns combined `GameWithScore[]` sorted by score.
3. Route handlers (`games.ts`, `prediction.ts`) call these methods, then optionally compute niche positions as a post-processing step.

The redundancy pass fits in this post-processing pattern: after scores are computed (by game service or prediction service), before results are returned. Route handlers load redundancy settings and call the engine.

### Game Detail Route (games.ts)

`GET /games/:id` at line 135: Calls `gameService.getGame(id)`, then computes niche positions from the full collection. Returns single `GameWithScore` with `nichePosition`. Per REQ-REDUN-21, the redundancy pass for a single game also requires all games' scores. The niche computation already does this (loads all games via `predictionService.listGamesWithPredictions()`), so the redundancy pass can piggyback on the same data.

`GET /games` at line 95: Two paths depending on `includePredicted`. Both compute games, then optionally compute niches. The redundancy pass would run on the same `GameWithScore[]` array.

### Prediction Route (prediction.ts)

`GET /predictions/bgg/:bggId` at line 61: Calls `predictionService.predictBggGame(bggId)`, then computes `nicheImpact` for the candidate. The redundancy preview (REQ-REDUN-22) would be computed here: temporarily include the candidate in the redundancy pass, extract its adjustment.

### Web Client (api.ts)

Client helpers at `packages/web/lib/api.ts`. Pattern: `export async function xxx(): Promise<Type> { return daemonJson(path, opts); }`. Currently has niche settings helpers (lines 248-271). Redundancy settings helpers follow the same shape.

### CLI Commands

Pattern at `packages/cli/src/commands/`: Each command is an async function taking `(client, args, opts)`, returning formatted string. `--json` flag returns raw JSON. Niche commands (`niche.ts`) demonstrate the CRUD settings pattern. Score commands (`score.ts`) demonstrate table formatting with optional columns.

### FitnessResult (types.ts:110-125)

Current fields: `score`, `ratedAxisCount`, `totalAxisCount`, `breakdown`, `vetoed`, `vetoedBy`, `hypotheticalScore`, `predictionMeta`. The spec adds one field: `redundancyAdjustment: RedundancyAdjustment | null` (REQ-REDUN-16).

### GameWithScore (types.ts:206-211)

Current fields: `game`, `score`, `bggDataStale?`, `nichePosition?`. No change needed for redundancy because the adjustment lives inside `FitnessResult`.

## Implementation Steps

### Phase 1: Shared Types and Defaults

**Files**: `packages/shared/src/types.ts`
**Depends on**: nothing
**Covers**: REQ-REDUN-1, REQ-REDUN-2, REQ-REDUN-14, REQ-REDUN-15, REQ-REDUN-16

Add after the niche types (line 476):

```typescript
// Redundancy scoring types (redundancy-scoring spec)

interface RedundancyNeighbor {
  gameId: string;
  gameName: string;
  similarity: number;
  fitnessScore: number;
  isPredicted: boolean;
}

interface RedundancyAdjustment {
  penalty: number;
  originalScore: number;
  adjustedScore: number;
  nicheNeighbors: RedundancyNeighbor[];
  nicheRank: number;
  nicheSize: number;
}

interface RedundancySettings {
  enabled: boolean;
  stage: "annotation" | "integrated";
  similarityThreshold: number;
  maxPenalty: number;
  componentWeights: ComponentWeights;
  minNeighbors: number;
}
```

The `ComponentWeights` type is already defined in `feature-vector.ts` but not exported from `types.ts`. It needs to be re-exported (or the type duplicated) so that `RedundancySettings` can reference it in the shared package. Two options:

- **Option A**: Duplicate the type in `types.ts`. Simple, no cross-package dependency issues.
- **Option B**: Move `ComponentWeights` from `feature-vector.ts` to `types.ts` and have `feature-vector.ts` import from shared.

**Decision**: Option A. `ComponentWeights` is three fields. Duplicating avoids changing imports across the feature-vector module and its consumers. The spec already assumes it's in `types.ts` (REQ-REDUN-1).

Add `redundancyAdjustment: RedundancyAdjustment | null` to `FitnessResult` (after `predictionMeta` at line 124). Must be nullable. Default `null` in all fitness computation paths.

Export all new types.

**Verification**: `bun run typecheck` passes. All existing code that constructs `FitnessResult` objects now needs to include `redundancyAdjustment: null`. This will surface as type errors. Fix each constructor site (fitness-service.ts, prediction-engine.ts) in this phase.

### Phase 2: Storage Layer

**Files**: `packages/daemon/src/services/storage-service.ts`
**Depends on**: Phase 1 (types exist)
**Covers**: REQ-REDUN-3

**2a: Default constant.** The defaults will be exported from the redundancy engine (Phase 3), but the storage service needs them at load time. Temporarily define `DEFAULT_REDUNDANCY_SETTINGS` inline in `storage-service.ts`, or define it in a small constants file. The cleaner path is to define it in the engine module (Phase 3) and have Phase 2 and Phase 3 as a single commit. Since the niche-tag-filtering plan combined storage + engine in adjacent phases, follow that precedent.

**Decision**: Define defaults in `redundancy-engine.ts` (Phase 3). Phase 2 and Phase 3 are implemented together so the import is available. The storage service imports `DEFAULT_REDUNDANCY_SETTINGS` from `redundancy-engine.ts`, matching the pattern at `storage-service.ts:16-17`.

**2b: Storage interface.** Add to `StorageService` interface (after `saveNicheSettings` at line 31):

```typescript
loadRedundancySettings(): Promise<RedundancySettings>;
saveRedundancySettings(settings: RedundancySettings): Promise<void>;
```

**2c: Storage implementation.** In `createStorageService()`, add methods following the prediction settings pattern (`storage-service.ts:180-193`):

- File: `redundancy-settings.json` in the data directory
- Load returns `{ ...DEFAULT_REDUNDANCY_SETTINGS }` when file doesn't exist
- Save writes full object via `atomicWrite`

**Verification**: Unit test: `loadRedundancySettings()` returns defaults when no file exists. `saveRedundancySettings()` writes and subsequent load returns saved values.

### Phase 3: Redundancy Engine

**Files**: new file `packages/daemon/src/services/redundancy-engine.ts`
**Depends on**: Phase 1 (types)
**Covers**: REQ-REDUN-6 through REQ-REDUN-13

This is the core computation module. Pure functions, no I/O.

**3a: Default constant.**

```typescript
export const DEFAULT_REDUNDANCY_SETTINGS: RedundancySettings = {
  enabled: false,
  stage: "annotation",
  similarityThreshold: 0.6,
  maxPenalty: 2.0,
  componentWeights: { binary: 0.4, continuous: 0.3, personalAxes: 0.3 },
  minNeighbors: 1,
};
```

**3b: Weighted flattening helper.** The engine needs to flatten a `FeatureVector` into a single `number[]` with component weights applied. This is not a general-purpose utility; it's specific to the redundancy similarity computation.

```typescript
function flattenWeighted(vec: FeatureVector, weights: ComponentWeights): number[] {
  const totalWeight = weights.binary + weights.continuous + weights.personalAxes;
  const bw = Math.sqrt(weights.binary / totalWeight);
  const cw = Math.sqrt(weights.continuous / totalWeight);
  const pw = Math.sqrt(weights.personalAxes / totalWeight);

  const flat: number[] = [];
  for (const v of vec.binary) flat.push(v * bw);
  for (const v of vec.continuous) flat.push(v * cw);
  if (vec.personalAxes) {
    for (const v of vec.personalAxes) flat.push(v * pw);
  }
  return flat;
}
```

Using `Math.sqrt` of the normalized weight means the dot product (which cosine similarity is based on) produces a result where each component's contribution is proportional to its weight. This is standard weighted cosine similarity.

When `personalAxes` is null (game has no ratings), the personal axes component is omitted from the flat vector. Two games both without axes: similarity is computed on binary + continuous only. One game with axes and one without: the axes dimensions are present in one vector but not the other. This creates a dimension mismatch for `cosineSimilarity()`.

**Handling dimension mismatch**: When comparing two games where one has `personalAxes` and the other doesn't, pad the shorter vector with zeros. Alternatively, only include personalAxes dimensions when both games have them. The second approach is cleaner: if either game lacks ratings, compare only on binary + continuous. This avoids penalizing unrated games for having zero similarity on axes they haven't rated.

**Decision**: When comparing two games, use the intersection of non-null components. If either game's `personalAxes` is null, both flat vectors omit the personalAxes portion and redistribute weight to binary + continuous. This means `flattenWeighted` needs to know whether to include personalAxes. Signature:

```typescript
function flattenWeighted(
  vec: FeatureVector,
  weights: ComponentWeights,
  includePersonalAxes: boolean,
): number[];
```

**3c: Primary function.**

```typescript
export function computeRedundancyAdjustments(
  gamesWithScores: GameWithScore[],
  settings: RedundancySettings,
  getFeatureVector: (game: Game) => FeatureVector,
): Map<string, RedundancyAdjustment>;
```

Algorithm (per REQ-REDUN-8):

1. Filter to non-vetoed games with `score > 0` and non-null `score`.
2. For each eligible game, get its feature vector via `getFeatureVector`.
3. Build pairwise flat vectors. For each pair, determine whether both have personalAxes; flatten accordingly.
4. Compute cosine similarity for each pair. Cache results (symmetric: `sim(A,B) = sim(B,A)`).
5. For each game, collect niche neighbors (similarity >= threshold).
6. If `neighbors.length < minNeighbors`, skip (no adjustment).
7. Count `betterNeighbors`: neighbors with strictly higher fitness score. Ties (within 0.01 per REQ-REDUN-10) don't count. Fully-predicted neighbors don't count against actual-scored games (REQ-REDUN-12).
8. `coverageRatio = betterNeighbors / nicheNeighborCount`.
9. `penalty = coverageRatio * maxPenalty`.
10. `adjustedScore = max(1.0, originalScore - penalty)`.
11. Build `RedundancyAdjustment` with sorted neighbors (similarity descending), nicheRank, nicheSize.

**Tie detection (REQ-REDUN-10)**: Scores are compared at two decimal places: `Math.round(a * 100) === Math.round(b * 100)`. This differs from the niche engine's one-decimal-place precision. The redundancy spec explicitly says "equal to two decimal places."

**Predicted game authority (REQ-REDUN-12)**: When determining `betterNeighbors` for an actual-scored game, skip any neighbor where `predictionMeta?.actualAxisCount === 0`. The predicted game still appears in the neighbor list (it's a niche neighbor by similarity), it just doesn't contribute to the penalty calculation for actual-scored games.

**3d: Unit tests.** New file `packages/daemon/tests/redundancy-engine.test.ts`. Hand-constructed test collection of 6-8 games with known feature vectors and known fitness scores. Test cases from the spec's AI Validation section:

- Returns empty map when `settings.enabled` is false (short-circuit)
- No neighbors above threshold: null adjustment
- Fewer neighbors than `minNeighbors`: null adjustment
- Highest-scoring game: zero penalty (falls out of formula)
- Penalty proportional to coverageRatio
- Score floor at 1.0
- Tied games don't count as "better"
- Vetoed games excluded entirely
- Predicted games don't penalize actual-scored games
- Predicted games are penalized by actual-scored neighbors normally
- `componentWeights` influence similarity
- `similarityThreshold` changes neighbor set
- Neighbors sorted by similarity descending
- Deterministic output

**Verification**: `bun test packages/daemon/tests/redundancy-engine.test.ts` passes. 90%+ coverage on the engine module.

### Phase 4: Daemon Routes

**Files**: new file `packages/daemon/src/routes/redundancy.ts`, `packages/daemon/src/app.ts`
**Depends on**: Phase 2 (storage), Phase 3 (engine + defaults)
**Covers**: REQ-REDUN-4, REQ-REDUN-5, REQ-REDUN-30

**4a: CRUD routes.** Create `packages/daemon/src/routes/redundancy.ts` following the niche route pattern (`routes/niche.ts`):

```typescript
export interface RedundancyRoutesDeps {
  storageService: StorageService;
}
```

Endpoints:

- `GET /redundancy/settings`: Load and return `RedundancySettings`.
- `PATCH /redundancy/settings`: Parse body, merge with current settings, validate, persist.

Validation (REQ-REDUN-4):

- `similarityThreshold` in [0.0, 1.0]
- `maxPenalty` in [0.5, 5.0]
- `componentWeights` values all >= 0, sum > 0
- `minNeighbors` >= 1
- `stage` is "annotation" or "integrated"
- `enabled` is boolean

Invalid values return 400 with descriptive message naming the invalid field and constraint.

**4b: Register routes.** In `app.ts`, import `createRedundancyRoutes`, create with `{ storageService }`, wire with `app.route("/api", redundancyRouteModule.routes)`. Add after the niche route registration.

**4c: Operation definitions.** Add `OperationDefinition[]` for the two endpoints with `hierarchy: { root: "shelf", feature: "redundancy" }`.

**4d: Route tests.** New file `packages/daemon/tests/redundancy-settings-routes.test.ts`:

- GET returns defaults when no file exists
- PATCH validates all range constraints (test each boundary)
- PATCH merges partial updates correctly
- PATCH rejects invalid `stage` values
- PATCH validates `componentWeights` sum > 0

**Verification**: `bun test packages/daemon/tests/redundancy-settings-routes.test.ts` passes.

### Phase 5: Game Route Integration

**Files**: `packages/daemon/src/routes/games.ts`, `packages/daemon/src/routes/prediction.ts`, `packages/daemon/src/services/prediction-service.ts`
**Depends on**: Phase 3 (engine), Phase 4 (settings storage)
**Covers**: REQ-REDUN-5, REQ-REDUN-17 through REQ-REDUN-24, REQ-REDUN-26, REQ-REDUN-28, REQ-REDUN-29

This is the most complex phase. The redundancy pass must integrate into three route handlers without modifying the fitness formula or the niche computation.

**5a: Feature vector provider.** The redundancy engine takes a `getFeatureVector` callback (REQ-REDUN-7). The route handlers need to build this callback using the collection's vocabulary, ranges, and axes. The prediction service's `loadPredictionContext()` (prediction-service.ts:58-168) already builds vocabulary, ranges, and axes. The route handler can either:

- Call `loadPredictionContext()` and use its vocabulary/ranges/axes to build a `getFeatureVector` callback.
- Build vocabulary/ranges inline.

**Decision**: The prediction service already exposes `listGamesWithPredictions()` which loads the full context. The route handlers already call this method for niche computation. To avoid duplicating context loading, extract a helper that the route handler can use to build the `getFeatureVector` callback. The cleanest approach: add a method to prediction service that returns the feature vector infrastructure (vocabulary, ranges, axes). Or: have the route handler load collection + axes, build vocabulary + ranges, and construct the callback inline.

The second approach keeps the redundancy computation in the route handler, consistent with how niche computation works today (route handler calls pure engine function). The prediction service doesn't need to know about redundancy.

```typescript
// In the route handler:
const collection = await gameService.loadCollection();
const vocabulary = buildVocabulary(collection.games.filter((g) => g.bggData));
const ranges = computeContinuousRanges(collection.games.filter((g) => g.bggData));
const getFeatureVector = (game: Game) =>
  encodeGame(game, vocabulary, game.ratings, ranges, collection.axes);
```

Wait: `gameService` doesn't expose `loadCollection()`. The game routes work through `gameService.listGames()` which returns `GameWithScore[]`, not the raw collection. And the prediction routes work through `predictionService.listGamesWithPredictions()`.

The route handler needs axes and games to build the vocabulary and encode. The `GameWithScore[]` array has the games. The axes need to come from somewhere. Options:

1. Add `storageService.loadCollection()` call in the route handler to get axes.
2. Expose axes through a service method.
3. Use `predictionService.listGamesWithPredictions()` which already has access to axes internally.

The game service's `listGames()` internally loads the collection (which has axes). But it doesn't expose axes to the caller. The route handler would need either (a) a separate load of axes/collection, or (b) a helper on the game/prediction service.

**Decision**: The route handlers already have access to `storageService` (via deps). Call `storageService.loadCollection()` to get axes. This is one extra file read per request, but the collection is the same file the game service reads. For the game routes, the collection is loaded twice (once by gameService, once by the route handler). Acceptable for correctness; caching is explicitly deferred per spec.

For the prediction routes, `predictionService.listGamesWithPredictions()` already loads everything. The route handler additionally needs axes. Same approach: load collection from storage.

**5b: GET /games integration.** After computing `GameWithScore[]` (and optionally niche positions), if redundancy is enabled:

1. Load `RedundancySettings` from storage.
2. If `settings.enabled` is false, ensure all `FitnessResult.redundancyAdjustment` are null (they already are from Phase 1). Done.
3. Load collection for axes. Build vocabulary, ranges, `getFeatureVector` callback.
4. Call `computeRedundancyAdjustments(games, settings, getFeatureVector)`.
5. For each game, set `score.redundancyAdjustment` from the map (null if not present).
6. If `settings.stage === "integrated"`, update `score.score` to `adjustment.adjustedScore` for each game with an adjustment.

The niche computation uses pre-redundancy scores (REQ-REDUN-26). This means: compute niches first, then apply redundancy. The current code already computes niches after listing games. The redundancy pass goes after niches.

**5c: GET /games/:id integration.** Same pattern. The route handler already loads all games (for niche positions). After niche computation, run the redundancy pass on all games, then extract the single game's result.

**5d: GET /predictions/bgg/:bggId integration.** After computing the candidate's prediction and niche impact, compute redundancy preview (REQ-REDUN-22):

1. Load redundancy settings. If disabled, set `redundancyPreview: null`.
2. Load all games (already done for niche impact: `allGames`).
3. Create a temporary `GameWithScore` for the candidate.
4. Run `computeRedundancyAdjustments([...allGames, candidateGws], settings, getFeatureVector)`.
5. Extract the candidate's adjustment as `redundancyPreview`.

Per REQ-REDUN-23, the preview uses pre-redundancy scores for existing games. Since we include all existing games in the pass, their penalties are computed too, but we discard them. The candidate's penalty is computed against the original scores because the engine reads `score.score` which at this point is the pre-redundancy value.

**5e: PredictedGameResponse extension.** Add `redundancyPreview: RedundancyAdjustment | null` to the `PredictedGameResponse` type in `types.ts` (line 413-419). This is a shared type, so web and CLI get it automatically.

**5f: Tests.** Add integration tests to the existing route test files:

- `GET /games/:id` includes `redundancyAdjustment` when enabled, null when disabled
- `GET /games` includes adjustments on all games when enabled
- Annotation mode: `score.score` unchanged, `redundancyAdjustment.adjustedScore` reflects penalty
- Integrated mode: `score.score` equals `adjustedScore`
- `GET /predictions/bgg/:bggId` includes `redundancyPreview` when enabled
- NichePosition rankings use pre-redundancy scores in integrated mode

**Verification**: `bun test packages/daemon/tests/` passes. Typecheck clean.

### Phase 6: Web Client Helpers

**Files**: `packages/web/lib/api.ts`
**Depends on**: Phase 4 (routes exist)
**Covers**: Part of REQ-REDUN-30

Add after the niche settings helpers (line 271):

```typescript
import type { RedundancySettings } from "@shelf-judge/shared";

export async function getRedundancySettings(): Promise<RedundancySettings> {
  return daemonJson("/api/redundancy/settings");
}

export async function updateRedundancySettings(
  patch: Partial<RedundancySettings>,
): Promise<RedundancySettings> {
  return daemonJson("/api/redundancy/settings", {
    method: "PATCH",
    body: patch,
  });
}
```

Re-export `RedundancySettings`, `RedundancyAdjustment`, `RedundancyNeighbor` from the type re-exports section (line 274-293).

**Verification**: Typecheck passes. No runtime test needed; these are thin wrappers.

### Phase 7: Web UI - Game Detail

**Files**: `packages/web/app/games/[id]/page.tsx`
**Depends on**: Phase 5 (data available), Phase 6 (helpers available)
**Covers**: REQ-REDUN-31, REQ-REDUN-32, REQ-REDUN-33

The game detail page already has a `NichePositionPanel` component. Add a `RedundancyPanel` component below it (or above it, depending on visual hierarchy; redundancy is more directly score-related so above niches is more natural).

**7a: RedundancyPanel component.** Renders when `score.redundancyAdjustment` is non-null.

- Shows penalty, original score, adjusted score.
- Shows niche rank ("3rd of 5 similar games").
- Lists niche neighbors with name (linked to game detail page), similarity percentage, and fitness score.
- In annotation mode: label section "Redundancy (preview)", show "Would be X.X with redundancy applied."
- In integrated mode: label section "Redundancy", show "Fitness: X.X (was Y.Y, -Z.Z redundancy)".
- Zero penalty: "Best among similar games" with neighbor list.

The panel needs to know the current stage. Two approaches:

- Load redundancy settings in the page component and pass `stage` to the panel.
- Infer from the data: if `score.score === adjustment.adjustedScore`, it's integrated mode. If `score.score === adjustment.originalScore`, it's annotation mode.

**Decision**: Infer from the data. The panel doesn't need a separate settings fetch. If `score.score` differs from `adjustment.originalScore`, integrated mode is active. This is correct because in annotation mode, `score.score` is unchanged and equals `adjustment.originalScore`.

**7b: Score display modification.** In integrated mode, the primary score display already shows the adjusted score (the daemon returns it that way). No change needed to the primary score display. The panel provides the "was X.X" context.

**Verification**: Manual verification against the spec's criteria. Automated tests for the panel rendering aren't strictly required (the spec doesn't mandate component-level tests), but a smoke test that the page renders with redundancy data without crashing is valuable.

### Phase 8: Web UI - Collection List

**Files**: `packages/web/app/collection/page.tsx`
**Depends on**: Phase 5 (data available), Phase 6 (helpers)
**Covers**: REQ-REDUN-34, REQ-REDUN-35

**8a: Sort option.** Add "Redundancy-Adjusted" to the sort options. When selected, sort by `score.redundancyAdjustment?.adjustedScore` descending (games without adjustments sort by regular score). In integrated mode, the default fitness sort already uses adjusted scores, but the option remains.

**8b: Penalty badge.** On each game row, when the game has a non-null `redundancyAdjustment` with `penalty > 0`, show a compact badge (e.g., "-1.5"). In annotation mode, style the badge as advisory (lighter, parenthesized). In integrated mode, style as applied.

The stage inference (annotation vs integrated) uses the same logic as Phase 7: compare `score.score` to `adjustment.originalScore`.

**Verification**: Manual verification. The collection page already has sort options; adding one follows the existing pattern.

### Phase 9: Web UI - Search Preview

**Files**: `packages/web/app/search/page.tsx`
**Depends on**: Phase 5 (data available)
**Covers**: REQ-REDUN-36

The search preview panel already shows predicted fitness and niche impact. Add redundancy preview below.

When `redundancyPreview` is non-null:

- Show "With redundancy: X.X (-Y.Y)".
- List top 3 most similar existing games by similarity.
- When no neighbors: "No similar games in collection."

When `redundancyPreview` is null (redundancy disabled or no neighbors): omit the section.

**Verification**: Manual verification with a search that has similar games in the collection.

### Phase 10: Web UI - Settings Panel

**Files**: `packages/web/app/` (new settings component or section)
**Depends on**: Phase 6 (API helpers)
**Covers**: REQ-REDUN-41

The spec says location is "to be determined by the implementer, likely the settings or preferences area." Check whether a settings page exists.

If no settings page exists, the redundancy settings panel can live on the collection page (as a collapsible section) or as a modal accessible from the redundancy badge. The niche tag filtering added ignore/unignore inline on the niche panel, not on a separate settings page.

**Decision**: Add a "Redundancy Settings" panel on the collection page, below the filter/sort controls. This is where the user is when they care about redundancy (looking at their collection). The panel is collapsible, visible regardless of whether redundancy is enabled.

Controls:

- Master enable/disable toggle
- Stage selector (annotation/integrated) with brief descriptions
- Similarity threshold slider (0.0-1.0, step 0.05)
- Max penalty slider (0.5-5.0, step 0.5)
- Component weight controls (three sliders, labeled "Mechanics & Categories", "Weight & Player Count", "Your Personal Ratings")
- Minimum neighbors input (1+)
- "Reset to defaults" button

Changes persist via `PATCH /redundancy/settings` on change. Debounce slider changes to avoid excessive API calls.

**Verification**: Manual verification. All settings persist and affect scores on page refresh.

### Phase 11: CLI

**Files**: new file `packages/cli/src/commands/redundancy.ts`, modify CLI command registry
**Depends on**: Phase 4 (routes exist)
**Covers**: REQ-REDUN-37 through REQ-REDUN-40

**11a: Redundancy commands.** Create `packages/cli/src/commands/redundancy.ts` following the niche command pattern:

- `shelf-judge redundancy settings`: GET `/api/redundancy/settings`, display as table or JSON.
- `shelf-judge redundancy enable`: PATCH `{ enabled: true }`, display updated settings.
- `shelf-judge redundancy disable`: PATCH `{ enabled: false }`, display updated settings.
- `shelf-judge redundancy stage <annotation|integrated>`: PATCH `{ stage }`, validate argument.
- `shelf-judge redundancy set <key> <value>`: PATCH `{ [key]: parsedValue }`. Parse numeric values for threshold/penalty/neighbors, parse JSON for componentWeights.

Register the `redundancy` command group in the CLI's command registry.

**11b: Score command integration.** Modify `packages/cli/src/commands/score.ts`:

- `scoreGet()` (line 106): After fetching game detail, if `score.redundancyAdjustment` is non-null, append redundancy data to output: penalty, adjusted score, niche rank, top neighbor names.
- `scoreList()` (line 44): In annotation mode, add optional `--show-redundancy` flag that appends adjusted scores column. In integrated mode, scores are already adjusted. In `--json` mode, the full `FitnessResult` (with `redundancyAdjustment`) is already included.

**11c: Predict command integration.** Modify `packages/cli/src/commands/predict.ts`:

- `predictBggGame()` (line 87): After displaying prediction, if `redundancyPreview` is non-null, show penalty and top 3 similar games.

**Verification**: Manual CLI testing. `--json` output includes full redundancy data.

### Phase 12: Validate

Launch a fresh-context sub-agent that:

1. Reads the spec (`redundancy-scoring.md`) and this plan.
2. Reviews implementation across all packages.
3. Verifies all route integration points pass redundancy settings (GET /games, GET /games/:id, GET /predictions/bgg/:bggId).
4. Verifies web API helpers and CLI client are updated in the same change (client/daemon divergence lesson).
5. Verifies the redundancy engine is pure (no I/O, no service imports).
6. Verifies `NichePosition` rankings use pre-redundancy scores.
7. Verifies disabling redundancy short-circuits without computing pairwise similarities.
8. Verifies `FitnessResult.redundancyAdjustment` is null in all pre-existing code paths when redundancy is disabled.
9. Runs `bun run test`, `bun run typecheck`, `bun run lint`.

## Delegation Guide

**Phases 1-5** (types, storage, engine, routes, game integration): Sequential. Single implementer. This is the backend core. Phases 2 and 3 should be implemented together (storage imports engine defaults). Phase 5 is the most complex and should get careful review attention because it wires the engine into three separate route handlers.

**Phase 6** (web helpers): Trivial. Can be done as part of Phase 5 or as part of Phase 7.

**Phases 7-10** (web UI): Can parallelize after Phase 5 completes. Benefits from frontend awareness. Phase 7 (game detail) and Phase 8 (collection list) are independent. Phase 9 (search preview) is independent. Phase 10 (settings panel) is independent of the others.

**Phase 11** (CLI): Can run in parallel with Phases 7-10 after Phase 5 completes. Simple command registration and output formatting.

**Phase 12** (validation): Fresh-context sub-agent. Must run after all other phases. This is a gate: no PR without a clean validation pass.

**Review attention points:**

- **Phase 3** (engine): The weighted flattening and dimension mismatch handling are the trickiest parts. The decision to exclude personalAxes when either game lacks them needs careful test coverage.
- **Phase 5** (route integration): Three route handlers gain redundancy logic. Each follows the same pattern but with slight variations. Verify the order: scores first, niches second (on pre-redundancy scores), redundancy third. In integrated mode, verify `score.score` is updated after the redundancy pass but niches were computed before it.
- **Phase 5e** (PredictedGameResponse): This is a shared type change. Verify both web and CLI handle the new field.
- **Phase 10** (settings panel): The component weight UX is an open question from the spec. The implementer has latitude on presentation. User-friendly labels are more important than slider precision.

## Open Questions

1. **Feature vector caching within a request.** The `getFeatureVector` callback is called once per game per pairwise comparison. For N games, that's N calls to `encodeGame()`. Each call re-encodes the game from scratch. A micro-optimization is to cache encoded vectors in a `Map<string, FeatureVector>` keyed by game ID. This is a per-request cache (no persistence), and it's cheap. The question is whether to put this cache in the route handler (caller) or in the engine (callee). The engine's contract says it receives a callback; caching in the caller is more natural. The implementer should add this optimization as part of Phase 5, not as a future concern.

2. **Collection loading redundancy.** Phase 5a notes that the route handler loads the collection separately from the game service to get axes. This means the collection JSON is parsed twice per request. For the current scale (200 games), this is negligible. If it becomes a concern, the game service could expose axes through a method, but that's scope creep for this plan.

3. **The personalAxes dimension mismatch.** Phase 3b makes a decision about how to handle games with different personalAxes states. The spec doesn't address this directly. The decision (omit personalAxes when either game lacks them) is defensible but should be documented in the engine's JSDoc and tested explicitly.

4. **Settings panel location.** Phase 10 places the settings on the collection page. If a general settings/preferences page is added before this feature ships, the redundancy settings should move there. The panel component should be self-contained (not tightly coupled to the collection page layout) so it can be relocated.

5. **Annotation mode sort stability (spec Open Question 2).** The spec raises this concern. The plan does not add a confirmation or tooltip. The sort option name "Redundancy-Adjusted" is self-documenting. If users find it surprising, a tooltip can be added in a follow-up.
