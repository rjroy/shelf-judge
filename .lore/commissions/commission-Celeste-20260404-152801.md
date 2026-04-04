---
title: "Commission: Brainstorm fitness score model options"
date: 2026-04-04
status: dispatched
tags: [commission]
worker: Celeste
workerDisplayTitle: "Guild Visionary"
prompt: "Read the project vision at `.lore/vision.md` and the architecture pattern at `.lore/reference/architecture-pattern.md` to ground yourself.\n\nYour task: brainstorm multiple viable approaches to the **fitness score model** for shelf-judge. This is the core math that turns multi-axis personal ratings + BGG data into a single fitness number per game.\n\nKey constraints from the vision:\n- Users define their own rating axes (not a fixed set)\n- Users weight those axes according to personal importance\n- BGG data (community rating, weight, mechanics, categories, player count) feeds in as context, not authority\n- The fitness score must be transparent and decomposable (\"why did this game score X?\")\n- Fitness is collection-aware: redundancy among owned games affects scores\n- The system must predict fitness for unowned games from partial data\n- \"Insufficient data\" is better than a confident wrong number\n\nFor each approach, address:\n1. **How user-defined axes work** — how users create, rate, and weight custom axes\n2. **How BGG data integrates** — as derived axes, normalization inputs, or something else\n3. **The aggregation function** — how axes combine into one number (weighted average, geometric mean, ranked pairs, etc.)\n4. **Redundancy/collection-awareness** — how owning similar games affects fitness\n5. **Prediction for unowned games** — how the system estimates fitness without personal ratings\n6. **Transparency** — how the score breaks down for the user\n7. **Edge cases** — what happens with 1 axis, 0 ratings, conflicting signals\n\nExplore at least 3 meaningfully different approaches. Don't converge prematurely. Name tradeoffs honestly.\n\nWrite the brainstorm artifact to `.lore/brainstorms/fitness-model-options.md`."
dependencies: []
linked_artifacts: []

resource_overrides:
  model: sonnet

activity_timeline:
  - timestamp: 2026-04-04T22:28:01.359Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-04T22:28:01.361Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
