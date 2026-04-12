---
title: "Commission: Wishlist: Web UI (Phases 6-8)"
date: 2026-04-12
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 6-8 of the wishlist feature plan at `.lore/plans/wishlist.md`. Read that plan thoroughly before starting.\n\nThis covers:\n- **Phase 6**: Search page wishlist button (`packages/web/app/search/page.tsx`) - fetch wishlisted IDs on mount, add Wishlist/Wishlisted button per result, CSS classes\n- **Phase 7**: Wishlist page (new `packages/web/app/wishlist/page.tsx`) - the main wishlist view with cards, sort, expand/collapse, refresh, remove, add-to-collection\n- **Phase 8**: Sidebar navigation (`packages/web/components/sidebar.tsx`) - add Wishlist nav item between Collection and Add Games\n\nThe spec is at `.lore/specs/wishlist.md`. The mockup is at `.lore/mockups/mockup-wishlist.html`.\n\nCritical details from the plan:\n- Phase 6: Wishlist fetch on mount must NOT block search result display (fetch in parallel)\n- Phase 6: Optimistic update on wishlist add, 409 errors shown in existing error banner\n- Phase 7: Reproduce the mockup faithfully. All four card states must render: strong confidence expanded, moderate collapsed, weak collapsed, null prediction\n- Phase 7: \"Add to Collection\" navigates to `/games/{newGameId}` after success (extract game ID from POST /games response)\n- Phase 7: All CSS uses existing design tokens (no new dark mode overrides needed)\n- Phase 7: Empty state with link to search page\n- Phase 8: Sidebar order must be Collection, Wishlist, Add Games\n\nVerify in both light and dark mode. Run `bun run typecheck` and `bun run lint` before declaring complete."
dependencies:
  - commission-Dalton-20260412-111701
linked_artifacts:
  - packages/web/app/search/page.tsx

  - packages/web/app/wishlist/page.tsx
  - packages/web/components/sidebar.tsx
  - packages/web/app/globals.css
  - packages/web/app/wishlist/page.tsx
  - packages/web/components/sidebar.tsx
  - packages/web/app/globals.css
activity_timeline:
  - timestamp: 2026-04-12T18:17:14.146Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T18:17:14.148Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T18:37:27.437Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T18:37:27.439Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T18:37:27.462Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T18:37:47.367Z
    event: progress_report
    reason: "Reading existing files: search page, sidebar, globals.css, web API helpers, and the mockup. Phases 1-5 (backend) are complete from prior commission."
  - timestamp: 2026-04-12T18:39:48.934Z
    event: progress_report
    reason: "Context gathered. Starting implementation: Phase 6 (search page wishlist button), Phase 7 (wishlist page), Phase 8 (sidebar nav). Working on all three now."
  - timestamp: 2026-04-12T18:44:39.516Z
    event: progress_report
    reason: "All three phases implemented. Phase 6: Search page wishlist button with optimistic updates. Phase 7: Full wishlist page with sort, expand/collapse, refresh, remove, add-to-collection. Phase 8: Sidebar nav with Wishlist between Collection and Add Games. Typecheck, lint, and 1014 tests all pass."
  - timestamp: 2026-04-12T18:44:59.628Z
    event: result_submitted
    reason: "# Phases 6-8: Web UI Complete\n\n## Phase 6: Search Page Wishlist Button (`packages/web/app/search/page.tsx`)\n- Added `wishlistedIds` state (`Set<number>`) populated from `GET /api/daemon/wishlist` on mount\n- Wishlist fetch runs in parallel with search, does not block result display\n- Wishlist button per result: \"Wishlist\" with circle-plus icon (default), \"Wishlisted\" with checkmark (already wishlisted)\n- Optimistic update on wishlist add; reverts on failure\n- 409 errors (already wishlisted or in collection) shown in existing error banner\n- Loading state with \"...\" during wishlist POST\n\n## Phase 7: Wishlist Page (new `packages/web/app/wishlist/page.tsx`)\n- All four card states from mockup render correctly:\n  - Score with confidence badge (strong/moderate/weak)\n  - Expandable per-axis breakdown with small confidence badges\n  - Niche impact panel (inside expanded view)\n  - Null prediction state with \"Refresh to check again\" link\n- Sort: Date Added (default, newest first), Predicted Score (desc, nulls last), Name (alpha)\n- Actions: Add to Collection (navigates to `/games/{newGameId}`), Refresh (per-entry), Remove (immediate, no confirm)\n- Refresh All button in topbar, refetches full list after completion\n- Clear All as subtle link below list, with `confirm()` prompt\n- Empty state with link to search page\n- All CSS uses existing design tokens, no new dark mode overrides needed\n\n## Phase 8: Sidebar Navigation (`packages/web/components/sidebar.tsx`)\n- Wishlist nav item inserted between Collection and Add Games in the Library group\n- Uses list/receipt icon from mockup SVG\n- Highlights correctly via existing `isActive()` logic\n\n## CSS Added (`packages/web/app/globals.css`)\n- `.btn-wishlist` / `.btn-wishlisted` for search page button states\n- `.sort-widget` / `.sort-widget-label` for the sort dropdown trigger\n- Full wishlist card system: `.wishlist-card`, `.wc-main`, `.wc-thumb`, `.wc-info`, `.wc-score-row`, `.wc-score`, `.wc-actions`, `.wc-expand`, `.wc-expand-toggle`, `.wc-breakdown`, axis breakdown rows, niche impact panel, no-prediction panel\n- Empty state and clear-all styles\n\n## Verification\n- `bun run typecheck`: clean\n- `bun run lint`: clean\n- `bun run test`: 1014 pass, 1 skip, 0 fail\n- `bun run format:check`: clean"
  - timestamp: 2026-04-12T18:45:12.141Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All three phases implemented. Phase 6: Search page wishlist button with optimistic updates. Phase 7: Full wishlist page with sort, expand/collapse, refresh, remove, add-to-collection. Phase 8: Sidebar nav with Wishlist between Collection and Add Games. Typecheck, lint, and 1014 tests all pass."
projectName: shelf-judge
---
# Phases 6-8: Web UI Complete

## Phase 6: Search Page Wishlist Button (`packages/web/app/search/page.tsx`)
- Added `wishlistedIds` state (`Set<number>`) populated from `GET /api/daemon/wishlist` on mount
- Wishlist fetch runs in parallel with search, does not block result display
- Wishlist button per result: "Wishlist" with circle-plus icon (default), "Wishlisted" with checkmark (already wishlisted)
- Optimistic update on wishlist add; reverts on failure
- 409 errors (already wishlisted or in collection) shown in existing error banner
- Loading state with "..." during wishlist POST

## Phase 7: Wishlist Page (new `packages/web/app/wishlist/page.tsx`)
- All four card states from mockup render correctly:
  - Score with confidence badge (strong/moderate/weak)
  - Expandable per-axis breakdown with small confidence badges
  - Niche impact panel (inside expanded view)
  - Null prediction state with "Refresh to check again" link
- Sort: Date Added (default, newest first), Predicted Score (desc, nulls last), Name (alpha)
- Actions: Add to Collection (navigates to `/games/{newGameId}`), Refresh (per-entry), Remove (immediate, no confirm)
- Refresh All button in topbar, refetches full list after completion
- Clear All as subtle link below list, with `confirm()` prompt
- Empty state with link to search page
- All CSS uses existing design tokens, no new dark mode overrides needed

## Phase 8: Sidebar Navigation (`packages/web/components/sidebar.tsx`)
- Wishlist nav item inserted between Collection and Add Games in the Library group
- Uses list/receipt icon from mockup SVG
- Highlights correctly via existing `isActive()` logic

## CSS Added (`packages/web/app/globals.css`)
- `.btn-wishlist` / `.btn-wishlisted` for search page button states
- `.sort-widget` / `.sort-widget-label` for the sort dropdown trigger
- Full wishlist card system: `.wishlist-card`, `.wc-main`, `.wc-thumb`, `.wc-info`, `.wc-score-row`, `.wc-score`, `.wc-actions`, `.wc-expand`, `.wc-expand-toggle`, `.wc-breakdown`, axis breakdown rows, niche impact panel, no-prediction panel
- Empty state and clear-all styles

## Verification
- `bun run typecheck`: clean
- `bun run lint`: clean
- `bun run test`: 1014 pass, 1 skip, 0 fail
- `bun run format:check`: clean
