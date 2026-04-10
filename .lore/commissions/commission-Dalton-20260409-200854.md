---
title: "Commission: Fix: Utility Curves Phase 4 Review Findings"
date: 2026-04-10
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Read the review findings from the Phase 4 review commission. The review was conducted by Thorne on the API and service layer changes for utility curves.\n\nAddress ALL findings. The implementation files are:\n- `packages/daemon/src/routes/axes.ts`\n- `packages/daemon/src/services/axis-service.ts`\n- Route test files in `packages/daemon/tests/`\n\nReference: `.lore/plans/utility-curves.md` Phase 4.\n\nRun `bun run test` and `bun run typecheck` after all fixes."
dependencies:
  - commission-Thorne-20260409-200849
linked_artifacts:
  - packages/shared/src/errors.ts

  - packages/shared/src/index.ts
  - packages/daemon/src/services/axis-service.ts
  - packages/daemon/src/routes/axes.ts
  - packages/shared/src/index.ts
  - packages/daemon/src/services/axis-service.ts
  - packages/daemon/src/routes/axes.ts
activity_timeline:
  - timestamp: 2026-04-10T03:08:54.810Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T03:08:54.811Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-10T03:46:21.657Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-10T03:46:21.660Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T03:46:21.680Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T03:46:38.297Z
    event: progress_report
    reason: "Read Thorne's review. Two findings: (1) String-based error routing in route handlers is fragile, recommends typed errors. (2) Stale config clearing overridable in same payload, documented as harmless. Reading implementation files now."
  - timestamp: 2026-04-10T03:47:07.087Z
    event: progress_report
    reason: "Implementing typed error classes (ValidationError, NotFoundError) in shared/errors.ts, then updating axis service and routes to use instanceof checks instead of string matching."
  - timestamp: 2026-04-10T03:48:26.529Z
    event: result_submitted
    reason: "# Phase 4 Review Findings: Addressed\n\n## Finding 1: String-Based Error Routing (Fixed)\n\nReplaced fragile `message.includes()` checks with typed error classes:\n\n- Added `ValidationError` and `NotFoundError` classes to `packages/shared/src/errors.ts`\n- Exported both from `packages/shared/src/index.ts`\n- Updated `packages/daemon/src/services/axis-service.ts` to throw `ValidationError` for business rule violations (idealValue bounds, missing idealValue) and `NotFoundError` for missing axes\n- Updated `packages/daemon/src/routes/axes.ts` to use `instanceof` checks instead of string matching for all three handlers (POST, PUT, DELETE)\n\nRoutes now map errors by type, not message content. A future error message containing \"idealValue\" in a different context will no longer be misrouted to 400.\n\n## Finding 2: Stale Config Clearing Overridable (No Action, Documented)\n\nPer Thorne's assessment: harmless. The curve engine ignores `idealValue` for non-sweet-spot shapes, so a stored value has no scoring effect. No code change needed.\n\n## Verification\n\n- `bun run typecheck`: clean\n- `bun run test`: 578 pass, 1 skip, 0 fail\n\nAll existing tests pass unchanged because the error messages are identical (only the Error subclass changed)."
  - timestamp: 2026-04-10T03:48:30.680Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Implementing typed error classes (ValidationError, NotFoundError) in shared/errors.ts, then updating axis service and routes to use instanceof checks instead of string matching."
projectName: shelf-judge
---
# Phase 4 Review Findings: Addressed

## Finding 1: String-Based Error Routing (Fixed)

Replaced fragile `message.includes()` checks with typed error classes:

- Added `ValidationError` and `NotFoundError` classes to `packages/shared/src/errors.ts`
- Exported both from `packages/shared/src/index.ts`
- Updated `packages/daemon/src/services/axis-service.ts` to throw `ValidationError` for business rule violations (idealValue bounds, missing idealValue) and `NotFoundError` for missing axes
- Updated `packages/daemon/src/routes/axes.ts` to use `instanceof` checks instead of string matching for all three handlers (POST, PUT, DELETE)

Routes now map errors by type, not message content. A future error message containing "idealValue" in a different context will no longer be misrouted to 400.

## Finding 2: Stale Config Clearing Overridable (No Action, Documented)

Per Thorne's assessment: harmless. The curve engine ignores `idealValue` for non-sweet-spot shapes, so a stored value has no scoring effect. No code change needed.

## Verification

- `bun run typecheck`: clean
- `bun run test`: 578 pass, 1 skip, 0 fail

All existing tests pass unchanged because the error messages are identical (only the Error subclass changed).
