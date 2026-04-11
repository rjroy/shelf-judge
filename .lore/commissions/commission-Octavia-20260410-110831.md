---
title: "Commission: Plan: Prediction Engine"
date: 2026-04-10
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write an implementation plan from the spec at `.lore/specs/prediction-engine.md`.\n\nUse the `/lore-development:prep-plan` skill. Follow the project's existing plan conventions (see `.lore/plans/utility-curves.md` and `.lore/plans/collection-filter-sort.md` for reference).\n\nKey context:\n- The core is k-NN estimation for personal axes with cosine similarity over feature vectors (mechanics binary flags, categories binary flags, BGG weight, community rating, player count range).\n- Extensions: tournament ELO as prediction prior, confidence architecture with explicit uncertainty levels, cold start progressive unlock (deprioritized).\n- The feature vector module should be structured for reuse by the collection profiling feature (they share the same similarity computations). See `.lore/specs/collection-profiling.md` for what profiling needs.\n- The brainstorm at `.lore/brainstorms/prediction-engine.md` has the full accepted/rejected context.\n- The outlier distance metric research at `.lore/research/outlier-distance-metric.md` is relevant for the shared feature vector design (profiling uses a composite metric with Jaccard for binary + normalized Manhattan for continuous, while prediction uses cosine similarity, but the underlying feature vectors are the same).\n\nRead the spec thoroughly, then break into phased steps with clear boundaries, test expectations, and review gates. Consider the daemon-first architecture and that web and CLI are both clients."
dependencies: []
linked_artifacts:
  - .lore/plans/prediction-engine.md

activity_timeline:
  - timestamp: 2026-04-10T18:08:31.690Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T18:08:31.692Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T18:08:31.714Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T18:08:37.677Z
    event: progress_report
    reason: "Starting plan prep. Reading spec, brainstorm, research, and reference plans."
  - timestamp: 2026-04-10T18:09:03.250Z
    event: progress_report
    reason: "Read spec, brainstorm, research, reference plans, and profiling spec. Now scanning the codebase to ground the plan in actual file paths and patterns."
  - timestamp: 2026-04-10T18:10:08.305Z
    event: progress_report
    reason: "Codebase scan complete. Read types.ts, fitness-service.ts, curve-engine.ts, elo-engine.ts, game-service.ts, tournament-service.ts, scores route, CLI score command, web API client. Now invoking prep-plan skill."
  - timestamp: 2026-04-10T18:11:24.107Z
    event: progress_report
    reason: "Context gathering complete. All source material read: spec (37 requirements), brainstorm, outlier research, collection profiling spec (shared infrastructure), two reference plans, and key codebase files. Drafting the plan now."
  - timestamp: 2026-04-10T18:15:51.234Z
    event: progress_report
    reason: "Plan drafted and saved to .lore/plans/prediction-engine.md. Running fresh-eyes plan review."
  - timestamp: 2026-04-10T18:21:33.086Z
    event: result_submitted
    reason: "Implementation plan for the prediction engine written and reviewed.\n\n**Artifact**: `.lore/plans/prediction-engine.md` (status: draft, 37 requirements mapped across 7 phases)\n\n**Structure**: 7 sequential phases with two review gates:\n- Phase 1: Shared types + feature vector engine (pure math, cosine/Jaccard/Manhattan, designed for profiling reuse)\n- Phase 2: k-NN estimation, confidence architecture, prediction readiness (pure math)\n- Phase 3: Tournament prior (stability weighting, revealed preference tension)\n- **Review gate**: Thorne reviews engine phases before service wiring\n- Phase 4: Prediction service + daemon API (3 new endpoints, collection list extension)\n- Phase 5: Web UI (game detail, collection list, readiness display) -- parallelizable with Phase 6\n- Phase 6: CLI (predict command, readiness, scores --include-predicted) -- parallelizable with Phase 5\n- **Review gate**: Thorne reviews full implementation\n- Phase 7: Tests and final verification\n\n**Key technical decisions**: (1) Feature vector module splits binary and continuous portions for profiling reuse, (2) Prediction service is separate from fitness service (composes, doesn't extend), (3) Tournament stability multiplier capped at 1.2x, (4) `PredictionMeta` carries `readinessStage` so clients derive experimental markers without a second API call, (5) Settings endpoints included but flagged as beyond spec scope.\n\n**Fresh-eyes review findings addressed**: Added `readinessStage` to `PredictionMeta`, named three `score === null` consumer paths in Phase 5, clarified `provisionalThreshold` source as `TournamentService.getSettings()`, noted Jaccard interface boundary for profiling centroid use, clarified Phase 3 verification scope as unit-test-only, added `predictionMeta: null` to fitness service return paths in Phase 1."
  - timestamp: 2026-04-10T18:21:37.498Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Plan drafted and saved to .lore/plans/prediction-engine.md. Running fresh-eyes plan review."
projectName: shelf-judge
---
Implementation plan for the prediction engine written and reviewed.

**Artifact**: `.lore/plans/prediction-engine.md` (status: draft, 37 requirements mapped across 7 phases)

**Structure**: 7 sequential phases with two review gates:
- Phase 1: Shared types + feature vector engine (pure math, cosine/Jaccard/Manhattan, designed for profiling reuse)
- Phase 2: k-NN estimation, confidence architecture, prediction readiness (pure math)
- Phase 3: Tournament prior (stability weighting, revealed preference tension)
- **Review gate**: Thorne reviews engine phases before service wiring
- Phase 4: Prediction service + daemon API (3 new endpoints, collection list extension)
- Phase 5: Web UI (game detail, collection list, readiness display) -- parallelizable with Phase 6
- Phase 6: CLI (predict command, readiness, scores --include-predicted) -- parallelizable with Phase 5
- **Review gate**: Thorne reviews full implementation
- Phase 7: Tests and final verification

**Key technical decisions**: (1) Feature vector module splits binary and continuous portions for profiling reuse, (2) Prediction service is separate from fitness service (composes, doesn't extend), (3) Tournament stability multiplier capped at 1.2x, (4) `PredictionMeta` carries `readinessStage` so clients derive experimental markers without a second API call, (5) Settings endpoints included but flagged as beyond spec scope.

**Fresh-eyes review findings addressed**: Added `readinessStage` to `PredictionMeta`, named three `score === null` consumer paths in Phase 5, clarified `provisionalThreshold` source as `TournamentService.getSettings()`, noted Jaccard interface boundary for profiling centroid use, clarified Phase 3 verification scope as unit-test-only, added `predictionMeta: null` to fitness service return paths in Phase 1.
