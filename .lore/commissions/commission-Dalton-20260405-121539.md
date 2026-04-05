---
title: "Commission: Phase 2: Fitness Engine and Axis/Game Services"
date: 2026-04-05
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 2 of the MVP plan at `.lore/plans/mvp.md`.\n\nRead the full plan, then focus on Phase 2: \"Fitness Engine and Axis/Game Services.\" Also read:\n- `.lore/designs/mvp-fitness-model.md` (Wingspan example, weighted average formula, breakdown interface)\n- `.lore/designs/mvp-data-model.md`\n- `.lore/specs/mvp.md` (REQ-MVP-1, 2, 3, 4, 5, 6, 8, 9, 14, 15, 16, 17)\n\nPhase 2 has three steps:\n\n**2.1 Fitness service** — Pure computation, no I/O. Factory pattern. Implement `calculateScore(game, axes, bggData)`. Test against the Wingspan example from the fitness model design (expected score: 7.9). Test all edge cases: zero rated axes, all-zero weights, missing ratings, BGG-derived axis with no BGG data, overrides, rounding boundaries (7.84→7.8, 7.85→7.9, 7.94→7.9, 7.95→8.0).\n\n**2.2 Axis service** — CRUD with cascade deletion. Factory: `createAxisService({ storageService })`. Delete returns `{ deletedRatingsCount }` for confirmation UX. Test cascade: deleting an axis removes all ratings on it across all games.\n\n**2.3 Game service** — CRUD with duplicate detection. Factory: `createGameService({ storageService, fitnessService })`. Duplicate detection on bggId (REQ-MVP-9). Manual games never duplicate each other. Rate validates 1-10 integer. List sorts by fitness descending, unscored at end.\n\nRun `bun test` after implementation. All Phase 1 and Phase 2 tests must pass."
dependencies:
  - commission-Dalton-20260405-121526
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-05T19:15:39.124Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-05T19:22:19.171Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-05T19:28:17.669Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-05T19:28:17.671Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
