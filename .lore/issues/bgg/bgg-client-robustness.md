---
title: BGG client robustness gaps
date: 2026-04-06
status: resolved
tags: []
modules: [bgg-client, game-service]
---

# BGG client robustness

Several robustness gaps were identified during MVP implementation. All items verified and resolved.

## Resolution

1. **429 unbounded recursion**: Already fixed. `rateLimitRetries` counter with `MAX_429_RETRIES = 3` was in place.

2. **429 recovery not implemented**: Fixed. Recovery logic previously only triggered once (reset `rateLimitRetries` to 0, halved delay, then stopped). Changed to check `currentDelayMs > delayMs` independently of retry counter, so delay halves on every successful request until back to baseline.

3. **Import batch fetch all-or-nothing**: Fixed. `getGames` now wraps each batch in try/catch and continues on failure. Failed batches produce empty results instead of killing remaining batches. Import error path also now falls through to save partial results instead of returning early.

4. **Malformed XML handling**: Fixed. Added `assertBggXml` validation to all four XML parser functions. If the parsed XML lacks a root `<items>` element, throws a descriptive error instead of returning empty results.

5. **`getGames` batch index correlation**: Fixed. Replaced dual `parseThingResponse`/`parseThingMetadata` calls with new `parseThingItems` function that returns metadata and bggData paired by construction in a single pass over the XML items. No index correlation needed.

6. **`refreshAllBggData` unnecessary save**: Fixed. Both `refreshAllBggData` and `importBggCollection` now skip `saveCollection` when zero games were changed.

7. **`isConfigured()` vs `assertConfigured()` inconsistency**: Fixed. `isConfigured()` changed from `!== null && !== ""` to `Boolean(config.bggAuthToken)`, which handles undefined the same way as `assertConfigured()`'s `!config.bggAuthToken` check.

8. **`createMockFetch` duplication**: Fixed. Extracted to `packages/daemon/tests/helpers/mock-fetch.ts`. All three test files now import from the shared helper.

## Origin

Dalton's Phase 3 self-review (commission-Dalton-20260405-121607). These findings were not picked up by the Thorne review and never entered the fix chain. Some may have been fixed during later phases without explicit tracking.
