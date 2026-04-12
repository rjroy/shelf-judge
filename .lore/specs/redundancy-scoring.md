---
title: "Redundancy Scoring Penalty"
date: 2026-04-11
status: approved
tags: [spec, redundancy, fitness, scoring, collection-awareness]
modules: [daemon, shared, web, cli]
req-prefix: REDUN
related:
  - .lore/brainstorms/redundancy-scoring.md
  - .lore/specs/niche-champion-display.md
  - .lore/specs/prediction-engine.md
  - .lore/specs/collection-profiling.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/issues/deferred-redundancy-scoring.md
  - .lore/vision.md
---

# Spec: Redundancy Scoring Penalty

## Overview

The niche champion display (Stage 1) shows where each game sits within its niches. This spec builds the next two stages: a redundancy penalty that quantifies how much a game's fitness is reduced by the presence of higher-scoring niche neighbors. Stage 2 shows the penalty as a "what if" annotation alongside the unmodified primary score. Stage 3 applies the penalty to the primary fitness score. The user escalates between stages via settings, with the system defaulting to the least invasive mode.

The penalty mechanism uses pairwise cosine similarity on flattened feature vectors (Proposal 1 from the brainstorm), not cluster-based grouping. Pairwise similarity captures the gradient of overlap between games rather than forcing discrete niche boundaries. The niche champion display's cluster-based niches and this spec's pairwise similarity-based penalties are complementary: cluster niches answer "what mechanic/category groups do I own?", pairwise penalties answer "how much of this game's overall profile is covered by better-scoring games?"

## Entry Points

- Redundancy settings API: `GET/PATCH /redundancy/settings`
- Game detail view (web): redundancy annotation in score breakdown (Stage 2+)
- Collection list (web): sort by redundancy-adjusted fitness (Stage 2+)
- Game detail CLI: redundancy adjustment in `shelf-judge game <id>` output (Stage 2+)
- Collection CLI: `shelf-judge scores` shows redundancy-adjusted scores (Stage 3)
- Search preview (web/CLI): predicted redundancy impact for candidate games
- Prerequisite: niche champion display (Stage 1) is implemented

## Requirements

### Redundancy Settings

- REQ-REDUN-1: A `RedundancySettings` type is defined in `packages/shared/src/types.ts`:

```typescript
interface RedundancySettings {
  /** Master toggle. When false, no redundancy computation occurs. Defaults to false. */
  enabled: boolean;
  /** Active engagement stage. "annotation" shows what-if penalties without modifying primary score.
      "integrated" applies the penalty to the primary fitness score. Defaults to "annotation". */
  stage: "annotation" | "integrated";
  /** Minimum cosine similarity for two games to be considered niche neighbors. Range [0.0, 1.0]. Default 0.6. */
  similarityThreshold: number;
  /** Maximum penalty in fitness points. Range [0.5, 5.0]. Default 2.0. */
  maxPenalty: number;
  /** Weights for each component of the feature vector when computing pairwise similarity. */
  componentWeights: ComponentWeights;
  /** Minimum number of niche neighbors (games above threshold) before penalties apply. Default 1. */
  minNeighbors: number;
}
```

The `ComponentWeights` type is the existing type from `feature-vector.ts` (`{ binary: number; continuous: number; personalAxes: number }`), already exported from that module. It is re-exported from `types.ts` for shared consumption.

- REQ-REDUN-2: Default values for `RedundancySettings`:

```typescript
const DEFAULT_REDUNDANCY_SETTINGS: RedundancySettings = {
  enabled: false,
  stage: "annotation",
  similarityThreshold: 0.6,
  maxPenalty: 2.0,
  componentWeights: { binary: 0.4, continuous: 0.3, personalAxes: 0.3 },
  minNeighbors: 1,
};
```

The `enabled` flag defaults to `false`. Simplicity wins by default (Vision tension table: "Collection-aware fitness vs simplicity"). The user opts in when ready.

- REQ-REDUN-3: `RedundancySettings` are persisted to `~/.shelf-judge/data/redundancy-settings.json` following the `PredictionSettings` storage pattern in `storage-service.ts:176-189`. The storage service gains `loadRedundancySettings()` and `saveRedundancySettings()` methods. When the file does not exist, defaults are returned. Partial writes are not supported; the full settings object is always written.

- REQ-REDUN-4: `GET /redundancy/settings` returns the current `RedundancySettings` object. `PATCH /redundancy/settings` accepts a partial settings object, merges it with current settings, validates the result, and persists. Validation rules:
  - `similarityThreshold` must be in [0.0, 1.0]
  - `maxPenalty` must be in [0.5, 5.0]
  - `componentWeights` values must all be >= 0 and sum to > 0
  - `minNeighbors` must be >= 1
  - `stage` must be "annotation" or "integrated"

  Invalid values return 400 with a descriptive error message. The routes live in a new `packages/daemon/src/routes/redundancy.ts` file, registered in the app alongside other route groups.

- REQ-REDUN-5: When `enabled` is `false`, no redundancy computation occurs anywhere. API endpoints that would return redundancy data return null for redundancy fields. The game service skips the redundancy pass entirely. This is a short-circuit, not a "compute then discard."

### Redundancy Engine

- REQ-REDUN-6: The redundancy engine is a pure-function module at `packages/daemon/src/services/redundancy-engine.ts`. It has no service-layer dependencies. It takes scored games, settings, and feature vectors as input; it returns redundancy adjustments as output. It does not read from storage, call other services, or maintain state.

- REQ-REDUN-7: The redundancy engine exposes a primary function:

```typescript
function computeRedundancyAdjustments(
  gamesWithScores: GameWithScore[],
  settings: RedundancySettings,
  getFeatureVector: (game: Game) => FeatureVector,
): Map<string, RedundancyAdjustment>;
```

The `getFeatureVector` callback is provided by the caller (game service or route handler), allowing the engine to consume feature vectors without importing the feature vector module directly. This keeps the engine's test surface clean: tests provide mock vectors without needing the full feature vector infrastructure.

- REQ-REDUN-8: For each non-vetoed game with a fitness score > 0, the engine:
  1. Computes cosine similarity between the game's flattened feature vector and every other non-vetoed game's flattened feature vector, using the `componentWeights` from settings to weight the composite distance components before flattening.
  2. Identifies "niche neighbors": games whose similarity is >= `similarityThreshold`.
  3. If the game has fewer niche neighbors than `minNeighbors`, the game receives zero penalty.
  4. Among niche neighbors, counts how many have a higher fitness score than this game. This count is `betterNeighbors`.
  5. Computes `coverageRatio = betterNeighbors / nicheNeighborCount`.
  6. Computes `penalty = coverageRatio * maxPenalty`.
  7. The adjusted score is `max(1.0, originalScore - penalty)`. The penalty never pushes a score below 1.0.

- REQ-REDUN-9: The game with the highest fitness score among its niche neighbors always receives zero penalty. It has zero `betterNeighbors`, so `coverageRatio` is 0. This is not a special case; it falls out of the formula. This game is the "niche champion" for pairwise redundancy purposes (distinct from the cluster-based niche champion in the niche champion display).

- REQ-REDUN-10: When two or more niche neighbors have identical fitness scores (equal to two decimal places, the computation precision), they are treated as tied. A tied game does not count as "better" than another game at the same score. For example: if games A, B, C are all niche neighbors and A scores 8.0, B scores 8.0, C scores 7.5, then A and B each have 0 `betterNeighbors` (the tie doesn't count) and C has 2 `betterNeighbors`.

- REQ-REDUN-11: Vetoed games (fitness score 0, `vetoed === true`) are excluded from all redundancy computations. They are not considered as niche neighbors, they do not receive penalties, and they do not count toward `betterNeighbors` for other games. A vetoed game's `redundancyAdjustment` is null.

- REQ-REDUN-12: Games with only predicted scores (`predictionMeta !== null` and `predictionMeta.actualAxisCount === 0`) participate in redundancy on the receiving side (they can be penalized) but carry reduced authority as niche references. When a fully-predicted game appears as a niche neighbor of an actual-scored game, it does not count toward `betterNeighbors` even if its predicted score is higher. Rationale: a game the user hasn't rated shouldn't have authority to make a rated game "redundant." A predicted game's own penalty is computed normally (actual-scored neighbors do count against it).

- REQ-REDUN-13: A game's niche neighbors are all games above the similarity threshold, regardless of how many niches (mechanics, categories, families) they share. The penalty reflects the total pairwise landscape, not individual cluster memberships. A game similar to 6 different games across different mechanic groupings has 6 niche neighbors, not one neighbor per cluster.

### RedundancyAdjustment Data Model

- REQ-REDUN-14: A `RedundancyAdjustment` type is defined in `packages/shared/src/types.ts`:

```typescript
interface RedundancyAdjustment {
  /** Penalty amount subtracted from original score. 0 when game is best in niche. */
  penalty: number;
  /** Fitness score before redundancy adjustment. */
  originalScore: number;
  /** Score after adjustment: max(1.0, originalScore - penalty). */
  adjustedScore: number;
  /** Games above the similarity threshold, sorted by similarity descending. */
  nicheNeighbors: RedundancyNeighbor[];
  /** This game's rank among its niche neighbors by fitness (1 = best). */
  nicheRank: number;
  /** Total number of niche neighbors (same as nicheNeighbors.length). */
  nicheSize: number;
}

interface RedundancyNeighbor {
  gameId: string;
  gameName: string;
  /** Cosine similarity to the subject game. */
  similarity: number;
  /** The neighbor's fitness score (before its own redundancy adjustment). */
  fitnessScore: number;
  /** Whether this neighbor's score is entirely predicted. */
  isPredicted: boolean;
}
```

- REQ-REDUN-15: `RedundancyAdjustment` and `RedundancyNeighbor` are shared types consumed by daemon, web, and CLI. The `nicheNeighbors` array is sorted by similarity descending (most similar first). It includes all neighbors above threshold, not a truncated subset. For display purposes, the UI may truncate, but the data is complete.

### FitnessResult Extension

- REQ-REDUN-16: `FitnessResult` gains a new nullable field:

```typescript
interface FitnessResult {
  // ... existing fields unchanged ...
  /** Redundancy adjustment data. Null when redundancy is disabled, game is vetoed, or game has no niche neighbors. */
  redundancyAdjustment: RedundancyAdjustment | null;
}
```

This field is always null when redundancy is disabled (`enabled: false`). When redundancy is enabled, it is null for vetoed games and games with no niche neighbors meeting the threshold. For all other games, it is populated.

### Stage 2: Annotation Mode

- REQ-REDUN-17: When `settings.stage` is `"annotation"`, the `FitnessResult.score` field is **unchanged**. The `redundancyAdjustment` field is populated with the computed penalty, but the penalty is not applied to the primary score. The `adjustedScore` field in `RedundancyAdjustment` shows what the score would be if the penalty were applied. The user sees the primary score as before, with the redundancy annotation as supplemental information.

- REQ-REDUN-18: In annotation mode, the `FitnessResult.score` returned by the daemon is the same value it would be if redundancy were disabled. No downstream consumer (web sorting by fitness, CLI score display, prediction engine reading scores) sees a different primary score. The annotation is advisory.

### Stage 3: Integrated Mode

- REQ-REDUN-19: When `settings.stage` is `"integrated"`, the `FitnessResult.score` field reflects the adjusted score: `max(1.0, originalScore - penalty)`. The `redundancyAdjustment.originalScore` preserves the pre-penalty score. All downstream consumers (sorting, ranking, display) see the adjusted score as the primary fitness score.

- REQ-REDUN-20: In integrated mode, the penalty is applied after all other fitness computations (axis weighting, utility curves, veto checks). The computation order is:
  1. Compute per-game fitness scores (existing pipeline, unchanged).
  2. Run the redundancy pass over all scored games.
  3. Apply penalties to `FitnessResult.score` for each game.
  4. Return results.

  The redundancy pass happens in `game-service.ts`'s `listGames()` method (and `getGame()` for single-game requests) after scores are computed but before results are returned. The `listGames()` method already iterates all games; the redundancy pass is a post-processing step on the collected `GameWithScore[]` array.

- REQ-REDUN-21: For single-game requests (`getGame(id)`), the redundancy penalty still requires computing fitness scores for all games in the collection, because the penalty depends on pairwise comparison with every other game. The game service computes all scores, runs the redundancy pass, then returns the single requested game's result. This is more expensive than the current single-game path but necessary for correctness. If performance becomes a concern, caching behind the profile dirty flag is the upgrade path, but this spec does not require caching.

### Interaction with Predictions

- REQ-REDUN-22: The prediction endpoint `GET /predictions/bgg/:bggId` gains a `redundancyPreview` field on `PredictedGameResponse`:

```typescript
interface PredictedGameResponse {
  // ... existing fields ...
  redundancyPreview: RedundancyAdjustment | null;
}
```

When redundancy is enabled, this shows what penalty the candidate game would receive if added to the collection. The preview is computed by temporarily including the candidate game in the redundancy pass without persisting it. When redundancy is disabled, this field is null.

- REQ-REDUN-23: The candidate game's redundancy preview is computed against the current collection's pre-redundancy scores. Adding the candidate does not change existing games' penalties in the preview. The preview answers "what penalty would this game receive?" not "how would adding this game change every other game's penalty?" The latter is a more complex computation deferred to a future interaction (see Exit Points).

- REQ-REDUN-24: The prediction engine's computations (`prediction-engine.ts`) do not read or depend on redundancy adjustments. The prediction engine predicts per-game fitness scores; redundancy acts on those scores. The dependency is one-way: redundancy consumes prediction output, predictions do not consume redundancy.

### Interaction with Niche Champion Display

- REQ-REDUN-25: Niche champion display (Stage 1) and redundancy scoring (this spec) are independent features that coexist. Niche champion display uses cluster-based grouping (BGG mechanics, categories, families) and does not modify scores. Redundancy scoring uses pairwise cosine similarity and optionally modifies scores. Neither depends on the other's output.

- REQ-REDUN-26: `NichePosition` (from the niche champion display spec) is unchanged by this spec. The `nichePosition` field on `GameWithScore` continues to reflect cluster-based niche rankings using unmodified fitness scores. In integrated mode (Stage 3), `NichePosition` rankings use pre-redundancy scores to avoid circular dependency: redundancy reads scores to compute penalties, so scores read by niche ranking must be pre-penalty.

### Interaction with Utility Curves and Veto Axes

- REQ-REDUN-27: Redundancy is orthogonal to veto and utility curves. A game that passes all veto thresholds can still be redundant. A game that is unique can still be vetoed. Utility curves shape the fitness score that redundancy reads (the curve's effect is baked into the score before the redundancy pass). These systems compose independently without interaction.

### Daemon API

- REQ-REDUN-28: `GET /games/:id` response includes `redundancyAdjustment` on the `FitnessResult` when redundancy is enabled. The field is null when disabled or when the game has no niche neighbors.

- REQ-REDUN-29: `GET /games` response includes `redundancyAdjustment` on each game's `FitnessResult` when redundancy is enabled. The redundancy pass is computed once for all games, not per-game.

- REQ-REDUN-30: The `GET /redundancy/settings` and `PATCH /redundancy/settings` endpoints are defined in REQ-REDUN-4.

### Web UI: Game Detail

- REQ-REDUN-31: When redundancy is enabled and the game has a non-null `redundancyAdjustment`, the game detail score breakdown gains a "Redundancy" section. This section displays:
  - Original score and adjusted score (e.g., "Fitness: 6.4 (was 7.9, -1.5 redundancy)")
  - Niche rank (e.g., "3rd of 5 similar games")
  - A list of niche neighbors with name, similarity percentage, and fitness score. Each neighbor name links to that game's detail page.
  - When in annotation mode, the section is labeled "Redundancy (preview)" and the primary displayed score is unchanged. The adjusted score is shown as supplemental: "Would be 6.4 with redundancy applied."

- REQ-REDUN-32: When the game receives zero penalty (niche champion by pairwise similarity), the redundancy section shows "Best among similar games" with the neighbor list but no penalty annotation.

- REQ-REDUN-33: When redundancy is disabled, the redundancy section is omitted entirely (not shown empty).

### Web UI: Collection List

- REQ-REDUN-34: When redundancy is enabled in annotation or integrated mode, the collection list gains a "Redundancy-Adjusted" sort option. In annotation mode, this sorts by `redundancyAdjustment.adjustedScore` (the what-if score). In integrated mode, the default fitness sort already uses the adjusted score, but the sort option remains available for clarity.

- REQ-REDUN-35: Each game row in the collection list shows a compact redundancy indicator when redundancy is enabled and the game has a non-null adjustment: a small penalty badge (e.g., "-1.5") next to the fitness score. In annotation mode, the badge is visually distinct (e.g., lighter color, parenthesized) to signal it's advisory. In integrated mode, the badge is shown as part of the score breakdown.

### Web UI: Search Preview

- REQ-REDUN-36: The BGG search prediction preview panel shows the `redundancyPreview` from REQ-REDUN-22 when redundancy is enabled. Below the predicted fitness score, the preview shows: "With redundancy: X.X (-Y.Y)" and lists the top 3 most similar existing games by similarity. When no niche neighbors exist above threshold, show: "No similar games in collection."

### CLI

- REQ-REDUN-37: `shelf-judge game <id>` includes redundancy data when the game has a non-null `redundancyAdjustment`. Text mode shows: penalty, adjusted score, niche rank, and neighbor names. In `--json` mode, the full `RedundancyAdjustment` is included in the `FitnessResult` object.

- REQ-REDUN-38: `shelf-judge scores` reflects the current stage. In annotation mode, scores are primary (unadjusted) with an optional `--show-redundancy` flag that appends adjusted scores. In integrated mode, scores are adjusted by default. In `--json` mode, the full `FitnessResult` (including `redundancyAdjustment`) is always included.

- REQ-REDUN-39: `shelf-judge predict bgg <bgg-id>` includes redundancy preview data in output. Text mode shows the penalty and top 3 similar games. In `--json` mode, the full `RedundancyAdjustment` is included.

- REQ-REDUN-40: The CLI gains `shelf-judge redundancy` subcommands:
  - `shelf-judge redundancy settings` displays current `RedundancySettings` (text or `--json`).
  - `shelf-judge redundancy enable` sets `enabled: true` and returns updated settings.
  - `shelf-judge redundancy disable` sets `enabled: false` and returns updated settings.
  - `shelf-judge redundancy stage <annotation|integrated>` sets the active stage.
  - `shelf-judge redundancy set <key> <value>` updates a single setting (e.g., `shelf-judge redundancy set similarityThreshold 0.7`).

### Web UI: Settings

- REQ-REDUN-41: The web UI provides a redundancy settings panel (location to be determined by the implementer, likely the settings or preferences area). The panel includes:
  - Master enable/disable toggle
  - Stage selector (annotation / integrated) with a description of what each stage does
  - Similarity threshold slider (0.0 to 1.0, default 0.6)
  - Max penalty slider (0.5 to 5.0, default 2.0)
  - Component weight controls for binary, continuous, and personalAxes
  - Minimum neighbors input (1+)
  - A "Reset to defaults" action

  Changes are persisted via `PATCH /redundancy/settings` on change. The panel is always visible regardless of whether redundancy is enabled, so the user can configure before enabling.

## Scope Exclusions

- **Niche champion display changes.** This spec does not modify the niche champion display feature, its types, or its cluster-based niche computation. The two features coexist independently.
- **Ripple effect preview.** The search preview shows the candidate game's own penalty but does not show how adding the game would change existing games' penalties. The brainstorm's interaction map mentions this possibility but the computation is O(N^2) per candidate and the UX for "your collection's scores would shift by these amounts" is undefined. Deferred.
- **Tournament interaction.** The brainstorm notes that a game redundant by fitness but highly-ranked in tournaments is interesting. This spec does not surface tournament-redundancy divergence.
- **LLM narration.** Rich natural-language interpretation of redundancy patterns is deferred to the LLM narration layer.
- **Per-niche penalty caps.** The penalty is global (`maxPenalty`), not per-cluster or per-neighbor. A per-niche cap would require defining niches, which conflicts with the pairwise approach. If users find the global cap too blunt, a future iteration could weight penalty by similarity magnitude (higher similarity = more penalty contribution per neighbor).
- **Caching.** Redundancy is computed on demand. No caching, no dirty flags. The upgrade path (cache behind profile dirty flag) is documented but not implemented.

## Exit Points

| Exit                             | Triggers When                                                                             | Target                              |
| -------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------- |
| Ripple effect preview            | User wants to see how adding a game changes existing games' penalties                     | [STUB: redundancy-ripple-preview]   |
| Tournament-redundancy divergence | User wants to see when tournament results contradict redundancy penalties                 | [STUB: tournament-niche-divergence] |
| LLM narration of redundancy      | Deferred LLM layer interprets redundancy patterns                                         | Extends [DEFERRED: REQ-PROFILE-18]  |
| Redundancy caching               | Performance concern with large collections                                                | [STUB: redundancy-caching]          |
| Similarity-weighted penalty      | Global maxPenalty feels too blunt, users want penalty proportional to similarity strength | [STUB: similarity-weighted-penalty] |

## Success Criteria

### Automated Tests (bun test)

- [ ] `computeRedundancyAdjustments` returns empty map when settings.enabled is false
- [ ] A game with no neighbors above threshold gets null adjustment
- [ ] A game with fewer neighbors than `minNeighbors` gets null adjustment
- [ ] The highest-scoring game among its neighbors receives zero penalty
- [ ] Penalty is proportional to coverageRatio: 0 betterNeighbors = 0 penalty, all better = maxPenalty
- [ ] Penalty never pushes score below 1.0
- [ ] Tied games (within 0.01) do not count as "better" than each other
- [ ] Vetoed games are excluded from neighbor lists and do not receive adjustments
- [ ] Fully-predicted games do not count toward `betterNeighbors` for actual-scored games
- [ ] Fully-predicted games are penalized normally by actual-scored neighbors
- [ ] `componentWeights` correctly influence which games are considered similar (binary-heavy weights group mechanic-similar games; continuous-heavy weights group weight/player-count-similar games)
- [ ] Changing `similarityThreshold` changes which games are niche neighbors
- [ ] In annotation mode, `FitnessResult.score` is unchanged; `redundancyAdjustment.adjustedScore` reflects penalty
- [ ] In integrated mode, `FitnessResult.score` equals `redundancyAdjustment.adjustedScore`
- [ ] `redundancyAdjustment.originalScore` always equals the pre-penalty fitness score regardless of stage
- [ ] Niche neighbors are sorted by similarity descending
- [ ] Redundancy adjustments are deterministic (identical input produces identical output)
- [ ] `GET /redundancy/settings` returns defaults when no settings file exists
- [ ] `PATCH /redundancy/settings` validates ranges and returns 400 for invalid values
- [ ] `PATCH /redundancy/settings` merges partial updates correctly
- [ ] `GET /games/:id` includes redundancyAdjustment when enabled, null when disabled
- [ ] `GET /games` includes redundancyAdjustment on all games when enabled
- [ ] `GET /predictions/bgg/:bggId` includes redundancyPreview when enabled
- [ ] Redundancy preview for a candidate game computes against pre-redundancy collection scores
- [ ] NichePosition rankings use pre-redundancy scores even in integrated mode

### Manual Verification

- [ ] Game detail page shows "Redundancy (preview)" section in annotation mode with correct penalty, neighbors, and niche rank
- [ ] Game detail page shows "Redundancy" section in integrated mode with adjusted primary score
- [ ] Toggling redundancy off removes the redundancy section entirely
- [ ] Collection list "Redundancy-Adjusted" sort orders games by adjusted score
- [ ] Penalty badges on collection list distinguish between annotation (advisory) and integrated (applied) modes
- [ ] Search preview shows redundancy impact for a candidate game with 3+ similar games in collection
- [ ] Redundancy settings panel allows configuring all settings and persists on change
- [ ] Changing stage from annotation to integrated visibly changes primary scores in collection list
- [ ] CLI `shelf-judge redundancy settings` displays current settings
- [ ] CLI `shelf-judge redundancy enable` / `disable` toggles the feature
- [ ] CLI `shelf-judge game <id>` includes redundancy data in text and JSON output

## AI Validation

**Defaults** (apply unless overridden):

- Unit tests with mocked time/network/filesystem
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom:**

- Redundancy engine tested against a hand-constructed collection (6-8 games, known feature vectors, known fitness scores) with expected penalties computed manually
- Test case: 3 games with identical fitness scores and high mutual similarity, verifying all receive zero penalty (no game is "better")
- Test case: a fully-predicted game scoring higher than an actual-scored game in the same niche, verifying the actual-scored game is not penalized by the predicted game
- Test case: a game with 5 neighbors where 3 score higher, verifying penalty is `(3/5) * maxPenalty`
- Test case: annotation mode returns unmodified `FitnessResult.score` and populated `redundancyAdjustment`
- Test case: integrated mode returns modified `FitnessResult.score` equal to `adjustedScore`
- When adding redundancy routes to the daemon, verify that both web proxy route and CLI client helper are updated in the same change (per tournament retro lesson)
- Verify that `NichePosition` rankings are computed from pre-redundancy scores, not post-penalty scores, to avoid circular dependency
- Verify that disabling redundancy returns null for all redundancy fields without computing pairwise similarities (performance short-circuit)

## Constraints

- The fitness formula (`sum(effective_rating * weight) / sum(weights)`) does not change. Redundancy is a post-processing step on the computed score, not a modification to the per-axis formula.
- `FitnessResult` gains exactly one new field: `redundancyAdjustment: RedundancyAdjustment | null`. No other fields are added or modified.
- The redundancy engine is a pure-function module. No service-layer dependencies, no storage access, no state.
- `NichePosition` (niche champion display) is unchanged. Cluster-based niche rankings and pairwise redundancy penalties are independent systems.
- The `CollectionProfile` type and profile computation are not modified. The redundancy engine reads feature vectors from the feature vector module, not from the profile.
- Performance: pairwise similarity is O(N^2) where N is collection size. For a 200-game collection, this is 40,000 similarity computations per request. Each is a dot product on ~75-dimension vectors, well under 1ms total. No performance concern anticipated at current scale. If collections grow significantly, caching is the upgrade path (see Exit Points).
- Redundancy computation requires all games' fitness scores. `getGame()` for a single game must compute all scores to determine the penalty. This is a known cost of collection-aware scoring.

## Open Questions

1. **Component weight UX.** The three component weights (binary, continuous, personalAxes) are meaningful to a user who understands feature vectors but opaque to one who doesn't. The settings panel should label them in user terms ("Mechanics & Categories", "Weight & Player Count", "Your Personal Ratings") but the question is whether exposing three sliders is the right UX or whether presets ("mechanic-focused", "balanced", "rating-focused") would be more approachable. The spec defines the data model; the implementer has latitude on presentation.

2. **Annotation mode sort stability.** In annotation mode, sorting by "redundancy-adjusted fitness" creates a different ordering than the primary fitness sort. If the user is accustomed to the primary sort and switches to redundancy-adjusted, games shuffle. This is correct behavior (the feature's purpose is to reveal a different ranking) but could be surprising. Consider whether the sort toggle needs a confirmation or explanation tooltip.

## Context

- [Brainstorm: Redundancy and Collection-Awareness Scoring](.lore/brainstorms/redundancy-scoring.md): Proposal 1 (pairwise penalty), Proposal 4 (settings), and Proposal 6 (graduated engagement) are the direct sources. The brainstorm recommends pairwise over cluster-based because it captures the gradient of similarity.
- [Spec: Niche Champion Display](.lore/specs/niche-champion-display.md): Stage 1 of the graduated approach. This spec is Stages 2 and 3. The niche champion display's cluster-based niches and this spec's pairwise penalties are complementary, not competing.
- [Vision](.lore/vision.md): Principle 5 ("The shelf has a carrying capacity") is the driver. Principle 2 (the penalty is fully transparent: original score, penalty amount, neighbors, rank). Principle 1 (the user controls whether and how redundancy affects scores). Tension table: "Collection-aware fitness vs simplicity" defaults to simplicity; the `enabled` toggle respects this.
- [Spec: Prediction Engine](.lore/specs/prediction-engine.md): Establishes the `PredictionSettings` pattern (REQ-PRED-25a) that `RedundancySettings` follows. Prediction output is consumed by redundancy (one-way dependency).
- [Design: MVP Fitness Model](.lore/designs/mvp-fitness-model.md): Defines `FitnessResult` and the scoring formula. This spec extends `FitnessResult` with one nullable field but does not modify the formula.
- [Issue: Deferred Redundancy Scoring](.lore/issues/deferred-redundancy-scoring.md): The issue that triggered the brainstorm and this spec.
