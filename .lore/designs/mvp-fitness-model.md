---
title: "MVP Fitness Score Model"
date: 2026-04-04
status: implemented
tags: [design, fitness, scoring, algorithm, mvp]
modules: [daemon]
related:
  - .lore/specs/mvp.md
  - .lore/brainstorms/fitness-model-options.md
---

# Design: MVP Fitness Score Model

Satisfies: REQ-MVP-4, REQ-MVP-5, REQ-MVP-6, REQ-MVP-14, REQ-MVP-17

## Decision: Axis Scorecard (Approach 1, weighted average)

The MVP uses Approach 1 from the brainstorm: direct axis ratings with weighted average aggregation. This is the right starting point for three reasons:

1. **Transparency is the non-negotiable principle.** The vision's tension table says transparency beats precision, always. Weighted average produces a breakdown where every point is traceable to a specific axis, weight, and rating. No other approach is this legible.

2. **Works from game one.** No cold-start problem. Rate one game on one axis, get a fitness score. The pairwise tournament (deferred) needs 20+ games to converge. The profile similarity approach (Approach 3) needs a meaningful collection to build a centroid. The scorecard delivers value immediately.

3. **Foundation for the hybrid.** The brainstorm's conclusion envisions tournament ranking + axis ratings as a combined vector. The axis scorecard is the axis half of that hybrid. Building it first means the tournament layer, when added, slots in alongside it rather than replacing it.

## The Math

**Fitness score** for a game is the weighted average of all rated axes:

```
fitness = sum(axis_score_i * axis_weight_i) / sum(axis_weight_i)
```

Where the sum runs over all axes that have a rating for this game (personal or BGG-derived).

**Result range:** 1.0 to 10.0 (inherits the axis rating range).

**Missing ratings:** If a game has no rating for an axis, that axis is excluded from both numerator and denominator. The breakdown shows the excluded axis as "not rated" so the user knows it didn't contribute.

**BGG-derived axis scores:** Auto-populated from cached BGG data using the mapping defined in the data model design. The user can override any BGG-derived score with a personal rating. When overridden, the breakdown shows "[your rating, BGG: X.X]" so the original value is visible.

## Score Breakdown

Every fitness score is accompanied by a breakdown. This is not optional. A score without a breakdown violates Principle 2 of the vision.

```typescript
interface FitnessResult {
  score: number; // 1.0 - 10.0
  ratedAxisCount: number; // How many axes contributed
  totalAxisCount: number; // How many axes exist
  breakdown: FitnessBreakdownEntry[];
}

interface FitnessBreakdownEntry {
  axisId: string;
  axisName: string;
  rating: number | null; // null if not rated
  weight: number;
  contribution: number | null; // Points contributed to score, null if not rated
  source: "personal" | "bgg" | "override" | "predicted" | "tournament"; // "override" = user replaced BGG value; "predicted" added by REQ-PRED-33; "tournament" added by REQ-TAXIS-2
  bggOriginal: number | null; // Original BGG value when source is "override"
}
```

## Example

A user has three axes: "Wife will play it" (weight 40), "Visual design" (weight 30), "Complexity" (weight 20, BGG-derived), and "Community Rating" (weight 10, BGG-derived).

For Wingspan:

```
Fitness: 7.9

  Wife will play it:    8   x 40  -> 320    [your rating]
  Visual design:        9   x 30  -> 270    [your rating]
  Complexity:           5.8 x 20  -> 116    [BGG weight 2.9 -> 5.8]
  Community Rating:     8.1 x 10  ->  81    [BGG]

  Sum of contributions: 787
  Sum of weights:       100
  Score: 787 / 100 = 7.87

  Rounded: 7.9
```

Scores are stored and displayed to one decimal place.
