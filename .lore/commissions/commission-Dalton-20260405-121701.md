---
title: "Commission: Phase 5: Web UI (Next.js)"
date: 2026-04-05
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 5 of the MVP plan at `.lore/plans/mvp.md`.\n\nRead the full plan (Phase 5), then also read:\n- `.lore/designs/mvp-web-ui.md`\n- `.lore/designs/mvp-api-surface.md`\n- `.lore/specs/mvp.md` (REQ-MVP-22, 5, 24)\n\nPhase 5 has six steps:\n\n**5.1 Next.js project setup** — Initialize in `packages/web/` with App Router. Create daemon API client in `lib/api.ts`. If `fetch` with `unix` option doesn't work through Next.js's wrapper, create a proxy at `/api/daemon/[...path]`. Root layout with navigation (Collection, Axes, Add Game). Validate socket transport immediately.\n\n**5.2 Collection view** — Home page. Server component fetching `GET /api/games`. Table/grid: name, thumbnail, fitness score, rated axis count. Sorted by fitness descending. Unscored at bottom. Add Game and Import buttons.\n\n**5.3 Game detail view** — Full score breakdown table (REQ-MVP-5). Rating form per axis. BGG-derived axes show auto-populated value with override option. Refresh BGG Data button. Remove Game with confirmation.\n\n**5.4 Game search and add** — Text search debounced against BGG. Results list. Click to add. Manual add form. Duplicate 409 handling.\n\n**5.5 Axes management** — CRUD. Delete confirmation shows live count of affected games/ratings.\n\n**5.6 BGG import with progress** — Username input. SSE stream reading. Progress display. Error summary. Navigate to collection on completion.\n\nNo automated tests for web UI in MVP (deliberate scope decision per plan). The daemon API tests cover the logic.\n\nRun `bun run dev` in packages/web and verify pages render."
dependencies:
  - commission-Dalton-20260405-121647
linked_artifacts:
  - packages/web/lib/api.ts

  - packages/web/app/layout.tsx
  - packages/web/app/page.tsx
  - packages/web/app/games/[id]/page.tsx
  - packages/web/app/search/page.tsx
  - packages/web/app/axes/page.tsx
  - packages/web/app/import/page.tsx
  - packages/web/app/api/daemon/[...path]/route.ts
  - packages/web/components/score-badge.tsx
  - packages/web/components/score-breakdown.tsx
  - packages/web/components/rating-form.tsx
  - packages/web/components/game-actions.tsx
  - packages/web/app/layout.tsx
  - packages/web/app/page.tsx
  - packages/web/app/games/[id]/page.tsx
  - packages/web/app/search/page.tsx
  - packages/web/app/axes/page.tsx
  - packages/web/app/import/page.tsx
  - packages/web/app/api/daemon/[...path]/route.ts
  - packages/web/components/score-badge.tsx
  - packages/web/components/score-breakdown.tsx
  - packages/web/components/rating-form.tsx
  - packages/web/components/game-actions.tsx
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
  - timestamp: 2026-04-05T20:36:55.340Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-05T20:37:30.401Z
    event: progress_report
    reason: "Starting Phase 5: Web UI. Read the plan, spec, and design docs. The packages/web/ directory is a placeholder with just a bare package.json. Beginning implementation with Next.js setup."
  - timestamp: 2026-04-05T20:38:08.008Z
    event: progress_report
    reason: "Step 5.1: Initializing Next.js project in packages/web/. Will create the app scaffold, API client, and root layout with navigation."
  - timestamp: 2026-04-05T20:43:07.703Z
    event: progress_report
    reason: "All pages and components written. Files: layout, API proxy route, API client, collection page, game detail page, search page, axes page, import page, score-badge, score-breakdown, rating-form, game-actions components. Verifying build now."
  - timestamp: 2026-04-05T20:46:15.079Z
    event: result_submitted
    reason: "Phase 5 (Web UI) implemented. All six steps complete:\n\n**5.1 Next.js setup** - App Router scaffold with `@shelf-judge/shared` workspace dependency. API proxy at `/api/daemon/[...path]/route.ts` forwards client component requests to the daemon's Unix socket. Server-side API client at `lib/api.ts` uses Bun's `fetch` with `unix` option directly. Root layout with persistent left sidebar navigation (Collection, Axes, Add Game, Import from BGG).\n\n**5.2 Collection view** (`app/page.tsx`) - Server component fetching `GET /api/games`. Table with game name (linked to detail), year, color-coded fitness badge, rated axis count. Sorted by fitness descending, unscored at bottom. Add Game and Import buttons in header.\n\n**5.3 Game detail** (`app/games/[id]/page.tsx`) - Game info (year, players, play time, BGG link). Full score breakdown table per REQ-MVP-5 (axis name, rating, weight, contribution, source with BGG original for overrides). Rating form per axis with number inputs. Refresh BGG Data button (conditionally shown for BGG games). Remove Game with browser confirmation dialog.\n\n**5.4 Search and add** (`app/search/page.tsx`) - BGG text search with 400ms debounce. Results table with Add button per game. Manual add form for non-BGG games. 409 duplicate error display.\n\n**5.5 Axes management** (`app/axes/page.tsx`) - Full CRUD. Inline weight editing. Delete confirmation shows live count of games with ratings on that axis (fetched from `/api/games` and counted client-side). Create new axis form with name/description/weight.\n\n**5.6 BGG import** (`app/import/page.tsx`) - Username input. Reads SSE stream from daemon proxy. Progress bar with \"Importing N of M...\" and current game name. Error summary at completion. \"Go to Collection\" button on complete.\n\n**Build verification**: `next build` passes clean (TypeScript checks pass, all routes compile). Dev server starts in ~140ms.\n\n**Files created/modified**:\n- `packages/web/package.json` (scripts, dependencies including @shelf-judge/shared)\n- `packages/web/tsconfig.json`\n- `packages/web/next.config.ts` (BGG image domain whitelist)\n- `packages/web/next-env.d.ts`\n- `packages/web/lib/api.ts` (daemon API client)\n- `packages/web/app/layout.tsx` (root layout with sidebar nav)\n- `packages/web/app/page.tsx` (collection home)\n- `packages/web/app/games/[id]/page.tsx` (game detail)\n- `packages/web/app/search/page.tsx` (BGG search + manual add)\n- `packages/web/app/axes/page.tsx` (axes CRUD)\n- `packages/web/app/import/page.tsx` (BGG import with SSE)\n- `packages/web/app/api/daemon/[...path]/route.ts` (proxy)\n- `packages/web/components/score-badge.tsx`\n- `packages/web/components/score-breakdown.tsx`\n- `packages/web/components/rating-form.tsx`\n- `packages/web/components/game-actions.tsx`\n\nNo automated tests (deliberate scope decision per plan: web UI is thin display logic, daemon API tests cover all business logic)."
  - timestamp: 2026-04-05T20:46:20.779Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All pages and components written. Files: layout, API proxy route, API client, collection page, game detail page, search page, axes page, import page, score-badge, score-breakdown, rating-form, game-actions components. Verifying build now."
projectName: shelf-judge
---

Phase 5 (Web UI) implemented. All six steps complete:

**5.1 Next.js setup** - App Router scaffold with `@shelf-judge/shared` workspace dependency. API proxy at `/api/daemon/[...path]/route.ts` forwards client component requests to the daemon's Unix socket. Server-side API client at `lib/api.ts` uses Bun's `fetch` with `unix` option directly. Root layout with persistent left sidebar navigation (Collection, Axes, Add Game, Import from BGG).

**5.2 Collection view** (`app/page.tsx`) - Server component fetching `GET /api/games`. Table with game name (linked to detail), year, color-coded fitness badge, rated axis count. Sorted by fitness descending, unscored at bottom. Add Game and Import buttons in header.

**5.3 Game detail** (`app/games/[id]/page.tsx`) - Game info (year, players, play time, BGG link). Full score breakdown table per REQ-MVP-5 (axis name, rating, weight, contribution, source with BGG original for overrides). Rating form per axis with number inputs. Refresh BGG Data button (conditionally shown for BGG games). Remove Game with browser confirmation dialog.

**5.4 Search and add** (`app/search/page.tsx`) - BGG text search with 400ms debounce. Results table with Add button per game. Manual add form for non-BGG games. 409 duplicate error display.

**5.5 Axes management** (`app/axes/page.tsx`) - Full CRUD. Inline weight editing. Delete confirmation shows live count of games with ratings on that axis (fetched from `/api/games` and counted client-side). Create new axis form with name/description/weight.

**5.6 BGG import** (`app/import/page.tsx`) - Username input. Reads SSE stream from daemon proxy. Progress bar with "Importing N of M..." and current game name. Error summary at completion. "Go to Collection" button on complete.

**Build verification**: `next build` passes clean (TypeScript checks pass, all routes compile). Dev server starts in ~140ms.

**Files created/modified**:

- `packages/web/package.json` (scripts, dependencies including @shelf-judge/shared)
- `packages/web/tsconfig.json`
- `packages/web/next.config.ts` (BGG image domain whitelist)
- `packages/web/next-env.d.ts`
- `packages/web/lib/api.ts` (daemon API client)
- `packages/web/app/layout.tsx` (root layout with sidebar nav)
- `packages/web/app/page.tsx` (collection home)
- `packages/web/app/games/[id]/page.tsx` (game detail)
- `packages/web/app/search/page.tsx` (BGG search + manual add)
- `packages/web/app/axes/page.tsx` (axes CRUD)
- `packages/web/app/import/page.tsx` (BGG import with SSE)
- `packages/web/app/api/daemon/[...path]/route.ts` (proxy)
- `packages/web/components/score-badge.tsx`
- `packages/web/components/score-breakdown.tsx`
- `packages/web/components/rating-form.tsx`
- `packages/web/components/game-actions.tsx`

No automated tests (deliberate scope decision per plan: web UI is thin display logic, daemon API tests cover all business logic).
