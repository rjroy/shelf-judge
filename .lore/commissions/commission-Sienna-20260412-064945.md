---
title: "Commission: Mockups: Wishlist UI"
date: 2026-04-12
status: completed
tags: [commission]
worker: Sienna
workerDisplayTitle: "Guild Illuminator"
prompt: "Create UI mockups for the wishlist feature specified in `.lore/specs/wishlist.md`.\n\nRead the spec first, then study the existing UI screens to match the visual language:\n- `packages/web/app/search/page.tsx` — the search/add-game page where the \"Wishlist\" button will live (REQ-WISH-18)\n- `packages/web/app/collection/page.tsx` — the collection page for layout and card patterns\n- `packages/web/app/games/[id]/page.tsx` — game detail page for component patterns\n- `packages/web/app/layout.tsx` — sidebar navigation structure (REQ-WISH-24)\n- `packages/web/app/globals.css` — color system and design tokens\n\nYou need mockups for:\n\n1. **Search page with Wishlist button** (REQ-WISH-18, REQ-WISH-19): Show a search result with both \"Add\" and \"Wishlist\" buttons. Show the \"Wishlisted\" state for a game already on the wishlist.\n\n2. **Wishlist page** (REQ-WISH-20 through REQ-WISH-23): The main wishlist view at `/wishlist`. Show:\n   - Multiple wishlist entries with thumbnail, name, year, predicted score, confidence badge\n   - Per-axis breakdown (one expanded, others collapsed)\n   - Niche impact summary on at least one entry\n   - Sort controls (date added, predicted score, name)\n   - \"Refresh All\" button in page header\n   - Per-entry buttons: \"Add to Collection\", \"Remove\", \"Refresh\"\n   - At least one entry with null prediction (\"No prediction\" state)\n\n3. **Sidebar navigation** (REQ-WISH-24): Show the updated sidebar with Wishlist positioned between Collection and Add Game.\n\nMatch the existing app's visual style exactly. Study the color system, typography, spacing, card patterns, and button styles before designing."
dependencies: []
linked_artifacts:
  - .lore/mockups/mockup-search-wishlist.html

  - .lore/mockups/mockup-wishlist.html
  - .lore/mockups/mockup-wishlist.html
activity_timeline:
  - timestamp: 2026-04-12T13:49:45.047Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T13:49:45.049Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T13:49:45.077Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T13:49:49.953Z
    event: progress_report
    reason: "Starting commission: reading spec and existing UI patterns"
  - timestamp: 2026-04-12T13:50:40.892Z
    event: progress_report
    reason: "Writing two HTML mockups: search page with wishlist integration, and the dedicated wishlist page"
  - timestamp: 2026-04-12T13:55:08.160Z
    event: result_submitted
    reason: "Created two HTML mockups for the Wishlist feature:\n\n**`.lore/mockups/mockup-search-wishlist.html`** — Search page with wishlist integration\n- Shows the updated Library nav group: Collection → Wishlist → Add Games (REQ-WISH-24)\n- Three search results demonstrating all states: default Wishlist button (outlined action-navy), Wishlisted state (green wash + checkmark), and a result with preview expanded\n- Callout note explaining the `Set<number>` preload pattern (REQ-WISH-18/19)\n- \"Wishlist\" button uses distinct visual treatment from both \"Preview\" (ghost) and \"Add\" (primary) — sits between them in the action row\n\n**`.lore/mockups/mockup-wishlist.html`** — Dedicated wishlist page\n- Topbar with title, game count, sort widget (\"Sort Date Added ▼\"), and \"Refresh All\" button (REQ-WISH-21/22)\n- Four wishlist entries covering all required states (REQ-WISH-20):\n  1. Wingspan — strong confidence, ~7.8, axis breakdown EXPANDED (4 axes with per-axis teal ratings + confidence badges), niche impact panel showing mechanic + category entries\n  2. Everdell — moderate confidence, ~6.4, axis breakdown collapsed\n  3. Root — weak confidence, ~8.2, breakdown collapsed\n  4. Spirit Island — null prediction (Stage 0), \"No prediction\" italic, inset explanation + Refresh link instead of expand toggle\n- Per-entry action column: \"Add to Collection\" (primary), \"Refresh\" (ghost + icon), \"Remove\" (danger-ghost xs)\n\n**Creative decisions:**\n- Wishlist score uses teal `#1a706a` with ~ prefix, same as prediction engine — scores are always predicted, never actual, so this is the right register\n- \"Wishlisted\" button uses success green rather than teal to distinguish \"already saved\" state from the prediction data source color\n- Card layout uses flex column for action buttons rather than inline row — reduces horizontal crowding when \"Add to Collection\" label is long\n- \"Remove\" is deliberately `btn-xs` (smaller than Refresh) to reduce accidental tap risk while keeping it accessible\n- Null-prediction entry has no expand toggle (nothing to expand), replaced with an inset prose explanation — cleaner than a disabled/empty accordion"
  - timestamp: 2026-04-12T13:55:15.175Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Writing two HTML mockups: search page with wishlist integration, and the dedicated wishlist page"
projectName: shelf-judge
---
Created two HTML mockups for the Wishlist feature:

**`.lore/mockups/mockup-search-wishlist.html`** — Search page with wishlist integration
- Shows the updated Library nav group: Collection → Wishlist → Add Games (REQ-WISH-24)
- Three search results demonstrating all states: default Wishlist button (outlined action-navy), Wishlisted state (green wash + checkmark), and a result with preview expanded
- Callout note explaining the `Set<number>` preload pattern (REQ-WISH-18/19)
- "Wishlist" button uses distinct visual treatment from both "Preview" (ghost) and "Add" (primary) — sits between them in the action row

**`.lore/mockups/mockup-wishlist.html`** — Dedicated wishlist page
- Topbar with title, game count, sort widget ("Sort Date Added ▼"), and "Refresh All" button (REQ-WISH-21/22)
- Four wishlist entries covering all required states (REQ-WISH-20):
  1. Wingspan — strong confidence, ~7.8, axis breakdown EXPANDED (4 axes with per-axis teal ratings + confidence badges), niche impact panel showing mechanic + category entries
  2. Everdell — moderate confidence, ~6.4, axis breakdown collapsed
  3. Root — weak confidence, ~8.2, breakdown collapsed
  4. Spirit Island — null prediction (Stage 0), "No prediction" italic, inset explanation + Refresh link instead of expand toggle
- Per-entry action column: "Add to Collection" (primary), "Refresh" (ghost + icon), "Remove" (danger-ghost xs)

**Creative decisions:**
- Wishlist score uses teal `#1a706a` with ~ prefix, same as prediction engine — scores are always predicted, never actual, so this is the right register
- "Wishlisted" button uses success green rather than teal to distinguish "already saved" state from the prediction data source color
- Card layout uses flex column for action buttons rather than inline row — reduces horizontal crowding when "Add to Collection" label is long
- "Remove" is deliberately `btn-xs` (smaller than Refresh) to reduce accidental tap risk while keeping it accessible
- Null-prediction entry has no expand toggle (nothing to expand), replaced with an inset prose explanation — cleaner than a disabled/empty accordion
