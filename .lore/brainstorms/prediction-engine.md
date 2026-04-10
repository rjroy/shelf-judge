---
title: "Prediction Engine for Unrated Games"
date: 2026-04-09
status: approved
tags: [brainstorm, prediction, fitness, similarity, bgg]
related:
  - .lore/issues/deferred-prediction-engine.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/specs/utility-curves.md
  - .lore/brainstorms/fitness-model-options.md
  - .lore/issues/deferred-collection-profiling.md
  - .lore/issues/deferred-redundancy-scoring.md
  - .lore/vision.md
---

# Prediction Engine for Unrated Games

## Header

**Vision status:** Active. Four-step alignment analysis applied to each proposal below.

**Context scanned:**

- `.lore/vision.md` (5 principles, 3 anti-goals, tension table)
- `.lore/designs/mvp-fitness-model.md` (weighted average scorecard, implemented)
- `.lore/specs/utility-curves.md` (preference shapes, veto, native scales, approved)
- `.lore/plans/utility-curves.md` (implementation plan, 6 phases)
- `.lore/brainstorms/fitness-model-options.md` (5 approaches, hybrid conclusion)
- `.lore/issues/deferred-prediction-engine.md`, `deferred-collection-profiling.md`, `deferred-redundancy-scoring.md`, `deferred-tournament-ranking.md` (resolved)
- `packages/shared/src/types.ts` (current types: Game, BggGameData, Axis, FitnessResult, TournamentData)
- `packages/daemon/src/services/fitness-service.ts` (calculateScore, resolveBggRawValue, curve integration)
- `packages/daemon/src/services/bgg-client.ts` (searchGames, getGame, getGames, getUserCollection)
- Recent git history (utility curves implementation in progress, tournament ranking implemented)

**Recent brainstorm check:** `fitness-model-options.md` explored prediction in each of its five approaches. Approach 1 proposed nearest-neighbor estimation from similar rated games for missing personal axes. Approach 3 proposed cosine similarity against a taste profile vector. Approach 4 noted that utility curves strengthen prediction by converting BGG continuous data into personal value with explicit semantics. This brainstorm does not repeat those descriptions; it builds on them with concrete proposals grounded in the system as it exists today.

---

## The Shape of the Problem

The fitness model as implemented answers one question: "How fit is this game, given the ratings I've entered for it?" Prediction answers the adjacent question: "How fit would this game probably be, if I rated it?"

The gap between these two questions is the gap between data the user has provided (personal axis ratings) and data the system already has (BGG mechanics, categories, weight, player counts, families, community rating, suggested player counts). Every owned game with personal ratings becomes a training example: "Given these BGG attributes, the user rated this game X on axis Y." The prediction engine learns that mapping and applies it to games without personal ratings.

Three things constrain what prediction can look like in this system:

1. **The fitness model is a weighted average of per-axis ratings.** Prediction must produce per-axis estimates, not just an aggregate number, because the breakdown is non-negotiable (Vision Principle 2). A predicted fitness score without a predicted breakdown violates the system's core promise.

2. **Utility curves transform raw values into effective ratings.** After utility curves land, prediction gets richer: a user who configures "sweet spot at BGG weight 2.75, strict tolerance" has explicitly declared how they value complexity. The curve IS the prediction function for that axis. No estimation needed; the user already told the system what any complexity value means to them.

3. **The tournament ranking already captures revealed preference.** Tournament ELO scores represent which games the user actually prefers when forced to choose. This is a separate signal from axis ratings, and a prediction engine can use both.

---

## Proposal 1: Curve-First Prediction for BGG-Derived Axes

*USER NOTE:* Won't provide enough useful information. 

### Evidence

The utility curves spec (REQ-CURVE-4) defines preference shapes that map native-scale values to effective 1-10 ratings. For BGG-derived axes (community rating, complexity), the curve is a complete prediction function: given a game's BGG weight, the user's configured sweet spot and tolerance directly produce the effective rating. No estimation, no similarity matching, no minimum collection size.

The `resolveBggRawValue()` function in `fitness-service.ts` already extracts raw BGG values. The curve engine (being built per `utility-curves.md` plan) already transforms them. The only missing piece: applying this to games the user hasn't added to their collection yet.

### Proposal

Extend `calculateScore` to accept a "prediction mode" flag. In prediction mode, for BGG-derived axes, the system resolves raw values from the game's BGG data and applies the configured curves exactly as it does for owned games. The result is a real, fully transparent per-axis score, not an estimate.

For personal axes in prediction mode, the entry is left as "not rated" (excluded from the calculation), exactly as current behavior for owned games with missing ratings. The predicted fitness score is partial: it uses only the axes that have data. The breakdown shows which axes contributed and which are unknown.

This gives users immediate, zero-estimation prediction for any BGG game, gated only by how many of their axes are BGG-derived. A user with Community Rating (weight 10), Complexity (weight 20), and two personal axes (weight 40 and 30) gets prediction coverage on 30% of their total weight from day one, with honest "not rated" markers on the rest.

### Rationale

This is the simplest prediction that isn't a guess. It uses the user's own declared preferences (curves) applied to real data (BGG values). No training data needed. No similarity assumptions. The breakdown is fully transparent because there's nothing hidden: "BGG weight 2.9, your sweet-spot curve maps this to 8.4."

It also establishes the prediction API shape that later proposals extend. Whatever estimation strategy handles personal axes, it produces the same `FitnessBreakdownEntry` structure with additional metadata indicating the source is "predicted" rather than "personal" or "bgg."

### Vision Alignment

- **Anti-goal check:** Does not automate purchase decisions. Shows data through the user's preference lens. Passes.
- **Principle alignment:** Directly serves Principle 2 (transparent derivation) and Principle 4 (data serves judgment). The score is crackable because it IS the user's curves applied to BGG data.
- **Tension resolution:** Prediction honesty > coverage (tension table row 4). Partial prediction with honest gaps satisfies this. The system says "I can score complexity and community rating for this game; I can't score your personal axes without your input."
- **Constraint check:** No social features, no BGG replacement. Passes.

### Scope: Small

Extends existing fitness calculation with a mode flag. The curve engine and BGG data resolution already exist. Primary work is API design and client UI to display predicted vs. actual scores.

---

## Proposal 2: Nearest-Neighbor Estimation for Personal Axes

*USER NOTE:* This is exactly what I was envisioning.

### Evidence

`BggGameData` stores `mechanics: BggTag[]`, `categories: BggTag[]`, `families: BggTag[]`, `weight: number | null`, `suggestedPlayerCounts: SuggestedPlayerCount[]`, and `communityRating: number`. These fields exist on every game with BGG data, providing a feature vector for similarity computation.

The user's personal axis ratings (`Game.ratings: Record<string, number>`) provide training labels. A user who rates 25 games on "wife will play it" has 25 labeled examples where the label is their personal assessment and the features are the BGG attributes of each game.

The fitness model brainstorm (Approach 1, prediction section) described this shape: "estimate from similar rated games, weighted by overlap degree." What it didn't specify: what "similar" means concretely, how to encode the feature vector, or how many neighbors to use.

### Proposal

For each personal axis, predict the rating for an unrated game using a weighted k-nearest-neighbor approach:

1. **Feature vector:** Encode each game as a vector of: mechanics (binary flags for each mechanic present in the collection), categories (same), BGG weight (normalized), community rating (normalized), player count range (encoded as min/max tuple). Families could contribute but are noisier; start without them.

2. **Similarity:** Cosine similarity between the target game's feature vector and each rated game's feature vector. Mechanic and category overlap will dominate because they're the highest-dimensionality component.

3. **Estimation:** For axis A, the predicted rating is the similarity-weighted average of axis A ratings across the k most similar rated games (k = 5 to start, adjustable). Only games that have a rating on axis A contribute.

4. **Confidence:** Three inputs determine confidence for each predicted axis rating:
   - Number of similar games that contributed (more is better)
   - Variance of those games' ratings (low variance = high confidence)
   - Average similarity score of the contributing neighbors (closer neighbors = higher confidence)
     These collapse into a "prediction strength" indicator per axis: strong, moderate, or weak.

5. **Breakdown integration:** Each predicted axis entry in the `FitnessBreakdownEntry` carries `source: "predicted"` (new enum value) and additional metadata: number of reference games, average similarity, confidence level. The user can see "predicted 7.2 based on 4 similar games (confidence: moderate)."

### Rationale

k-NN is the right first model because it's interpretable. The user can ask "why did you predict 7 for wife-playability?" and the system can answer "because Azul (similarity 0.87, rated 8), Patchwork (0.81, rated 7), and Kingdomino (0.79, rated 6) are your most similar rated games on that axis." The reference games are the explanation. No black box.

It also degrades gracefully. With 5 rated games, you get noisy predictions with weak confidence. With 30, you get tighter clusters and stronger signal. The confidence indicator tracks this automatically.

### Vision Alignment

- **Anti-goal check:** Does not recommend purchases. Shows estimated fit with explicit uncertainty. Passes.
- **Principle alignment:** Serves Principle 1 (ownership is personal: predictions are anchored in the user's own ratings, not BGG consensus), Principle 2 (breakdown shows reference games and confidence), Principle 4 (BGG data provides the feature space, personal ratings provide the judgment).
- **Tension resolution:** Prediction honesty > coverage. Weak-confidence predictions are shown as weak, not hidden. The system never presents a prediction without its confidence level.
- **Constraint check:** No social features. Uses BGG data as features but doesn't replicate BGG's recommendation engine. Passes.

### Scope: Medium

Requires: feature vector encoding module (new pure-function module, similar pattern to `curve-engine.ts` and `elo-engine.ts`), similarity computation, k-NN estimation, confidence calculation, new `FitnessBreakdownSource` value, extended API response types, UI for predicted scores. Does not require changes to storage or the existing fitness calculation path.

---

## Proposal 3: Tournament ELO as Prediction Prior

*USER NOTE:* Good extension.

### Evidence

The tournament system (`TournamentData` in `types.ts`) stores per-game ELO ratings, comparison counts, and a `normalizedScore` (1-10 scale). Games with 6+ comparisons have stable ELO rankings that represent the user's revealed preference: not what they say they like, but which games they actually choose when forced to pick.

The fitness model brainstorm concluded with a hybrid direction: "tournament-derived fitness rank plus axis ratings form a multi-dimensional vector." The tournament ranking feature is now implemented. But nothing currently connects tournament scores to the axis-based fitness model or to prediction.

### Proposal

When predicting fitness for an unrated game, use the user's tournament data as a correction signal alongside the k-NN axis estimation from Proposal 2:

1. **Tournament-informed similarity:** When computing which rated games are "similar" to the target, weight the similarity score by the rated game's tournament stability. A game with 15 comparisons and a clear ELO position is a more reliable reference point than one with 2 comparisons. This doesn't change which games are neighbors; it adjusts how much the system trusts each neighbor's ratings as representative of the user's real preferences.

2. **Revealed preference audit:** After computing the predicted per-axis scores, compare the predicted aggregate fitness against where the tournament data would place this game (if the user has tournament-ranked any similar games). If the axis-predicted fitness says 8.2 but tournament patterns suggest the user typically ranks games in this BGG attribute cluster around 6.5, surface the tension: "Axis prediction: 8.2. Games like this in your tournament rankings average 6.5. Your axis ratings for similar games may be higher than your revealed preference." This is information, not a correction.

3. **Display:** Show the axis-predicted score as the primary number. Show the tournament-informed context as a secondary signal when available and when it disagrees meaningfully (> 1 point difference). The user sees both stated preference (axis prediction) and revealed preference (tournament pattern), side by side.

### Rationale

The original brainstorm named the honesty gap: "People rate Gloomhaven a 9 because they think they should, then never play it." Tournament data closes that gap for owned games. Extending it to prediction means the prediction engine inherits that honesty. A game that looks great on paper (high predicted axis scores) but belongs to a category the user consistently loses in tournament matchups gets flagged. The user still decides what to do with the information.

This also connects two features (tournament ranking and prediction) that were designed separately but share a deep structural relationship. The tournament data is the user's collection identity expressed through action rather than reflection. Prediction without it is half the picture.

### Vision Alignment

- **Anti-goal check:** Does not automate decisions. Surfaces tension between stated and revealed preference. The user interprets both signals. Passes.
- **Principle alignment:** Principle 2 (transparent: both signals visible), Principle 3 (collection identity: tournament patterns ARE identity data), Principle 4 (data serves judgment: the system shows, doesn't decide).
- **Tension resolution:** Personal axes vs. BGG data accuracy: personal axes win, but the tournament data is also personal. This is personal vs. personal, two different modes of self-knowledge. The system shows both without resolving the tension for the user.
- **Constraint check:** Passes. Internal data only.

### Scope: Medium

Depends on Proposal 2 (k-NN estimation). Primary work: tournament-weighted similarity adjustment, cluster-level tournament average computation, UI for dual-signal display. The tournament data structures already exist; this reads them, doesn't modify them.

---

## Proposal 4: Confidence Architecture with Explicit Uncertainty

*USER NOTE:* Good extension.

### Evidence

The fitness model brainstorm's cross-cutting observations section named this: "An explicit confidence signal architecture (not just a flag, but a structured representation of which inputs contributed and how confidently) needs to be designed regardless of which scoring model is chosen." The vision's tension table encodes the same requirement: "prediction honesty > coverage, never."

Currently, `FitnessResult` has no confidence representation. A score is either present (all contributing axes rated) or absent (no rated axes). Prediction introduces a third state: present but uncertain. Without a confidence architecture, predicted scores will look identical to actual scores in the UI, which violates the honesty principle.

### Proposal

Extend `FitnessResult` with a prediction confidence model:

```typescript
type PredictionConfidence = "actual" | "strong" | "moderate" | "weak" | "insufficient";

interface PredictionMeta {
  confidence: PredictionConfidence; // overall
  predictedAxisCount: number; // how many axes were estimated
  actualAxisCount: number; // how many had real ratings
  referenceGameCount: number; // how many rated games informed predictions
  coveragePercent: number; // weight-adjusted: what % of total axis weight is covered by actual or strong-confidence data
}

interface FitnessBreakdownEntry {
  // ... existing fields ...
  predictionConfidence: PredictionConfidence | null; // null for non-predicted entries
  referenceGames: { gameId: string; gameName: string; similarity: number }[] | null; // null for non-predicted
}
```

**Confidence levels:**

- **Actual:** The rating comes from the user (personal rating or accepted BGG-derived value). Not a prediction.
- **Strong:** The prediction is based on 5+ similar games with low rating variance (< 1.5 spread) and high average similarity (> 0.7).
- **Moderate:** 3-4 similar games, or higher variance, or moderate similarity.
- **Weak:** 1-2 similar games, or high variance, or low similarity.
- **Insufficient:** No similar games have a rating on this axis, or the data is too sparse to produce a meaningful estimate. The axis is excluded from the calculation.

**Display rules:** The UI always distinguishes predicted from actual. Predicted scores carry a visual marker. Clicking the marker shows the confidence breakdown per axis. The collection list can be filtered and sorted by prediction confidence so the user can find "games I should rate to improve prediction quality."

### Rationale

Without this, every other proposal produces numbers that look more trustworthy than they are. Confidence isn't a feature of prediction; it's the thing that makes prediction honest instead of misleading. Building it before or alongside the estimation logic ensures it's structural, not bolted on.

The "games I should rate to improve prediction quality" view is particularly valuable. It turns prediction uncertainty into a clear call to action: rate these 5 games and your predictions for worker-placement games will improve from moderate to strong. This connects prediction to the core rating loop in a way that reinforces engagement with the system rather than passive consumption of numbers.

### Vision Alignment

- **Anti-goal check:** Directly opposes "automated purchase decisions" by making uncertainty visible. Passes.
- **Principle alignment:** This IS Principle 2 (transparency) applied to prediction. The confidence breakdown is the prediction's equivalent of the fitness breakdown.
- **Tension resolution:** This proposal implements the "prediction honesty > coverage" tension resolution. It's the mechanism that makes honesty structural.
- **Constraint check:** Passes.

### Scope: Small-Medium

Type extensions, confidence computation logic (pure functions), UI components for confidence display. No new data storage. The computation piggybacks on whatever estimation approach is used (Proposals 2 and 3).

---

## Proposal 5: BGG "Fans Also Like" as Candidate Discovery

*USER NOTE:* Not viable.

### Evidence

The BGG XML API exposes `families: BggTag[]` per game (already fetched and stored in `BggGameData.families`). BGG families include curated groupings like "Game: Carcassonne" or "Theme: Pirates" that represent human-curated similarity clusters. The `suggestedPlayerCounts` field includes vote distributions that encode community consensus on optimal player counts.

BGG also has a "fans also like" recommendation system visible on game pages. This data is not currently accessible through the XML API v2 endpoints the client uses, but it encodes collaborative filtering signals: users who rated game A highly also rated game B highly.

### Proposal

Use BGG's existing taxonomy data (families, mechanics, categories) as a candidate discovery layer that feeds the prediction engine, rather than building collaborative filtering from scratch:

1. **Family-based expansion:** When the user has rated games in a BGG family (e.g., the "Carcassonne" family), surface other games in that family as prediction candidates. The family relationship is human-curated and higher signal than mechanic overlap alone.

2. **Mechanic cluster mapping:** Group the user's rated games by their primary mechanic combinations. Identify mechanic clusters where the user rates consistently high or low. For a new game, its mechanic signature determines which cluster it falls into, and the cluster's average rating provides a baseline estimate.

3. **Community rating as tie-breaker, not signal:** Within a predicted confidence band, use BGG community rating to rank candidates. This is explicitly secondary (Vision Principle 4: personal axes dominate). A game predicted at "moderate confidence, 7-8 range" sorts higher if its community rating is 8.1 than if it's 6.4. The community rating is surfaced as context, not as a component of the fitness score.

4. **API design for discovery:** A new endpoint that accepts a prediction request: "given my collection and ratings, what unrated games in the BGG database would score highest on my axes?" This is distinct from prediction-on-demand (Proposal 1, where the user picks a game and asks "what would this score?"). Discovery inverts the question: the system surfaces candidates the user hasn't considered.

### Rationale

Building collaborative filtering from a single user's data (20-50 games) is statistically weak. BGG has millions of ratings and has already solved collaborative filtering at scale. The families, mechanics, and categories taxonomy is the distilled output of that community intelligence. Using it as structure (which games to even consider) while keeping the scoring personal (the user's axes and curves determine fitness) gives the prediction engine BGG's discovery breadth without depending on BGG's judgment.

The discovery endpoint is the most user-facing piece: it answers "what should I look at next?" without saying "you should buy this." The distinction matters for the anti-goal. The system ranks games by predicted fitness; the user decides whether fitness means acquisition.

### Vision Alignment

- **Anti-goal check:** "Automated purchase decisions" is the closest anti-goal. Discovery shows predicted fitness, not recommendations. The phrasing and UI must make this distinction clear: "these games score well on your axes" not "you should buy these." Careful design required but not disqualifying. Passes with attention.
- **Principle alignment:** Principle 4 (data serves judgment: BGG provides candidates, personal axes provide evaluation). Principle 1 (personal and specific: the ranked list reflects the user's axes, not BGG consensus).
- **Tension resolution:** Personal axes > BGG data accuracy. The prediction uses personal ratings as the primary signal and BGG data as structure. Community rating is explicitly secondary.
- **Constraint check:** "BGG replacement" is relevant. This does not replicate BGG's game database or discovery UI. It uses BGG data to fuel a personal curation tool. The distinction: BGG says "these games are popular." Shelf Judge says "these games match YOUR axes." Different question, different answer. Passes.

### Scope: Large

New daemon endpoint, BGG data traversal (fetching games the user doesn't own), prediction computation at scale (potentially hundreds of candidates), result ranking and pagination, UI for browsing predicted candidates. The largest proposal in this brainstorm, and the one most likely to need its own spec.

---

## Proposal 6: Graceful Cold Start with Progressive Unlock

*USER NOTE:* Good extension, but the data set already has 100+ games. Not immediately necessary but good for completeness. 

### Evidence

The deferred issue notes "probably 20+ rated games minimum for useful signal." The fitness model brainstorm flagged cold start across all five approaches. The vision tension table says "prediction honesty > coverage, never." But the system currently has no mechanism to tell the user where they are on the road from "not enough data" to "predictions are reliable."

The tournament system has a similar progressive unlock: `provisionalThreshold` (default 6 comparisons) determines when a game's ELO rating is "provisional" vs. stable. `normalizedScore` is null when fewer than 5 games are ranked. This is the pattern: gate the output on data sufficiency, show progress toward the threshold.

### Proposal

Define prediction readiness as a progression with four stages, and surface the user's current stage in the UI:

1. **Stage 0: No prediction available** (< 5 rated games). The system has no basis for personal-axis prediction. BGG-derived axes can still be scored via Proposal 1 (curve-first), but personal axes show "rate more games to enable prediction." No predicted fitness scores appear.

2. **Stage 1: Experimental predictions** (5-14 rated games). The system can compute predictions but confidence is uniformly weak or moderate. All predicted scores carry an "experimental" marker. The UI shows "You've rated N games. Predictions improve significantly after 20." The k-NN pool is small; variance is high.

3. **Stage 2: Usable predictions** (15-29 rated games). Predictions reach moderate confidence on axes where the user has consistent patterns. Experimental markers drop off for strong-confidence predictions. The "improve predictions" prompt shifts from "rate more games" to "rate games in these underrepresented categories: [mechanic clusters with < 3 rated games]."

4. **Stage 3: Reliable predictions** (30+ rated games). The k-NN pool is large enough for stable predictions across most axes. Strong-confidence predictions are common. The system can meaningfully surface discovery candidates (Proposal 5).

**Implementation:** A `PredictionReadiness` object in the API response for collection-level queries:

```typescript
interface PredictionReadiness {
  stage: 0 | 1 | 2 | 3;
  ratedGameCount: number;
  nextStageAt: number; // games needed for next stage
  weakAxes: { axisId: string; axisName: string; ratedCount: number }[]; // axes with fewest ratings
  suggestedActions: string[]; // "Rate games with 'deck building' mechanic to improve predictions"
}
```

The thresholds (5, 15, 30) are configurable defaults, not hardcoded. As the prediction engine matures, they can be adjusted based on observed prediction quality.

### Rationale

Gating prediction behind a binary threshold (< 20 games = no prediction, 20+ = prediction) wastes the intermediate data. A user with 12 rated games has some signal. Discarding it until they hit 20 violates the principle of showing what the data says. But showing it without qualification violates honesty. Progressive stages thread this: show the data, qualify it honestly, and give the user a clear path to better predictions.

The "suggested actions" field turns prediction uncertainty into user engagement. Instead of a passive gate ("you need more ratings"), the system says "rate a deck-building game; you have none and your predictions for that category have no reference points." This creates a feedback loop: rating more games improves predictions, which surfaces more interesting candidates, which motivates more rating.

### Vision Alignment

- **Anti-goal check:** Does not automate decisions. Guides rating activity, not purchasing. Passes.
- **Principle alignment:** Principle 2 (transparency: the user sees exactly where they are and what they'd gain from more data), Principle 4 (data serves judgment: the system shows data sufficiency, doesn't withhold predictions paternalistically).
- **Tension resolution:** Prediction honesty > coverage. Each stage is honest about its limitations. Stage 1 predictions are marked experimental. The system never pretends weak data is strong.
- **Constraint check:** Passes.

### Scope: Small

Type definition, threshold logic, weak-axis detection (scan existing ratings per axis), suggested-action generation. Mostly API and UI work. No new data storage or complex computation.

---

## Anti-Goals: What Prediction Should Not Become

These come directly from the vision, applied to the prediction domain:

1. **Not a recommendation engine.** "High predicted fitness" is information, not advice. The UI never says "buy this." It says "this scores 8.1 on your axes (predicted, moderate confidence)." The user infers what to do with the number.

2. **Not a BGG clone.** BGG has recommendations, hot lists, and user rankings. Shelf Judge prediction uses BGG data as features, not as conclusions. "Users who liked X also liked Y" is BGG's domain. "Y scores well on YOUR complexity and wife-playability axes" is Shelf Judge's.

3. **Not a social feature.** Prediction uses one user's ratings to predict one user's scores. No collaborative filtering across users (there's only one user). No "people like you" comparison.

4. **Not a black box.** Every predicted number traces to specific reference games, specific BGG attributes, specific curve configurations. If the user can't ask "why this number?" and get a concrete answer, the prediction is broken.

5. **Not a substitute for rating.** Prediction fills gaps; it doesn't replace the user's judgment. The system should actively encourage rating games that have only predicted scores, especially when prediction confidence is low. The goal is to have MORE actual data over time, not to live on predictions.

---

## Interaction Map

How these proposals relate to each other and to adjacent features:

**Dependency chain:** Proposal 1 (curve-first) is standalone and immediate. Proposal 4 (confidence architecture) should be designed alongside or before Proposals 2 and 3. Proposal 2 (k-NN estimation) requires Proposal 4 to avoid producing misleadingly precise numbers. Proposal 3 (tournament prior) extends Proposal 2. Proposal 5 (discovery) requires Proposals 1, 2, and 4 to produce meaningful results. Proposal 6 (cold start) is a UI/API concern that wraps all prediction output.

**Collection profiling:** The deferred profiling feature (`.lore/issues/deferred-collection-profiling.md`) would consume the same feature vectors and similarity computations that Proposal 2 builds. Profiling describes "what does your collection say about your taste." Prediction applies that taste to unrated games. They're the same engine pointed in different directions. Building the prediction feature vector module with profiling in mind (expose the taste centroid, the mechanic clusters, the axis-weight patterns) saves significant rework later.

**Redundancy scoring:** The deferred redundancy feature (`.lore/issues/deferred-redundancy-scoring.md`) needs the same mechanic/category overlap computation that Proposal 2's similarity function uses. A predicted game that overlaps heavily with owned games should show a predicted redundancy adjustment alongside its predicted fitness. The overlap computation is the shared primitive.

**Utility curves:** Proposal 1 exists because utility curves make BGG-derived prediction trivially accurate. The curve is the user's declared mapping from raw BGG values to personal value. No estimation needed for any axis where a curve is configured. This makes utility curves a prerequisite for the best version of prediction, not just a parallel feature.

**Tournament ranking:** Proposal 3 connects tournament data to prediction. The tournament is the user's revealed preference; prediction estimates stated preference. Showing both gives the user a calibration tool: "My axis ratings predict I should love this game, but games like it always lose in my tournament matchups. Maybe my axis ratings are aspirational rather than honest."
