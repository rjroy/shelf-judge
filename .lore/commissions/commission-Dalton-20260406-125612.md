---
title: "Commission: Fix: BGG Client Robustness Gaps"
date: 2026-04-06
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Read `.lore/issues/bgg-client-robustness.md`. It lists 8 robustness gaps that may or may not still exist in the current code. Some were identified during early implementation and may have been fixed since.\n\nYour job: verify each item against the current code, then fix what's broken. Not \"defer.\" Fix or close, nothing in between.\n\n## Process\n\nFor each of the 8 items:\n1. Read the relevant source code\n2. Determine if the issue still exists\n3. If it exists, fix it now\n4. If it's already resolved, note that\n\n## The 8 items\n\n1. **429 unbounded recursion** — Check `packages/daemon/src/services/bgg-client.ts` retry logic. If 429 retries don't increment a counter or have a max, add one. 3-5 retries max is reasonable.\n\n2. **429 recovery** — After backing off to 10s delay on 429, does the delay ever come back down? If not, implement gradual recovery (e.g., halve the delay after each successful request until back to baseline).\n\n3. **Import batch fetch all-or-nothing** — Check if a transport failure on one batch kills the entire import. Partial imports should succeed. Per-game or per-batch error handling, not all-or-nothing.\n\n4. **Malformed XML handling** — Check what happens when the XML parser gets garbage. It should return an error, not silently return empty results.\n\n5. **getGames batch index correlation** — Check if metadata and bggData are correlated by array index. If so, correlate by BGG ID instead.\n\n6. **refreshAllBggData unnecessary save** — Check if it saves the collection even when zero games were refreshed. Skip the save if nothing changed.\n\n7. **isConfigured() vs assertConfigured() inconsistency** — Check both functions. They should handle undefined the same way.\n\n8. **createMockFetch duplication** — Check `packages/daemon/tests/` for duplicated mock fetch helpers. If the same helper exists in 3+ files, extract to a shared test utility (e.g., `packages/daemon/tests/helpers/mock-fetch.ts`).\n\n## After fixes\n\n- Write tests for any behavioral changes (retry limits, recovery, partial import, XML error handling)\n- Run `bun run test`, `bun run typecheck`, `bun run lint`\n- Update `.lore/issues/bgg-client-robustness.md` status to `resolved` and add a brief note per item saying what you found and what you did"
dependencies: []
linked_artifacts:
  - packages/daemon/src/services/bgg-client.ts

  - packages/daemon/src/services/bgg-xml-parser.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/tests/helpers/mock-fetch.ts
  - packages/daemon/tests/services/bgg-client.test.ts
  - packages/daemon/tests/services/game-service-bgg.test.ts
  - packages/daemon/tests/services/import.test.ts
  - .lore/issues/bgg-client-robustness.md
  - packages/daemon/src/services/bgg-xml-parser.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/tests/helpers/mock-fetch.ts
  - packages/daemon/tests/services/bgg-client.test.ts
  - packages/daemon/tests/services/game-service-bgg.test.ts
  - packages/daemon/tests/services/import.test.ts
  - .lore/issues/bgg-client-robustness.md
activity_timeline:
  - timestamp: 2026-04-06T19:56:12.312Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T19:56:12.314Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-06T19:56:12.334Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-06T19:56:22.689Z
    event: progress_report
    reason: "Read issue file and bgg-client.ts. Starting verification of all 8 items against current code."
  - timestamp: 2026-04-06T19:57:53.290Z
    event: progress_report
    reason: "Full analysis complete. Implementing fixes for items 2-8. Item 1 already fixed. Item 3 partially fixed (import catches batch errors, returns partial results) but getGames itself still throws on batch failure. Implementing all fixes now."
  - timestamp: 2026-04-06T20:03:55.067Z
    event: result_submitted
    reason: "All 8 BGG client robustness issues verified and resolved. 230 tests pass, typecheck and lint clean.\n\n**Item 1** (429 unbounded recursion): Already fixed. No change needed.\n\n**Item 2** (429 recovery): Fixed. Recovery now halves delay on every successful request, not just the first one after a 429.\n\n**Item 3** (batch all-or-nothing): Fixed. `getGames` catches per-batch errors and continues. Import saves partial results instead of discarding them.\n\n**Item 4** (malformed XML): Fixed. Added `assertBggXml` validation to all parser functions. Garbage XML now throws instead of returning empty.\n\n**Item 5** (batch index correlation): Fixed. New `parseThingItems` function returns metadata and bggData paired by construction. No fragile index correlation.\n\n**Item 6** (unnecessary save): Fixed. `refreshAllBggData` and `importBggCollection` skip save when nothing changed.\n\n**Item 7** (isConfigured inconsistency): Fixed. `isConfigured()` now uses `Boolean()` to match `assertConfigured()`'s falsy check.\n\n**Item 8** (createMockFetch duplication): Fixed. Extracted to `packages/daemon/tests/helpers/mock-fetch.ts`. All 3 test files use the shared helper."
  - timestamp: 2026-04-06T20:03:58.210Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Full analysis complete. Implementing fixes for items 2-8. Item 1 already fixed. Item 3 partially fixed (import catches batch errors, returns partial results) but getGames itself still throws on batch failure. Implementing all fixes now."
projectName: shelf-judge
---
All 8 BGG client robustness issues verified and resolved. 230 tests pass, typecheck and lint clean.

**Item 1** (429 unbounded recursion): Already fixed. No change needed.

**Item 2** (429 recovery): Fixed. Recovery now halves delay on every successful request, not just the first one after a 429.

**Item 3** (batch all-or-nothing): Fixed. `getGames` catches per-batch errors and continues. Import saves partial results instead of discarding them.

**Item 4** (malformed XML): Fixed. Added `assertBggXml` validation to all parser functions. Garbage XML now throws instead of returning empty.

**Item 5** (batch index correlation): Fixed. New `parseThingItems` function returns metadata and bggData paired by construction. No fragile index correlation.

**Item 6** (unnecessary save): Fixed. `refreshAllBggData` and `importBggCollection` skip save when nothing changed.

**Item 7** (isConfigured inconsistency): Fixed. `isConfigured()` now uses `Boolean()` to match `assertConfigured()`'s falsy check.

**Item 8** (createMockFetch duplication): Fixed. Extracted to `packages/daemon/tests/helpers/mock-fetch.ts`. All 3 test files use the shared helper.
