---
title: "Commission: Wishlist: Add BGG Link to Entries"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Add a link to the BGG page on each wishlist entry in the web UI.\n\n**Issue:** `.lore/issues/wishlist-link-to-bgg.md` — \"Wishlist entries should have a link to the BGG page.\"\n\n**Context:**\n- The wishlist page is at `packages/web/app/wishlist/page.tsx`\n- The collection and game detail pages already link game names to BGG using a `game-link` CSS class. Read `packages/web/app/globals.css` for the `.game-link` styles, and read the collection page (`packages/web/app/collection/page.tsx`) or game detail page (`packages/web/app/game/[id]/page.tsx`) to see how BGG links are constructed.\n- BGG game URLs follow the pattern `https://boardgamegeek.com/boardgame/{bggId}`\n- Wishlist entries have BGG data (they come from BGG search). Check the WishlistEntry type in `packages/shared/src/types.ts` for the field that holds the BGG ID.\n\n**What to do:**\n1. Make the game name in each wishlist entry a link to its BGG page, matching the existing `game-link` pattern used elsewhere in the app\n2. Write or update tests to verify the link is present\n3. Update the issue status to `closed` in `.lore/issues/wishlist-link-to-bgg.md`\n4. Run `bun run test`, `bun run typecheck`, and `bun run lint` before finishing"
dependencies: []
linked_artifacts: []

resource_overrides:
  model: sonnet

activity_timeline:
  - timestamp: 2026-04-12T23:17:34.185Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T23:17:34.187Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
