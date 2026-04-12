---
title: "Commission: Brainstorm: Previously Owned State"
date: 2026-04-12
status: completed
tags: [commission]
worker: Celeste
workerDisplayTitle: "Guild Visionary"
prompt: "Brainstorm around the issue at `.lore/issues/previously-owned-state.md`.\n\nThe core question: some games have been owned, rated, and then sold/traded away. Their ratings still contribute to prediction (they calibrate the user's preferences) but should NOT contribute to redundancy scoring (they're not on the shelf anymore). There are also adjacent cases like games only played but never owned.\n\nRead these for context before brainstorming:\n- `.lore/issues/previously-owned-state.md` (the issue itself)\n- `.lore/vision.md` (project principles)\n- `.lore/specs/mvp.md` (current data model context)\n- `.lore/designs/mvp-data-model.md` (game schema)\n- `.lore/issues/shelf-layout-designer.md` (related physical metadata idea)\n- `.lore/specs/wishlist.md` (the wishlist feature, for comparison on how \"not currently owned\" states interact with the system)\n\nExplore questions like:\n- Is a simple binary status (owned/not-owned) sufficient, or does the system benefit from richer states (owned, previously-owned, played-only, wishlist)?\n- What does \"previously owned\" mean for each subsystem: prediction, redundancy, profiling, niche detection, fitness scoring, tournaments?\n- Should previously-owned games still appear in the collection view, or get filtered/tagged?\n- How does this relate to the wishlist concept (a game can go: wishlist → owned → previously-owned)?\n- Does this open the door to a game lifecycle model, and is that complexity warranted?\n- What about games played but never owned (e.g., at a game night)? Same mechanism or different?\n- Physical metadata (shelf location, box size from the layout designer issue) only matters for owned games. Does status help scope that?\n\nWrite the brainstorm to `.lore/brainstorms/previously-owned-state.md`."
dependencies: []
linked_artifacts:
  - .lore/brainstorms/previously-owned-state.md

activity_timeline:
  - timestamp: 2026-04-12T18:24:07.050Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T18:24:07.052Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T18:24:07.077Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T18:24:22.214Z
    event: progress_report
    reason: "Read all six context files. Now scanning existing brainstorms and the codebase for evidence: redundancy scoring, prediction, profiling, Game type, and any existing status-related code."
  - timestamp: 2026-04-12T18:24:47.157Z
    event: progress_report
    reason: "Context gathered. The Game type has no status/ownership field. All subsystems (fitness, prediction, profiling, redundancy, niche) consume `collection.games` without filtering by ownership status. Drafting proposals now."
  - timestamp: 2026-04-12T18:28:52.379Z
    event: result_submitted
    reason: "Brainstorm written to `.lore/brainstorms/previously-owned-state.md`. Six proposals exploring the previously-owned state from different angles:\n\n1. **Ownership Status Field on Game** (Medium) - The full model. Adds `ownership: \"owned\" | \"previously-owned\"` to Game with a per-subsystem behavior table. The key insight: subsystems split cleanly into \"about the shelf\" (exclude non-owned) vs. \"about preferences\" (include all).\n\n2. **Soft Delete with Rating Preservation** (Medium) - Alternative structural approach. Moves games to `collection.archive` instead of using a status field. Simpler filtering (structural vs. conditional) but harder reacquisition.\n\n3. **Prediction-Aware Reference Pool / Narrow Fix** (Small) - Minimum viable fix. Same status field, but only filters at the redundancy and niche call sites. Solves the reported problem without speculative propagation.\n\n4. **Game Lifecycle States** (Medium) - Extends to three states: owned, previously-owned, played-only. Handles the \"game night\" case. All non-owned states route identically through subsystems.\n\n5. **Ownership-Aware Collection Views** (Small-Medium) - The UX layer. Default view shows owned only, filter toggle adds previously-owned, visual distinction for non-owned games.\n\n6. **BGG Import with Ownership Mapping** (Small) - Reads BGG `prevowned` flag during import. Opt-in, preserves current default behavior.\n\nRecommended sequence: Start with Proposal 3 (narrow fix), add Proposal 5 (views), then Proposal 6 (BGG import). Expand to Proposal 4 (richer states) when played-only becomes a real need. Proposal 1 over Proposal 2 for the target state, because status fields handle reacquisition naturally."
  - timestamp: 2026-04-12T18:28:58.822Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Context gathered. The Game type has no status/ownership field. All subsystems (fitness, prediction, profiling, redundancy, niche) consume `collection.games` without filtering by ownership status. Drafting proposals now."
projectName: shelf-judge
---
Brainstorm written to `.lore/brainstorms/previously-owned-state.md`. Six proposals exploring the previously-owned state from different angles:

1. **Ownership Status Field on Game** (Medium) - The full model. Adds `ownership: "owned" | "previously-owned"` to Game with a per-subsystem behavior table. The key insight: subsystems split cleanly into "about the shelf" (exclude non-owned) vs. "about preferences" (include all).

2. **Soft Delete with Rating Preservation** (Medium) - Alternative structural approach. Moves games to `collection.archive` instead of using a status field. Simpler filtering (structural vs. conditional) but harder reacquisition.

3. **Prediction-Aware Reference Pool / Narrow Fix** (Small) - Minimum viable fix. Same status field, but only filters at the redundancy and niche call sites. Solves the reported problem without speculative propagation.

4. **Game Lifecycle States** (Medium) - Extends to three states: owned, previously-owned, played-only. Handles the "game night" case. All non-owned states route identically through subsystems.

5. **Ownership-Aware Collection Views** (Small-Medium) - The UX layer. Default view shows owned only, filter toggle adds previously-owned, visual distinction for non-owned games.

6. **BGG Import with Ownership Mapping** (Small) - Reads BGG `prevowned` flag during import. Opt-in, preserves current default behavior.

Recommended sequence: Start with Proposal 3 (narrow fix), add Proposal 5 (views), then Proposal 6 (BGG import). Expand to Proposal 4 (richer states) when played-only becomes a real need. Proposal 1 over Proposal 2 for the target state, because status fields handle reacquisition naturally.
