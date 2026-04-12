---
title: "Commission: Spec: Wishlist feature"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write a specification for the wishlist feature described in `.lore/issues/wishlist.md`.\n\nThe issue says: \"Add Game should allow adding to a wishlist. The wishlist should just be a list of games. It should only have preview information like on the Add Game screen. This is to help a user understand fitness.\"\n\nRead these files for context on how specs are structured and how the system works:\n- `.lore/issues/wishlist.md` (the issue)\n- `.lore/vision.md` (project principles and anti-goals)\n- `.lore/specs/mvp.md` (MVP requirements for format reference)\n- `.lore/specs/niche-champion-display.md` (recent spec for format reference)\n- `.lore/designs/data-model.md` (data model)\n- `.lore/designs/fitness-algorithm.md` (fitness/scoring)\n- `.lore/designs/api-surface.md` (API patterns)\n- `.lore/designs/web-ui.md` (web UI patterns)\n- `packages/shared/src/types.ts` (existing types)\n- `packages/daemon/src/routes/prediction.ts` (prediction/add-game flow, since wishlist extends \"Add Game\")\n- `packages/web/app/games/add/page.tsx` or similar (the Add Game screen the issue references)\n- `packages/web/lib/api.ts` (web client helpers)\n\nKey questions the spec should answer:\n- What data does a wishlist entry store? The issue says \"preview information like on the Add Game screen.\" Trace what that screen shows and define the shape.\n- How does the wishlist help the user \"understand fitness\"? What fitness information is shown per wishlist entry?\n- Where does the wishlist live in the UI? Dedicated page? Tab on collection?\n- How does a game get added to the wishlist (from search/add-game flow)?\n- How does a game get removed?\n- What happens when a wishlisted game is added to the collection? Auto-remove from wishlist?\n- Storage: separate JSON file? Extension of existing data?\n- API endpoints needed\n- CLI surface (if any)\n\nWrite the spec to `.lore/specs/wishlist.md` with status `draft`."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T07:29:12.932Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T07:29:12.934Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
