---
title: "Commission: Plan niche tag ignore list configuration"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Use the `/lore-development:prep-plan` skill to create an implementation plan for configurable niche tag filtering.\n\n## Problem\n\nThe niche champion display groups games by mechanics, categories, and families. Some tags produce uninteresting niches, for example:\n- `family: \"Crowdfunding: Kickstarter\"` — tells you nothing about gameplay\n- `family: \"Players: Solitaire Only Games\"` — player count is already a separate dimension\n- Many other families, and potentially some mechanics/categories, are noise\n\nDiscovering which tags are noise isn't simple (the user learns over time as they see useless niches). But being able to define and maintain a list of tags to ignore would solve it.\n\n## What to plan\n\nA user-configurable ignore list for niche tags. Consider:\n\n1. **Data model**: A list of ignored tags (type + name pairs, e.g., `{ type: \"family\", name: \"Crowdfunding: Kickstarter\" }`). Where does this live? Likely a settings file following the `prediction-settings.json` / `redundancy-settings.json` pattern.\n\n2. **API surface**: CRUD for the ignore list. GET/PATCH following the existing settings pattern. The niche engine consumes the ignore list when computing positions.\n\n3. **Discovery UX**: How does the user add tags to the ignore list? Options include:\n   - A dismiss/hide button on each niche entry in the game detail view (\"I don't care about this niche\")\n   - A settings page listing all known tags with toggle switches\n   - CLI command to manage the list\n   - Some combination\n\n4. **Integration with niche engine**: `computeNichePositions` and `computeNicheImpact` need to accept the ignore list and filter out matching tags before grouping. This is a simple filter step early in the algorithm.\n\n5. **Persistence**: Where the list is stored, how it's loaded, how it flows through the daemon service layer.\n\nRead the niche champion display spec at `.lore/specs/niche-champion-display.md` and the existing plan at `.lore/plans/niche-champion-display.md` to understand the current architecture. Read the prediction settings pattern (`prediction-settings.json`, its routes, and its service) as the model to follow.\n\nOutput the plan to `.lore/plans/` following the prep-plan skill conventions."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T01:39:20.490Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T01:39:20.492Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
