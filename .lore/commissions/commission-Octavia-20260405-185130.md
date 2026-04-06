---
title: "Commission: Plan: Transition Web UI to Visual Direction"
date: 2026-04-06
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write an implementation plan for transitioning the Shelf Judge web UI to the approved visual direction.\n\nRead these first:\n- `.lore/designs/visual-direction.md` — the approved visual direction (color tokens, typography, component language, layout)\n- `.lore/designs/mvp-web-ui.md` — the screen designs\n- `.lore/plans/mvp.md` — Phase 5 describes the web UI structure being built\n- `.lore/specs/mvp.md` — requirements context\n\nAlso examine the HTML mockups Sienna produced — these are the target look:\n- `.lore/art/mockup-collection-view.html`\n- `.lore/art/mockup-game-detail.html`\n- `.lore/art/mockup-axes.html`\n- `.lore/art/mockup-bgg-import.html`\n\n**Key constraint: All colors must be CSS custom properties (variables).** Every color in the visual direction doc defines a token name (`--bg-base`, `--text-primary`, `--score-color`, etc.). The implementation must use these tokens exclusively. No hardcoded hex values in component code. This is foundational for future theming and any additional UI surfaces that need to stay visually consistent.\n\nThe plan should cover:\n1. CSS variable system setup (where the tokens live, how they're consumed, dark theme readiness even if not implemented now)\n2. Typography system (Inter font, tabular numerals, the type scale)\n3. Layout structure (sidebar nav with dark background, content area, spacing scale)\n4. Component-by-component transition for each screen, referencing the mockups as the target\n5. Icon and favicon integration\n6. Ordering — what can be done as a single pass vs. what needs sequencing\n\nThis plan will be executed AFTER the MVP build chain completes (Phase 5 produces the functional web UI, this plan reskins it). Write it to `.lore/plans/visual-transition.md`.\n\nUse the `prep-plan` skill."
dependencies: []
linked_artifacts:
  - .lore/plans/visual-transition.md

resource_overrides:
  model: opus

activity_timeline:
  - timestamp: 2026-04-06T01:51:30.259Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T01:51:30.262Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-06T01:51:30.281Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-06T01:51:36.859Z
    event: progress_report
    reason: "Starting visual transition plan. Reading approved visual direction, screen designs, MVP plan, specs, and HTML mockups."
  - timestamp: 2026-04-06T01:52:32.137Z
    event: progress_report
    reason: "All source materials read. Drafting the visual transition plan now. Key inputs: visual direction doc (color tokens, typography, spacing, component language), 4 HTML mockups (collection, game detail, axes, BGG import), MVP plan Phase 5 structure, and spec requirements."
  - timestamp: 2026-04-06T01:56:27.172Z
    event: progress_report
    reason: "Plan drafted and saved to .lore/plans/visual-transition.md. Running fresh-eyes plan review now."
  - timestamp: 2026-04-06T02:00:40.251Z
    event: result_submitted
    reason: "Wrote the visual transition implementation plan to `.lore/plans/visual-transition.md` (420 lines, status: draft).\n\nThe plan covers 11 steps across 4 recommended commissions:\n\n1. **CSS Foundation** (Step 1): Custom properties for all 30+ tokens from the visual direction doc, Inter font via next/font, base reset and utility classes in a new `globals.css`\n2. **Layout Shell** (Step 2): Dark sidebar nav with brand, section labels, SVG icons, active/hover states, extracted as a client component for `usePathname()`\n3. **Shared Components** (Step 3): Button tier system (primary/secondary/danger-outline/ghost), source badges, score badge rewrite with spectrum colors, topbar pattern, refresh-all button\n4. **Per-screen transition** (Steps 4-8): Collection view (grid layout, stats strip, score dots, axis chips, empty state), game detail (hero score, two-panel breakdown + rating form), axes management (cards with weight bars, edit/create forms), BGG import (status banner, progress bar, game log, completion summary), search/add\n5. **Icon and cleanup** (Steps 9-10): Favicon integration, final inline style sweep\n6. **Visual validation** (Step 11): Fresh-context review comparing implementation against mockups\n\nKey decisions made:\n- `--score-hero` token set to 52px (matches mockup, diverges from visual direction doc's 40px)\n- Added `.btn-danger-outline` variant to handle the two different danger button styles across mockups\n- All styles in a single `globals.css` for MVP simplicity\n- Commission sequence: foundation (Dalton) → all screens (Dalton) → icon+cleanup (Dalton) → validation (Thorne)\n\nFresh-eyes review completed by plan-reviewer agent. All three priority findings addressed: score hero size conflict resolved, collection grid structure corrected, import completion summary added. Six minor findings also fixed (nav hover state, empty state, axes edit state, refresh-all-button coverage, search form pattern reference, danger button variants)."
  - timestamp: 2026-04-06T02:00:45.626Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Plan drafted and saved to .lore/plans/visual-transition.md. Running fresh-eyes plan review now."
projectName: shelf-judge
---
Wrote the visual transition implementation plan to `.lore/plans/visual-transition.md` (420 lines, status: draft).

The plan covers 11 steps across 4 recommended commissions:

1. **CSS Foundation** (Step 1): Custom properties for all 30+ tokens from the visual direction doc, Inter font via next/font, base reset and utility classes in a new `globals.css`
2. **Layout Shell** (Step 2): Dark sidebar nav with brand, section labels, SVG icons, active/hover states, extracted as a client component for `usePathname()`
3. **Shared Components** (Step 3): Button tier system (primary/secondary/danger-outline/ghost), source badges, score badge rewrite with spectrum colors, topbar pattern, refresh-all button
4. **Per-screen transition** (Steps 4-8): Collection view (grid layout, stats strip, score dots, axis chips, empty state), game detail (hero score, two-panel breakdown + rating form), axes management (cards with weight bars, edit/create forms), BGG import (status banner, progress bar, game log, completion summary), search/add
5. **Icon and cleanup** (Steps 9-10): Favicon integration, final inline style sweep
6. **Visual validation** (Step 11): Fresh-context review comparing implementation against mockups

Key decisions made:
- `--score-hero` token set to 52px (matches mockup, diverges from visual direction doc's 40px)
- Added `.btn-danger-outline` variant to handle the two different danger button styles across mockups
- All styles in a single `globals.css` for MVP simplicity
- Commission sequence: foundation (Dalton) → all screens (Dalton) → icon+cleanup (Dalton) → validation (Thorne)

Fresh-eyes review completed by plan-reviewer agent. All three priority findings addressed: score hero size conflict resolved, collection grid structure corrected, import completion summary added. Six minor findings also fixed (nav hover state, empty state, axes edit state, refresh-all-button coverage, search form pattern reference, danger button variants).
