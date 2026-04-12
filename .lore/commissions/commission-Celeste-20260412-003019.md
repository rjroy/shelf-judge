---
title: "Commission: Brainstorm: Shelf layout designer"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Celeste
workerDisplayTitle: "Guild Visionary"
prompt: "Brainstorm the shelf layout designer idea described in `.lore/issues/shelf-layout-designer.md`.\n\nThe issue says: \"Store the box size of all games (w x h x l). Store the configuration of a shelf configuration (w x h x l per shelf and its neighbors). Use game box sizes to optimally fill the shelves. Use similarity to prioritize games that share a shelf or are in a neighboring shelf.\"\n\nThis is an early-stage idea that needs exploration before it's ready for a spec. Think through:\n\n**Data questions:**\n- Where do box dimensions come from? BGG has some dimension data but it's inconsistent. Manual entry? Import from BGG? Both?\n- What does a \"shelf configuration\" look like as a data model? A shelf unit has shelves, each shelf has dimensions. How do you model adjacency (\"neighbors\")?\n- How does this relate to the existing game data model?\n\n**Algorithm questions:**\n- What does \"optimally fill\" mean? Minimize wasted space? Maximize accessibility? Keep series together?\n- The \"similarity\" constraint is interesting. The niche engine already computes game similarity via shared tags. How would that feed into shelf placement? Is the goal that similar games are physically near each other for browsing?\n- Is this a bin-packing problem? A constrained optimization? What's the computational complexity look like for a realistic collection (50-200 games)?\n- How do you handle games that don't fit any shelf? Games stored horizontally vs vertically?\n\n**UX questions:**\n- Is this a one-shot \"compute optimal layout\" or an interactive designer where you drag games between shelves?\n- How do you visualize the result? Top-down view? Front-facing shelf view?\n- Does the user care about the algorithm or just the result?\n\n**Feasibility:**\n- How much of this is realistic for a local-only tool? What's the MVP slice vs the dream version?\n- Does this align with the project's vision (`.lore/vision.md`)? Shelf Judge is about curation decisions. Does physical shelf layout serve that goal or is it a different tool?\n\nRead `.lore/vision.md` and the existing data model at `.lore/designs/data-model.md` for grounding. Check what BGG data is already available in the game types at `packages/shared/src/types.ts`.\n\nWrite your brainstorm to `.lore/brainstorms/shelf-layout-designer.md`."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T07:30:19.725Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T07:30:19.727Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
