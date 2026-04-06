---
title: "Commission: Visual Transition Review: Validation Against Mockups"
date: 2026-04-06
status: pending
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Visual validation review (Step 11 of the visual transition plan at `.lore/plans/visual-transition.md`).\n\nRead these as your reference standard:\n- `.lore/designs/visual-direction.md` (every token defined here must exist in globals.css)\n- `.lore/art/mockup-collection-view.html`\n- `.lore/art/mockup-game-detail.html`\n- `.lore/art/mockup-axes.html`\n- `.lore/art/mockup-bgg-import.html`\n\nThen audit the implementation:\n\n1. Open `packages/web/app/globals.css` and verify every token from the visual direction doc is present in `:root`\n2. Read each page and component file, compare CSS class usage against the mockup structure\n3. Search for hardcoded hex colors in `.tsx` files (`grep -r \"#[0-9a-fA-F]\" packages/web/ --include=\"*.tsx\"`). Flag any that aren't in SVG icon markup.\n4. Search for remaining inline styles (`grep -r \"style={{\" packages/web/ --include=\"*.tsx\"`). Flag any that aren't genuinely dynamic values.\n5. Verify `font-variant-numeric: tabular-nums` is applied to all numerical displays (scores, weights, ratings, contribution percentages)\n6. Check that the score spectrum colors are correctly applied: `--score-high` for 7.5-10.0, `--score-mid` for 5.0-7.4, `--score-low` for 1.0-4.9\n7. Verify Inter font is loaded and configured\n8. Check sidebar: dark background, active state with amber border, correct navigation grouping\n9. Verify source badges use correct colors (personal grey, BGG blue, override purple)\n\nReport ALL findings. This is the quality gate for the visual transition."
dependencies:
  - commission-Dalton-20260405-190626
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T02:06:38.784Z
    event: created
    reason: "Commission created"
current_progress: ""
projectName: shelf-judge
---
