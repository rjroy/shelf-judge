---
title: "Commission: Mockup: Previously Owned State UI"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Sienna
workerDisplayTitle: "Guild Illuminator"
prompt: "Create UI mockups for the Previously Owned State feature based on the spec at `.lore/specs/previously-owned.md`.\n\n**Context:** Shelf Judge is a board game collection curation tool. The web UI is a Next.js app at `packages/web/`. Read the existing pages and components to understand the current visual language before designing.\n\n**Key files to read first:**\n- `.lore/specs/previously-owned.md` (the spec you're mocking up)\n- `packages/web/app/collection/page.tsx` (current collection page)\n- `packages/web/app/game/[id]/page.tsx` (current game detail page)\n- `packages/web/app/globals.css` (current styles, colors, dark mode)\n- `packages/web/components/` (existing component patterns)\n\n**What to mock up:**\n\n1. **Collection page with ownership filter** — Show the collection table with a \"Show Previously Owned\" toggle in the filter bar alongside existing filters. Show what the table looks like with the toggle on: previously-owned games should be visually distinct (muted style, badge, or subtle indicator).\n\n2. **Game detail page for a previously-owned game** — Show ratings, fitness score, and breakdown as normal, but with annotation that niche/redundancy are excluded. Include the \"Mark as Owned\" action to reverse the status.\n\n3. **Game detail page status toggle** — Show the \"Mark as Previously Owned\" action on an owned game's detail page, alongside the existing \"Remove from Collection\" (permanent delete). Make it clear these are different actions with different consequences.\n\n**Design direction:**\n- Match the existing app's visual language (read the CSS and components first)\n- Previously-owned games should be distinguishable at a glance but not jarring\n- The status toggle should feel safe and reversible, unlike the destructive delete action\n- Support both light and dark mode if the app has dark mode"
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T21:15:55.311Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T21:15:55.313Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
