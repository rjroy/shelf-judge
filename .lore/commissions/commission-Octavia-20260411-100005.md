---
title: "Commission: Plan dark mode implementation"
date: 2026-04-11
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Use the `/lore-development:prep-plan` skill to create an implementation plan for dark mode.\n\nThe issue is at `.lore/issues/dark-mode.md`. Key requirements:\n- Dark mode toggle available on the tab (likely the nav/header area)\n- Define a second set of colors in `globals.css` using CSS custom properties\n- Reference `.lore/designs/shelf-judge-color-system.md` for the existing color system\n\nAlso note: Sienna is currently producing a color palette review at `.lore/designs/color-palette-review.md` (commission-Sienna-20260411-082730). If that file exists by the time you start, read it and factor its recommendations into the dark mode plan. The color consolidation work may reshape what variables dark mode needs to override.\n\nAdditionally, Dalton just consolidated all color usage to `var()` references (commission-Dalton-20260411-071659). Read the current state of `packages/web/app/globals.css` to understand the variable structure you're planning against.\n\nOutput the plan to `.lore/plans/` following the prep-plan skill conventions."
dependencies: []
linked_artifacts:
  - .lore/plans/dark-mode.md

activity_timeline:
  - timestamp: 2026-04-11T17:00:05.297Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T17:00:05.298Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-11T17:00:05.322Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-11T17:00:21.536Z
    event: progress_report
    reason: "Starting dark mode plan prep. Reading the issue, color system design, current globals.css, and checking for Sienna's color palette review."
  - timestamp: 2026-04-11T17:01:16.319Z
    event: progress_report
    reason: "Context gathered: read issue, color system design, globals.css variable structure (117 color tokens in :root), sidebar component (sidebar.tsx), and topbar CSS. Sienna's color palette review not yet available. Invoking prep-plan skill."
  - timestamp: 2026-04-11T17:03:38.301Z
    event: progress_report
    reason: "All context gathered. Key finding: color system is Architecture B (single-theme). Plan will use [data-theme=\"dark\"] override approach rather than full Architecture A migration, since derivations auto-cascade from root overrides. Drafting plan now."
  - timestamp: 2026-04-11T17:08:58.487Z
    event: result_submitted
    reason: "Created implementation plan for dark mode at `.lore/plans/dark-mode.md`.\n\nThe plan covers 9 steps: dark-mode CSS token overrides via `[data-theme=\"dark\"]` block, theme context and localStorage persistence, app layout wiring with anti-flash script, toggle UI in sidebar footer and mobile header, sidebar color chain fix, WCAG AA contrast audit, color system documentation update, tests, and goal validation.\n\nKey architectural decision: stay on Architecture B (semantic roots with derivations) rather than migrating to Architecture A. The `color-mix()` derivations and `var()` aliases cascade automatically when the ~34 hex roots are overridden, but derivations must be re-pointed to mix toward the dark base instead of white. \"Kept explicit\" tokens and placeholder gradient tokens are called out as needing manual dark-mode values.\n\nFresh-eyes review completed. Three priority issues were identified and resolved in the plan:\n1. `--placeholder-from` and `--placeholder-to` gradient tokens will break in dark mode (now addressed in Step 1)\n2. Anti-flash script placement in Next.js App Router needed specificity (now clarified in Step 3)\n3. `--nav-text` must stay fixed at `#e8e4dc` in dark mode to preserve sidebar overlay cascades (now committed in Step 5)"
  - timestamp: 2026-04-11T17:09:05.276Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All context gathered. Key finding: color system is Architecture B (single-theme). Plan will use [data-theme=\"dark\"] override approach rather than full Architecture A migration, since derivations auto-cascade from root overrides. Drafting plan now."
projectName: shelf-judge
---
Created implementation plan for dark mode at `.lore/plans/dark-mode.md`.

The plan covers 9 steps: dark-mode CSS token overrides via `[data-theme="dark"]` block, theme context and localStorage persistence, app layout wiring with anti-flash script, toggle UI in sidebar footer and mobile header, sidebar color chain fix, WCAG AA contrast audit, color system documentation update, tests, and goal validation.

Key architectural decision: stay on Architecture B (semantic roots with derivations) rather than migrating to Architecture A. The `color-mix()` derivations and `var()` aliases cascade automatically when the ~34 hex roots are overridden, but derivations must be re-pointed to mix toward the dark base instead of white. "Kept explicit" tokens and placeholder gradient tokens are called out as needing manual dark-mode values.

Fresh-eyes review completed. Three priority issues were identified and resolved in the plan:
1. `--placeholder-from` and `--placeholder-to` gradient tokens will break in dark mode (now addressed in Step 1)
2. Anti-flash script placement in Next.js App Router needed specificity (now clarified in Step 3)
3. `--nav-text` must stay fixed at `#e8e4dc` in dark mode to preserve sidebar overlay cascades (now committed in Step 5)
