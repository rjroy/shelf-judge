---
title: "Commission: Review: Collection Profiling Phase 1-3"
date: 2026-04-10
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review Phases 1-3 of the collection profiling implementation.\n\n**Spec**: `.lore/specs/collection-profiling.md`\n**Plan**: `.lore/plans/collection-profiling.md`\n**Outlier distance research**: `.lore/research/outlier-distance-metric.md`\n\nFocus areas:\n1. **Feature vector module correctness**: Jaccard distance, normalized Manhattan, composite weighting, centroid computation. These are the mathematical foundation shared with the prediction engine.\n2. **Profile engine math**: Verify hand-calculable cases for axis distributions (mean/median/stddev/range), divergence threshold (1.5 points), outlier detection (2σ).\n3. **Outlier classification logic**: lone-wolf (nearest-neighbor distance > 0.5), category-orphan (category appears once), high-fitness outlier.\n4. **Type completeness**: Do the shared types cover all spec requirements?\n5. **Subdomain extraction**: Parser correctly extracts `boardgamesubdomain` links.\n6. **Test coverage**: Are edge cases covered? Empty collections, single-game collections, games without BGG data, axes with no ratings.\n7. **Spec compliance**: Walk REQ-PROFILE-1 through REQ-PROFILE-17 against the implementation.\n\nFiles to review:\n- `packages/shared/src/types.ts` (new profile types)\n- `packages/shared/src/validation.ts` (subdomain schema)\n- `packages/daemon/src/services/feature-vector.ts`\n- `packages/daemon/src/services/profile-engine.ts`\n- `packages/daemon/src/services/bgg-xml-parser.ts` (subdomain extraction)\n- All new test files"
dependencies:
  - commission-Dalton-20260410-120242
linked_artifacts:
  - .lore/specs/collection-profiling.md

  - .lore/plans/collection-profiling.md
  - packages/shared/src/types.ts
  - packages/daemon/src/services/feature-vector.ts
  - packages/daemon/src/services/profile-engine.ts
  - packages/daemon/src/services/bgg-xml-parser.ts
  - packages/daemon/tests/feature-vector.test.ts
  - packages/daemon/tests/profile-engine.test.ts
  - .lore/plans/collection-profiling.md
  - packages/shared/src/types.ts
  - packages/daemon/src/services/feature-vector.ts
  - packages/daemon/src/services/profile-engine.ts
  - packages/daemon/src/services/bgg-xml-parser.ts
  - packages/daemon/tests/feature-vector.test.ts
  - packages/daemon/tests/profile-engine.test.ts
activity_timeline:
  - timestamp: 2026-04-10T19:02:57.100Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T19:10:00.061Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-10T19:15:29.419Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-10T19:15:29.422Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T19:15:29.443Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T19:16:19.395Z
    event: progress_report
    reason: "Read spec, plan, research, and all implementation files (types.ts, validation.ts, feature-vector.ts, profile-engine.ts, bgg-xml-parser.ts). Now reading test files."
  - timestamp: 2026-04-10T19:16:46.165Z
    event: progress_report
    reason: "Finished reading all test files. Beginning analysis of findings: feature-vector math, profile-engine logic, outlier classifications, type completeness, subdomain extraction, spec compliance, and test coverage."
  - timestamp: 2026-04-10T19:20:56.197Z
    event: progress_report
    reason: "Seven findings recorded. Now completing spec compliance walkthrough for REQ-PROFILE-1 through 17 and finalizing the review."
  - timestamp: 2026-04-10T19:22:33.817Z
    event: result_submitted
    reason: "## Review: Collection Profiling Phases 1-3\n\nReviewed against spec (`.lore/specs/collection-profiling.md`), plan (`.lore/plans/collection-profiling.md`), and research (`.lore/research/outlier-distance-metric.md`).\n\nFiles reviewed: `packages/shared/src/types.ts`, `packages/shared/src/validation.ts`, `packages/shared/src/index.ts`, `packages/daemon/src/services/feature-vector.ts`, `packages/daemon/src/services/profile-engine.ts`, `packages/daemon/src/services/bgg-xml-parser.ts`, `packages/daemon/tests/feature-vector.test.ts`, `packages/daemon/tests/profile-engine.test.ts`, `packages/daemon/src/services/storage-service.ts`.\n\n---\n\n### Finding 1: Jaccard distance produces wrong results with centroid frequency vector\n\n**Severity**: Defect (high impact)\n**File**: `feature-vector.ts:128-141`, `feature-vector.ts:223`\n**Spec**: REQ-PROFILE-11, REQ-PROFILE-12\n\nThe `jaccardDistance` function uses strict `=== 1` checks to determine set membership. This is correct for binary-vs-binary comparison (game vs game), but the centroid's binary portion is a frequency vector with fractional values (e.g., 0.8 means 80% of games have that mechanic). When comparing a game vector against the centroid:\n\n- A mechanic present in 80% of the collection (centroid value 0.8) is treated as NOT present, because `0.8 !== 1`.\n- Only mechanics universal to every game (frequency exactly 1.0) count as \"present\" in the centroid.\n- The Jaccard distance between a game and the centroid is systematically inflated, because nearly nothing in the centroid registers as \"present.\"\n\nThis breaks the outlier detection's binary component. All games will have artificially high binary distances from the centroid, and the relative ordering of distances will be distorted.\n\n**Fix**: Either (a) threshold the centroid's binary values before Jaccard comparison (e.g., treat > 0.5 as present), (b) use a modified distance function that handles frequency vectors (e.g., generalized Jaccard: `min(a,b) / max(a,b)` summed over dimensions), or (c) compute game-vs-centroid binary distance as a set-theoretic measure against the centroid's attribute frequency set directly, bypassing the vector representation.\n\n---\n\n### Finding 2: High-fitness outlier classification has no fitness threshold\n\n**Severity**: Defect (medium impact)\n**File**: `profile-engine.ts:336-339`\n**Spec**: REQ-PROFILE-13\n\nAny outlier game with a non-zero, non-vetoed fitness score is classified as \"high-fitness outlier.\" The spec defines these as \"games whose axes say 'keep it' but whose BGG attributes say 'this doesn't fit.'\" A game with fitness 1.5 (very poor) does not have axes that say \"keep it.\" The classification conflates \"has been scored\" with \"scores well.\"\n\n**Fix**: Add a minimum fitness threshold. Options: above the collection median fitness, above 5.0 (scale midpoint), or above some configurable value. The test at line 630 uses fitness 8.5, which would pass any reasonable threshold.\n\n---\n\n### Finding 3: Missing migration for existing games without `subdomains` field\n\n**Severity**: Defect (medium impact, runtime crash)\n**File**: `profile-engine.ts:170, 325`, `storage-service.ts:97`\n**Spec**: REQ-PROFILE-4\n\nGames fetched before the subdomain addition have `bggData` without a `subdomains` property. `loadCollection()` does `JSON.parse(raw) as Collection` with no validation or defaults. The profile engine iterates over `g.bggData.subdomains` in `computeBggClustering` (line 170 via `countAttributes`) and `detectOutliers` (line 325), which will throw `TypeError: undefined is not iterable` on pre-existing data.\n\nThe plan identified this risk and prescribed a Zod default in \"the existing BggGameDataSchema,\" but no such schema exists in `validation.ts`. The storage layer performs no validation on loaded collection data.\n\n**Fix**: Either (a) add `?? []` guards where subdomains are accessed (`g.bggData!.subdomains ?? []`), (b) normalize on load in `loadCollection`, or (c) add a migration step that backfills empty arrays.\n\n---\n\n### Finding 4: Continuous normalization uses fixed ranges instead of observed ranges\n\n**Severity**: Spec deviation (medium impact)\n**File**: `feature-vector.ts:99-101`\n**Spec**: REQ-PROFILE-11\n\nREQ-PROFILE-11 states: \"Each attribute is normalized to [0,1] by the observed range in the collection.\" The implementation uses hardcoded ranges: minPlayers 1-10, maxPlayers 1-10, playingTime 0-300. The plan's Phase 2 also says \"observed range\" for player count and play time.\n\nFor weight (1-5) and community rating (1-10), fixed BGG scales are defensible since values always fall within those ranges. For player count and play time, fixed ranges compress meaningful variation. A collection of party games (all 3-8 players) has a 5-point spread that gets compressed to 0.22 of the [0,1] range under a 1-10 scale, reducing sensitivity.\n\n**Fix**: Accept collection-level min/max per continuous dimension as a parameter to `encodeGame` (or compute them in a pre-pass over all games before encoding).\n\n---\n\n### Finding 5: Duplicate ComponentDistances type\n\n**Severity**: Nit (code quality)\n**File**: `feature-vector.ts:24-29`, `types.ts:297-302`\n\n`ComponentDistances` is defined identically in both files. The feature vector module already imports `Game` from `@shelf-judge/shared`. It should import `ComponentDistances` from there too, eliminating the duplicate. Structural typing makes this work today, but if one definition changes without the other, the mismatch would surface only when the assignment occurs in `profile-engine.ts:344`.\n\n---\n\n### Finding 6: Outlier classification tests use conditional assertions\n\n**Severity**: Test gap (medium impact)\n**File**: `profile-engine.test.ts:569, 600, 633`\n\nThe category-orphan, lone-wolf, and high-fitness-outlier classification tests wrap assertions in `if (warOutlier)` / `if (oddOutlier)`. If the 2σ threshold doesn't flag the constructed game as an outlier, the assertion block is skipped and the test passes trivially. These tests validate \"IF flagged THEN correct classification\" rather than the stronger \"IS flagged AND has correct classification.\"\n\n**Fix**: Add `expect(warOutlier).toBeDefined()` before the `if` block (like the test at line 508 does), or restructure the test data to guarantee the outlier exceeds the threshold.\n\n---\n\n### Finding 7: No subdomain extraction test in BGG parser test suite\n\n**Severity**: Test gap (low impact)\n**File**: `bgg-xml-parser.test.ts`\n\nGrep for \"subdomain\" returned zero matches. The extraction code reuses `extractLinks` with `\"boardgamesubdomain\"`, which is the same pattern as mechanics and categories. Risk is low, but the link type string `\"boardgamesubdomain\"` is unverified against actual BGG XML. A fixture with `<link type=\"boardgamesubdomain\">` entries would close this gap.\n\n---\n\n### Spec Compliance Summary (REQ-PROFILE-1 through 17)\n\n| Requirement | Status | Notes |\n|---|---|---|\n| REQ-PROFILE-1 | Compliant | Read-only computation, all four categories |\n| REQ-PROFILE-2 | Compliant | Population stddev, hand-calculated test |\n| REQ-PROFILE-3 | Compliant | Percentage of total, sorted descending |\n| REQ-PROFILE-4 | Compliant* | *Crash on existing data (Finding 3) |\n| REQ-PROFILE-5 | Compliant | Native scale via getNativeScale |\n| REQ-PROFILE-6 | Compliant | Pure functions, no I/O |\n| REQ-PROFILE-7 | Compliant | Strict >1.5, null scores excluded |\n| REQ-PROFILE-8 | Compliant | Both directions correctly classified |\n| REQ-PROFILE-9 | Compliant | Both scores, gap, direction reported |\n| REQ-PROFILE-10 | Compliant | Null when no tournament data |\n| REQ-PROFILE-11 | Non-compliant | Findings 1 and 4 |\n| REQ-PROFILE-12 | Non-compliant | Correct structure, wrong binary distances |\n| REQ-PROFILE-13 | Partially compliant | High-fitness classification too broad (Finding 2) |\n| REQ-PROFILE-14 | Compliant | No judgment, only observation |\n| REQ-PROFILE-15 | Compliant | All three sources implemented |\n| REQ-PROFILE-16 | N/A | Phase 5 (UI behavior) |\n| REQ-PROFILE-17 | Compliant | No LLM dependency |\n\n### What's Good\n\nThe code structure is clean and consistent. Pure-function modules with no I/O dependencies make testing straightforward. The separation between feature-vector.ts (reusable math) and profile-engine.ts (profile-specific logic) matches the plan's intent and positions well for the prediction engine. Test coverage for axis distributions, divergence detection, and axis suggestions is thorough, with hand-calculated cases that validate correctness. The weight redistribution logic when personal axes are unavailable is mathematically correct and well-tested. The subdomain extraction in the BGG parser follows established patterns. Types are complete and well-structured for all profile concepts."
  - timestamp: 2026-04-10T19:22:44.901Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Seven findings recorded. Now completing spec compliance walkthrough for REQ-PROFILE-1 through 17 and finalizing the review."
projectName: shelf-judge
---
## Review: Collection Profiling Phases 1-3

Reviewed against spec (`.lore/specs/collection-profiling.md`), plan (`.lore/plans/collection-profiling.md`), and research (`.lore/research/outlier-distance-metric.md`).

Files reviewed: `packages/shared/src/types.ts`, `packages/shared/src/validation.ts`, `packages/shared/src/index.ts`, `packages/daemon/src/services/feature-vector.ts`, `packages/daemon/src/services/profile-engine.ts`, `packages/daemon/src/services/bgg-xml-parser.ts`, `packages/daemon/tests/feature-vector.test.ts`, `packages/daemon/tests/profile-engine.test.ts`, `packages/daemon/src/services/storage-service.ts`.

---

### Finding 1: Jaccard distance produces wrong results with centroid frequency vector

**Severity**: Defect (high impact)
**File**: `feature-vector.ts:128-141`, `feature-vector.ts:223`
**Spec**: REQ-PROFILE-11, REQ-PROFILE-12

The `jaccardDistance` function uses strict `=== 1` checks to determine set membership. This is correct for binary-vs-binary comparison (game vs game), but the centroid's binary portion is a frequency vector with fractional values (e.g., 0.8 means 80% of games have that mechanic). When comparing a game vector against the centroid:

- A mechanic present in 80% of the collection (centroid value 0.8) is treated as NOT present, because `0.8 !== 1`.
- Only mechanics universal to every game (frequency exactly 1.0) count as "present" in the centroid.
- The Jaccard distance between a game and the centroid is systematically inflated, because nearly nothing in the centroid registers as "present."

This breaks the outlier detection's binary component. All games will have artificially high binary distances from the centroid, and the relative ordering of distances will be distorted.

**Fix**: Either (a) threshold the centroid's binary values before Jaccard comparison (e.g., treat > 0.5 as present), (b) use a modified distance function that handles frequency vectors (e.g., generalized Jaccard: `min(a,b) / max(a,b)` summed over dimensions), or (c) compute game-vs-centroid binary distance as a set-theoretic measure against the centroid's attribute frequency set directly, bypassing the vector representation.

---

### Finding 2: High-fitness outlier classification has no fitness threshold

**Severity**: Defect (medium impact)
**File**: `profile-engine.ts:336-339`
**Spec**: REQ-PROFILE-13

Any outlier game with a non-zero, non-vetoed fitness score is classified as "high-fitness outlier." The spec defines these as "games whose axes say 'keep it' but whose BGG attributes say 'this doesn't fit.'" A game with fitness 1.5 (very poor) does not have axes that say "keep it." The classification conflates "has been scored" with "scores well."

**Fix**: Add a minimum fitness threshold. Options: above the collection median fitness, above 5.0 (scale midpoint), or above some configurable value. The test at line 630 uses fitness 8.5, which would pass any reasonable threshold.

---

### Finding 3: Missing migration for existing games without `subdomains` field

**Severity**: Defect (medium impact, runtime crash)
**File**: `profile-engine.ts:170, 325`, `storage-service.ts:97`
**Spec**: REQ-PROFILE-4

Games fetched before the subdomain addition have `bggData` without a `subdomains` property. `loadCollection()` does `JSON.parse(raw) as Collection` with no validation or defaults. The profile engine iterates over `g.bggData.subdomains` in `computeBggClustering` (line 170 via `countAttributes`) and `detectOutliers` (line 325), which will throw `TypeError: undefined is not iterable` on pre-existing data.

The plan identified this risk and prescribed a Zod default in "the existing BggGameDataSchema," but no such schema exists in `validation.ts`. The storage layer performs no validation on loaded collection data.

**Fix**: Either (a) add `?? []` guards where subdomains are accessed (`g.bggData!.subdomains ?? []`), (b) normalize on load in `loadCollection`, or (c) add a migration step that backfills empty arrays.

---

### Finding 4: Continuous normalization uses fixed ranges instead of observed ranges

**Severity**: Spec deviation (medium impact)
**File**: `feature-vector.ts:99-101`
**Spec**: REQ-PROFILE-11

REQ-PROFILE-11 states: "Each attribute is normalized to [0,1] by the observed range in the collection." The implementation uses hardcoded ranges: minPlayers 1-10, maxPlayers 1-10, playingTime 0-300. The plan's Phase 2 also says "observed range" for player count and play time.

For weight (1-5) and community rating (1-10), fixed BGG scales are defensible since values always fall within those ranges. For player count and play time, fixed ranges compress meaningful variation. A collection of party games (all 3-8 players) has a 5-point spread that gets compressed to 0.22 of the [0,1] range under a 1-10 scale, reducing sensitivity.

**Fix**: Accept collection-level min/max per continuous dimension as a parameter to `encodeGame` (or compute them in a pre-pass over all games before encoding).

---

### Finding 5: Duplicate ComponentDistances type

**Severity**: Nit (code quality)
**File**: `feature-vector.ts:24-29`, `types.ts:297-302`

`ComponentDistances` is defined identically in both files. The feature vector module already imports `Game` from `@shelf-judge/shared`. It should import `ComponentDistances` from there too, eliminating the duplicate. Structural typing makes this work today, but if one definition changes without the other, the mismatch would surface only when the assignment occurs in `profile-engine.ts:344`.

---

### Finding 6: Outlier classification tests use conditional assertions

**Severity**: Test gap (medium impact)
**File**: `profile-engine.test.ts:569, 600, 633`

The category-orphan, lone-wolf, and high-fitness-outlier classification tests wrap assertions in `if (warOutlier)` / `if (oddOutlier)`. If the 2σ threshold doesn't flag the constructed game as an outlier, the assertion block is skipped and the test passes trivially. These tests validate "IF flagged THEN correct classification" rather than the stronger "IS flagged AND has correct classification."

**Fix**: Add `expect(warOutlier).toBeDefined()` before the `if` block (like the test at line 508 does), or restructure the test data to guarantee the outlier exceeds the threshold.

---

### Finding 7: No subdomain extraction test in BGG parser test suite

**Severity**: Test gap (low impact)
**File**: `bgg-xml-parser.test.ts`

Grep for "subdomain" returned zero matches. The extraction code reuses `extractLinks` with `"boardgamesubdomain"`, which is the same pattern as mechanics and categories. Risk is low, but the link type string `"boardgamesubdomain"` is unverified against actual BGG XML. A fixture with `<link type="boardgamesubdomain">` entries would close this gap.

---

### Spec Compliance Summary (REQ-PROFILE-1 through 17)

| Requirement | Status | Notes |
|---|---|---|
| REQ-PROFILE-1 | Compliant | Read-only computation, all four categories |
| REQ-PROFILE-2 | Compliant | Population stddev, hand-calculated test |
| REQ-PROFILE-3 | Compliant | Percentage of total, sorted descending |
| REQ-PROFILE-4 | Compliant* | *Crash on existing data (Finding 3) |
| REQ-PROFILE-5 | Compliant | Native scale via getNativeScale |
| REQ-PROFILE-6 | Compliant | Pure functions, no I/O |
| REQ-PROFILE-7 | Compliant | Strict >1.5, null scores excluded |
| REQ-PROFILE-8 | Compliant | Both directions correctly classified |
| REQ-PROFILE-9 | Compliant | Both scores, gap, direction reported |
| REQ-PROFILE-10 | Compliant | Null when no tournament data |
| REQ-PROFILE-11 | Non-compliant | Findings 1 and 4 |
| REQ-PROFILE-12 | Non-compliant | Correct structure, wrong binary distances |
| REQ-PROFILE-13 | Partially compliant | High-fitness classification too broad (Finding 2) |
| REQ-PROFILE-14 | Compliant | No judgment, only observation |
| REQ-PROFILE-15 | Compliant | All three sources implemented |
| REQ-PROFILE-16 | N/A | Phase 5 (UI behavior) |
| REQ-PROFILE-17 | Compliant | No LLM dependency |

### What's Good

The code structure is clean and consistent. Pure-function modules with no I/O dependencies make testing straightforward. The separation between feature-vector.ts (reusable math) and profile-engine.ts (profile-specific logic) matches the plan's intent and positions well for the prediction engine. Test coverage for axis distributions, divergence detection, and axis suggestions is thorough, with hand-calculated cases that validate correctness. The weight redistribution logic when personal axes are unavailable is mathematically correct and well-tested. The subdomain extraction in the BGG parser follows established patterns. Types are complete and well-structured for all profile concepts.

## Decisions

**Is the Jaccard distance computation correct when comparing a game's binary vector against the centroid's frequency vector?**
DEFECT: The Jaccard distance function uses strict `=== 1` checks, which produces wrong results when one vector is a frequency vector (centroid) with fractional values like 0.3 or 0.8.
*Reasoning: The centroid's binary portion is computed as `binarySum.map(s => s / n)`, producing frequency values in [0,1]. The game's binary portion is 0/1. In `jaccardDistance`, the checks `ai === 1 || bi === 1` and `ai === 1 && bi === 1` mean: a centroid value of 0.8 (mechanic in 80% of games) is treated as NOT present, because 0.8 !== 1. Only mechanics universal to every game in the collection (frequency exactly 1.0) count as "present" in the centroid. A game that shares the collection's most common mechanic (present in 80% of games) gets zero credit for it. This breaks the fundamental purpose of centroid-based Jaccard distance. The impact is that composite distances from the centroid are inflated for the binary component, because almost nothing in the centroid counts as "present." Files: feature-vector.ts:128-141 (jaccardDistance), feature-vector.ts:223 (centroid binary = frequency). The Jaccard function itself is correct for binary-vs-binary (game-vs-game) comparison, and its tests only test binary-vs-binary. The bug emerges from using it in a context it wasn't designed for.*

**Does the high-fitness outlier classification match the spec's definition?**
DEFECT: The implementation classifies any outlier with a non-zero, non-vetoed fitness score as "high-fitness outlier," regardless of how low the score is. The spec says these are games whose axes say "keep it."
*Reasoning: REQ-PROFILE-13 defines high-fitness outliers as "games whose axes say 'keep it' but whose BGG attributes say 'this doesn't fit the collection's identity.'" The phrase "axes say keep it" implies a meaningfully high fitness score, not just any positive value. The implementation at profile-engine.ts:337 checks `fitness.score > 0 && !fitness.vetoed`, which means a game with fitness 1.5 (very poor) that happens to be a distance outlier gets classified as "high-fitness outlier." That contradicts the spec's intent: a game with low fitness AND unusual BGG attributes is just a bad fit across the board, not a tension between "keep" and "doesn't belong." A threshold (e.g., above the collection median fitness, or above 5.0 as the midpoint of the 1-10 scale) would better capture the spec's intended semantics. The test at line 630 uses fitness 8.5, which would pass any reasonable threshold, so it doesn't catch this gap.*

**Will existing games without the `subdomains` field cause runtime errors in the profile engine?**
DEFECT: Games fetched before the subdomain addition have `bggData` without a `subdomains` property. The profile engine iterates over `subdomains` without null/undefined guards. This will throw TypeError at runtime.
*Reasoning: The storage layer at storage-service.ts:97 loads collection data as `JSON.parse(raw) as Collection` with no validation or defaults. The `BggGameData` interface in types.ts declares `subdomains: BggTag[]` as non-optional, but persisted data from before this change won't have the field. In profile-engine.ts:170, `computeBggClustering` calls `countAttributes((g) => g.bggData!.subdomains)`, and the closure returns `undefined` for pre-existing games. The `for...of` in countAttributes then throws: `TypeError: undefined is not iterable`. Same issue at profile-engine.ts:325 in `detectOutliers`. The plan identified this risk and prescribed a Zod default (`z.array(BggTagSchema).default([])`) in the BggGameDataSchema, but no such schema exists in validation.ts, and loadCollection does no validation. Fix options: (a) add a migration/default in loadCollection, (b) add `?? []` guards where subdomains are accessed, or (c) normalize the data on load.*

**Does the continuous attribute normalization follow the spec's requirement to use observed collection ranges?**
SPEC DEVIATION: The implementation uses fixed ranges (minPlayers 1-10, maxPlayers 1-10, playingTime 0-300) instead of observed collection ranges per REQ-PROFILE-11.
*Reasoning: REQ-PROFILE-11 says: "Each attribute is normalized to [0,1] by the observed range in the collection." The plan Phase 2 says "min players (normalized 0-1 over observed range), max players (normalized 0-1 over observed range), play time (normalized 0-1 over observed range)." The implementation at feature-vector.ts:99-101 uses hardcoded ranges: minPlayers 1-10, maxPlayers 1-10, playingTime 0-300. For weight (1-5) and community rating (1-10), fixed BGG scales are reasonable since those attributes are always in those ranges. But for player count and play time, the spec is explicit about observed ranges. A collection of party games (all 3-8 players) would have negligible player count spread under the fixed 1-10 range, but meaningful spread under the observed 3-8 range. The fix would require passing collection-level min/max per continuous dimension into `encodeGame`, or computing them in a pre-pass. This affects outlier detection sensitivity but not correctness category.*

**Are the outlier classification tests reliable?**
TEST GAP: Three outlier classification tests use conditional assertions (`if (warOutlier)`) that silently pass when the outlier isn't detected, making the tests non-deterministic validators.
*Reasoning: At profile-engine.test.ts lines 569, 600, and 633, the category-orphan, lone-wolf, and high-fitness-outlier classification tests wrap their assertions in `if (warOutlier)` / `if (oddOutlier)`. If the 2σ threshold doesn't flag the test game as an outlier (which depends on the specific composite distances in the test data), the assertion block is skipped and the test passes trivially. The test at line 473 (which asserts the outlier IS detected) uses `expect(warOutlier).toBeDefined()` without conditional, so that one is reliable. But the classification tests are weaker: they prove "IF it's flagged, THEN it has the right classification" rather than "it IS flagged AND has the right classification." These should assert the outlier exists before checking classifications, or the test data should be constructed to guarantee the outlier exceeds the 2σ threshold.*

**Is there a duplicate ComponentDistances type?**
CODE QUALITY: ComponentDistances is defined identically in both feature-vector.ts and types.ts. The feature vector module should import from shared rather than defining its own.
*Reasoning: feature-vector.ts:24-29 defines `ComponentDistances` with {binary, continuous, personalAxes, composite}. types.ts:297-302 defines the same interface. Both have identical fields and semantics. TypeScript's structural typing makes this compile, but it's a maintenance risk: if one changes, the other may not. The feature vector module already imports `Game` from `@shelf-judge/shared`, so importing `ComponentDistances` from there would be consistent. The profile engine uses the shared type for `CollectionOutlier.distances` and assigns the feature-vector type's return value to it. This works today because they're structurally identical, but it would break silently if a field were added to one and not the other.*

**Is subdomain extraction tested in the BGG XML parser test suite?**
TEST GAP: No tests for subdomain extraction exist in bgg-xml-parser.test.ts. The change is mechanically identical to mechanics/categories extraction but remains unverified by the test suite.
*Reasoning: Grep for "subdomain" in bgg-xml-parser.test.ts returned zero matches. The implementation at bgg-xml-parser.ts:164 adds `subdomains: extractLinks(links, "boardgamesubdomain")` to parseThingResponse, and the same pattern at line 244 in parseThingItems. The `extractLinks` function is already tested for mechanics and categories, and the subdomain extraction uses the same function with a different link type string. The risk is low since the pattern is established, but there's no fixture data or test that verifies the "boardgamesubdomain" link type is correctly identified. If the BGG XML uses a different link type string, this would silently return empty arrays.*

**Does the shared types index (index.ts) export all profile types?**
VERIFIED: All profile types are correctly exported from packages/shared/src/index.ts: AxisDistribution, AxisWeightEntry, AttributeCluster, WeightRangeCluster, UtilityCurveDeclaration, DivergentGame, ComponentDistances, OutlierClassification, CollectionOutlier, AxisSuggestion, CollectionProfile, ProfileData.
*Reasoning: Checked index.ts lines 34-45. Every profile type from types.ts is re-exported. No types are missing.*

**Spec compliance walkthrough: REQ-PROFILE-1 through REQ-PROFILE-17 against the implementation.**
Compliance status for each requirement documented. Two non-compliant items already captured as separate findings.
*Reasoning: REQ-PROFILE-1 (collection-level profile, read-only, four categories): COMPLIANT. computeProfile produces all four categories. Read-only by architecture: pure function with no write side effects.

REQ-PROFILE-2 (axis distributions: mean, median, stddev, range): COMPLIANT. computeAxisDistributions correctly computes all four statistics. Uses population stddev (correct per plan). Hand-calculated test validates.

REQ-PROFILE-3 (axis weight percentages): COMPLIANT. computeAxisWeights computes percentages of total weight. Sorted descending. Zero-total-weight handled (returns empty).

REQ-PROFILE-4 (BGG attribute clustering: mechanics, categories, subdomains, weight ranges): COMPLIANT with caveat. Clustering code handles all four. Games without BGG data excluded from denominator. Weight ranges use conventional names. Caveat: runtime crash on existing data without subdomains (captured as separate finding).

REQ-PROFILE-5 (utility curve declarations): COMPLIANT. extractUtilityCurves filters axes with non-default curve config and reports settings in native scale terms via getNativeScale.

REQ-PROFILE-6 (no external API calls): COMPLIANT. Both modules are pure functions with no I/O. No imports of fetch, http, or any network library.

REQ-PROFILE-7 (divergence detection, 1.5-point threshold, null normalized score excluded): COMPLIANT. computeDivergence checks `gap > 1.5` (strict greater-than, confirmed by test). Null normalized scores skipped.

REQ-PROFILE-8 (two divergence types): COMPLIANT. Tournament-outlier (high ELO, low fitness) and fitness-outlier (high fitness, low ELO) correctly distinguished.

REQ-PROFILE-9 (divergence reporting: both scores, gap, direction): COMPLIANT. DivergentGame includes fitnessScore, normalizedTournamentScore, gap, direction. Sorted by gap descending.

REQ-PROFILE-10 (divergence requires tournament data, omit when none): COMPLIANT. Returns null when tournamentStats is null or empty. The computeProfile function passes null through, meaning the profile has `divergence: null`.

REQ-PROFILE-11 (composite distance metric with Jaccard + normalized Manhattan + personal axes): NON-COMPLIANT. Two issues: (1) Jaccard distance with centroid frequency vector is mathematically incorrect (captured as finding #1). (2) Continuous normalization uses fixed ranges instead of observed ranges (captured as finding #4). The composite weighting and weight redistribution logic is correct.

REQ-PROFILE-12 (centroid-based outlier detection, 2σ threshold): COMPLIANT in structure. The detection logic correctly computes centroid, distances, mean, stddev, and flags games > mean + 2*stddev. The per-component distances ARE available in the response (compliant with transparency requirement). However, the binary component distance is wrong due to the Jaccard/centroid issue.

REQ-PROFILE-13 (three outlier classifications): PARTIALLY COMPLIANT. Lone wolf and category orphan are correctly implemented. High-fitness outlier has a semantic mismatch (captured as finding #2): no minimum fitness threshold.

REQ-PROFILE-14 (outlier detection is observation, not judgment): COMPLIANT by architecture. The profile engine reports outliers without recommendations. The types carry only data, not directives.

REQ-PROFILE-15 (axis suggestions from three sources): COMPLIANT. Unexpressed concentration (80% threshold), high-variance BGG attributes (CV > 0.5), and tournament divergence repair (shared attributes across 2+ divergent games) all implemented. The `axisCovers` helper does case-insensitive substring matching for mechanic names in axis names/descriptions.

REQ-PROFILE-16 (suggestions as questions, session-only dismissals): NOT APPLICABLE to Phases 1-3. This is UI behavior (Phase 5).

REQ-PROFILE-17 (suggestions without LLM): COMPLIANT. No LLM dependency anywhere in the suggestion engine.*
