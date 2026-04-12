---
title: "Commission: Wishlist: Web UI (Phases 6-8)"
date: 2026-04-12
status: blocked
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 6-8 of the wishlist feature plan at `.lore/plans/wishlist.md`. Read that plan thoroughly before starting.\n\nThis covers:\n- **Phase 6**: Search page wishlist button (`packages/web/app/search/page.tsx`) - fetch wishlisted IDs on mount, add Wishlist/Wishlisted button per result, CSS classes\n- **Phase 7**: Wishlist page (new `packages/web/app/wishlist/page.tsx`) - the main wishlist view with cards, sort, expand/collapse, refresh, remove, add-to-collection\n- **Phase 8**: Sidebar navigation (`packages/web/components/sidebar.tsx`) - add Wishlist nav item between Collection and Add Games\n\nThe spec is at `.lore/specs/wishlist.md`. The mockup is at `.lore/mockups/mockup-wishlist.html`.\n\nCritical details from the plan:\n- Phase 6: Wishlist fetch on mount must NOT block search result display (fetch in parallel)\n- Phase 6: Optimistic update on wishlist add, 409 errors shown in existing error banner\n- Phase 7: Reproduce the mockup faithfully. All four card states must render: strong confidence expanded, moderate collapsed, weak collapsed, null prediction\n- Phase 7: \"Add to Collection\" navigates to `/games/{newGameId}` after success (extract game ID from POST /games response)\n- Phase 7: All CSS uses existing design tokens (no new dark mode overrides needed)\n- Phase 7: Empty state with link to search page\n- Phase 8: Sidebar order must be Collection, Wishlist, Add Games\n\nVerify in both light and dark mode. Run `bun run typecheck` and `bun run lint` before declaring complete."
dependencies:
  - commission-Dalton-20260412-111701
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T18:17:14.146Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T18:17:14.148Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
current_progress: ""
projectName: shelf-judge
---
