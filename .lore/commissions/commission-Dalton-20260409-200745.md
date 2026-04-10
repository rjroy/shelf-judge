---
title: "Commission: Utility Curves Phase 1+2: Shared Types and Curve Engine"
date: 2026-04-10
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 1 and Phase 2 of the utility curves plan at `.lore/plans/utility-curves.md`.\n\n## Phase 1: Shared Types and Validation\n\n**Files**: `packages/shared/src/types.ts`, `packages/shared/src/validation.ts`, `packages/shared/src/index.ts`\n\nAdd curve configuration types (PreferenceShape, ToleranceLevel, LeanDirection, VetoConfig, NativeScale). Extend the Axis interface with optional curve fields. Extend FitnessBreakdownEntry with rawValue, effectiveRating, preferenceShape, curveAffected. Extend FitnessResult with vetoed, vetoedBy, hypotheticalScore.\n\nUpdate CreateAxisSchema and UpdateAxisSchema with curve fields. Add cross-field validation refinements (idealValue required for sweet-spot, etc.). Re-export new types.\n\nWrite Zod schema validation tests.\n\n## Phase 2: Curve Engine (Pure Math)\n\n**Files**: `packages/daemon/src/services/curve-engine.ts` (new), `packages/daemon/tests/curve-engine.test.ts` (new)\n\nCreate a pure-function module following the `elo-engine.ts` pattern. Implement:\n- `getNativeScale(source, bggField)` — returns native scale ranges\n- `applyPreferenceCurve(rawValue, scale, shape, config)` — core curve function\n- `calibrateTolerance(tolerance)` — returns k exponent per tolerance level\n- `applyLean(baseK, leanDirection, side)` — asymmetric lean modifier\n- `checkVeto(rawValue, veto)` — veto threshold check\n- `computeHigherIsBetterEffective(rawValue, scale)` — reference baseline for highlighting\n\nThe plan has detailed math formulas, test cases, and calibration values. Follow them exactly. Heavy unit test coverage is required — see the plan's Phase 2 Tests section for the full list including fixed points, continuity, tolerance anchors, asymmetric lean, native scales, linear identity, BGG complexity correction, veto, and edge cases.\n\nRun `bun run test` and `bun run typecheck` before declaring complete."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T03:07:45.082Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T03:07:45.086Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
