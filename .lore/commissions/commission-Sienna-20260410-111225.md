---
title: "Commission: Mockup: Prediction Engine UI"
date: 2026-04-10
status: completed
tags: [commission]
worker: Sienna
workerDisplayTitle: "Guild Illuminator"
prompt: "Create HTML mockups for the prediction engine UI based on the spec at `.lore/specs/prediction-engine.md`.\n\nThe prediction engine has several UI surfaces to visualize:\n\n1. **Predicted fitness score on a game detail page.** A game the user hasn't rated shows predicted per-axis scores with confidence indicators (strong/moderate/weak/insufficient). Each predicted axis shows reference games and similarity scores. Actual vs predicted axes are visually distinct.\n\n2. **Confidence breakdown.** Clicking a predicted score's confidence marker reveals: number of reference games, average similarity, rating variance, and the specific reference games that informed the prediction (e.g., \"Azul (0.87, rated 8), Patchwork (0.81, rated 7)\").\n\n3. **Tournament divergence signal.** When tournament data disagrees with axis prediction by >1 point, show both signals side by side: \"Axis prediction: 8.2 | Tournament pattern: 6.5\" with context about what that means.\n\n4. **Collection list with prediction columns.** The collection page showing predicted scores alongside actual scores, with visual distinction and sortable by prediction confidence.\n\n5. **\"Improve predictions\" prompt.** A section suggesting which games to rate to improve prediction quality, based on underrepresented mechanic/category clusters.\n\n**Design context:**\n- Read the existing web UI for visual style reference (`packages/web/`).\n- Previous mockups in `.lore/mockups/` for style conventions.\n- The profile overview mockup (if completed) for consistency, since profiling and prediction share visual language around confidence and statistical data.\n- Use realistic board game data (Azul, Wingspan, Gloomhaven, etc.) to illustrate predictions.\n- Must work responsively (phone/tablet).\n\n**Deliverable:** HTML mockup file at `.lore/mockups/prediction-engine.html` with annotated sections mapping to spec requirements."
dependencies: []
linked_artifacts:
  - .lore/mockups/prediction-engine.html

activity_timeline:
  - timestamp: 2026-04-10T18:12:25.677Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T18:21:37.667Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T18:21:37.685Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T18:21:57.183Z
    event: progress_report
    reason: "Reading spec, visual identity memory, and existing mockups before designing."
  - timestamp: 2026-04-10T18:23:03.659Z
    event: progress_report
    reason: "Context gathered. Writing the prediction engine HTML mockup covering all 5 UI surfaces: game detail with predicted score, confidence breakdown, tournament divergence, collection list, and readiness prompt."
  - timestamp: 2026-04-10T18:30:52.767Z
    event: result_submitted
    reason: "Delivered `.lore/mockups/prediction-engine.html` — 2,873 lines, 5 annotated sections covering all required UI surfaces.\n\n**Sections delivered:**\n\n1. **Game Detail: Unrated Game with Predicted Score** (REQ-PRED-14, REQ-PRED-26, REQ-PRED-11, REQ-PRED-12, REQ-PRED-13)\n   - Teal (#1a706a) score hero vs amber (#b86c1a) for actual — unambiguous color distinction\n   - ~ prefix on predicted numbers throughout\n   - Score breakdown table with predicted rows (teal wash) mixed with BGG rows (blue wash) and actual rows (plain)\n   - Confidence badges inline: Strong (green), Moderate (amber-dark), Weak (burnt orange), Insufficient (gray)\n   - Insufficient axis shown as excluded (\"excl.\") — transparent about what's missing\n   - Strategic Depth row shown with confidence panel expanded inline\n\n2. **Confidence Breakdown Popover** (REQ-PRED-12, REQ-PRED-13)\n   - Standalone panel: 3-stat grid (reference count / avg similarity / rating variance)\n   - Reference game list with similarity bars, game names, similarity scores, and axis ratings\n   - Weighted average formula shown explicitly at the bottom — satisfies transparent derivation principle\n\n3. **Tournament Divergence Signal** (REQ-PRED-16, REQ-PRED-17, REQ-PRED-28)\n   - Two signal cards: axis prediction (teal) vs tournament pattern (slate blue)\n   - Tournament neighbors listed with their normalized scores\n   - Delta shown in corner\n   - Explicit \"contextual, not a correction\" language — REQ-PRED-17 honored\n\n4. **Collection List with Prediction Columns** (REQ-PRED-24, REQ-PRED-27, REQ-PRED-14)\n   - Games sorted by predicted fitness — predicted ~7.4 sorts between actual 7.9 and 7.1\n   - Predicted rows: faint teal row wash + ~ prefix + teal score color\n   - Confidence column visible in table — no click needed for quick assessment\n   - \"Predictions on\" toggle in stats strip\n   - Sort header shows \"Pred. Fitness\" subtitle in teal\n\n5. **Prediction Readiness / \"Improve Predictions\"** (REQ-PRED-19, REQ-PRED-20, REQ-PRED-29)\n   - 4-stage timeline showing all stages with current position marked (Stage 2)\n   - Progress bar to Stage 3 (22/30 rated)\n   - Weak axes coverage bars per axis\n   - Mechanic cluster gap analysis (deck-building, wargame, deduction under-represented)\n   - Suggested actions with specific game examples\n   - Sidebar readiness widget visible at all times\n\n**Visual decisions:**\n- Deep teal (`#1a706a`) chosen for predicted — distinct from BGG slate blue, override purple, and actual amber. Four sources, four colors, all unambiguous.\n- Tournament signal reuses slate blue — tournament data shares BGG's \"external data\" provenance, so the same color convention applies.\n- Confidence breakdown shows the weighted average formula: prediction honesty over coverage.\n- Insufficient axes are shown in the table rather than hidden — the user can see what's missing."
  - timestamp: 2026-04-10T18:31:03.830Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Context gathered. Writing the prediction engine HTML mockup covering all 5 UI surfaces: game detail with predicted score, confidence breakdown, tournament divergence, collection list, and readiness prompt."
projectName: shelf-judge
---
Delivered `.lore/mockups/prediction-engine.html` — 2,873 lines, 5 annotated sections covering all required UI surfaces.

**Sections delivered:**

1. **Game Detail: Unrated Game with Predicted Score** (REQ-PRED-14, REQ-PRED-26, REQ-PRED-11, REQ-PRED-12, REQ-PRED-13)
   - Teal (#1a706a) score hero vs amber (#b86c1a) for actual — unambiguous color distinction
   - ~ prefix on predicted numbers throughout
   - Score breakdown table with predicted rows (teal wash) mixed with BGG rows (blue wash) and actual rows (plain)
   - Confidence badges inline: Strong (green), Moderate (amber-dark), Weak (burnt orange), Insufficient (gray)
   - Insufficient axis shown as excluded ("excl.") — transparent about what's missing
   - Strategic Depth row shown with confidence panel expanded inline

2. **Confidence Breakdown Popover** (REQ-PRED-12, REQ-PRED-13)
   - Standalone panel: 3-stat grid (reference count / avg similarity / rating variance)
   - Reference game list with similarity bars, game names, similarity scores, and axis ratings
   - Weighted average formula shown explicitly at the bottom — satisfies transparent derivation principle

3. **Tournament Divergence Signal** (REQ-PRED-16, REQ-PRED-17, REQ-PRED-28)
   - Two signal cards: axis prediction (teal) vs tournament pattern (slate blue)
   - Tournament neighbors listed with their normalized scores
   - Delta shown in corner
   - Explicit "contextual, not a correction" language — REQ-PRED-17 honored

4. **Collection List with Prediction Columns** (REQ-PRED-24, REQ-PRED-27, REQ-PRED-14)
   - Games sorted by predicted fitness — predicted ~7.4 sorts between actual 7.9 and 7.1
   - Predicted rows: faint teal row wash + ~ prefix + teal score color
   - Confidence column visible in table — no click needed for quick assessment
   - "Predictions on" toggle in stats strip
   - Sort header shows "Pred. Fitness" subtitle in teal

5. **Prediction Readiness / "Improve Predictions"** (REQ-PRED-19, REQ-PRED-20, REQ-PRED-29)
   - 4-stage timeline showing all stages with current position marked (Stage 2)
   - Progress bar to Stage 3 (22/30 rated)
   - Weak axes coverage bars per axis
   - Mechanic cluster gap analysis (deck-building, wargame, deduction under-represented)
   - Suggested actions with specific game examples
   - Sidebar readiness widget visible at all times

**Visual decisions:**
- Deep teal (`#1a706a`) chosen for predicted — distinct from BGG slate blue, override purple, and actual amber. Four sources, four colors, all unambiguous.
- Tournament signal reuses slate blue — tournament data shares BGG's "external data" provenance, so the same color convention applies.
- Confidence breakdown shows the weighted average formula: prediction honesty over coverage.
- Insufficient axes are shown in the table rather than hidden — the user can see what's missing.
