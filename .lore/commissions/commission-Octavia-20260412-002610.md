---
title: "Commission: Plan: Redundancy scoring implementation"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write an implementation plan for the redundancy scoring feature specified in `.lore/specs/redundancy-scoring.md`.\n\nFollow the plan format established in `.lore/plans/niche-tag-filtering.md` as a structural reference. Your plan should include:\n\n1. **Codebase context** — Read the spec thoroughly, then read the relevant source files it references. Document the current state of the code that the plan touches: exact file paths, line numbers, existing patterns, and integration points. This is what makes the plan actionable rather than abstract.\n\n2. **Implementation phases** — Ordered steps with explicit file lists, what changes in each file, and code sketches where the approach isn't obvious. Each phase should name its dependencies on prior phases.\n\n3. **Delegation guide** — Which phases can parallelize, which need sequential review gates, and what expertise each phase requires.\n\n4. **Open questions** — Anything the spec leaves ambiguous or where you see multiple valid approaches.\n\nKey patterns to follow (established in this codebase):\n- Settings follow the prediction-settings pattern (shared type → storage service → CRUD API → clients)\n- The niche-tag-filtering plan (just executed) added a settings file, engine integration, routes, tests, web UI, and CLI in that order. Redundancy scoring has a similar shape.\n- Engine modules are pure functions (no I/O). Route handlers load settings and pass them as parameters.\n- Check how niche-engine.ts, prediction-engine.ts, and their routes are structured for the established patterns.\n\nRead these files for context:\n- `.lore/specs/redundancy-scoring.md` (the spec you're planning for)\n- `.lore/plans/niche-tag-filtering.md` (structural reference for plan format)\n- `.lore/specs/niche-champion-display.md` (related niche work)\n- `packages/shared/src/types.ts` (shared types)\n- `packages/daemon/src/services/storage-service.ts` (storage pattern)\n- `packages/daemon/src/services/niche-engine.ts` (engine pattern)\n- `packages/daemon/src/routes/prediction.ts` (route pattern)\n- `packages/daemon/src/routes/games.ts` (game routes, likely integration point)\n- `packages/web/lib/api.ts` (web client helpers)\n- `packages/cli/src/commands/` (CLI command patterns)\n\nWrite the plan to `.lore/plans/redundancy-scoring.md` with status `draft`."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T07:26:10.238Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T07:26:10.241Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
