---
title: "Commission: Redundancy scoring: Phases 1-4 (types, storage, engine, routes)"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 1-4 of the redundancy scoring plan at `.lore/plans/redundancy-scoring.md`.\n\nRead the full plan first. You are implementing:\n\n- **Phase 1**: Shared types (`RedundancyNeighbor`, `RedundancyAdjustment`, `RedundancySettings`, `ComponentWeights` duplicate) in `packages/shared/src/types.ts`. Add `redundancyAdjustment: RedundancyAdjustment | null` to `FitnessResult`. Fix all constructor sites that build `FitnessResult` objects (fitness-service.ts, prediction-engine.ts) to include `redundancyAdjustment: null`.\n\n- **Phase 2**: Storage layer — `loadRedundancySettings()` / `saveRedundancySettings()` on `StorageService` interface and implementation. File: `redundancy-settings.json`. Defaults imported from redundancy engine (Phase 3).\n\n- **Phase 3**: Redundancy engine — new file `packages/daemon/src/services/redundancy-engine.ts`. Pure functions, no I/O. `DEFAULT_REDUNDANCY_SETTINGS`, `flattenWeighted()` helper with personalAxes dimension mismatch handling, `computeRedundancyAdjustments()` main function. Unit tests in `packages/daemon/tests/redundancy-engine.test.ts` covering all 14 test cases listed in Phase 3d.\n\n- **Phase 4**: Daemon CRUD routes — new file `packages/daemon/src/routes/redundancy.ts` with GET/PATCH on `/redundancy/settings`. Validation for all constraints listed in 4a. Register in app.ts. Route tests in `packages/daemon/tests/redundancy-settings-routes.test.ts`.\n\nKey decisions from the plan:\n- Duplicate `ComponentWeights` in types.ts (Option A) rather than moving it from feature-vector.ts.\n- Phases 2 and 3 implemented together so storage can import `DEFAULT_REDUNDANCY_SETTINGS` from the engine.\n- `flattenWeighted` excludes personalAxes when either game lacks them, redistributing weight to binary + continuous.\n- Tie detection at two decimal places: `Math.round(a * 100) === Math.round(b * 100)`.\n- Predicted game authority (REQ-REDUN-12): predicted neighbors don't count as \"better\" for actual-scored games.\n\nRun `bun run test`, `bun run typecheck`, and `bun run lint` before declaring complete."
dependencies:
  - commission-Dalton-20260411-221152
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T13:41:24.590Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T13:45:15.849Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
