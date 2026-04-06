---
title: "Commission: Plan: Responsive Web UI for Phone and Tablet"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Review the current web application in `packages/web/` and create a plan to make it responsive for phone and tablet displays, in addition to the existing desktop layout.\n\n## Context\n\n- The web UI was built desktop-first and does not currently handle smaller viewports well.\n- The project uses Next.js 16 with CSS (globals.css for tokens/utilities, component-level styles).\n- Visual direction and mockups exist in `.lore/designs/web-ui.md` and `.lore/visual-direction/`.\n- The recent visual transition work is in the CSS foundation (`globals.css`) and all screen components.\n\n## What to do\n\n1. **Audit the current web UI.** Read all page components, layout files, and CSS. Identify what breaks or degrades at phone (~375px) and tablet (~768px) widths. Note any existing responsive patterns already in place.\n\n2. **Review the visual direction.** Check `.lore/visual-direction/` and `.lore/designs/web-ui.md` for any responsive guidance already established.\n\n3. **Write a plan** at `.lore/plans/responsive-web.md` that covers:\n   - Breakpoint strategy (phone, tablet, desktop)\n   - Per-screen layout changes needed (sidebar behavior, grid reflow, table adaptation, form layout, etc.)\n   - CSS approach (media queries in globals.css vs component-level, CSS custom properties for spacing, etc.)\n   - Ordered implementation steps with clear scope per step\n   - Which screens need the most work vs. which are close to working already\n\nThe plan should be implementable by Dalton in phased commissions. Keep it concrete: name the files, the components, the specific layout changes."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T13:13:58.162Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T13:13:58.165Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
