---
title: "Commission: Mockups: Wishlist UI"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Sienna
workerDisplayTitle: "Guild Illuminator"
prompt: "Create UI mockups for the wishlist feature specified in `.lore/specs/wishlist.md`.\n\nRead the spec first, then study the existing UI screens to match the visual language:\n- `packages/web/app/search/page.tsx` — the search/add-game page where the \"Wishlist\" button will live (REQ-WISH-18)\n- `packages/web/app/collection/page.tsx` — the collection page for layout and card patterns\n- `packages/web/app/games/[id]/page.tsx` — game detail page for component patterns\n- `packages/web/app/layout.tsx` — sidebar navigation structure (REQ-WISH-24)\n- `packages/web/app/globals.css` — color system and design tokens\n\nYou need mockups for:\n\n1. **Search page with Wishlist button** (REQ-WISH-18, REQ-WISH-19): Show a search result with both \"Add\" and \"Wishlist\" buttons. Show the \"Wishlisted\" state for a game already on the wishlist.\n\n2. **Wishlist page** (REQ-WISH-20 through REQ-WISH-23): The main wishlist view at `/wishlist`. Show:\n   - Multiple wishlist entries with thumbnail, name, year, predicted score, confidence badge\n   - Per-axis breakdown (one expanded, others collapsed)\n   - Niche impact summary on at least one entry\n   - Sort controls (date added, predicted score, name)\n   - \"Refresh All\" button in page header\n   - Per-entry buttons: \"Add to Collection\", \"Remove\", \"Refresh\"\n   - At least one entry with null prediction (\"No prediction\" state)\n\n3. **Sidebar navigation** (REQ-WISH-24): Show the updated sidebar with Wishlist positioned between Collection and Add Game.\n\nMatch the existing app's visual style exactly. Study the color system, typography, spacing, card patterns, and button styles before designing."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T13:49:45.047Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T13:49:45.049Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
