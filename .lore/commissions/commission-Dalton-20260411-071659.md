---
title: "Commission: Consolidate CSS color variables in globals.css"
date: 2026-04-11
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "The project has too many color values defined in CSS. Colors that are close but not identical should be consolidated, and all color usage should go through CSS custom properties (`var(--...)`).\n\n## Task\n\n1. **Audit `globals.css`** (likely in `packages/web/`) for all color definitions. Use bash to extract and count unique color values across the file. Look for:\n   - Colors that are very close but not identical (e.g., `#f5f5f5` vs `#f4f4f4`, or `hsl(220, 10%, 95%)` vs `hsl(220, 12%, 96%)`)\n   - Hard-coded color values that should be variables\n   - Redundant variables that serve the same semantic purpose\n\n2. **Consolidate** close-but-different colors into a sensible, minimal palette. Use bash tooling to compare color values numerically if needed (convert hex to RGB, compute distance). Merge colors that are perceptually near-identical.\n\n3. **Ensure all color usage goes through `var(--...)`**. Grep the entire `packages/web/` directory for hard-coded color values in CSS/TSX files and replace them with the appropriate variable references.\n\n4. **Preserve dark mode support** if light/dark theme variables exist. Don't break the theme system.\n\n## Verification\n- `bun run typecheck` must pass\n- `bun run lint` must pass\n- `bun run test` must pass\n- Run a final grep across `packages/web/` for any remaining hard-coded hex colors or rgb/hsl values in stylesheets and component files. Report what you find."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-11T14:16:59.365Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T14:16:59.367Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
