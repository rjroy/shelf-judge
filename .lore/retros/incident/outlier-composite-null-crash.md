---
title: NaN-to-null serialization crashed outlier display
date: 2026-04-11
status: complete
tags: [bug, feature-vector]
modules: [daemon, profile-engine, feature-vector, web-profile]
related: [.lore/specs/collection/collection-profiling.md]
---

# Retro: Outlier composite distance null crash

## Summary

The profile page blew up with `Cannot read properties of null (reading 'toFixed')` in `components/profile/outliers.tsx:50`. Investigation revealed 172 of 176 stored outliers had `composite: null` despite the type declaring it `number`. The crash traced back to a recent refactor (commit `07b8d45`) that replaced a dummy axis-ratings map with `resolveAxisValues()`, which only returns axes a game actually has values for. Games with disjoint axis sets produced different-length `personalAxes` vectors. `normalizedManhattanDistance` then iterated off the end of the shorter vector, getting `a[i] - undefined = NaN`, which `JSON.stringify` serializes as `null`.

Only 4 outliers had valid composites, by coincidence of matching dimensions against the centroid.

Fixed by (1) making `encodeGame` iterate over the full `axes` list when provided so every game produces a fixed-dimension vector with 0.5 midpoint for missing axes, and (2) adding dimension-mismatch throws to `normalizedManhattanDistance` and `jaccardDistance` so this silent failure surfaces loudly next time.

## What Went Well

- The stored profile JSON was readable with `jq`. Grouping by null-composite (172 null, 4 valid) immediately pointed at a data-shape bug, not a display bug.
- The 4 valid outliers were the key clue. They all had non-null `personalAxes`, while the 172 broken ones all had null `personalAxes`. That correlation localized the bug to the else-branch logic in `compositeDistance`, and from there to dimension mismatch.
- `git log -- <file>` on `feature-vector.ts` and `profile-engine.ts` found the recent commission that introduced the regression in one step.
- The fix preserved existing test behavior by keeping a fallback path for call sites without an `axes` parameter.

## What Could Improve

- The `CollectionProfile` Zod schema (if any) didn't reject stored profiles with `null` composites despite the type being `number`. The daemon happily wrote and re-served a corrupted profile. This is the exact "mock/prod divergence" smell from global lessons: types say one thing, runtime tolerates another.
- The refactor from `axisIds = { [id]: 1 }` dummy map to `resolveAxisValues(game, axes)` changed the per-game vector shape without anyone noticing, because the tests only exercised matching-dimension cases. A property test ("given N games with random axis subsets, all feature vectors must have the same personalAxes length") would have caught this instantly.
- Cached daemon state made the bug persistent. Even with the fix deployed, the bad profile will keep being served until `collection.updatedAt` advances. Cache invalidation on daemon version bump (or schema bump) would self-heal these.
- `normalizedManhattanDistance`/`jaccardDistance` had no dimension guard. The lessons-learned file already warned about silent catches at integration points; distance functions that keep computing with undefined operands are the same category of bug.
- The stored profile contained clearly invalid data (`composite: null` where the type says `number`) for hours of usage before someone hit the crashing page. There's no validation on load.

## Lessons Learned

- `NaN` round-trips through `JSON.stringify` as `null`, not as a parse error. Any numeric field that can see `NaN` at any point in its pipeline can silently become `null` in storage. Distance/aggregation code is the high-risk spot.
- Distance and aggregation functions should throw on dimension mismatch, not quietly iterate off the end of the shorter array. `for (let i = 0; i < a.length; i++) b[i]` is a silent failure waiting to happen the moment vector shapes aren't enforced by a wrapping type.
- When a refactor replaces "build a complete keyset" with "return only populated entries", check every downstream consumer that assumed fixed shape. Dimensional invariants that used to hold by construction need to be reasserted.
- Daemon caches that survive schema-shape bugs extend the blast radius. Version the cache or validate on load so corrupted stored state doesn't keep leaking into clients after the code is fixed.
- When stored data contradicts the declared type, trust the data over the type and find the serialization hole. The 4-valid-vs-172-null split was decisive evidence about which code path was broken.

## Artifacts

- Bug surface: `packages/web/components/profile/outliers.tsx:50`
- Root cause: `packages/daemon/src/services/feature-vector.ts` (`encodeGame`, `normalizedManhattanDistance`, `jaccardDistance`)
- Regression commit: `07b8d45` (Commission: commission-Dalton-20260411-154717)
- Regression tests: `packages/daemon/tests/feature-vector.test.ts`
- Stored bad profile: `~/.shelf-judge/data/profile.json` (needs manual invalidation after fix)
- Related spec: `.lore/specs/collection/collection-profiling.md`
