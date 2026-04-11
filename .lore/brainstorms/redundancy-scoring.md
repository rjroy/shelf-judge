---
title: "Redundancy and Collection-Awareness Scoring"
date: 2026-04-11
status: open
tags: [brainstorm, fitness, redundancy, scoring, collection-awareness]
related:
  - .lore/issues/deferred-redundancy-scoring.md
  - .lore/vision.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/specs/collection-profiling.md
  - .lore/specs/prediction-engine.md
  - .lore/brainstorms/prediction-engine.md
  - .lore/brainstorms/collection-profiling.md
---

# Brainstorm: Redundancy and Collection-Awareness Scoring

## Header

**Vision status:** Active. Four-step alignment analysis applied to each proposal.

**Context scanned:**

- `.lore/vision.md` (Principle 5: "the shelf has a carrying capacity")
- `.lore/designs/mvp-fitness-model.md` (weighted average per game, independent)
- `.lore/specs/collection-profiling.md` (feature vectors, centroid, Jaccard distance, outlier detection)
- `.lore/specs/prediction-engine.md` (k-NN similarity, cosine similarity, feature vectors)
- `.lore/brainstorms/prediction-engine.md` (interaction map mentions redundancy uses same overlap primitives)
- `.lore/brainstorms/collection-profiling.md` (Proposal 5: outlier detection via composite distance)
- `packages/daemon/src/services/feature-vector.ts` (vocabulary, encoding, Jaccard, Manhattan, cosine, centroid)
- `packages/daemon/src/services/fitness-service.ts` (per-game weighted average, veto, curve integration)
- `packages/daemon/src/services/prediction-engine.ts` (k-NN, confidence levels, similarity-weighted average)
- `packages/daemon/src/services/profile-engine.ts` (BGG clustering, outlier detection, axis distributions)
- `packages/shared/src/types.ts` (FitnessResult, FitnessBreakdownEntry, GameWithScore)

**Recent brainstorm check:** Four prior brainstorms exist. `prediction-engine.md` (resolved) names redundancy in its interaction map: "the same mechanic/category overlap computation that k-NN's similarity function uses." `collection-profiling.md` (resolved) built the feature vector module and composite distance that redundancy would consume. `fitness-model-options.md` (resolved) explored collection-aware scoring in Approach 3 (profile similarity), where redundancy was a motivating concern. No prior brainstorm addresses redundancy directly.

---

## The Shape of the Problem

The fitness model treats each game as an island. A game's score depends on its own axis ratings, its own BGG data, and its own utility curve transformations. The collection could contain five nearly identical worker-placement games and each would score identically, because the model doesn't know (or care) that the others exist.

Vision Principle 5 says this is wrong: "A fifth worker-placement game isn't as fit as the first, even if it's individually excellent." The shelf has a carrying capacity. Fitness is relative.

The infrastructure to detect overlap already exists. The profiling spec built `feature-vector.ts` with Jaccard distance on binary attributes (mechanics, categories), normalized Manhattan on continuous attributes (weight, player count, play time), cosine similarity on flattened vectors, and centroid computation. The prediction engine uses cosine similarity to find k-nearest neighbors. The profile engine uses composite distance to detect outliers. Redundancy scoring is the third consumer of this same infrastructure, pointed at the question: "How much of this game's niche is already covered by games I own?"

Three structural constraints shape what redundancy can look like:

1. **The fitness formula is sacred.** `sum(effective_rating * weight) / sum(weights)` does not change. Redundancy cannot alter the per-axis math. It must act on the final score or alongside it.

2. **Transparency is non-negotiable.** Vision Principle 2 requires that every component of the fitness score is crackable. If redundancy lowers a score from 7.9 to 6.4, the user must be able to see why: which games overlap, on what dimensions, and by how much.

3. **The penalty must be symmetric.** If Game A is redundant with Game B, Game B is also redundant with Game A. The system must handle this coherently, not arbitrarily penalize one over the other.

---

## Proposal 1: Post-Score Redundancy Penalty via Pairwise Similarity

### Evidence

`cosineSimilarity` in `feature-vector.ts:289-303` computes similarity between flattened feature vectors. `compositeDistance` in `feature-vector.ts:205-240` computes weighted multi-component distance. Both already produce [0,1] values that express how alike two games are.

`FitnessResult` (`types.ts:110-125`) has room for new nullable fields (following the pattern of `predictionMeta` and `hypotheticalScore`). The `FitnessBreakdownEntry` already carries `predictionConfidence` and `referenceGames` as nullable extensions, establishing the pattern.

The fitness service (`fitness-service.ts:46-198`) computes per-game scores independently, then `game-service.ts` assembles the `GameWithScore[]` list. A post-processing step between "compute all scores" and "return results" is the natural insertion point.

### Proposal

After computing all per-game fitness scores, run a redundancy pass over the scored collection. For each game:

1. Find all other scored games with cosine similarity above a threshold (0.6 default). These are the game's "niche neighbors."
2. Among those neighbors, count how many score higher on fitness. These are the games that "cover" this game's niche better.
3. Apply a penalty proportional to the coverage: `redundancyPenalty = coverageRatio * maxPenalty`, where `coverageRatio` is the fraction of niche neighbors that outscore this game, and `maxPenalty` is configurable (default 2.0 points).

The adjusted score is `max(1.0, fitnessScore - redundancyPenalty)`. The penalty never pushes below 1.0.

The best game in its niche (highest fitness among its neighbors) receives zero penalty. The second-best receives a small penalty. The fifth-best receives a larger one. This implements "the first worker-placement game is more fit than the fifth" directly.

**Breakdown integration:** A new nullable `redundancyAdjustment` field on `FitnessResult`:

```typescript
interface RedundancyAdjustment {
  penalty: number;
  originalScore: number;
  nicheNeighbors: {
    gameId: string;
    gameName: string;
    similarity: number;
    fitnessScore: number;
  }[];
  nicheRank: number; // 1 = best in niche
  nicheSize: number;
}
```

The user sees: "Fitness: 6.4 (was 7.9, redundancy penalty -1.5). Niche: 3rd of 5 similar games. Similar games: Agricola (8.1), Caverna (7.9), [this game] (7.9 -> 6.4), A Feast for Odin (7.2 -> 5.9), Fields of Arle (6.8 -> 5.2)."

### Why pairwise similarity as the core

The alternatives are cluster-based (group games into discrete niches, penalize within clusters) or centroid-based (measure distance from collection center). Pairwise similarity is better here because niches don't have clean boundaries. A game can be 0.85 similar to one game, 0.72 to another, and 0.45 to a third. Pairwise captures the gradient; clustering forces a binary "same niche / different niche" cut that the data doesn't support.

Pairwise also produces the best explanation. "These 4 games are similar to you, and 3 of them score higher" is more legible than "you're in Cluster 7 with 4 other games."

### Vision alignment

1. **Anti-goal check.** Does not recommend purchases or disposals. Shows the user which games overlap and where each ranks. Passes.
2. **Principle alignment.** Principle 5 directly ("the shelf has a carrying capacity"). Principle 2 (the penalty is fully transparent: original score, penalty amount, niche neighbors, niche rank). Principle 1 (the penalty is based on the user's own fitness scores, not BGG rankings).
3. **Tension resolution.** "Collection-aware fitness vs simplicity" from the tension table defaults to simplicity "until the user has enough rated games for redundancy detection to be meaningful." This proposal respects that: redundancy requires scored games to compare against. The vision doesn't set a gate, so the implementation should activate when at least 2 games share a niche (similarity > threshold).
4. **Constraint check.** No new external dependencies. Computation is local. Uses existing feature vector infrastructure.

### Scope: Medium

New pure-function module (redundancy engine), extended FitnessResult type, post-processing hook in the scoring pipeline, UI for niche breakdown display, CLI output extension.

---

## Proposal 2: Integrated Redundancy as a Virtual Axis

### Evidence

The fitness formula is `sum(effective_rating * weight) / sum(weights)`. Every component of the score is an axis rating with a weight. The user already controls what dimensions matter through axis configuration (`Axis` type in `types.ts:64-78`).

Utility curves (`curve-engine.ts`) transform raw values into effective ratings on any axis. The "sweet spot" curve already implements the idea that an attribute has an optimal value and deviations are penalized. This is exactly what redundancy describes: there's an optimal amount of overlap (maybe one or two similar games for variety), and deviation from that is penalized.

### Proposal

Introduce a system-managed "Uniqueness" axis that the user can optionally enable. When enabled, it appears in the fitness breakdown like any other axis: name, weight, rating, contribution.

The rating for the Uniqueness axis is computed per game:

1. Compute cosine similarity between this game and every other game in the collection.
2. Count games above a similarity threshold (0.6 default). This is the "niche density."
3. Map niche density to a 1-10 rating: 0 similar games = 10 (completely unique), 1 = 8, 2 = 6, 3+ = linear decay toward 1. The mapping curve is configurable via a utility curve on the axis.

The Uniqueness axis participates in the fitness formula like any other axis. The user controls its weight. Setting weight to 0 disables redundancy scoring entirely. Setting it high makes uniqueness a dominant factor.

**Breakdown integration:** No special types needed. The existing `FitnessBreakdownEntry` structure handles it: `{ axisId: "uniqueness", axisName: "Uniqueness", rating: 6.0, weight: 15, contribution: 0.9, source: "bgg" }`. The user can expand the breakdown and see what drove the rating (niche density, similar games).

### Why a virtual axis

This approach has a structural elegance: it doesn't require any new scoring concepts. The fitness formula stays unchanged. The breakdown stays unchanged. The user controls redundancy through the same weight mechanism they already understand. A user who doesn't care about redundancy sets weight to 0 or doesn't enable the axis. A user who cares deeply sets it to 40%.

It also interacts naturally with utility curves. The user could configure a "sweet spot" curve on the Uniqueness axis: "I want 1-2 games in each niche (rating peaks at niche density = 1), but zero is also fine (unique game), and 4+ is too many (penalty)." The curve engine already handles this shape.

### What it sacrifices

The penalty is indirect. A uniqueness rating of 4 on a weight-15 axis doesn't tell the user "your score dropped 1.5 points because of redundancy." It says "uniqueness contributed 0.6 points to your 7.2 score." The connection between "you own three similar games" and "this game lost fitness" requires the user to understand that a low uniqueness rating means high overlap. This is less immediately legible than Proposal 1's explicit penalty.

It also conflates two different things in the weighted average: subjective quality dimensions (how much your wife likes it) and a structural property of the collection (how many similar games you own). Whether these should mix in the same formula is a judgment call.

### Vision alignment

1. **Anti-goal check.** Passes.
2. **Principle alignment.** Principle 5 directly. Principle 2 (the uniqueness rating traces to specific similar games). Principle 1 (user controls weight). Principle 4 (BGG data provides features; the user decides how much uniqueness matters).
3. **Tension resolution.** "Collection-aware fitness vs simplicity": this is arguably the simpler approach, since it adds no new scoring concepts. The user might disagree, since the "virtual axis" concept is novel even if the math isn't.
4. **Constraint check.** No new external dependencies. Requires feature vector similarity computation (already available).

### Scope: Medium

New axis type (system-managed), niche density computation (similar to Proposal 1's neighbor finding), integration with axis configuration UI ("enable Uniqueness axis" toggle), utility curve support on the virtual axis.

---

## Proposal 3: Cluster-Then-Rank via Mechanic/Category Grouping

### Evidence

`computeBggClustering` in `profile-engine.ts:158-203` already groups games by mechanics, categories, subdomains, families, and weight ranges. The profile knows "you own 15 Hand Management games" and "you own 3 Wargames." These clusters are the natural definition of "niche."

The prediction engine's `ClusterMembership` type (`prediction-engine.ts:416`) maps cluster names to game ID sets, exactly the data structure redundancy scoring needs.

### Proposal

Define niches using the BGG clustering that the profile already computes. For each cluster (mechanic or category) with 3+ games:

1. Rank the games within that cluster by fitness score, descending.
2. Apply a position-based discount to each game's fitness score within that cluster. The top-ranked game gets no discount. The second gets a small discount. The Nth game gets `discountPerPosition * (N - 1)`, capped at a maximum total discount.
3. A game can belong to multiple clusters (most do). Its redundancy penalty is the maximum penalty across all clusters it belongs to (not the sum, to avoid double-counting).

Default: `discountPerPosition = 0.3`, cap at 2.0. So the 2nd game in a cluster loses 0.3, the 3rd loses 0.6, up to the 7th+ which all lose 2.0.

**Breakdown integration:** Extend `FitnessResult` with a `redundancyAdjustment` field showing: which cluster imposed the penalty, the game's rank within that cluster, and the other cluster members.

### Why clusters instead of pairwise

Clusters produce crisper explanations. "You own 5 Deck Building games. This is your 4th-best" is more intuitive than "this game has 0.73 cosine similarity with Game X and 0.68 with Game Y." The user thinks in terms of mechanics and categories, not vector spaces.

Clusters also handle the "best in niche" question naturally. The top-ranked game in each cluster is the niche champion, and the system can surface this: "Your best Deck Building game is Dominion (8.2). Your shelf can probably carry 2-3; you have 5."

### What it sacrifices

Hard cluster boundaries. "Hand Management" and "Deck Building" are different clusters even though many deck-building games use hand management. A game in both clusters gets penalized based on whichever cluster is more crowded, but the system doesn't capture that these clusters overlap. Pairwise similarity (Proposal 1) handles this gradient naturally; cluster-based does not.

Also, not every mechanic or category is equally discriminating. "Hand Management" appears in 67% of a typical euro-heavy collection; being redundant within that cluster is almost meaningless because the cluster is the collection. The system would need cluster-size normalization or a minimum selectivity filter to avoid penalizing games for sharing a universal mechanic.

### Vision alignment

1. **Anti-goal check.** Passes. Cluster ranking is observation, not a disposal recommendation.
2. **Principle alignment.** Principle 5 directly. Principle 2 (cluster membership and rank are visible). Principle 3 (clusters are the collection's identity expressed through a different lens).
3. **Tension resolution.** Same as Proposal 1. Activated by collection size, not a user toggle.
4. **Constraint check.** No new dependencies. Reads from existing profile clustering data.

### Scope: Small-Medium

Profile clustering already computed. New logic: rank within cluster, compute position-based discount. Extend FitnessResult. UI shows cluster rank. Simpler than Proposals 1 or 2 because the niche definition is pre-existing.

---

## Proposal 4: User-Defined Niche Boundaries via Similarity Threshold

### Evidence

The prediction engine's `PredictionSettings` (`types.ts`) already demonstrates runtime-configurable thresholds: `stageThresholds`, `defaultK`, `minSimilarityThreshold`, `tournamentStabilityBoost`. These are exposed via `GET/PATCH /predictions/settings` (REQ-PRED-25a).

`compositeDistance` in `feature-vector.ts:205-240` accepts configurable `ComponentWeights` with defaults `{ binary: 0.4, continuous: 0.3, personalAxes: 0.3 }`. The relative importance of mechanics vs. weight vs. player count in defining "similar" is already a parameter.

### Proposal

This is an extension that applies to any of the above proposals, not a standalone approach. Whichever scoring mechanism is chosen, expose the following as user-configurable settings:

```typescript
interface RedundancySettings {
  enabled: boolean; // master toggle
  similarityThreshold: number; // default 0.6, how similar two games must be to count as niche neighbors
  maxPenalty: number; // default 2.0, maximum score reduction from redundancy
  componentWeights: ComponentWeights; // which dimensions matter for similarity
  minClusterSize: number; // default 2, minimum niche size before penalties apply
}
```

Persisted to `redundancy-settings.json` alongside `prediction-settings.json` and `tournament-settings.json`.

**The `componentWeights` field is the key differentiator.** A user who thinks mechanics define niches sets `{ binary: 0.8, continuous: 0.1, personalAxes: 0.1 }`. A user who thinks weight class defines niches sets `{ binary: 0.2, continuous: 0.6, personalAxes: 0.2 }`. A user who thinks their personal ratings define uniqueness sets `{ binary: 0.2, continuous: 0.2, personalAxes: 0.6 }`.

The `enabled` toggle addresses the tension table directly: "collection-aware fitness vs simplicity" defaults to simplicity. The user opts in when they're ready.

### Why user control matters here

Redundancy is the most subjective scoring dimension in the system. Whether two games are "redundant" depends on what the user values about each. Two worker-placement games might feel identical to one collector (same mechanic, same weight) and completely different to another (one has a farming theme the user loves, the other has an industrial theme they tolerate). The system can compute similarity along various dimensions; only the user can say which dimensions define "sameness" for their shelf.

The prediction engine learned this lesson: `PredictionSettings` exposes k, similarity threshold, and tournament boost because reasonable people disagree about what constitutes "similar enough" and "confident enough." Redundancy settings follow the same pattern.

### Vision alignment

1. **Anti-goal check.** Settings empower the user's judgment, not automate decisions. Passes.
2. **Principle alignment.** Principle 1 ("ownership is personal") directly. The user defines what "redundant" means for their collection. Principle 4 (data serves judgment).
3. **Tension resolution.** The enabled toggle IS the tension resolution for "collection-aware vs simplicity." Simplicity wins by default. The user chooses when to engage complexity.
4. **Constraint check.** Follows existing settings patterns. No new dependencies.

### Scope: Small

Settings type, persistence, API endpoints. Follows the exact pattern of `PredictionSettings`. The settings feed into whichever computation model is chosen.

---

## Proposal 5: Niche Champion Display Without Score Modification

### Evidence

The profiling spec (REQ-PROFILE-4) already computes attribute clustering: mechanics, categories, families, subdomains, weight ranges. The profile page already surfaces "you own 15 Hand Management games." What it doesn't surface is "and Wingspan is your best one."

The fitness model's score for each game is already computed and cached via `GameWithScore[]` in the `game-service.ts` responses. Ranking within a niche requires only sorting an existing list by an existing field.

### Proposal

Instead of modifying the fitness score, surface redundancy as a read-only annotation alongside the score. For each game, identify which niches it belongs to and where it ranks within each.

The game detail view gains a "Niche Position" panel:

```
Niche: Hand Management (15 games)
  Rank: #3 of 15  |  Champion: Wingspan (8.4)
  Next: Agricola (8.1)  |  Below: 7 Wonders Duel (7.6)

Niche: Card Game (8 games)
  Rank: #2 of 8  |  Champion: 7 Wonders Duel (8.0)
```

The collection list view gains optional "niche rank" columns or a "show redundancy" mode that groups games by niche and highlights which are the champions.

No penalty. No score modification. The user sees the information and draws their own conclusions. This is "data serves judgment, not replaces it" applied literally.

### Why no penalty

The argument for score modification is that it implements Principle 5 mechanically. The argument against is that redundancy is too subjective for the system to get right automatically. A user might own three worker-placement games and value all three for different reasons that the feature vectors can't capture: one for solo play, one for game night, one for the art. Penalizing the third because the vectors overlap could feel arbitrary to a user who sees them as serving different shelf slots.

The niche display gives the user the same information a penalty would encode, just without the system asserting a conclusion. The user can look at "you own 5 Deck Building games, this is your 4th-best" and decide for themselves whether that means something should go.

This is also the safest starting point. If users want automated penalties, the system can add them later. If the system starts with penalties and users find them annoying, removing them is a breaking change to every displayed score.

### Vision alignment

1. **Anti-goal check.** Explicitly avoids automated decisions. Maximally aligned with "data serves judgment."
2. **Principle alignment.** Principle 5 (the user sees carrying capacity). Principle 2 (niche membership is transparent). Principle 4 (shows data, doesn't decide).
3. **Tension resolution.** This is the "simplicity" side of the tension. The information is available; the scoring stays simple. The user can mentally apply a "redundancy discount" when evaluating their shelf.
4. **Constraint check.** No score formula changes. No new computation beyond sorting existing data by existing scores within existing clusters. Minimal blast radius.

### Scope: Small

Profile clustering already computed. Fitness scores already computed. New logic: rank within cluster. New UI: niche position panel on game detail, niche view on collection page. No type changes to FitnessResult.

---

## Proposal 6: Hybrid Approach with Graduated Engagement

### Evidence

The prediction engine's cold start progression (REQ-PRED-19) demonstrated that features with subjective thresholds work better when they start conservatively and give the user control over escalation. The prediction engine starts at "no predictions" and progresses through stages as the data grows. Users never see a prediction they didn't implicitly opt into by rating enough games.

Proposals 1 and 5 represent two ends of a spectrum: full score modification vs. pure display. The same user might want different things at different stages of their curation journey. A new user with 20 games wants to see overlap patterns. A power user with 200 games who has been using redundancy annotations for months might be ready for automated score adjustments.

### Proposal

Implement redundancy as a three-stage feature that the user escalates through:

**Stage 1: Niche Display (default).** Proposal 5. No score modification. Niche membership and ranking are visible on game detail pages and the collection list. The user sees "3rd of 5 in Deck Building." This ships with the initial implementation.

**Stage 2: Redundancy Annotations.** A user-enabled mode that adds a "redundancy impact" annotation to each game's score display. The annotation shows what the score would be if a penalty were applied, without actually changing the stored or primary score. The game detail view shows: "Fitness: 7.9 | With redundancy: 6.4 (-1.5)." The collection list can be sorted by "redundancy-adjusted fitness" as an alternative sort order. The primary score remains unmodified.

**Stage 3: Integrated Redundancy.** The user enables redundancy as a scoring component (either Proposal 1's post-score penalty or Proposal 2's virtual axis, that's an implementation decision at this stage). The adjusted score becomes the primary fitness score. The original score is still visible in the breakdown as `originalScore`.

The user escalates by explicit action: a setting in the redundancy configuration panel. The system never auto-escalates. Each stage is fully functional on its own.

### Why graduated

Redundancy is the first feature that changes a game's fitness score for reasons outside the game's own ratings. Every other component of the fitness score is about the game itself. Redundancy says "this game is less fit because of other games." That's a category shift, and users should opt into it deliberately rather than discovering their scores changed because a new feature shipped.

The three stages also serve as a testing ground. Stage 1 (niche display) has zero risk: it adds information without changing anything. Stage 2 (annotations) lets the user preview the penalty model before committing. Stage 3 (integration) only activates after the user has seen the penalties and decided they're reasonable.

### Vision alignment

1. **Anti-goal check.** The graduation model maximizes user control. Passes.
2. **Principle alignment.** All principles satisfied at every stage. Each stage adds transparency (Principle 2) without removing user agency (Principle 4).
3. **Tension resolution.** "Collection-aware fitness vs simplicity" defaults to simplicity (Stage 1). The user escalates. This is the clearest implementation of the tension table's instruction.
4. **Constraint check.** Stage 1 requires no formula changes. Stage 2 is display-only. Stage 3 is the only stage that modifies the scoring pipeline, and it requires explicit opt-in.

### Scope: Medium-Large (total), Small per stage

Stage 1 is Small (Proposal 5). Stage 2 is Small (annotation computation is the same math as the penalty, just not applied to the stored score). Stage 3 is Medium (scoring pipeline integration). Shipping incrementally means each stage is independently reviewable.

---

## Edge Cases

These apply to any proposal that modifies or annotates scores. Whichever approach is chosen, these must be addressed.

### The best game in its niche

When a game is the highest-fitness game among all its niche neighbors, it receives zero redundancy penalty (Proposals 1, 3, 6) or maximum Uniqueness rating per its niche count (Proposal 2). This is correct. The best game in a crowded niche earned its position; the niche is crowded because the user likes this kind of game.

### Mutual redundancy

If Game A and Game B have nearly identical fitness scores (within 0.1) and high similarity, which one takes the penalty? In Proposal 1, both take similar penalties because they have similar numbers of higher-scoring neighbors. In Proposal 3, the tiebreaker is alphabetical or by date added (arbitrary but deterministic). The important thing: the system never claims one is "better" when the scores are essentially tied. Both should show similar redundancy impacts, and the user resolves the tie.

### A game in many niches

A game that touches multiple mechanics (say, "Hand Management + Deck Building + Card Drafting") participates in multiple niche calculations. Proposal 1 handles this naturally: the penalty is based on all pairwise similarities, which already incorporate multi-dimension overlap. Proposal 3 takes the maximum penalty across clusters, not the sum, to avoid punishing versatility. Proposal 2 counts unique similar games regardless of which dimension they're similar on.

### Vetoed games

A game with fitness score 0 (vetoed) should not be a niche neighbor that imposes redundancy on other games. It's on the shelf but the user has declared it unfit. It shouldn't penalize games that are actually valued.

### Games with only predicted scores

A game whose fitness is entirely predicted (no personal axis ratings) should participate in redundancy calculations on the "receiving" side (it can be penalized for being similar to rated games) but its predicted score should carry lower weight as a niche reference. A game the user hasn't actually rated shouldn't have authority to make a rated game "redundant."

### Interaction with utility curves and veto axes

Redundancy is orthogonal to veto. A game that passes all veto thresholds can still be redundant. A game that's unique in the collection can still be vetoed. These compose independently.

Utility curves already shape the fitness score that redundancy reads. A game whose "complexity sweetspot" curve gives it an effective 9 on that axis will have a higher base score, which positions it higher in its niche. The curve's effect is already baked into the score that redundancy ranks.

---

## Interaction Map

**Profiling:** The profile's BGG clustering (`computeBggClustering`) provides the niche definitions for Proposals 3 and 5. The profile's feature vectors provide the similarity computation for Proposals 1 and 2. Redundancy scoring is a consumer of profiling, not a replacement.

**Prediction:** Predicted games participate in redundancy. A game the user is considering adding (via search preview) should show its redundancy impact: "If you add this, it would be your 4th Deck Building game, predicted fitness 7.2, niche rank #3." The prediction engine's similarity computation (`cosineSimilarity` on flattened vectors) is reusable for redundancy neighbor-finding.

**Tournament:** Tournament data doesn't directly feed redundancy, but the profiling brainstorm's divergence analysis could intersect: a game that's redundant AND a tournament outlier (high ELO despite low niche position) is particularly interesting. "This is your 4th-best Deck Building game by fitness, but in tournaments you consistently pick it over the top 3."

**LLM Narration (deferred):** Redundancy data is rich material for the deferred LLM narration layer. "Your collection has three distinct niches that are crowded: medium-weight euro (7 games), deck building (5 games), and co-op (4 games). Your shelf could breathe easier if you culled the bottom of any of these."

---

## Implementation Sequence

The proposals have a natural dependency chain but are not mutually exclusive:

1. **Proposal 4 (Settings)** ships with any approach. Defines the configuration surface.
2. **Proposal 5 (Niche Display)** or **Proposal 6 Stage 1** ships first. Zero risk, pure information. Validates that niche identification works before any score modification.
3. **Proposal 1 (Pairwise Penalty)** or **Proposal 3 (Cluster Rank)** ships second, behind a toggle (Proposal 4's `enabled` flag). The choice between these is a design decision: pairwise is more precise but harder to explain; cluster is coarser but more intuitive.
4. **Proposal 2 (Virtual Axis)** is an alternative to Proposals 1 and 3, not a complement. Pick one score modification approach.
5. **Proposal 6 (Graduated)** is a delivery strategy more than a technical proposal. It wraps Proposals 5 and (1 or 3) into a staged rollout.

My recommendation: **Start with Proposal 5 (or 6 Stage 1), then ship Proposal 1 behind a toggle.** Pairwise similarity is more honest than cluster ranking because it respects the gradient of similarity rather than forcing discrete boundaries. The existing `cosineSimilarity` function on flattened feature vectors is already the right primitive. Proposal 4's settings give the user control over thresholds. Proposal 6's staged approach gives them control over engagement depth.

Proposal 2 (virtual axis) is elegant but conflates structural and qualitative dimensions in the weighted average. It also makes it harder for the user to ask "what would my score be without redundancy?" because the uniqueness axis is entangled with every other axis in the weighted average. Proposal 1's explicit penalty keeps the separation clean: the score breakdown shows the original score, the penalty, and the adjusted score as distinct things.
