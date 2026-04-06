---
title: "Commission: Spec: Utility Curves for Axis Ratings"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Read `.lore/issues/deferred-utility-curves.md` and write a specification for utility curves.\n\nUse the `/lore-development:specify` skill. Read the existing fitness algorithm design at `.lore/designs/fitness-algorithm.md`, the data model at `.lore/designs/data-model.md`, and the vision at `.lore/vision.md` for context.\n\n## Core problem the user described\n\nThe current system treats axis ratings linearly: higher is always better. But for some axes, the user has a sweet spot. The user's example:\n\n**Game complexity:** A score of 2.75 is perfect. A score of 5 is too complex. A score of 0 is too simple. So 2.75 should contribute the most to fitness, 5 should contribute less (but maybe more than 0), and the relationship is non-linear.\n\nThis means each axis needs a way to define \"what's my ideal value, and how does fitness fall off as the rating moves away from it?\"\n\n## Key design constraint from the user\n\n**The user should not need a calculator.** Whatever mechanism defines the curve must be intuitive. A user should be able to express \"I like medium complexity, not too heavy, not too light\" without understanding math. The spec should address how the curve is configured through the UI, not just the underlying model.\n\nConsider:\n- Is this a per-axis \"ideal value\" with a falloff shape?\n- Is it a piecewise curve the user draws or defines with a few control points?\n- Is it presets like \"higher is better\", \"lower is better\", \"sweet spot at X\"?\n- How does this interact with the existing weight system? Does the curve replace weights, modify them, or sit alongside them?\n- What's the minimum viable version vs the full vision?"
dependencies: []
linked_artifacts: []

resource_overrides:
  model: opus

activity_timeline:
  - timestamp: 2026-04-06T20:07:04.633Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T20:07:04.634Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
