---
title: "Commission: Mockup: Prediction Engine UI"
date: 2026-04-10
status: dispatched
tags: [commission]
worker: Sienna
workerDisplayTitle: "Guild Illuminator"
prompt: "Create HTML mockups for the prediction engine UI based on the spec at `.lore/specs/prediction-engine.md`.\n\nThe prediction engine has several UI surfaces to visualize:\n\n1. **Predicted fitness score on a game detail page.** A game the user hasn't rated shows predicted per-axis scores with confidence indicators (strong/moderate/weak/insufficient). Each predicted axis shows reference games and similarity scores. Actual vs predicted axes are visually distinct.\n\n2. **Confidence breakdown.** Clicking a predicted score's confidence marker reveals: number of reference games, average similarity, rating variance, and the specific reference games that informed the prediction (e.g., \"Azul (0.87, rated 8), Patchwork (0.81, rated 7)\").\n\n3. **Tournament divergence signal.** When tournament data disagrees with axis prediction by >1 point, show both signals side by side: \"Axis prediction: 8.2 | Tournament pattern: 6.5\" with context about what that means.\n\n4. **Collection list with prediction columns.** The collection page showing predicted scores alongside actual scores, with visual distinction and sortable by prediction confidence.\n\n5. **\"Improve predictions\" prompt.** A section suggesting which games to rate to improve prediction quality, based on underrepresented mechanic/category clusters.\n\n**Design context:**\n- Read the existing web UI for visual style reference (`packages/web/`).\n- Previous mockups in `.lore/mockups/` for style conventions.\n- The profile overview mockup (if completed) for consistency, since profiling and prediction share visual language around confidence and statistical data.\n- Use realistic board game data (Azul, Wingspan, Gloomhaven, etc.) to illustrate predictions.\n- Must work responsively (phone/tablet).\n\n**Deliverable:** HTML mockup file at `.lore/mockups/prediction-engine.html` with annotated sections mapping to spec requirements."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T18:12:25.677Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T18:21:37.667Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
