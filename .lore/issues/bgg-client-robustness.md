---
title: BGG client robustness gaps
date: 2026-04-06
status: open
tags: [robustness, bgg-client, error-handling]
modules: [bgg-client, game-service]
---

# BGG client robustness

Several robustness gaps were identified during MVP implementation. Some may have been fixed inline during development without being reported in the review chain. Each item needs verification against the current code before acting on it.

## Items to verify

1. **429 unbounded recursion**: retry handler may recurse without incrementing `retryCount`. Persistent 429 responses would cause unbounded recursion. Check `bgg-client.ts` retry logic.

2. **429 recovery not implemented**: after a 429, `currentDelayMs` may be set to 10000 permanently with no path back to normal rate. Plan called for "gradually return to normal."

3. **Import batch fetch all-or-nothing**: transport failure on any batch may kill all remaining imports. Plan intended per-game failure handling so partial imports succeed.

4. **Malformed XML handling**: malformed XML may return empty results instead of an error. Plan says "malformed XML returns error, not crash."

5. **`getGames` batch index correlation**: metadata and bggData may be correlated by array index, which is fragile if either parser adds filtering.

6. **`refreshAllBggData` unnecessary save**: may save collection with new `updatedAt` even when zero games were actually refreshed.

7. **`isConfigured()` vs `assertConfigured()` inconsistency**: different undefined-handling patterns between the two functions.

8. **`createMockFetch` duplication**: same mock helper copy-pasted across 3 test files. Should be extracted to a shared test utility.

## Origin

Dalton's Phase 3 self-review (commission-Dalton-20260405-121607). These findings were not picked up by the Thorne review and never entered the fix chain. Some may have been fixed during later phases without explicit tracking.
