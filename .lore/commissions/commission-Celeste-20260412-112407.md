---
title: "Commission: Brainstorm: Previously Owned State"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Celeste
workerDisplayTitle: "Guild Visionary"
prompt: "Brainstorm around the issue at `.lore/issues/previously-owned-state.md`.\n\nThe core question: some games have been owned, rated, and then sold/traded away. Their ratings still contribute to prediction (they calibrate the user's preferences) but should NOT contribute to redundancy scoring (they're not on the shelf anymore). There are also adjacent cases like games only played but never owned.\n\nRead these for context before brainstorming:\n- `.lore/issues/previously-owned-state.md` (the issue itself)\n- `.lore/vision.md` (project principles)\n- `.lore/specs/mvp.md` (current data model context)\n- `.lore/designs/mvp-data-model.md` (game schema)\n- `.lore/issues/shelf-layout-designer.md` (related physical metadata idea)\n- `.lore/specs/wishlist.md` (the wishlist feature, for comparison on how \"not currently owned\" states interact with the system)\n\nExplore questions like:\n- Is a simple binary status (owned/not-owned) sufficient, or does the system benefit from richer states (owned, previously-owned, played-only, wishlist)?\n- What does \"previously owned\" mean for each subsystem: prediction, redundancy, profiling, niche detection, fitness scoring, tournaments?\n- Should previously-owned games still appear in the collection view, or get filtered/tagged?\n- How does this relate to the wishlist concept (a game can go: wishlist → owned → previously-owned)?\n- Does this open the door to a game lifecycle model, and is that complexity warranted?\n- What about games played but never owned (e.g., at a game night)? Same mechanism or different?\n- Physical metadata (shelf location, box size from the layout designer issue) only matters for owned games. Does status help scope that?\n\nWrite the brainstorm to `.lore/brainstorms/previously-owned-state.md`."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T18:24:07.050Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T18:24:07.052Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
