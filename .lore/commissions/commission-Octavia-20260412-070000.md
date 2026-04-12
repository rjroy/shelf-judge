---
title: "Commission: Plan: Wishlist implementation"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write an implementation plan for the wishlist feature specified in `.lore/specs/wishlist.md` (status: approved).\n\nFollow the plan format established in `.lore/plans/niche-tag-filtering.md` and `.lore/plans/redundancy-scoring.md` as structural references.\n\n**UI mockups are available.** Study these before writing the plan:\n- `.lore/mockups/mockup-search-wishlist.html` — search page with wishlist button\n- `.lore/mockups/mockup-wishlist.html` — dedicated wishlist page\n\nThese mockups define the visual design. The plan's web UI phases should implement what the mockups show, not invent new layouts.\n\n**Dark mode is already implemented.** The app has a dark mode system. Read the dark mode implementation to understand how it works:\n- Check `packages/web/app/globals.css` for the color system / CSS custom properties / theme setup\n- Check how existing pages handle dark mode (e.g., `packages/web/app/collection/page.tsx`, `packages/web/app/games/[id]/page.tsx`)\n- The wishlist pages must use the same dark mode patterns. Call this out explicitly in the plan's web UI phases.\n\nYour plan should include:\n\n1. **Codebase context** — Read the spec, mockups, and relevant source files. Document exact file paths, line numbers, existing patterns, and integration points.\n\n2. **Implementation phases** — Ordered steps with explicit file lists, what changes in each file, and code sketches where the approach isn't obvious.\n\n3. **Delegation guide** — Which phases can parallelize, which need sequential review gates, and what expertise each phase requires.\n\n4. **Open questions** — Anything ambiguous or with multiple valid approaches.\n\nRead these files for context:\n- `.lore/specs/wishlist.md` (the spec)\n- `.lore/mockups/mockup-search-wishlist.html` (search page mockup)\n- `.lore/mockups/mockup-wishlist.html` (wishlist page mockup)\n- `.lore/plans/niche-tag-filtering.md` (plan format reference)\n- `.lore/plans/redundancy-scoring.md` (plan format reference)\n- `packages/shared/src/types.ts` (shared types)\n- `packages/daemon/src/services/storage-service.ts` (storage pattern)\n- `packages/daemon/src/services/prediction-service.ts` (prediction service, used for wishlist add/refresh)\n- `packages/daemon/src/routes/prediction.ts` (prediction routes, reused codepath)\n- `packages/daemon/src/routes/games.ts` (game routes, collection add flow for REQ-WISH-10 auto-removal)\n- `packages/daemon/src/app.ts` (route registration)\n- `packages/web/lib/api.ts` (web client helpers)\n- `packages/web/app/search/page.tsx` (search page, wishlist button integration point)\n- `packages/web/app/collection/page.tsx` (collection page, dark mode patterns)\n- `packages/web/app/games/[id]/page.tsx` (game detail, component patterns)\n- `packages/web/app/layout.tsx` (sidebar navigation, REQ-WISH-24)\n- `packages/web/app/globals.css` (color system, dark mode tokens)\n- `packages/cli/src/commands/` (CLI command patterns)\n\nWrite the plan to `.lore/plans/wishlist.md` with status `draft`."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T14:00:00.398Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T14:00:00.402Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
