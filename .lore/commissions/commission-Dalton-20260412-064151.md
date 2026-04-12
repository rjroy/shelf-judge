---
title: "Commission: Redundancy scoring: Phases 5-6 (route integration + web helpers)"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 5-6 of the redundancy scoring plan at `.lore/plans/redundancy-scoring.md`.\n\nRead the full plan first. This is the most complex phase. You are implementing:\n\n- **Phase 5**: Wire the redundancy engine into three route handlers (GET /games, GET /games/:id, GET /predictions/bgg/:bggId). Each handler loads redundancy settings, builds a `getFeatureVector` callback using collection vocabulary/ranges/axes, calls `computeRedundancyAdjustments`, and attaches results to `FitnessResult.redundancyAdjustment`. In integrated mode, update `score.score` to `adjustedScore`.\n\n  Critical ordering: scores first, niches second (on pre-redundancy scores per REQ-REDUN-26), redundancy third.\n\n  Add `redundancyPreview: RedundancyAdjustment | null` to `PredictedGameResponse` in types.ts (Phase 5e).\n\n  Cache feature vectors per-request in a `Map<string, FeatureVector>` in the route handler (Open Question 1 from the plan).\n\n  Add integration tests per Phase 5f.\n\n- **Phase 6**: Web client helpers in `packages/web/lib/api.ts` — `getRedundancySettings`, `updateRedundancySettings`. Re-export new types.\n\nKey decisions from the plan:\n- Route handlers load collection from `storageService` to get axes (separate from gameService load). Acceptable duplication at current scale.\n- `getFeatureVector` callback constructed in route handler, not in a service.\n- Prediction route creates temporary `GameWithScore` for candidate, runs full redundancy pass, extracts candidate's adjustment as preview.\n- Pre-redundancy scores used for existing games in the preview pass (REQ-REDUN-23).\n\nRun `bun run test`, `bun run typecheck`, and `bun run lint` before declaring complete."
dependencies:
  - commission-Dalton-20260412-064139
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T13:41:51.203Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T13:45:52.839Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T14:03:54.883Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T14:03:54.887Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
