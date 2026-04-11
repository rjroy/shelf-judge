---
title: "Niche Champion Display"
date: 2026-04-11
status: draft
tags: [spec, redundancy, niche, collection-awareness, display]
modules: [daemon, shared, web, cli]
req-prefix: NICHE
related:
  - .lore/brainstorms/redundancy-scoring.md
  - .lore/specs/collection-profiling.md
  - .lore/specs/prediction-engine.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/issues/deferred-redundancy-scoring.md
  - .lore/vision.md
---

# Spec: Niche Champion Display

## Overview

The fitness model treats each game as an island. Two identical worker-placement games score identically because the model doesn't know (or care) that the other exists. Vision Principle 5 says this is wrong: "A fifth worker-placement game isn't as fit as the first, even if it's individually excellent."

This feature surfaces niche position as a read-only annotation alongside the fitness score, without modifying the score itself. For each game, the system identifies which niches it belongs to and where it ranks within each. The user sees the carrying capacity of their shelf; the system does not assert a conclusion about what should go.

This is Stage 1 of the graduated redundancy approach (Proposal 6 from the brainstorm). It is designed to be extended by future stages that add score annotations (Stage 2) and integrated score modification (Stage 3), but delivers standalone value. No scoring formula changes. No new computation beyond sorting existing data by existing scores within existing clusters.

## Entry Points

- Game detail view (web): Niche Position panel shows per-niche rank, champion, and adjacent games
- Collection list view (web): optional niche columns and niche grouping mode
- Game detail CLI: `shelf-judge game <id>` includes niche position data
- Collection CLI: `shelf-judge scores` gains a `--show-niches` flag
- Search preview (web): prediction preview panel shows niche impact for candidate games
- Prediction CLI: `shelf-judge predict bgg <bgg-id>` includes niche impact

## Requirements

### Niche Definition

- REQ-NICHE-1: A niche is a group of games that share a BGG attribute. Three attribute types define niches: mechanics, categories, and families. These are the same attribute types that the profiling engine clusters (`computeBggClustering` in `profile-engine.ts:158-203`), but the niche engine performs its own grouping because it needs `GameWithScore[]` (games paired with fitness scores) rather than raw `Game[]` with attribute counts. Subdomains and weight ranges are excluded from niche identification because they are too broad to be meaningful (a "Strategy Games" subdomain or "Medium" weight range would contain the majority of a typical euro-heavy collection).

- REQ-NICHE-2: A niche must contain at least 2 games to appear in niche displays. A game that is the sole representative of a mechanic, category, or family has no niche context to show. The minimum is not configurable in this stage.

- REQ-NICHE-3: Niche definitions are computed from the same `Game[]` array used by the profile engine, using the same `BggTag` data from `game.bggData.mechanics`, `game.bggData.categories`, and `game.bggData.families`. Games without BGG data (`bggData === null`) are excluded from all niche computations: they cannot define niches and they do not appear as niche members.

### Niche Ranking

- REQ-NICHE-4: Within each niche, games are ranked by fitness score descending. The fitness score used is the `score` field from `FitnessResult` as returned by `fitness-service.ts`. For games with predicted scores (`predictionMeta !== null`), the predicted fitness score is used for ranking. The ranking uses actual and predicted scores interchangeably for ordering purposes; the visual distinction between actual and predicted (per REQ-PRED-14) is preserved in display.

- REQ-NICHE-5: The highest-ranked game in a niche is the "niche champion." Champion status means the game is the most fit in its niche, zero redundancy. A game can be champion of multiple niches simultaneously.

- REQ-NICHE-6: When two or more games in a niche have identical fitness scores (equal to one decimal place, the display precision), they share the same rank. The next rank after a tie skips accordingly (e.g., two games tied at rank 1 means the next game is rank 3). Tiebreaker for display order among tied games: alphabetical by `game.name`.

- REQ-NICHE-7: Vetoed games (fitness score 0, `vetoed === true` on `FitnessResult`) are excluded from niche rankings. A vetoed game does not count as a niche member for ranking purposes, does not appear in the niche neighbor list, and cannot be a niche champion. Rationale: the user has declared the game unfit. It should not impose niche context on games that are actually valued. A vetoed game's own niche position panel shows "This game is vetoed and excluded from niche rankings."

- REQ-NICHE-8: Games with only predicted scores (no personal axis ratings, `predictionMeta !== null` and `predictionMeta.actualAxisCount === 0`) participate in niche rankings but are flagged as "predicted" in niche displays. When displayed as a niche neighbor or champion, the predicted status is visible (e.g., "Wingspan (8.2, predicted)"). Predicted games carry lower authority as niche references: they do not displace an actual-scored game from champion status when tied on score. Tiebreaker among tied games: actual scores rank above predicted scores, then alphabetical.

### Niche Position Data Model

- REQ-NICHE-9: The daemon computes niche position data as a new response type. This type is not added to `FitnessResult`. Niche position is a separate concern from fitness scoring, returned alongside score data but not embedded in it.

```typescript
interface NichePosition {
  niches: NicheEntry[];
}

interface NicheEntry {
  /** Attribute type that defines this niche */
  type: "mechanic" | "category" | "family";
  /** Attribute name (e.g., "Deck Building", "Card Game") */
  name: string;
  /** Total games in this niche (excluding vetoed) */
  size: number;
  /** This game's rank within the niche (1 = champion) */
  rank: number;
  /** Whether this game is the niche champion */
  isChampion: boolean;
  /** The niche champion game */
  champion: NicheNeighbor;
  /** Games ranked immediately above (better fitness), up to 2 */
  above: NicheNeighbor[];
  /** Games ranked immediately below (worse fitness), up to 2 */
  below: NicheNeighbor[];
}

interface NicheNeighbor {
  gameId: string;
  gameName: string;
  fitnessScore: number;
  isPredicted: boolean;
}
```

- REQ-NICHE-10: `NichePosition`, `NicheEntry`, and `NicheNeighbor` are shared types defined in `packages/shared/src/types.ts`. They are consumed by web, CLI, and daemon.

- REQ-NICHE-11: The `above` and `below` arrays in `NicheEntry` contain at most 2 neighbors each. This provides enough context for the user to see where they sit (the games immediately better and worse) without overwhelming the display. When the game is champion, `above` is empty. When the game is last in the niche, `below` is empty.

### Daemon API

- REQ-NICHE-12: `GET /games/:id` response gains a `nichePosition` field: `NichePosition | null`. Null when the game has no BGG data or belongs to no niches with 2+ members. This extends the existing game detail response shape. The niche position is computed on demand from the current `Game[]` and their `FitnessResult` scores. It is not cached or persisted.

- REQ-NICHE-13: `GET /games` (the collection list endpoint) gains an optional `?includeNiches=true` query parameter. When enabled, each `GameWithScore` in the response includes a `nichePosition` field. This requires computing fitness scores for all games first, then ranking within niches, making it more expensive than the default response. The daemon should compute niche positions in a single pass over all games (not per-game), building the full niche map once and reading from it for each game.

- REQ-NICHE-14: `GET /predictions/bgg/:bggId` response gains a `nicheImpact` field for search preview:

```typescript
interface NicheImpact {
  /** Niches this game would join if added to the collection */
  wouldJoin: NicheImpactEntry[];
}

interface NicheImpactEntry {
  type: "mechanic" | "category" | "family";
  name: string;
  /** Current niche size (before adding this game) */
  currentSize: number;
  /** What rank this game would hold in the niche */
  projectedRank: number;
  /** Current champion of this niche */
  currentChampion: NicheNeighbor | null;
}
```

The niche impact is computed by temporarily including the preview game in the niche map without persisting it. `NicheImpact` and `NicheImpactEntry` are shared types in `types.ts`. The `currentChampion` field is null when the niche does not yet exist in the collection (the preview game would be the first, so the niche has size 0 and no champion). In this case, `currentSize` is 0.

- REQ-NICHE-15: Niche computation does not introduce a new daemon service file. The niche ranking logic is a pure-function module (`packages/daemon/src/services/niche-engine.ts`) following the pattern of `curve-engine.ts` and `elo-engine.ts`. It takes `GameWithScore[]` as input and returns a `Map<string, NichePosition>` keyed by game ID. The game service or route handler calls this module; it has no service-layer dependencies.

### Niche Engine Implementation

- REQ-NICHE-16: The niche engine exposes a single primary function:

```typescript
function computeNichePositions(gamesWithScores: GameWithScore[]): Map<string, NichePosition>;
```

This function:

1. Filters out games without BGG data and vetoed games.
2. Groups games by each mechanic, category, and family attribute.
3. For each attribute group with 2+ members, ranks games by fitness score descending (using tie-breaking rules from REQ-NICHE-6 and REQ-NICHE-8).
4. For each game, assembles its `NicheEntry` array with rank, champion, and adjacent neighbors.
5. Returns the complete map in a single pass.

- REQ-NICHE-17: The niche engine exposes a second function for search preview:

```typescript
function computeNicheImpact(
  existingGamesWithScores: GameWithScore[],
  candidateGame: Game,
  candidateScore: FitnessResult,
): NicheImpact;
```

This function computes what niches the candidate game would join and where it would rank, without mutating the existing games array. It reuses the same grouping logic as `computeNichePositions`.

### Web UI: Game Detail

- REQ-NICHE-18: The game detail page (`packages/web/app/games/[id]/page.tsx`) gains a "Niche Position" panel below the score breakdown. The panel is omitted (not shown empty) when `nichePosition` is null or has zero entries.

- REQ-NICHE-19: Each niche entry in the panel displays:
  - Niche name and type badge (e.g., "Deck Building" with a "mechanic" label)
  - Niche size (e.g., "5 games")
  - This game's rank (e.g., "#3 of 5")
  - Champion game name and score (e.g., "Champion: Dominion (8.4)")
  - Adjacent games above and below with names and scores
  - Visual indicator when this game is the champion (e.g., a crown icon or "Champion" badge)

- REQ-NICHE-20: Niche entries are sorted by niche size descending (largest niche first). Within same-size niches, sort alphabetically by name. Rationale: larger niches are more relevant for redundancy awareness.

- REQ-NICHE-21: Each neighbor game name in the niche panel is a link to that game's detail page. Predicted scores on neighbors show the predicted visual indicator per REQ-PRED-14.

### Web UI: Collection List

- REQ-NICHE-22: The collection page (`packages/web/app/collection/page.tsx`) gains a "Show Niches" toggle. When enabled, the page fetches with `?includeNiches=true` and displays niche context for each game.

- REQ-NICHE-23: With niches enabled, each game row in the collection list shows a compact niche summary: the number of niches the game belongs to and whether it is a champion of any. Example: "3 niches, champion of 1" or "2 niches." Clicking the summary expands an inline detail showing the same information as the game detail panel (REQ-NICHE-19) in condensed form.

- REQ-NICHE-24: The collection list gains a "Group by Niche" view mode. In this mode, games are grouped under niche headings (e.g., "Deck Building (5 games)"), with the champion game highlighted. A game that belongs to multiple niches appears under each niche heading. The groups are sorted by niche size descending. Within each group, games are sorted by niche rank ascending (champion first).

- REQ-NICHE-25: The "Group by Niche" view is a separate view mode alongside the existing list view, not a filter or sort option. Switching between list view and niche view preserves the current filter state. The niche view respects active filters: if the user has filtered to games with 4+ players, only those games appear in niche groups, and niche sizes reflect the filtered set.

### Web UI: Search Preview

- REQ-NICHE-26: The BGG search prediction preview panel (`packages/web/app/search/page.tsx`, per REQ-PRED-29a) gains a "Niche Impact" section below the prediction breakdown. This section shows the `nicheImpact` data from REQ-NICHE-14.

- REQ-NICHE-27: Each niche impact entry displays: "Would be your Nth [mechanic/category/family] game" (e.g., "Would be your 4th Deck Building game, ranked #2"). When the niche does not yet exist (currentSize is 0), display: "Would be your 1st [name] game." When the candidate would be champion, highlight this: "Would be your best [name] game."

### CLI

- REQ-NICHE-28: `shelf-judge game <id>` (the existing game detail command) includes niche position data in its output. The niche position section is omitted when null. In `--json` mode, the response includes the full `NichePosition` object.

- REQ-NICHE-29: `shelf-judge scores` gains a `--show-niches` flag. When enabled, each game in the output includes a compact niche summary (number of niches, champion count). In `--json` mode, each entry includes the full `NichePosition` object. This flag causes the CLI to request `?includeNiches=true` from the daemon.

- REQ-NICHE-30: `shelf-judge predict bgg <bgg-id>` includes niche impact data in its output (per REQ-NICHE-14). In text mode, shows "Would be your Nth [type] game" lines. In `--json` mode, includes the full `NicheImpact` object.

### Interactions

- REQ-NICHE-31: Niche position data does not participate in the prediction engine's computations. The prediction engine predicts fitness scores; niche position reads those scores. The dependency is one-way: niches consume predictions, predictions do not consume niches.

- REQ-NICHE-32: Niche position data does not modify the profiling engine's output or the `CollectionProfile` type. Profiling computes BGG clustering; niche display reads that clustering. The profile page may link to niche views in the future, but this spec does not add niche data to the profile response.

- REQ-NICHE-33: When the user adds or removes a game, changes a rating, or refreshes BGG data, niche positions change because fitness scores change. Niche positions are computed on demand (not cached), so they are always current. There is no dirty flag or invalidation mechanism for niches.

## Scope Exclusions

- **Score modification.** This spec does not add a redundancy penalty, redundancy annotation, or any change to the fitness formula. The `FitnessResult` type is not modified. This is Stage 1; score modification is a future stage.
- **Redundancy settings.** No `RedundancySettings` type, no settings file, no settings API. Settings apply to score modification (future), not to read-only display.
- **Pairwise similarity niches.** This spec uses cluster-based niches (BGG mechanics, categories, families), not pairwise cosine similarity. Pairwise similarity is a future option for score modification stages where gradient matters more than legibility.
- **Niche-based sorting.** The collection list does not gain "sort by niche rank" as a sort option. Niche rank is meaningful only within a niche, not across the collection. The niche grouping view (REQ-NICHE-24) serves this purpose instead.
- **Subdomain and weight-range niches.** Excluded per REQ-NICHE-1. Too broad to be useful as niche identifiers.
- **Tournament interaction.** The brainstorm notes that tournament ELO divergence within niches is interesting ("your 4th-best Deck Building game by fitness, but in tournaments you consistently pick it over the top 3"). This is deferred. The niche display uses fitness scores only.

## Exit Points

| Exit                                    | Triggers When                                                           | Target                              |
| --------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------- |
| Redundancy annotations (Stage 2)        | User wants to see "what if" redundancy penalties alongside scores       | [STUB: redundancy-annotations]      |
| Integrated redundancy scoring (Stage 3) | User wants redundancy to modify fitness scores                          | [STUB: integrated-redundancy]       |
| Redundancy settings                     | Score modification stages need user-configurable thresholds and weights | [STUB: redundancy-settings]         |
| LLM narration of niches                 | Deferred LLM layer interprets niche patterns in natural language        | Extends [DEFERRED: REQ-PROFILE-18]  |
| Tournament-niche divergence             | Surface games that underperform in tournaments despite high niche rank  | [STUB: tournament-niche-divergence] |

## Success Criteria

### Automated Tests (bun test)

- [ ] `computeNichePositions` correctly groups games by mechanics, categories, and families
- [ ] Niches with fewer than 2 members are excluded from the result
- [ ] Games without BGG data are excluded from all niche computations
- [ ] Vetoed games (fitness 0) are excluded from niche rankings and do not appear as neighbors
- [ ] Niche champion is the highest-fitness game in each niche
- [ ] Tied games share the same rank; next rank skips accordingly (1, 1, 3)
- [ ] Among tied games, actual scores rank above predicted scores
- [ ] `above` array contains at most 2 neighbors; `below` array contains at most 2 neighbors
- [ ] Champion has empty `above` array; last-ranked game has empty `below` array
- [ ] A game in multiple niches (e.g., has 3 mechanics and 2 categories) has entries for each qualifying niche
- [ ] `computeNicheImpact` correctly computes projected rank for a candidate game without mutating the existing array
- [ ] `computeNicheImpact` reports `currentSize: 0` and `currentChampion: null` for a niche that doesn't exist in the collection
- [ ] Niche entries are sorted by size descending, then alphabetically
- [ ] `GET /games/:id` returns `nichePosition` when the game has niches, null when it doesn't
- [ ] `GET /games?includeNiches=true` includes `nichePosition` on each game
- [ ] `GET /predictions/bgg/:bggId` includes `nicheImpact` in the response
- [ ] Niche computations produce identical results on repeated calls with unchanged data (determinism)

### Manual Verification

- [ ] Game detail page shows Niche Position panel with correct rank, champion, and neighbors for a game in 3+ niches
- [ ] Game detail page omits Niche Position panel for a game with no BGG data
- [ ] Vetoed game's detail page shows "excluded from niche rankings" message
- [ ] Collection list "Show Niches" toggle displays compact niche summaries per game
- [ ] Collection list "Group by Niche" view groups games correctly, highlights champions, and respects active filters
- [ ] Search preview panel shows niche impact for a BGG game not in the collection (e.g., "Would be your 4th Deck Building game")
- [ ] CLI `shelf-judge game <id>` includes niche position in text and JSON output
- [ ] CLI `shelf-judge scores --show-niches` includes niche summaries
- [ ] CLI `shelf-judge predict bgg <bgg-id>` includes niche impact

## AI Validation

**Defaults** (apply unless overridden):

- Unit tests with mocked time/network/filesystem
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom:**

- Niche ranking tested against a hand-constructed collection (8-10 games, known mechanics overlap, known fitness scores) with expected ranks verified
- Tie-breaking tested explicitly: two games with identical fitness in the same niche, one actual and one predicted, verifying actual ranks higher
- Niche impact tested with a candidate game that would become champion of an existing niche, verifying `projectedRank: 1`
- Niche impact tested with a candidate game whose mechanic doesn't exist in the collection, verifying `currentSize: 0`
- When adding niche routes to the daemon, verify that both web proxy route and CLI client helper are updated in the same change (per tournament retro lesson)
- Verify that niche computation does not call any external APIs or trigger profile recomputation

## Constraints

- The fitness formula (`sum(effective_rating * weight) / sum(weights)`) does not change. The `FitnessResult` type does not gain new fields. Niche position is a separate data structure returned alongside fitness, not embedded in it.
- No new persistent files. Niche positions are computed on demand from existing `GameWithScore[]` data. No caching, no dirty flags.
- No new external service dependencies. Niche computation is local sorting and grouping over existing in-memory data.
- The niche engine is a pure-function module with no service-layer dependencies. It takes `GameWithScore[]` in, returns `Map<string, NichePosition>` out. It does not read from storage, call other services, or maintain state.
- The `CollectionProfile` type and profile computation are not modified. Niche display reads from the same BGG attributes that profiling clusters, but through its own independent computation path.
- Performance: niche computation is O(G \* A) where G is game count and A is average attributes per game. For a 200-game collection with ~10 attributes each, this is ~2000 grouping operations plus sorting within groups. No performance concern anticipated, but if computation becomes measurable, caching behind the profile dirty flag is the upgrade path.

## Open Questions

1. **Family noise.** BGG families include publisher families (e.g., "Kosmos: 2-player series") and thematic groupings alongside mechanical groupings. These can create noisy niches where membership is incidental rather than meaningful. The spec includes families because the brainstorm and profiling spec both include them in BGG clustering. If families produce unhelpful niches during implementation, the implementer should add a minimum size filter (e.g., families need 3+ members instead of 2) rather than excluding families entirely. Flag this in the retro if it arises.

## Context

- [Brainstorm: Redundancy and Collection-Awareness Scoring](.lore/brainstorms/redundancy-scoring.md): Proposal 5 (Niche Champion Display Without Score Modification) is the direct source. Proposal 6 (Graduated Engagement) establishes this as Stage 1. Edge cases (vetoed games, multi-niche games, predicted-only games) are addressed in requirements.
- [Vision](.lore/vision.md): Principle 5 ("The shelf has a carrying capacity") is the driver. Principle 2 (transparency) is satisfied by showing niche membership and rank. Principle 4 ("data serves judgment") is satisfied by presenting niche position as information, not as a score modification.
- [Spec: Collection Profiling](.lore/specs/collection-profiling.md): Provides `computeBggClustering` (REQ-PROFILE-4) which defines the attribute groups this spec consumes. The profile engine computes attribute counts and percentages; the niche engine ranks games within those groups by fitness score.
- [Spec: Prediction Engine](.lore/specs/prediction-engine.md): Provides `FitnessResult` with `predictionMeta` for predicted games. REQ-NICHE-4 and REQ-NICHE-8 define how predicted scores participate in niche ranking. REQ-NICHE-14 and REQ-NICHE-26 extend the search preview with niche impact.
- [Design: MVP Fitness Model](.lore/designs/mvp-fitness-model.md): Defines `FitnessResult` and the scoring formula. This spec explicitly does not modify either.
- [Issue: Deferred Redundancy Scoring](.lore/issues/deferred-redundancy-scoring.md): The issue that triggered the brainstorm. This spec is the first deliverable from that brainstorm.
