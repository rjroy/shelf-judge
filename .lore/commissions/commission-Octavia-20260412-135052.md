---
title: "Commission: Spec: Previously Owned State (Proposals 3 + 5)"
date: 2026-04-12
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write a specification at `.lore/specs/previously-owned.md` based on the brainstorm at `.lore/brainstorms/previously-owned-state.md`.\n\n**Scope:** Implement Proposal 3 (Prediction-Aware Reference Pool / Narrow Fix) and Proposal 5 (Ownership-Aware Collection Views) from that brainstorm. These two proposals together form the feature: the data model change plus the UX to use it.\n\n**What to include from Proposal 3:**\n- Add `ownership: OwnershipStatus` field to `Game` type (union: `\"owned\" | \"previously-owned\"`, default `\"owned\"`)\n- Migration: existing games get `\"owned\"` via schema default\n- Filter previously-owned games out of `GameWithScore[]` passed to `computeRedundancyAdjustments`\n- Filter previously-owned games out of `GameWithScore[]` passed to `computeNichePositions`\n- Add ownership filter option to the collection list API\n- Leave prediction, profiling, fitness scoring, and tournaments unchanged (they already behave correctly)\n\n**What to include from Proposal 5:**\n- Default collection view shows owned games only\n- Filter toggle in the collection filter bar: \"Show previously owned\"\n- Previously-owned games are visually distinct (muted style, badge, or border)\n- Game detail page for previously-owned games: shows all ratings/fitness but annotates that niche/redundancy are excluded\n- \"Mark as Previously Owned\" / \"Mark as Owned\" status toggle action on game detail or edit form\n- Existing \"Remove from Collection\" (permanent delete) remains as a separate action\n- CLI: status toggle command or flag\n\n**What to read for context:**\n- `.lore/brainstorms/previously-owned-state.md` (the source brainstorm, read fully)\n- `.lore/vision.md` (principles and anti-goals)\n- `.lore/specs/mvp.md` (REQ-MVP-8 removal behavior)\n- `.lore/designs/mvp-data-model.md` (Game type, Collection type)\n- `.lore/specs/wishlist.md` (for interaction patterns, especially REQ-WISH-10 auto-removal and REQ-WISH-28 non-owned exclusion principle)\n- `packages/shared/src/types.ts` (current Game interface)\n\n**Edge cases to spec (from the brainstorm's Edge Cases section):**\n- Tournament interaction (status change during active tournament)\n- Reacquisition (previously-owned -> owned toggle)\n- Redundancy recalculation on status change\n- Interaction with wishlist lifecycle\n\n**Do not include** Proposal 4 (played-only state), Proposal 6 (BGG import mapping), or Proposal 2 (archive). Those are future work. The spec should note them as deferred in a \"Future Work\" section.\n\nFollow the project's existing spec conventions. Look at `.lore/specs/wishlist.md` for format and requirement numbering style."
dependencies: []
linked_artifacts:
  - .lore/specs/previously-owned.md

activity_timeline:
  - timestamp: 2026-04-12T20:50:52.457Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T20:50:52.459Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T20:50:52.484Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T20:50:57.960Z
    event: progress_report
    reason: "Reading brainstorm and context files to prepare the specification."
  - timestamp: 2026-04-12T20:51:28.344Z
    event: progress_report
    reason: "All context gathered. Verified code locations for filter points (games.ts:82 for redundancy, games.ts:170/191/223 for niches). No existing ownership field in codebase. Now drafting the specification."
  - timestamp: 2026-04-12T20:54:04.216Z
    event: progress_report
    reason: "Spec drafted and saved to `.lore/specs/previously-owned.md`. Running fresh-eyes review."
  - timestamp: 2026-04-12T20:57:11.725Z
    event: result_submitted
    reason: "Specification written at `.lore/specs/previously-owned.md` (32 requirements, REQ-PREV-1 through REQ-PREV-32).\n\nImplements brainstorm Proposals 3 (Narrow Fix) and 5 (Collection Views):\n- Data model: `ownership: OwnershipStatus` field on `Game` with `\"owned\" | \"previously-owned\"` union, defaulting to `\"owned\"` via Zod schema default (no migration needed)\n- Subsystem behavior: redundancy and niche engines filter previously-owned games at call sites; fitness, prediction, profiling, and tournaments unchanged\n- API: `PATCH /api/games/:id/ownership` for status change, `GET /games` gains `ownership` query param (default: `\"owned\"`)\n- Web: filter toggle in collection bar, muted styling + badge for previously-owned, annotation on detail page, status toggle action\n- CLI: `game set-status` command, `collection list --ownership` flag\n\nFresh-eyes review identified and resolved:\n1. Gap in mixed-view niche/redundancy behavior (REQ-PREV-19 and REQ-PREV-22 now specify previously-owned games carry null niche/redundancy, owned games unchanged)\n2. Server-side vs client-side toggle decision (REQ-PREV-21 now specifies server-side re-fetch, explains why collection-filter-sort's client-only approach can't apply here)\n3. Cross-module wishlist trap (REQ-PREV-31 now explicitly requires REQ-WISH-6 check to query all ownership statuses)\n4. No-op PATCH, idempotent response shape, and CLI coverage gaps added to success criteria"
  - timestamp: 2026-04-12T20:57:15.749Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Spec drafted and saved to `.lore/specs/previously-owned.md`. Running fresh-eyes review."
projectName: shelf-judge
---
Specification written at `.lore/specs/previously-owned.md` (32 requirements, REQ-PREV-1 through REQ-PREV-32).

Implements brainstorm Proposals 3 (Narrow Fix) and 5 (Collection Views):
- Data model: `ownership: OwnershipStatus` field on `Game` with `"owned" | "previously-owned"` union, defaulting to `"owned"` via Zod schema default (no migration needed)
- Subsystem behavior: redundancy and niche engines filter previously-owned games at call sites; fitness, prediction, profiling, and tournaments unchanged
- API: `PATCH /api/games/:id/ownership` for status change, `GET /games` gains `ownership` query param (default: `"owned"`)
- Web: filter toggle in collection bar, muted styling + badge for previously-owned, annotation on detail page, status toggle action
- CLI: `game set-status` command, `collection list --ownership` flag

Fresh-eyes review identified and resolved:
1. Gap in mixed-view niche/redundancy behavior (REQ-PREV-19 and REQ-PREV-22 now specify previously-owned games carry null niche/redundancy, owned games unchanged)
2. Server-side vs client-side toggle decision (REQ-PREV-21 now specifies server-side re-fetch, explains why collection-filter-sort's client-only approach can't apply here)
3. Cross-module wishlist trap (REQ-PREV-31 now explicitly requires REQ-WISH-6 check to query all ownership statuses)
4. No-op PATCH, idempotent response shape, and CLI coverage gaps added to success criteria
