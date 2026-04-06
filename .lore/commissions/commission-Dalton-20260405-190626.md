---
title: "Commission: Visual Transition: Icon + Cleanup (Steps 9-10)"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Steps 9-10 of the visual transition plan at `.lore/plans/visual-transition.md`.\n\n**Step 9: Icon and Favicon** — Check for icon files at `.lore/art/icon.webp`, `.lore/art/favicon-32.png`, `.lore/art/favicon-16.png`. Copy available files into the web app's public directory. Configure favicon in root layout metadata. Set page title to \"Shelf Judge\" with per-page suffixes.\n\n**Step 10: Inline Style Cleanup Sweep** — Search for `style={{` across all files in `packages/web/app/` and `packages/web/components/`. Replace every instance with CSS classes or custom property references. The only acceptable remaining inline styles are genuinely dynamic values (contribution bar widths, progress bar percentages) that depend on runtime data. Add a comment justifying any surviving inline styles.\n\nAlso search for hardcoded hex colors in `.tsx` files (grep for `#[0-9a-fA-F]`). Replace any found with CSS custom property references. The only exception is SVG icon markup.\n\nRun `bun run typecheck` after cleanup."
dependencies:
  - commission-Dalton-20260405-190619
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T02:06:26.226Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T02:08:30.944Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-06T02:16:30.299Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-06T02:16:30.302Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
