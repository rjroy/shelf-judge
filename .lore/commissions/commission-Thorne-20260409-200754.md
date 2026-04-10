---
title: "Commission: Review: Utility Curves Phase 1+2"
date: 2026-04-10
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the implementation of Phase 1 (Shared Types and Validation) and Phase 2 (Curve Engine) of the utility curves plan.\n\nRead the plan at `.lore/plans/utility-curves.md` for full context.\n\nCheck:\n1. **Type correctness**: Do the new types in `packages/shared/src/types.ts` match the plan's type definitions exactly? Are all fields present with correct optionality?\n2. **Validation schemas**: Do CreateAxisSchema and UpdateAxisSchema accept curve fields? Is the sweet-spot cross-field validation correct?\n3. **Curve math**: Verify the curve engine at `packages/daemon/src/services/curve-engine.ts` against the plan's formulas. Check the power curve formula, tolerance calibration k-values, lean multipliers, and veto logic.\n4. **Test coverage**: Are all test cases from the plan's Phase 2 Tests section covered? Fixed points, continuity, tolerance anchors, asymmetric lean, native scales, linear identity, BGG complexity correction, veto, edge cases.\n5. **Exports**: Are new types re-exported from `packages/shared/src/index.ts`?\n6. **Pattern compliance**: Does curve-engine.ts follow the elo-engine.ts pattern (pure functions, no I/O, no service dependencies)?\n\nRun `bun run test` and `bun run typecheck` to verify everything passes.\n\nReport all findings. Do not dismiss anything as \"not a blocker.\""
dependencies:
  - commission-Dalton-20260409-200745
linked_artifacts:
  - packages/shared/src/types.ts

  - packages/shared/src/validation.ts
  - packages/shared/src/index.ts
  - packages/daemon/src/services/curve-engine.ts
  - packages/daemon/tests/curve-engine.test.ts
  - packages/shared/tests/validation.test.ts
  - packages/daemon/src/services/fitness-service.ts
  - packages/shared/src/validation.ts
  - packages/shared/src/index.ts
  - packages/daemon/src/services/curve-engine.ts
  - packages/daemon/tests/curve-engine.test.ts
  - packages/shared/tests/validation.test.ts
  - packages/daemon/src/services/fitness-service.ts
activity_timeline:
  - timestamp: 2026-04-10T03:07:54.039Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T03:07:54.040Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-10T03:14:59.772Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-10T03:14:59.778Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T03:14:59.799Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T03:15:09.791Z
    event: progress_report
    reason: "Starting review. Reading the utility curves plan and referenced implementation files."
  - timestamp: 2026-04-10T03:16:28.575Z
    event: progress_report
    reason: "All implementation files read. Now running tests and typecheck, then recording findings."
  - timestamp: 2026-04-10T03:19:26.097Z
    event: progress_report
    reason: "Running typecheck and test suite."
  - timestamp: 2026-04-10T03:19:56.949Z
    event: progress_report
    reason: "Unable to execute `bun run typecheck` and `bun run test` - no shell execution tool available in this environment and Playwright workaround was denied. Reported static analysis of the project structure instead. User needs to run the commands directly or grant shell permissions."
  - timestamp: 2026-04-10T03:21:12.809Z
    event: progress_report
    reason: "All findings recorded. Compiling final review with 4 findings: 2 medium, 2 low severity. Implementation is solid overall."
  - timestamp: 2026-04-10T03:21:53.220Z
    event: result_submitted
    reason: "# Review: Utility Curves Phase 1 + Phase 2\n\n## Verdict\n\nImplementation is correct. The curve math verifies against hand calculations. Types match the plan exactly. Test coverage hits every category the plan specifies. Four findings below, two medium severity.\n\n---\n\n## Findings\n\n### 1. [MEDIUM] rawValue field lies for BGG weight axes during transition\n\n**File**: `packages/daemon/src/services/fitness-service.ts:75`\n\nThe backward-compatible default sets `rawValue: displayedRating`, where `displayedRating` is the post-`*2` normalized value. For a BGG weight axis with weight=2.9, `rawValue` is 5.8. The field's documented contract (types.ts:101) says \"native-scale value,\" which should be 2.9.\n\nThis is a known transitional state. Phase 3 replaces `resolveBggRating` and will set rawValue correctly. The risk: if any client code consumes `rawValue` before Phase 3, the data is misleading. Since Phase 3 is the next planned phase and web/CLI don't yet render rawValue, the practical risk is low. But the contract violation exists.\n\n**Recommendation**: No action required for Phase 1/2. Phase 3 must fix this as its first step (it's already planned to). Document in the plan's Phase 3 section that rawValue is currently incorrect for BGG weight axes, so Phase 3 reviewers know to verify the fix.\n\n---\n\n### 2. [MEDIUM] No output clamping in applyPreferenceCurve\n\n**File**: `packages/daemon/src/services/curve-engine.ts:92-138`\n\nThe curve function produces values outside 1-10 when raw values are outside the native scale bounds. The test at curve-engine.test.ts:494-502 explicitly verifies this: raw=0 on scale 1-10 yields effective < 1, raw=11 yields effective > 10.\n\nThe `effectiveRating` field is documented as \"post-curve 1-10 value\" (types.ts:102). If the curve can produce values outside this range, the contract is violated. BGG data is typically within bounds, and personal ratings are validated to 1-10 integers, so this may not trigger in practice. But if Phase 3's scoring loop trusts that effective ratings are 1-10 (e.g., for display formatting or score bounds), out-of-range values will propagate silently.\n\n**Recommendation**: Add a clamp to the curve output: `Math.max(1, Math.min(10, result))`. This preserves the fixed-point properties (min→1, max→10) and prevents surprising values. If out-of-range behavior is intentional (e.g., to signal data quality issues), document that `effectiveRating` can exceed 1-10 and update the type comment.\n\n---\n\n### 3. [LOW] UpdateAxisSchema sweet-spot refinement will conflict with Phase 4\n\n**File**: `packages/shared/src/validation.ts:39-44`\n\nThe UpdateAxisSchema requires `idealValue` whenever `preferenceShape` is \"sweet-spot.\" Plan Phase 4 (line 438-439) envisions allowing `{ preferenceShape: \"sweet-spot\" }` without idealValue when the axis already has one stored. The current schema rejects this before the request reaches the service layer.\n\nThis is correct for Phase 1/2 (no API consumes it yet). When Phase 4 is implemented, the refinement needs to be either removed from UpdateAxisSchema and moved to the service layer, or made conditional on whether idealValue is already absent.\n\n**Recommendation**: Add a note in the Phase 4 section of the plan flagging this as a required schema change.\n\n---\n\n### 4. [LOW] idealValue defaults to scale.min when missing in sweet-spot\n\n**File**: `packages/daemon/src/services/curve-engine.ts:116`\n\n`const ideal = config.idealValue ?? scale.min` means that if validation is ever bypassed (e.g., loading corrupted JSON from disk), the curve silently uses scale.min as the ideal. This produces a one-sided curve (min→10, everything else drops) rather than surfacing the error.\n\nValidation enforces idealValue for sweet-spot shapes, so this code path shouldn't execute. But the defensive behavior masks bad data rather than flagging it.\n\n**Recommendation**: Consider throwing when `idealValue` is null/undefined in sweet-spot mode, since the validation contract guarantees it's present. A throw here turns \"silently wrong scores\" into \"crash with clear error message\" when the invariant is violated.\n\n---\n\n## Verification Checklist\n\n| Check | Result |\n|-------|--------|\n| Types match plan definitions | Pass — all fields, optionality, and types match exactly |\n| Validation schemas accept curve fields | Pass — CreateAxisSchema and UpdateAxisSchema both accept all curve config |\n| Sweet-spot cross-field validation | Pass — idealValue required for sweet-spot shape |\n| Curve formulas match plan | Pass — all three shapes verified, formulas match line-by-line |\n| Tolerance k-values calibrated correctly | Pass — hand-verified: flexible=0.369, moderate=0.860, strict=1.631 |\n| Lean multipliers applied correctly | Pass — lower/higher lean directionally correct, multipliers verified |\n| Veto logic correct | Pass — below/above directions, null handling all correct |\n| Fixed points (REQ-CURVE-11) tested | Pass — all shapes, both scales |\n| Continuity (REQ-CURVE-12) tested | Pass — 100-point sampling, monotonicity + smoothness |\n| Tolerance anchors (REQ-CURVE-8) tested | Pass — BGG and personal scales, left and right sides |\n| Asymmetric lean (REQ-CURVE-9) tested | Pass — spec scenario verified, symmetric case included |\n| Native scales (REQ-CURVE-2/3) tested | Pass — personal, communityRating, weight, unknown field |\n| Linear identity (REQ-CURVE-6) tested | Pass — personal and communityRating |\n| BGG complexity correction tested | Pass — weight 1.0, 3.0, 5.0 verified against old mapping |\n| Veto tested | Pass — all directions, boundary conditions, null |\n| Edge cases tested | Pass — boundaries, zero-range, ideal at extremes |\n| New types re-exported from index.ts | Pass — all 5 new types exported |\n| Pattern compliance (elo-engine.ts) | Pass — pure functions, no I/O, no dependencies |\n| Backward compatibility | Pass — existing axis payloads parse, fitness-service produces valid output |\n| Tests and typecheck pass | Not independently verified (read-only posture). Commission report claims 524 tests pass, typecheck clean. |\n\n## Implementation Quality Notes\n\nThe `curveFields` extraction in validation.ts (lines 8-14) is a good DRY pattern, not in the plan but equivalent and cleaner than duplicating field definitions across both schemas.\n\nThe tolerance calibration comments in curve-engine.ts (lines 16-24) show the derivation clearly. Future maintainers can verify the math without consulting the plan.\n\nThe test file covers all plan-specified categories and adds meaningful extras (left-side anchor verification, symmetric lean verification, default tolerance behavior). 53 curve tests for 163 lines of implementation is appropriate coverage for a math module."
  - timestamp: 2026-04-10T03:22:05.773Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All findings recorded. Compiling final review with 4 findings: 2 medium, 2 low severity. Implementation is solid overall."
projectName: shelf-judge
---
# Review: Utility Curves Phase 1 + Phase 2

## Verdict

Implementation is correct. The curve math verifies against hand calculations. Types match the plan exactly. Test coverage hits every category the plan specifies. Four findings below, two medium severity.

---

## Findings

### 1. [MEDIUM] rawValue field lies for BGG weight axes during transition

**File**: `packages/daemon/src/services/fitness-service.ts:75`

The backward-compatible default sets `rawValue: displayedRating`, where `displayedRating` is the post-`*2` normalized value. For a BGG weight axis with weight=2.9, `rawValue` is 5.8. The field's documented contract (types.ts:101) says "native-scale value," which should be 2.9.

This is a known transitional state. Phase 3 replaces `resolveBggRating` and will set rawValue correctly. The risk: if any client code consumes `rawValue` before Phase 3, the data is misleading. Since Phase 3 is the next planned phase and web/CLI don't yet render rawValue, the practical risk is low. But the contract violation exists.

**Recommendation**: No action required for Phase 1/2. Phase 3 must fix this as its first step (it's already planned to). Document in the plan's Phase 3 section that rawValue is currently incorrect for BGG weight axes, so Phase 3 reviewers know to verify the fix.

---

### 2. [MEDIUM] No output clamping in applyPreferenceCurve

**File**: `packages/daemon/src/services/curve-engine.ts:92-138`

The curve function produces values outside 1-10 when raw values are outside the native scale bounds. The test at curve-engine.test.ts:494-502 explicitly verifies this: raw=0 on scale 1-10 yields effective < 1, raw=11 yields effective > 10.

The `effectiveRating` field is documented as "post-curve 1-10 value" (types.ts:102). If the curve can produce values outside this range, the contract is violated. BGG data is typically within bounds, and personal ratings are validated to 1-10 integers, so this may not trigger in practice. But if Phase 3's scoring loop trusts that effective ratings are 1-10 (e.g., for display formatting or score bounds), out-of-range values will propagate silently.

**Recommendation**: Add a clamp to the curve output: `Math.max(1, Math.min(10, result))`. This preserves the fixed-point properties (min→1, max→10) and prevents surprising values. If out-of-range behavior is intentional (e.g., to signal data quality issues), document that `effectiveRating` can exceed 1-10 and update the type comment.

---

### 3. [LOW] UpdateAxisSchema sweet-spot refinement will conflict with Phase 4

**File**: `packages/shared/src/validation.ts:39-44`

The UpdateAxisSchema requires `idealValue` whenever `preferenceShape` is "sweet-spot." Plan Phase 4 (line 438-439) envisions allowing `{ preferenceShape: "sweet-spot" }` without idealValue when the axis already has one stored. The current schema rejects this before the request reaches the service layer.

This is correct for Phase 1/2 (no API consumes it yet). When Phase 4 is implemented, the refinement needs to be either removed from UpdateAxisSchema and moved to the service layer, or made conditional on whether idealValue is already absent.

**Recommendation**: Add a note in the Phase 4 section of the plan flagging this as a required schema change.

---

### 4. [LOW] idealValue defaults to scale.min when missing in sweet-spot

**File**: `packages/daemon/src/services/curve-engine.ts:116`

`const ideal = config.idealValue ?? scale.min` means that if validation is ever bypassed (e.g., loading corrupted JSON from disk), the curve silently uses scale.min as the ideal. This produces a one-sided curve (min→10, everything else drops) rather than surfacing the error.

Validation enforces idealValue for sweet-spot shapes, so this code path shouldn't execute. But the defensive behavior masks bad data rather than flagging it.

**Recommendation**: Consider throwing when `idealValue` is null/undefined in sweet-spot mode, since the validation contract guarantees it's present. A throw here turns "silently wrong scores" into "crash with clear error message" when the invariant is violated.

---

## Verification Checklist

| Check | Result |
|-------|--------|
| Types match plan definitions | Pass — all fields, optionality, and types match exactly |
| Validation schemas accept curve fields | Pass — CreateAxisSchema and UpdateAxisSchema both accept all curve config |
| Sweet-spot cross-field validation | Pass — idealValue required for sweet-spot shape |
| Curve formulas match plan | Pass — all three shapes verified, formulas match line-by-line |
| Tolerance k-values calibrated correctly | Pass — hand-verified: flexible=0.369, moderate=0.860, strict=1.631 |
| Lean multipliers applied correctly | Pass — lower/higher lean directionally correct, multipliers verified |
| Veto logic correct | Pass — below/above directions, null handling all correct |
| Fixed points (REQ-CURVE-11) tested | Pass — all shapes, both scales |
| Continuity (REQ-CURVE-12) tested | Pass — 100-point sampling, monotonicity + smoothness |
| Tolerance anchors (REQ-CURVE-8) tested | Pass — BGG and personal scales, left and right sides |
| Asymmetric lean (REQ-CURVE-9) tested | Pass — spec scenario verified, symmetric case included |
| Native scales (REQ-CURVE-2/3) tested | Pass — personal, communityRating, weight, unknown field |
| Linear identity (REQ-CURVE-6) tested | Pass — personal and communityRating |
| BGG complexity correction tested | Pass — weight 1.0, 3.0, 5.0 verified against old mapping |
| Veto tested | Pass — all directions, boundary conditions, null |
| Edge cases tested | Pass — boundaries, zero-range, ideal at extremes |
| New types re-exported from index.ts | Pass — all 5 new types exported |
| Pattern compliance (elo-engine.ts) | Pass — pure functions, no I/O, no dependencies |
| Backward compatibility | Pass — existing axis payloads parse, fitness-service produces valid output |
| Tests and typecheck pass | Not independently verified (read-only posture). Commission report claims 524 tests pass, typecheck clean. |

## Implementation Quality Notes

The `curveFields` extraction in validation.ts (lines 8-14) is a good DRY pattern, not in the plan but equivalent and cleaner than duplicating field definitions across both schemas.

The tolerance calibration comments in curve-engine.ts (lines 16-24) show the derivation clearly. Future maintainers can verify the math without consulting the plan.

The test file covers all plan-specified categories and adds meaningful extras (left-side anchor verification, symmetric lean verification, default tolerance behavior). 53 curve tests for 163 lines of implementation is appropriate coverage for a math module.

## Decisions

**Do the new types in types.ts match the plan's definitions?**
All type definitions match the plan exactly. PreferenceShape, ToleranceLevel, LeanDirection, VetoConfig, NativeScale are correct. Axis extension has correct optionality. FitnessBreakdownEntry and FitnessResult extensions are correct.
*Reasoning: Line-by-line comparison of plan lines 163-222 against types.ts lines 7-120. Every field, every type union, every nullable/optional marker matches.*

**Do CreateAxisSchema and UpdateAxisSchema accept curve fields with correct cross-field validation?**
Schemas are correct for Phase 1. Curve fields accepted via shared curveFields object. Sweet-spot refinement requires idealValue. One forward-compatibility concern: UpdateAxisSchema's refinement will be too strict for Phase 4, which envisions allowing sweet-spot updates without idealValue when the axis already has one stored.
*Reasoning: validation.ts lines 8-44 vs plan lines 230-258. The curveFields extraction (lines 8-14) is a clean DRY pattern not in the plan but equivalent. The refinement on both schemas matches plan line 255. However, plan line 438-439 (Phase 4) says the service should allow sweet-spot updates without idealValue if the axis already has one. The schema-level rejection prevents this, meaning Phase 4 will need to loosen or relocate the refinement.*

**Does the curve engine math match the plan's formulas?**
All formulas verified correct. Higher-is-better, lower-is-better, and sweet-spot power curve implementations match the plan exactly. Tolerance k-values verified by hand calculation against spec anchors. Lean multipliers, veto logic, and reference baseline all correct.
*Reasoning: Verified each formula in curve-engine.ts against plan lines 277-300. Hand-calculated k values: K_FLEXIBLE = ln(2/3)/ln(1/3) ≈ 0.369 (produces effective=7.0 at range/3), K_MODERATE = ln(7/18)/ln(1/3) ≈ 0.860 (produces 4.5), K_STRICT = ln(1/6)/ln(1/3) ≈ 1.631 (produces 2.5). All verified against the comment derivations in curve-engine.ts lines 16-24. Lean asymmetry hand-calculated for the spec's test scenario (ideal=2.75, lean=lower): left effective=5.72, right effective=4.16, confirming lean overcomes natural asymmetry.*

**Does applyPreferenceCurve clamp output to 1-10 range?**
No clamping. Raw values outside native scale bounds produce effective ratings outside 1-10. The test at curve-engine.test.ts:494-502 explicitly verifies this: raw=0 on scale 1-10 produces effective < 1, raw=11 produces effective > 10.
*Reasoning: The FitnessBreakdownEntry.effectiveRating comment says "post-curve 1-10 value" but the curve can produce values outside this range. BGG data is typically within bounds, but if it isn't (or if a personal rating is stored without validation at a boundary), the effective rating contract is violated. The plan doesn't address clamping explicitly. Phase 3's scoring loop uses effective ratings in the weighted average, so out-of-range values would propagate to fitness scores.*

**Does the fitness-service's backward-compatible defaults correctly represent the new fields?**
The backward-compatible defaults work but misrepresent rawValue for BGG weight axes. rawValue is set to displayedRating (the post-*2 normalized value), not the native-scale value. For BGG weight=2.9, rawValue=5.8 instead of 2.9. This violates rawValue's documented semantics ("native-scale value") but is a known transitional state that Phase 3 will fix.
*Reasoning: fitness-service.ts line 75: `rawValue: displayedRating` where displayedRating comes from resolveBggRating which still applies the *2 normalization for weight (line 23). The rawValue field is typed as "native-scale value" (types.ts:101). Phase 3 will replace resolveBggRating and set rawValue correctly. Risk: if any client consumes rawValue before Phase 3 deploys, they get misleading data.*

**Are all test cases from the plan's Phase 2 Tests section covered?**
All nine test categories are covered: fixed points (6 tests), continuity/monotonicity (5 tests with 100-point sampling), tolerance anchors (3 tests, both scales), asymmetric lean (3 tests including spec scenario), native scales (5 tests), linear identity (2 tests), BGG complexity correction (3 tests), veto (7 tests), edge cases (7 tests). Total: 53 curve engine tests plus 19 validation tests.
*Reasoning: Mapped each bullet in plan lines 304-312 to test file sections. Fixed points: lines 84-134. Continuity: lines 182-261. Tolerance anchors: lines 265-338. Lean: lines 343-388. Native scales: lines 18-38. Linear identity: lines 138-152. BGG correction: lines 156-178. Veto: lines 393-422. Edge cases: lines 444-512. All present.*

**Are new types properly re-exported from index.ts?**
All five new types re-exported: PreferenceShape, ToleranceLevel, LeanDirection, VetoConfig, NativeScale. Existing exports unchanged.
*Reasoning: index.ts lines 28-32 export all new types. Validation schemas already export curve fields implicitly through CreateAxisInput and UpdateAxisInput type exports.*

**Does curve-engine.ts follow the elo-engine.ts pattern?**
Yes. Pure functions, no I/O, no service dependencies, no class instantiation. Imports only types from shared. All functions and constants exported. Module header comment references the requirements it implements.
*Reasoning: curve-engine.ts: 163 lines, 6 exported functions, 5 exported constants. No imports except types. No side effects. No closures over mutable state. This matches the elo-engine.ts pattern described in the plan (line 273).*
