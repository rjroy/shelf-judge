---
title: "Commission: Visual Transition: All Screens (Steps 4-8)"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Steps 4-8 of the visual transition plan at `.lore/plans/visual-transition.md`.\n\nRead the full plan (Steps 4-8), then also read every mockup as implementation targets:\n- `.lore/art/mockup-collection-view.html`\n- `.lore/art/mockup-game-detail.html`\n- `.lore/art/mockup-axes.html`\n- `.lore/art/mockup-bgg-import.html`\n- `.lore/designs/visual-direction.md`\n\n**Step 4: Collection View** — Restyle `page.tsx` to match the collection mockup. Stats strip, CSS Grid table (not HTML table), game rows with rank/thumbnail/info/axis chips/date/score, unrated section, row hover, empty state.\n\n**Step 5: Game Detail View** — Hero score display (52px), two-panel layout (breakdown left, rating form right), breadcrumb topbar. Rewrite `score-breakdown.tsx` with contribution bars, BGG/override row tinting, source badges, total row. Rewrite `rating-form.tsx` with sliders, BGG-derived section with override mechanism. Update `game-actions.tsx` with button classes.\n\n**Step 6: Axes Management** — Axis cards with weight bars, source tags, stats strips. Weight summary bar. Section labels (Personal/BGG-derived). Create form with dashed border. Form input styling.\n\n**Step 7: BGG Import** — Status banner with pulsing animation, progress bar with bgg-accent fill, game log with status indicators (green/grey/red circles), completion summary card with 3-column stats.\n\n**Step 8: Search/Add** — Styled search input, results list with thumbnails and Add buttons, manual add form with dashed border card, duplicate error styling.\n\n**Key constraint: No hardcoded hex values in component code.** Use only CSS custom properties from globals.css. The foundation from Steps 1-3 provides all the tokens and utility classes you need.\n\nRun `bun run typecheck` after implementation."
dependencies:
  - commission-Dalton-20260405-190606
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T02:06:19.299Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T02:08:30.947Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
