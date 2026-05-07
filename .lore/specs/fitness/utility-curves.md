---
title: "Utility Curves for Axis Scoring"
date: 2026-04-06
status: implemented
tags: [spec, fitness, scoring, axes, utility-curves, ux]
modules: [daemon, shared, web, cli]
req-prefix: CURVE
related:
  - .lore/issues/fitness/deferred-utility-curves.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/designs/mvp-data-model.md
  - .lore/brainstorms/fitness-model-options.md
  - .lore/specs/mvp.md
  - .lore/vision.md
---

# Spec: Utility Curves for Axis Scoring

## Overview

The MVP fitness model has two problems. First, it treats every axis linearly: a higher rating always contributes more to fitness. This works when "more is better" (visual design, theme fit) but breaks down when the user has a sweet spot. A user who considers BGG weight 2.75 the perfect complexity doesn't want a weight-5 game scoring higher on that axis than a weight-2.75 game.

Second, the mapping from raw data to the 1-10 fitness scale is hardcoded and crude. BGG complexity (a 1-5 value) is normalized with `weight * 2`, which maps to 2-10 (never reaching 1) and discards the user's sense of what "good" means on that scale. Community Rating passes through unchanged because it happens to already be 1-10. These are implementation shortcuts, not design decisions.

Utility curves solve both problems by making normalization explicit and configurable. Each axis has a **native scale** (the range its raw values live on) and a **preference curve** that defines how values on that native scale map to effective 1-10 ratings. For personal axes rated 1-10 with "more is better," the curve is identity. For BGG complexity on a 1-5 scale with a sweet spot at 2.75, the curve peaks at 2.75 and falls off from there. The curve _is_ the normalization.

Weights remain unchanged; they control how much an axis matters. Curves control what "good" means on that axis and how native values become comparable across axes.

The central constraint: the user should not need a calculator. Curve configuration must feel like answering a question about preference, not tuning a mathematical function.

## Entry Points

- Axis configuration page (web UI), when editing or creating an axis
- `shelf-judge axis create` and `shelf-judge axis update` CLI commands
- Fitness breakdown display, where the curve's effect on scoring is visible

## Requirements

### Native Scale

- REQ-CURVE-1: Each axis has a **native scale** defined by a minimum and maximum value. Raw ratings on the axis exist within this range. The native scale determines the input domain for the preference curve.

- REQ-CURVE-2: Personal axes (source: "personal") have a fixed native scale of 1 to 10. This is the range users rate on and is not configurable.

- REQ-CURVE-3: BGG-derived axes (source: "bgg") have native scales determined by the BGG field they map to. These are hardcoded per field:
  - `communityRating`: native scale 1 to 10
  - `weight` (complexity): native scale 1 to 5
  - Future BGG fields define their own native scales when added.

- REQ-CURVE-3a: Tournament axes (source: "tournament", added by `.lore/specs/tournament/elo-axis-source.md`) have a fixed native scale of 1 to 10, matching the normalized ELO display score produced by REQ-TOURN-9. The default preference shape is "higher is better" with identity passthrough; the value entering the curve is already on the 1-10 effective scale, so the curve is a no-op by default. Sweet-spot or lower-is-better curves are not meaningful for the tournament axis (revealed preference is monotonic by construction) but are not blocked at the type level.

### Preference Shapes

- REQ-CURVE-4: Each axis has a **preference shape** that defines how raw values on the native scale map to effective 1-10 ratings. The preference shape is independent of the axis weight. Weight controls importance; shape controls what "good" means. The curve is the normalization: it replaces the current hardcoded BGG mappings (e.g., `weight * 2`) with a configurable, visible transform.

- REQ-CURVE-5: Three preference shapes are available:
  - **Higher is better** (default): Linear map from [scaleMin, scaleMax] to [1, 10]. Higher native values produce higher effective ratings. For a personal axis (1-10 native), this is identity. For BGG complexity (1-5 native), BGG weight 1 maps to effective 1, BGG weight 5 maps to effective 10.
  - **Lower is better**: Inverted linear map from [scaleMin, scaleMax] to [10, 1]. Lower native values produce higher effective ratings. Use case: "I want low complexity" or "I want short play time."
  - **Sweet spot**: A specific value on the native scale is ideal. Values farther from the ideal produce lower effective ratings. Use case: "I like medium complexity, around BGG weight 2.75."

- REQ-CURVE-6: "Higher is better" is the default preference shape for all axes, including existing axes created before this feature. For BGG complexity, this changes the normalization from `weight * 2` (mapping 1-5 to 2-10) to a proper linear stretch (mapping 1-5 to 1-10). This is a minor score correction, not a behavioral change. Existing personal axes (native 1-10, higher is better) produce identical scores.

### Sweet Spot Configuration

- REQ-CURVE-7: When a user selects the "sweet spot" shape, they specify an **ideal value** on the axis's native scale. The ideal value produces the maximum effective rating (10). Values farther from the ideal produce progressively lower effective ratings. For BGG complexity, this means setting the ideal as a BGG weight value (e.g., 2.75), not a post-normalization value.

- REQ-CURVE-8: The user can set a **tolerance** that controls how sharply fitness degrades away from the ideal. Three named levels, with quantitative anchors expressed as fractions of the native scale range (measured at one-third of the scale range from the ideal, symmetric, moderate tolerance):
  - **Flexible**: Values near the ideal score almost as well. A value one-third of the scale range from the ideal produces an effective rating no lower than 7. ("I prefer medium complexity but I'm not picky.")
  - **Moderate** (default): Balanced falloff. A value one-third of the scale range from the ideal produces an effective rating between 4 and 5. ("I have a preference but I'm reasonable.")
  - **Strict**: Only values close to the ideal score well. A value one-third of the scale range from the ideal produces an effective rating no higher than 2.5. ("I know exactly what I want.")
  - For BGG complexity (scale range 4, from 1 to 5): one-third of the range is ~1.33 weight points. For a personal axis (scale range 9, from 1 to 10): one-third of the range is 3 rating points.

- REQ-CURVE-9: The user can express **asymmetric tolerance** by indicating a lean direction: "I'd rather too high than too low" or "I'd rather too low than too high." This is optional; the default is symmetric falloff. When asymmetric, the preferred side has a gentler slope than the avoided side. Lean direction is expressed in native scale terms.
  - Example: Complexity axis (native scale 1-5) with ideal BGG weight 2.75 and lean "toward lower." A BGG weight of 1.5 (1.25 below ideal) produces a higher effective rating than a BGG weight of 4.0 (1.25 above ideal), because the lower side has a gentler slope.

### Effective Rating

- REQ-CURVE-10: The preference curve transforms a raw value on the axis's native scale into an effective rating on the 1-10 scale. The effective rating is what enters the weighted average in place of the raw value. The fitness formula remains `sum(effective_rating * weight) / sum(weights)`. In the existing fitness formula, "effective rating" is what the MVP design calls `axis_score`; these are the same value after curve transformation.

- REQ-CURVE-11: Fixed points for each preference shape:
  - **Higher is better**: scaleMin maps to effective 1, scaleMax maps to effective 10. Linear interpolation between.
  - **Lower is better**: scaleMin maps to effective 10, scaleMax maps to effective 1. Linear interpolation between.
  - **Sweet spot**: The ideal value maps to effective 10 (maximum). Both scaleMin and scaleMax map to effective 1 (minimum), regardless of where the ideal sits. The curve interpolates smoothly between these fixed points, with the shape determined by tolerance and lean.

- REQ-CURVE-12: Effective ratings are continuous and monotonic on each side of the sweet spot peak. No jumps, no plateaus, no dead zones. The curve is smooth.

### Veto Thresholds

- REQ-CURVE-13: Any axis can optionally define a **veto threshold**: a value on the native scale below which (or above which, depending on direction) the game's entire fitness score drops to 0 regardless of other axes. This represents a hard disqualifier.
  - Example: "Wife will play it" axis (personal, native 1-10) with veto below 4. If a game scores 3 on that axis, fitness is 0 no matter how well it scores elsewhere.

- REQ-CURVE-14: Veto is independent of preference shape. An axis can be "higher is better" with a veto below a native-scale value, or "lower is better" with a veto above one. For sweet spot axes, a veto specifies a single directional threshold (below or above), same as the other shapes. To veto both extremes on a sweet spot axis, the user would need to create the axis twice (one for each direction), which is intentionally awkward because double-ended vetoes are a strong constraint that should require deliberate setup. The veto check happens before the curve transform; if the raw value triggers the veto, the curve never runs.

- REQ-CURVE-15: When a veto triggers, the fitness breakdown clearly identifies which axis triggered it, what the threshold was (in native-scale terms), and what the game's raw value on that axis was. The breakdown still shows what the score would have been without the veto, so the user can see how close the game is to clearing.

### Fitness Breakdown

- REQ-CURVE-16: The fitness breakdown (REQ-MVP-5) expands to show curve effects. For each axis, the breakdown shows: raw value (on native scale), preference shape, effective rating (1-10), weight, and contribution. When the raw and effective values differ (i.e., the curve is not identity), both are visible.

- REQ-CURVE-17: When a game's score is affected by a curve (effective rating differs from what a simple "higher is better" linear map would produce by more than 0.5), the breakdown highlights the affected axis so the user can see which curves are shaping the score.

### Web UI

- REQ-CURVE-18: Axis configuration (create and edit) includes preference shape selection. The default is "higher is better." Selecting a shape does not require understanding the underlying math. Shape names and descriptions are in plain language.

- REQ-CURVE-19: When the user selects "sweet spot," a control appears to set the ideal value on the axis's native scale. For BGG complexity, the slider or input ranges from 1 to 5 (BGG weight values). For personal axes, it ranges from 1 to 10. This should feel like pointing at a spot on a scale, not entering a formula. A visual representation of the resulting curve shape updates as the user adjusts the ideal, tolerance, and lean.

- REQ-CURVE-20: The curve preview shows what effective ratings (1-10) would result from a range of raw values on the native scale. The user can see, before saving, that "a BGG weight of 4.0 on this axis would produce an effective rating of 3.1." This is the core feedback mechanism that replaces needing a calculator. The preview axis labels use native-scale values (BGG weight for complexity, 1-10 for personal axes).

- REQ-CURVE-21: Veto threshold configuration is a separate, clearly labeled option on the axis. It is not part of the preference shape selector. The threshold value is entered in native-scale terms. Enabling a veto requires explicit confirmation since it has a dramatic effect on scoring.

- REQ-CURVE-22: The game detail view and scores list show veto status visually. A vetoed game is immediately distinguishable from a low-scoring game.

### CLI

- REQ-CURVE-23: `shelf-judge axis create` and `shelf-judge axis update` accept options for preference shape, ideal value (in native-scale terms), tolerance, lean direction, and veto threshold (in native-scale terms). All are optional; defaults match the web UI.

- REQ-CURVE-24: `shelf-judge scores` and `shelf-judge games <id>` display curve effects in the fitness breakdown. Raw values are shown in native-scale terms. Vetoed games show the veto indicator and the hypothetical score.

### BGG-Derived Axes

- REQ-CURVE-25: Preference shapes apply to BGG-derived axes the same way they apply to personal axes. The native scale (REQ-CURVE-3) handles the difference: the curve operates on 1-5 for complexity, 1-10 for community rating. No special-casing is needed in the curve logic itself. The default Complexity axis is the primary use case for sweet-spot curves: BGG weight data is continuous and users commonly have a preferred complexity range rather than "more is better."

- REQ-CURVE-26: The UI and CLI present BGG-derived axis values in their native scale. For complexity, the user sees and configures in BGG weight values (1-5). There is no separate "axis scale" vs "BGG scale" translation layer; the native scale _is_ the BGG scale. The curve handles the mapping to effective 1-10 ratings internally.

### Data Integrity

- REQ-CURVE-27: Adding curve configuration to an axis does not alter any stored game ratings. Ratings remain raw values on the native scale. The curve transform is applied at calculation time, not at storage time. This means changing or removing a curve immediately recalculates all affected fitness scores without any data migration.

- REQ-CURVE-28: Removing a preference shape from an axis (resetting to "higher is better") restores the default linear normalization for that axis. No data is lost.

## Exit Points

| Exit                   | Triggers When                                                     | Target                      |
| ---------------------- | ----------------------------------------------------------------- | --------------------------- |
| Custom curve editor    | User needs a shape beyond the three presets                       | [STUB: custom-curve-editor] |
| Axis presets/templates | Users want to share or reuse axis configurations including curves | [STUB: axis-templates]      |
| Redundancy scoring     | Collection-aware fitness that considers overlap between games     | [STUB: redundancy-scoring]  |

## Success Criteria

- [ ] A user can set "sweet spot at 2.75" on the Complexity axis (native scale 1-5) and see that a game with BGG weight 2.75 scores higher than games with BGG weight 1 or BGG weight 5 on that axis
- [ ] A user can set "lower is better" on a personal axis and verify that a game rated 2 scores higher than a game rated 8
- [ ] A user with Complexity sweet spot at 2.75 and lean "toward lower" sees a game with BGG weight 1.5 rank higher than a game with BGG weight 4.0 on that axis, even though both are 1.25 points from the ideal on the native scale
- [ ] Changing an axis from "higher is better" to "sweet spot" immediately recalculates all fitness scores; no manual action required
- [ ] The curve configuration UI shows the native scale (1-5 for complexity, 1-10 for personal axes), includes plain-language descriptions of each shape, and provides a live preview that updates as settings change
- [ ] A vetoed game shows fitness 0 with a clear explanation of which axis triggered the veto (threshold shown in native-scale terms) and what the score would be without it
- [ ] Existing personal axis fitness scores are unchanged until the user explicitly configures a curve. BGG complexity scores shift slightly due to the corrected linear normalization (1-5 to 1-10 instead of `weight * 2`)
- [ ] The fitness breakdown for every game shows raw values in native-scale terms and effective 1-10 ratings when they differ, making the curve's effect traceable

## AI Validation

**Defaults** (apply unless overridden):

- Unit tests with mocked time/network/filesystem
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom:**

- Curve math validation: unit tests verify that effective ratings are continuous, within 1-10, peak at the ideal value, and respect tolerance/lean settings across different native scales (1-5 and 1-10)
- Backward compatibility: test that a collection with no curve configuration produces identical fitness scores to the current implementation for personal axes. For BGG complexity, test that the corrected normalization (1-5 to 1-10 linear) produces the expected minor score change from the old `weight * 2` mapping
- Veto interaction: test that veto + curve combinations produce correct results (veto fires before curve, hypothetical score calculated with curve). Veto thresholds expressed in native-scale terms
- Native scale consistency: test that BGG-derived axes present and accept values in their native scale (1-5 for complexity) in both UI and CLI
- Round-trip: configure a curve in the web UI, verify the CLI displays the same curve parameters (in native-scale terms) and produces the same scores

## Constraints

- The fitness formula structure (`sum(effective_rating * weight) / sum(weights)`) does not change. Curves operate within the existing aggregation, not alongside it. This preserves the transparency guarantee from REQ-MVP-5.
- No new dependencies on external services. Curve computation is local math.
- Curve parameters are stored on the Axis, not on individual game ratings. One curve definition per axis, applied uniformly to all games.
- The `resolveBggRating` function in `fitness-service.ts` (which currently hardcodes `weight * 2`) is replaced by the curve system. BGG field resolution returns the raw native-scale value; the curve handles normalization to effective 1-10.
- Native scales for BGG fields are hardcoded constants, not user-configurable. When a new BGG field is added as an axis source, its native scale is defined in code alongside the field mapping.

## Context

**Origin:** Deferred from MVP spec as [STUB: utility-curves]. The brainstorm's Approach 4 explored this territory in depth, proposing linear, plateau, S-curve, and hard veto shapes with multiplicative aggregation. This spec simplifies that vision: three intuitive presets instead of four math-flavored curve types, and the existing additive weighted average instead of a multiplicative product.

**Why presets over free-form curves:** The brainstorm's Approach 4 verdict identified the highest risk as "calibration difficulty: plateau and S-curve parameters require the user to think about exact threshold values." Presets with a visual preview sidestep this. The user picks a shape, adjusts an ideal value, and sees the result. The [STUB: custom-curve-editor] exit point preserves the path to full curve control for power users who outgrow presets.

**Why additive aggregation stays:** The brainstorm proposed multiplicative aggregation (`fitness = 10 * product(utility_i ^ w_i)`) to make vetoes natural. This spec uses an explicit veto mechanism instead, keeping the additive weighted average that users already understand. A single veto axis zeroing the score is more legible than explaining why a geometric mean produced 0.3 when most axes scored well.

**Relationship to weights:** Weights and curves answer different questions. Weight: "How much does this axis matter compared to others?" Curve: "What does a good value look like on this axis, and how does it become a 1-10 score?" A high-weight axis with a sweet-spot curve means "this matters a lot, and I have a specific preference." A low-weight axis with linear scoring means "this matters a little, and more is always better." The two compose naturally.

**Native scale as first-class concept:** The MVP treated normalization as an implementation detail (a `* 2` buried in a switch statement). This spec promotes it to a visible, configurable part of the model. Every axis knows what scale its raw values live on, and the curve defines the mapping from that scale to the common 1-10 effective range. This makes the system honest about what it's doing: when BGG weight 2.75 becomes effective rating 5.5, the user can see why (linear stretch of 1-5 to 1-10) and change it (sweet spot at 2.75 instead).

**Key design documents:**

- `.lore/brainstorms/fitness-model-options.md` (Approach 4: Multi-Criteria Utility with Axis Curves)
- `.lore/designs/mvp-fitness-model.md` (current weighted average model)
- `.lore/designs/mvp-data-model.md` (Axis type definition)
- `.lore/issues/fitness/deferred-utility-curves.md` (issue that triggered this spec)
