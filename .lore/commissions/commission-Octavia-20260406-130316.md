---
title: "Commission: Spec: Tournament ELO Ranking"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Read `.lore/issues/deferred-tournament-ranking.md` and write a specification for tournament-based ELO ranking.\n\nUse the `/lore-development:specify` skill. Read the existing fitness algorithm design at `.lore/designs/fitness-algorithm.md`, the data model at `.lore/designs/data-model.md`, and the vision at `.lore/vision.md` for context on how this would fit into the system.\n\n## Open questions the user wants explored in the spec\n\nThese aren't rhetorical. The spec should take a position on each, with rationale:\n\n1. **Is ELO fitness just another axis? Or does it replace the fitness score and keep axes only for prediction?** The current system has multi-axis weighted fitness. Where does a head-to-head ELO score live relative to that? Consider: if ELO replaces fitness, the axes lose their scoring purpose. If ELO is just another axis, it competes with axes it's derived from. There may be a third option.\n\n2. **How do we start a tournament? Full collection bracket? Or pick a subset?** A 200-game collection makes a full round-robin impractical. What's the tournament structure? How does the user initiate it? Can they scope it (e.g., \"just my strategy games\" or \"games I haven't compared recently\")?\n\n3. **Do we need to record which games have been compared?** ELO typically tracks match history. Is that a first-class data model concern, or can we derive it? What's the minimum state needed to make ELO updates correct and resumable?\n\nThe spec should address all three with clear decisions, not punt them as \"future work.\""
dependencies: []
linked_artifacts: []

resource_overrides:
  model: opus

activity_timeline:
  - timestamp: 2026-04-06T20:03:16.486Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T20:03:16.488Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
