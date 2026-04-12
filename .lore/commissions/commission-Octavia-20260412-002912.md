---
title: "Commission: Spec: Wishlist feature"
date: 2026-04-12
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write a specification for the wishlist feature described in `.lore/issues/wishlist.md`.\n\nThe issue says: \"Add Game should allow adding to a wishlist. The wishlist should just be a list of games. It should only have preview information like on the Add Game screen. This is to help a user understand fitness.\"\n\nRead these files for context on how specs are structured and how the system works:\n- `.lore/issues/wishlist.md` (the issue)\n- `.lore/vision.md` (project principles and anti-goals)\n- `.lore/specs/mvp.md` (MVP requirements for format reference)\n- `.lore/specs/niche-champion-display.md` (recent spec for format reference)\n- `.lore/designs/data-model.md` (data model)\n- `.lore/designs/fitness-algorithm.md` (fitness/scoring)\n- `.lore/designs/api-surface.md` (API patterns)\n- `.lore/designs/web-ui.md` (web UI patterns)\n- `packages/shared/src/types.ts` (existing types)\n- `packages/daemon/src/routes/prediction.ts` (prediction/add-game flow, since wishlist extends \"Add Game\")\n- `packages/web/app/games/add/page.tsx` or similar (the Add Game screen the issue references)\n- `packages/web/lib/api.ts` (web client helpers)\n\nKey questions the spec should answer:\n- What data does a wishlist entry store? The issue says \"preview information like on the Add Game screen.\" Trace what that screen shows and define the shape.\n- How does the wishlist help the user \"understand fitness\"? What fitness information is shown per wishlist entry?\n- Where does the wishlist live in the UI? Dedicated page? Tab on collection?\n- How does a game get added to the wishlist (from search/add-game flow)?\n- How does a game get removed?\n- What happens when a wishlisted game is added to the collection? Auto-remove from wishlist?\n- Storage: separate JSON file? Extension of existing data?\n- API endpoints needed\n- CLI surface (if any)\n\nWrite the spec to `.lore/specs/wishlist.md` with status `draft`."
dependencies: []
linked_artifacts:
  - .lore/specs/wishlist.md

activity_timeline:
  - timestamp: 2026-04-12T07:29:12.932Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T07:29:12.934Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T07:29:12.959Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T07:29:18.924Z
    event: progress_report
    reason: "Reading referenced files to gather context for wishlist specification."
  - timestamp: 2026-04-12T07:30:16.852Z
    event: progress_report
    reason: "Finished reading all source material. Now have full picture of: the issue request, types, search/add-game UI, prediction route, storage patterns, API surface, data model, web UI design, and niche-champion-display spec (for format reference). Ready to draft the spec."
  - timestamp: 2026-04-12T07:33:06.745Z
    event: result_submitted
    reason: "Wrote wishlist specification to `.lore/specs/wishlist.md` (status: draft, 29 requirements, prefix WISH).\n\nThe spec defines:\n\n**Data model:** `WishlistEntry` stores BGG identity (bggId, name, year, thumbnail) plus a prediction snapshot (score, confidence, per-axis breakdown, niche impact) captured at time of wishlisting. Separate `wishlist.json` file, not embedded in collection.\n\n**Key decisions:**\n- Only BGG games can be wishlisted (manual games have no prediction data)\n- Predictions are snapshots, not live. Explicit refresh action updates them.\n- Auto-removal: adding a wishlisted game to the collection removes the wishlist entry\n- No effect on collection-level features (fitness, profiling, niches, tournament)\n\n**API:** 6 new endpoints under `/api/wishlist` (list, add, remove, clear, refresh one, refresh all)\n\n**Web UI:** \"Wishlist\" button on search results, dedicated `/wishlist` page with sorting, sidebar nav entry between Collection and Add Game\n\n**CLI:** `shelf-judge wishlist` subcommand with list/add/remove/clear/refresh\n\n**Open question:** Whether to show a \"stale prediction\" indicator. Deferred to user feedback, spec recommends showing `addedAt` date and letting user decide when to refresh."
  - timestamp: 2026-04-12T07:33:11.773Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Finished reading all source material. Now have full picture of: the issue request, types, search/add-game UI, prediction route, storage patterns, API surface, data model, web UI design, and niche-champion-display spec (for format reference). Ready to draft the spec."
projectName: shelf-judge
---
Wrote wishlist specification to `.lore/specs/wishlist.md` (status: draft, 29 requirements, prefix WISH).

The spec defines:

**Data model:** `WishlistEntry` stores BGG identity (bggId, name, year, thumbnail) plus a prediction snapshot (score, confidence, per-axis breakdown, niche impact) captured at time of wishlisting. Separate `wishlist.json` file, not embedded in collection.

**Key decisions:**
- Only BGG games can be wishlisted (manual games have no prediction data)
- Predictions are snapshots, not live. Explicit refresh action updates them.
- Auto-removal: adding a wishlisted game to the collection removes the wishlist entry
- No effect on collection-level features (fitness, profiling, niches, tournament)

**API:** 6 new endpoints under `/api/wishlist` (list, add, remove, clear, refresh one, refresh all)

**Web UI:** "Wishlist" button on search results, dedicated `/wishlist` page with sorting, sidebar nav entry between Collection and Add Game

**CLI:** `shelf-judge wishlist` subcommand with list/add/remove/clear/refresh

**Open question:** Whether to show a "stale prediction" indicator. Deferred to user feedback, spec recommends showing `addedAt` date and letting user decide when to refresh.
