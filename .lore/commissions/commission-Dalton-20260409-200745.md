---
title: "Commission: Utility Curves Phase 1+2: Shared Types and Curve Engine"
date: 2026-04-10
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 1 and Phase 2 of the utility curves plan at `.lore/plans/utility-curves.md`.\n\n## Phase 1: Shared Types and Validation\n\n**Files**: `packages/shared/src/types.ts`, `packages/shared/src/validation.ts`, `packages/shared/src/index.ts`\n\nAdd curve configuration types (PreferenceShape, ToleranceLevel, LeanDirection, VetoConfig, NativeScale). Extend the Axis interface with optional curve fields. Extend FitnessBreakdownEntry with rawValue, effectiveRating, preferenceShape, curveAffected. Extend FitnessResult with vetoed, vetoedBy, hypotheticalScore.\n\nUpdate CreateAxisSchema and UpdateAxisSchema with curve fields. Add cross-field validation refinements (idealValue required for sweet-spot, etc.). Re-export new types.\n\nWrite Zod schema validation tests.\n\n## Phase 2: Curve Engine (Pure Math)\n\n**Files**: `packages/daemon/src/services/curve-engine.ts` (new), `packages/daemon/tests/curve-engine.test.ts` (new)\n\nCreate a pure-function module following the `elo-engine.ts` pattern. Implement:\n- `getNativeScale(source, bggField)` — returns native scale ranges\n- `applyPreferenceCurve(rawValue, scale, shape, config)` — core curve function\n- `calibrateTolerance(tolerance)` — returns k exponent per tolerance level\n- `applyLean(baseK, leanDirection, side)` — asymmetric lean modifier\n- `checkVeto(rawValue, veto)` — veto threshold check\n- `computeHigherIsBetterEffective(rawValue, scale)` — reference baseline for highlighting\n\nThe plan has detailed math formulas, test cases, and calibration values. Follow them exactly. Heavy unit test coverage is required — see the plan's Phase 2 Tests section for the full list including fixed points, continuity, tolerance anchors, asymmetric lean, native scales, linear identity, BGG complexity correction, veto, and edge cases.\n\nRun `bun run test` and `bun run typecheck` before declaring complete."
dependencies: []
linked_artifacts:
  - packages/shared/src/types.ts

  - packages/shared/src/validation.ts
  - packages/shared/src/index.ts
  - packages/daemon/src/services/curve-engine.ts
  - packages/daemon/tests/curve-engine.test.ts
  - packages/shared/tests/validation.test.ts
  - packages/daemon/src/services/fitness-service.ts
  - packages/daemon/tests/tournament-service.test.ts
  - packages/shared/src/validation.ts
  - packages/shared/src/index.ts
  - packages/daemon/src/services/curve-engine.ts
  - packages/daemon/tests/curve-engine.test.ts
  - packages/shared/tests/validation.test.ts
  - packages/daemon/src/services/fitness-service.ts
  - packages/daemon/tests/tournament-service.test.ts
activity_timeline:
  - timestamp: 2026-04-10T03:07:45.082Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T03:07:45.086Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T03:07:45.133Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T03:08:18.582Z
    event: progress_report
    reason: "Read the plan, existing types, validation schemas, index, and elo-engine pattern. Starting Phase 1 implementation."
  - timestamp: 2026-04-10T03:14:34.173Z
    event: progress_report
    reason: "Phase 1 and Phase 2 complete. All 524 tests pass, typecheck clean, lint clean. Implementing final verification."
  - timestamp: 2026-04-10T03:14:56.540Z
    event: result_submitted
    reason: "Phase 1 and Phase 2 implemented. 524 tests pass (70 new), typecheck clean, lint clean.\n\n**Phase 1: Shared Types and Validation**\n\nAdded to `packages/shared/src/types.ts`:\n- New types: `PreferenceShape`, `ToleranceLevel`, `LeanDirection`, `VetoConfig`, `NativeScale`\n- Extended `Axis` with optional curve fields: `preferenceShape`, `idealValue`, `tolerance`, `leanDirection`, `veto`\n- Extended `FitnessBreakdownEntry` with: `rawValue`, `effectiveRating`, `preferenceShape`, `curveAffected`\n- Extended `FitnessResult` with: `vetoed`, `vetoedBy`, `hypotheticalScore`\n\nUpdated `packages/shared/src/validation.ts`:\n- `CreateAxisSchema` and `UpdateAxisSchema` now accept all curve config fields\n- Cross-field refinement: sweet-spot shape requires `idealValue`\n- Shared `VetoConfigSchema` and `curveFields` definition to avoid duplication\n\nUpdated `packages/shared/src/index.ts`: re-exports all new types.\n\nFixed downstream compile errors in `fitness-service.ts` (added backward-compatible defaults for new fields) and `tournament-service.test.ts` (added new FitnessResult fields to test fixture).\n\n19 new validation tests covering curve fields, sweet-spot/idealValue constraint, veto config, invalid values, and backward compatibility.\n\n**Phase 2: Curve Engine**\n\nCreated `packages/daemon/src/services/curve-engine.ts` (pure functions, no I/O):\n- `getNativeScale(source, bggField)`: returns native scale ranges\n- `calibrateTolerance(tolerance)`: returns k exponent per tolerance level\n- `applyLean(baseK, leanDirection, side)`: asymmetric lean modifier\n- `applyPreferenceCurve(rawValue, scale, shape, config)`: core curve function\n- `checkVeto(rawValue, veto)`: veto threshold check\n- `computeHigherIsBetterEffective(rawValue, scale)`: reference baseline for highlighting\n\nTolerance k values calibrated from spec anchors:\n- Flexible: k ≈ 0.369 (effective ≥ 7 at range/3)\n- Moderate: k ≈ 0.860 (effective 4-5 at range/3)\n- Strict: k ≈ 1.631 (effective ≤ 2.5 at range/3)\n\n53 curve engine tests covering: fixed points, linear identity, BGG complexity correction, continuity/monotonicity (100-point sampling), tolerance anchors on both BGG and personal scales, asymmetric lean, veto logic, edge cases (zero-range scales, ideal at boundaries), and exported constants."
  - timestamp: 2026-04-10T03:14:59.606Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Phase 1 and Phase 2 complete. All 524 tests pass, typecheck clean, lint clean. Implementing final verification."
projectName: shelf-judge
---
Phase 1 and Phase 2 implemented. 524 tests pass (70 new), typecheck clean, lint clean.

**Phase 1: Shared Types and Validation**

Added to `packages/shared/src/types.ts`:
- New types: `PreferenceShape`, `ToleranceLevel`, `LeanDirection`, `VetoConfig`, `NativeScale`
- Extended `Axis` with optional curve fields: `preferenceShape`, `idealValue`, `tolerance`, `leanDirection`, `veto`
- Extended `FitnessBreakdownEntry` with: `rawValue`, `effectiveRating`, `preferenceShape`, `curveAffected`
- Extended `FitnessResult` with: `vetoed`, `vetoedBy`, `hypotheticalScore`

Updated `packages/shared/src/validation.ts`:
- `CreateAxisSchema` and `UpdateAxisSchema` now accept all curve config fields
- Cross-field refinement: sweet-spot shape requires `idealValue`
- Shared `VetoConfigSchema` and `curveFields` definition to avoid duplication

Updated `packages/shared/src/index.ts`: re-exports all new types.

Fixed downstream compile errors in `fitness-service.ts` (added backward-compatible defaults for new fields) and `tournament-service.test.ts` (added new FitnessResult fields to test fixture).

19 new validation tests covering curve fields, sweet-spot/idealValue constraint, veto config, invalid values, and backward compatibility.

**Phase 2: Curve Engine**

Created `packages/daemon/src/services/curve-engine.ts` (pure functions, no I/O):
- `getNativeScale(source, bggField)`: returns native scale ranges
- `calibrateTolerance(tolerance)`: returns k exponent per tolerance level
- `applyLean(baseK, leanDirection, side)`: asymmetric lean modifier
- `applyPreferenceCurve(rawValue, scale, shape, config)`: core curve function
- `checkVeto(rawValue, veto)`: veto threshold check
- `computeHigherIsBetterEffective(rawValue, scale)`: reference baseline for highlighting

Tolerance k values calibrated from spec anchors:
- Flexible: k ≈ 0.369 (effective ≥ 7 at range/3)
- Moderate: k ≈ 0.860 (effective 4-5 at range/3)
- Strict: k ≈ 1.631 (effective ≤ 2.5 at range/3)

53 curve engine tests covering: fixed points, linear identity, BGG complexity correction, continuity/monotonicity (100-point sampling), tolerance anchors on both BGG and personal scales, asymmetric lean, veto logic, edge cases (zero-range scales, ideal at boundaries), and exported constants.
