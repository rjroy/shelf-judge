---
title: "Commission: Spec: Previously Owned State (Proposals 3 + 5)"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write a specification at `.lore/specs/previously-owned.md` based on the brainstorm at `.lore/brainstorms/previously-owned-state.md`.\n\n**Scope:** Implement Proposal 3 (Prediction-Aware Reference Pool / Narrow Fix) and Proposal 5 (Ownership-Aware Collection Views) from that brainstorm. These two proposals together form the feature: the data model change plus the UX to use it.\n\n**What to include from Proposal 3:**\n- Add `ownership: OwnershipStatus` field to `Game` type (union: `\"owned\" | \"previously-owned\"`, default `\"owned\"`)\n- Migration: existing games get `\"owned\"` via schema default\n- Filter previously-owned games out of `GameWithScore[]` passed to `computeRedundancyAdjustments`\n- Filter previously-owned games out of `GameWithScore[]` passed to `computeNichePositions`\n- Add ownership filter option to the collection list API\n- Leave prediction, profiling, fitness scoring, and tournaments unchanged (they already behave correctly)\n\n**What to include from Proposal 5:**\n- Default collection view shows owned games only\n- Filter toggle in the collection filter bar: \"Show previously owned\"\n- Previously-owned games are visually distinct (muted style, badge, or border)\n- Game detail page for previously-owned games: shows all ratings/fitness but annotates that niche/redundancy are excluded\n- \"Mark as Previously Owned\" / \"Mark as Owned\" status toggle action on game detail or edit form\n- Existing \"Remove from Collection\" (permanent delete) remains as a separate action\n- CLI: status toggle command or flag\n\n**What to read for context:**\n- `.lore/brainstorms/previously-owned-state.md` (the source brainstorm, read fully)\n- `.lore/vision.md` (principles and anti-goals)\n- `.lore/specs/mvp.md` (REQ-MVP-8 removal behavior)\n- `.lore/designs/mvp-data-model.md` (Game type, Collection type)\n- `.lore/specs/wishlist.md` (for interaction patterns, especially REQ-WISH-10 auto-removal and REQ-WISH-28 non-owned exclusion principle)\n- `packages/shared/src/types.ts` (current Game interface)\n\n**Edge cases to spec (from the brainstorm's Edge Cases section):**\n- Tournament interaction (status change during active tournament)\n- Reacquisition (previously-owned -> owned toggle)\n- Redundancy recalculation on status change\n- Interaction with wishlist lifecycle\n\n**Do not include** Proposal 4 (played-only state), Proposal 6 (BGG import mapping), or Proposal 2 (archive). Those are future work. The spec should note them as deferred in a \"Future Work\" section.\n\nFollow the project's existing spec conventions. Look at `.lore/specs/wishlist.md` for format and requirement numbering style."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T20:50:52.457Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T20:50:52.459Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
