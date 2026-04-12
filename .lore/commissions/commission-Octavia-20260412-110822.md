---
title: "Commission: Plan: Redundancy Setting Move"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Prepare an implementation plan for the issue at `.lore/issues/redundancy-setting-move.md`.\n\nThe issue: The redundancy settings UI is currently embedded in the Collection page. It needs to move to its own dedicated page under a \"Settings\" section in the sidebar (alongside the existing \"Import BGG\" and \"Axes\" entries). The new page should be called \"Redundancy\" (or similar). It also needs a Save button that both persists the settings AND triggers fitness regeneration in one action, replacing the current behavior where settings auto-save but regeneration is a separate manual step.\n\nRead the issue file, then explore the current implementation to understand:\n1. Where the redundancy settings UI currently lives in `packages/web/`\n2. How the sidebar navigation is structured\n3. How redundancy settings are persisted (daemon API)\n4. How fitness regeneration is triggered\n5. How other settings pages (Import BGG, Axes) are structured as reference patterns\n\nThen write a plan to `.lore/plans/redundancy-setting-move.md` covering:\n- What moves, what's new, what changes\n- Frontend: new page, sidebar entry, save+regenerate button\n- Daemon: any API changes needed (or confirmation none are needed)\n- Migration path (remove from Collection page, add to Settings section)\n- Ordered phases suitable for commissioning to Dalton"
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T18:08:22.285Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T18:08:22.291Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
