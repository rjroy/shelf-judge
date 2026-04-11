---
title: "Implementation plan: fix-community-stats"
date: 2026-04-11
status: draft
tags: [plan, bug, profiling, derived-data, bgg]
modules: [daemon, web, shared]
related:
  - .lore/issues/the-community-stats-are-empty.md
  - .lore/retros/tournament-stats-record-shape-mismatch.md
  - .lore/retros/commission-cleanup-2026-04-11.md
  - .lore/specs/collection-profiling.md
---

# Plan: Fix Empty Community Stats

## Goal

BGG-sourced axis values (community rating, weight) show as empty/null in the profile's axis distributions, in outlier feature vectors, and when sorting the collection by BGG-sourced axes. Individual game detail views and fitness scores are accurate because the fitness service resolves BGG values on-the-fly. The profile engine, feature vector encoder, and collection sorting all read `game.ratings[axisId]`, which only contains manually-entered personal ratings. BGG-sourced axes are invisible to these consumers.

Fix the data plumbing so every consumer that needs resolved axis values can access them, without duplicating the resolution logic that already exists in the fitness service.

## Codebase Context

**The resolution logic exists but isn't shared.** `resolveBggRawValue()` in `fitness-service.ts:24-35` maps `axis.bggField` to `bggData.communityRating` or `bggData.weight`. It's a private function inside `createFitnessService`, not exported or available to other modules.

**Three consumers read `game.ratings` and miss BGG axes:**

1. `profile-engine.ts:83-85` (`computeAxisDistributions`) - iterates `game.ratings[axis.id]` per axis. BGG-sourced axes have no entry, so their distributions are empty.
2. `feature-vector.ts:155-156` (`encodeGame`) - reads `game.ratings[id]` for the personalAxes component. BGG-sourced axes default to midpoint 0.5, degrading outlier detection accuracy.
3. `collection-utils.ts:216-218` (`getSortValue`) - for `axis:${id}` sort fields, reads `game.ratings[axisId]`. BGG-sourced axes return null, so games drop into the "no data" bucket.

**What the fitness service does right:** When computing a score, it checks `game.ratings[axis.id]` first (personal override), then falls back to `resolveBggRawValue(axis, bggData)`. This two-step resolution produces the correct effective value. The profile engine and other consumers need the same two-step logic.

**The fix pattern:** Extract `resolveBggRawValue` into a shared utility, then build a helper that produces a "resolved ratings" map (personal overrides + BGG fallbacks) for a game given a set of axes. Each broken consumer calls the helper instead of reading `game.ratings` directly.

**Existing conventions:**

- Pure computation functions (no I/O) go in `*-engine.ts` files in the daemon services directory.
- The fitness service normalizes BGG values to 1-10 scale via `computeHigherIsBetterEffective()` from `curve-engine.ts` (daemon-only) for fitness scoring. This normalization is specific to scoring and must not leak into display contexts.
- `getNativeScale()` lives in `curve-engine.ts` (daemon). Both `getNativeScale` and `computeHigherIsBetterEffective` are pure functions with no daemon dependencies.

**Scale convention:** Users think in native scales. A BGG weight of 3.25 means something; a normalized value of 6.06 does not. `resolveAxisValues` returns native-scale values. Normalization to 1-10 stays in consumers that need a common scale for computation (fitness scoring, feature vector encoding). Profile distributions and collection sorting display native-scale values.

## Implementation Steps

### Step 1: Extract BGG value resolution into a shared utility

**Files**: `packages/shared/src/axis-utils.ts` (new), `packages/daemon/src/services/fitness-service.ts`, `packages/shared/src/index.ts`

Create `packages/shared/src/axis-utils.ts` with two exported functions. Placing these in shared (not daemon) is required because the web package needs `resolveAxisValues` for collection sorting (Step 4).

1. `resolveBggRawValue(axis: Axis, bggData: BggGameData | null): number | null` - moved from fitness-service.ts. Returns the native-scale BGG value (1-5 for weight, 1-10 for communityRating).

2. `resolveAxisValues(game: Game, axes: Axis[]): Record<string, number>` - for each axis, checks `game.ratings[axis.id]` first (personal rating, already on 1-10 scale). If no personal rating exists, falls back to the native-scale BGG value from `resolveBggRawValue`. Returns a map of axisId to resolved value in the axis's native scale. Axes with no value (no personal rating AND no BGG data) are omitted.

No normalization happens in this function. Consumers that need values on a common scale (fitness scoring, feature vectors) normalize downstream.

Update `fitness-service.ts` to import `resolveBggRawValue` from `@shelf-judge/shared` instead of defining it locally. Export the new functions from `packages/shared/src/index.ts`.

**Expertise**: None needed.

### Step 2: Update `computeAxisDistributions` to use resolved values

**Files**: `packages/daemon/src/services/profile-engine.ts`

Change `computeAxisDistributions(games, axes)` to resolve BGG axis values. For each game, call `resolveAxisValues(game, axes)` and read from the resolved map instead of `game.ratings[axis.id]`.

Values are native-scale: community rating distributions show 1-10, weight distributions show 1-5. This matches what users see on BGG and what they'd expect in their profile.

**Expertise**: None needed.

### Step 3: Update `encodeGame` to accept resolved axis values

**Files**: `packages/daemon/src/services/feature-vector.ts`, callers in `profile-engine.ts` and `prediction-service.ts`

The `encodeGame` function takes an optional `axisRatings?: Record<string, number>` parameter. Currently this parameter is used as a **key list**, not a value map: callers pass a record with dummy values (e.g., `{ axisId: 1 }`) and `encodeGame` reads the axis IDs from its keys but ignores the values, looking up `game.ratings[id]` internally instead.

Change the semantics: `axisRatings` becomes the actual resolved values map. Callers pass `resolveAxisValues(game, axes)` which contains both personal and BGG-resolved values in their native scales.

**Call sites to update:**

1. `profile-engine.ts:288-294` (`detectOutliers`): Replace the dummy `axisIds` record with `resolveAxisValues(game, axes)`.
2. `prediction-service.ts:89` (and any other `encodeGame` calls): Currently passes `game.ratings` directly. Replace with `resolveAxisValues(game, axes)` so BGG-sourced axes get resolved values instead of being absent.

**`encodeGame` change** (line 155-159): Instead of reading `game.ratings[id]`, read from the passed `axisRatings` directly. Since `resolveAxisValues` returns native-scale values, `encodeGame` must normalize to a common scale for the feature vector. Look up each axis to determine its native scale and normalize accordingly:

```typescript
personalAxes = axisIds.map((id) => {
  const rating = axisRatings[id]; // was: game.ratings[id]
  if (rating == null) return 0.5;
  const axis = axes.find((a) => a.id === id);
  const [min, max] = axis ? getNativeScale(axis) : [1, 10];
  return normalize(rating, min, max);
});
```

This means `encodeGame` needs the `axes` list passed in alongside `axisRatings`, or it needs the native scale embedded in the ratings map. The simpler approach: pass `axes` as an additional parameter.

**Expertise**: None needed.

### Step 4: Update collection sorting to resolve BGG axis values

**Files**: `packages/web/lib/collection-utils.ts`, `packages/web/components/collection-table.tsx`, `packages/web/app/collection/page.tsx`

Since Step 1 places `resolveAxisValues` in `@shelf-judge/shared`, the web package can import it directly. No duplication needed.

Update `getSortValue` to: when `field.startsWith("axis:")`, look up the axis from the axes list, call `resolveAxisValues` for that single game + axes, and return the resolved value.

Thread the `axes` list through to `getSortValue` and `sortGames`. The collection table already has access to axes. Add `axes: Axis[]` to the function signatures for `getSortValue`, `sortGames`, and `getScoreDisplay`.

**Expertise**: None needed.

### Step 5: Delete stale profile cache

**Files**: None (runtime operation)

The fix changes how the profile is computed, but the daemon caches the profile in `~/.shelf-judge/profile.json`. After deploying, delete the file. The profile auto-regenerates on next request.

**Expertise**: None needed.

### Step 6: Add tests

**Files**: `packages/shared/tests/axis-utils.test.ts` (new), updates to `packages/daemon/tests/profile-engine.test.ts`, `packages/web/tests/collection-utils.test.ts` (new or update existing)

Tests for the shared utility (`axis-utils.ts`):

- `resolveBggRawValue` returns communityRating for a bgg-sourced axis with bggField "communityRating"
- `resolveBggRawValue` returns weight for bggField "weight"
- `resolveBggRawValue` returns null for personal axes
- `resolveBggRawValue` returns null when bggData is null
- `resolveAxisValues` returns personal ratings unchanged for personal axes
- `resolveAxisValues` returns native-scale BGG values (weight as 1-5, communityRating as 1-10) for BGG axes
- `resolveAxisValues` prefers personal override when both personal rating and BGG data exist
- `resolveAxisValues` omits axes with no value (no rating, no bggData)

Tests for profile engine changes:

- `computeAxisDistributions` includes BGG-sourced axis values in native scale from bggData
- `computeAxisDistributions` prefers personal override for BGG axes when both exist

Tests for feature vector / prediction changes:

- `encodeGame` normalizes native-scale values to common scale using axis-specific ranges
- `encodeGame` uses passed `axisRatings` values for personalAxes component (not `game.ratings`)
- Prediction service produces correct similarity vectors for games with BGG-sourced axes

Tests for collection-utils changes:

- `getSortValue` returns resolved BGG value for BGG-sourced axis sort fields
- `sortGames` correctly sorts by BGG-sourced axes

### Step 7: Validate against goal

Launch a sub-agent that reads the Goal section above, reviews the implementation, and flags anything that doesn't match. Verify:

- Profile axis distributions include BGG-sourced axis values
- Collection sorting by BGG-sourced axes works
- Feature vector encoding uses resolved values instead of midpoint defaults (both outlier and prediction paths)
- Fitness scores are unchanged (no regression)
- Outlier classifications are reasonable (the improved feature vectors may change which games are flagged)
- Profile distributions display native-scale values (weight as 1-5, not normalized to 1-10)

## Delegation Guide

No specialized expertise needed. All steps are straightforward data-plumbing changes within existing patterns. Steps 1-3 are daemon-only; step 4 touches web. A single implementer can handle all steps sequentially.

Review focus: The fitness service's resolution logic is the source of truth. After the fix, verify that the shared utility produces identical values to what the fitness service currently computes. A reviewer should diff the fitness breakdown output before/after to confirm no regression.
