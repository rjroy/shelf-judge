---
title: Derived game-metadata axes
date: 2026-08-24
status: approved
tags: [fitness, axes, bgg, player-count, play-time]
modules: [shared, daemon, web, cli]
related: [.lore/specs/fitness/utility-curves.md, .lore/specs/collection/collection-profiling.md, .lore/research/bgg-api.md]
req-prefix: DERIVED
---

# Derived Game-Metadata Axes

## Purpose

Let a collection owner add optional fitness axes whose factual values are derived from imported game metadata, beginning with player-count fit and published play time. The model must no longer assume that every non-personal value is stored in `BggGameData`, so future derived axes can be added in one defined place.

## Decisions

- Derived values are factual game metadata or deterministic calculations from it. They are distinct from personal ratings and the tournament axis.
- Player-count fit uses the publisher-declared inclusive `minPlayers` to `maxPlayers` range, not BGG's suggested-player-count poll.
- A player-count-fit axis has one required integer target-player-count setting from 1 through 100. Its 1-10 score rewards narrow declared ranges close to that target. A missing or invalid declared range produces no value.
- Play time uses the existing published BGG `playingtime` value. Each Play Time axis has an editable `maximumScoringTime` setting, defaulting to 240 minutes, which defines its 1-to-cap native scale. Valid values above the configured cap retain their factual source value but resolve as the cap for scoring. Zero and absent values produce no value.
- The two new axes are optional templates, not collection defaults. Existing Community Rating and Complexity remain available as derived axes after migration.
- A personal 1-10 override remains available for any derived axis and retains current override semantics, including bypassing the derived-axis veto.

## Requirements

### Derived-Axis Model

1. **REQ-DERIVED-1:** The system shall replace the BGG-specific axis field contract with a persisted derived-axis contract that can describe values from any game metadata or deterministic calculation, without requiring the value to be in `BggGameData`.
2. **REQ-DERIVED-2:** The shared package shall provide one exhaustive, typed registry of supported derived fields. Each entry shall declare its stable identifier, display metadata, provenance, native scale and unit, missing-value policy, supported configuration, and game-aware value resolver.
3. **REQ-DERIVED-3:** Validation, API input handling, raw-value resolution, native-scale lookup, curve configuration UI, profile coverage detection, and clients shall use the registry rather than separate field-name switches or unconstrained strings.
4. **REQ-DERIVED-4:** The registry shall initially support `communityRating`, `weight`, `playerCountFit`, and `playingTime`. Unsupported identifiers shall be rejected when axes are created or updated, rather than accepted and failing during scoring.
5. **REQ-DERIVED-5:** Derived values shall continue to enter fitness scoring as native raw values transformed through the axis curve into the common 1-10 effective-rating scale. Missing derived values shall remain visible in score breakdowns but shall not contribute to numerator or denominator.
6. **REQ-DERIVED-6:** Personal overrides of derived axes shall remain integer 1-10 ratings stored separately from factual raw metadata. They shall take precedence over a resolved derived value and retain the original derived raw value in the score breakdown when present.

### Player Count Fit

7. **REQ-DERIVED-7:** A `playerCountFit` axis shall require an integer `targetPlayerCount` from 1 through 100, owned by that axis. Declared game bounds are valid when positive and `minPlayers` is not greater than `maxPlayers`; imported bounds have no arbitrary upper cap.
8. **REQ-DERIVED-8:** Given target `T` and valid declared bounds `m..M`, `playerCountFit` shall start at 10 and apply a distance penalty. When `m <= T <= M`, the penalty is `max(T - m, M - T)`. Otherwise, the penalty is `abs(T - m) + abs(T - M)`. The resulting `10 - penalty` score shall be clamped inclusively to 1 through 10.
9. **REQ-DERIVED-9:** `playerCountFit` shall resolve as missing when either player bound is absent, non-positive, or `minPlayers` exceeds `maxPlayers`. It shall not infer values from BGG player-count polls in this release.
10. **REQ-DERIVED-10:** The player-count-fit template shall clearly show its target player count and publisher-range provenance wherever the axis or its score breakdown is presented.

### Published Play Time

11. **REQ-DERIVED-11:** A `playingTime` axis shall require an integer `maximumScoringTime` from 60 through 1,440 minutes, defaulting to 240. This axis-specific setting defines the field's native scoring scale and shall be editable without code changes or data migration.
12. **REQ-DERIVED-12:** `playingTime` shall resolve from the existing published game `playingTime` value when it is positive. The resolver shall retain this published value as `sourceValue`; values greater than the axis's `maximumScoringTime` shall use that configured cap as `scoringRawValue`; absent or zero values shall resolve as missing.
13. **REQ-DERIVED-13:** `playingTime` shall expose a 1-to-`maximumScoringTime` minute native scale with minute-labelled curve and breakdown inputs. Its curve behavior shall support the existing lower-is-better and sweet-spot preferences without needing a duration-range data model.
14. **REQ-DERIVED-14:** This release shall not parse, persist, or derive from BGG `minplaytime` or `maxplaytime`. Those fields remain a future extension of the registry and game data model.
### Migration And Interfaces

15. **REQ-DERIVED-15:** Existing persisted `communityRating` and `weight` BGG axes shall migrate losslessly to the derived-axis representation. Existing weights, curves, vetoes, and personal overrides shall retain their scoring behavior.
16. **REQ-DERIVED-16:** A legacy BGG axis with an unsupported field identifier or malformed source/field combination shall be preserved as an explicitly disabled legacy axis, excluded from scoring, with its identifier, configuration, and ratings intact. Axis management shall present an actionable repair or deletion path; migration shall never silently discard it.
17. **REQ-DERIVED-17:** Collection loading shall version, validate, and persist the axis migration before any consumer uses axes. It shall invalidate `profile.json`, wishlist prediction fields in `wishlist.json`, and any future persisted prediction artifact derived from the old shape. The migration and invalidation shall be idempotent and recoverable after interruption; malformed cache data shall be discarded without preventing a valid collection from loading.
18. **REQ-DERIVED-18:** The axis-creation experience shall offer optional, duplicate-permitted templates for Community Rating, Complexity, Player Count Fit, and Play Time. Templates shall provide the current Community Rating and Complexity defaults, Player Count Fit name/description with weight 50 and a higher-is-better curve, and Play Time name/description with weight 50, a sweet-spot curve centered at 90 minutes with 30-minute tolerance, and `maximumScoringTime` of 240 minutes. Selecting Player Count Fit shall collect and permit editing a target count; selecting Play Time shall expose minute-aware preference controls and permit editing its scoring cap. All template properties remain editable and templates remain deletable.
19. **REQ-DERIVED-19:** The daemon shall expose a discovery endpoint whose versioned response is derived from the shared registry and includes stable field IDs, display metadata, native scale/unit, provenance, configuration schema, and template defaults. Web and CLI template pickers shall consume this contract rather than duplicate field literals. Create/update payloads shall use stable machine-readable validation codes for invalid field IDs or configuration.
20. **REQ-DERIVED-20:** Score breakdowns and axis-management views shall identify derived values, show their field-specific unit or provenance, and distinguish `sourceValue`, `scoringRawValue`, effective preference rating, and personal override. A capped duration shall display both its published duration and its capped scoring input. Missing or malformed source metadata with an override shall display the override without inventing a factual value.

### Prediction And Similarity

21. **REQ-DERIVED-21:** Adding a player-count or play-time derived axis shall not alter feature-vector dimensional invariants, produce non-finite values, or silently create per-game variable-length vectors.
22. **REQ-DERIVED-22:** Similarity feature vectors used by prediction, profiling, redundancy, outlier detection, and shelf-assignment/capacity packing shall retain one continuous factual dimension each for `minPlayers`, `maxPlayers`, and uncapped published `playingTime`. Derived-axis values shall never occupy axis-vector slots; only personal and tournament axes may do so. Fitness scoring remains independent and includes enabled derived axes.

## Out Of Scope

- BGG suggested-player-count poll scoring, including `N+` interpretation and vote aggregation.
- BGG minimum/maximum duration import, duration ranges, and user-entered typical play time.
- Per-game factual corrections to publisher metadata.
- Automatically adding the new axes to all new or existing collections.
- New derived-field templates beyond the four initial registry entries.

## AI Validation

1. Run `bun run typecheck`, `bun run lint`, `bun run format:check`, and `bun run test` successfully.
2. Verify shared validation rejects an unknown derived field, rejects missing or invalid player-count and play-time-cap configuration, accepts target counts 1 and 100 but rejects adjacent values, accepts play-time caps 60 and 1,440 but rejects adjacent values, and accepts all four registered fields with their valid configuration.
3. Verify resolver and fitness tests cover community rating and weight before and after persisted-axis migration, proving their effective scores, curves, vetoes, weights, and overrides are unchanged.
4. Verify player-count-fit scoring for an exact singleton, inclusive bounds, centered and off-center in-range targets, out-of-range targets, clamping, malformed ranges, and missing bounds. Confirm invalid or missing ranges are excluded as missing.
5. Verify play-time resolution for a normal positive value, zero, missing data, the configured cap, and a value above the configured cap. Confirm above-cap values preserve their factual source duration, score at the configured cap, display both values, and leave uncapped duration as the feature-vector input. Confirm changing a Play Time axis's cap from the default 240 changes its scoring scale without migration and missing values do not affect the weighted denominator.
6. Exercise discovery, web, API, and CLI creation/editing for both new templates. Confirm the player-count target is requested and displayed, play-time controls use minutes and allow cap editing, unsupported configuration receives a machine-readable actionable error, and neither template appears automatically in a fresh collection.
7. Load fixtures containing known legacy BGG axes and unknown/malformed legacy BGG axes, ratings, profile cache, and wishlist prediction data. Confirm known axes migrate with unchanged scores; unknown/malformed axes remain disabled and repairable; collection migration is persisted and idempotent; and invalid caches are safely invalidated.
8. Verify feature-vector names, ordering, and dimensions with and without the two new axes. Test prediction, profile, outlier, redundancy, and shelf-assignment/capacity consumers for finite serialized values, one canonical factual player/time representation, and no derived-axis slots.

## Follow-Up Questions

- Future player-count poll support needs a separate decision on Best/Recommended/Not Recommended aggregation and the meaning of poll entries such as `4+`.
- Future duration-range support needs a decision on whether its effective raw value is minimum, maximum, midpoint, or a range-aware preference function.
