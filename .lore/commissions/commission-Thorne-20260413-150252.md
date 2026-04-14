---
title: "Commission: Shelf Capacity: Review Algorithm (C14)"
date: 2026-04-13
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the standalone bin-packing algorithm (Phase 8).\n\n**Context:**\n- `.lore/designs/similarity-weighted-bin-packing.md` (the algorithm design, read FULLY)\n- `.lore/plans/shelf-capacity.md` (Phase 8)\n\n**Review focus:**\n1. **Standalone constraint**: Verify NO imports from `@shelf-judge/shared`. The module must be domain-agnostic.\n2. **Rotation correctness**: Verify the rotation algorithm matches the design doc exactly. Test edge cases: fits only when rotated, exactly shelf-sized, axis locking.\n3. **Merge strategies**: Verify all six produce correct results. Especially geomax: `(cap * product)^(1/(n+1))`.\n4. **Fitness functions**: Verify space, similarity, and neighbor scoring match the design doc formulas.\n5. **Four-phase loop**: Verify Phase 3 re-sorts bins after every placement. Verify Phase 2 handles multiple unambiguous items targeting the same bin.\n6. **Post-placement**: Only axis-0 subtracted, not axes 1/2.\n7. **Grading**: Normalization ceiling, grade boundaries, edge cases (fewer than 5 bins).\n8. **Test coverage**: All edge cases from the plan's Phase 8 test list are covered.\n\n**Files:** `packages/daemon/src/services/bin-packing.ts`, `packages/daemon/tests/bin-packing.test.ts`\n\nThis is the most complex single module. Take time to verify the math. Record all findings."
dependencies:
  - commission-Dalton-20260413-150240
linked_artifacts:
  - packages/daemon/src/services/bin-packing.ts

  - packages/daemon/tests/bin-packing.test.ts
  - packages/daemon/tests/bin-packing.test.ts
resource_overrides:
  model: opus

activity_timeline:
  - timestamp: 2026-04-13T22:02:52.226Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T22:10:22.777Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-13T22:22:41.502Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-13T22:22:41.504Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-13T22:22:41.527Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-13T22:22:47.803Z
    event: progress_report
    reason: "Starting review. Reading design doc, plan, implementation, and tests."
  - timestamp: 2026-04-13T22:23:06.567Z
    event: progress_report
    reason: "All source material loaded. Beginning systematic review: standalone constraint, rotation, merge strategies, fitness functions, four-phase loop, post-placement, grading, test coverage."
  - timestamp: 2026-04-13T22:26:41.842Z
    event: progress_report
    reason: "Found rotation swap bug and test bug. Now checking remaining items: Phase 3 edge case with no accepting bins, location override edge cases, and test coverage gaps."
  - timestamp: 2026-04-13T22:27:52.085Z
    event: progress_report
    reason: "Review complete. Compiling final results: 2 bugs (rotation swap, test compare function), 1 design doc inconsistency, 1 minor formula deviation, 3 test coverage gaps, 2 low-severity observations."
  - timestamp: 2026-04-13T22:28:41.868Z
    event: result_submitted
    reason: "# Bin-Packing Algorithm Review (Phase 8)\n\n## Verdict\n\nSolid implementation. The algorithm matches the design doc across all major areas: merge strategies, fitness functions, four-phase loop, post-placement dimension update, and grading. The standalone constraint is fully satisfied. Two bugs found, one in the algorithm's rotation swap path and one in a test. Three test coverage gaps, all in code paths that are currently untested and one of which covers the rotation bug.\n\n---\n\n## Findings (Priority Order)\n\n### 1. BUG: Rotation swap can assign the same item dimension to two axes\n\n**File:** `bin-packing.ts:182-197`\n**Severity:** Medium\n**Impact:** Incorrect rotation result for items with distinct dimensions when the swap recovery path fires.\n\nWhen the greedy axis-by-axis assignment fails for an axis, the swap recovery frees the previous axis's item dimension (line 182: `usedItemIndices.delete(prevItemIdx)`) and assigns it to the current axis. It then searches for a replacement for the previous axis (lines 184-188). The problem: `prevItemIdx` is now free and appears in `swapCandidates`. If it's the best candidate (determined by minimize flag), it gets picked for the previous axis too. Both axes end up with the same item dimension while a third dimension goes unused.\n\nExample trigger: item `[3, 7, 5]`, bin where axis 1 gets 7, axis 2 can't fit 3 or 5 but can fit 7 via swap. Swap assigns 7 to axis 2. For axis 1's replacement, if minimize=true picks smallest and `itemDims[1]=7` < nothing else available, index 1 gets picked again. Result: axes 1 and 2 both get 7, dimension 3 and 5 unused.\n\n**Fix:** Exclude `prevItemIdx` from `swapCandidates` since it's reserved for the current axis:\n```typescript\n// line 185, add:\nif (i === prevItemIdx) continue;\n```\n\n### 2. BUG: Stress test compare function always returns 0.7\n\n**File:** `bin-packing.test.ts:613-614`\n**Severity:** Medium\n**Impact:** The \"many items and bins\" test doesn't validate group-based clustering.\n\nBoth `myGroup` and `otherGroup` are computed from `other.id`:\n```typescript\nconst myGroup = Math.floor(parseInt(other.id.slice(1)) / 10);\nconst otherGroup = Math.floor(parseInt(other.id.slice(1)) / 10);\n```\n\nThey're always equal, so `compare` always returns 0.7. The test passes (items get placed without error) but never tests that similar items cluster. `myGroup` should derive from the item's own id, captured in a closure.\n\n### 3. TEST GAP: Rotation swap path has zero test coverage\n\n**File:** `bin-packing.test.ts`\n**Severity:** Medium\n**Impact:** The bug in Finding #1 has no test to catch or prevent it.\n\nNo test creates a scenario where the greedy axis assignment fails and the swap fires. All existing rotation tests either fit on every axis or don't fit at all. Need a test where an item can only fit a bin if the last two assigned dimensions are swapped. For example: item `[8, 3, 12]`, bin `[10, 14, 6]` with priority `[0, 1, 2]`, minimize `[false, true, true]`. Axis 0 picks 12 (largest), axis 1 picks 3 (smallest), axis 2 needs something ≤ 6 from unused {8}. 8 > 6, swap: give axis 2 what axis 1 had (3 ≤ 6 ✓), give axis 1 a new candidate from {8}: 8 ≤ 14 ✓. Result: [12, 8, 3].\n\n### 4. TEST GAP: Neighbor fitness path has zero test coverage\n\n**File:** `bin-packing.test.ts`\n**Severity:** Medium\n**Impact:** Neighbor scoring in `itemInBinFitness` (lines 268-281) and `binReadiness` (lines 322-338) is never exercised.\n\nEvery bin in the test file has `neighbors: []`. No test verifies that items in adjacent bins influence fitness scoring. The default config gives neighbor weight 0.10, which is nonzero, so it does affect results.\n\n### 5. TEST GAP: Multiple unambiguous items targeting same bin\n\n**File:** `bin-packing.test.ts`\n**Severity:** Low\n**Impact:** Phase 2's sequential placement behavior (the design doc's \"each placement changes remaining dimensions, so a later unambiguous item may no longer fit\") is untested.\n\nOnly one test exercises Phase 2, with a single unambiguous item. A test with two items that each fit exactly one bin (the same bin), where the second no longer fits after the first is placed, would verify the critical sequencing behavior.\n\n### 6. DEVIATION: Dimensionless bin grading normalizes by maxPairwise (design doc says don't)\n\n**File:** `bin-packing.ts:444`\n**Severity:** Low\n**Impact:** Dimensionless bin grades may be inflated when maxPairwise < 1.\n\nDesign doc: \"if bin has no dimensions: grade = base_fitness\". Code: `score = baseFit / maxPairwise`. This normalizes where the doc says not to. If maxPairwise is 0.5, a baseFit of 0.4 becomes 0.8 instead of 0.4. Low impact since dimensionless bins are typically overflow/archive bins.\n\n### 7. DOC INCONSISTENCY: Design doc rotation pseudocode swaps true/false labels\n\n**File:** `.lore/designs/similarity-weighted-bin-packing.md`, Rotation Algorithm section\n**Severity:** Low (doc issue, not code issue)\n**Impact:** Future implementers reading the doc would get the logic backwards.\n\nThe Bins section defines `axisMinimize: true` = \"minimize (leave room)\" = pick smallest. The Rotation Algorithm section says \"if M[axis] is true: pick the largest fitting dimension (consume space)\". These are contradictory. The code follows the flag name semantics (true = minimize = pick smallest), which is correct.\n\n---\n\n## Confirmed Correct\n\n- **Standalone constraint**: Zero imports. Fully self-contained module.\n- **All six merge strategies**: Formulas match design doc exactly. Edge cases (empty array, zeros) handled.\n- **Geomax formula**: `(cap * product)^(1/(n+1))` implemented correctly. Cap = max, product seeded with cap, (n+1)th root.\n- **Space fitness**: Per-axis ratios (rotated/remaining) merged via strategy. Match.\n- **Similarity fitness**: Merges pairwise compare() results for bin contents. Empty bin → score 0. Match.\n- **Neighbor fitness**: Nested merge (per-neighbor, then across neighbors). Match.\n- **Bin readiness**: Base (coherence), unsorted (top-N candidates), neighbor. Weighted sum. Match.\n- **Four-phase loop**: Phase 1 handles hard/soft overrides, creating synthetic bins for hard. Phase 2 places unambiguous items in input order with progressive state updates. Phase 3 re-sorts after every placement via break + outer while. Phase 4 collects overflow sorted by priority.\n- **Post-placement**: Only axis 0 subtracted. Axes 1, 2 unchanged. Match.\n- **Grading normalization**: Max pairwise similarity ceiling computed correctly (i < j avoids self). Division-by-zero guard present.\n- **Grade boundaries**: Percentile-based S/A/B/C/D/F at 90/70/50/30/10 thresholds. Single-bin edge case handled (percentile = 1 → S).\n- **Test coverage**: All 15 cases from the plan's minimum list are covered. Additional cases for overrides, dimensionless combos, accumulation, stress, and config defaults."
  - timestamp: 2026-04-13T22:28:50.078Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Review complete. Compiling final results: 2 bugs (rotation swap, test compare function), 1 design doc inconsistency, 1 minor formula deviation, 3 test coverage gaps, 2 low-severity observations."
projectName: shelf-judge
---
# Bin-Packing Algorithm Review (Phase 8)

## Verdict

Solid implementation. The algorithm matches the design doc across all major areas: merge strategies, fitness functions, four-phase loop, post-placement dimension update, and grading. The standalone constraint is fully satisfied. Two bugs found, one in the algorithm's rotation swap path and one in a test. Three test coverage gaps, all in code paths that are currently untested and one of which covers the rotation bug.

---

## Findings (Priority Order)

### 1. BUG: Rotation swap can assign the same item dimension to two axes

**File:** `bin-packing.ts:182-197`
**Severity:** Medium
**Impact:** Incorrect rotation result for items with distinct dimensions when the swap recovery path fires.

When the greedy axis-by-axis assignment fails for an axis, the swap recovery frees the previous axis's item dimension (line 182: `usedItemIndices.delete(prevItemIdx)`) and assigns it to the current axis. It then searches for a replacement for the previous axis (lines 184-188). The problem: `prevItemIdx` is now free and appears in `swapCandidates`. If it's the best candidate (determined by minimize flag), it gets picked for the previous axis too. Both axes end up with the same item dimension while a third dimension goes unused.

Example trigger: item `[3, 7, 5]`, bin where axis 1 gets 7, axis 2 can't fit 3 or 5 but can fit 7 via swap. Swap assigns 7 to axis 2. For axis 1's replacement, if minimize=true picks smallest and `itemDims[1]=7` < nothing else available, index 1 gets picked again. Result: axes 1 and 2 both get 7, dimension 3 and 5 unused.

**Fix:** Exclude `prevItemIdx` from `swapCandidates` since it's reserved for the current axis:
```typescript
// line 185, add:
if (i === prevItemIdx) continue;
```

### 2. BUG: Stress test compare function always returns 0.7

**File:** `bin-packing.test.ts:613-614`
**Severity:** Medium
**Impact:** The "many items and bins" test doesn't validate group-based clustering.

Both `myGroup` and `otherGroup` are computed from `other.id`:
```typescript
const myGroup = Math.floor(parseInt(other.id.slice(1)) / 10);
const otherGroup = Math.floor(parseInt(other.id.slice(1)) / 10);
```

They're always equal, so `compare` always returns 0.7. The test passes (items get placed without error) but never tests that similar items cluster. `myGroup` should derive from the item's own id, captured in a closure.

### 3. TEST GAP: Rotation swap path has zero test coverage

**File:** `bin-packing.test.ts`
**Severity:** Medium
**Impact:** The bug in Finding #1 has no test to catch or prevent it.

No test creates a scenario where the greedy axis assignment fails and the swap fires. All existing rotation tests either fit on every axis or don't fit at all. Need a test where an item can only fit a bin if the last two assigned dimensions are swapped. For example: item `[8, 3, 12]`, bin `[10, 14, 6]` with priority `[0, 1, 2]`, minimize `[false, true, true]`. Axis 0 picks 12 (largest), axis 1 picks 3 (smallest), axis 2 needs something ≤ 6 from unused {8}. 8 > 6, swap: give axis 2 what axis 1 had (3 ≤ 6 ✓), give axis 1 a new candidate from {8}: 8 ≤ 14 ✓. Result: [12, 8, 3].

### 4. TEST GAP: Neighbor fitness path has zero test coverage

**File:** `bin-packing.test.ts`
**Severity:** Medium
**Impact:** Neighbor scoring in `itemInBinFitness` (lines 268-281) and `binReadiness` (lines 322-338) is never exercised.

Every bin in the test file has `neighbors: []`. No test verifies that items in adjacent bins influence fitness scoring. The default config gives neighbor weight 0.10, which is nonzero, so it does affect results.

### 5. TEST GAP: Multiple unambiguous items targeting same bin

**File:** `bin-packing.test.ts`
**Severity:** Low
**Impact:** Phase 2's sequential placement behavior (the design doc's "each placement changes remaining dimensions, so a later unambiguous item may no longer fit") is untested.

Only one test exercises Phase 2, with a single unambiguous item. A test with two items that each fit exactly one bin (the same bin), where the second no longer fits after the first is placed, would verify the critical sequencing behavior.

### 6. DEVIATION: Dimensionless bin grading normalizes by maxPairwise (design doc says don't)

**File:** `bin-packing.ts:444`
**Severity:** Low
**Impact:** Dimensionless bin grades may be inflated when maxPairwise < 1.

Design doc: "if bin has no dimensions: grade = base_fitness". Code: `score = baseFit / maxPairwise`. This normalizes where the doc says not to. If maxPairwise is 0.5, a baseFit of 0.4 becomes 0.8 instead of 0.4. Low impact since dimensionless bins are typically overflow/archive bins.

### 7. DOC INCONSISTENCY: Design doc rotation pseudocode swaps true/false labels

**File:** `.lore/designs/similarity-weighted-bin-packing.md`, Rotation Algorithm section
**Severity:** Low (doc issue, not code issue)
**Impact:** Future implementers reading the doc would get the logic backwards.

The Bins section defines `axisMinimize: true` = "minimize (leave room)" = pick smallest. The Rotation Algorithm section says "if M[axis] is true: pick the largest fitting dimension (consume space)". These are contradictory. The code follows the flag name semantics (true = minimize = pick smallest), which is correct.

---

## Confirmed Correct

- **Standalone constraint**: Zero imports. Fully self-contained module.
- **All six merge strategies**: Formulas match design doc exactly. Edge cases (empty array, zeros) handled.
- **Geomax formula**: `(cap * product)^(1/(n+1))` implemented correctly. Cap = max, product seeded with cap, (n+1)th root.
- **Space fitness**: Per-axis ratios (rotated/remaining) merged via strategy. Match.
- **Similarity fitness**: Merges pairwise compare() results for bin contents. Empty bin → score 0. Match.
- **Neighbor fitness**: Nested merge (per-neighbor, then across neighbors). Match.
- **Bin readiness**: Base (coherence), unsorted (top-N candidates), neighbor. Weighted sum. Match.
- **Four-phase loop**: Phase 1 handles hard/soft overrides, creating synthetic bins for hard. Phase 2 places unambiguous items in input order with progressive state updates. Phase 3 re-sorts after every placement via break + outer while. Phase 4 collects overflow sorted by priority.
- **Post-placement**: Only axis 0 subtracted. Axes 1, 2 unchanged. Match.
- **Grading normalization**: Max pairwise similarity ceiling computed correctly (i < j avoids self). Division-by-zero guard present.
- **Grade boundaries**: Percentile-based S/A/B/C/D/F at 90/70/50/30/10 thresholds. Single-bin edge case handled (percentile = 1 → S).
- **Test coverage**: All 15 cases from the plan's minimum list are covered. Additional cases for overrides, dimensionless combos, accumulation, stress, and config defaults.

## Decisions

**Does the module satisfy the standalone constraint (no imports from @shelf-judge/shared)?**
PASS. The module has zero import statements. It is fully self-contained.
*Reasoning: Grepped for `import` and `require` in bin-packing.ts. Only result is the comment on line 1 declaring the intent. No external dependencies of any kind.*

**Do all six merge strategies match the design doc formulas?**
PASS. All six are correct. avg (arithmetic mean), geo (geometric mean), harmonic (harmonic mean), max (maximum), min (minimum), geomax ((cap * product)^(1/(n+1))) all match the design doc. Edge cases handled: empty scores return 0 for all, harmonic returns 0 on zero input, geomax returns 0 when cap is 0.
*Reasoning: Line-by-line verification: mergeGeomax (lines 112-118) computes cap = mergeMax(scores), seeds product with cap, multiplies all scores, takes (n+1)th root. The design doc says "(cap * product)^(1/(n+1)) where cap = max score". Implementation: product starts at cap, loop multiplies by each score (that's cap * s1 * s2 * ... = cap * product_of_scores), exponent is 1/(scores.length + 1) = 1/(n+1). Correct.*

**Does the rotation algorithm match the design doc exactly?**
PASS with one observation. The algorithm matches the design doc's intent: iterate axes in priority order, pick the best-fitting unused item dimension per minimization flag, swap recovery on failure. The forceAxis0Width behavior correctly locks axis 0 to the item's original dimension 0.
*Reasoning: Design doc says: "for each axis in priority order P: from the item's unused dimensions: find one that fits, if M[axis] true pick smallest, if false pick largest. If none fits: try swapping last two assigned dimensions." Implementation (lines 132-209): iterates axesToAssign, for each collects candidates that fit (itemDims[i] <= binSize), sorts by minimization flag, picks first. If no candidate, attempts swap with previous axis. ForceAxis0Width: locks result[0] = itemDims[0], marks index 0 as used, filters axis 0 from axesToAssign. Design doc: "axis 0 is locked to the item's original axis 0". Match.

Observation: the design doc says "if M[axis] is true: pick the largest fitting dimension (consume space)" and "if M[axis] is false: pick the smallest fitting dimension (conserve space)". But looking at the code at line 168: `candidates.sort((a, b) => (minimize ? a.size - b.size : b.size - a.size))` — when minimize is true, sorts ascending (picks smallest first); when false, sorts descending (picks largest first). Wait, re-reading the doc: "if M[axis] is true: pick the largest fitting dimension (consume space)". But the code picks smallest when minimize=true.

Actually, re-reading the design doc more carefully: "Axis minimization flags: per-axis booleans controlling whether the item's dimension along that axis should be maximized (fill the space) or minimized (leave room). Default: [false, true, true] (minimize height consumption, maximize width and depth fill)."

So axisMinimize[0] = false means "don't minimize axis 0" = maximize = pick largest. axisMinimize[1] = true means "minimize axis 1" = pick smallest.

But then the rotation algorithm section says: "if M[axis] is true: pick the largest fitting dimension (consume space)" — this contradicts the definition above. Wait, let me re-read:

"if M[axis] is true: pick the largest fitting dimension (consume space)
if M[axis] is false: pick the smallest fitting dimension (conserve space)"

Hmm, this is confusing. The bin definition says minimize flags control "whether the item's dimension along that axis should be maximized (fill the space) or minimized (leave room)". So when M[axis] = true, you're minimizing the item's presence on that axis = picking the smallest dimension = conserving space. When M[axis] = false, you're maximizing = picking the largest = consuming space.

But the rotation algorithm section says the opposite: M[axis] true = pick largest = consume. This is a contradiction WITHIN the design doc.

The code follows the interpretation that minimize=true picks the smallest (conserve), which matches the flag NAME "axisMinimize" and the bin definition section. The rotation algorithm section's text has the descriptions swapped relative to the flag name.

I'll note this as a design doc inconsistency, not a code bug. The code behavior (minimize=true → pick smallest) is the correct interpretation based on the flag semantics.
*

**Is there a contradiction in the design doc's rotation algorithm description vs the axisMinimize flag definition?**
FINDING: Design doc internal inconsistency. The Bins section defines axisMinimize as "whether the item's dimension should be minimized (leave room)" with default [false, true, true] meaning "minimize height consumption, maximize width/depth fill." But the Rotation Algorithm section says "if M[axis] is true: pick the largest fitting dimension (consume space)" — which is the opposite meaning. The CODE follows the flag name semantics (minimize=true picks smallest), which is correct. The rotation algorithm pseudocode in the design doc has the true/false labels swapped.
*Reasoning: Design doc line for bins: "axisMinimize: per-axis booleans controlling whether the item's dimension along that axis should be maximized (fill the space) or minimized (leave room). Default: [false, true, true] (minimize height consumption, maximize width and depth fill)." So true=minimize=leave room=pick smallest.

Design doc rotation section: "if M[axis] is true: pick the largest fitting dimension (consume space)" — this says true=largest=consume, contradicting the definition.

Code line 168: `minimize ? a.size - b.size : b.size - a.size` — minimize=true sorts ascending, picks smallest first. This matches the flag name and bin definition, not the rotation pseudocode text.

The test at line 228 confirms: minimize=false on axis 0 picks 7 (largest), minimize=true on axis 1 picks 3 (smallest). Code is correct, pseudocode text is wrong.*

**Do the fitness functions (itemInBinFitness, binReadiness) match the design doc formulas?**
PASS. Both functions match the design doc. Space score merges per-axis ratios (rotated/remaining). Similarity merges pairwise compare() results. Neighbor merges per-neighbor scores, where each neighbor score merges similarities to that neighbor's items. Composite: weighted sum. binReadiness: base (internal coherence), unsorted (top-N candidate fitness), neighbor (best unplaced item per neighbor). All match.
*Reasoning: itemInBinFitness (lines 228-284): space_score computes ratios of rotated dims to remaining bin dims, merges them. Matches "space_score = merge_strategy(for each axis: item_dim[axis] / bin_dim[axis])". Similarity computes compare(new, each existing), merges. Matches design. Neighbor iterates neighbor bins, for each computes merge(compare(new, each neighbor item)), then merges across neighbors. Matches design. Final line: spaceScore * w.space + similarityScore * w.game + neighborScore * w.neighbor. Matches.

binReadiness (lines 287-341): baseFitness computes per-item merge of similarities to all others, then merges those. Matches "base = merge_strategy(for each item: item.merge_score(all other items))". unsortedFitness computes itemInBinFitness for all unplaced, sorts, takes top-N. Matches. neighborFitness: for each neighbor with contents, computes best unplaced item's similarity to that neighbor's items. Matches.*

**Does Phase 2 correctly handle multiple unambiguous items targeting the same bin?**
PASS. Phase 2 (lines 576-588) iterates unplaced items in input order. For each, it checks all bins and counts how many the item fits. If exactly one, it places the item and calls placeItem which updates remaining dimensions. Subsequent items in the same loop see the updated bin state, so a later item may no longer fit (matching the design doc: "Each placement changes the bin's remaining dimensions and similarity profile, so a later unambiguous item may no longer fit and falls through to Phase 3").
*Reasoning: The phase2Items list is built once (line 576), but placeItem mutates binState.remaining (lines 378-383), so when the next item's fittingBins check runs, it sees updated dimensions. This correctly handles the "multiple unambiguous items targeting the same bin" case from the design doc.*

**Does Phase 3 re-sort bins after every placement?**
PASS. Line 629: `break` exits the inner for-loop over binScores after placing one item. The outer `while` loop restarts, recalculating binReadiness for all bins (lines 598-608) and re-sorting. One item per iteration of the outer loop, full re-evaluation each time.
*Reasoning: The design doc says: "restart the loop (re-sort bins with updated state)" after each placement. The implementation's outer while loop (line 592) re-enters, rebuilds currentUnplaced (line 594), re-scores all bins (lines 597-608), re-sorts, and tries again. The break on line 629 ensures only one item is placed per outer-loop iteration.*

**Does post-placement correctly subtract only axis-0?**
PASS. placeItem (lines 366-384) subtracts rotated[0] from remaining[0] and preserves remaining[1] and remaining[2]. This matches the design doc: "only axis 0 of the bin's remaining dimensions is reduced by the item's rotated axis-0 size. Axes 1 and 2 are unchanged."
*Reasoning: Line 378-383: `binState.remaining = [binState.remaining[0] - rotated[0], binState.remaining[1], binState.remaining[2]]`. Axes 1 and 2 copied verbatim.*

**Does grading match the design doc (normalization ceiling, grade formula, grade boundaries, edge cases)?**
PASS with one minor observation. The normalization ceiling (max pairwise similarity) is computed correctly (lines 401-412). The grade formula for dimensionless bins, single-item bins, and multi-item bins matches the design doc. Grade boundaries use percentile ranks mapping to S/A/B/C/D/F. When fewer than 5 bins, the percentile formula `i / (n - 1)` with n <= 1 returning percentile 1 handles the edge case of a single bin (gets grade S).
*Reasoning: Design doc grading:
- max_score = max pairwise similarity across all items (excluding self). Code: lines 406-411, double loop i < j, takes max of compare(). Note: compare(a,b) but design doc says "where a != b" — using i < j avoids self-comparison. Match.
- Division by zero guard: line 412, maxPairwise set to 1 if 0. Correct.
- Dimensionless bin: grade = base_fitness. Code line 444: score = baseFit / maxPairwise. Wait, design doc says "grade = base_fitness", not "base_fitness / maxPairwise". Let me check...

Design doc: "if bin has no dimensions: grade = base_fitness". Code: `gradeScores.push({ binId, score: baseFit / maxPairwise, baseFitness: baseFit })`. This normalizes base_fitness by maxPairwise for dimensionless bins, but the design doc says just base_fitness. This is a deviation.

Actually, re-reading the design doc: the grading section doesn't explicitly say dimensionless bins should NOT be normalized. But it only shows normalization for the multi-item case: "base_fitness / max_score". The dimensionless case says "grade = base_fitness" without normalization. The code normalizes it. This is a small discrepancy but arguably more consistent behavior.

Grade boundaries: Design doc says "S (top 10%), A, B, C, D, F (bottom 10%)". Plan says "S (top 10%), A (10-30%), B (30-50%), C (50-70%), D (70-90%), F (bottom 10%)". Code: percentile >= 0.9 -> S, >= 0.7 -> A, >= 0.5 -> B, >= 0.3 -> C, >= 0.1 -> D, else F. Sorted ascending, so percentile 0.9 = top 10%. Match.

Edge case fewer than 5 bins: line 501, `n <= 1 ? 1 : i / (n - 1)`. With 1 bin, percentile = 1, gets S. With 2 bins, i=0 gets percentile 0 (F), i=1 gets percentile 1 (S). With 3 bins: 0, 0.5, 1 → F, B, S. The plan says "grade boundaries collapse proportionally" — the percentile-based approach does this naturally.

I'll record the dimensionless bin normalization as a finding.
*

**Does the dimensionless bin grading match the design doc?**
FINDING (low severity): Dimensionless bin grade formula deviates from design doc. The design doc says "if bin has no dimensions: grade = base_fitness". The code (line 444) computes `baseFit / maxPairwise`, normalizing by the pairwise ceiling. This is arguably more consistent with the multi-item case (which also normalizes), but it doesn't match what the doc specifies. Impact is low: dimensionless bins are overflow/archive bins where the grade matters less.
*Reasoning: Design doc, Grading section: "if bin has no dimensions: grade = base_fitness". Code line 444: score = baseFit / maxPairwise. The normalization isn't specified for this case. If maxPairwise is 0.5 and baseFit is 0.4, the code produces 0.8 instead of 0.4. The two formulas diverge whenever maxPairwise != 1.*

**Is there a bug in the "many items and bins" test's compare function?**
FINDING (medium severity): Bug in test at line 613-614. The compare function computes `myGroup` from `other.id`, not from the item's own id. Both `myGroup` and `otherGroup` are derived from `other.id`, so they are always equal, and compare always returns 0.7. The test still passes (items get placed without error) but it does NOT test group-based similarity clustering as apparently intended. The function should capture the item's own id in a closure.
*Reasoning: Line 612-616:
```
compare: (other) => {
  const myGroup = Math.floor(parseInt(other.id.slice(1)) / 10);
  const otherGroup = Math.floor(parseInt(other.id.slice(1)) / 10);
  return myGroup === otherGroup ? 0.7 : 0.2;
}
```
Both myGroup and otherGroup parse `other.id`. They're identical. The condition always returns 0.7. The function should use the item's own id (e.g. `i${i}`) for myGroup. Should be:
```
const myId = i; // capture in closure
compare: (other) => {
  const myGroup = Math.floor(myId / 10);
  const otherGroup = Math.floor(parseInt(other.id.slice(1)) / 10);
  return myGroup === otherGroup ? 0.7 : 0.2;
}
```*

**Is the rotation swap recovery logic correct?**
FINDING (medium severity): The swap logic in findBestRotation has a subtle bug. When the swap succeeds (line 193-197), the code does `usedItemIndices.add(prevItemIdx)` but prevItemIdx was already in usedItemIndices before the delete on line 182. The issue is that the swap assigns `result[axis] = prevSize` (moving the previous axis's dimension to the current axis) and picks a new dimension for the previous axis from swapCandidates. But on line 194, it adds prevItemIdx back into usedIndices — this is the INDEX of the item dimension that was originally assigned to prevAxis, which is now being moved to the current axis. That's correct. However, line 196 adds swapCandidates[0].idx — but this may be the SAME index as prevItemIdx if the item dimension that was swapped away also fits the previous axis. Let me re-check...

Actually, on line 182, prevItemIdx is deleted from usedItemIndices. The swapCandidates loop at 184-188 iterates all indices NOT in usedItemIndices, which now excludes prevItemIdx only if it was already removed. Wait, prevItemIdx WAS removed on line 182. So swapCandidates can include prevItemIdx if it fits. If it's picked, then line 194 adds prevItemIdx (for the current axis), and line 196 adds swapCandidates[0].idx which could also be prevItemIdx — that would be adding the same index twice, which is fine for a Set but means two result axes reference the same item dimension. That's a bug.

Wait, let me re-read. After the delete, prevItemIdx is NOT in usedItemIndices. The swap candidates loop collects indices NOT in usedItemIndices. So prevItemIdx is a candidate for the prev axis. If prevItemIdx is the best swap candidate:
- Line 193: result[axis] = prevSize (the size that was at prevAxis, which came from itemDims[prevItemIdx])
- Line 194: usedItemIndices.add(prevItemIdx) — marking prevItemIdx as used for axis
- Line 195: result[prevAxis] = swapCandidates[0].size = itemDims[prevItemIdx]
- Line 196: usedItemIndices.add(swapCandidates[0].idx) = usedItemIndices.add(prevItemIdx) — same index

So result[axis] = itemDims[prevItemIdx] and result[prevAxis] = itemDims[prevItemIdx]. Both axes get the same item dimension. That's using one physical dimension for two axes, which is physically impossible.

But wait, would this actually happen? For prevItemIdx to be a swap candidate for prevAxis, itemDims[prevItemIdx] must fit binDims[prevAxis]. And it was originally assigned to prevAxis, so of course it fits. But the sort on line 192 uses prevMinimize, so it might not be the top candidate if there's a better option. If it IS the top candidate, the bug triggers.

Actually hold on. Let me re-think. The prevItemIdx was assigned to prevAxis originally. When we try to swap: we want to give the current axis what prevAxis had (prevSize = result[prevAxis] = itemDims[prevItemIdx]). Then we need to find a NEW dimension for prevAxis. But if prevItemIdx is eligible for prevAxis again (it fits), and it's picked, we'd assign itemDims[prevItemIdx] to prevAxis again AND also to the current axis. That's the same value being used for two axes.

In practice this might be masked because the item might have duplicate dimension values (e.g., [5, 5, 10]). But for items with unique dimensions, this is a real bug path.
*Reasoning: Lines 182-197. After removing prevItemIdx from usedIndices, swapCandidates at line 184-188 can include prevItemIdx. If prevItemIdx is picked as swapCandidates[0], then prevItemIdx gets assigned to both axis (line 194) and prevAxis (line 196), using the same item dimension for two output axes. The fix: the swapCandidates loop should explicitly exclude prevItemIdx, since that dimension is being moved to the current axis.

The likelihood of this triggering depends on item dimensions and bin dimensions. It requires: (1) no candidate fits the current axis normally, (2) the swap is attempted, (3) prevItemIdx is the best swap candidate for prevAxis. In board game dimensions this may be rare but it's not impossible.*

**Does the PackBin type include all fields from the design doc?**
FINDING (low severity): The design doc specifies bins have a "Sort group" field ("integer for display ordering. Separates physical locations"). The PackBin type omits it. This is acceptable for the standalone algorithm since sort group is a display concern, not a packing concern. But it will need to be handled in the adapter layer or it's a gap.
*Reasoning: Design doc Bins section: "Sort group: integer for display ordering. Separates physical locations (upstairs shelf vs. downstairs shelf vs. overflow)." PackBin interface (lines 15-22) has id, dimensions, axisPriority, axisMinimize, layer, neighbors. No sortGroup. Since the algorithm doesn't use sort groups for packing decisions (they're display-only), omitting them from the algorithm module is a reasonable scope decision. The adapter layer (Phase 9) would need to carry this through.*

**Does Phase 3 handle the "no bin accepted any item" exit correctly?**
PASS. The progress flag (line 591-593) starts false each outer iteration. If no bin in the inner loop accepts any item, progress stays false and the while loop exits (line 592: `unplaced.size > 0 && progress`). Wait — progress starts as `true` on line 591, not false. Let me re-read.

Actually: `let progress = true` on line 591, the while condition checks `progress`. Inside the loop, `progress = false` on line 593. If any item is placed, `progress = true` on line 628. So if no placement happens in an iteration, progress stays false and the loop exits next check. But the while condition is checked at the TOP: `while (unplaced.size > 0 && progress)`. After progress is set to false at line 593, it's only set back to true on line 628. If the inner loop completes without placing anything, the while loop re-checks and exits because progress is false. Correct.
*Reasoning: Line 591: `let progress = true`. Line 592: `while (unplaced.size > 0 && progress)`. Line 593: `progress = false`. Line 628: `progress = true` (only on successful placement). The design doc says "if no bin accepted any item: exit loop". Implementation matches.*

**Is findItemIdxForAxis reliable when item dimensions have duplicate values?**
FINDING (low severity): findItemIdxForAxis (lines 212-223) finds the first used index whose dimension value matches the target. For items with duplicate dimensions (e.g., [10, 10, 5]), this returns the first match, which may not be the correct original assignment. Example: if itemDims = [10, 10, 5] and both indices 0 and 1 are used, and we want the index assigned to an axis with result value 10, we'd get index 0 even if index 1 was the actual assignment. This can cause the swap to operate on the wrong index. However, since the dimensions are equal, the swap result is the same regardless of which index is returned, so the practical impact is nil.
*Reasoning: The function matches by value, not by tracking the assignment directly. For distinct dimensions this is unambiguous. For duplicate dimensions, returning the wrong index is harmless because the dimensions are identical. The only risk would be if some downstream logic cared about which original axis was assigned, but nothing does — only the rotated dimension values matter.*

**Does the test file cover all edge cases from the plan's Phase 8 test list?**
PASS. All 15 test cases from the plan are covered:
1. "Rotation: item fits when rotated" → line 144
2. "Rotation: item exactly shelf-sized" → line 161
3. "Rotation: item 0.1 in too large" → line 172
4. "Rotation: forceAxis0Width locks axis 0" → line 196
5. "Dimensionless items bypass spatial checks" → line 272
6. "Dimensionless bins accept all items" → line 277
7. "Fitness: space score for tight vs loose" → line 506
8. "Fitness: similarity score uses compare()" → line 522
9. "Merge strategies: all six correct" → line 66
10. "Phase 2: item fitting exactly one bin" → line 330
11. "Phase 3: higher-priority bin fills first, re-sort" → line 375, 398
12. "Phase 4: unfitted items in overflow" → line 429
13. "Grading: bins receive S through F" → line 451, 461
14. "Empty input returns empty result" → line 239
15. "Single item, single bin: placed, graded" → line 256, 262

Additional tests beyond the plan's list: dimensionless item+bin combo, hard/soft overrides, axis fill-up, priority ordering in overflow, post-placement dimension accumulation, partial config defaults, large-scale stress test.
*Reasoning: Cross-referenced each bullet in the plan's "Verification" section against test describe/test blocks. Every listed case has at least one test. The test file also includes cases not in the minimum list, which is good practice.*

**Are there notable test coverage gaps beyond the plan's minimum list?**
FINDING (medium severity): Three coverage gaps worth noting:
1. **Rotation swap path untested.** No test exercises the swap recovery in findBestRotation (lines 172-203). The "item fits only when rotated" test (line 144) tests normal rotation, not the case where the greedy axis-by-axis assignment fails and the swap fires. This is the exact code path with the bug described in the earlier finding.
2. **Neighbor fitness untested.** No test provides bins with non-empty `neighbors` arrays. The neighbor scoring path in both itemInBinFitness (lines 268-281) and binReadiness (lines 322-338) is never exercised. 
3. **Multiple unambiguous items targeting same bin untested.** The plan specifically calls out this Phase 2 behavior but no test covers two unambiguous items competing for the same single-fit bin, verifying that the second one may fall through to Phase 3.
*Reasoning: Searched test file for: (1) any test where rotation would require the swap path — all rotation tests either fit directly or don't fit at all, none triggers the "last two assigned dimensions" swap. (2) Any test setting neighbors on bins — all makeBin calls use default `neighbors: []`. (3) Phase 2 tests — only one test with a single unambiguous item, no test with multiple items targeting the same bin.*

**Is the PackItem.locationOverride type definition correct?**
OBSERVATION (style): Line 12 defines `locationOverride?: { binId: string; hard: boolean } | undefined`. The `?` already makes the property optional (allowing undefined), so the explicit `| undefined` is redundant. Not a bug, just unnecessary verbosity.
*Reasoning: In TypeScript strict mode, `prop?: T` is equivalent to `prop?: T | undefined`. The explicit union adds nothing.*
