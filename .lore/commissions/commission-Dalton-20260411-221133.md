---
title: "Commission: Niche tag filtering: Phase 6 (Web UI)"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 6 of the niche tag filtering plan at `.lore/plans/niche-tag-filtering.md`.\n\nRead the full plan first. You are implementing:\n\n- **Phase 6a**: Web API helpers in `packages/web/lib/api.ts` — `getNicheSettings`, `updateNicheSettings`, `ignoreNicheTag`, `unignoreNicheTag`\n- **Phase 6b**: Dismiss button on `NicheEntryCard` in `packages/web/app/games/[id]/page.tsx`. Small dismiss/hide button on each niche card. On click, calls `ignoreNicheTag()` and refreshes page data. The button should feel light — no modal confirmation. A brief undo toast or the restore section (6d) is the safety net.\n- **Phase 6c**: Dismiss button on collection niche group headings in `packages/web/app/collection/page.tsx`.\n- **Phase 6d**: \"Ignored Niches\" restore section below the active niches on the game detail page and collection niche view. Shows each ignored tag as a muted chip with a restore button. Clicking restore calls `unignoreNicheTag()` and refreshes.\n\nThe plan chose Option B (inline restore section) over a separate settings page. Keep management co-located with the niche display.\n\nRun `bun run test`, `bun run typecheck`, and `bun run lint` before declaring complete."
dependencies:
  - commission-Dalton-20260411-221125
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T05:11:33.799Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T05:19:25.235Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T05:27:24.249Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T05:27:24.252Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
