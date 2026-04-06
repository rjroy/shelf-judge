---
title: "Commission: Tournament Phase 4: API Routes"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 4 from `.lore/plans/tournament-ranking.md`.\n\n**New file:** `packages/daemon/src/routes/tournament.ts`\n- 11 endpoints per the plan's endpoint specification table\n- Follow existing route patterns (createTournamentRoutes, operations registry, Zod validation, error-to-status mapping)\n- The route needs both tournamentService and gameService (for next-pair game resolution)\n\n**Wiring:**\n- `app.ts`: add tournamentService to AppDeps, wire tournament routes\n- `index.ts`: construct tournamentService before gameService, pass onGameDeleted callback\n\n**Request/response shapes** are fully specified in the plan. Follow them exactly.\n\n**Tests:** Route-level tests using `app.request()` pattern. Cover happy paths, validation errors, 404s for all 11 endpoints.\n\nRead the plan's Phase 4 section for exact endpoint paths, methods, request/response shapes, and wiring details.\n\nRun `bun run test`, `bun run typecheck`, `bun run lint`."
dependencies:
  - commission-Dalton-20260406-153848
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T22:38:59.330Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T22:38:59.332Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-06T23:08:44.190Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-06T23:08:44.193Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
