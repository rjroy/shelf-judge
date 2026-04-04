---
title: "Fitness Score Model Options"
date: 2026-04-04
status: draft
tags: [brainstorm, fitness, scoring, math]
---

# Fitness Score Model Options

## Header

**Vision status:** Draft. No approved vision yet — four-step alignment analysis deferred. Design proceeds against the five stated principles without formal filtering.

**Context scanned:** `.lore/vision.md`, `.lore/reference/architecture-pattern.md`, both meeting transcripts. No prior brainstorms exist.

**Recent brainstorm check:** None. This is the first.

---

## What the fitness model must do

Across all approaches, the same requirements apply. The model must:

- Accept user-defined axes with personal ratings (not a fixed set)
- Accept user-assigned axis weights
- Incorporate BGG data (community rating, BGG weight, mechanics, categories, player count) as context
- Produce a single fitness number that is decomposable on demand
- Adjust for redundancy relative to the rest of the collection
- Predict fitness for unowned games where some or all personal ratings are absent
- Return "insufficient data" rather than a confident wrong number

These are structural constraints, not scoring preferences. Every approach below satisfies or explicitly handles each one.

---

## Approach 1: Axis Scorecard

### Core idea

Users define named axes, rate each owned game on each axis (1–10), and assign a weight (0–100) to each axis. BGG fields become optional "derived axes" — the system auto-populates them from BGG data and normalizes them to the 1–10 scale. The fitness score is a weighted average of all active axes.

### How user-defined axes work

The user creates axes in plain language: "Wife will play it," "Analysis paralysis risk," "Visual design." Each axis gets a weight. Rating a game means filling in a number for each axis. No axis is required — missing ratings are handled explicitly (see edge cases below).

BGG-derived axes appear pre-populated but can be overridden. "BGG community rating" might auto-fill as 7.2 for Wingspan; the user can accept that or enter their own. This makes the user's personal override visible rather than implicit.

### How BGG data integrates

BGG fields are normalized to 1–10 and offered as derived axes:
- BGG rating (already 1–10, pass-through)
- BGG weight 1–5 → normalized to 1–10 (e.g., weight 3.5 → complexity axis score 7)
- Player count match: does the game's player count range cover the user's household size? 1–10 score based on how well it covers
- Mechanics and categories: not scored directly, but used as tags for redundancy detection and prediction

The user controls which derived axes are active and what weight they carry. BGG data feeds in through the axis layer, not around it.

### The aggregation function

Weighted average: `fitness = Σ(axis_score × axis_weight) / Σ(axis_weights)`

Simple, interpretable, and reversible. The decomposition is trivial: each axis contributes `(axis_score × axis_weight) / Σ(axis_weights)` points to the final score.

This allows positive-sum thinking: axes reinforce each other. A game that scores well on all axes scores well overall. A game that scores poorly on a low-weight axis isn't penalized much.

**Alternative aggregation within this approach:** geometric mean (`(a1^w1 × a2^w2)^(1/Σw)`) penalizes extreme lows more than weighted average. A game that scores 1 on "wife will play it" can't be rescued by 10s elsewhere. This addresses the weakness of weighted average where a veto axis can be overridden by high scores on many low-weight axes. Worth offering as an option.

### Redundancy / collection-awareness

After calculating raw fitness, apply a redundancy adjustment. Two inputs:

1. **Mechanic/category overlap score:** Given the game's BGG mechanic and category tags, how many owned games share significant tag overlap? Overlap is computed per-game, then aggregated (diminishing returns: the first overlap hurts most, subsequent ones hurt less).
2. **Axis rating similarity:** Among highly-rated owned games, do they cluster in axis space? A game that occupies a new region of axis space (high theme-fit, low complexity) has less redundancy than one that scores identically to three existing games.

Redundancy penalty: subtract 0–2 points from fitness, scaled by overlap degree. This is surfaced explicitly in the breakdown ("redundancy adjustment: −1.4 because 3 other area-control games already in collection").

**Limitation to name:** The overlap computation requires BGG mechanics data to be reliable and consistent. BGG's mechanic taxonomy is user-tagged and inconsistent. The penalty is therefore approximate, not precise.

### Prediction for unowned games

For unowned games, personal axis ratings are absent. The prediction strategy:

1. **BGG-derived axes**: auto-populate from BGG data. These are available for any game in the BGG database.
2. **Personal axes without ratings**: the system estimates from similar rated games. "Similar" = games with overlapping BGG mechanics and categories whose axis ratings are known. The estimate uses a weighted average of those similar games' ratings for each axis, weighted by overlap degree.
3. **Confidence signal**: each predicted axis score carries a confidence value based on how many similar games contributed and how consistent their ratings were. Low confidence axes display as approximate in the breakdown.
4. **Prediction floor:** if a personal axis has no similar games to draw from AND no BGG-derived proxy, it is shown as "unknown" in the breakdown and excluded from the fitness calculation with a note.

The overall predicted fitness is accompanied by a "prediction reliability" indicator: High (most axes have real or high-confidence estimates), Medium (some axes estimated with moderate confidence), Low (major axes unknown — treat this number skeptically).

### Transparency

The breakdown for any game:

```
Fitness: 7.4  [Predicted | 3 axes estimated]

Axes:
  Wife will play it:    8   × weight 40%  → 3.2  pts  [your rating]
  Analysis paralysis:   3   × weight 30%  → 0.9  pts  [your rating]
  Visual design:        9   × weight 20%  → 1.8  pts  [your rating]
  BGG community:        7.2 × weight 10%  → 0.7  pts  [BGG]

Redundancy adjustment:  −1.2 pts  (2 similar games: Ticket to Ride, Pandemic)

Total: 7.4
```

### Edge cases

- **1 axis:** Fitness = that axis score (weighted average of 1 is the value). Works correctly.
- **0 ratings:** If all axes are BGG-derived, prediction proceeds with BGG auto-fill only. Reliability = Low. If no BGG data exists, fitness returns null with "insufficient data."
- **Conflicting signals:** A game scores 9 on "visual design" but 2 on "wife will play it" (weight: 40%). The weighted average will surface the low-weight axis dragging the number down. The breakdown shows why. This is correct behavior, not a flaw.
- **User adds new axis after rating 50 games:** All previously rated games have an unknown value for the new axis. The system can: (a) exclude the new axis from fitness until the user rates each game on it, (b) estimate using similar games, or (c) ask the user to provide a default. This is a UX decision more than a math decision, but the model should make the "incomplete axis" state explicit.

### Verdict on this approach

**Strongest:** Transparency, user control, interpretability. The math is well-understood and the breakdown is directly readable.

**Weakest:** The prediction for personal axes depends on reliable similarity clustering, which requires either many rated games or good BGG tagging. With a small collection, predictions have wide uncertainty bands that the system may not communicate well. Also, the weighted average allows "rescuing" a veto axis with many small positives — the geometric mean variant addresses this but adds explanation burden.

**Scope:** Medium. The core model is simple. Redundancy computation and prediction confidence are the hardest parts.

---

## Approach 2: Pairwise Preference Tournament

### Core idea

Instead of rating games on absolute 1–10 scales, the user expresses fitness through pairwise comparisons: "Between Wingspan and Azul for your shelf right now, which is more fit?" The system accumulates comparisons and derives a fitness ranking using Elo or Bradley-Terry scaling. BGG attributes serve as explanation anchors — after enough comparisons, the system infers which game attributes correlate with user preference, making the rankings legible.

### How user-defined axes work

Axes don't exist as explicit input constructs. The user optionally annotates comparisons with reasons ("I prefer Azul because: lower complexity, shorter play time"). These annotations become soft tags that the system aggregates into an inferred preference profile. The profile is descriptive, not prescriptive — it tells the user what patterns appear in their choices, not what their axes are.

Users can also initiate axis-focused comparison sessions: "Compare these games on theme fit." This focuses the comparison and produces axis-specific sub-rankings.

### How BGG data integrates

BGG attributes (mechanics, categories, weight, player count) are the vocabulary for explaining patterns. After 20+ comparisons, the system can say: "You consistently prefer lower-BGG-weight games over higher ones. This accounts for ~40% of your comparison choices." BGG weight here is not an axis score — it's a correlate found in the comparison data.

BGG data also feeds the prediction function: a new unowned game's position in the ranking is estimated by its attribute similarity to games that have already been ranked.

### The aggregation function

Elo-style: each comparison updates the scores of both games. A win by a lower-ranked game updates both scores more than a win by a higher-ranked game. After N comparisons, every game has a relative fitness score. The distribution is calibrated so the highest-ranked game scores ~10 and the lowest ~1, giving a normalized 1–10 scale.

This is not an absolute rating — it's a relative ranking. "Wingspan scores 8.3" means Wingspan is highly ranked relative to your collection, not that it's objectively an 8.3. Adding or removing games from the comparison pool shifts all scores.

The implicit aggregation function is whatever the user's comparison choices encode. If the user systematically prefers low-complexity games, complexity is effectively highly weighted. They never had to set a weight explicitly.

### Redundancy / collection-awareness

Redundancy is partially natural here. When multiple similar games compete in comparisons, the user's preferences between them surface naturally. "Carcassonne vs. Kingdomino: which stays?" is the collection-awareness question made explicit rather than computed.

For systemic redundancy, the system can identify clusters of games that win comparisons against each other in a loop (Carcassonne > Ticket to Ride > Dominion > Carcassonne in some contexts) and surface this as "this cluster has no clear leader." That's information, not a penalty.

A collection-wide redundancy view is also computable: if 6 games cluster in attribute space and all rank similarly, the user is shown "these 6 games occupy similar shelf space; your comparison data doesn't clearly distinguish them."

### Prediction for unowned games

For an unowned game, find its nearest neighbors in BGG attribute space among already-ranked games. The predicted ranking is a weighted average of neighbors' Elo scores, weighted by attribute similarity. The confidence of the prediction depends on how many close neighbors exist and how tightly clustered their Elo scores are.

If the unowned game occupies an unfamiliar region of attribute space (no similar games have been compared), the prediction is flagged as unreliable. The system can offer: "This game has no comparison basis. Would you like to add it to the comparison queue?"

### Transparency

The breakdown for a ranked game:

```
Fitness rank: 7.8 / 10  (relative to your collection)

How this was determined:
  - 14 direct comparisons, 11 wins, 3 losses
  - Strongest wins: beat Ticket to Ride, Pandemic, Cluedo
  - Losses to: Wingspan, Azul

Inferred reasons (from your tags):
  - "Shorter play time" tagged in 8 of your wins for this game
  - "Easy to teach" tagged in 6 of your wins

Note: ranking shifts if collection changes significantly.
```

### Edge cases

- **1 game:** Elo requires at least two games to compare. The system cannot compute fitness from one game alone. It needs at least 2 games and 1 comparison to start.
- **0 comparisons:** No ranking can be derived. The system cannot predict fitness without either comparisons or a seeded preference model (which requires prior data).
- **New axis request:** The user wants a specific axis score for a game. This model doesn't produce it directly. The system can respond: "Based on your comparison tags, this game appears to score high on 'easy to teach' but this is inferred, not a direct rating."
- **Conflicting signals:** Two games score almost identically (8.1 vs 8.0). The comparison data is ambiguous — they've beaten each other in different contexts. The system surfaces this as a genuine tie rather than forcing a resolution.
- **Cold start:** With < 10 comparisons, the ranking is statistically unreliable. The system should surface confidence intervals, not just the score.

### Verdict on this approach

**Strongest:** Captures revealed preferences rather than stated preferences, which tend to be more accurate. User burden is lower (comparisons feel like decisions, not homework). Inherently surfaces collection coherence and redundancy.

**Weakest:** Hardest to explain in a way that satisfies "one number, honestly derived." The derivation is statistically sound but opaque — users can't trace "why 7.8" the way they can in Approach 1. Also requires many comparisons to converge; useless with a small collection. Cold start problem is significant.

**Scope:** Large. The comparison interface, Elo computation, attribute correlation analysis, and cluster detection are all non-trivial.

---

## Approach 3: Collection Profile + Attribute Similarity

### Core idea

The user's rated collection builds a "taste profile" — a weighted attribute vector derived from all games the user has rated positively. A game's fitness is its cosine similarity to that profile, normalized to 1–10. BGG's attribute space (mechanics, categories, weight, player count, complexity) IS the feature space. User axis ratings calibrate how strongly each game contributes to the profile. There are no explicit axes — the profile is the aggregated signal.

### How user-defined axes work

Users rate games on a simple overall scale (1–10: "how much does this game belong on your shelf?"). The axis concept re-enters as profile tags: after the system infers the profile, it surfaces "your taste profile is shaped primarily by: medium weight, low player interaction, strong visual theme." Users can then adjust profile weights manually to correct or sharpen the inference.

This is a simplification trade-off: users give up per-axis decomposition in exchange for lower rating burden. The system infers what the axes are, then lets the user adjust.

**Variant:** Allow the user to create named axes as profile dimensions (manually entered importance scores for BGG mechanics or categories, e.g., "Worker Placement: 9, Area Control: 3"). This brings explicit axis semantics back without requiring per-game axis ratings.

### How BGG data integrates

BGG data IS the model. Games are represented as attribute vectors:
- Mechanics: binary flags for each mechanic (or TF-IDF scores across the collection)
- Categories: same
- BGG weight: continuous, normalized
- Player count range: encoded as a range match score against household size
- BGG community rating: incorporated as a global quality signal (weighted low, per "data serves judgment")

Each positively-rated owned game contributes its attribute vector to the profile, weighted by the user's overall rating. The profile is the weighted centroid of rated games in attribute space.

### The aggregation function

Cosine similarity between a game's attribute vector and the taste profile vector, then mapped to 1–10. The similarity function naturally handles multiple dimensions and doesn't require explicit axis weights — the profile itself encodes relative importance based on what games the user rated well.

Redundancy is native to this model: if the profile is already well-served by a cluster of games (many high-similarity neighbors), adding another game in that cluster has low marginal contribution. The model can express this as "marginal similarity" rather than raw similarity.

### Redundancy / collection-awareness

The redundancy mechanism is elegant here. Define "marginal fitness" as: how much does this game increase coverage of the taste profile beyond what's already covered by owned games?

Coverage is computed by treating owned games as a set of sample points in attribute space. A new game's marginal contribution is low if many owned games are already nearby. This produces a smooth penalty without needing explicit redundancy rules.

"Adding Kingdomino: raw fitness 7.8, marginal fitness 6.1 (similar space already covered by Carcassonne and Azul)."

### Prediction for unowned games

Strong: any game in the BGG database can be projected into attribute space. Fitness = similarity to taste profile. The only question is whether the taste profile itself is well-calibrated (which requires a minimum number of rated games).

For games not in BGG: no prediction without attributes. This is correctly flagged as "insufficient data."

Prediction confidence is a function of how complete the BGG data is for that game and how many ratings contributed to the taste profile. A new profile with 5 games is much less reliable than one built from 50.

### Transparency

The breakdown re-frames around which attributes drive similarity:

```
Fitness: 7.8
Marginal fitness: 6.1  (Carcassonne and Azul already cover this space)

Why this game fits:
  - Worker Placement mechanic: strong match (weight in your profile: high)
  - Medium complexity: close to your profile center (BGG weight 2.8, your profile: 2.6)
  - Low interaction: matches your preference (flagged in 12/18 highly-rated games)

Why it doesn't fit better:
  - 2–5 players: partial mismatch (your profile favors 2–4)
  - Fantasy theme: slight mismatch (your profile skews abstract/economic)
```

The decomposition is attribute-driven, not axis-driven. Whether this satisfies "honestly derived" depends on whether the user finds attribute similarity legible. It's different from Approach 1 but not less honest.

### Edge cases

- **1 game:** Profile = that game's attribute vector. Fitness for any other game = similarity to that vector. Works, but the profile is not yet meaningful.
- **0 ratings:** No profile. System cannot compute fitness. Returns null.
- **New games with no BGG data:** Cannot be placed in attribute space. No fitness prediction. This is correctly "insufficient data."
- **Conflicting signals:** A highly-rated game (contributes strongly to profile) has attributes that would make other games score lower (because they contrast with it). This is resolved naturally — the profile reflects the aggregate, not individual games.
- **Profile drift:** As the user rates more games, the profile shifts. Old predictions may no longer be valid. The system should show predictions as of the current profile, and flag when predictions are based on a much older profile version.

### Verdict on this approach

**Strongest:** Prediction is the strongest of any approach — any BGG game can be scored. Redundancy is structural, not bolted on. Very low burden on the user.

**Weakest:** The "axes" are inferred, not owned. The user can't say "rate this game on my analysis-paralysis axis." The transparency is real but feels different from Approach 1's scorecard — it's "your profile cares about worker placement" not "you rated this 8 on your fun-with-partner axis." Personal, idiosyncratic axes (sentiment, memories, gifts) have no home here unless the user can define custom profile dimensions.

**Scope:** Medium-Large. The attribute vector representation, profile calibration, cosine similarity scoring, and marginal fitness computation are all buildable. The UX for surfacing what the profile "means" is the hardest part.

---

## Approach 4: Multi-Criteria Utility with Axis Curves

### Core idea

An extension of Approach 1 that takes axis design seriously. Each axis has both a weight and a utility function (shape of the value curve). A user who cares about complexity might want a plateau (anything below 2.5 BGG weight is fine, 2.5–4 is acceptable, above 4 is a veto). An axis with a hard veto has a cliff at a threshold: cross it and the entire fitness goes to zero regardless of other axes. The aggregation is a product of axis utilities rather than a sum, naturally penalizing deficiencies on any axis the user considers non-negotiable.

### How user-defined axes work

Axes are defined the same way as Approach 1 — named, weighted, rated 1–10 — but with an additional curve parameter. Four curve types cover most cases:

- **Linear:** 1–10 maps linearly to 0–1 utility. Standard.
- **Plateau:** Scores below threshold T all map to the same high utility. "I don't care which end of the complexity range it is, as long as it's below 3.5."
- **S-curve:** Sensitivity is highest in the middle, insensitive at extremes. "The difference between 7 and 8 matters more than between 9 and 10."
- **Hard veto:** Below threshold T, utility = 0 (the entire fitness score becomes 0). "If my wife won't play it, no score is high enough."

Most users will never need to think about this. The default is linear. Curves are an advanced option surfaced only when the user sets a very high or very low weight on an axis (the system asks: "Is this a veto axis?").

### How BGG data integrates

BGG fields map directly to axis inputs:
- BGG weight → complexity axis (user defines the utility curve: linear, plateau, or veto)
- Player count → player-count-fit axis (auto-populated, curve defaults to: full match = 10, partial match = 5, no overlap = 0)
- BGG community rating → optional overall-quality axis (user can include or exclude)

The key insight: BGG weight is a continuous input, and the utility function lets the user define their personal threshold for "too complex." A weighted average would treat weight 4.5 as "worse" than weight 2.5 on a complexity axis — but a plateau curve says "anything below 3.5 is fine, above 3.5 degrades."

### The aggregation function

Multiplicative combination of normalized utilities: `fitness = 10 × ∏(utility_i ^ w_i)` where w_i are normalized weights summing to 1 and utility_i is the 0–1 output of each axis's utility function.

This is a generalization: with all linear axes, it behaves like a geometric mean. With veto axes (utility = 0 below threshold), a single veto zeros the entire product.

Alternatively, offer two modes:
- **Compensatory (additive):** Good scores can compensate for mediocre ones. Default for most users.
- **Non-compensatory (multiplicative with veto):** A single veto cannot be overridden. For users who have hard requirements.

Users pick the mode when setting up their scoring scheme.

### Redundancy / collection-awareness

Same mechanism as Approach 1: mechanic/category overlap penalty, plus axis-space similarity to existing highly-rated games. The utility function approach doesn't change the redundancy calculation but does interact with it: games that hit the "sweet spot" of a plateau axis are interchangeable in the model. Two games that both score "fine" on complexity (they're both under the threshold) will appear redundant on that axis regardless of their exact BGG weight.

This is actually more accurate than linear scoring: if two games both pass your complexity threshold, the fact that one is 2.1 and the other is 2.9 doesn't matter for your purposes. The plateau captures this.

### Prediction for unowned games

Same as Approach 1, with one addition: the utility function parameters help constrain predictions. If BGG weight is available (it almost always is), the system can apply the user's complexity curve directly, giving a high-confidence score for that axis even without personal rating data. The user's utility function is the explicit statement of how they value BGG data.

This is the strongest prediction model among the explicit-axis approaches, because the utility curves convert BGG continuous data into personal value with explicit user-defined semantics.

### Transparency

```
Fitness: 0.0  ⚠ Veto applied

Axes:
  Wife will play it:    2   [your rating]  [VETO — below threshold 5]
  Analysis paralysis:   3   × weight 30%  → utility 0.30
  Visual design:        9   × weight 20%  → utility 0.90
  Complexity (BGG 3.8): cliff at 3.5 → utility 0.30

Veto axis triggered: Wife will play it (score: 2, threshold: 5)
This game cannot score above 0.0 until the veto axis clears.
```

The transparency is more expressive than a scorecard because it shows why certain threshold behaviors occur.

### Edge cases

- **1 axis with veto:** If the single axis is a veto, any game below the threshold scores 0. This is correct — the user defined it this way. The UI should confirm this intent before applying.
- **0 ratings:** Same as Approach 1.
- **Conflicting signals:** A veto axis that's below threshold on an otherwise excellent game produces a jarring 0. The system should surface this clearly ("this game scores very high on all other axes but fails the veto") rather than silently returning 0.
- **Calibration difficulty:** Plateau and S-curve parameters require the user to think about exact threshold values. Most users won't reason in these terms. The default-to-linear behavior is important; curves should emerge from repeated experience, not upfront configuration.

### Verdict on this approach

**Strongest:** Most expressive of personal preference semantics. "My wife must be willing to play it" is a veto, not a preference — this model has a direct representation for it. Transparency remains high. BGG data integration is the most principled: utility curves convert continuous BGG data into personal value directly.

**Weakest:** Highest configuration burden of any approach. The utility curve concept is not intuitive for most users. Risk of over-engineering personal preference into an elaborate calibration exercise. The multiplicative aggregation is harder to explain than weighted average.

**Scope:** Medium. Core math is straightforward. The UX for axis curve configuration is the hard part. The system must make curves feel like a natural extension of "how important is this to you?" rather than a math configuration panel.

---

## Approach 5: LLM-Mediated Synthesis

### Core idea

The LLM is the aggregation function. Given structured inputs — all axis ratings and their weights, BGG data, collection summary, and any user-supplied context — the model produces a fitness score and a written explanation. The transparency is the reasoning, not a formula. The user can read why the game scored 6.8. They can ask "why not higher?" and get a direct response.

This is not a replacement for the other approaches. It's a different placement of where judgment lives: in explicit math (Approaches 1–4) or in a supervised reasoning process (this one).

### How user-defined axes work

The user still defines axes and rates games on them. These become structured inputs to the LLM prompt. The LLM receives: "User has defined the following axes: [wife playability: 8, complexity: 3, theme: 9]. Axis weights: [wife: 40%, complexity: 30%, theme: 20%]. BGG data: [weight: 2.4, community rating: 7.8, mechanics: worker placement, area control]."

The LLM synthesizes these into a fitness recommendation and can reason about edge cases that a fixed formula can't handle: "The complexity axis scores low, but the user noted this game is actually fine once learned — an axis note the formula can't process."

### How BGG data integrates

BGG data is presented as narrative context alongside the structured axis data. The LLM can use it to fill gaps, correct apparent inconsistencies, and provide recommendations the user didn't explicitly configure.

### The aggregation function

The LLM produces a 1–10 score and reasoning. Under the hood, a calibration prompt ensures the score is consistent with the user's historical ratings (few-shot examples). The system verifies output range and can re-run if the score falls outside expected bounds.

The formula is the language model's internal weights — non-interpretable but explainable in natural language. This is a deliberate inversion: instead of transparent math + opaque meaning, this approach offers opaque math + transparent meaning.

### Redundancy / collection-awareness

The system prompt includes a collection summary. The LLM can reason: "You already own three area-control games. This fourth one covers similar mechanics and your ratings suggest you prefer lighter area control, where you already have strong coverage."

### Prediction for unowned games

Strong: the LLM can reason with partial data and explicitly note uncertainty. "I'm estimating the complexity axis from BGG weight; your direct rating might differ."

### Transparency

```
Fitness: 6.8

"Wingspan scores well on theme and wife playability, which you've weighted heavily.
However, it sits at the high end of your complexity threshold — BGG weight 2.9 is
above your comfort center based on your rated games. The area-control mechanic also
overlaps significantly with Azul and Patchwork already on your shelf.

If you're considering this as an addition, the main risk is that it fills a slot
already well-served by your existing collection."
```

### Edge cases

- **0 ratings:** The LLM can work with BGG data only and clearly state uncertainty. Better cold-start than formula approaches.
- **Inconsistent user behavior:** "You rate complexity low but own 6 high-complexity games. Fitness estimates here may not match your stated preferences." The LLM can name this tension explicitly.
- **Cost and latency:** Every fitness calculation requires an LLM call. Batch calculation and caching are necessary. This is an architectural constraint, not just a performance concern.
- **Determinism:** Two runs may produce different scores for the same inputs. This undermines "one number, honestly derived." Temperature must be set to 0; the system should cache scores rather than recomputing.

### Verdict on this approach

**Strongest:** Can reason about edge cases, named tensions, and partial data in ways no formula can. The transparency is genuine human-readable reasoning, not a decomposition table. Handles "my wife might play it on the right night" more gracefully than a 1–10 axis rating.

**Weakest:** Non-determinism risk is real. Consistency across recalculations requires caching. Latency makes real-time filtering impractical. Cost scales linearly with computations. The "opaque math, transparent meaning" tradeoff may feel untrustworthy to users who want to know exactly why their number changed.

**Scope:** Large in practice (prompting, calibration, caching, consistency validation) even though the algorithmic surface looks small.

---

## Cross-Cutting Observations

Three patterns appear across all approaches and are worth naming before the next conversation narrows to one model.

**The cold-start problem.** Every approach requires some minimum collection data before it becomes meaningful. Approach 2 (pairwise) needs the most; Approach 3 (profile similarity) needs a reasonable collection to build a meaningful profile; Approaches 1 and 4 work with 1 game but predictions are unreliable with < ~15 rated games. The fitness model specification should define a "minimum viable collection" threshold and what the system shows below it.

**The personal-axis coverage gap.** BGG doesn't know that a game was a gift from a deceased family member, or that you always lose to your partner at Ticket to Ride. Approaches 1 and 4 have a natural home for these — they're just axes with personal ratings. Approaches 3 and 5 can accommodate them with effort. Approach 2 can't accommodate them at all unless the user annotates comparisons with personal reasons. Whatever model is chosen, the spec should define whether non-BGG, non-quantifiable personal axes are in scope.

**Prediction honesty mechanism.** The vision tension table says "honesty beats coverage." All five approaches can satisfy this, but none of them automatically do. An explicit confidence signal architecture (not just a flag, but a structured representation of which inputs contributed and how confidently) needs to be designed regardless of which scoring model is chosen. This is a candidate for a separate spec.

---

## Summary

| | Approach 1: Axis Scorecard | Approach 2: Pairwise Tournament | Approach 3: Profile Similarity | Approach 4: Utility Curves | Approach 5: LLM Synthesis |
|---|---|---|---|---|---|
| **Transparency** | High | Medium (ranking, not score) | Medium (attributes, not axes) | High | High (natural language) |
| **User burden** | High (rate every game on every axis) | Low (comparisons) | Low (one overall rating) | High | Medium (axes + notes) |
| **Prediction strength** | Medium | Low (requires comparisons) | High (any BGG game) | Medium-High | High (handles gaps) |
| **Redundancy model** | Explicit penalty | Organic (comparisons) | Structural (marginal fitness) | Explicit penalty | Narrative |
| **Cold-start** | Partial (BGG axes work) | Poor | Poor | Partial | Good |
| **Technical complexity** | Low-Medium | High | Medium-High | Medium | High |
| **Personal axis support** | Full | Weak | Weak | Full | Full |
