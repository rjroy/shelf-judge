---
title: "Commission: Previously Owned: Game Detail Page (Phase 5)"
date: 2026-04-13
status: pending
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 5 of the previously-owned feature: the game detail page UI.\n\n**Read these first:**\n- `.lore/plans/previously-owned.md` (Phase 5 in detail, plus the Mockup Visual Patterns section)\n- `.lore/specs/previously-owned.md` (REQ-PREV-23, REQ-PREV-24, REQ-PREV-25)\n- `.lore/mockups/mockup-previously-owned-game-detail.html` (Sienna's mockup — read for visual patterns, CSS tokens, component structure)\n- `packages/web/app/games/[id]/page.tsx` (current game detail page)\n- `packages/web/components/` (existing component patterns, especially GameActions or equivalent)\n- `packages/web/app/globals.css` (current styles)\n\n**What to build (two states from the plan):**\n- State A (previously-owned game): \"Previously Owned\" badge in hero, annotation panel below hero, breakdown table shows niche/redundancy as \"excluded\", \"Mark as Owned\" button (green `btn-success`), danger zone with \"Remove from Collection\"\n- State B (owned game): \"Owned\" badge in green, standard detail page, \"Mark as Previously Owned\" button (`btn-secondary`), danger zone with \"Remove from Collection\"\n\n**The ownership toggle action** calls `PATCH /api/daemon/games/:id/ownership` via the proxy. On success, `router.refresh()`. This is a client component (like existing GameActions).\n\n**CSS tokens from the mockup:** `.status-badge.prev-owned`, `.status-badge.owned`, `.prev-owned-notice`, `.excluded-row`, `.btn-success`, `.danger-zone` with dark mode overrides.\n\n**Verification:** `bun run typecheck`, `bun run lint`. Manual verification against both mockup states in light and dark mode."
dependencies:
  - commission-Dalton-20260412-174425
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-13T00:44:50.719Z
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
current_progress: ""
projectName: shelf-judge
---
