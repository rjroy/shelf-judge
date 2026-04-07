---
title: "Commission: Collection Filter/Sort Fix + Phase 5: Tests"
date: 2026-04-07
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Two tasks in this commission:\n\n**Task 1: Fix review findings.**\nRead Thorne's review from the commission that just completed before this one (it reviewed all four phases against the full spec). Address ALL findings before writing tests. Do not skip any finding regardless of severity.\n\n**Task 2: Implement Phase 5 (Tests).**\nRead the plan at `.lore/plans/collection-filter-sort.md` — Phase 5 has the test cases.\n\n**Phase 5 deliverables:**\nCreate `packages/web/tests/collection-table.test.ts` with tests for the pure functions (sort comparator, filter predicate, score display, separator label). Export these functions from a utilities module if not already exported.\n\n**Minimum test cases:**\n- Sort by each field type: fitness, tournament, name, year, createdAt, updatedAt, playerCount, playTime, bggRating, bggWeight, axis\n- Null handling: nulls sort to bottom regardless of direction\n- Direction toggle: ascending vs descending reverses order\n- Filter: search matches case-insensitively\n- Filter: rated status includes/excludes correctly\n- Filter: player count range check (minPlayers <= N <= maxPlayers)\n- Filter: AND combination of multiple filters\n- Score display: correct text for each sort field type\n- Separator label: correct contextual text for each sort field type, null for name sort\n\n**Verification:** `bun run typecheck`, `bun run lint`, `bun run test` all clean. All new tests pass."
dependencies:
  - commission-Thorne-20260407-081601
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-07T15:16:13.970Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T15:20:49.755Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-07T15:44:31.898Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-07T15:44:31.901Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
