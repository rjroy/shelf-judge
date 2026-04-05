---
title: "Commission: Phase 5: Web UI (Next.js)"
date: 2026-04-05
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 5 of the MVP plan at `.lore/plans/mvp.md`.\n\nRead the full plan (Phase 5), then also read:\n- `.lore/designs/mvp-web-ui.md`\n- `.lore/designs/mvp-api-surface.md`\n- `.lore/specs/mvp.md` (REQ-MVP-22, 5, 24)\n\nPhase 5 has six steps:\n\n**5.1 Next.js project setup** — Initialize in `packages/web/` with App Router. Create daemon API client in `lib/api.ts`. If `fetch` with `unix` option doesn't work through Next.js's wrapper, create a proxy at `/api/daemon/[...path]`. Root layout with navigation (Collection, Axes, Add Game). Validate socket transport immediately.\n\n**5.2 Collection view** — Home page. Server component fetching `GET /api/games`. Table/grid: name, thumbnail, fitness score, rated axis count. Sorted by fitness descending. Unscored at bottom. Add Game and Import buttons.\n\n**5.3 Game detail view** — Full score breakdown table (REQ-MVP-5). Rating form per axis. BGG-derived axes show auto-populated value with override option. Refresh BGG Data button. Remove Game with confirmation.\n\n**5.4 Game search and add** — Text search debounced against BGG. Results list. Click to add. Manual add form. Duplicate 409 handling.\n\n**5.5 Axes management** — CRUD. Delete confirmation shows live count of affected games/ratings.\n\n**5.6 BGG import with progress** — Username input. SSE stream reading. Progress display. Error summary. Navigate to collection on completion.\n\nNo automated tests for web UI in MVP (deliberate scope decision per plan). The daemon API tests cover the logic.\n\nRun `bun run dev` in packages/web and verify pages render."
dependencies:
  - commission-Dalton-20260405-121647
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-05T19:17:01.683Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-05T19:22:19.171Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-05T20:36:55.326Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-05T20:36:55.328Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
