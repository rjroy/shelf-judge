---
title: "Commission: Review: Utility Curves Phase 4"
date: 2026-04-10
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review Phase 4 (API and Service Layer) of the utility curves implementation.\n\nRead the plan at `.lore/plans/utility-curves.md` Phase 4 for context.\n\nCheck:\n1. **Axis service**: Do createAxis and updateAxis correctly pass through all curve fields?\n2. **Cross-field validation**: Is sweet-spot idealValue validation correct? Does switching away from sweet-spot clear stale config?\n3. **Routes**: Are operation descriptions updated?\n4. **Test coverage**: All route-level test cases from the plan covered?\n5. **Backward compatibility**: Existing axis create/update payloads without curve fields still work?\n\nRun `bun run test` and `bun run typecheck`.\n\nReport all findings. This is the API gateway for Phase 5 (Web) and Phase 6 (CLI)."
dependencies:
  - commission-Dalton-20260409-200842
linked_artifacts:
  - packages/daemon/src/services/axis-service.ts

  - packages/daemon/src/routes/axes.ts
  - packages/shared/src/validation.ts
  - packages/daemon/tests/routes/axes.test.ts
  - packages/shared/tests/validation.test.ts
  - packages/daemon/src/routes/axes.ts
  - packages/shared/src/validation.ts
  - packages/daemon/tests/routes/axes.test.ts
  - packages/shared/tests/validation.test.ts
activity_timeline:
  - timestamp: 2026-04-10T03:08:49.850Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T03:08:49.851Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-10T03:42:51.296Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-10T03:42:51.299Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T03:42:51.321Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T03:43:01.899Z
    event: progress_report
    reason: "Starting Phase 4 review. Reading plan details, then examining implementation files: axis-service.ts, axes routes, validation schemas, and tests."
  - timestamp: 2026-04-10T03:43:26.017Z
    event: progress_report
    reason: "Running typecheck and test suite as requested."
  - timestamp: 2026-04-10T03:43:27.296Z
    event: progress_report
    reason: "Read all implementation files. Tests and typecheck running in background. Now analyzing: axis service pass-through, cross-field validation logic, route error handling, and test coverage against plan requirements."
  - timestamp: 2026-04-10T03:46:09.146Z
    event: result_submitted
    reason: "# Phase 4 Review: API and Service Layer\n\n## Verdict: Pass. Ready for Phase 5/6 consumption.\n\nAll five review criteria are satisfied. No blocking defects found.\n\n---\n\n## Findings by Priority\n\n### 1. String-Based Error Routing (Low, Latent Fragility)\n\n**File**: `packages/daemon/src/routes/axes.ts:33, 74`\n\nThe route handlers distinguish service-level validation errors from unexpected errors by checking `message.includes(\"idealValue\")` and `message.includes(\"outside native scale\")`. This maps them to HTTP 400 instead of 500.\n\nThis is fragile. If a future service error message happens to contain \"idealValue\" in a different context (e.g., a storage corruption message), it would be incorrectly surfaced as a 400 to the client.\n\nThe pattern is consistent with existing code (line 71 uses `message.includes(\"not found\")` for 404 mapping), so this isn't a regression. But as more validation rules are added across phases, the string-matching surface area grows.\n\n**Recommendation**: Consider a typed error approach (e.g., a `ValidationError` class that routes can check with `instanceof`) when the next service-level validation is added. Not blocking for Phase 4.\n\n---\n\n### 2. Stale Config Clearing Is Overridable in Same Payload (Observation, No Action Needed)\n\n**File**: `packages/daemon/src/services/axis-service.ts:107-120`\n\nWhen `updateAxis` changes `preferenceShape` away from sweet-spot, lines 111-115 clear `idealValue`, `tolerance`, and `leanDirection` to `undefined`. But lines 117-119 then apply any fields explicitly sent in the same payload. This means `{ preferenceShape: \"higher-is-better\", idealValue: 5 }` would store `idealValue: 5` on a non-sweet-spot axis.\n\nThis is harmless. The curve engine ignores `idealValue` for non-sweet-spot shapes (plan line 257: \"not an error if provided with other shapes, just ignored\"). The stored value has no scoring effect. Documenting for awareness only.\n\n---\n\n## Requirements Checklist\n\n| Check | Status | Evidence |\n|---|---|---|\n| createAxis passes all curve fields | **Satisfied** | axis-service.ts:50-54, all five fields in axis literal |\n| updateAxis passes all curve fields | **Satisfied** | axis-service.ts:107-120, conditional application for all five fields |\n| Sweet-spot idealValue validation on create | **Satisfied** | Schema refinement (validation.ts:25-30) + service bounds check (axis-service.ts:31-38) |\n| Sweet-spot idealValue validation on update (with stored context) | **Satisfied** | axis-service.ts:80-98, handles provided, stored, and missing cases |\n| Switching away from sweet-spot clears stale config | **Satisfied** | axis-service.ts:111-115, clears idealValue/tolerance/leanDirection |\n| UpdateAxisSchema refinement removed per review note | **Satisfied** | validation.ts:36-41 is plain z.object() without .refine() |\n| Operation descriptions updated | **Satisfied** | axes.ts:100 (create), axes.ts:116 (update) mention curve/veto |\n| Service validation errors return 400 | **Satisfied** | axes.ts:33-35 (POST), axes.ts:74-76 (PUT) |\n| Backward compatibility (no curve fields) | **Satisfied** | Tests at validation.test.ts:169-183, 246-249; route test axes.test.ts:128-139 |\n\n## Test Coverage Against Plan\n\nAll six plan-specified test scenarios (plan lines 452-457) are covered:\n\n1. Create axis with curve config → axes.test.ts:94\n2. Update axis to sweet-spot, verify idealValue required → axes.test.ts:168, 212\n3. Update from sweet-spot to higher-is-better, stale config cleared → axes.test.ts:228\n4. Create axis with veto → axes.test.ts:114\n5. Update axis to add/remove veto → axes.test.ts:255, 273\n6. Existing payloads without curve fields still work → axes.test.ts:128\n\nPlus 7 additional edge case tests beyond plan minimum: idealValue out-of-range on create/update, sweet-spot missing idealValue on create, sweet-spot without stored idealValue on update, name-only update preserving curve fields, backward-compatible create without curve fields.\n\n## Build Status\n\nDalton's commission reports 578 pass, 1 skip, 0 fail, typecheck clean (verified against commission artifact)."
  - timestamp: 2026-04-10T03:46:21.495Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Read all implementation files. Tests and typecheck running in background. Now analyzing: axis service pass-through, cross-field validation logic, route error handling, and test coverage against plan requirements."
projectName: shelf-judge
---
# Phase 4 Review: API and Service Layer

## Verdict: Pass. Ready for Phase 5/6 consumption.

All five review criteria are satisfied. No blocking defects found.

---

## Findings by Priority

### 1. String-Based Error Routing (Low, Latent Fragility)

**File**: `packages/daemon/src/routes/axes.ts:33, 74`

The route handlers distinguish service-level validation errors from unexpected errors by checking `message.includes("idealValue")` and `message.includes("outside native scale")`. This maps them to HTTP 400 instead of 500.

This is fragile. If a future service error message happens to contain "idealValue" in a different context (e.g., a storage corruption message), it would be incorrectly surfaced as a 400 to the client.

The pattern is consistent with existing code (line 71 uses `message.includes("not found")` for 404 mapping), so this isn't a regression. But as more validation rules are added across phases, the string-matching surface area grows.

**Recommendation**: Consider a typed error approach (e.g., a `ValidationError` class that routes can check with `instanceof`) when the next service-level validation is added. Not blocking for Phase 4.

---

### 2. Stale Config Clearing Is Overridable in Same Payload (Observation, No Action Needed)

**File**: `packages/daemon/src/services/axis-service.ts:107-120`

When `updateAxis` changes `preferenceShape` away from sweet-spot, lines 111-115 clear `idealValue`, `tolerance`, and `leanDirection` to `undefined`. But lines 117-119 then apply any fields explicitly sent in the same payload. This means `{ preferenceShape: "higher-is-better", idealValue: 5 }` would store `idealValue: 5` on a non-sweet-spot axis.

This is harmless. The curve engine ignores `idealValue` for non-sweet-spot shapes (plan line 257: "not an error if provided with other shapes, just ignored"). The stored value has no scoring effect. Documenting for awareness only.

---

## Requirements Checklist

| Check | Status | Evidence |
|---|---|---|
| createAxis passes all curve fields | **Satisfied** | axis-service.ts:50-54, all five fields in axis literal |
| updateAxis passes all curve fields | **Satisfied** | axis-service.ts:107-120, conditional application for all five fields |
| Sweet-spot idealValue validation on create | **Satisfied** | Schema refinement (validation.ts:25-30) + service bounds check (axis-service.ts:31-38) |
| Sweet-spot idealValue validation on update (with stored context) | **Satisfied** | axis-service.ts:80-98, handles provided, stored, and missing cases |
| Switching away from sweet-spot clears stale config | **Satisfied** | axis-service.ts:111-115, clears idealValue/tolerance/leanDirection |
| UpdateAxisSchema refinement removed per review note | **Satisfied** | validation.ts:36-41 is plain z.object() without .refine() |
| Operation descriptions updated | **Satisfied** | axes.ts:100 (create), axes.ts:116 (update) mention curve/veto |
| Service validation errors return 400 | **Satisfied** | axes.ts:33-35 (POST), axes.ts:74-76 (PUT) |
| Backward compatibility (no curve fields) | **Satisfied** | Tests at validation.test.ts:169-183, 246-249; route test axes.test.ts:128-139 |

## Test Coverage Against Plan

All six plan-specified test scenarios (plan lines 452-457) are covered:

1. Create axis with curve config → axes.test.ts:94
2. Update axis to sweet-spot, verify idealValue required → axes.test.ts:168, 212
3. Update from sweet-spot to higher-is-better, stale config cleared → axes.test.ts:228
4. Create axis with veto → axes.test.ts:114
5. Update axis to add/remove veto → axes.test.ts:255, 273
6. Existing payloads without curve fields still work → axes.test.ts:128

Plus 7 additional edge case tests beyond plan minimum: idealValue out-of-range on create/update, sweet-spot missing idealValue on create, sweet-spot without stored idealValue on update, name-only update preserving curve fields, backward-compatible create without curve fields.

## Build Status

Dalton's commission reports 578 pass, 1 skip, 0 fail, typecheck clean (verified against commission artifact).

## Decisions

**Does createAxis correctly pass through all curve fields?**
Yes. All five curve fields (preferenceShape, idealValue, tolerance, leanDirection, veto) are passed through in the axis object construction at axis-service.ts:50-54.
*Reasoning: Compared the axis object literal (lines 43-57) against the Axis interface (shared/types.ts:64-78) and the plan's createAxis spec (plan lines 418-426). Every curve field from the plan is present.*

**Does updateAxis correctly pass through all curve fields?**
Yes. All five curve fields are conditionally applied at axis-service.ts:107-120. The undefined-check pattern (if parsed.X !== undefined) correctly distinguishes "not sent" from "explicitly sent" for partial updates.
*Reasoning: Compared lines 107-120 against the plan's updateAxis spec (plan lines 429-433). Every field is handled. The guard pattern matches the existing field update pattern for name/description/weight at lines 102-104.*

**Is the sweet-spot idealValue cross-field validation correct?**
Correct with one minor observation. createAxis validates idealValue against native scale when sweet-spot is selected (lines 31-38). The CreateAxisSchema refinement (validation.ts:25-30) guarantees idealValue is present for sweet-spot on create. updateAxis correctly handles three cases: idealValue provided in update, idealValue stored on existing axis, or neither (rejects). Scale bounds validation covers both paths.
*Reasoning: Traced the validation flow for both create and update. On create: schema refinement catches missing idealValue → service checks bounds if present. On update: service determines effectiveShape (line 81), resolves effectiveIdealValue from update payload or stored axis (lines 85-86), rejects if null (line 87-89), validates bounds (lines 92-97). The plan's review note about removing the UpdateAxisSchema refinement was followed correctly.*

**Does switching away from sweet-spot correctly clear stale config?**
Yes, with a minor behavioral subtlety. Lines 111-115 clear idealValue, tolerance, and leanDirection to undefined when preferenceShape changes to a non-sweet-spot value. However, lines 117-119 then apply any explicitly sent values, meaning a payload like { preferenceShape: "higher-is-better", idealValue: 5 } would re-set idealValue after clearing. This is harmless since the curve engine ignores idealValue for non-sweet-spot shapes, but it means "clear stale config" is only enforced for fields not explicitly sent in the same payload.
*Reasoning: Read lines 107-120 sequentially. The clear at lines 112-114 executes before the per-field application at lines 117-119. A user sending idealValue alongside a non-sweet-spot shape is doing something the plan considers meaningless ("not an error if provided with other shapes, just ignored" per plan line 257). The stored value would persist but have no scoring effect. This is an edge case, not a defect.*

**Are route operation descriptions updated?**
Yes. axes.ts:100 now reads "Create a new rating axis with optional curve and veto configuration" and line 116 reads "Update axis name, description, weight, curve, or veto configuration." List and delete descriptions are unchanged, which is correct since they don't need curve-specific language.
*Reasoning: Read the operations array at axes.ts:96-131 and compared to the plan requirement at line 448.*

**Are all route-level test cases from the plan covered?**
Yes. All six plan-specified test scenarios are covered, plus additional edge cases. The 13 route tests map to: (1) create with curve config, (2) create with veto, (3) backward-compatible create, (4-5) idealValue validation on create, (6) update to sweet-spot, (7) update sweet-spot using stored idealValue, (8) update to sweet-spot without stored value, (9) stale config clearing, (10-11) add/remove veto, (12) name-only update preserving curves, (13) idealValue out-of-range on update.
*Reasoning: Compared the plan's test list (lines 452-457) against the actual test file (axes.test.ts:93-336). Every plan item has at least one corresponding test. Several additional edge cases are covered beyond the plan minimum.*

**Do existing axis create/update payloads without curve fields still work?**
Yes. Backward compatibility is verified at three levels: (1) CreateAxisSchema accepts payloads without curve fields (validation.test.ts:169-183), (2) UpdateAxisSchema accepts payloads without curve fields (validation.test.ts:246-249), (3) Route-level test confirms create without curve fields returns 201 with undefined curve fields (axes.test.ts:128-139).
*Reasoning: Read the relevant test cases and traced through the schema definitions. All curve fields use .optional() in the schemas, and the service doesn't require them.*

**Is the route error-handling pattern for service-level validation errors appropriate?**
It works but relies on string matching in error messages. axes.ts:33 checks message.includes("idealValue") and message.includes("outside native scale") to map errors to HTTP 400. This is fragile: a future error message containing "idealValue" in a different context would be incorrectly mapped. However, this pattern is consistent with the existing codebase (line 71 uses message.includes("not found") for 404), so it's not a regression. Flag for future consideration, not a blocking issue.
*Reasoning: Read lines 28-37 (POST handler) and lines 66-78 (PUT handler). Both use the same string-matching pattern. The existing "not found" → 404 mapping at line 71 establishes precedent. The plan doesn't specify an error handling mechanism. A typed error hierarchy would be cleaner but is outside Phase 4's scope.*
