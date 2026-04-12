---
title: "Outlier Distance Metric Research"
date: 2026-04-10
status: archived
tags: [research, outlier, distance-metric, profiling, similarity]
related:
  - .lore/specs/collection-profiling.md
  - .lore/brainstorms/collection-profiling.md
  - .lore/brainstorms/prediction-engine.md
---

# Research: Outlier Distance Metric for Collection Profiling

## Problem Statement

The collection profiling spec (REQ-PROFILE-11, REQ-PROFILE-12) requires detecting games that sit far from the collection's statistical center across multiple BGG attribute dimensions. The spec does not name a distance metric. The brainstorm says "multi-dimensional distance from collection centroid" without specifying which distance function. The spec's Open Question #2 frames two candidates (Euclidean, cosine) and invites evaluation.

This research evaluates distance metrics and outlier detection approaches for the specific data shape in Shelf Judge, and presents options for the design decision.

## Data Shape

The feature vector per game combines several types:

| Component             | Type         | Dimensionality                  | Sparsity                                    | Scale          |
| --------------------- | ------------ | ------------------------------- | ------------------------------------------- | -------------- |
| BGG mechanics         | Binary flags | ~200 possible, 3-8 per game     | Very sparse (~96-98% zeros)                 | 0/1            |
| BGG categories        | Binary flags | ~80 possible, 1-4 per game      | Very sparse (~95-98% zeros)                 | 0/1            |
| BGG weight            | Continuous   | 1                               | Dense                                       | 1.0-5.0        |
| Community rating      | Continuous   | 1                               | Dense                                       | 1.0-10.0       |
| Player count          | Tuple        | 2 (min, max)                    | Dense                                       | 1-12+          |
| Play time             | Continuous   | 1                               | Dense                                       | 5-480+ minutes |
| Personal axis ratings | Continuous   | N (user-defined, typically 3-8) | Sparse (not every game rated on every axis) | 1-10           |

Total dimensionality: ~290+ features, dominated by sparse binary flags. Typical dataset: 100-400 games. The binary portion massively outnumbers the continuous portion in dimension count.

## Metric Evaluation

### 1. Euclidean Distance

**How it works:** L2 norm, `sqrt(sum((a_i - b_i)^2))`. Treats all dimensions equally.

**For this data:**

- On the sparse binary portion (mechanics/categories), Euclidean distance is dominated by shared zeros. Two games that lack the same 190 mechanics appear "close" even if they share nothing positive. This is the wrong signal: absence of a mechanic is not a meaningful similarity. Verified: this is a well-documented failure mode of Euclidean distance on sparse binary data ([IBM cosine similarity documentation](https://www.ibm.com/think/topics/cosine-similarity), [Quora discussion on curse of dimensionality](https://www.quora.com/Is-the-cosine-similarity-metric-slightly-less-cursed-by-the-curse-of-dimensionality-than-say-Euclidean-distance-when-computing-distance-between-two-high-dimensional-sparse-vectors-and-if-so-why)).
- On the continuous portion (weight, rating, player count), Euclidean distance works well after normalization.
- In high-dimensional spaces, Euclidean distances between points concentrate (all pairs become similarly distant), reducing discriminative power. With ~280 binary dimensions, this effect is significant ([Surpassing Cosine Similarity paper](https://arxiv.org/html/2407.08623v4)).

**Verdict:** Poor fit for the binary portion. Acceptable for the continuous portion. Not recommended as a unified metric.

### 2. Cosine Similarity (converted to distance as 1 - similarity)

**How it works:** Measures angle between vectors, `dot(a,b) / (||a|| * ||b||)`. Ignores magnitude, focuses on direction.

**For this data:**

- On sparse binary data, cosine similarity has an advantage: it only considers non-zero dimensions. Two games sharing 3 mechanics out of 200 possible yields a meaningful similarity score based on those 3 shared mechanics, not the 197 shared absences. This is the Otsuka-Ochiai coefficient when applied to binary data ([Wikipedia: Cosine similarity](https://en.wikipedia.org/wiki/Cosine_similarity)).
- However, cosine similarity's discriminative power also diminishes in very high dimensions. As dimensionality increases, similarities between random vectors concentrate near a constant. With ~280 binary dimensions, this effect is present but less severe than for Euclidean distance because only non-zero elements participate.
- On the continuous portion, cosine similarity measures proportional relationships rather than absolute differences. A game with BGG weight 2.0 and another with weight 4.0 would be considered "similar" if other continuous features maintain the same ratio. This is not the right semantic: for complexity, we care about absolute difference, not ratio.
- Requires normalization strategy when mixing binary and continuous features in a single vector. Without careful handling, the continuous features (which have non-zero values across all games) will dominate the dot product.

**Verdict:** Good fit for mechanics/categories in isolation. Poor semantic fit for continuous features where absolute differences matter. Acceptable as a component metric for the binary portion only.

### 3. Jaccard Similarity (converted to distance as 1 - similarity)

**How it works:** For binary vectors, `|A intersection B| / |A union B|`. Only considers presence, never absence.

**For this data:**

- Purpose-built for comparing sets. Measures what fraction of combined mechanics/categories are shared between two games. This captures exactly the right semantic: "how much do these games overlap in what they are, ignoring what they aren't?"
- Well-established in recommendation systems for comparing item attributes ([Jaccard deep dive](https://www.numberanalytics.com/blog/jaccard-similarity-deep-dive), [Milvus metric types](https://milvus.io/docs/metric.md)).
- Only applies to binary data. Cannot handle the continuous features directly.
- Computationally simple, no normalization needed.
- For the "centroid" use case (comparing one game to a collection profile), Jaccard can be adapted: the centroid becomes the frequency vector of mechanics/categories across the collection, and the comparison asks "how well does this game's mechanic set overlap with the collection's common mechanics?" This requires a threshold decision (what frequency counts as "part of the collection's identity").

**Verdict:** Best fit for the binary portion (mechanics/categories). Must be combined with another metric for continuous features.

### 4. Gower Distance

**How it works:** Computes a per-feature distance using the appropriate method for each feature type, then averages them. Continuous features use normalized Manhattan distance (`|a-b|/range`). Binary features use exact match (1 if same, 0 if different). Dichotomous features (like mechanics flags) use asymmetric matching: only scores 1 when both are present, treats shared absence as uninformative. All component distances are on [0,1] scale. Final distance is the mean across all features ([Gower distance explanation](https://crispinagar.github.io/blogs/gower-distance.html), [Wikipedia](https://en.wikipedia.org/wiki/Gower's_distance)).

**For this data:**

- Designed specifically for mixed-type feature vectors. Handles binary mechanics/categories and continuous weight/rating/player-count in a single metric without manual normalization schemes.
- The asymmetric treatment of binary features (shared absence is ignored) solves the same problem cosine similarity addresses, but within a framework that also handles continuous features correctly.
- Each feature contributes equally to the final distance by default. With ~280 binary features and ~5-10 continuous features, the binary portion would dominate unless weights are applied. This is configurable: Gower supports per-feature weights ([Modified Gower with weights](https://link.springer.com/article/10.1186/s12874-024-02427-8)).
- The `ml-distance` npm package provides a basic Gower implementation, but the formula it implements (`sum(|p_i - q_i|) / n`) is simplified and may not handle the dichotomous/asymmetric case correctly. A correct implementation for this use case would need to be verified or built.
- Missing data handling is built in: features with missing values in either game are excluded from the distance calculation. This directly addresses the sparse personal axis ratings (not every game rated on every axis).
- The triangle inequality only holds when there are no missing features, which could matter if the outlier detection approach uses distance-based clustering. For simple centroid distance, this is not a concern.

**Verdict:** The most theoretically appropriate metric for this data shape. Handles mixed types natively, treats shared absence correctly, supports missing data. The main risk is implementation: the standard formula needs weighting to prevent the binary dimensions from overwhelming the continuous ones. A weighted variant where mechanic/category features are grouped (so "mechanics similarity" has the same influence as "weight similarity") is the practical approach.

### 5. Mahalanobis Distance

**How it works:** Euclidean distance weighted by the inverse covariance matrix. Accounts for feature correlations and different scales.

**For this data:**

- Requires inverting the covariance matrix, which is numerically unstable when dimensionality approaches or exceeds sample size. With ~290 features and 100-400 games, this is right at the danger zone. For a 100-game collection, the covariance matrix is singular and cannot be inverted ([Wikipedia: Mahalanobis distance](https://en.wikipedia.org/wiki/Mahalanobis_distance)).
- Robust estimators (Minimum Covariance Determinant) help but are designed for continuous data, not mixed binary/continuous vectors ([Robust distance approach](https://pmc.ncbi.nlm.nih.gov/articles/PMC12035934/)).
- Binary features violate the continuous-distribution assumptions underlying covariance estimation.
- The sample mean and covariance matrix are sensitive to the very outliers we're trying to detect, creating a chicken-and-egg problem ([SCIRP outlier detection](https://www.scirp.org/journal/paperinformation?paperid=90172)).

**Verdict:** Not viable for this data shape. Dimensionality too high relative to sample size, binary features violate assumptions, and the covariance matrix will be singular or near-singular for typical collection sizes.

### 6. Composite Metric (recommended evaluation target)

**How it works:** Compute separate, type-appropriate distance measures for the binary and continuous portions, then combine them with explicit weights.

Concretely:

- **Binary portion:** Jaccard distance on mechanics/categories (optionally subdomains). Produces a [0,1] distance. Higher means less overlap.
- **Continuous portion:** Normalized Manhattan or Euclidean distance on weight, rating, player count range, play time. Each feature normalized to [0,1] by range. Produces a [0,1] distance.
- **Personal axes:** Normalized Manhattan distance on the subset of axes where both the game and the centroid have values. Produces a [0,1] distance (or excluded if no shared axes).
- **Combination:** Weighted average of the three component distances, producing a final [0,1] distance.

**For this data:**

- Each component uses the metric best suited to its data type.
- Weights are explicit and tunable (e.g., mechanics/categories: 0.4, continuous BGG attributes: 0.3, personal axes: 0.3).
- Transparent: the per-component distances are individually meaningful and can be displayed in the UI ("this game is an outlier because: mechanics distance 0.85, complexity distance 0.12").
- No library dependencies. Each component is 10-20 lines of arithmetic.
- Aligns with the spec's requirement that "a game unusual on only one dimension is not necessarily an outlier" (REQ-PROFILE-11): the weighted combination naturally handles this.

**Verdict:** Most practical option. Trades theoretical elegance (Gower handles this in one formula) for transparency and control. The component weights become a design decision rather than an emergent property of the data shape.

## Comparison: Composite Metric vs. Gower

These two are the viable options. The choice is a tradeoff:

| Criterion                  | Gower                                                                  | Composite                                                                 |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Theoretical correctness    | Single unified framework                                               | Ad hoc but well-justified per component                                   |
| Implementation effort      | Need correct asymmetric binary handling; `ml-distance` may not suffice | Simple arithmetic, no dependencies                                        |
| Transparency               | Single number; component contributions are implicit                    | Per-component distances visible, useful for UI                            |
| Weight control             | Per-feature weights (280 binary features need grouping)                | Per-group weights (mechanics, continuous, axes)                           |
| Missing data               | Built-in exclusion                                                     | Manual but straightforward                                                |
| Reuse by prediction engine | Feature vector is shared; distance metric may differ                   | Components reusable; Jaccard for k-NN, normalized distance for continuous |
| Debuggability              | Hard to explain why a game is an outlier                               | Easy: "mechanics distance is 0.85, that's the driver"                     |

The composite approach has one structural advantage for this project: the prediction engine brainstorm (Proposal 2) already specifies cosine similarity for k-NN estimation over the same feature vectors. A composite metric with Jaccard for binary features and normalized distance for continuous features is more compatible with that future use than Gower, because the individual components can be reused or swapped without redesigning the whole metric.

## Outlier Detection Approach

### Centroid Distance (spec's current framing)

**How it works:** Compute the collection centroid (mean feature vector), measure each game's distance from it, flag games beyond a threshold (spec says 2 standard deviations).

**For this data:**

- For binary features, the "centroid" is the frequency vector: what fraction of the collection has each mechanic. A game's Jaccard distance from this centroid measures how well its mechanic set overlaps with the collection's common mechanics.
- For continuous features, the centroid is the mean value. Straightforward.
- Simple, interpretable, deterministic. No parameters to tune beyond the threshold.
- Assumes the collection has a single center of gravity. A user who collects both heavy euros and light party games has a bimodal distribution; the centroid sits between the two clusters, and games from both clusters might appear as outliers relative to the centroid. This is a known limitation of centroid-based methods.
- The threshold (2 standard deviations) assumes roughly normal distance distribution. With a composite distance on [0,1], the distribution may be skewed. The spec acknowledges this: "validate against the 200-game dataset during implementation and adjust."

**Verdict:** Good starting point. Simple, transparent, deterministic. The bimodal-collection edge case is real but acceptable for v1: the spec says outlier detection is informational, not prescriptive (REQ-PROFILE-14). A bimodal collection producing "unexpected" outliers is a conversation starter, not a bug.

### Local Outlier Factor (LOF)

**How it works:** For each point, compute the ratio of its local density to the density of its k neighbors. Points with substantially lower density than their neighbors are outliers. This catches outliers relative to local clusters, not just the global centroid ([scikit-learn LOF docs](https://scikit-learn.org/stable/modules/generated/sklearn.neighbors.LocalOutlierFactor.html)).

**For this data:**

- Handles bimodal collections correctly: a heavy euro among heavy euros is not an outlier, even if the collection also has party games.
- The LOF score is hard to interpret. A value of 1 means "similar density to neighbors." Values above 1 indicate lower density (more outlier-like), but there's no standard threshold. The spec's "2 standard deviations" framing doesn't map to LOF scores.
- Requires a distance metric as input (any of the above would work).
- Sensitive to the k (neighbors) parameter. With 100-400 games, k=10-20 is typical, but the "right" k depends on the collection's structure.
- More complex to implement, debug, and explain. "This game is an outlier because its local density is 2.3x lower than its 15 nearest neighbors" is less intuitive than "this game is 2.1 standard deviations from the collection center."
- Pairwise distance computation is O(n^2), but with n=100-400, this is negligible.

**Verdict:** More powerful than centroid distance for non-uniform collections. Harder to implement, tune, and explain. Worth considering for a v2 if centroid distance produces unintuitive results on the real dataset.

### Isolation Forest

**How it works:** Builds random trees that partition the feature space. Points that are isolated in fewer splits are more likely outliers.

**For this data:**

- Handles mixed data poorly. Random splits on binary features (0/1) produce trivial partitions. The algorithm is designed for continuous features.
- Good at detecting global outliers but weak on local outliers ([ResearchGate comparison](https://www.researchgate.net/publication/337204025_Outlier_detection_using_isolation_forest_and_local_outlier_factor)).
- Randomized: different runs produce slightly different results. The spec requires deterministic profile computation (REQ-PROFILE-18 success criteria: "identical results on repeated calls with unchanged data").

**Verdict:** Not a fit. Randomized output violates determinism requirement, and binary feature handling is weak.

## Board Game Recommendation Precedent

Several BGG recommendation systems have been built using similar data:

- Content-based approaches commonly use **TF-IDF vectorization** on mechanics and categories combined with game descriptions, then cosine similarity ([bg_recommender on GitHub](https://github.com/dstrodtman/bg_recommender)).
- Attribute-based systems encode mechanics and categories as binary flags and use **Pearson correlation** or **cosine similarity** ([bgg-recommender on GitHub](https://github.com/brentonmallen1/bgg-recommender)).
- Hybrid systems use collaborative filtering (user-user similarity from ratings) combined with content features ([Board-Games-Recommender on GitHub](https://github.com/richengo/Board-Games-Recommender)).
- An interactive BGG similarity map uses attribute vectors to compute game-to-game distances ([toucan4life map-of-boardgames](https://toucan4life.github.io/map-of-boardgames/)).

**Consistent finding:** For mechanics and categories as binary features, Jaccard or cosine similarity (which are closely related for binary vectors) are the standard choices. No BGG recommendation system found uses Euclidean distance on mechanics/category flags. Continuous features (weight, player count, play time) are typically normalized separately.

No precedent was found for collection-level outlier detection specifically (as opposed to game-to-game similarity for recommendations). This is a novel application of standard techniques.

## Findings Summary

### What I verified (checked against source code, documentation, or formal definitions):

1. Euclidean distance on sparse binary vectors is dominated by shared zeros. Well-documented, formally understood.
2. Jaccard similarity ignores shared absence by definition. Formally correct for set comparison.
3. Gower distance handles mixed types with asymmetric binary matching. Defined in the original 1971 paper, confirmed by multiple sources.
4. Mahalanobis distance requires inverting a covariance matrix that will be singular when dimensions >= samples. Mathematical fact for the standard formulation.
5. Isolation Forest is randomized. Violates the determinism requirement in the spec.
6. The `ml-distance` npm package exists and exposes a `gower()` function, but its implementation may be the simplified symmetric formula, not the full asymmetric version.

### What I inferred (reasonable conclusions from evidence, not directly verified):

1. A composite metric with Jaccard for binary + normalized Manhattan for continuous will produce more intuitive outlier results than any single unified metric, because each component uses the semantically correct comparison for its data type.
2. Centroid distance will produce acceptable results for v1 on typical board game collections (single-cluster tendency around medium-weight euros).
3. The bimodal-collection edge case (heavy euros + party games) will produce counterintuitive centroid-distance results, but this is acceptable given the spec's "informational, not prescriptive" framing.
4. LOF would handle the bimodal case better but adds complexity that isn't justified until centroid distance is proven insufficient on real data.

### What I don't know:

1. Whether the 2-standard-deviation threshold on a composite [0,1] distance will flag the right number of games. This requires empirical testing on the 200-game dataset.
2. The exact distribution shape of composite distances in a real collection. If heavily skewed, a percentile-based threshold (e.g., top 5%) may work better than standard deviations.
3. What the right component weights are (mechanics/categories vs. continuous attributes vs. personal axes). This is a design decision informed by testing.
4. Whether grouping mechanics and categories together (one Jaccard distance for both) or keeping them separate (two Jaccard distances) produces better outlier intuitions.

## Options for the Design Decision

### Option A: Composite Metric + Centroid Distance

- Jaccard distance for mechanics/categories (grouped or separate)
- Normalized Manhattan distance for continuous BGG attributes
- Normalized Manhattan distance for personal axis ratings (where available)
- Weighted combination into [0,1] distance
- Outlier threshold: 2 standard deviations from mean distance (adjustable per spec)

**Tradeoffs:** Simple, transparent, no dependencies. Component distances are individually meaningful and displayable. Reusable by prediction engine. The centroid assumption (single cluster) may produce surprising results for diverse collections. Weights are tunable but must be chosen.

### Option B: Gower Distance + Centroid Distance

- Full Gower distance with asymmetric binary handling
- Per-feature or per-group weights to balance binary vs. continuous influence
- Same centroid-based outlier detection as Option A

**Tradeoffs:** Theoretically cleaner (one formula, not three composed). Handles missing data natively. Harder to explain component contributions in the UI. May need a custom implementation if `ml-distance` doesn't handle asymmetric binary correctly. Less compatible with the prediction engine's cosine-similarity approach.

### Option C: Composite Metric + LOF

- Same composite distance as Option A
- LOF instead of centroid distance for outlier detection
- Handles non-uniform collections (bimodal, multi-cluster)

**Tradeoffs:** More robust to diverse collections. Harder to explain, tune, and debug. No natural mapping to "standard deviations" threshold. The LOF score requires its own threshold calibration. Adds implementation complexity without clear need until centroid distance is proven insufficient.

### Option D: Phased Approach

- Ship with Option A (Composite + Centroid)
- Instrument the distance distribution and outlier flags on the real dataset
- If centroid distance produces counterintuitive results (too many flags, bimodal artifacts), evaluate LOF as a v2 upgrade
- The composite distance metric is shared between Options A and C, so the upgrade path is clean

**Tradeoffs:** Fastest to ship. The composite metric is the real decision; the outlier detection method is swappable. Risk: if centroid distance is inadequate, a second round of work is needed.
