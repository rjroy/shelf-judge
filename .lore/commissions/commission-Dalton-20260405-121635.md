---
title: "Commission: Phase 4: Daemon API (Hono Routes)"
date: 2026-04-05
status: blocked
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 4 of the MVP plan at `.lore/plans/mvp.md`.\n\nRead the full plan (Phase 4), then also read:\n- `.lore/designs/mvp-api-surface.md`\n- `.lore/reference/architecture-pattern.md`\n- `.lore/specs/mvp.md` (REQ-MVP-22, 11, 12)\n\nPhase 4 has six steps:\n\n**4.1 App factory and server entry point** — Hono app factory with DI: `createApp(deps)`. Entry point starts `Bun.serve()` on Unix socket. Config resolution from env/file.\n\n**4.2 Game routes** — All game CRUD routes. BGG-dependent routes return 503 with setup instructions when no token configured (REQ-MVP-12). Error responses: `{ error: string, details?: unknown }`.\n\n**4.3 Axis routes** — CRUD. Delete returns `{ deletedRatingsCount }`.\n\n**4.4 Score routes** — `GET /api/games/:id/score` and `GET /api/scores`. Score list sorted by fitness descending, unscored at end.\n\n**4.5 Import route (SSE)** — `POST /api/import/bgg` with Hono `streamSSE`. Events: progress and complete. Set `idleTimeout: 0`.\n\n**4.6 Operations registry and help routes** — Each route factory exports OperationDefinition[]. `GET /api/help` returns full tree. Config routes for get/set.\n\nUse Hono's `app.request()` for integration tests. All routes validate input via Zod schemas and delegate to services.\n\nRun `bun test` after implementation. All Phase 1-4 tests must pass."
dependencies:
  - commission-Dalton-20260405-121621
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-05T19:16:35.406Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-05T19:22:19.171Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
current_progress: ""
projectName: shelf-judge
---
