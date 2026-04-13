---
title: "Commission: Previously Owned: Collection Page (Phase 4)"
date: 2026-04-13
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 4 of the previously-owned feature: the collection page UI.\n\n**Read these first:**\n- `.lore/plans/previously-owned.md` (Phase 4 in detail, plus the Architectural Decisions and Mockup Visual Patterns sections)\n- `.lore/specs/previously-owned.md` (REQ-PREV-20, REQ-PREV-21, REQ-PREV-22)\n- `.lore/mockups/mockup-previously-owned-collection.html` (Sienna's mockup — read for visual patterns, CSS tokens, component structure)\n- `packages/web/app/collection/page.tsx` (current collection page)\n- `packages/web/app/globals.css` (current styles)\n- The existing filter/sort pattern in the collection table to determine if filters use URL search params or client-side state\n\n**What to build (three states from the plan):**\n- State A (default): Owned-only view, no visible ownership UI unless previously-owned games exist\n- State B (filters open): \"Owned Status\" filter group with segmented buttons when `previouslyOwnedCount > 0`\n- State C (toggle active): Active filter chip, info banner about niche/redundancy, previously-owned rows with muted styling, badge, dashes for niche/redundancy columns\n\n**Key architectural decision:** The ownership toggle triggers a server re-fetch (not client-side filtering) because the niche/redundancy computation universe changes. Use URL search params to keep the page as a server component.\n\n**CSS tokens from the mockup:** `--prev-owned-bg`, `--prev-owned-badge-bg`, `--prev-owned-badge-border`, `--prev-owned-badge-text` with dark mode overrides.\n\n**Verification:** `bun run typecheck`, `bun run lint`. Manual verification against mockup states A, B, C in both light and dark mode."
dependencies:
  - commission-Dalton-20260412-174425
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-13T00:44:40.823Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T01:01:48.761Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-13T01:11:25.769Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-13T01:11:25.771Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
