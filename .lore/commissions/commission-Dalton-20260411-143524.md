---
title: "Commission: Implement dark mode per plan"
date: 2026-04-11
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement dark mode following the plan at `.lore/plans/dark-mode.md`. Read the full plan before starting. The plan has 9 steps; execute all of them.\n\nKey references:\n- Plan: `.lore/plans/dark-mode.md`\n- Color system spec: `.lore/designs/shelf-judge-color-system.md`\n- Current CSS: `packages/web/app/globals.css`\n- Color system principles: `.lore/reference/color-system-principles.md`\n\nSummary of the work:\n\n1. **Dark-mode color tokens** — Add `[data-theme=\"dark\"]` block in `globals.css`. Override ~31 hex roots with warm dark equivalents (warm charcoal, not cold gray). Override ~26 `color-mix()` derivations to mix toward dark base instead of white. Aliases cascade automatically.\n\n2. **Theme context and persistence** — Create `packages/web/lib/theme.ts` (loadTheme/saveTheme/resolveTheme) and `packages/web/components/theme-provider.tsx` (React context, `useTheme` hook). Follow the existing localStorage pattern from `collection-utils.ts`. Three states: light, dark, system.\n\n3. **App layout integration** — Wrap app with ThemeProvider in `layout.tsx`. Add inline anti-flash script in `<head>` that reads localStorage before React hydration.\n\n4. **Toggle UI** — Add toggle to sidebar footer (desktop) and mobile header (right side). Cycles light/dark/system with sun/moon/monitor icons.\n\n5. **Sidebar handling** — Override `--nav-bg` explicitly in dark block (darker than dark `--bg-base`). Keep `--nav-text` light. Sidebar overlay tokens cascade.\n\n6. **Contrast audit** — Run WCAG 2.1 luminance audit on all dark-mode pairings. Use bash for the calculation. Fix failures before finishing.\n\n7. **Update color system docs** — Update `.lore/designs/shelf-judge-color-system.md` per plan Step 7.\n\n8. **Tests** — Create `packages/web/tests/theme.test.ts`. Test loadTheme, saveTheme, resolveTheme with dependency injection (no mock.module). Test ThemeProvider sets data-theme.\n\n9. **Validation** — Verify all plan requirements are met.\n\n## Verification\n- `bun run typecheck` must pass\n- `bun run lint` must pass\n- `bun run test` must pass\n- Both color enforcement greps from the spec must return zero matches"
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-11T21:35:24.270Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T21:35:24.272Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
