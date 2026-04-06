---
title: "Commission: Fix: BGG Client Robustness Gaps"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Read `.lore/issues/bgg-client-robustness.md`. It lists 8 robustness gaps that may or may not still exist in the current code. Some were identified during early implementation and may have been fixed since.\n\nYour job: verify each item against the current code, then fix what's broken. Not \"defer.\" Fix or close, nothing in between.\n\n## Process\n\nFor each of the 8 items:\n1. Read the relevant source code\n2. Determine if the issue still exists\n3. If it exists, fix it now\n4. If it's already resolved, note that\n\n## The 8 items\n\n1. **429 unbounded recursion** — Check `packages/daemon/src/services/bgg-client.ts` retry logic. If 429 retries don't increment a counter or have a max, add one. 3-5 retries max is reasonable.\n\n2. **429 recovery** — After backing off to 10s delay on 429, does the delay ever come back down? If not, implement gradual recovery (e.g., halve the delay after each successful request until back to baseline).\n\n3. **Import batch fetch all-or-nothing** — Check if a transport failure on one batch kills the entire import. Partial imports should succeed. Per-game or per-batch error handling, not all-or-nothing.\n\n4. **Malformed XML handling** — Check what happens when the XML parser gets garbage. It should return an error, not silently return empty results.\n\n5. **getGames batch index correlation** — Check if metadata and bggData are correlated by array index. If so, correlate by BGG ID instead.\n\n6. **refreshAllBggData unnecessary save** — Check if it saves the collection even when zero games were refreshed. Skip the save if nothing changed.\n\n7. **isConfigured() vs assertConfigured() inconsistency** — Check both functions. They should handle undefined the same way.\n\n8. **createMockFetch duplication** — Check `packages/daemon/tests/` for duplicated mock fetch helpers. If the same helper exists in 3+ files, extract to a shared test utility (e.g., `packages/daemon/tests/helpers/mock-fetch.ts`).\n\n## After fixes\n\n- Write tests for any behavioral changes (retry limits, recovery, partial import, XML error handling)\n- Run `bun run test`, `bun run typecheck`, `bun run lint`\n- Update `.lore/issues/bgg-client-robustness.md` status to `resolved` and add a brief note per item saying what you found and what you did"
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T19:56:12.312Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T19:56:12.314Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
