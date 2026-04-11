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
- The fitness service already normalizes BGG values to 1-10 scale via `computeHigherIsBetterEffective()` from `curve-engine.ts` (daemon-only). Profile distributions expect 1-10 scale values, so the resolved BGG value must be normalized before inclusion.
- `getNativeScale()` lives in `curve-engine.ts` (daemon). Both `getNativeScale` and `computeHigherIsBetterEffective` are pure functions with no daemon dependencies, so they can move to shared if needed.

**Normalization note:** Personal ratings are already on the 1-10 scale and must not be re-normalized. Only the BGG fallback path requires scale conversion (weight 1-5 to 1-10). The fitness service is explicit about this distinction at lines 69-82.

## Implementation Steps

### Step 1: Extract BGG value resolution into a shared utility

**Files**: `packages/shared/src/axis-utils.ts` (new), `packages/daemon/src/services/fitness-service.ts`, `packages/shared/src/index.ts`

Create `packages/shared/src/axis-utils.ts` with two exported functions. Placing these in shared (not daemon) is required because the web package needs `resolveAxisValues` for collection sorting (Step 4).

1. `resolveBggRawValue(axis: Axis, bggData: BggGameData | null): number | null` - moved from fitness-service.ts. Returns the native-scale BGG value (1-5 for weight, 1-10 for communityRating).

2. `resolveAxisValues(game: Game, axes: Axis[]): Record<string, number>` - for each axis, checks `game.ratings[axis.id]` first. Personal ratings are already on the 1-10 scale and must not be re-normalized. If no personal rating exists, falls back to the BGG value normalized to 1-10. Returns a map of axisId to resolved value (1-10 scale). Axes with no value (no personal rating AND no BGG data) are omitted.

The BGG-to-1-10 normalization for the fallback path uses `getNativeScale()` and `computeHigherIsBetterEffective()`. Both are currently in `curve-engine.ts` (daemon-only) but are pure functions. Move them to `packages/shared/src/curve-math.ts` as part of this step, or inline the equivalent linear interpolation in `resolveAxisValues`. The math is: `(rawValue - nativeMin) / (nativeMax - nativeMin) * 9 + 1`. For communityRating (already 1-10), this is identity. For weight (1-5), this maps to 1-10.

Update `fitness-service.ts` to import `resolveBggRawValue` from `@shelf-judge/shared` instead of defining it locally. Export the new functions from `packages/shared/src/index.ts`.

**Expertise**: None needed.

### Step 2: Update `computeAxisDistributions` to use resolved values

**Files**: `packages/daemon/src/services/profile-engine.ts`

Change `computeAxisDistributions(games, axes)` to resolve BGG axis values. For each game, call `resolveAxisValues(game, axes)` and read from the resolved map instead of `game.ratings[axis.id]`.

This means the distributions for a BGG-sourced "Community Rating" axis will include the actual community rating for every game that has BGG data, rather than showing an empty distribution.

**Expertise**: None needed.

### Step 3: Update `encodeGame` to accept resolved axis values

**Files**: `packages/daemon/src/services/feature-vector.ts`, callers in `profile-engine.ts` and `prediction-service.ts`

The `encodeGame` function takes an optional `axisRatings?: Record<string, number>` parameter. Currently this parameter is used as a **key list**, not a value map: callers pass a record with dummy values (e.g., `{ axisId: 1 }`) and `encodeGame` reads the axis IDs from its keys but ignores the values, looking up `game.ratings[id]` internally instead.

Change the semantics: `axisRatings` becomes the actual resolved values map. Callers pass `resolveAxisValues(game, axes)` which contains both personal and BGG-resolved values on the 1-10 scale.

**Call sites to update:**

1. `profile-engine.ts:288-294` (`detectOutliers`): Replace the dummy `axisIds` record with `resolveAxisValues(game, axes)`.
2. `prediction-service.ts:89` (and any other `encodeGame` calls): Currently passes `game.ratings` directly. Replace with `resolveAxisValues(game, axes)` so BGG-sourced axes get resolved values instead of being absent.

**`encodeGame` change** (line 155-159): Instead of reading `game.ratings[id]`, read from the passed `axisRatings` directly:

```typescript
personalAxes = axisIds.map((id) => {
  const rating = axisRatings[id]; // was: game.ratings[id]
  return rating != null ? normalize(rating, 1, 10) : 0.5;
});
```

**Expertise**: None needed.

### Step 4: Update collection sorting to resolve BGG axis values

**Files**: `packages/web/lib/collection-utils.ts`, `packages/web/components/collection-table.tsx`, `packages/web/app/collection/page.tsx`

Since Step 1 places `resolveAxisValues` in `@shelf-judge/shared`, the web package can import it directly. No duplication needed.

Update `getSortValue` to: when `field.startsWith("axis:")`, look up the axis from the axes list, call `resolveAxisValues` for that single game + axes, and return the resolved value.

Thread the `axes` list through to `getSortValue` and `sortGames`. The collection table already has access to axes. Add `axes: Axis[]` to the function signatures for `getSortValue`, `sortGames`, and `getScoreDisplay`.

**Expertise**: None needed.

### Step 5: Delete stale profile cache

**Files**: None (runtime operation)

The fix changes how the profile is computed, but the daemon caches the profile in `~/.shelf-judge/profile.json`. A stale cache will continue serving the old (broken) profile until the collection is updated. Document in the PR that users should either:

- Rate a game (triggers collection update, invalidates cache), or
- Delete `~/.shelf-judge/profile.json` manually

Consider adding a `POST /api/profile/recompute` endpoint or a query param `?force=true` that bypasses the cache. This is optional for this bug fix but would prevent similar stale-cache issues in the future.

**Expertise**: None needed.

### Step 6: Add tests

**Files**: `packages/shared/tests/axis-utils.test.ts` (new), updates to `packages/daemon/tests/profile-engine.test.ts`, `packages/web/tests/collection-utils.test.ts` (new or update existing)

Tests for the shared utility (`axis-utils.ts`):

- `resolveBggRawValue` returns communityRating for a bgg-sourced axis with bggField "communityRating"
- `resolveBggRawValue` returns weight for bggField "weight"
- `resolveBggRawValue` returns null for personal axes
- `resolveBggRawValue` returns null when bggData is null
- `resolveAxisValues` returns personal ratings unchanged (no re-normalization) for personal axes
- `resolveAxisValues` returns BGG values (normalized to 1-10) for BGG axes
- `resolveAxisValues` prefers personal override when both personal rating and BGG data exist
- `resolveAxisValues` omits axes with no value (no rating, no bggData)
- `resolveAxisValues` normalizes weight (1-5) to 1-10 scale, leaves communityRating (already 1-10) unchanged

Tests for profile engine changes:

- `computeAxisDistributions` includes BGG-sourced axis values from bggData
- `computeAxisDistributions` prefers personal override for BGG axes when both exist

Tests for feature vector / prediction changes:

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
- Stale profile cache is handled

## Delegation Guide

No specialized expertise needed. All steps are straightforward data-plumbing changes within existing patterns. Steps 1-3 are daemon-only; step 4 touches web. A single implementer can handle all steps sequentially.

Review focus: The fitness service's resolution logic is the source of truth. After the fix, verify that the shared utility produces identical values to what the fitness service currently computes. A reviewer should diff the fitness breakdown output before/after to confirm no regression.

## Open Questions

1. **Profile cache invalidation:** Step 5 suggests an optional `recompute` endpoint. This isn't strictly needed for the bug fix (updating any game triggers recomputation), but it prevents the "why is my profile still wrong" confusion. Worth adding or defer?

2. **BGG weight normalization:** BGG weight is 1-5 scale. When included in axis distributions, should it be reported as the native 1-5 value or normalized to 1-10 to match personal axes? The fitness service normalizes to 1-10 for scoring, and the profile distributions assume 1-10 scale. The plan normalizes to 1-10 for consistency.

3. **Outlier detection sensitivity:** Improving the feature vector encoding (BGG axes get real values instead of midpoint 0.5) will change outlier classifications. Games that were previously flagged may no longer be flagged, and vice versa. This is correct behavior (better data produces better outlier detection), but it's a visible change worth noting in the PR.
