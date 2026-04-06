---
title: "Commission: Tournament Phase 5: Web UI"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 5 from `.lore/plans/tournament-ranking.md`.\n\n**Reference the visual mockups at `.lore/visual-direction/tournament/`** (4 HTML files). These are the acceptance criteria for layout and styling.\n\n**Navigation:** Add \"Ranking\" group to sidebar with Tournament nav item.\n\n**New pages:**\n- `/tournament` (session start): active session resume banner, quick presets (\"All games\", \"Unranked\", \"Top rated\", \"Needs more data\"), custom filter builder with chips, game count preview, stats row\n- `/tournament/session` (active comparison): side-by-side game cards (stacked on mobile), \"Which would you keep?\" prompt, thumbnails, scores, \"Keep this one\" buttons, session footer with comparison count. POST comparison and fetch next pair inline (no page navigation).\n\n**Modified pages:**\n- Game detail (`/games/[id]/page.tsx`): tournament rank alongside axis fitness in hero section. Provisional qualifier. \"Not yet ranked\" state. Divergence banner (> 2.0 difference, both non-provisional). Tournament breakdown panel.\n- Collection (`/page.tsx`): sort toggle for Fitness vs Tournament rank. Tournament-sorted games with no comparisons at bottom.\n\n**API additions:** Add all tournament API functions to `packages/web/lib/api.ts`.\n\n**CSS:** New tournament styles in globals.css following the visual direction. Include responsive rules for phone/tablet.\n\nRead the plan's Phase 5 section for all details. Follow the mockup CSS closely.\n\nRun `bun run typecheck` and `bun run lint`."
dependencies:
  - commission-Dalton-20260406-153912
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T22:39:30.613Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T22:39:30.615Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-06T23:20:14.871Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-06T23:20:14.874Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
