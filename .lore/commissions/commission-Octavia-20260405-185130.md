---
title: "Commission: Plan: Transition Web UI to Visual Direction"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write an implementation plan for transitioning the Shelf Judge web UI to the approved visual direction.\n\nRead these first:\n- `.lore/designs/visual-direction.md` — the approved visual direction (color tokens, typography, component language, layout)\n- `.lore/designs/mvp-web-ui.md` — the screen designs\n- `.lore/plans/mvp.md` — Phase 5 describes the web UI structure being built\n- `.lore/specs/mvp.md` — requirements context\n\nAlso examine the HTML mockups Sienna produced — these are the target look:\n- `.lore/art/mockup-collection-view.html`\n- `.lore/art/mockup-game-detail.html`\n- `.lore/art/mockup-axes.html`\n- `.lore/art/mockup-bgg-import.html`\n\n**Key constraint: All colors must be CSS custom properties (variables).** Every color in the visual direction doc defines a token name (`--bg-base`, `--text-primary`, `--score-color`, etc.). The implementation must use these tokens exclusively. No hardcoded hex values in component code. This is foundational for future theming and any additional UI surfaces that need to stay visually consistent.\n\nThe plan should cover:\n1. CSS variable system setup (where the tokens live, how they're consumed, dark theme readiness even if not implemented now)\n2. Typography system (Inter font, tabular numerals, the type scale)\n3. Layout structure (sidebar nav with dark background, content area, spacing scale)\n4. Component-by-component transition for each screen, referencing the mockups as the target\n5. Icon and favicon integration\n6. Ordering — what can be done as a single pass vs. what needs sequencing\n\nThis plan will be executed AFTER the MVP build chain completes (Phase 5 produces the functional web UI, this plan reskins it). Write it to `.lore/plans/visual-transition.md`.\n\nUse the `prep-plan` skill."
dependencies: []
linked_artifacts: []

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
current_progress: ""
projectName: shelf-judge
---
