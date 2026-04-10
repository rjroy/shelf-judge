---
status: active
---
# Heartbeat

This file controls what the guild does autonomously. Every hour (configurable),
a Guild Master session reads this file and decides which standing orders warrant
action: creating commissions, dispatching work, or starting meetings.

**Standing Orders** are lines starting with `- `. Write them in plain language.
If you want the guild to check with you before acting on an order, say so in the
order itself.

**Watch Items** are things to monitor. The guild reads these for context but won't
create commissions from them directly.

**Context Notes** are operational context the guild should know (merge freezes, priorities).

**Recent Activity** is managed by the daemon. Don't edit this section manually.
Workers can also add entries to this file during their sessions.

## Standing Orders

## Watch Items

## Context Notes

## Recent Activity
- 20:14 commission-Dalton-20260409-200745 result: Phase 1 and Phase 2 implemented. 524 tests pass (70 new), typecheck clean, lint clean.

**Phase 1: Shared Types and Validation**

Added to `packages/shared/src/types.ts`:
- New types: `PreferenceShape...

- 20:14 commission-Dalton-20260409-200745 completed
- 20:21 commission-Thorne-20260409-200754 result: # Review: Utility Curves Phase 1 + Phase 2

- 20:22 commission-Thorne-20260409-200754 completed
- 20:24 commission-Dalton-20260409-200801 result: # Review Findings Addressed

All four findings from Thorne's Phase 1+2 review resolved.

- 20:24 commission-Dalton-20260409-200801 completed
- 20:30 commission-Dalton-20260409-200818 result: # Phase 3: Fitness Service Integration Complete

- 20:30 commission-Dalton-20260409-200818 completed
- 20:33 commission-Celeste-20260409-202834 result: Wrote collection profiling brainstorm to `.lore/brainstorms/collection-profiling.md` with six proposals:

1. **Algorithmic Taste Profile** (Medium) - Deterministic profiling service computing rating d...
- 20:33 commission-Celeste-20260409-202834 completed
- 20:36 commission-Celeste-20260409-203114 result: Brainstorm artifact written to `.lore/brainstorms/prediction-engine.md` with 6 proposals:

1. **Curve-First Prediction for BGG-Derived Axes** (Small) — Apply the user's utility curves to BGG data for ...
- 20:36 commission-Celeste-20260409-203114 completed
- 20:37 commission-Thorne-20260409-200827 result: # Phase 3 Review: Fitness Service Integration

- 20:37 commission-Thorne-20260409-200827 completed
- 20:38 commission-Dalton-20260409-200833 result: Addressed all three findings from Thorne's Phase 3 review.

**Finding 1 (web bggOriginal rendering)**: Replaced the broken "BGG value: 2.9 → scaled 3" rendering with "BGG: 2.9". The old rendering beca...
- 20:38 commission-Dalton-20260409-200833 completed
- 20:42 commission-Dalton-20260409-200842 result: Phase 4 complete. 578 pass, 1 skip, 0 fail. Typecheck clean.

**Axis service** (`packages/daemon/src/services/axis-service.ts`):
- `createAxis` now passes through all curve fields (preferenceShape, id...
- 20:42 commission-Dalton-20260409-200842 completed
- 20:46 commission-Thorne-20260409-200849 result: # Phase 4 Review: API and Service Layer

- 20:46 commission-Thorne-20260409-200849 completed
- 20:48 commission-Dalton-20260409-200854 result: # Phase 4 Review Findings: Addressed

- 20:48 commission-Dalton-20260409-200854 completed
- 20:53 commission-Dalton-20260409-200920 result: Phase 6 (CLI) complete. All changes confined to `packages/cli/`.

**Implementation:**

1. **`output.ts`**: Extended `BreakdownEntry` with `rawValue`, `effectiveRating`, `preferenceShape`, `curveAffect...
- 20:53 commission-Dalton-20260409-200920 completed
- 20:59 commission-Dalton-20260409-200910 result: # Phase 5: Web UI for Utility Curves

All changes pass typecheck (web + shared + daemon + cli), lint, and tests (578 pass, 0 fail).

- 20:59 commission-Dalton-20260409-200910 completed
- 21:04 commission-Thorne-20260409-200929 result: ## Review: Phase 5 (Web UI) and Phase 6 (CLI) — Utility Curves

**Scope**: Static code review of all files listed in the plan for Phase 5 and Phase 6. Typecheck and test suite could not be executed (s...
- 21:04 commission-Thorne-20260409-200929 completed
## Created
- `packages/web/lib/curve-math.ts` - Client-side pure cu...
## Finding 1: String-Based Error Routing (Fixed)

Replaced fragile `message.includes()` checks with typed error classes:

- Added `ValidationError` and `NotFoundE...
## Verdict: Pass. Ready for Phase 5/6 consumption.

All five review criteria are satisfied. No blocking defects found.

---

## Findings by Priority

### 1. St...
## Verdict

The implementation is structurally sound. The scoring loop follows the plan's sequence exactly. Curve engine integration is correct. Backward...
## Implementation

### `packages/daemon/src/services/fitness-service.ts`
- **Replaced `resolveBggRating`** with `resolveBggRawValue`: returns raw nativ...
## Code Changes

### Finding 2 [MEDIUM]: Output clamping added to `applyPreferenceCurve`
- Added `clamp()` help...
## Verdict

Implementation is correct. The curve math verifies against hand calculations. Types match the plan exactly. Test coverage hits every category th...