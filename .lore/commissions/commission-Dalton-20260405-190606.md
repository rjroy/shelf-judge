---
title: "Commission: Visual Transition: CSS Foundation (Steps 1-3)"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Steps 1-3 of the visual transition plan at `.lore/plans/visual-transition.md`.\n\nRead the full plan first, then also read:\n- `.lore/designs/visual-direction.md` (the approved visual direction with all token definitions)\n- `.lore/art/mockup-collection-view.html` (reference for sidebar and overall layout)\n\n**Step 1: CSS Foundation** — Create `packages/web/app/globals.css` with all CSS custom properties from the visual direction doc. Set up Inter font via `next/font/google` in layout.tsx. Add base styles (box-sizing reset, body defaults, tabular-nums utility, label-caps utility). Import globals.css in layout.tsx.\n\n**Step 2: Layout Shell** — Replace the inline-styled sidebar with the dark nav panel. Extract sidebar into `components/sidebar.tsx` client component (needs `usePathname()`). Match the mockup: dark background, grouped nav items with SVG icons, active state with amber left border, brand section with icon.\n\n**Step 3: Shared UI Components** — Add button classes (primary, secondary, danger, danger-outline, ghost, sm). Add source badge classes (personal, bgg, override). Rewrite `score-badge.tsx` to use score spectrum colors (dot indicator + range-based coloring). Add topbar pattern class. Update `refresh-all-button.tsx` to use button classes.\n\n**Key constraint: No hardcoded hex values in component code.** Every color reference must use a CSS custom property. The only hex values in the entire web package should be in `globals.css` `:root` block.\n\nRun `bun run typecheck` after implementation to verify no type errors."
dependencies:
  - commission-Dalton-20260405-121733
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T02:06:06.650Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T02:06:06.653Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
