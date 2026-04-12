---
title: "Commission: Wishlist: Backend Foundation (Phases 1-5)"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 1-5 of the wishlist feature plan at `.lore/plans/wishlist.md`. Read that plan thoroughly before starting.\n\nThis covers:\n- **Phase 1**: Shared types (`WishlistEntry`, `WishlistBreakdownEntry`) in `packages/shared/src/types.ts`\n- **Phase 2**: Storage layer (`loadWishlist`/`saveWishlist`) in `packages/daemon/src/services/storage-service.ts`\n- **Phase 3**: Wishlist service (new file `packages/daemon/src/services/wishlist-service.ts`) with add, remove, clear, refresh, refreshAll, removeByBggId\n- **Phase 4**: Daemon routes (new file `packages/daemon/src/routes/wishlist.ts`), auto-removal in `routes/games.ts`, wiring in `app.ts`\n- **Phase 5**: Web client helpers in `packages/web/lib/api.ts`\n\nThe spec is at `.lore/specs/wishlist.md`. The plan has detailed implementation guidance for each phase.\n\nWrite tests alongside implementation (Phases 2-4). The plan's Phase 10 section lists all required test cases for service-level and route-level tests.\n\nCritical details from the plan:\n- Phase 3b (add flow): prediction snapshot extraction must handle Stage 0 (null prediction fields) correctly\n- Phase 4a: `POST /wishlist/refresh` must be registered BEFORE `POST /wishlist/:id/refresh` to avoid route collision\n- Phase 4b: auto-removal in `routes/games.ts` must be fire-and-forget (don't fail the game add if wishlist removal errors)\n- Phase 4d: add operation definitions with `hierarchy: { root: \"shelf\", feature: \"wishlist\" }`\n- Open question 3: verify the web proxy at `packages/web/app/api/daemon/[...path]/route.ts` handles DELETE method\n\nRun `bun run test`, `bun run typecheck`, and `bun run lint` before declaring complete."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T18:16:44.322Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T18:16:44.324Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
