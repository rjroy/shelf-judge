---
title: "Implementation plan: niche-champion-display"
date: 2026-04-11
status: executed
tags: [plan, niche, redundancy, collection-awareness, display, daemon, web, cli]
modules: [shared, daemon, web, cli]
related:
  - .lore/specs/niche-champion-display.md
  - .lore/brainstorms/redundancy-scoring.md
  - .lore/specs/collection-profiling.md
  - .lore/specs/prediction-engine.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/issues/deferred-redundancy-scoring.md
---

# Plan: Niche Champion Display

## Spec Reference

**Spec**: `.lore/specs/niche-champion-display.md`
**Brainstorm**: `.lore/brainstorms/redundancy-scoring.md` (Proposal 5, Proposal 6 Stage 1)

Requirements addressed:

- REQ-NICHE-1: Niche defined by mechanics, categories, families (not subdomains/weight ranges) -> Phase 2
- REQ-NICHE-2: Minimum 2 games per niche -> Phase 2
- REQ-NICHE-3: Uses BggTag data from game.bggData; games without BGG data excluded -> Phase 2
- REQ-NICHE-4: Ranked by fitness score descending; predicted scores used interchangeably -> Phase 2
- REQ-NICHE-5: Highest-ranked game is niche champion -> Phase 2
- REQ-NICHE-6: Tied games share rank; next rank skips; alphabetical tiebreaker -> Phase 2
- REQ-NICHE-7: Vetoed games excluded from niche rankings -> Phase 2
- REQ-NICHE-8: Predicted-only games participate but rank below actual-scored games in ties -> Phase 2
- REQ-NICHE-9: NichePosition is separate from FitnessResult -> Phase 1
- REQ-NICHE-10: Shared types in packages/shared/src/types.ts -> Phase 1
- REQ-NICHE-11: At most 2 neighbors above and below -> Phase 2
- REQ-NICHE-12: GET /games/:id gains nichePosition field -> Phase 4
- REQ-NICHE-13: GET /games gains ?includeNiches=true query parameter -> Phase 4
- REQ-NICHE-14: GET /predictions/bgg/:bggId gains nicheImpact field -> Phase 4
- REQ-NICHE-15: Niche engine is a pure-function module (niche-engine.ts) -> Phase 2
- REQ-NICHE-16: computeNichePositions function signature -> Phase 2
- REQ-NICHE-17: computeNicheImpact function signature -> Phase 2
- REQ-NICHE-18: Game detail page gains Niche Position panel -> Phase 5
- REQ-NICHE-19: Niche entry display (name, type, size, rank, champion, neighbors) -> Phase 5
- REQ-NICHE-20: Niche entries sorted by size descending, then alphabetically -> Phase 2
- REQ-NICHE-21: Neighbor names link to game detail; predicted indicator on predicted neighbors -> Phase 5
- REQ-NICHE-22: Collection page gains Show Niches toggle -> Phase 5
- REQ-NICHE-23: Compact niche summary per game row; expandable inline detail -> Phase 5
- REQ-NICHE-24: Group by Niche view mode -> Phase 5
- REQ-NICHE-25: Niche view is separate view mode; preserves filters; niche sizes reflect filtered set -> Phase 5
- REQ-NICHE-26: Search preview gains Niche Impact section -> Phase 5
- REQ-NICHE-27: "Would be your Nth [type] game" display -> Phase 5
- REQ-NICHE-28: CLI `shelf-judge game <id>` includes niche position -> Phase 6
- REQ-NICHE-29: CLI `shelf-judge scores --show-niches` flag -> Phase 6
- REQ-NICHE-30: CLI `shelf-judge predict bgg <bgg-id>` includes niche impact -> Phase 6
- REQ-NICHE-31: Niche position does not feed prediction engine -> architectural constraint
- REQ-NICHE-32: Niche position does not modify profiling output -> architectural constraint
- REQ-NICHE-33: Niche positions computed on demand, always current -> architectural constraint

## Codebase Context

### Architecture

Bun monorepo, four workspace packages. The daemon owns all data via services injected through factory functions. Web talks to daemon via Unix socket (`lib/daemon.ts`). CLI talks to daemon via Unix socket (Bun `fetch` with `unix` option). Shared types in `packages/shared/src/types.ts`.

### Existing Patterns

**Pure math modules**: `curve-engine.ts` and `elo-engine.ts` are pure-function modules with no I/O, no service dependencies. The `prediction-engine.ts` follows the same pattern. The niche engine follows this pattern exactly.

**Service layer**: Each domain has a service interface and `create*Service(deps)` factory. Services receive `StorageService` and peer services via dependency injection. The niche engine is NOT a service; it's a pure-function module called by the game-service or route handler.

**Routes**: Each route module exports `{ routes: Hono, operations: OperationDefinition[] }` via `createXRoutes(deps)`. Routes parse/validate input, call service, map errors to HTTP status codes.

**Web API helpers**: `packages/web/lib/api.ts` exports typed fetch wrappers (`listGames()`, `getGame(id)`, etc.) that call through the daemon proxy route at `/api/daemon/[...path]`. Each daemon endpoint has a corresponding web helper.

**CLI client**: `packages/cli/src/client.ts` exposes `DaemonClient` interface with `get<T>(path)`, `post<T>(path, body?)` methods. Commands in `packages/cli/src/commands/` call client methods and format output.

### Key Files That Change

**Shared types** (`packages/shared/src/types.ts`):

- `GameWithScore` (line 206-210): gains optional `nichePosition?: NichePosition | null`
- `PredictedGameResponse` (line 395-400): gains optional `nicheImpact?: NicheImpact`
- New interfaces: `NichePosition`, `NicheEntry`, `NicheNeighbor`, `NicheImpact`, `NicheImpactEntry`

**Daemon**:

- New file: `packages/daemon/src/services/niche-engine.ts`
- New file: `packages/daemon/tests/niche-engine.test.ts`
- Modified: `packages/daemon/src/routes/games.ts` (GET /games/:id, GET /games)
- Modified: `packages/daemon/src/routes/prediction.ts` (GET /predictions/bgg/:bggId)

**Web**:

- Modified: `packages/web/lib/api.ts` (update listGames to support includeNiches param)
- Modified: `packages/web/app/games/[id]/page.tsx` (Niche Position panel)
- Modified: `packages/web/app/collection/page.tsx` (Show Niches toggle, Group by Niche view)
- Modified: `packages/web/app/search/page.tsx` (Niche Impact in prediction preview)

**CLI**:

- Modified: `packages/cli/src/commands/game.ts` (niche position in game detail output)
- Modified: `packages/cli/src/commands/score.ts` (--show-niches flag)
- Modified: `packages/cli/src/commands/predict.ts` (niche impact in predict bgg output)

### Dependencies Between Changes

The niche engine consumes `GameWithScore[]`, which pairs a `Game` with its `FitnessResult`. Both types already exist. The engine reads `game.bggData.mechanics`, `game.bggData.categories`, and `game.bggData.families` for attribute grouping, and `score.score`, `score.vetoed`, and `score.predictionMeta` for ranking.

For GET /games/:id to include niche position, the route needs access to ALL games with scores (not just the requested game). Currently `gameService.getGame(id)` returns a single `GameWithScore`. The route will need to call `gameService.listGames()` to get the full collection, pass that to `computeNichePositions()`, then attach the result to the single game's response. This changes the route handler's data flow but not the service interface.

For GET /games with `includeNiches=true`, `gameService.listGames()` already returns all `GameWithScore[]`. The route passes that array to `computeNichePositions()` and attaches positions to each entry before responding.

For GET /predictions/bgg/:bggId, the prediction service already loads the full collection to compute predictions. The route handler (or a helper in the route file) calls `computeNicheImpact()` with the collection's `GameWithScore[]` plus the candidate game and its predicted score.

### Where Niche Data Enters the Route Layer

The spec says "The game service or route handler calls this module" (REQ-NICHE-15). The cleanest approach: the route handler calls the niche engine directly, keeping the game service unaware of niches. This matches the architectural separation where the niche engine is a pure function, not a service.

For the game detail route, this means the handler loads all games via `gameService.listGames()`, calls `computeNichePositions()`, and merges the result into the single-game response. For the prediction route, the handler calls `computeNicheImpact()` after the prediction service returns the candidate score.

The alternative (adding niche computation to the game service) would couple the service to niche awareness, which the spec explicitly avoids. Keep it in the route handler.

## Implementation Steps

### Phase 1: Shared Types

**Files**: `packages/shared/src/types.ts`
**Addresses**: REQ-NICHE-9, REQ-NICHE-10
**Expertise**: none

Add the five new interfaces after the existing `PredictedGameResponse` type:

1. `NicheNeighbor` with `gameId`, `gameName`, `fitnessScore`, `isPredicted` fields
2. `NicheEntry` with `type` (`"mechanic" | "category" | "family"`), `name`, `size`, `rank`, `isChampion`, `champion: NicheNeighbor`, `above: NicheNeighbor[]`, `below: NicheNeighbor[]`
3. `NichePosition` with `niches: NicheEntry[]`
4. `NicheImpactEntry` with `type`, `name`, `currentSize`, `projectedRank`, `currentChampion: NicheNeighbor | null`
5. `NicheImpact` with `wouldJoin: NicheImpactEntry[]`

Extend `GameWithScore` with optional `nichePosition?: NichePosition | null`.

Extend `PredictedGameResponse` with optional `nicheImpact?: NicheImpact`.

Export all new types.

### Phase 2: Niche Engine

**Files**: `packages/daemon/src/services/niche-engine.ts` (new)
**Addresses**: REQ-NICHE-1 through REQ-NICHE-8, REQ-NICHE-11, REQ-NICHE-15 through REQ-NICHE-17, REQ-NICHE-20
**Expertise**: none

Create a pure-function module following the `elo-engine.ts` pattern. No imports from service layer, no I/O. Imports only from `@shelf-judge/shared` for types.

The niche tag type union:

```typescript
type NicheTagType = "mechanic" | "category" | "family";
```

**Primary function**: `computeNichePositions(gamesWithScores: GameWithScore[]): Map<string, NichePosition>`

Algorithm:

1. Filter input: exclude games where `game.bggData === null` and games where `score?.vetoed === true`. Also exclude games where `score === null` (unscored games have no rank).
2. Build attribute index: for each remaining game, iterate `game.bggData.mechanics`, `game.bggData.categories`, `game.bggData.families`. For each attribute, add the game to a `Map<string, { type: NicheTagType; games: GameWithScore[] }>` keyed by `"${type}:${attr.name}"`.
3. Filter groups: remove entries with fewer than 2 games (REQ-NICHE-2).
4. Rank within each group:
   - Sort games by `roundedScore(score.score)` descending (sort by rounded value, not raw, so that games equal at display precision are adjacent in the sorted array).
   - Tiebreaker 1: actual scores (where `score.predictionMeta === null` or `score.predictionMeta.actualAxisCount > 0`) rank above predicted-only scores (where `score.predictionMeta !== null && score.predictionMeta.actualAxisCount === 0`) (REQ-NICHE-8).
   - Tiebreaker 2: alphabetical by `game.name` (REQ-NICHE-6).
   - Assign ranks with tie-sharing: games with identical `roundedScore` values share a rank. Next rank skips by the count of tied games.
5. For each game, assemble `NicheEntry[]`:
   - Champion is rank-1 game in the group.
   - `above`: up to 2 games ranked immediately above (better fitness). Empty when this game is champion.
   - `below`: up to 2 games ranked immediately below. Empty when this game is last.
   - Sort the niche entries by `size` descending, then `name` alphabetically (REQ-NICHE-20).
6. Return `Map<gameId, NichePosition>`.

**Score comparison helper**: `roundedScore(score: number): number` returns `Math.round(score * 10) / 10`. Two games are "tied" when their rounded scores are equal. This matches the display precision (one decimal place) per REQ-NICHE-6.

**Secondary function**: `computeNicheImpact(existingGamesWithScores: GameWithScore[], candidateGame: Game, candidateScore: FitnessResult): NicheImpact`

Algorithm:

1. Extract the candidate game's BGG attributes (mechanics, categories, families). If `candidateGame.bggData === null`, return `{ wouldJoin: [] }`.
2. Build the same attribute index as `computeNichePositions` from `existingGamesWithScores` (filtering vetoed and null-scored as above).
3. For each of the candidate's attributes:
   - Look up the attribute in the existing index.
   - `currentSize`: number of existing games in this group (0 if attribute not in index).
   - Insert the candidate (with `candidateScore.score`) into the sorted ranking to determine `projectedRank`.
   - `currentChampion`: the rank-1 game from the existing group, or `null` if `currentSize === 0`.
4. Return all entries. Include entries where `currentSize === 0` (new niche the candidate would create, per REQ-NICHE-14). These have `currentChampion: null`.
5. Sort by `currentSize` descending, then alphabetically (consistent with niche entry sorting).

**Important**: `computeNicheImpact` must not mutate the `existingGamesWithScores` array. It reads from it and creates new structures for ranking.

### Phase 3: Niche Engine Tests

**Files**: `packages/daemon/tests/niche-engine.test.ts` (new)
**Addresses**: All success criteria from the spec's "Automated Tests" section
**Expertise**: none

Build a hand-constructed test collection of 8-10 games with known mechanics overlap and known fitness scores. This test fixture is the foundation for all niche engine tests.

**Test fixture design** (illustrative):

- Game A: mechanics [Deck Building, Hand Management], categories [Card Game], score 8.4
- Game B: mechanics [Deck Building], categories [Card Game, Strategy], score 8.4, predicted-only
- Game C: mechanics [Deck Building, Worker Placement], categories [Strategy], score 7.2
- Game D: mechanics [Worker Placement, Area Control], categories [Strategy], score 6.8
- Game E: mechanics [Hand Management, Area Control], categories [Wargame], score 9.0
- Game F: mechanics [Deck Building], score 0, vetoed
- Game G: no BGG data, score 7.5
- Game H: mechanics [Hand Management], categories [Card Game], score 8.4
- Game I: families [Kosmos Two-Player], mechanics [Hand Management], score 5.0

This gives us:

- Deck Building niche: A (8.4), B (8.4 predicted), C (7.2). F excluded (vetoed). Tie between A and B with A ranking higher (actual beats predicted).
- Hand Management niche: E (9.0), A (8.4), H (8.4), I (5.0). E is champion.
- Worker Placement niche: C (7.2), D (6.8). Only 2 games, minimum met.
- Area Control niche: E (9.0), D (6.8).
- Card Game niche: A (8.4), B (8.4 predicted), H (8.4). Three-way group with tie-breaking.
- Strategy niche: B (8.4 predicted), C (7.2), D (6.8).
- Wargame niche: only E. Fewer than 2. Excluded.
- Kosmos Two-Player: only I. Excluded.

Tests to write:

1. Groups games correctly by mechanics, categories, families
2. Niches with <2 members excluded (Wargame, Kosmos Two-Player)
3. Games without BGG data excluded (Game G absent from all niches)
4. Vetoed games excluded (Game F absent from Deck Building)
5. Champion is highest-fitness game (E in Hand Management, A in Deck Building)
6. Tied games share rank; next rank skips (A and H both rank 2 in Hand Management after E at rank 1, I at rank 4)
7. Actual scores rank above predicted in ties (A ranks above B in Deck Building despite same score)
8. `above` has at most 2 neighbors; `below` has at most 2
9. Champion has empty `above`; last-ranked has empty `below`
10. Multi-niche game (A is in Deck Building, Hand Management, Card Game)
11. `computeNicheImpact` computes projected rank correctly without mutating input
12. `computeNicheImpact` with a niche that doesn't exist yet (currentSize 0, currentChampion null)
13. Niche entries sorted by size descending, then alphabetically
14. Determinism: repeated calls with same data produce identical results
15. Tie-breaking: actual-vs-predicted tiebreak tested explicitly (AI validation requirement)
16. Impact: candidate that would become champion of existing niche (projectedRank 1)

### Phase 4: Daemon Route Integration

**Files**: `packages/daemon/src/routes/games.ts`, `packages/daemon/src/routes/prediction.ts`
**Addresses**: REQ-NICHE-12, REQ-NICHE-13, REQ-NICHE-14
**Expertise**: none

**GET /games/:id** (`routes/games.ts`, line 107-118):

Currently calls `gameService.getGame(id)` and returns the result. Change to:

1. Call `gameService.getGame(id)` to get the target game (preserves 404 behavior).
2. Call `predictionService.listGamesWithPredictions()` to get all `GameWithScore[]` including predicted scores. This is the correct data source: REQ-NICHE-4 says predicted scores participate in ranking, so the niche engine must see them.
3. Call `computeNichePositions(allGames)`.
4. Attach `nichePosition: nicheMap.get(id) ?? null` to the response.

The response shape changes from `GameWithScore` to `GameWithScore` with `nichePosition` populated. Since `nichePosition` is optional on the type, clients that don't read it are unaffected.

**GET /games** (`routes/games.ts`, line 92-104):

Add `includeNiches` query parameter handling:

1. Parse `c.req.query("includeNiches") === "true"`.
2. Get the game list. When `includeNiches` is true, always use `predictionService.listGamesWithPredictions()` (REQ-NICHE-4: predicted scores participate in niche ranking). When `includePredicted` is also true, this is already the code path. When `includeNiches` is true but `includePredicted` is not, use the prediction service's list for niche computation but still return the standard list to the client (without predicted-only games in the response unless `includePredicted` is also set).
3. If `includeNiches`, call `computeNichePositions(allGamesIncludingPredicted)` and attach `nichePosition` to each entry in the response list.
4. Return the list.

The spec says this is more expensive (REQ-NICHE-13). The single-pass computation keeps it manageable.

**GET /predictions/bgg/:bggId** (`routes/prediction.ts`, line 58-80):

After `predictionService.predictBggGame(bggId)` returns the result:

1. Call `predictionService.listGamesWithPredictions()` to get all existing games with scores (including predicted). This ensures predicted games participate in niche ranking per REQ-NICHE-4.
2. Call `computeNicheImpact(allGames, result.game, result.score)`.
3. Attach `nicheImpact` to the response.

**Route dependency wiring**: The game routes already receive `gameService` and `predictionService`. The prediction routes receive `predictionService` which provides `listGamesWithPredictions()`. The niche engine is imported directly (it's a pure function, not a service). No changes to the app's dependency injection.

**Important**: The `computeNichePositions` call in GET /games/:id means a single-game detail request now loads the full collection. This is acceptable per spec constraints (O(G\*A) for 200 games is ~2000 ops). If this becomes measurable, the spec notes caching behind the profile dirty flag as the upgrade path (Constraints section).

### Phase 5: Web UI

**Files**: `packages/web/lib/api.ts`, `packages/web/app/games/[id]/page.tsx`, `packages/web/app/collection/page.tsx`, `packages/web/app/search/page.tsx`
**Addresses**: REQ-NICHE-18 through REQ-NICHE-27
**Expertise**: frontend (React/Next.js components)

#### 5a: Web API Helpers

**File**: `packages/web/lib/api.ts`

- Update `listGames()` to accept an optional `{ includeNiches?: boolean }` parameter. When true, append `?includeNiches=true` to the request path.
- No change needed for `getGame(id)`: the daemon now always includes `nichePosition` on the detail response.
- No change needed for `predictBggGame(bggId)`: the daemon now always includes `nicheImpact` on the response.

#### 5b: Game Detail Page

**File**: `packages/web/app/games/[id]/page.tsx`

Add a "Niche Position" panel below the score breakdown (REQ-NICHE-18). The panel reads `nichePosition` from the `getGame(id)` response.

Panel is omitted (not rendered) when `nichePosition` is null or `nichePosition.niches.length === 0`.

Each niche entry displays (REQ-NICHE-19):

- Niche name with a type badge (e.g., "Deck Building" with a small "mechanic" label)
- Niche size (e.g., "5 games")
- This game's rank (e.g., "#3 of 5")
- Champion with name and score (e.g., "Champion: Dominion (8.4)")
- Adjacent games above and below with names and scores
- Champion indicator when this game is rank 1 (REQ-NICHE-19 suggests crown icon or "Champion" badge)

Neighbor names are links to `/games/[neighborGameId]` (REQ-NICHE-21). Predicted neighbors show the predicted visual indicator already in use (per REQ-PRED-14 conventions).

For vetoed games, show "This game is vetoed and excluded from niche rankings" instead of the panel (REQ-NICHE-7).

#### 5c: Collection Page

**File**: `packages/web/app/collection/page.tsx`

Add a "Show Niches" toggle (REQ-NICHE-22). When toggled on, fetch with `includeNiches=true`.

With niches enabled, each game row shows a compact summary: "3 niches, champion of 1" or "2 niches" (REQ-NICHE-23). Clicking expands an inline detail showing the same niche entry info as the game detail panel, in condensed form.

Add a "Group by Niche" view mode (REQ-NICHE-24). This is a separate view mode toggle (alongside existing list view), not a filter/sort option. When active:

- Games grouped under niche headings ("Deck Building (5 games)")
- Champion highlighted in each group
- A game in multiple niches appears under each heading
- Groups sorted by niche size descending
- Within each group, games sorted by niche rank ascending

The niche view preserves active filter state (REQ-NICHE-25). If the user has filtered to 4+ player games, only those appear in niche groups, and niche sizes reflect the filtered set. This means the niche computation from the daemon (which is unfiltered) must be re-filtered client-side, OR the daemon must support filter parameters on the niche computation.

**Implementation decision**: Re-filter client-side. The daemon returns full niche data, and the collection page filters the niche groups based on the active game filter. This avoids adding filter logic to the daemon's niche computation. The client already has the filtered game set; it just needs to intersect that with the niche groups. Niche sizes in the grouped view show the filtered count, not the total. This is consistent with REQ-NICHE-25: "niche sizes reflect the filtered set."

After intersecting the daemon's niche data with the active filter set, discard any niche group whose filtered membership falls below 2 before rendering. A niche with 5 total games but only 1 matching the active filter should not appear as a "(1 game)" heading in the grouped view.

#### 5d: Search Preview

**File**: `packages/web/app/search/page.tsx`

Add a "Niche Impact" section to the prediction preview panel below the prediction breakdown (REQ-NICHE-26). Reads `nicheImpact` from the `predictBggGame(bggId)` response.

Each entry displays (REQ-NICHE-27):

- "Would be your Nth [mechanic/category/family] game, ranked #M"
- When `currentSize === 0`: "Would be your 1st [name] game"
- When candidate would be champion: "Would be your best [name] game"

### Phase 6: CLI

**Files**: `packages/cli/src/commands/game.ts`, `packages/cli/src/commands/score.ts`, `packages/cli/src/commands/predict.ts`
**Addresses**: REQ-NICHE-28, REQ-NICHE-29, REQ-NICHE-30
**Expertise**: none

#### 6a: Game Detail Command

**File**: `packages/cli/src/commands/game.ts`

The `gameGet` function (or whichever function handles `shelf-judge game <id>`) fetches `GET /api/games/:id`. The daemon now includes `nichePosition` in the response. Add niche position display after the existing fitness/tournament output.

Text mode: for each niche entry, print:

```
Niche: [name] ([size] games) [type]
  Rank: #[rank] of [size]  |  Champion: [champion.gameName] ([champion.fitnessScore])
  Above: [above games]  |  Below: [below games]
```

Omit the niche section when `nichePosition` is null. For vetoed games, print "This game is vetoed and excluded from niche rankings."

JSON mode: the full `nichePosition` object is already in the response. No change needed for `--json`.

#### 6b: Scores Command

**File**: `packages/cli/src/commands/score.ts`

Add `--show-niches` flag to `scoreList`. When enabled:

1. Fetch `GET /api/games?includeNiches=true` (combine with `includePredicted` if both flags are set).
2. Text mode: add a "Niches" column to the table showing compact summary ("3 niches, champ of 1").
3. JSON mode: the full `nichePosition` is already in each entry. No change needed.

This requires updating the CLI argument parser (wherever flags are registered) to accept `--show-niches`.

#### 6c: Predict BGG Command

**File**: `packages/cli/src/commands/predict.ts`

The `predictBggGame` function fetches `GET /api/predictions/bgg/:bggId`. The daemon now includes `nicheImpact` in the response. Add niche impact display after the existing prediction output.

Text mode: for each impact entry, print:

```
Would be your [projectedRank]th [name] game ([type]), ranked #[projectedRank]
  Current champion: [currentChampion.gameName] ([currentChampion.fitnessScore])
```

When `currentSize === 0`: "Would be your 1st [name] game ([type])."
When `projectedRank === 1` and `currentSize > 0`: "Would be your best [name] game ([type])."

JSON mode: the full `nicheImpact` is already in the response.

### Phase 7: Validate Against Spec

Launch a sub-agent that reads the spec at `.lore/specs/niche-champion-display.md`, reviews the implementation across all packages, and flags any requirements not met. This step is not optional.

The validation agent should specifically verify:

- Every REQ-NICHE requirement is addressed in implementation
- Both web proxy route and CLI client helper are updated (per tournament retro lesson about client/daemon divergence)
- Niche computation does not call external APIs or trigger profile recomputation (per AI validation spec)
- Type exports are consistent between shared, daemon, web, and CLI

## Delegation Guide

**Phases 1-3** (shared types, niche engine, tests): Single implementer. These are the foundation. Must be complete and tested before any integration work begins.

**Phase 4** (daemon routes): Same implementer as Phases 1-3 or a second. Depends on the niche engine being available. Route changes are straightforward once the engine exists.

**Phase 5** (web UI): Can run in parallel with Phase 6 after Phase 4 is complete. The web work is the largest phase and benefits from frontend expertise. The collection page (5c) is the most complex sub-step due to the Group by Niche view mode and client-side filter intersection.

**Phase 6** (CLI): Can run in parallel with Phase 5 after Phase 4 is complete. Straightforward output formatting.

**Phase 7** (validation): Fresh-context sub-agent. Must run after all other phases complete.

Steps requiring specialized review:

- Phase 5 (all): Frontend review for component structure, accessibility, and visual consistency with existing pages
- Phase 5c specifically: The Group by Niche view with client-side filter intersection is the most architecturally complex UI step. Review the filter/niche interaction carefully.

Consult `.lore/lore-agents.md` (if it exists) for available domain-specific agents.

## Open Questions

1. **Large-niche noise.** The spec addresses family noise (Open Question 1) and excludes subdomains/weight ranges as "too broad" (REQ-NICHE-1). But the user annotated the spec with a broader concern: "Is a niche that is 1/2 the collection also noise?" A mechanic like "Hand Management" might appear on 67% of a typical euro-heavy collection (the brainstorm notes this). The spec does not include a max-size filter or percentage cap. During implementation, if a niche encompasses more than ~50% of the collection, it probably isn't telling the user anything they don't already know. The implementer should flag this if it surfaces with real data. A max-size-percentage filter (e.g., exclude niches covering >50% of the collection) could be added without changing the engine's interface, just an additional filter after step 3 in the algorithm. This does not block starting.

2. **GET /games/:id performance.** The niche computation for a single-game detail request now loads the full collection. The spec calls this acceptable and names caching as the upgrade path. GET /games/:id always includes `nichePosition` per REQ-NICHE-12 (null when the game has no niches, never absent). If the load becomes measurable, the upgrade path is caching behind the profile dirty flag, not making the field optional.
