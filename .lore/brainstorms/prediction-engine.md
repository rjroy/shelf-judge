---
title: "Prediction Engine for Unrated Games"
date: 2026-04-09
revised: 2026-04-10
status: concluded
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

**Status:** Concluded. Six proposals evaluated, four accepted, two rejected. Ready for specification.

**Context scanned:**

- `.lore/vision.md` (5 principles, 3 anti-goals, tension table)
- `.lore/designs/mvp-fitness-model.md` (weighted average scorecard, implemented)
- `.lore/specs/utility-curves.md` (preference shapes, veto, native scales, implemented)
- `.lore/brainstorms/fitness-model-options.md` (5 approaches, hybrid conclusion)
- `.lore/issues/deferred-prediction-engine.md`, `deferred-collection-profiling.md`, `deferred-redundancy-scoring.md`
- `packages/shared/src/types.ts` (current types: Game, BggGameData, Axis, FitnessResult, TournamentData)
- `packages/daemon/src/services/fitness-service.ts` (calculateScore, resolveBggRawValue, curve integration)
- `packages/daemon/src/services/bgg-client.ts` (searchGames, getGame, getGames, getUserCollection)

**Prior brainstorm:** `fitness-model-options.md` explored prediction in each of its five approaches. Approach 1 proposed nearest-neighbor estimation from similar rated games for missing personal axes. Approach 3 proposed cosine similarity against a taste profile vector. Approach 4 noted that utility curves strengthen prediction by converting BGG continuous data into personal value with explicit semantics. This brainstorm built on those ideas with concrete proposals grounded in the system as implemented.

---

## The Shape of the Problem

The fitness model as implemented answers one question: "How fit is this game, given the ratings I've entered for it?" Prediction answers the adjacent question: "How fit would this game probably be, if I rated it?"

The gap between these two questions is the gap between data the user has provided (personal axis ratings) and data the system already has (BGG mechanics, categories, weight, player counts, families, community rating, suggested player counts). Every owned game with personal ratings becomes a training example: "Given these BGG attributes, the user rated this game X on axis Y." The prediction engine learns that mapping and applies it to games without personal ratings.

Three things constrain what prediction can look like in this system:

1. **The fitness model is a weighted average of per-axis ratings.** Prediction must produce per-axis estimates, not just an aggregate number, because the breakdown is non-negotiable (Vision Principle 2). A predicted fitness score without a predicted breakdown violates the system's core promise.

2. **Utility curves transform raw values into effective ratings.** After utility curves (now implemented), prediction gets richer: a user who configures "sweet spot at BGG weight 2.75, strict tolerance" has explicitly declared how they value complexity. The curve IS the prediction function for that axis. No estimation needed; the user already told the system what any complexity value means to them.

3. **The tournament ranking already captures revealed preference.** Tournament ELO scores represent which games the user actually prefers when forced to choose. This is a separate signal from axis ratings, and a prediction engine can use both.

---

## Accepted: k-NN Estimation for Personal Axes (Core)

This is the core prediction approach. For each personal axis, predict the rating for an unrated game using weighted k-nearest-neighbor matching against the user's rated collection.

### Evidence

`BggGameData` stores `mechanics: BggTag[]`, `categories: BggTag[]`, `families: BggTag[]`, `weight: number | null`, `suggestedPlayerCounts: SuggestedPlayerCount[]`, and `communityRating: number`. These fields exist on every game with BGG data, providing a feature vector for similarity computation.

The user's personal axis ratings (`Game.ratings: Record<string, number>`) provide training labels. A user who rates 25 games on "wife will play it" has 25 labeled examples where the label is their personal assessment and the features are the BGG attributes of each game.

### How It Works

1. **Feature vector:** Encode each game as a vector of: mechanics (binary flags for each mechanic present in the collection), categories (same), BGG weight (normalized), community rating (normalized), player count range (encoded as min/max tuple). Families could contribute but are noisier; start without them.

2. **Similarity:** Cosine similarity between the target game's feature vector and each rated game's feature vector. Mechanic and category overlap will dominate because they're the highest-dimensionality component.

3. **Estimation:** For axis A, the predicted rating is the similarity-weighted average of axis A ratings across the k most similar rated games (k = 5 to start, adjustable). Only games that have a rating on axis A contribute.

4. **Confidence:** Three inputs determine confidence for each predicted axis rating:
   - Number of similar games that contributed (more is better)
   - Variance of those games' ratings (low variance = high confidence)
   - Average similarity score of the contributing neighbors (closer neighbors = higher confidence)

   These collapse into a "prediction strength" indicator per axis: strong, moderate, or weak.

5. **Breakdown integration:** Each predicted axis entry in the `FitnessBreakdownEntry` carries `source: "predicted"` (new enum value) and additional metadata: number of reference games, average similarity, confidence level. The user can see "predicted 7.2 based on 4 similar games (confidence: moderate)."

### Why k-NN

k-NN is the right first model because it's interpretable. The user can ask "why did you predict 7 for wife-playability?" and the system can answer "because Azul (similarity 0.87, rated 8), Patchwork (0.81, rated 7), and Kingdomino (0.79, rated 6) are your most similar rated games on that axis." The reference games are the explanation. No black box.

It also degrades gracefully. With 5 rated games, you get noisy predictions with weak confidence. With 30, you get tighter clusters and stronger signal. The confidence indicator tracks this automatically.

### Vision Alignment

- **Anti-goal check:** Does not recommend purchases. Shows estimated fit with explicit uncertainty. Passes.
- **Principle alignment:** Serves Principle 1 (predictions anchored in user's own ratings, not BGG consensus), Principle 2 (breakdown shows reference games and confidence), Principle 4 (BGG data provides feature space, personal ratings provide judgment).
- **Tension resolution:** Prediction honesty > coverage. Weak-confidence predictions are shown as weak, not hidden.
- **Constraint check:** No social features. Uses BGG data as features but doesn't replicate BGG's recommendation engine. Passes.

### Scope: Medium

Requires: feature vector encoding module (new pure-function module, similar pattern to `curve-engine.ts` and `elo-engine.ts`), similarity computation, k-NN estimation, confidence calculation, new `FitnessBreakdownSource` value, extended API response types, UI for predicted scores. Does not require changes to storage or the existing fitness calculation path.

---

## Accepted: Tournament ELO as Prediction Prior (Extension)

When predicting fitness for an unrated game, use the user's tournament data as a correction signal alongside the k-NN axis estimation.

### How It Works

1. **Tournament-informed similarity:** When computing which rated games are "similar" to the target, weight the similarity score by the rated game's tournament stability. A game with 15 comparisons and a clear ELO position is a more reliable reference point than one with 2 comparisons. This doesn't change which games are neighbors; it adjusts how much the system trusts each neighbor's ratings as representative of the user's real preferences.

2. **Revealed preference audit:** After computing the predicted per-axis scores, compare the predicted aggregate fitness against where the tournament data would place this game (if the user has tournament-ranked any similar games). If the axis-predicted fitness says 8.2 but tournament patterns suggest the user typically ranks games in this BGG attribute cluster around 6.5, surface the tension: "Axis prediction: 8.2. Games like this in your tournament rankings average 6.5. Your axis ratings for similar games may be higher than your revealed preference." This is information, not a correction.

3. **Display:** Show the axis-predicted score as the primary number. Show the tournament-informed context as a secondary signal when available and when it disagrees meaningfully (> 1 point difference). The user sees both stated preference (axis prediction) and revealed preference (tournament pattern), side by side.

### Why It Matters

The original brainstorm named the honesty gap: "People rate Gloomhaven a 9 because they think they should, then never play it." Tournament data closes that gap for owned games. Extending it to prediction means the prediction engine inherits that honesty. A game that looks great on paper (high predicted axis scores) but belongs to a category the user consistently loses in tournament matchups gets flagged. The user still decides what to do with the information.

This connects tournament ranking and prediction, two features that were designed separately but share a deep structural relationship. The tournament data is the user's collection identity expressed through action rather than reflection. Prediction without it is half the picture.

### Vision Alignment

- **Anti-goal check:** Does not automate decisions. Surfaces tension between stated and revealed preference. Passes.
- **Principle alignment:** Principle 2 (both signals visible), Principle 3 (tournament patterns ARE identity data), Principle 4 (shows, doesn't decide).
- **Tension resolution:** Both signals are personal (axis ratings vs. tournament choices). The system shows both without resolving the tension for the user.

### Scope: Medium

Depends on k-NN estimation. Primary work: tournament-weighted similarity adjustment, cluster-level tournament average computation, UI for dual-signal display. The tournament data structures already exist; this reads them, doesn't modify them.

---

## Accepted: Confidence Architecture with Explicit Uncertainty (Extension)

Without structured confidence, every other proposal produces numbers that look more trustworthy than they are. This proposal makes prediction honest instead of misleading.

### How It Works

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
  referenceGames: { gameId: string; gameName: string; similarity: number }[] | null;
}
```

**Confidence levels:**

- **Actual:** The rating comes from the user (personal rating or accepted BGG-derived value). Not a prediction.
- **Strong:** 5+ similar games with low rating variance (< 1.5 spread) and high average similarity (> 0.7).
- **Moderate:** 3-4 similar games, or higher variance, or moderate similarity.
- **Weak:** 1-2 similar games, or high variance, or low similarity.
- **Insufficient:** No similar games have a rating on this axis, or the data is too sparse. The axis is excluded from the calculation.

**Display rules:** The UI always distinguishes predicted from actual. Predicted scores carry a visual marker. Clicking the marker shows the confidence breakdown per axis. The collection list can be filtered and sorted by prediction confidence so the user can find "games I should rate to improve prediction quality."

### Why It Matters

Confidence isn't a feature of prediction; it's the thing that makes prediction honest instead of misleading. Building it alongside the estimation logic ensures it's structural, not bolted on.

The "games I should rate to improve prediction quality" view turns prediction uncertainty into a clear call to action: rate these 5 games and your predictions for worker-placement games will improve from moderate to strong. This connects prediction to the core rating loop.

### Vision Alignment

- **Anti-goal check:** Directly opposes "automated purchase decisions" by making uncertainty visible. Passes.
- **Principle alignment:** This IS Principle 2 (transparency) applied to prediction.
- **Tension resolution:** Implements the "prediction honesty > coverage" tension resolution as structure.

### Scope: Small-Medium

Type extensions, confidence computation logic (pure functions), UI components for confidence display. No new data storage. Piggybacks on whatever estimation approach is used.

---

## Accepted: Cold Start Progressive Unlock (Completeness)

Deprioritized for immediate implementation. The current data set has 100+ games, so the cold start path won't be exercised by the primary user in the near term. Included for completeness and for any future reset or fresh-start scenario.

### How It Works

Define prediction readiness as a progression with four stages:

1. **Stage 0: No prediction available** (< 5 rated games). No basis for personal-axis prediction. The UI shows "rate more games to enable prediction."

2. **Stage 1: Experimental predictions** (5-14 rated games). Predictions are computable but confidence is uniformly weak or moderate. All predicted scores carry an "experimental" marker.

3. **Stage 2: Usable predictions** (15-29 rated games). Predictions reach moderate confidence on axes where the user has consistent patterns. The "improve predictions" prompt shifts from "rate more games" to "rate games in underrepresented categories."

4. **Stage 3: Reliable predictions** (30+ rated games). The k-NN pool is large enough for stable predictions across most axes. Strong-confidence predictions are common.

**Implementation:**

```typescript
interface PredictionReadiness {
  stage: 0 | 1 | 2 | 3;
  ratedGameCount: number;
  nextStageAt: number;
  weakAxes: { axisId: string; axisName: string; ratedCount: number }[];
  suggestedActions: string[];
}
```

The thresholds (5, 15, 30) are configurable defaults, not hardcoded.

### Why It Matters

Gating prediction behind a binary threshold wastes intermediate data. Progressive stages thread the needle: show the data, qualify it honestly, and give the user a clear path to better predictions.

### Scope: Small

Type definition, threshold logic, weak-axis detection (scan existing ratings per axis), suggested-action generation. Mostly API and UI work.

---

## Rejected Proposals

Two proposals were considered and rejected during review:

**Curve-First Prediction for BGG-Derived Axes.** This proposed extending `calculateScore` with a prediction mode that applies configured utility curves to BGG data for unrated games. Rejected because it produces only partial coverage (BGG-derived axes only) without enough useful information to justify a separate prediction mode. The curve application for BGG-derived axes is a natural part of the k-NN approach, where BGG-derived axes with configured curves produce "actual" confidence ratings automatically. No separate proposal needed.

**BGG "Fans Also Like" as Candidate Discovery.** This proposed using BGG's taxonomy data (families, mechanics, categories) as a discovery layer to surface unrated games the user might want to evaluate. Rejected as not viable. The BGG "fans also like" data is not accessible through the XML API v2 endpoints the client uses, and building collaborative filtering from a single user's data (20-50 games) is statistically weak. The mechanic/category similarity that would drive discovery is already captured by the k-NN feature vectors.

---

## Anti-Goals: What Prediction Should Not Become

These come directly from the vision, applied to the prediction domain:

1. **Not a recommendation engine.** "High predicted fitness" is information, not advice. The UI never says "buy this." It says "this scores 8.1 on your axes (predicted, moderate confidence)."

2. **Not a BGG clone.** BGG has recommendations, hot lists, and user rankings. Shelf Judge prediction uses BGG data as features, not as conclusions. "Users who liked X also liked Y" is BGG's domain. "Y scores well on YOUR axes" is Shelf Judge's.

3. **Not a social feature.** Prediction uses one user's ratings to predict one user's scores. No collaborative filtering across users (there's only one user).

4. **Not a black box.** Every predicted number traces to specific reference games, specific BGG attributes, specific curve configurations. If the user can't ask "why this number?" and get a concrete answer, the prediction is broken.

5. **Not a substitute for rating.** Prediction fills gaps; it doesn't replace the user's judgment. The system should actively encourage rating games that have only predicted scores, especially when prediction confidence is low.

---

## Interaction Map

How the accepted proposals relate to each other and to adjacent features:

**Dependency chain:** Confidence architecture should be designed alongside k-NN estimation (they share type definitions and the confidence computation consumes k-NN outputs directly). Tournament prior extends k-NN by adjusting similarity weights and adding the revealed-preference audit. Cold start wraps all prediction output with readiness gating.

**Build order:** k-NN estimation + confidence architecture first (they're co-dependent). Tournament prior second (extends k-NN). Cold start last (UI/API wrapper, lowest priority given 100+ game collection).

**Collection profiling:** The deferred profiling feature (`.lore/issues/deferred-collection-profiling.md`) would consume the same feature vectors and similarity computations that k-NN builds. Profiling describes "what does your collection say about your taste." Prediction applies that taste to unrated games. They're the same engine pointed in different directions. Building the prediction feature vector module with profiling in mind (expose the taste centroid, the mechanic clusters, the axis-weight patterns) saves significant rework later.

**Redundancy scoring:** The deferred redundancy feature (`.lore/issues/deferred-redundancy-scoring.md`) needs the same mechanic/category overlap computation that k-NN's similarity function uses. The overlap computation is the shared primitive.

**Utility curves:** Curves make BGG-derived axis prediction exact. The curve is the user's declared mapping from raw BGG values to personal value. For any axis with a configured curve and available BGG data, the curve produces an "actual" confidence rating, no estimation needed. This means k-NN only needs to estimate personal axes where no curve exists.

**Tournament ranking:** Tournament data represents revealed preference; axis ratings represent stated preference. Showing both gives the user a calibration tool: "My axis ratings predict I should love this game, but games like it always lose in my tournament matchups."
