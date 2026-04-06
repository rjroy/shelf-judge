---
title: "Commission: Plan: Responsive Web UI for Phone and Tablet"
date: 2026-04-06
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Review the current web application in `packages/web/` and create a plan to make it responsive for phone and tablet displays, in addition to the existing desktop layout.\n\n## Context\n\n- The web UI was built desktop-first and does not currently handle smaller viewports well.\n- The project uses Next.js 16 with CSS (globals.css for tokens/utilities, component-level styles).\n- Visual direction and mockups exist in `.lore/designs/web-ui.md` and `.lore/visual-direction/`.\n- The recent visual transition work is in the CSS foundation (`globals.css`) and all screen components.\n\n## What to do\n\n1. **Audit the current web UI.** Read all page components, layout files, and CSS. Identify what breaks or degrades at phone (~375px) and tablet (~768px) widths. Note any existing responsive patterns already in place.\n\n2. **Review the visual direction.** Check `.lore/visual-direction/` and `.lore/designs/web-ui.md` for any responsive guidance already established.\n\n3. **Write a plan** at `.lore/plans/responsive-web.md` that covers:\n   - Breakpoint strategy (phone, tablet, desktop)\n   - Per-screen layout changes needed (sidebar behavior, grid reflow, table adaptation, form layout, etc.)\n   - CSS approach (media queries in globals.css vs component-level, CSS custom properties for spacing, etc.)\n   - Ordered implementation steps with clear scope per step\n   - Which screens need the most work vs. which are close to working already\n\nThe plan should be implementable by Dalton in phased commissions. Keep it concrete: name the files, the components, the specific layout changes."
dependencies: []
linked_artifacts:
  - .lore/plans/responsive-web.md

activity_timeline:
  - timestamp: 2026-04-06T13:13:58.162Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T13:13:58.165Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-06T13:13:58.185Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-06T13:14:06.513Z
    event: progress_report
    reason: "Starting audit: reading all web UI components, layout files, CSS, and visual direction docs."
  - timestamp: 2026-04-06T13:15:08.061Z
    event: progress_report
    reason: "Audit complete. Read all 5 page components, 5 shared components, and 1787 lines of CSS. Now checking the visual transition plan for any responsive guidance, then writing the plan."
  - timestamp: 2026-04-06T13:15:27.631Z
    event: progress_report
    reason: "Audit findings synthesized. Writing the responsive plan now."
  - timestamp: 2026-04-06T13:18:02.198Z
    event: result_submitted
    reason: "Created responsive web plan at `.lore/plans/responsive-web.md`.\n\nThe plan covers:\n\n**Audit findings:** Identified 7 specific layout failures at phone width (375px) and 4 at tablet (768px). The sidebar consuming 53% of a phone viewport is the root cause for most screens. Two screens (search, import) are already nearly responsive once the sidebar collapses.\n\n**Breakpoint strategy:** Three tiers at 599px, 899px, and 900px+. Desktop-first overrides via `max-width` queries to minimize churn against the existing 1787-line CSS file.\n\n**8 implementation steps:**\n1. Responsive spacing tokens (replace 7 hardcoded padding values with CSS custom properties)\n2. Sidebar collapse with hamburger toggle (highest-leverage change, one approach for both phone and tablet)\n3. Collection table redesign (card layout on phone, 5-column grid on tablet, 2x2 stats strip)\n4. Game detail reflow (hero stacks vertically, panels stack, contribution column hidden on phone)\n5. Axes card reflow (stacked grid, full-width weight bars)\n6. Search/import minor adjustments (status banner wrap, summary stats stack)\n7. Touch target polish (button padding, 16px input font to prevent iOS zoom)\n8. CSS organization and overflow audit\n\n**Commission sequence:** 5 commissions for Dalton (foundation, heavy screens, light screens, cleanup) plus Thorne review at 375px/768px/1024px."
  - timestamp: 2026-04-06T13:18:07.405Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Audit findings synthesized. Writing the responsive plan now."
projectName: shelf-judge
---
Created responsive web plan at `.lore/plans/responsive-web.md`.

The plan covers:

**Audit findings:** Identified 7 specific layout failures at phone width (375px) and 4 at tablet (768px). The sidebar consuming 53% of a phone viewport is the root cause for most screens. Two screens (search, import) are already nearly responsive once the sidebar collapses.

**Breakpoint strategy:** Three tiers at 599px, 899px, and 900px+. Desktop-first overrides via `max-width` queries to minimize churn against the existing 1787-line CSS file.

**8 implementation steps:**
1. Responsive spacing tokens (replace 7 hardcoded padding values with CSS custom properties)
2. Sidebar collapse with hamburger toggle (highest-leverage change, one approach for both phone and tablet)
3. Collection table redesign (card layout on phone, 5-column grid on tablet, 2x2 stats strip)
4. Game detail reflow (hero stacks vertically, panels stack, contribution column hidden on phone)
5. Axes card reflow (stacked grid, full-width weight bars)
6. Search/import minor adjustments (status banner wrap, summary stats stack)
7. Touch target polish (button padding, 16px input font to prevent iOS zoom)
8. CSS organization and overflow audit

**Commission sequence:** 5 commissions for Dalton (foundation, heavy screens, light screens, cleanup) plus Thorne review at 375px/768px/1024px.
