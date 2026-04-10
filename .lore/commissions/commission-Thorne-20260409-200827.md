---
title: "Commission: Review: Utility Curves Phase 3"
date: 2026-04-10
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the Phase 3 (Fitness Service Integration) implementation of the utility curves plan.\n\nRead the plan at `.lore/plans/utility-curves.md` for full context on Phase 3.\n\nThis is the most critical review. Phase 3 changes the scoring path for every game in the system.\n\nCheck:\n1. **`resolveBggRating` replacement**: Was it split correctly? Does `resolveBggRawValue` return raw native-scale values (no `* 2`)?\n2. **Scoring loop**: Does it follow the plan's sequence? Raw value → native scale → veto check → curve application → highlighting baseline → expanded breakdown entry → weighted sum?\n3. **Veto logic**: Does it continue processing all axes after veto? Is hypothetical score computed correctly? Is score set to 0?\n4. **`bggOriginal` semantics**: Does it now store raw BGG values (2.9 for weight, not 5.8)?\n5. **Backward compatibility**: Are personal axis scores identical to before? Are BGG communityRating scores identical? Do BGG complexity scores shift by the documented amount?\n6. **Expanded breakdown entries**: Do they include rawValue, effectiveRating, preferenceShape, curveAffected?\n7. **Test coverage**: Are all Phase 3 test cases from the plan covered?\n8. **Integration with curve engine**: Is the curve engine used correctly? Are defaults applied properly for axes without curve config?\n\nRun `bun run test` and `bun run typecheck`.\n\nReport all findings."
dependencies:
  - commission-Dalton-20260409-200818
linked_artifacts:
  - packages/daemon/src/services/fitness-service.ts

  - packages/daemon/tests/fitness-service.test.ts
  - packages/daemon/src/services/curve-engine.ts
  - packages/daemon/tests/services/fitness-service.test.ts
  - packages/daemon/tests/services/game-service-bgg.test.ts
  - packages/web/components/score-breakdown.tsx
  - packages/daemon/tests/fitness-service.test.ts
  - packages/daemon/src/services/curve-engine.ts
  - packages/daemon/tests/services/fitness-service.test.ts
  - packages/daemon/tests/services/game-service-bgg.test.ts
  - packages/web/components/score-breakdown.tsx
activity_timeline:
  - timestamp: 2026-04-10T03:08:27.470Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T03:08:27.471Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-10T03:30:51.840Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-10T03:30:51.843Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T03:30:51.862Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T03:30:57.632Z
    event: progress_report
    reason: "Starting Phase 3 review. Reading the utility curves plan and the referenced commission artifact."
  - timestamp: 2026-04-10T03:32:13.599Z
    event: progress_report
    reason: "Read all source files: fitness-service.ts, curve-engine.ts, both test files, shared types. Now checking the BGG integration tests and running the test suite."
  - timestamp: 2026-04-10T03:32:35.521Z
    event: progress_report
    reason: "Running typecheck and test suite as requested."
  - timestamp: 2026-04-10T03:36:44.251Z
    event: progress_report
    reason: "All source files reviewed, all findings recorded. Assembling final review. Unable to run test suite (read-only posture, no shell access). Dalton's commission reports 563 pass, 1 skip, 0 fail."
  - timestamp: 2026-04-10T03:37:17.142Z
    event: result_submitted
    reason: "# Phase 3 Review: Fitness Service Integration\n\n## Verdict\n\nThe implementation is structurally sound. The scoring loop follows the plan's sequence exactly. Curve engine integration is correct. Backward compatibility is well-tested with inline old-logic comparison. Two findings need attention before Phase 5/6 build on this work.\n\n## Findings (priority order)\n\n### 1. Live regression: web `bggOriginal` rendering produces nonsensical output\n\n**Severity**: Medium (user-facing, incorrect display)\n**File**: `packages/web/components/score-breakdown.tsx:40-44`\n\n```tsx\nBGG value: {entry.bggOriginal.toFixed(1)} → scaled {Math.round(entry.bggOriginal)}\n```\n\nPhase 3 changed `bggOriginal` from the `* 2` normalized value (e.g., 5.8) to the raw native-scale value (e.g., 2.9). This rendering now shows \"BGG value: 2.9 → scaled 3\" for weight overrides, which is meaningless. The plan's Phase 5 says to \"Delete the entire `breakdown-override-detail` div\" but the regression is live now.\n\n**Recommendation**: Either (a) remove the `breakdown-override-detail` div now as a preparatory cleanup, or (b) update it to show just \"BGG: {bggOriginal.toFixed(1)}\" without the broken \"scaled\" transformation. Either is a one-line change that prevents incorrect rendering until Phase 5 builds the proper replacement.\n\n### 2. Veto check compares mismatched scales on personal overrides of BGG axes\n\n**Severity**: Low-Medium (edge case, incorrect behavior when it triggers)\n**File**: `packages/daemon/src/services/fitness-service.ts:87-88`\n\nWhen a user overrides a BGG weight axis (native 1-5) with a personal rating (1-10), the veto check compares the 1-10 personal value against a threshold set in 1-5 native terms. A threshold of `{ direction: \"above\", threshold: 4 }` (meaning \"veto games with BGG weight above 4\") would trigger on a personal override of 5 (which on 1-10 is middling, not extreme). The code correctly adjusts `valueScale` for curve application (line 72) but applies no corresponding adjustment for the veto check.\n\nThe plan doesn't address this case. No test covers veto-with-override.\n\n**Recommendation**: The most intuitive fix is to skip the veto check when the value comes from a personal override. If a user overrides, they're asserting their judgment for that specific game; the veto (which guards against BGG-reported extremes) should not apply. Alternatively, check the original BGG value against the veto even when overridden. Either way, add a test for this case to document the chosen behavior.\n\n### 3. Missing test: veto with personal override of BGG axis\n\n**Severity**: Low (test gap)\n**File**: `packages/daemon/tests/fitness-service.test.ts`\n\nNo test constructs a BGG axis with a veto config AND a personal override on the same game. This is the only user-reachable scenario that exercises the scale mismatch in finding #2. Adding this test would either expose the bug or document the intended behavior.\n\n## Requirements Verification\n\n| Check | Status |\n|-------|--------|\n| `resolveBggRawValue` returns raw native-scale values (no `* 2`) | Pass |\n| Scoring loop follows plan sequence (7 steps in order) | Pass |\n| Veto continues processing all axes | Pass |\n| Hypothetical score computed correctly | Pass |\n| Score set to 0 when vetoed | Pass |\n| First triggering veto recorded in `vetoedBy` | Pass |\n| `bggOriginal` stores raw BGG value in native scale | Pass |\n| Personal axis scores identical to before | Pass |\n| BGG communityRating scores identical to before | Pass |\n| BGG weight scores shift by documented amount | Pass |\n| Expanded breakdown: rawValue, effectiveRating, preferenceShape, curveAffected | Pass |\n| Curve engine used correctly with proper defaults | Pass |\n| Override scale handling (personal 1-10 for curve application) | Pass |\n| All 8 plan test categories covered | Pass |\n| Backward compatibility test with inline old logic | Pass |\n\n## What I couldn't verify\n\nI don't have shell access (read-only posture). I could not run `bun run test` or `bun run typecheck`. Dalton's commission reports 563 pass, 1 skip, 0 fail, typecheck clean, lint clean. The test code reads correctly against the implementation."
  - timestamp: 2026-04-10T03:37:24.669Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All source files reviewed, all findings recorded. Assembling final review. Unable to run test suite (read-only posture, no shell access). Dalton's commission reports 563 pass, 1 skip, 0 fail."
projectName: shelf-judge
---
# Phase 3 Review: Fitness Service Integration

## Verdict

The implementation is structurally sound. The scoring loop follows the plan's sequence exactly. Curve engine integration is correct. Backward compatibility is well-tested with inline old-logic comparison. Two findings need attention before Phase 5/6 build on this work.

## Findings (priority order)

### 1. Live regression: web `bggOriginal` rendering produces nonsensical output

**Severity**: Medium (user-facing, incorrect display)
**File**: `packages/web/components/score-breakdown.tsx:40-44`

```tsx
BGG value: {entry.bggOriginal.toFixed(1)} → scaled {Math.round(entry.bggOriginal)}
```

Phase 3 changed `bggOriginal` from the `* 2` normalized value (e.g., 5.8) to the raw native-scale value (e.g., 2.9). This rendering now shows "BGG value: 2.9 → scaled 3" for weight overrides, which is meaningless. The plan's Phase 5 says to "Delete the entire `breakdown-override-detail` div" but the regression is live now.

**Recommendation**: Either (a) remove the `breakdown-override-detail` div now as a preparatory cleanup, or (b) update it to show just "BGG: {bggOriginal.toFixed(1)}" without the broken "scaled" transformation. Either is a one-line change that prevents incorrect rendering until Phase 5 builds the proper replacement.

### 2. Veto check compares mismatched scales on personal overrides of BGG axes

**Severity**: Low-Medium (edge case, incorrect behavior when it triggers)
**File**: `packages/daemon/src/services/fitness-service.ts:87-88`

When a user overrides a BGG weight axis (native 1-5) with a personal rating (1-10), the veto check compares the 1-10 personal value against a threshold set in 1-5 native terms. A threshold of `{ direction: "above", threshold: 4 }` (meaning "veto games with BGG weight above 4") would trigger on a personal override of 5 (which on 1-10 is middling, not extreme). The code correctly adjusts `valueScale` for curve application (line 72) but applies no corresponding adjustment for the veto check.

The plan doesn't address this case. No test covers veto-with-override.

**Recommendation**: The most intuitive fix is to skip the veto check when the value comes from a personal override. If a user overrides, they're asserting their judgment for that specific game; the veto (which guards against BGG-reported extremes) should not apply. Alternatively, check the original BGG value against the veto even when overridden. Either way, add a test for this case to document the chosen behavior.

### 3. Missing test: veto with personal override of BGG axis

**Severity**: Low (test gap)
**File**: `packages/daemon/tests/fitness-service.test.ts`

No test constructs a BGG axis with a veto config AND a personal override on the same game. This is the only user-reachable scenario that exercises the scale mismatch in finding #2. Adding this test would either expose the bug or document the intended behavior.

## Requirements Verification

| Check | Status |
|-------|--------|
| `resolveBggRawValue` returns raw native-scale values (no `* 2`) | Pass |
| Scoring loop follows plan sequence (7 steps in order) | Pass |
| Veto continues processing all axes | Pass |
| Hypothetical score computed correctly | Pass |
| Score set to 0 when vetoed | Pass |
| First triggering veto recorded in `vetoedBy` | Pass |
| `bggOriginal` stores raw BGG value in native scale | Pass |
| Personal axis scores identical to before | Pass |
| BGG communityRating scores identical to before | Pass |
| BGG weight scores shift by documented amount | Pass |
| Expanded breakdown: rawValue, effectiveRating, preferenceShape, curveAffected | Pass |
| Curve engine used correctly with proper defaults | Pass |
| Override scale handling (personal 1-10 for curve application) | Pass |
| All 8 plan test categories covered | Pass |
| Backward compatibility test with inline old logic | Pass |

## What I couldn't verify

I don't have shell access (read-only posture). I could not run `bun run test` or `bun run typecheck`. Dalton's commission reports 563 pass, 1 skip, 0 fail, typecheck clean, lint clean. The test code reads correctly against the implementation.

## Decisions

**Does `resolveBggRawValue` correctly replace `resolveBggRating` and return raw native-scale values?**
Correct. `resolveBggRawValue` (fitness-service.ts:24-35) returns `bggData.weight` directly for weight (no `* 2`) and `bggData.communityRating` for communityRating. The old `resolveBggRating` with `* 2` normalization is fully removed.
*Reasoning: Direct comparison: old code had `case "weight": return bggData.weight !== null ? bggData.weight * 2 : null`. New code has `case "weight": return bggData.weight`. The function is renamed to signal the semantic change. The curve engine now handles normalization via `applyPreferenceCurve`.*

**Does the scoring loop follow the plan's sequence? (raw value → native scale → veto check → curve application → highlighting baseline → expanded breakdown entry → weighted sum)**
Correct. The loop matches the plan's sequence exactly.
*Reasoning: Lines 57-82: determine raw value and source. Line 59: get native scale. Lines 87-99: veto check (before curve). Lines 101-108: apply preference curve. Lines 112-116: compute higher-is-better baseline for curveAffected. Lines 123-135: build expanded breakdown entry. Lines 137-141: accumulate weighted sum. All seven steps present in the specified order.*

**Does veto logic continue processing all axes after veto, compute hypothetical score correctly, and set score to 0?**
Correct. Veto does not short-circuit. Hypothetical score computed. Score set to 0.
*Reasoning: The veto check (line 87) uses `!vetoTriggered` guard to record only the first veto, but the loop continues for all axes. Effective ratings are computed unconditionally for all axes (lines 101-108, no veto guard). Hypothetical score at line 162: `weightedSum / weightSum`. Vetoed return at lines 164-173: `score: 0`, `hypotheticalScore` set, `vetoed: true`. Non-vetoed return at lines 176-184: `score: hypotheticalScore`, `hypotheticalScore: null`, `vetoed: false`.*

**Does `bggOriginal` now store raw BGG values in native scale?**
Correct. `bggOriginal` is set to `roundToOneDecimal(bggRawValue)` at line 75, where `bggRawValue` is the raw native-scale value from `resolveBggRawValue`.
*Reasoning: For weight, `bggRawValue` is `bggData.weight` (e.g., 2.9). So `bggOriginal` = 2.9, not 5.8. Test at fitness-service.test.ts:196 verifies: `expect(entry.bggOriginal).toBe(2.9)`. Existing integration test at game-service-bgg.test.ts:229 also updated: `expect(complexityBreakdown!.bggOriginal).toBe(2.5)` (was 5.0).*

**Are expanded breakdown entries complete with rawValue, effectiveRating, preferenceShape, curveAffected?**
All four fields present in breakdown entries (lines 131-134). Types match the shared interface.
*Reasoning: `rawValue: displayedRawValue` (rounded native-scale). `effectiveRating: displayedRating` (rounded post-curve 1-10). `preferenceShape: shape` (the resolved shape, defaulting to "higher-is-better"). `curveAffected` (boolean computed from > CURVE_AFFECTED_THRESHOLD comparison). All match `FitnessBreakdownEntry` in types.ts:101-104.*

**FINDING: Does the web UI handle the `bggOriginal` semantics change correctly?**
No. score-breakdown.tsx:40-44 still renders the old "BGG value: X → scaled Y" format using `Math.round(entry.bggOriginal)`. With new semantics (bggOriginal=2.9 for weight), this renders "BGG value: 2.9 → scaled 3" which is meaningless. This is a live regression for any user who overrides a BGG weight axis.
*Reasoning: The plan says Phase 5 will "Remove the broken 'scaled' rendering logic" (plan line 497). But Phase 3 changed the data semantics without updating the consumer. The rendering now displays incorrect information. While Phase 5 is the proper fix, this is a regression introduced by Phase 3 that affects users between Phase 3 and Phase 5 deployment. The plan's Phase 5 description even calls this "broken" and says to "Delete the entire breakdown-override-detail div." Phase 3 should either have left bggOriginal semantics unchanged (computing from raw in the breakdown only) or updated the rendering.*

**FINDING: Does the veto check handle personal overrides of BGG axes correctly when scales differ?**
Potential defect. When a user overrides a BGG weight axis (native 1-5) with a personal rating (1-10), the veto check at line 88 compares the 1-10 personal value against the threshold set in 1-5 native scale. A veto threshold of 4 (meaning "veto games with BGG weight above 4") would trigger on a personal override of 5 (which on 1-10 is middling, not extreme).
*Reasoning: fitness-service.ts:67 sets `valueScale = getNativeScale("personal", null)` for overrides, correctly adjusting the curve application scale. But the veto check at line 88 uses `rawValue` (the personal 1-10 value) against `axis.veto` (configured in native 1-5 terms). The plan doesn't address this case explicitly. The fix options are: (a) skip veto for overrides (user explicitly chose a rating), (b) scale-adjust the threshold for comparison, or (c) check the original BGG value against the veto instead of the override. Option (a) seems most intuitive: if a user overrides, they're asserting their judgment, and veto should respect that. The plan's scoring loop just says "Check veto (raw value vs axis.veto)" without distinguishing override from non-override cases.*

**FINDING: Is the personal override scale handling correct for curve application?**
Correct. The implementation correctly uses the personal scale (1-10) for curve application on overrides, not the BGG axis's native scale. This is a good design decision documented in the commission result.
*Reasoning: fitness-service.ts:72: `valueScale = getNativeScale("personal", null)` when `personalRating !== undefined`. This ensures a personal rating of 7 on a BGG weight axis is treated as 7 on a 1-10 scale for curve math, not 7 on a 1-5 scale (which would clamp/overflow). Technical Decision 6 in the plan confirms: "personal overrides are 1-10 and personal native scale is 1-10."*

**Does the test suite cover all Phase 3 test cases from the plan?**
All 8 planned test categories are covered. 38 new tests in fitness-service.test.ts plus updates to 2 existing test files.
*Reasoning: Plan's test list vs implementation:
1. "Full scoring with each preference shape" → lines 223-349 (higher/lower/sweet-spot/mixed)
2. "Veto triggers (score=0, hypothetical correct, breakdown complete)" → lines 352-527
3. "Curve-affected highlighting" → lines 529-617
4. "Missing curve config (default behavior)" → lines 620-647
5. "Removing a curve (back to higher-is-better)" → lines 649-670
6. "Multiple vetoes" → lines 487-517
7. "Backward compatibility test" → lines 672-791 (inline old logic comparison)
8. "curveAffected threshold boundary test" → lines 577-617 (0.5 not affected, 0.51 affected)
Additionally: "Veto before curve" tested indirectly via complete breakdown test (lines 409-436).*

**FINDING: Are the backward compatibility claims verifiable from the test code?**
Yes. The backward compatibility test (lines 672-791) inlines the old scoring logic and directly compares old vs new results. Personal axis scores: identical (line 736). communityRating scores: identical (line 747). BGG weight scores: differ by documented amount (lines 754-773). Full collection shift documented (lines 776-791).
*Reasoning: The test constructs `oldResolveBggRating` with the original `weight * 2` logic and `oldScore` with the original weighted average. It then compares against the new `fitnessService.calculateScore`. This is the gold-standard pattern for backward compatibility testing: inline the old logic, run both, assert the expected differences. The weight shift at 2.9 is explicitly documented: old=5.8, new=5.275 (rounded to 5.3).*

**FINDING: Are there any missing test cases not in the plan but important for Phase 3?**
One gap: no test for veto with override. The test suite doesn't verify what happens when a user overrides a BGG axis that has a veto configured. This intersects with the scale mismatch concern above.
*Reasoning: All veto tests use either pure personal axes or pure BGG axes. No test constructs a scenario where a BGG axis has a veto AND the game has a personal override for that axis. Given the scale mismatch concern, this test case would expose whether the behavior is intentional or accidental.*
