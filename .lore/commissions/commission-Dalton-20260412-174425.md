---
title: "Commission: Previously Owned: Fix Foundation Review Findings"
date: 2026-04-13
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Read Thorne's review of the previously-owned foundation (Phases 1-3). Address ALL findings before doing anything else.\n\n**Find Thorne's review:** Check the most recent Thorne commission artifact or result for the \"Previously Owned: Review Foundation\" commission. Read it fully.\n\n**Then:** Fix every finding. Do not skip findings or defer them. Run `bun run test`, `bun run typecheck`, and `bun run lint` after all fixes."
dependencies:
  - commission-Thorne-20260412-174419
linked_artifacts:
  - packages/daemon/tests/ownership-routes.test.ts

activity_timeline:
  - timestamp: 2026-04-13T00:44:25.488Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T01:01:48.761Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-13T01:06:55.748Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-13T01:06:55.751Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-13T01:06:55.774Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-13T01:07:10.128Z
    event: progress_report
    reason: "Read Thorne's review. Five findings, all test gaps/quality. Reading the existing test file to understand structure before adding fixes."
  - timestamp: 2026-04-13T01:08:37.739Z
    event: progress_report
    reason: "Implementing all 5 findings: F1 (wishlist 409 test), F2 (redundancyAdjustment null assertion), F3 (profile includes prev-owned), F4 (GET /games/:id null niche/redundancy), F5 (storage service backfill integration test)."
  - timestamp: 2026-04-13T01:11:19.428Z
    event: result_submitted
    reason: "All five Thorne findings addressed in `packages/daemon/tests/ownership-routes.test.ts`:\n\n**F1** (wishlist blocks previously-owned): Added test that marks a game as previously-owned and verifies `POST /api/wishlist` with that game's bggId returns 409 with \"already in your collection\".\n\n**F2** (redundancyAdjustment null): Updated the niche test to also enable redundancy and assert `prevGame.score.redundancyAdjustment` is null for previously-owned games in ownership=all responses.\n\n**F3** (profile includes prev-owned): Added test that passes all 4 games (3 owned + 1 previously-owned) through `computeProfile` and verifies `gameCount === 4`.\n\n**F4** (GET /games/:id null niche/redundancy): Extended the \"returns previously-owned game\" test to use enabled redundancy settings and assert both `nichePosition` and `score.redundancyAdjustment` are null.\n\n**F5** (storage service backfill integration): Replaced the inline simulation with an integration test that writes a legacy collection.json (no ownership field) through an in-memory FileOps, loads it via `createStorageService().loadCollection()`, and verifies the backfill produces `ownership: \"owned\"`.\n\nVerification: 1038 tests pass, 0 failures. Typecheck clean. Lint clean."
  - timestamp: 2026-04-13T01:11:25.569Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Implementing all 5 findings: F1 (wishlist 409 test), F2 (redundancyAdjustment null assertion), F3 (profile includes prev-owned), F4 (GET /games/:id null niche/redundancy), F5 (storage service backfill integration test)."
projectName: shelf-judge
---
All five Thorne findings addressed in `packages/daemon/tests/ownership-routes.test.ts`:

**F1** (wishlist blocks previously-owned): Added test that marks a game as previously-owned and verifies `POST /api/wishlist` with that game's bggId returns 409 with "already in your collection".

**F2** (redundancyAdjustment null): Updated the niche test to also enable redundancy and assert `prevGame.score.redundancyAdjustment` is null for previously-owned games in ownership=all responses.

**F3** (profile includes prev-owned): Added test that passes all 4 games (3 owned + 1 previously-owned) through `computeProfile` and verifies `gameCount === 4`.

**F4** (GET /games/:id null niche/redundancy): Extended the "returns previously-owned game" test to use enabled redundancy settings and assert both `nichePosition` and `score.redundancyAdjustment` are null.

**F5** (storage service backfill integration): Replaced the inline simulation with an integration test that writes a legacy collection.json (no ownership field) through an in-memory FileOps, loads it via `createStorageService().loadCollection()`, and verifies the backfill produces `ownership: "owned"`.

Verification: 1038 tests pass, 0 failures. Typecheck clean. Lint clean.
