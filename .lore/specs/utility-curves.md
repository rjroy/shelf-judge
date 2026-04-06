---
title: "Utility Curves for Axis Scoring"
date: 2026-04-06
status: draft
tags: [spec, fitness, scoring, axes, utility-curves, ux]
modules: [daemon, shared, web, cli]
req-prefix: CURVE
related:
  - .lore/issues/deferred-utility-curves.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/designs/mvp-data-model.md
  - .lore/brainstorms/fitness-model-options.md
  - .lore/specs/mvp.md
  - .lore/vision.md
---

# Spec: Utility Curves for Axis Scoring

## Overview

The MVP fitness model treats every axis linearly: a higher rating always contributes more to fitness. This works when "more is better" (visual design, theme fit) but breaks down when the user has a sweet spot. A user who considers BGG weight 2.75 the perfect complexity doesn't want a weight-5 game scoring higher on that axis than a weight-2.75 game.

Utility curves let each axis define the shape of its preference: which rating value is ideal, and how fitness degrades as the rating moves away from it. The curve transforms a raw axis rating into an effective rating before it enters the weighted average. Weights remain unchanged; they control how much an axis matters. Curves control what "good" means on that axis.

The central constraint: the user should not need a calculator. Curve configuration must feel like answering a question about preference, not tuning a mathematical function.

## Entry Points

- Axis configuration page (web UI), when editing or creating an axis
- `shelf-judge axis create` and `shelf-judge axis update` CLI commands
- Fitness breakdown display, where the curve's effect on scoring is visible

## Requirements

### Preference Shapes

- REQ-CURVE-1: Each axis has a **preference shape** that defines how raw ratings map to effective ratings. The preference shape is independent of the axis weight. Weight controls importance; shape controls what "good" means.

- REQ-CURVE-2: Three preference shapes are available:
  - **Higher is better** (default): Higher ratings produce higher effective ratings. This is the current linear behavior. A rating of 8 contributes more than a rating of 4.
  - **Lower is better**: Lower ratings produce higher effective ratings. A rating of 2 contributes more than a rating of 7. Use case: "I want low complexity" or "I want short play time."
  - **Sweet spot**: A specific rating value is ideal. Ratings farther from the ideal produce lower effective ratings. Use case: "I like medium complexity, around 5.5."

- REQ-CURVE-3: "Higher is better" is the default preference shape for all axes, including existing axes created before this feature. No existing fitness scores change unless the user explicitly configures a curve.

### Sweet Spot Configuration

- REQ-CURVE-4: When a user selects the "sweet spot" shape, they specify an **ideal value** on the axis's 1-10 scale. The ideal value produces the maximum effective rating. Ratings farther from the ideal produce progressively lower effective ratings.

- REQ-CURVE-5: The user can set a **tolerance** that controls how sharply fitness degrades away from the ideal. Three named levels, with quantitative anchors (measured at 3 points from the ideal, symmetric, moderate tolerance):
  - **Flexible**: Ratings near the ideal score almost as well. A rating 3 points from the ideal produces an effective rating no lower than 7. ("I prefer medium complexity but I'm not picky.")
  - **Moderate** (default): Balanced falloff. A rating 3 points from the ideal produces an effective rating between 4 and 5. ("I have a preference but I'm reasonable.")
  - **Strict**: Only ratings close to the ideal score well. A rating 3 points from the ideal produces an effective rating no higher than 2.5. ("I know exactly what I want.")

- REQ-CURVE-6: The user can express **asymmetric tolerance** by indicating a lean direction: "I'd rather too high than too low" or "I'd rather too low than too high." This is optional; the default is symmetric falloff. When asymmetric, the preferred side has a gentler slope than the avoided side. Lean direction is always expressed in axis-scale terms (1-10), not BGG-scale terms. For BGG-derived axes, the UI translates between scales (see REQ-CURVE-23) but stores lean in axis-scale terms.
  - Example: Complexity axis with ideal 5.5 and lean "toward lower axis values" (i.e., "rather too simple than too complex"). A raw axis rating of 3 (2.5 below ideal) produces a higher effective rating than a raw axis rating of 8 (2.5 above ideal), because the lower side has a gentler slope.

### Effective Rating

- REQ-CURVE-7: The preference shape transforms a raw axis rating (1-10) into an effective rating (1-10). The effective rating is what enters the weighted average in place of the raw rating. The fitness formula remains `sum(effective_rating * weight) / sum(weights)`.

- REQ-CURVE-8: For sweet spot curves: the effective rating at the ideal value is 10 (the maximum). Both extremes of the scale (raw ratings 1 and 10) produce effective rating 1 (the minimum), regardless of where the ideal sits. The curve interpolates smoothly between these fixed points, with the shape determined by tolerance and lean. For "higher is better": raw 1 maps to effective 1, raw 10 maps to effective 10 (identity). For "lower is better": raw 1 maps to effective 10, raw 10 maps to effective 1 (inversion). Both linear shapes map proportionally across the range. In the existing fitness formula, "effective rating" is what the MVP design calls `axis_score`; these are the same value after curve transformation.

- REQ-CURVE-9: Effective ratings are continuous and monotonic on each side of the sweet spot peak. No jumps, no plateaus, no dead zones. The curve is smooth.

### Veto Thresholds

- REQ-CURVE-10: Any axis can optionally define a **veto threshold**: a rating value below which (or above which, depending on direction) the game's entire fitness score drops to 0 regardless of other axes. This represents a hard disqualifier.
  - Example: "Wife will play it" axis with veto below 4. If a game scores 3 on that axis, fitness is 0 no matter how well it scores elsewhere.

- REQ-CURVE-11: Veto is independent of preference shape. An axis can be "higher is better" with a veto below 3, or "lower is better" with a veto above 7. For sweet spot axes, a veto specifies a single directional threshold (below or above), same as the other shapes. To veto both extremes on a sweet spot axis, the user would need to create the axis twice (one for each direction), which is intentionally awkward because double-ended vetoes are a strong constraint that should require deliberate setup. The veto check happens before the curve transform; if the raw rating triggers the veto, the curve never runs.

- REQ-CURVE-12: When a veto triggers, the fitness breakdown clearly identifies which axis triggered it, what the threshold was, and what the game's rating on that axis was. The breakdown still shows what the score would have been without the veto, so the user can see how close the game is to clearing.

### Fitness Breakdown

- REQ-CURVE-13: The fitness breakdown (REQ-MVP-5) expands to show curve effects. For each axis, the breakdown shows: raw rating, preference shape, effective rating, weight, and contribution. When the raw and effective ratings differ, both are visible.

- REQ-CURVE-14: When a game's score is affected by a curve (effective rating differs from raw rating by more than 0.5), the breakdown highlights the affected axis so the user can see which curves are shaping the score.

### Web UI

- REQ-CURVE-15: Axis configuration (create and edit) includes preference shape selection. The default is "higher is better." Selecting a shape does not require understanding the underlying math. Shape names and descriptions are in plain language.

- REQ-CURVE-16: When the user selects "sweet spot," a control appears to set the ideal value. This should feel like pointing at a spot on a scale, not entering a formula. A visual representation of the resulting curve shape updates as the user adjusts the ideal, tolerance, and lean.

- REQ-CURVE-17: The curve preview shows what effective ratings would result from a range of raw ratings given the current settings. The user can see, before saving, that "a raw rating of 8 on this axis would produce an effective rating of 4.2." This is the core feedback mechanism that replaces needing a calculator.

- REQ-CURVE-18: Veto threshold configuration is a separate, clearly labeled option on the axis. It is not part of the preference shape selector. Enabling a veto requires explicit confirmation since it has a dramatic effect on scoring.

- REQ-CURVE-19: The game detail view and scores list show veto status visually. A vetoed game is immediately distinguishable from a low-scoring game.

### CLI

- REQ-CURVE-20: `shelf-judge axis create` and `shelf-judge axis update` accept options for preference shape, ideal value, tolerance, lean direction, and veto threshold. All are optional; defaults match the web UI.

- REQ-CURVE-21: `shelf-judge scores` and `shelf-judge games <id>` display curve effects in the fitness breakdown. Vetoed games show the veto indicator and the hypothetical score.

### BGG-Derived Axes

- REQ-CURVE-22: Preference shapes apply to BGG-derived axes the same way they apply to personal axes. The default Complexity axis is the primary use case for sweet-spot curves: BGG weight data is continuous and users commonly have a preferred complexity range rather than "more is better."

- REQ-CURVE-23: When a BGG-derived axis uses a sweet-spot curve, the ideal value is expressed on the axis's 1-10 scale (after the BGG-to-axis mapping). For Complexity, which maps BGG weight 1-5 to axis rating 2-10, an ideal BGG weight of 2.75 corresponds to an ideal axis rating of 5.5. The UI should show both the axis-scale value and the original BGG-scale equivalent for BGG-derived axes.

### Data Integrity

- REQ-CURVE-24: Adding curve configuration to an axis does not alter any stored game ratings. Ratings remain raw values. The curve transform is applied at calculation time, not at storage time. This means changing or removing a curve immediately recalculates all affected fitness scores without any data migration.

- REQ-CURVE-25: Removing a preference shape from an axis (resetting to "higher is better") restores the pre-curve scoring behavior for that axis. No data is lost.

## Exit Points

| Exit                   | Triggers When                                                     | Target                      |
| ---------------------- | ----------------------------------------------------------------- | --------------------------- |
| Custom curve editor    | User needs a shape beyond the three presets                       | [STUB: custom-curve-editor] |
| Axis presets/templates | Users want to share or reuse axis configurations including curves | [STUB: axis-templates]      |
| Redundancy scoring     | Collection-aware fitness that considers overlap between games     | [STUB: redundancy-scoring]  |

## Success Criteria

- [ ] A user can set "sweet spot at 5.5" on the Complexity axis and see that a game with BGG weight 2.75 (rating 5.5) scores higher than games with BGG weight 1 or BGG weight 5 on that axis
- [ ] A user can set "lower is better" on an axis and verify that a game rated 2 on that axis scores higher than a game rated 8
- [ ] A user with sweet spot ideal 5.5 and lean "toward lower values" sees a game rated 3 rank higher than a game rated 8 on that axis, even though both are 2.5 points from the ideal
- [ ] Changing an axis from "higher is better" to "sweet spot" immediately recalculates all fitness scores; no manual action required
- [ ] The curve configuration UI includes plain-language descriptions of each shape and a live preview that updates as settings change, such that no external documentation is required to configure a basic sweet spot
- [ ] A vetoed game shows fitness 0 with a clear explanation of which axis triggered the veto and what the score would be without it
- [ ] All existing fitness scores are unchanged until the user explicitly configures a curve
- [ ] The fitness breakdown for every game shows both raw and effective ratings when they differ, making the curve's effect traceable

## AI Validation

**Defaults** (apply unless overridden):

- Unit tests with mocked time/network/filesystem
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom:**

- Curve math validation: unit tests verify that effective ratings are continuous, within 1-10, peak at the ideal value, and respect tolerance/lean settings
- Backward compatibility: test that a collection with no curve configuration produces identical fitness scores to the current implementation
- Veto interaction: test that veto + curve combinations produce correct results (veto fires before curve, hypothetical score calculated with curve)
- BGG scale display: test that BGG-derived axes show both axis-scale and BGG-scale ideal values
- Round-trip: configure a curve in the web UI, verify the CLI displays the same curve parameters and produces the same scores

## Constraints

- The fitness formula structure (`sum(effective_rating * weight) / sum(weights)`) does not change. Curves operate within the existing aggregation, not alongside it. This preserves the transparency guarantee from REQ-MVP-5.
- No new dependencies on external services. Curve computation is local math.
- Curve parameters are stored on the Axis, not on individual game ratings. One curve definition per axis, applied uniformly to all games.

## Context

**Origin:** Deferred from MVP spec as [STUB: utility-curves]. The brainstorm's Approach 4 explored this territory in depth, proposing linear, plateau, S-curve, and hard veto shapes with multiplicative aggregation. This spec simplifies that vision: three intuitive presets instead of four math-flavored curve types, and the existing additive weighted average instead of a multiplicative product.

**Why presets over free-form curves:** The brainstorm's Approach 4 verdict identified the highest risk as "calibration difficulty: plateau and S-curve parameters require the user to think about exact threshold values." Presets with a visual preview sidestep this. The user picks a shape, adjusts an ideal value, and sees the result. The [STUB: custom-curve-editor] exit point preserves the path to full curve control for power users who outgrow presets.

**Why additive aggregation stays:** The brainstorm proposed multiplicative aggregation (`fitness = 10 * product(utility_i ^ w_i)`) to make vetoes natural. This spec uses an explicit veto mechanism instead, keeping the additive weighted average that users already understand. A single veto axis zeroing the score is more legible than explaining why a geometric mean produced 0.3 when most axes scored well.

**Relationship to weights:** Weights and curves answer different questions. Weight: "How much does this axis matter compared to others?" Curve: "What does a good rating look like on this axis?" A high-weight axis with a sweet-spot curve means "this matters a lot, and I have a specific preference." A low-weight axis with linear scoring means "this matters a little, and more is always better." The two compose naturally.

**Key design documents:**

- `.lore/brainstorms/fitness-model-options.md` (Approach 4: Multi-Criteria Utility with Axis Curves)
- `.lore/designs/mvp-fitness-model.md` (current weighted average model)
- `.lore/designs/mvp-data-model.md` (Axis type definition)
- `.lore/issues/deferred-utility-curves.md` (issue that triggered this spec)
