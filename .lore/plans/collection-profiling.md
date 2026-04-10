---
title: "Implementation plan: collection-profiling"
date: 2026-04-10
status: approved
tags: [plan, profiling, collection, outlier, divergence, feature-vector]
modules: [shared, daemon, web, cli]
related:
  - .lore/specs/collection-profiling.md
  - .lore/specs/prediction-engine.md
  - .lore/research/outlier-distance-metric.md
  - .lore/brainstorms/collection-profiling.md
  - .lore/brainstorms/prediction-engine.md
  - .lore/retros/tournament-stats-record-shape-mismatch.md
---

# Plan: Collection Identity and Taste Profiling

## Spec Reference

**Spec**: `.lore/specs/collection-profiling.md`
**Outlier distance research**: `.lore/research/outlier-distance-metric.md`
**Prediction engine spec**: `.lore/specs/prediction-engine.md` (shared feature vector module)

Requirements addressed:

- REQ-PROFILE-1: Collection-level statistical profile → Phase 3
- REQ-PROFILE-2: Axis rating distributions → Phase 3
- REQ-PROFILE-3: Axis weight interpretation → Phase 3
- REQ-PROFILE-4: BGG attribute clustering → Phase 3
- REQ-PROFILE-5: Utility curve declarations → Phase 3
- REQ-PROFILE-6: No external API calls → Phase 3 (architectural constraint)
- REQ-PROFILE-7: Tournament/fitness divergence detection → Phase 3
- REQ-PROFILE-8: Two divergence types → Phase 3
- REQ-PROFILE-9: Divergence reporting → Phase 3
- REQ-PROFILE-10: Divergence requires tournament data → Phase 3
- REQ-PROFILE-11: Composite distance metric → Phase 2
- REQ-PROFILE-12: Centroid-based outlier detection → Phase 3
- REQ-PROFILE-13: Outlier classifications → Phase 3
- REQ-PROFILE-14: Outlier detection is observation → Phase 3 (UI constraint)
- REQ-PROFILE-15: Axis suggestions from three sources → Phase 3
- REQ-PROFILE-16: Suggestions as questions → Phase 5 (UI behavior)
- REQ-PROFILE-17: Suggestions without LLM → Phase 3
- REQ-PROFILE-18 through 23: [DEFERRED] LLM narration → not in this plan
- REQ-PROFILE-24: Profile persisted as stored dataset → Phase 4
- REQ-PROFILE-25: Dirty flag on collection writes → Phase 4
- REQ-PROFILE-26 through 28: [DEFERRED] LLM narration caching → not in this plan
- REQ-PROFILE-29: Profile Overview replaces home page → Phase 5
- REQ-PROFILE-30: Profile Overview page sections → Phase 5
- REQ-PROFILE-31: Game detail view additions → Phase 5
- REQ-PROFILE-32: CLI profile command → Phase 6
- REQ-PROFILE-33: --json flag accepted → Phase 6
- REQ-PROFILE-34: [DEFERRED] CLI narration subcommand → not in this plan
- REQ-PROFILE-35 through 38: Anti-goals → constraints on all phases

## Codebase Context

### Architecture

Bun monorepo, four workspace packages. The daemon owns all data via services injected through factory functions. Web talks to daemon via Unix socket (`lib/daemon.ts`). CLI talks to daemon via Unix socket (Bun `fetch` with `unix` option). Shared types and Zod schemas in `packages/shared/`.

### Existing Patterns

**Service layer**: Each domain has a service interface and `create*Service(deps)` factory. Services receive `StorageService` and peer services via dependency injection. No classes, just closures over deps. See `game-service.ts`, `axis-service.ts`, `fitness-service.ts`, `tournament-service.ts`.

**Pure math modules**: `elo-engine.ts` and `curve-engine.ts` establish the pattern for pure-function math modules. Exported functions, no service dependencies, no I/O. Heavy unit test coverage. Both the feature vector module and the profile computation engine follow this pattern.

**Storage**: `StorageService` exposes `loadCollection/saveCollection`, `loadTournament/saveTournament`, `loadConfig/saveConfig`. Each dataset is a separate JSON file in `~/.shelf-judge/`. Atomic writes via temp file + rename (`atomicWrite`). The profile follows this same pattern: `loadProfile/saveProfile` with a `profile.json` file.

**Routes**: Each route module exports `{ routes: Hono, operations: OperationDefinition[] }` via `createXRoutes(deps)`. Routes parse/validate input, call service, map errors to HTTP status codes. Registered in `app.ts` on the `/api` base path.

**Web**: Next.js 16 with App Router. Server components fetch from daemon via `lib/api.ts`. Client components use the `/api/daemon/[...path]` proxy route for mutations. CSS in `globals.css`.

**CLI**: Hand-rolled arg parser in `index.ts` with a `COMMANDS` map. Each command module exports async functions. Output via `formatTable` and `printOutput` helpers.

### Key Existing Files

**Types**: `packages/shared/src/types.ts` defines `Game`, `BggGameData`, `Axis`, `FitnessResult`, `FitnessBreakdownEntry`, `TournamentGameStatsDisplay`, etc. Profile types will be added here.

**Fitness service**: `packages/daemon/src/services/fitness-service.ts` produces `FitnessResult` per game. The profile reads these results for axis rating distributions and divergence analysis.

**Tournament service**: `packages/daemon/src/services/tournament-service.ts` manages ELO ratings. The profile reads `TournamentGameStatsDisplay.normalizedScore` for divergence detection.

**Curve engine**: `packages/daemon/src/services/curve-engine.ts` provides `getNativeScale()`, which the profile needs for continuous attribute normalization.

**Web home page**: `packages/web/app/page.tsx` is currently the collection list. This becomes the Profile Overview page; the collection list moves to a new route.

**Web API client**: `packages/web/lib/api.ts` has helper functions for each daemon endpoint. Profile helpers go here.

### Data Available for Profiling

Each game provides:

- `ratings: Record<string, number>` (personal axis ratings, 1-10)
- `bggData.mechanics: BggTag[]` (binary attribute set)
- `bggData.categories: BggTag[]` (binary attribute set)
- `bggData.families: BggTag[]` (includes game series and publisher families)
- `bggData.weight: number | null` (1-5 continuous)
- `bggData.communityRating: number` (1-10 continuous)
- `minPlayers / maxPlayers: number | null` (player count range)
- `playingTime: number | null` (minutes)

Each axis provides:

- `weight: number` (1-100)
- `preferenceShape`, `idealValue`, `tolerance`, `leanDirection`, `veto` (curve config)

Tournament data provides:

- `normalizedScore: number | null` per game (1-10 scale, null when insufficient data)
- `comparisonCount: number` per game

### Cross-Cutting Concern: Client/Daemon Sync

Per the tournament retro lesson (`.lore/retros/tournament-stats-record-shape-mismatch.md`): when adding profile routes to the daemon, update both the web API client (`packages/web/lib/api.ts`) and the CLI client (`packages/cli/src/client.ts`) in the same phase. Phase 4 handles all three together.

## Technical Decisions

### 1. Feature vector module as shared foundation

**Decision**: Create `packages/daemon/src/services/feature-vector.ts` as a pure-function module exporting: (a) feature vector encoding, (b) individual distance functions (Jaccard, normalized Manhattan), (c) composite distance, (d) centroid computation. The module follows the `curve-engine.ts` and `elo-engine.ts` pattern: exported functions, no service dependencies, no I/O.

**Rationale**: The prediction engine spec (REQ-PRED-4) explicitly requires a pure-function feature vector module reusable across profiling, prediction, and redundancy scoring. Profiling needs Jaccard distance for binary attributes and normalized Manhattan for continuous; prediction needs cosine similarity over the same vectors. The encoding is shared; the distance metrics differ. Exporting individual distance functions lets each consumer compose the metric it needs.

### 2. Profile computation as a separate pure-function module

**Decision**: Create `packages/daemon/src/services/profile-engine.ts` alongside the feature vector module. The profile engine takes collection data (games, axes, fitness results, tournament stats) as input and returns a fully computed profile object. No I/O, no service dependencies.

**Rationale**: Separating computation from persistence follows the fitness/curve engine pattern and makes the profile engine independently testable. The profile service (Phase 4) wraps this engine with storage and caching. The engine can be tested with hand-crafted data without touching the file system.

### 3. Stale detection via timestamp comparison

**Decision**: The profile stores a `computedAt` timestamp. On profile read, the service compares `computedAt` against `collection.updatedAt` and the latest tournament mutation timestamp (most recent comparison `createdAt` or session `updatedAt`). If either source is newer, the profile is stale and recomputes.

**Rationale**: The spec says "any write to collection data sets a dirty flag" (REQ-PROFILE-25). Timestamp comparison achieves the same effect without modifying every mutation endpoint in the game service, axis service, and tournament service. The collection already tracks `updatedAt` on mutations. Tournament timestamps come from comparison and session records. This is less plumbing than wiring a `markDirty()` call into every service method that writes data.

### 4. Subdomain data gap

**Decision**: The spec references "subdomains" in REQ-PROFILE-4, but `BggGameData` has no `subdomains` field. The BGG API provides subdomain data via `<link type="boardgamesubdomain">` elements (e.g., "Strategy Games", "Family Games"), but the parser (`bgg-xml-parser.ts`) only extracts `boardgamemechanic`, `boardgamecategory`, and `boardgamefamily`. The current `families` field mixes game series, publisher families, and potentially other link types, none of which are subdomains.

**Resolution**: Add `subdomains: BggTag[]` to `BggGameData` and extract `boardgamesubdomain` links in the parser, following the same pattern as mechanics and categories. This is a small change (one line in the parser, one field in the type) and aligns the data model with what the spec requires. Existing games will have empty subdomain arrays until their BGG data is refreshed; the profile handles empty arrays gracefully (they're simply not clustered).

### 5. Profile data file

**Decision**: Profile persists as `~/.shelf-judge/profile.json`, following the tournament data precedent. The storage service gets `loadProfile/saveProfile` methods. The spec's Open Question #1 endorses this approach, and the user confirmed it.

### 6. Home page becomes Profile Overview

**Decision**: The current `packages/web/app/page.tsx` (collection list) moves to `packages/web/app/collection/page.tsx`. A new `packages/web/app/page.tsx` becomes the Profile Overview. Navigation links update accordingly.

**Rationale**: REQ-PROFILE-29 says the Profile Overview replaces the home page. The collection list still needs to be accessible (it's a different interaction mode), so it moves to its own route rather than being removed.

### 7. Weight ranges in BGG clustering

**Decision**: REQ-PROFILE-4 asks for clustering by "weight ranges." The profile buckets games by BGG weight into named ranges: Light (1.0-2.0), Medium-Light (2.0-2.5), Medium (2.5-3.0), Medium-Heavy (3.0-3.5), Heavy (3.5-5.0). These names match common BGG community terminology.

**Rationale**: Weight is continuous (1-5), so clustering requires binning. Five bins with conventional names produce an immediately readable distribution. The bin boundaries are a constant in the profile engine, not configurable.

## Phases

### Phase 1: Shared Types and Validation

**Files created**: None
**Files modified**: `packages/shared/src/types.ts`, `packages/shared/src/validation.ts`, `packages/shared/src/index.ts`, `packages/daemon/src/services/bgg-xml-parser.ts`
**Addresses**: REQ-PROFILE-1, 7, 8, 9, 11, 13, 15, 24, 30, 31, 32 (type foundation)
**Expertise**: None

#### Type additions to `packages/shared/src/types.ts`

Add the `subdomains` field to `BggGameData`:

```typescript
export interface BggGameData {
  // ... existing fields ...
  subdomains: BggTag[]; // NEW: BGG subdomains (Strategy Games, Family Games, etc.)
}
```

Add profile data types:

```typescript
// Profile types

export interface AxisDistribution {
  axisId: string;
  axisName: string;
  mean: number;
  median: number;
  standardDeviation: number;
  range: { min: number; max: number };
  ratedGameCount: number;
}

export interface AxisWeightEntry {
  axisId: string;
  axisName: string;
  weight: number;
  percentage: number; // weight / totalWeight * 100
}

export interface AttributeCluster {
  name: string;
  count: number;
  percentage: number; // count / totalGames * 100
}

export interface WeightRangeCluster {
  range: string; // "Light", "Medium-Light", etc.
  min: number;
  max: number;
  count: number;
  percentage: number;
}

export interface UtilityCurveDeclaration {
  axisId: string;
  axisName: string;
  shape: PreferenceShape;
  idealValue: number | null;
  tolerance: ToleranceLevel | null;
  leanDirection: LeanDirection | null;
  vetoThreshold: VetoConfig | null;
  nativeScale: NativeScale;
}

export interface DivergentGame {
  gameId: string;
  gameName: string;
  fitnessScore: number;
  normalizedTournamentScore: number;
  gap: number; // absolute difference
  direction: "tournament-outlier" | "fitness-outlier";
}

export interface ComponentDistances {
  binary: number; // Jaccard distance [0,1]
  continuous: number; // normalized Manhattan [0,1]
  personalAxes: number | null; // normalized Manhattan [0,1], null when no shared axes
  composite: number; // weighted combination [0,1]
}

export type OutlierClassification = "lone-wolf" | "category-orphan" | "high-fitness-outlier";

export interface CollectionOutlier {
  gameId: string;
  gameName: string;
  distances: ComponentDistances;
  classifications: OutlierClassification[];
  fitnessScore: number | null;
}

export interface AxisSuggestion {
  source: "unexpressed-concentration" | "high-variance" | "divergence-repair";
  attribute: string; // mechanic name, category name, or BGG field
  reason: string; // human-readable explanation
  evidence: { gameCount?: number; percentage?: number; variance?: number };
}

export interface CollectionProfile {
  axisDistributions: AxisDistribution[];
  axisWeights: AxisWeightEntry[];
  bggClustering: {
    mechanics: AttributeCluster[];
    categories: AttributeCluster[];
    subdomains: AttributeCluster[];
    weightRanges: WeightRangeCluster[];
  };
  utilityCurves: UtilityCurveDeclaration[];
  divergence: DivergentGame[] | null; // null when no tournament data
  outliers: CollectionOutlier[];
  suggestions: AxisSuggestion[];
  gameCount: number;
  ratedGameCount: number;
  computedAt: string; // ISO 8601
}

export interface ProfileData {
  profile: CollectionProfile;
  computedAt: string; // ISO 8601, when profile was last computed
}
```

#### Parser change

In `packages/daemon/src/services/bgg-xml-parser.ts`, add subdomain extraction alongside mechanics and categories in `parseThingResponse` and `parseThingResponseWithMetadata`:

```typescript
subdomains: extractLinks(links, "boardgamesubdomain"),
```

#### Validation

No new Zod schemas needed for profile data: the profile is read-only (computed by the daemon), not user-submitted. The existing `BggGameDataSchema` in `packages/shared/src/validation.ts` needs the `subdomains` field added (as `z.array(BggTagSchema).default([])` to handle existing data without subdomains).

#### Re-exports

Update `packages/shared/src/index.ts` to re-export all new profile types.

**Depends on**: Nothing. This is the foundation.

**Verification**:

- Typecheck clean across all four packages.
- Existing tests pass (the `subdomains` field defaults to `[]` for existing BGG data).
- Profile types are importable from `@shelf-judge/shared`.

**Reqs covered**: Type foundation for REQ-PROFILE-1 through 15, 24, 30, 31, 32.

---

### Phase 2: Feature Vector Module

**Files created**: `packages/daemon/src/services/feature-vector.ts`, `packages/daemon/tests/feature-vector.test.ts`
**Files modified**: None
**Addresses**: REQ-PROFILE-11, REQ-PRED-4 (shared module)
**Expertise**: None

This module is the mathematical foundation shared between profiling (outlier detection) and the future prediction engine (k-NN similarity). It follows the `elo-engine.ts` and `curve-engine.ts` pattern: exported pure functions, no I/O, no service dependencies.

#### Vocabulary builder

```typescript
function buildVocabulary(games: Game[]): { mechanics: string[]; categories: string[] };
```

Scans all games' BGG data and returns sorted lists of unique mechanic and category names. The vocabulary defines which binary columns exist in the feature vector.

#### Feature vector encoding

```typescript
function encodeGame(
  game: Game,
  vocabulary: Vocabulary,
  axisRatings?: Record<string, number>,
): FeatureVector;
```

Produces a feature vector for one game:

- **Binary portion**: one bit per mechanic/category in the vocabulary. 1 if the game has it, 0 if not.
- **Continuous portion**: BGG weight (normalized 0-1 over 1-5), community rating (normalized 0-1 over 1-10), min players (normalized 0-1 over observed range), max players (normalized 0-1 over observed range), play time (normalized 0-1 over observed range).
- **Personal axis portion** (optional): axis ratings normalized 0-1 over 1-10.

Export a `FeatureVector` type that separates binary and continuous portions, since different distance metrics apply to each.

#### Distance functions

```typescript
function jaccardDistance(a: number[], b: number[]): number; // [0,1]
function normalizedManhattanDistance(a: number[], b: number[]): number; // [0,1]
function compositeDistance(
  game: FeatureVector,
  centroid: FeatureVector,
  weights: ComponentWeights,
): ComponentDistances;
```

- `jaccardDistance`: operates on the binary portion. `1 - |A ∩ B| / |A ∪ B|`. When both sets are empty, returns 0 (no distance).
- `normalizedManhattanDistance`: operates on the continuous portion. `sum(|a_i - b_i|) / n`. Each element is already [0,1] from encoding.
- `compositeDistance`: combines binary (Jaccard) and continuous (Manhattan) distances with configurable weights. Returns per-component distances and the weighted composite.

Default component weights: binary 0.4, continuous BGG 0.3, personal axes 0.3. When personal axes are unavailable for a game, the weight redistributes proportionally.

#### Centroid computation

```typescript
function computeCentroid(vectors: FeatureVector[]): FeatureVector;
```

The centroid's binary portion is the mean frequency: fraction of games with each mechanic/category. The continuous portion is the element-wise mean.

#### Cosine similarity (for prediction engine reuse)

```typescript
function cosineSimilarity(a: number[], b: number[]): number; // [0,1]
```

Exported but not used by profiling. Included because REQ-PRED-5 requires it and the prediction engine spec says the module should expose it.

#### Test cases (`packages/daemon/tests/feature-vector.test.ts`)

- Vocabulary builder produces sorted, deduplicated mechanic/category lists
- Feature vector encoding produces correct binary flags for known mechanics
- Jaccard distance: two identical sets → 0, two disjoint sets → 1, partial overlap → correct fraction
- Jaccard distance: both empty → 0
- Normalized Manhattan: identical values → 0, maximum difference → 1
- Composite distance: weights sum to 1.0 after redistribution when personal axes are null
- Centroid of a single game equals that game's feature vector
- Centroid of multiple games produces mean values
- Cosine similarity: identical vectors → 1, orthogonal → 0

**Depends on**: Phase 1 (uses `Game`, `BggGameData` types).

**Verification**:

- All feature vector tests pass.
- Typecheck clean.
- Module exports all functions needed by Phase 3 and by the future prediction engine.

**Reqs covered**: REQ-PROFILE-11 (composite metric), REQ-PRED-4 (reusable module).

---

### Phase 3: Profile Computation Engine

**Files created**: `packages/daemon/src/services/profile-engine.ts`, `packages/daemon/tests/profile-engine.test.ts`
**Files modified**: None
**Addresses**: REQ-PROFILE-1 through 17 (all algorithmic profile requirements)
**Expertise**: None

The profile engine is a pure-function module. It takes all input data as arguments and returns a `CollectionProfile`. No I/O, no service dependencies.

#### Input shape

```typescript
interface ProfileInput {
  games: Game[];
  axes: Axis[];
  fitnessResults: Map<string, FitnessResult>;
  tournamentStats: Map<string, TournamentGameStatsDisplay> | null;
}
```

The profile service (Phase 4) constructs this from the storage layer; the engine just computes.

#### Main function

```typescript
function computeProfile(input: ProfileInput): CollectionProfile;
```

Delegates to section-specific functions below.

#### Axis rating distributions (REQ-PROFILE-2)

```typescript
function computeAxisDistributions(games: Game[], axes: Axis[]): AxisDistribution[];
```

For each axis, collect all games that have a rating on it. Compute mean, median, standard deviation, and range. Standard deviation uses the population formula (not sample), since we're describing the entire collection, not estimating a population parameter.

#### Axis weight interpretation (REQ-PROFILE-3)

```typescript
function computeAxisWeights(axes: Axis[]): AxisWeightEntry[];
```

Each axis weight as a percentage of total weight. Sorted by percentage descending.

#### BGG attribute clustering (REQ-PROFILE-4)

```typescript
function computeBggClustering(games: Game[]): CollectionProfile["bggClustering"];
```

For mechanics, categories, and subdomains: count how many games have each attribute, compute percentage of total collection. Sort by count descending. Games without BGG data are excluded from the denominator.

For weight ranges: bucket games by BGG weight into Light (1.0-2.0), Medium-Light (2.0-2.5), Medium (2.5-3.0), Medium-Heavy (3.0-3.5), Heavy (3.5-5.0). Boundaries are inclusive on the lower end, exclusive on the upper end, except the last bucket which is inclusive on both ends. Games without BGG weight are excluded.

#### Utility curve declarations (REQ-PROFILE-5)

```typescript
function extractUtilityCurves(axes: Axis[]): UtilityCurveDeclaration[];
```

For each axis with a non-default curve configuration (any of `preferenceShape`, `idealValue`, `tolerance`, `leanDirection`, or `veto` is set), report the curve settings in native-scale terms. Uses `getNativeScale` from `curve-engine.ts`.

#### Tournament/fitness divergence (REQ-PROFILE-7 through 10)

```typescript
function computeDivergence(
  fitnessResults: Map<string, FitnessResult>,
  tournamentStats: Map<string, TournamentGameStatsDisplay>,
  games: Game[],
): DivergentGame[] | null;
```

Returns `null` when `tournamentStats` is null or empty (REQ-PROFILE-10: divergence section omitted, not shown as empty).

For each game with both a non-zero fitness score and a non-null normalized tournament score (REQ-PROFILE-7: games with null normalized score are excluded):

- Compute gap = |normalizedTournamentScore - fitnessScore|
- If gap > 1.5, classify:
  - `"tournament-outlier"`: high ELO, low fitness (REQ-PROFILE-8)
  - `"fitness-outlier"`: high fitness, low ELO (REQ-PROFILE-8)

Sort by gap descending.

#### Collection outlier detection (REQ-PROFILE-11 through 14)

```typescript
function detectOutliers(
  games: Game[],
  axes: Axis[],
  fitnessResults: Map<string, FitnessResult>,
): CollectionOutlier[];
```

1. Build vocabulary and encode all games with BGG data as feature vectors (using Phase 2 module).
2. Compute collection centroid.
3. Compute composite distance from centroid for each game.
4. Compute mean and standard deviation of all composite distances.
5. Flag games whose composite distance > mean + 2 \* stddev (REQ-PROFILE-12).
6. Classify each outlier (REQ-PROFILE-13):
   - **Lone wolf**: the game's nearest neighbor (the collection game with the smallest composite distance to it) is itself far from it (nearest-neighbor composite distance > 0.5). This captures the spec's "no close neighbors across multiple attribute dimensions" definition. A game can be far from the centroid but still have a close neighbor (it's in a cluster that happens to be far from center); the lone wolf classification catches games that are genuinely isolated.
   - **Category orphan**: game is in a BGG category or subdomain that appears only once in the collection.
   - **High-fitness outlier**: game has a fitness score (not null, not vetoed) AND is flagged as an outlier by composite distance.

Games without BGG data are excluded from outlier detection (can't compute feature vectors).

#### Axis suggestions (REQ-PROFILE-15 through 17)

```typescript
function generateSuggestions(
  games: Game[],
  axes: Axis[],
  divergentGames: DivergentGame[] | null,
): AxisSuggestion[];
```

Three sources:

1. **Unexpressed concentration** (REQ-PROFILE-15 bullet 1): For each BGG mechanic or category shared by 80%+ of games with BGG data, check if any existing axis name or description references it. If not, suggest creating one. The match between mechanic names and axis names is case-insensitive substring-based (e.g., mechanic "Deck Building" matches axis "deck building appeal"). The mechanic/category name is checked as a substring of the axis name and description.

2. **High-variance BGG attributes** (REQ-PROFILE-15 bullet 2): Compute the coefficient of variation (stddev / mean) for BGG weight, community rating, player count range span (maxPlayers - minPlayers), and play time across the collection. If the coefficient exceeds 0.5 and no existing axis maps to that BGG field, suggest it.

3. **Tournament divergence repair** (REQ-PROFILE-15 bullet 3): When divergent games exist, find BGG mechanics or categories shared by 2+ divergent games that have no corresponding axis. Suggest axes that might explain the divergence pattern.

#### Test cases (`packages/daemon/tests/profile-engine.test.ts`)

Validated against the spec's success criteria:

- Axis distributions: hand-calculated mean/median/stddev/range for a 5-game, 3-axis dataset
- BGG clustering: correct counts and percentages for mechanics, categories, subdomains
- Weight ranges: games bucket correctly at boundaries (2.0 goes in Medium-Light, 3.5 goes in Heavy)
- Divergence: games above 1.5-point threshold flagged in both directions
- Divergence: games with zero tournament comparisons excluded
- Divergence: returns null when no tournament data
- Composite distance: Jaccard for binary, normalized Manhattan for continuous, weighted combination in [0,1]
- Outlier detection: a deliberate outlier (a heavy wargame in a collection of medium euros) is flagged
- A game unusual on only one dimension is not flagged (weighted combination dilutes)
- Category orphan: game in a category appearing only once is classified
- Lone wolf: game sharing zero mechanics with any other game is classified
- High-fitness outlier: game with high fitness but outlier distance is classified
- Axis suggestion: mechanic appearing in 80%+ of games with no corresponding axis triggers suggestion
- Axis suggestion: high-variance BGG attribute with no axis triggers suggestion
- Profile computation is deterministic (identical results on repeated calls)

**Depends on**: Phase 1 (types), Phase 2 (feature vector module).

**Verification**:

- All profile engine tests pass.
- Typecheck clean.
- Hand-calculated test cases match spec expectations.

**Reqs covered**: REQ-PROFILE-1 through 17.

---

### Phase 4: Profile Service, Storage, and Daemon Routes

**Files created**: `packages/daemon/src/services/profile-service.ts`, `packages/daemon/src/routes/profile.ts`, `packages/daemon/tests/profile-service.test.ts`
**Files modified**: `packages/daemon/src/services/storage-service.ts`, `packages/daemon/src/app.ts`, `packages/daemon/src/index.ts`, `packages/web/lib/api.ts`, `packages/cli/src/client.ts`
**Addresses**: REQ-PROFILE-24, 25, 6
**Expertise**: None

#### Storage service extension

Add to `StorageService` interface and implementation:

```typescript
loadProfile(): Promise<ProfileData | null>;  // null when no profile exists yet
saveProfile(data: ProfileData): Promise<void>;
```

File path: `path.join(dataDir, "profile.json")`. Same `atomicWrite` pattern as tournament data. Returns `null` (not a default) when the file doesn't exist, since the profile is computed, not user-created.

#### Profile service

```typescript
interface ProfileService {
  getProfile(): Promise<CollectionProfile>;
}

interface ProfileServiceDeps {
  storageService: StorageService;
  gameService: GameService;
  tournamentService: TournamentService;
}
```

`getProfile()` implements the lazy recompute pattern:

1. Load the stored profile (if any).
2. Load collection (from `storageService.loadCollection()`) and tournament data (from `storageService.loadTournament()`).
3. Compare `profile.computedAt` against `collection.updatedAt` and the latest tournament timestamp. If the stored profile exists and is not stale, return it.
4. If stale or missing: assemble `ProfileInput` and call `computeProfile()` from the profile engine, save the result, return it.

**Assembling `ProfileInput`**: Call `gameService.listGames()` to get `GameWithScore[]` (games with precomputed fitness results). This avoids re-running fitness calculations. Extract `Game[]` from `entry.game` and build `Map<string, FitnessResult>` from `entry.score`. Get `Axis[]` from `collection.axes`. Get tournament display stats from `tournamentService.getAllGameStats()`. Do not derive fitness results from storage directly; `GameService.listGames()` is the single source of truth for fitness scores.

The "latest tournament timestamp" is derived from:

- The most recent `comparison.createdAt` across all tournament comparisons
- The most recent `session.updatedAt` across all tournament sessions
- Whichever is later

When no tournament data exists, tournament timestamps are ignored.

#### Tournament data access

The profile service needs tournament comparison timestamps for stale detection, and `TournamentGameStatsDisplay` for divergence. The tournament service already exposes `getAllGameStats()`. For timestamp access, the profile service can call `storageService.loadTournament()` directly to read the raw tournament data.

Alternatively, add a `getLatestTimestamp(): Promise<string | null>` to the tournament service. The simpler approach is reading tournament data directly from storage, since the profile service already depends on `StorageService`.

**Decision**: The profile service reads tournament data directly from `StorageService.loadTournament()` for stale detection, and uses `TournamentService.getAllGameStats()` for the display stats needed by divergence computation.

#### Daemon routes

`packages/daemon/src/routes/profile.ts`:

```
GET /api/profile → returns CollectionProfile
```

Single endpoint. The route calls `profileService.getProfile()`. No mutations (the profile is read-only, recomputed automatically).

Operation definition:

```typescript
{
  operationId: "shelf.profile.get",
  name: "get",
  description: "Get the collection profile (recomputes if stale)",
  invocation: { method: "GET", path: "/api/profile" },
  hierarchy: { root: "shelf", feature: "profile" },
  idempotent: true,
}
```

#### App wiring

In `app.ts`:

- Add `ProfileService` to `AppDeps` interface
- Import and register `createProfileRoutes`
- Wire up on `/api`

In `index.ts` (daemon entry point):

- Create `profileService` with deps
- Pass to `createApp`

#### Client updates (retro lesson compliance)

**Web API client** (`packages/web/lib/api.ts`):

```typescript
export async function getProfile(): Promise<CollectionProfile> {
  return daemonJson("/api/profile");
}
```

**CLI client** (`packages/cli/src/client.ts`):

Add the profile endpoint to the CLI's daemon client.

Both clients are updated in this phase, not deferred to the web/CLI phases. This follows the tournament retro lesson.

#### Tests

- Profile service returns cached profile when not stale
- Profile service recomputes when collection.updatedAt > computedAt
- Profile service recomputes when tournament data is newer than computedAt
- Profile service computes fresh when no stored profile exists
- Profile route returns 200 with CollectionProfile shape
- Profile response includes per-component distances (binary, continuous, personalAxes) for each outlier
- Stale detection triggers after each mutation type: game add, game remove, rating change, axis change, tournament comparison, BGG refresh (verify collection.updatedAt advances in each case)
- Storage service loadProfile returns null when file doesn't exist
- Storage service saveProfile writes and loads correctly

**Depends on**: Phase 1 (types), Phase 2 (feature vectors), Phase 3 (profile engine).

**Verification**:

- Profile route returns a valid CollectionProfile.
- Stale detection works: change a rating, next profile read recomputes.
- Both web and CLI clients have profile helpers.
- Typecheck clean across all packages.

**Reqs covered**: REQ-PROFILE-24, 25, 6.

---

### Phase 5: Web UI

**Files created**: `packages/web/app/collection/page.tsx`, `packages/web/app/profile/page.tsx` or repurposed `packages/web/app/page.tsx`
**Files modified**: `packages/web/app/page.tsx`, `packages/web/app/layout.tsx`, `packages/web/app/games/[id]/page.tsx`, `packages/web/components/sidebar.tsx`, `packages/web/app/globals.css`
**Addresses**: REQ-PROFILE-16, 29, 30, 31
**Expertise**: Frontend layout, responsive design

#### Navigation restructuring (REQ-PROFILE-29)

The collection list currently lives at `/` (root). It moves to `/collection`. The Profile Overview takes the root route.

1. Move the contents of `packages/web/app/page.tsx` to `packages/web/app/collection/page.tsx`. Update the page title metadata to "Collection".
2. Create the new `packages/web/app/page.tsx` as the Profile Overview page.
3. Update sidebar navigation (`packages/web/components/sidebar.tsx`) to add a "Collection" link pointing to `/collection`. The existing home/root link becomes "Profile" (or stays as the app title link).

#### Profile Overview page (REQ-PROFILE-30)

The page is a server component. It fetches the profile from the daemon via `getProfile()` and renders sections:

1. **Axis rating distributions**: For each axis, show mean, median, stddev, range. A compact table or card grid. Games with tight clustering (low stddev) can be visually distinguished from loose distributions.

2. **Axis weight breakdown**: Horizontal bar chart or ranked list showing each axis's percentage of total weight.

3. **BGG attribute clustering**: Top mechanics, categories, subdomains by count/percentage. Weight distribution by range.

4. **Utility curve declarations**: For axes with configured curves, show the shape, ideal value, tolerance, and veto thresholds.

5. **Tournament/fitness divergence** (conditional): Only shown when `profile.divergence !== null`. Lists divergent games with both scores, gap magnitude, and direction label.

6. **Collection outliers**: Lists outlier games with per-component distances and classifications.

7. **Suggested axes**: Presented as questions (REQ-PROFILE-16). "Have you considered creating an axis for [mechanic]? It appears in [N]% of your collection." Each suggestion has a dismiss button (session-only, via client-side state, not persisted per REQ-PROFILE-16).

Sections with insufficient data (e.g., outlier detection with < 3 games) are omitted, not shown as empty (per the constraint in the spec).

#### Game detail view additions (REQ-PROFILE-31)

In `packages/web/app/games/[id]/page.tsx`:

Fetch the profile alongside existing game data. If the current game appears in `profile.divergence`, show its divergence status (which direction, gap magnitude). If the game appears in `profile.outliers`, show its outlier status with per-component distances and classifications.

Both sections are informational. The profile's distance breakdown ("mechanics distance 0.85, complexity distance 0.12") provides the explanation layer.

#### CSS

Add styles to `packages/web/app/globals.css` for the profile page sections. Match the existing design system (card-based layout, consistent spacing, color variables). Profile-specific CSS classes should be prefixed (e.g., `.profile-section`, `.profile-axis-dist`, `.profile-outlier-card`).

**Depends on**: Phase 4 (profile route must exist for the web page to fetch data).

**Verification**:

- Profile Overview page renders with real data (200-game dataset).
- All sections display when data is available.
- Divergence section is absent when no tournament data exists.
- Outlier section is absent when fewer than 3 games.
- Axis suggestions show dismiss buttons that work (session-only).
- Collection list is accessible at `/collection`.
- Navigation links work.
- Game detail view shows divergence and outlier status for applicable games.
- Responsive layout works on desktop, tablet, and phone breakpoints.
- Typecheck clean.

**Reqs covered**: REQ-PROFILE-16, 29, 30, 31.

---

### Phase 6: CLI

**Files created**: `packages/cli/src/commands/profile.ts`
**Files modified**: `packages/cli/src/index.ts`
**Addresses**: REQ-PROFILE-32, 33
**Expertise**: None

#### Profile command

Add `profile` to the `COMMANDS` map in `packages/cli/src/index.ts`.

`packages/cli/src/commands/profile.ts`:

```typescript
export async function profileCommand(
  client: DaemonClient,
  args: string[],
  opts: CommandOpts,
): Promise<void>;
```

Calls `GET /api/profile` via the CLI client and outputs the full `CollectionProfile` as JSON to stdout (REQ-PROFILE-32). The `--json` flag is accepted but has no behavioral difference since the default output is already JSON (REQ-PROFILE-33).

Use `printOutput` with the profile data. No table formatting needed; the CLI profile command is a programmatic interface for LLM/agent access, not a human-facing summary.

**Depends on**: Phase 4 (CLI client helper must exist).

**Verification**:

- `shelf-judge profile` returns parseable JSON.
- `shelf-judge profile --json` returns identical output.
- Typecheck clean.

**Reqs covered**: REQ-PROFILE-32, 33.

---

### Phase 7: Final Validation

**Files modified**: None (test-only)
**Addresses**: All requirements (verification)
**Expertise**: Fresh-context review

Launch a sub-agent that reads the spec at `.lore/specs/collection-profiling.md`, reviews the implementation across all packages, and flags any requirements not met. This step is not optional.

#### Automated test verification

Run `bun run test` across all packages. All tests pass.

#### Manual verification checklist (from spec success criteria)

- [ ] Axis rating distributions compute correct mean, median, stddev, range
- [ ] BGG attribute clustering correctly counts and percentages mechanics, categories, subdomains
- [ ] Divergence correctly identifies games above 1.5-point threshold in both directions
- [ ] Divergence excludes games with zero tournament comparisons
- [ ] Divergence section omitted (not empty) when no tournament data
- [ ] Composite distance: Jaccard for binary, normalized Manhattan for continuous
- [ ] Composite distance weighted combination produces [0,1]
- [ ] Per-component distances available in profile response
- [ ] Outlier detection flags games beyond 2 stddev
- [ ] Single-dimension extremes are not flagged (weighted dilution)
- [ ] Category orphan detection works
- [ ] Lone wolf detection works
- [ ] High-fitness outlier detection works
- [ ] Axis suggestion identifies 80% concentration threshold
- [ ] Axis suggestion identifies high-variance attributes
- [ ] Dirty flag set on collection mutations
- [ ] Profile recomputes on next read when stale
- [ ] Profile does not recompute when current
- [ ] Profile is deterministic (repeated calls, unchanged data)
- [ ] Profile Overview page displays all sections with real data
- [ ] Outlier threshold produces reasonable number of flags (not zero, not half)
- [ ] CLI returns complete parseable JSON
- [ ] Profile Overview replaces home page; collection at separate route
- [ ] Game detail shows divergence and outlier status
- [ ] 2σ threshold validated against 200-game dataset; adjust if needed

#### AI validation specifics (from spec)

- Profile statistics validated against hand-calculated examples (5-10 games, 3 axes)
- Divergence tested at both sides of 1.5-point threshold
- Outlier tested with deliberate outlier (heavy wargame in medium-euro collection)
- Composite weights tested: changing weights changes which games are flagged
- Default weights (0.4/0.3/0.3) produce intuitive results on 200-game dataset
- When adding profile routes: web proxy and CLI client updated together (verified in Phase 4)

**Depends on**: All previous phases.

**Verification**: All tests pass. `bun run test`, `bun run typecheck`, `bun run lint` all clean.

## Delegation Guide

All seven phases are assigned to **Dalton** (implementation). Phases are sequential; each depends on the previous.

After Phase 3, invoke **Thorne** (review) to check the profile computation engine and feature vector module against the spec. These contain the core math; catching errors here prevents them from propagating to the service layer and UI.

After Phase 5, invoke **Thorne** again to review the web UI for spec compliance (all sections rendered, omission behavior correct, no anti-goal violations).

After Phase 7, a final Thorne review confirms full requirement coverage across all packages.

## Risk Notes

1. **2σ threshold calibration.** The spec acknowledges that 2 standard deviations may not produce the right number of outliers if the composite distance distribution is skewed (REQ-PROFILE-12). The implementer should compute the distribution on the real 200-game dataset during Phase 3 testing and evaluate both 2σ and top-5-percentile thresholds. If 2σ flags zero or more than 10% of games, switch to percentile-based. Document the decision.

2. **Subdomain data backfill.** Adding `subdomains` to `BggGameData` means existing games have no subdomain data until BGG data is refreshed. The profile handles empty arrays gracefully (the clustering section just shows no subdomains). A bulk refresh (`shelf-judge refresh-all`) populates them. This is acceptable for a user-driven tool.

3. **Collection page route change.** Moving the collection list from `/` to `/collection` breaks any bookmarks or external links to the root URL. Since this is a single-user local tool, the impact is minimal, but the change should be noted in any release notes.

4. **Profile computation performance.** Feature vector encoding and centroid distance computation are O(n \* d) where n = games and d = vocabulary size. For 400 games with ~300 features, this is ~120K operations per profile computation, which is negligible. If the collection grows to thousands of games, the computation should be profiled, but for the current scale (and the fact that computation is cached), performance is not a concern.

5. **Component file size.** The Profile Overview page renders seven sections. If the page component exceeds ~300 lines, extract sections into sub-components (`packages/web/components/profile-*.tsx`). The Phase 5 implementer should use judgment on decomposition.

## Open Questions

1. **Axis suggestion matching heuristic.** The plan proposes substring matching between BGG mechanic/category names and existing axis names/descriptions to detect "already covered." This is a rough heuristic. "Deck, Bag, and Pool Building" (BGG mechanic) should match an axis named "Deck Building Appeal" but might miss an axis named "Engine Building" that the user considers a proxy. The implementer should use case-insensitive substring matching as a starting point and accept that false positives (suggesting an axis the user considers covered) are low-cost (the user dismisses it).

2. **Weight range boundaries.** The five-bucket weight classification uses boundaries drawn from BGG community convention. These are not universal. If the 200-game dataset reveals that most games cluster in one bucket, the implementer may adjust boundaries. Document any changes.
