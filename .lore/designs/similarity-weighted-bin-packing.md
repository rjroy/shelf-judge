---
title: Similarity-weighted 3D bin packing algorithm
date: 2026-04-12
status: approved
tags: [algorithm, bin-packing, optimization, fitness, spatial]
---

# Design: Similarity-Weighted 3D Bin Packing

## Problem

Standard bin-packing optimizes for space. This algorithm optimizes for two objectives simultaneously: **spatial efficiency** (items should fit their bins well) and **item similarity** (items sharing a bin should be related to each other). A third, optional objective adds **neighbor coherence** (items in adjacent bins should also be somewhat related).

The use case is physical shelving where grouping matters: a bookshelf where you want similar books together, a game shelf where related games sit near each other, a warehouse where picking efficiency depends on product co-location.

## Core Concepts

### Items

Each item has:

- **Dimensions**: a 3-tuple `[h, w, d]` representing its bounding box. Optional; dimensionless items exist (cards, accessories) and bypass spatial logic entirely.
- **Location override**: an optional fixed assignment. Some items must go in a specific bin regardless of fitness. Overrides come in two flavors:
  - _Hard_: the item is excluded from packing (unowned, culled, in transit). Placed directly.
  - _Soft_: the item prefers a bin but can be reassigned if it doesn't fit.
- **Similarity function**: `compare(other) -> [0, 1]` where 1 means identical profile and 0 means completely unrelated. The algorithm is agnostic to what "similar" means. The consumer defines it.

### Bins

Each bin has:

- **Dimensions**: a 3-tuple `[h, w, d]` representing available interior space. Optional; dimensionless bins (overflow, drawer, archive) accept items without spatial constraints.
- **Axis priority**: an ordered permutation of `[0, 1, 2]` controlling which axis to fill first. Default `[0, 1, 2]` fills axis 0 first. In the shelf-capacity adapter, axis 0 is shelf width (the fill direction).
- **Axis minimization flags**: per-axis booleans controlling whether the item's dimension along that axis should be maximized (fill the space) or minimized (leave room). Default: `[false, true, true]` (maximize axis-0 consumption, minimize axes 1 and 2 to conserve space).
- **Neighbors**: references to adjacent bins. Used for neighbor coherence scoring.
- **Layer**: integer priority tier. Higher layers fill first. Allows "fill the premium shelves before the basement."
- **Sort group**: integer for display ordering. Separates physical locations (upstairs shelf vs. downstairs shelf vs. overflow).

### Configuration

All tuning parameters live in a config object:

```
config:
  merge_strategy: "geomax"   # How to combine multiple scores into one

  bin_fitness_weights:        # How to rank which bin to fill next
    base:     0.20            # How well current contents relate to each other
    unsorted: 0.70            # How well remaining items would fit here
    neighbor: 0.10            # How well this bin's contents relate to neighbor bins
    top_n:    1               # Consider only the top N candidate items per bin

  item_fitness_weights:       # How to score placing a specific item in a specific bin
    space:    0.10            # How well the item fills the remaining space
    game:     0.80            # How similar the item is to existing bin contents
    neighbor: 0.10            # How similar the item is to neighboring bin contents

  min_remainder: [0.25, 3, 4] # Minimum useful sub-volume after placement (discard slivers)
  force_axis_0_width: true    # Lock axis 0 to the item's depth/spine (items face outward)
```

## Merge Strategies

Multiple similarity or fitness scores need to be collapsed into a single number. The algorithm supports pluggable merge functions:

| Strategy     | Formula                                           | Character                                                                                                                     |
| ------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **avg**      | arithmetic mean                                   | Balanced, tolerant of outliers                                                                                                |
| **geo**      | geometric mean                                    | Penalizes any single low score more than avg                                                                                  |
| **harmonic** | harmonic mean                                     | Penalizes low scores heavily                                                                                                  |
| **max**      | maximum                                           | Optimistic, driven by best match                                                                                              |
| **min**      | minimum                                           | Pessimistic, driven by worst match                                                                                            |
| **geomax**   | `(cap * product)^(1/(n+1))` where cap = max score | Geometric mean anchored to the best score. Rewards having one strong match while still penalizing zeros. This is the default. |

The `geomax` strategy deserves explanation. Standard geometric mean treats all scores equally. Geomax seeds the product with the best score, then takes the `(n+1)`th root. This means a bin with one excellent match and several decent ones scores higher than a bin with all mediocre matches. It captures "this item has a home here" better than pure geometric mean.

## Item Rotation and Fit

When placing a 3D item into a bin, the algorithm finds the best box rotation. "Best" is defined by the axis priority and minimization flags.

### Rotation Algorithm

Given item dimensions `[ih, iw, id]`, bin dimensions `[bh, bw, bd]`, axis priority `P`, and minimization flags `M`:

```
for each axis in priority order P:
  from the item's unused dimensions:
    find one that fits (item_dim <= bin_dim on this axis)
    if M[axis] is true:  pick the smallest fitting dimension (conserve space)
    if M[axis] is false: pick the largest fitting dimension (consume space)
  if none fits: try swapping the last two assigned dimensions
  if still none fits: item cannot be placed in this bin
return the rotated dimensions
```

When `force_axis_0_width` is enabled, axis 0 is locked to the item's original axis 0 (the depth/spine dimension in the shelf-capacity adapter). Only axes 1 and 2 are eligible for rotation. This ensures items face outward on a shelf: the spine is locked, and width/height rotate to best fill the shelf's height and depth.

### Post-Placement Dimension Update

After placing an item, only **axis 0** of the bin's remaining dimensions is reduced by the item's rotated axis-0 size. Axes 1 and 2 are unchanged. This is a deliberate simplification: it models a shelf where items are stacked along one axis (the shelf's width, consumed by item spines), not a true 3D residual space. The bag packing variant uses a different model (see below).

### Minimum Remainder Filtering (Bag Packing Variant)

After placing an item, the remaining space splits into sub-volumes. Sub-volumes smaller than `min_remainder` on any sorted axis are discarded. This prevents the algorithm from tracking slivers too small to hold anything, which would waste computation without improving results.

## Fitness Functions

### Item-in-Bin Fitness

Scores how well a specific item fits a specific bin. Three components, weighted by `item_fitness_weights`:

**Space fitness**: How much of the bin's remaining volume the item fills.

```
space_score = merge_strategy(
  for each axis: item_dim[axis] / bin_dim[axis]
)
```

Ratio close to 1.0 means tight fit. The merge strategy (default geomax) means an item that fills two axes well but wastes one still scores reasonably, but not as well as one that fills all three.

**Similarity fitness**: How well the item matches the bin's current contents.

```
similarity_score = merge_strategy(
  for each existing item in bin: compare(new_item, existing_item)
)
```

If the bin is empty, similarity is 0 and the item is scored purely on space.

**Neighbor fitness**: How well the item matches contents of adjacent bins.

```
neighbor_score = merge_strategy(
  for each neighbor bin with contents:
    merge_strategy(compare(new_item, each item in neighbor))
)
```

**Composite**:

```
item_fitness = space * w_space + similarity * w_game + neighbor * w_neighbor
```

With default weights (0.10, 0.80, 0.10), similarity dominates. An item that matches the existing group well will beat a slightly better spatial fit.

### Bin Readiness

Scores how urgently a bin needs filling. Used to decide _which bin to fill next_, not which item to put there. Three components, weighted by `bin_fitness_weights`:

**Base fitness**: How well the bin's current contents relate to each other.

```
base = merge_strategy(
  for each item in bin: item.merge_score(all other items in bin)
)
```

A bin whose contents are already coherent scores high. This rewards bins that have a clear "theme" forming.

**Unsorted fitness**: How well the best remaining unplaced items would fit here.

```
unsorted = merge_strategy(
  top_n best item_fitness scores from unplaced items
)
```

A bin that has strong candidates waiting scores high. This pulls the algorithm toward bins where good placements exist. The `top_n` parameter (default 1) controls how many candidate items contribute to this score. At 1, only the single best candidate matters, making the algorithm greedier: it commits to whichever bin has the strongest single match. Higher values (3-5) smooth the signal by averaging across multiple candidates, favoring bins with several decent options over bins with one great one. The trade-off is between decisiveness (low N) and robustness to early misplacements (high N).

**Neighbor fitness**: How well unplaced items match adjacent bins' contents.

```
bin_readiness = base * w_base + unsorted * w_unsorted + neighbor * w_neighbor
```

With default weights (0.20, 0.70, 0.10), the algorithm prioritizes bins that have good candidates waiting. The base score acts as a tiebreaker favoring bins that are already building a coherent group.

## The Packing Algorithm

Four phases, executed in order.

### Phase 1: Place Fixed Items

Items with hard location overrides go directly to their assigned bin. No fitness calculation. If the bin doesn't exist, create it. This handles items that are unowned, culled, in transit, or manually placed by the user.

Items with soft location overrides that match an existing bin are also placed here. Soft overrides that don't match any existing bin fall through to Phase 3 as regular unplaced items. The override is a preference, not a mandate: if the preferred bin doesn't exist or doesn't fit, the item competes for placement like any other.

### Phase 2: Place Unambiguous Items

For each remaining item, check all bins. If the item physically fits in exactly one bin, place it there. No choice means no optimization needed, and placing these early prevents the greedy loop from wasting cycles on foregone conclusions. When multiple unambiguous items target the same single bin, they are placed in input order. Each placement changes the bin's remaining dimensions and similarity profile, so a later unambiguous item may no longer fit and falls through to Phase 3.

### Phase 3: Greedy Iterative Fill

This is the core loop:

```
while unplaced items remain:
  for each bin:
    calculate bin_readiness(unplaced items, neighbor bins)
  sort bins by readiness (highest first), breaking ties by:
    1. layer (higher first)
    2. remaining volume (smaller first, fill tight spaces before loose ones)
    3. id (stable sort)

  for the highest-readiness bin:
    for each unplaced item:
      calculate item_fitness(item, bin)
    select the item with highest fitness
    place it and reduce the bin's remaining dimensions
    restart the loop (re-sort bins with updated state)

  if no bin accepted any item: exit loop
```

Key property: the algorithm re-sorts bins after every single placement. This is expensive but necessary because placing one item changes the similarity profile of its bin, which changes the fitness of every candidate for that bin and its neighbors. Greedy without re-evaluation drifts.

### Phase 4: Overflow

Remaining items (no physical fit anywhere, or dimensionless) go to their safe location. If that bin doesn't exist, create it. This ensures every item ends up somewhere.

## Bag Packing Variant

A variant exists for packing items into bags/cases instead of shelves. Key differences:

- **No location overrides**: all items are candidates for any bag.
- **3D sub-volume splitting**: after placing an item, the remaining space is split into up to 3 rectangular sub-volumes (one per axis of the placed item). Each sub-volume is checked against `min_remainder` and discarded if too small. The bin tracks a _list_ of available sub-volumes rather than a single remaining dimension.
- **No neighbor coherence**: bags don't have spatial adjacency.
- **Higher space weight**: item fitness weights shift toward space (0.25) vs similarity (0.75) because bags are about packing efficiency more than browsing.
- **Post-sort**: after packing, items within each bag are sorted by a configurable score (e.g., overall item quality) for display purposes.

The sub-volume approach is a simplified guillotine cut: each placement generates up to 3 new rectangular regions by subtracting the item's dimension from each axis independently. This is not optimal (it doesn't explore all possible cut orientations) but runs in constant time per placement and produces good-enough results for the typical case of 5-15 items per bag.

## Grading (Post-Processing)

After packing completes, each bin receives a fitness grade. The grade represents how well the bin's final contents work together spatially and thematically.

First, compute the normalization ceiling: the maximum pairwise similarity score across all items in all bins. This is the highest value that `compare(a, b)` returned for any pair `(a, b)` where `a != b`, computed once across the entire packed result.

```
max_score = max over all item pairs (a, b) where a != b: compare(a, b)

for each bin:
  if bin has no dimensions: grade = base_fitness
  if bin has one item:      grade = space_fitness (how well it fills the bin)
  if bin has multiple items:
    best_space = max over items in bin: space_fitness(item, bin's original dimensions)
    grade = (space_weight * best_space + base_weight * (base_fitness / max_score))
            / (space_weight + base_weight)
```

The `base_fitness / max_score` normalization ensures base fitness is relative to the best possible grouping in this particular dataset, not an absolute scale.

Grades map to letters: S (top 10%), A, B, C, D, F (bottom 10%). These are display-only and do not affect the packing.

## Complexity

- **N** = number of items, **B** = number of bins
- Phase 1: O(N)
- Phase 2: O(N \* B)
- Phase 3: O(N^2 _ B) worst case (N iterations, each re-scoring N items against B bins). In practice closer to O(N _ B \* k) where k is the average bin size, because similarity scoring is per-item-in-bin.
- Phase 4: O(N)

The algorithm is quadratic in item count. This is acceptable for hundreds of items (board game collections, personal libraries) but would need optimization for thousands (warehouse-scale).

## Limitations and Trade-offs

**Greedy, not optimal.** The algorithm places one item at a time and never backtracks. It can get stuck in local optima where an early placement blocks a better global arrangement. The re-sorting after each placement mitigates this but doesn't eliminate it.

**Spatial model is 1D after rotation.** Once an item is rotated to fit, only axis 0 (shelf width, consumed by item spines) is subtracted from the bin's remaining dimensions. The algorithm doesn't track 2D or 3D leftover space within a bin (except in the bag variant's sub-volume splitting). This assumes items are roughly the same height and depth, which holds for board games on a KALLAX shelf but not for arbitrary 3D packing.

**Similarity function is a black box.** The algorithm's quality depends entirely on the `compare()` function the consumer provides. A bad similarity function produces bad groupings regardless of how well the packing runs.

**No weight or fragility.** The model has no concept of item weight, fragility, or stacking constraints. Bins are assumed to support any arrangement.

## Open Questions

- Could simulated annealing or beam search improve on the greedy approach without unacceptable runtime cost?
- The 1D spatial subtraction works for uniform-depth shelving but breaks for mixed-depth storage. Is a full 3D residual space tracker worth the complexity?
- Neighbor coherence adds O(B) to every fitness calculation. The current weight (0.10) suggests marginal value. Worth profiling whether disabling it meaningfully changes outcomes.
