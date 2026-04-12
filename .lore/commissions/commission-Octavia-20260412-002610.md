---
title: "Commission: Plan: Redundancy scoring implementation"
date: 2026-04-12
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write an implementation plan for the redundancy scoring feature specified in `.lore/specs/redundancy-scoring.md`.\n\nFollow the plan format established in `.lore/plans/niche-tag-filtering.md` as a structural reference. Your plan should include:\n\n1. **Codebase context** — Read the spec thoroughly, then read the relevant source files it references. Document the current state of the code that the plan touches: exact file paths, line numbers, existing patterns, and integration points. This is what makes the plan actionable rather than abstract.\n\n2. **Implementation phases** — Ordered steps with explicit file lists, what changes in each file, and code sketches where the approach isn't obvious. Each phase should name its dependencies on prior phases.\n\n3. **Delegation guide** — Which phases can parallelize, which need sequential review gates, and what expertise each phase requires.\n\n4. **Open questions** — Anything the spec leaves ambiguous or where you see multiple valid approaches.\n\nKey patterns to follow (established in this codebase):\n- Settings follow the prediction-settings pattern (shared type → storage service → CRUD API → clients)\n- The niche-tag-filtering plan (just executed) added a settings file, engine integration, routes, tests, web UI, and CLI in that order. Redundancy scoring has a similar shape.\n- Engine modules are pure functions (no I/O). Route handlers load settings and pass them as parameters.\n- Check how niche-engine.ts, prediction-engine.ts, and their routes are structured for the established patterns.\n\nRead these files for context:\n- `.lore/specs/redundancy-scoring.md` (the spec you're planning for)\n- `.lore/plans/niche-tag-filtering.md` (structural reference for plan format)\n- `.lore/specs/niche-champion-display.md` (related niche work)\n- `packages/shared/src/types.ts` (shared types)\n- `packages/daemon/src/services/storage-service.ts` (storage pattern)\n- `packages/daemon/src/services/niche-engine.ts` (engine pattern)\n- `packages/daemon/src/routes/prediction.ts` (route pattern)\n- `packages/daemon/src/routes/games.ts` (game routes, likely integration point)\n- `packages/web/lib/api.ts` (web client helpers)\n- `packages/cli/src/commands/` (CLI command patterns)\n\nWrite the plan to `.lore/plans/redundancy-scoring.md` with status `draft`."
dependencies: []
linked_artifacts:
  - .lore/plans/redundancy-scoring.md

activity_timeline:
  - timestamp: 2026-04-12T07:26:10.238Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T07:26:10.241Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T07:26:10.268Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T07:26:17.450Z
    event: progress_report
    reason: "Reading spec, reference plan, and codebase files to gather context for the redundancy scoring implementation plan."
  - timestamp: 2026-04-12T07:27:46.749Z
    event: progress_report
    reason: "Finished reading all source files. Have full context on: spec (42 requirements), reference plan structure, types.ts, storage-service.ts, niche-engine.ts, feature-vector.ts (cosineSimilarity at line 315), game-service.ts (listGames/getGame patterns), prediction-service.ts (listGamesWithPredictions, loadPredictionContext), routes patterns, app.ts wiring, CLI command patterns. Now drafting the plan."
  - timestamp: 2026-04-12T07:28:20.685Z
    event: progress_report
    reason: "Compendium consulted. Drafting the implementation plan now. Writing to .lore/plans/redundancy-scoring.md."
  - timestamp: 2026-04-12T07:32:22.474Z
    event: progress_report
    reason: "Plan drafted at .lore/plans/redundancy-scoring.md (12 phases). Running a quick coverage check against the spec's 41 requirements before submitting."
  - timestamp: 2026-04-12T07:32:47.102Z
    event: result_submitted
    reason: "Wrote implementation plan to `.lore/plans/redundancy-scoring.md` (status: draft).\n\nThe plan has 12 phases covering all 41 spec requirements:\n\n1. **Shared Types** (REQ-REDUN-1,2,14-16): `RedundancySettings`, `RedundancyAdjustment`, `RedundancyNeighbor` types + `FitnessResult` extension with nullable `redundancyAdjustment` field.\n2. **Storage Layer** (REQ-REDUN-3): `loadRedundancySettings()`/`saveRedundancySettings()` following the prediction-settings pattern.\n3. **Redundancy Engine** (REQ-REDUN-6-13): Pure-function module with weighted cosine similarity, pairwise penalty computation, tie handling, predicted-game authority rules, and vetoed-game exclusion. Includes detailed algorithm and dimension-mismatch handling decision.\n4. **Daemon Routes** (REQ-REDUN-4,30): GET/PATCH `/redundancy/settings` with validation.\n5. **Game Route Integration** (REQ-REDUN-5,17-24,26,28-29): Redundancy pass wired into GET /games, GET /games/:id, and GET /predictions/bgg/:bggId. Computes after niches (preserving pre-redundancy scores for niche ranking). Annotation vs integrated mode score handling.\n6. **Web Client Helpers**: Thin wrappers for redundancy settings API.\n7-10. **Web UI**: Game detail panel, collection list sort/badges, search preview, settings panel.\n11. **CLI**: `shelf-judge redundancy` subcommands + score/predict command integration.\n12. **Validation**: Fresh-context sub-agent review gate.\n\nKey decisions documented:\n- `ComponentWeights` duplicated in types.ts rather than moving from feature-vector.ts (avoids import churn)\n- personalAxes omitted from similarity when either game lacks them (redistributes weight)\n- Stage inferred from data in UI (no extra settings fetch)\n- Settings panel on collection page (co-located with the user's concern)\n- Feature vector cache per-request in route handler (optimization, not deferred)\n\n5 open questions flagged for implementer attention."
  - timestamp: 2026-04-12T07:32:53.876Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Plan drafted at .lore/plans/redundancy-scoring.md (12 phases). Running a quick coverage check against the spec's 41 requirements before submitting."
projectName: shelf-judge
---
Wrote implementation plan to `.lore/plans/redundancy-scoring.md` (status: draft).

The plan has 12 phases covering all 41 spec requirements:

1. **Shared Types** (REQ-REDUN-1,2,14-16): `RedundancySettings`, `RedundancyAdjustment`, `RedundancyNeighbor` types + `FitnessResult` extension with nullable `redundancyAdjustment` field.
2. **Storage Layer** (REQ-REDUN-3): `loadRedundancySettings()`/`saveRedundancySettings()` following the prediction-settings pattern.
3. **Redundancy Engine** (REQ-REDUN-6-13): Pure-function module with weighted cosine similarity, pairwise penalty computation, tie handling, predicted-game authority rules, and vetoed-game exclusion. Includes detailed algorithm and dimension-mismatch handling decision.
4. **Daemon Routes** (REQ-REDUN-4,30): GET/PATCH `/redundancy/settings` with validation.
5. **Game Route Integration** (REQ-REDUN-5,17-24,26,28-29): Redundancy pass wired into GET /games, GET /games/:id, and GET /predictions/bgg/:bggId. Computes after niches (preserving pre-redundancy scores for niche ranking). Annotation vs integrated mode score handling.
6. **Web Client Helpers**: Thin wrappers for redundancy settings API.
7-10. **Web UI**: Game detail panel, collection list sort/badges, search preview, settings panel.
11. **CLI**: `shelf-judge redundancy` subcommands + score/predict command integration.
12. **Validation**: Fresh-context sub-agent review gate.

Key decisions documented:
- `ComponentWeights` duplicated in types.ts rather than moving from feature-vector.ts (avoids import churn)
- personalAxes omitted from similarity when either game lacks them (redistributes weight)
- Stage inferred from data in UI (no extra settings fetch)
- Settings panel on collection page (co-located with the user's concern)
- Feature vector cache per-request in route handler (optimization, not deferred)

5 open questions flagged for implementer attention.
