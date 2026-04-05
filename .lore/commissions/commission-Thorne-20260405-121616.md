---
title: "Commission: Phase 3 Review: BGG Integration"
date: 2026-04-05
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review Phase 3 implementation of the MVP plan.\n\nRead `.lore/plans/mvp.md` (Phase 3), `.lore/designs/mvp-bgg-integration.md`, `.lore/research/bgg-api.md`, `.lore/specs/mvp.md` (REQ-MVP-7, 10, 11, 12, 13, 18, 19).\n\nReview criteria:\n1. BGG client handles 202 retry with correct exponential backoff (5s, 10s, 20s)\n2. Rate limiting: sequential queue with configurable delay\n3. 429 backoff: 30s pause, then 1 req/10s\n4. 502/503: retry after 30s, max 2 retries\n5. XML parsing uses captured real API responses (NOT synthetic XML) — verify fixture files exist and contain real BGG data\n6. averageweight=0 maps to null\n7. Primary name extraction works when multiple `<name>` elements exist\n8. Missing token returns clear error with registration URL (REQ-MVP-12)\n9. Offline scenario: game addition works without BGG data (REQ-MVP-11)\n10. Import: duplicates skipped, partial failures handled, progress events streamed\n11. Refresh preserves user overrides of BGG-derived ratings (REQ-MVP-19)\n12. BGG-derived ratings computed at score time, not stored in game.ratings\n13. All tests from the plan exist and pass\n\nRun `bun test` and report results. Verify the BGG client against the research document's endpoint descriptions."
dependencies:
  - commission-Dalton-20260405-121607
linked_artifacts:
  - packages/daemon/src/services/bgg-client.ts

  - packages/daemon/src/services/bgg-xml-parser.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/src/services/fitness-service.ts
  - packages/daemon/tests/services/bgg-client.test.ts
  - packages/daemon/tests/services/bgg-xml-parser.test.ts
  - packages/daemon/tests/services/game-service-bgg.test.ts
  - packages/daemon/tests/services/import.test.ts
  - packages/daemon/tests/services/fitness-service.test.ts
  - packages/daemon/src/services/bgg-xml-parser.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/src/services/fitness-service.ts
  - packages/daemon/tests/services/bgg-client.test.ts
  - packages/daemon/tests/services/bgg-xml-parser.test.ts
  - packages/daemon/tests/services/game-service-bgg.test.ts
  - packages/daemon/tests/services/import.test.ts
  - packages/daemon/tests/services/fitness-service.test.ts
activity_timeline:
  - timestamp: 2026-04-05T19:16:16.975Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-05T19:22:19.171Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-05T20:00:30.716Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-05T20:00:30.718Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-05T20:00:30.730Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-05T20:00:38.175Z
    event: progress_report
    reason: "Starting Phase 3 review. Reading plan, specs, design docs, and research docs."
  - timestamp: 2026-04-05T20:01:04.941Z
    event: progress_report
    reason: "Found all expected Phase 3 files. Reading implementation and test files in parallel."
  - timestamp: 2026-04-05T20:01:42.700Z
    event: progress_report
    reason: "Read all implementation and test files. Examining fixture authenticity and running tests now."
  - timestamp: 2026-04-05T20:06:47.323Z
    event: progress_report
    reason: "All criteria examined. Preparing final review with prioritized findings."
  - timestamp: 2026-04-05T20:07:37.789Z
    event: result_submitted
    reason: "# Phase 3 Review: BGG Integration\n\n## Limitation\n\nI cannot run `bun test`. My posture is read-only (no shell execution). All findings are from static analysis. **Tests must be run before accepting this review.**\n\n---\n\n## Findings (priority order)\n\n### 1. DEFECT: Fixture files are synthetic, not captured real API responses\n\n**Files:** `packages/daemon/tests/fixtures/*.xml`\n\nThe spec (mvp.md line 148) and plan (line 385) both require: \"BGG XML parsing tested against captured real API responses, not synthetic XML.\"\n\nEvidence the fixtures are hand-crafted:\n- Missing fields present in real responses (no `boardgameartist` links, no `suggested_playerage` poll, no `language_dependence` poll)\n- Gloomhaven fixture uses truncated image URLs (\"thumbnail.jpg\", \"original.jpg\") instead of real CDN hashes\n- Collection fixture has pubdate \"Sun, 06 Apr 2026\" (tomorrow)\n- Round stat numbers (numWeightVotes: exactly 12000, 15000)\n\nThe fixtures follow correct BGG XML structure, so the parser will likely work against real data. But the explicit spec requirement is unmet.\n\n**Action:** Capture real API responses using `curl` against the BGG API with a valid token and replace the fixture files. Then verify tests still pass.\n\n---\n\n### 2. DEFECT: Silent catch block swallows BGG fetch errors in addGame\n\n**File:** `packages/daemon/src/services/game-service.ts:123-125`\n\n```typescript\n} catch {\n  // BGG unavailable: still add the game with null bggData\n}\n```\n\nWhen addGame fetches BGG data and it fails, the error is silently discarded. The caller gets a Game with `bggData: null`, indistinguishable from \"no BGG fetch attempted.\" REQ-MVP-13 requires: \"Failures are reported to the user with enough context to understand what happened.\"\n\n**Action:** Either return a warning alongside the game (e.g., `{ game, warning?: string }`), or at minimum log the error. The user should know their game was added but BGG data couldn't be fetched.\n\n---\n\n### 3. DEFECT: 429 backoff test doesn't verify timing behavior\n\n**File:** `packages/daemon/tests/services/bgg-client.test.ts:182-193`\n\nThe plan (line 379) specifies: \"429 response triggers backoff (verify timing via mock).\" The test injects `delayFn: async () => {}` (no-op) and only verifies that the retry happens and eventually succeeds. It doesn't verify that delayFn was called with `BACKOFF_429_MS` (30000) or that `currentDelayMs` was set to 10000.\n\n**Action:** Capture delayFn arguments. Assert the first delay call receives 30000 (the backoff) and that subsequent requests use the 10s rate.\n\n---\n\n### 4. CONCERN: Weight-to-rating scaling (x2) is undocumented\n\n**File:** `packages/daemon/src/services/fitness-service.ts:28-29`\n\n```typescript\ncase \"weight\":\n  if (bggData.weight === null) return null;\n  return bggData.weight * 2;\n```\n\nBGG weight (1-5) is scaled to 2-10 by multiplying by 2. This is a reasonable mapping but appears in no design document. A reader encountering `* 2` will wonder why.\n\n**Action:** Add a comment: `// BGG weight is 1-5 scale; multiply by 2 to map to 1-10 rating scale`\n\n---\n\n### 5. CONCERN: Rate limiter is not actually a queue\n\n**File:** `packages/daemon/src/services/bgg-client.ts:71-81`\n\nThe plan (line 346) says: \"a sequential request queue... The queue is internal to BggClient; callers don't see it.\" The implementation is a timestamp-based throttle, not a queue. It works correctly only because all current callers are already sequential (await in loops). If anyone adds parallel requests, the rate limiter fails silently: two concurrent calls read the same `lastRequestTime`, both proceed, and BGG sees a burst.\n\n**Action:** For MVP, add a comment documenting that the throttle assumes single-threaded access. Post-MVP, replace with a proper mutex-guarded queue.\n\n---\n\n### 6. OBSERVATION: Breakdown derivation test validates consistency, not correctness\n\n**File:** `packages/daemon/tests/services/fitness-service.test.ts:319-339`\n\nThe \"score is derivable from breakdown contributions\" test computes expected score from the code's own contribution outputs. If contributions and score are both wrong in the same way, the test passes. This is a known antipattern from the lessons-learned rules.\n\nNot a blocker. The Wingspan example test (lines 52-106) validates against hand-calculated values and covers correctness. This test catches a real class of bugs (rounding drift between contributions and final score). Just noting the pattern.\n\n---\n\n## Requirement Coverage\n\n| Requirement | Status | Evidence |\n|---|---|---|\n| REQ-MVP-7 (add by BGG ID, search, manual) | SATISFIED | game-service.ts addGame handles both bggId and name-only; searchGames delegates to BggClient |\n| REQ-MVP-10 (import from BGG collection) | SATISFIED | importBggCollection with skip/error handling |\n| REQ-MVP-11 (offline functionality) | SATISFIED | addGame catch block, optional bggClient, manual entry works without BGG |\n| REQ-MVP-12 (clear error on missing token) | SATISFIED | assertConfigured with registration URL |\n| REQ-MVP-13 (API failures don't crash) | PARTIALLY SATISFIED | Errors don't crash, but addGame silently swallows fetch errors (Finding #2) |\n| REQ-MVP-18 (BGG data cached, 7-day TTL) | SATISFIED | fetchedAt stored in BggGameData; TTL check deferred to Phase 4 routes |\n| REQ-MVP-19 (refresh preserves overrides) | SATISFIED | refreshBggData updates bggData without touching game.ratings |\n\n## Test Inventory\n\nAll tests specified in the plan for Phase 3 exist:\n- `bgg-client.test.ts`: 12 tests covering search, getGame, batch, collection, 202 retry, 429 backoff, 502/503 retry, malformed XML, missing token\n- `bgg-xml-parser.test.ts`: 10 tests covering thing parsing (Wingspan, Gloomhaven), averageweight=0, primary name extraction, search parsing, collection parsing\n- `fitness-service.test.ts`: 12 tests (Phase 2 + Phase 3 BGG-derived axis tests)\n- `game-service-bgg.test.ts`: 8 tests covering addGame with BGG, offline fallback, search, refresh, refreshAll, BGG-derived axes in score, override breakdown\n- `import.test.ts`: 6 tests covering full import, duplicate skip, progress events, partial failure, empty collection, missing config\n\n**Cannot verify tests pass.** Must run `bun test` separately."
  - timestamp: 2026-04-05T20:07:47.225Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All criteria examined. Preparing final review with prioritized findings."
projectName: shelf-judge
---

# Phase 3 Review: BGG Integration

## Limitation

I cannot run `bun test`. My posture is read-only (no shell execution). All findings are from static analysis. **Tests must be run before accepting this review.**

---

## Findings (priority order)

### 1. DEFECT: Fixture files are synthetic, not captured real API responses

**Files:** `packages/daemon/tests/fixtures/*.xml`

The spec (mvp.md line 148) and plan (line 385) both require: "BGG XML parsing tested against captured real API responses, not synthetic XML."

Evidence the fixtures are hand-crafted:

- Missing fields present in real responses (no `boardgameartist` links, no `suggested_playerage` poll, no `language_dependence` poll)
- Gloomhaven fixture uses truncated image URLs ("thumbnail.jpg", "original.jpg") instead of real CDN hashes
- Collection fixture has pubdate "Sun, 06 Apr 2026" (tomorrow)
- Round stat numbers (numWeightVotes: exactly 12000, 15000)

The fixtures follow correct BGG XML structure, so the parser will likely work against real data. But the explicit spec requirement is unmet.

**Action:** Capture real API responses using `curl` against the BGG API with a valid token and replace the fixture files. Then verify tests still pass.

---

### 2. DEFECT: Silent catch block swallows BGG fetch errors in addGame

**File:** `packages/daemon/src/services/game-service.ts:123-125`

```typescript
} catch {
  // BGG unavailable: still add the game with null bggData
}
```

When addGame fetches BGG data and it fails, the error is silently discarded. The caller gets a Game with `bggData: null`, indistinguishable from "no BGG fetch attempted." REQ-MVP-13 requires: "Failures are reported to the user with enough context to understand what happened."

**Action:** Either return a warning alongside the game (e.g., `{ game, warning?: string }`), or at minimum log the error. The user should know their game was added but BGG data couldn't be fetched.

---

### 3. DEFECT: 429 backoff test doesn't verify timing behavior

**File:** `packages/daemon/tests/services/bgg-client.test.ts:182-193`

The plan (line 379) specifies: "429 response triggers backoff (verify timing via mock)." The test injects `delayFn: async () => {}` (no-op) and only verifies that the retry happens and eventually succeeds. It doesn't verify that delayFn was called with `BACKOFF_429_MS` (30000) or that `currentDelayMs` was set to 10000.

**Action:** Capture delayFn arguments. Assert the first delay call receives 30000 (the backoff) and that subsequent requests use the 10s rate.

---

### 4. CONCERN: Weight-to-rating scaling (x2) is undocumented

**File:** `packages/daemon/src/services/fitness-service.ts:28-29`

```typescript
case "weight":
  if (bggData.weight === null) return null;
  return bggData.weight * 2;
```

BGG weight (1-5) is scaled to 2-10 by multiplying by 2. This is a reasonable mapping but appears in no design document. A reader encountering `* 2` will wonder why.

**Action:** Add a comment: `// BGG weight is 1-5 scale; multiply by 2 to map to 1-10 rating scale`

---

### 5. CONCERN: Rate limiter is not actually a queue

**File:** `packages/daemon/src/services/bgg-client.ts:71-81`

The plan (line 346) says: "a sequential request queue... The queue is internal to BggClient; callers don't see it." The implementation is a timestamp-based throttle, not a queue. It works correctly only because all current callers are already sequential (await in loops). If anyone adds parallel requests, the rate limiter fails silently: two concurrent calls read the same `lastRequestTime`, both proceed, and BGG sees a burst.

**Action:** For MVP, add a comment documenting that the throttle assumes single-threaded access. Post-MVP, replace with a proper mutex-guarded queue.

---

### 6. OBSERVATION: Breakdown derivation test validates consistency, not correctness

**File:** `packages/daemon/tests/services/fitness-service.test.ts:319-339`

The "score is derivable from breakdown contributions" test computes expected score from the code's own contribution outputs. If contributions and score are both wrong in the same way, the test passes. This is a known antipattern from the lessons-learned rules.

Not a blocker. The Wingspan example test (lines 52-106) validates against hand-calculated values and covers correctness. This test catches a real class of bugs (rounding drift between contributions and final score). Just noting the pattern.

---

## Requirement Coverage

| Requirement                               | Status              | Evidence                                                                                     |
| ----------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| REQ-MVP-7 (add by BGG ID, search, manual) | SATISFIED           | game-service.ts addGame handles both bggId and name-only; searchGames delegates to BggClient |
| REQ-MVP-10 (import from BGG collection)   | SATISFIED           | importBggCollection with skip/error handling                                                 |
| REQ-MVP-11 (offline functionality)        | SATISFIED           | addGame catch block, optional bggClient, manual entry works without BGG                      |
| REQ-MVP-12 (clear error on missing token) | SATISFIED           | assertConfigured with registration URL                                                       |
| REQ-MVP-13 (API failures don't crash)     | PARTIALLY SATISFIED | Errors don't crash, but addGame silently swallows fetch errors (Finding #2)                  |
| REQ-MVP-18 (BGG data cached, 7-day TTL)   | SATISFIED           | fetchedAt stored in BggGameData; TTL check deferred to Phase 4 routes                        |
| REQ-MVP-19 (refresh preserves overrides)  | SATISFIED           | refreshBggData updates bggData without touching game.ratings                                 |

## Test Inventory

All tests specified in the plan for Phase 3 exist:

- `bgg-client.test.ts`: 12 tests covering search, getGame, batch, collection, 202 retry, 429 backoff, 502/503 retry, malformed XML, missing token
- `bgg-xml-parser.test.ts`: 10 tests covering thing parsing (Wingspan, Gloomhaven), averageweight=0, primary name extraction, search parsing, collection parsing
- `fitness-service.test.ts`: 12 tests (Phase 2 + Phase 3 BGG-derived axis tests)
- `game-service-bgg.test.ts`: 8 tests covering addGame with BGG, offline fallback, search, refresh, refreshAll, BGG-derived axes in score, override breakdown
- `import.test.ts`: 6 tests covering full import, duplicate skip, progress events, partial failure, empty collection, missing config

**Cannot verify tests pass.** Must run `bun test` separately.

## Decisions

**Can I run bun test as part of this review?**
Cannot run tests. Thorne's posture is read-only (no Bash tool). Static analysis only.
_Reasoning: The commission asks to run bun test, but the Warden role prohibits file modification and shell execution. The findings will note this as a limitation and recommend the Guild Master runs tests before accepting the review._

**Criterion 1: Does the BGG client handle 202 retry with correct exponential backoff (5s, 10s, 20s)?**
PASS. The implementation is correct.
_Reasoning: bgg-client.ts:130-154. fetchWithRetry202 loops from attempt=0 to MAX_202_RETRIES (3). On 202, backoff is BASE_202_DELAY_MS _ Math.pow(2, attempt) = 5000 _ 2^0 = 5s, 5000 _ 2^1 = 10s, 5000 _ 2^2 = 20s. After the 4th 202 (attempt === MAX_202_RETRIES at attempt 3), it throws. This matches the design spec exactly. The test at bgg-client.test.ts:156-179 covers both success-after-retry and max-retry-exhaustion._

**Criterion 2: Rate limiting uses a sequential queue with configurable delay?**
PASS. Implementation matches spec.
_Reasoning: bgg-client.ts:71-128. throttledFetch tracks lastRequestTime and waits currentDelayMs between requests. The delay is configurable via deps.delayMs (default 5000). Tests inject delayMs: 0 for speed. The "sequential queue" is implicit: each call to throttledFetch awaits the delay before firing, and since all public methods await throttledFetch, requests are naturally serialized. This isn't a formal queue data structure, but for a single-caller pattern it achieves the same effect._

**Criterion 3: 429 backoff: 30s pause, then 1 req/10s?**
PASS with a minor concern about recovery behavior.
_Reasoning: bgg-client.ts:93-103. On 429, waits BACKOFF_429_MS (30s), sets currentDelayMs to 10000 (1 req/10s), then recurses. On successful non-429 response (line 106-110), rateLimitRetries resets to 0 and currentDelayMs halves toward delayMs. The "gradual return to normal" is implemented as a single halving step per successful request (line 109: currentDelayMs = Math.max(delayMs, currentDelayMs / 2)). With delayMs=5000 and currentDelayMs=10000, one success brings it to max(5000, 5000)=5000, so recovery is actually instant (one successful request restores full speed). This is fine for the MVP but the word "gradually" in the design suggests multi-step decay. Low severity._

**Criterion 4: 502/503 retry after 30s, max 2 retries?**
PASS.
_Reasoning: bgg-client.ts:113-119. On 502/503, if retryCount < MAX_5XX_RETRIES (2), waits RETRY_5XX_MS (30s) and retries with retryCount+1. Max 2 retries means 3 total attempts (initial + 2 retries). Test at bgg-client.test.ts:218-227 confirms: 3 502s cause failure._

**Criterion 5: XML parsing uses captured real API responses, not synthetic XML?**
FINDING: Fixtures are plausible but almost certainly hand-crafted, not captured from the real BGG API.
\*Reasoning: The spec's AI validation criteria (mvp.md line 148) requires "BGG XML parsing tested against captured real API responses, not synthetic XML." The plan (line 385) reiterates: "Critical: Use captured real API responses for XML parser tests, not synthetic XML."

Evidence the fixtures are NOT captured real responses:

1. thing-wingspan-266192.xml: Missing fields that real BGG responses include (e.g., <link type="boardgameartist">, <link type="boardgamepublisher" with multiple publishers>, <poll name="suggested_playerage">, <poll name="language_dependence">). A real API capture would include all of these.
2. The image URLs use geekdo-images.com patterns but the Gloomhaven fixture (thing-gloomhaven-174430.xml:4-5) uses truncated URLs like "thumbnail.jpg" and "original.jpg" instead of real CDN hashes.
3. The collection fixture (collection-testuser.xml) has a pubdate of "Sun, 06 Apr 2026" which is tomorrow. A captured response wouldn't have a future date.
4. Round numbers in stats (numWeightVotes: exactly 12000, 15000) are suspiciously clean for real data.

The fixtures follow the correct BGG XML structure (attributes, nesting, field names all match the research doc), so the parser will work against real data. But the spec requirement was explicit: captured real responses. These are well-crafted synthetic fixtures that match the schema.\*

**Criterion 6: averageweight=0 maps to null?**
PASS.
_Reasoning: bgg-xml-parser.ts:94-99. parseThingResponse extracts averageweight, then: "const weight = avgWeight === 0 ? null : avgWeight;". Test at bgg-xml-parser.test.ts:81-95 verifies with inline XML containing averageweight=0 and asserts result is null._

**Criterion 7: Primary name extraction when multiple name elements exist?**
PASS.
_Reasoning: bgg-xml-parser.ts:35-38. extractPrimaryName finds name with @\_type="primary", falls back to first name, then "Unknown". The Wingspan fixture has 3 name elements (primary + 2 alternate). Test at bgg-xml-parser.test.ts:97-103 verifies extraction returns "Wingspan" from the multi-name fixture._

**Criterion 8: Missing token returns clear error with registration URL (REQ-MVP-12)?**
PASS.
_Reasoning: bgg-client.ts:55-61. assertConfigured throws: "BGG application token not configured. Register at https://boardgamegeek.com/using_the_xml_api and run `shelf-judge config set bgg-token YOUR_TOKEN`." Test at bgg-client.test.ts:247-262 verifies both the message and the URL. GameService also has its own assertBggConfigured at game-service.ts:77-83 for when bggClient is absent entirely, with the same URL._

**Criterion 9: Offline scenario - game addition works without BGG data (REQ-MVP-11)?**
PASS.
_Reasoning: game-service.ts:119-126. When addGame has a bggId, it attempts BGG fetch inside a try/catch. On failure (line 123-125), the catch is empty and the game is added with bggData: null. Test at game-service-bgg.test.ts:98-110 mocks 500 responses and verifies game is added with null bggData. Manual games (no bggId) skip the BGG fetch entirely (line 119 condition). GameService also works without a bggClient at all (deps.bggClient is optional at line 57)._

**Criterion 10: Import - duplicates skipped, partial failures handled, progress events streamed?**
PASS.
\*Reasoning: game-service.ts:287-385. importBggCollection:

- Duplicates: Lines 309-311 build existingBggIds set; lines 319-325 filter newItems vs skippedItems. Test import.test.ts:140-188 pre-adds Wingspan and verifies skipped=1.
- Partial failures: Lines 352-358, if bggResults.get(item.bggId) returns nothing, error recorded and loop continues. Test import.test.ts:256-300 verifies 2 imported, 1 error for missing Terraforming Mars.
- Progress events: Line 293-297 emits fetching-collection event. Lines 345-350 emit importing-games events per item with current/total/gameName. Test import.test.ts:190-254 captures events and verifies structure.\*

**Criterion 11: Refresh preserves user overrides of BGG-derived ratings (REQ-MVP-19)?**
PASS.
_Reasoning: game-service.ts:226-246. refreshBggData calls applyBggResult (line 240) which updates game.name, yearPublished, player counts, bggData, but does NOT touch game.ratings. User overrides live in game.ratings (keyed by axisId), so they survive the refresh. Test at game-service-bgg.test.ts:138-166 sets a rating on the complexity axis (value 7), refreshes, and verifies the override persists. The fitness service then resolves this at score time: fitness-service.ts:60-68 checks game.ratings first, and if present uses that with source "override" and records bggOriginal._

**Criterion 12: BGG-derived ratings computed at score time, not stored in game.ratings?**
PASS.
_Reasoning: fitness-service.ts:18-33. resolveBggRating computes BGG-derived values on the fly from the axis.bggField and bggData parameter. The main calculateScore method (line 52-53) reads game.ratings for personal ratings and calls resolveBggRating separately. BGG values are never written into game.ratings. game.ratings only contains user-entered values. This matches the plan's design note at mvp.md line 399: "The rating in game.ratings represents user input only; BGG-derived values are computed on the fly."_

**Criterion 13: All tests from the plan exist?**
FINDING: One planned test is missing. The 429 backoff test doesn't verify timing behavior.
\*Reasoning: The plan at step 3.1 specifies these tests for BggClient:

- search delegates to fetch with correct URL and auth header: PRESENT (bgg-client.test.ts:85-102)
- getGame delegates to fetch with stats=1: PRESENT (bgg-client.test.ts:105-121)
- 202 response triggers retry: PRESENT (bgg-client.test.ts:157-167)
- 202 after max retries returns error: PRESENT (bgg-client.test.ts:169-179)
- 429 response triggers backoff (verify timing via mock): PARTIALLY PRESENT. The test at bgg-client.test.ts:183-193 verifies that 429 triggers a retry and eventually succeeds, but it doesn't verify timing behavior (the plan says "verify timing via mock"). The delayFn is injected as a no-op, so the test proves retry happens but not that the 30s backoff and 10s recovery rate are applied. A proper timing test would capture delayFn arguments and assert they match BACKOFF_429_MS and the new rate.
- 502/503 triggers retry: PRESENT (bgg-client.test.ts:195-227)
- malformed XML returns error, not crash: PRESENT (bgg-client.test.ts:229-245)
- missing token returns clear error with registration URL: PRESENT (bgg-client.test.ts:247-262)
- batch getGames batches up to 250 IDs: PRESENT (bgg-client.test.ts:123-139)

XML parser tests: All present as specified in plan.

Game service BGG tests (step 3.2): All present.

Import tests (step 3.3): All present.\*

**Does the BGG client correctly validate against the research document's endpoint descriptions?**
PASS. Endpoints match the research.
\*Reasoning: Research doc specifies:

- Thing endpoint: /xmlapi2/thing?id={bggId}&stats=1&type=boardgame. Client: bgg-client.ts:178 builds this exactly.
- Search endpoint: /xmlapi2/search?query={name}&type=boardgame. Client: bgg-client.ts:163 matches.
- Collection endpoint: /xmlapi2/collection?username={bggUsername}&own=1&subtype=boardgame&stats=1. Client: bgg-client.ts:240 matches. Note: design doc says "subtype=boardgame" but the implementation uses "subtype=boardgame" correctly.
- Auth header: All requests include Authorization: Bearer TOKEN via authHeaders() at line 63-66.
- Batch IDs: Client batches 250 per request (line 14, MAX_BATCH_SIZE = 250), matching research recommendation of 250-500.\*

**Is there a silent catch block in addGame that should surface errors?**
FINDING: Silent catch block at game-service.ts:123 swallows BGG fetch errors without logging or reporting.
\*Reasoning: game-service.ts:119-126. When addGame attempts to fetch BGG data and fails, the empty catch block silently swallows the error. The game is added with null bggData, which is correct behavior (REQ-MVP-11 requires offline functionality). However, the caller has no way to know that BGG data was requested but couldn't be fetched. The returned Game object has bggData: null, which is indistinguishable from "no BGG fetch was attempted."

The spec (REQ-MVP-13) says: "Failures are reported to the user with enough context to understand what happened." For addGame, the game still gets added, but the user should know the BGG fetch failed.

Recommendation: Return a warning alongside the game, or at minimum log the error. A common pattern is to include a warnings array in the response.\*

**Does the weight-to-rating conversion in the fitness service make sense?**
FINDING: Weight scaling (multiply by 2) is undocumented and potentially incorrect.
_Reasoning: fitness-service.ts:28-29. When axis.bggField is "weight", the code returns bggData.weight _ 2. BGG weight is a 1-5 scale. Multiplying by 2 maps it to 2-10. But the rating scale in the system is 1-10 (per REQ-MVP-2). A BGG weight of 1.0 becomes 2.0, which is above the minimum of 1 on the personal rating scale. A weight of 5.0 becomes 10.0.

This linear scaling is a reasonable choice, but:

1. It's not documented anywhere in the design docs or specs. The design doc (mvp-bgg-integration.md) doesn't specify how BGG weight (1-5) maps to the 1-10 axis rating scale.
2. The test at game-service-bgg.test.ts:263 asserts bggOriginal is 4.9 (2.45 \* 2), confirming this is intentional. But a reader of the fitness service code has to infer the scaling rationale.
3. A weight of 0 is mapped to null upstream, but a weight of 0.5 (if it existed) would become 1.0, which is valid. The mapping is consistent.

Recommendation: Add a comment explaining the 2x scaling rationale. This is a "clever code" case where a one-line comment prevents future confusion.\*

**Is there a concurrency issue with the rate limiter when multiple callers invoke throttledFetch simultaneously?**
FINDING: Potential race condition in rate limiter under concurrent callers.
\*Reasoning: bgg-client.ts:71-128. throttledFetch reads lastRequestTime at line 76, computes elapsed, potentially waits, then sets lastRequestTime at line 81. If two callers enter throttledFetch concurrently (e.g., during importBggCollection if it were parallelized), both read the same lastRequestTime, both compute the same elapsed, both decide they can proceed, and both fire simultaneously, defeating the rate limiter.

Currently this is mitigated by the fact that all import and refresh operations are sequential (await in loops). But the rate limiter design claims to be a "sequential request queue" (plan line 346), and it isn't actually a queue. It's a timestamp-based throttle that works correctly only when callers are already serialized.

Severity: Low for MVP (all callers are currently sequential). But if anyone adds parallel requests in the future, the rate limiter will fail silently. The plan explicitly says "The queue is internal to BggClient; callers don't see it" (line 346), implying the client should enforce sequencing regardless of caller behavior.

Recommendation: Either add a mutex/semaphore to enforce true sequential execution, or document that the rate limiter assumes single-threaded access.\*

**Does the collection endpoint use the correct parameter name per the research doc?**
PASS.
_Reasoning: bgg-client.ts:240 uses username={}, own=1, subtype=boardgame, stats=1. The research doc (bgg-api.md line 169-170) specifies username (required), subtype, own=1, stats=1. The design doc (mvp-bgg-integration.md line 36) specifies the same. All match._

**Does the parser handle the collection endpoint's different XML structure correctly?**
PASS with a note.
_Reasoning: The collection endpoint returns a different XML structure than the thing endpoint. Specifically, the collection uses objectid attribute (not id) and name as text content (not as an attribute). The parser at bgg-xml-parser.ts:183-211 handles both correctly: bggId comes from @\_objectid (line 206), and the name extraction (lines 188-202) handles the text content format with multiple fallback paths. The fixture at collection-testuser.xml uses the correct collection format with objectid, text content names, and nested stats/rating elements._

**Is the fitness-service.test.ts:319-339 "score is derivable from breakdown contributions" test sound?**
FINDING: The breakdown derivation test may validate consistency, not correctness.
\*Reasoning: fitness-service.test.ts:319-339. This test computes expected score from the breakdown's own contribution values and totalWeight values, then asserts the returned score matches. But both the score and the contributions come from the same code. If the code computed contributions wrong and the score wrong in the same way, this test would still pass.

The test at line 338 does: expect(result!.score).toBe(Math.round((totalContribution / totalWeight) \* 10) / 10). This is literally re-implementing the scoring formula using the code's own output as inputs. It validates internal consistency (contributions sum to score) but not that the contributions are correct.

Compare with the Wingspan example test (lines 52-106) which uses known input values and hand-calculated expected outputs. That test validates correctness. This one validates consistency.

Severity: Low. The Wingspan example test and the other specific tests cover correctness. This test catches a real class of bugs (where contributions and final score drift apart due to rounding). But it's worth noting for the principle: tests that construct expected values from the code's own output validate consistency, not correctness.\*

**Does the 202 retry logic have an off-by-one issue?**
FINDING: The 202 retry logic makes one more throttled request than expected due to interaction with throttledFetch.
\*Reasoning: bgg-client.ts:130-154. fetchWithRetry202 loops from attempt=0 to MAX_202_RETRIES (3), making up to 4 calls to throttledFetch. On the first call (attempt=0), if 202, it waits 5s and continues. On attempt=1, waits 10s. On attempt=2, waits 20s. On attempt=3 (MAX_202_RETRIES), if still 202, it throws at line 139-142.

The design says "Max 3 retries. If still 202, return error." The implementation does 4 total requests: the initial request plus 3 retries. This matches "max 3 retries" if "retry" means "additional attempt after the first." But line 131 uses "attempt <= MAX_202_RETRIES" with MAX_202_RETRIES=3, so attempts 0,1,2,3 = 4 total requests. The exponential backoff runs on attempts 0,1,2 (5s, 10s, 20s). Attempt 3 hits the 202 check at line 139 and throws immediately without an additional wait.

The test at bgg-client.test.ts:169-179 enqueues 4 responses (all 202), which is consistent. So the behavior is: 4 requests total, 3 backoff waits, then error. This matches "3 retries" semantics. PASS.\*

**Does isConfigured handle all edge cases for missing tokens?**
PASS. Covers null, empty string, and truthy values.
_Reasoning: bgg-client.ts:157-159. Returns true only when bggAuthToken is not null and not empty string. Tests cover null (line 66-70) and empty string (line 74-80). The AppConfig type defines bggAuthToken as string | null, so undefined isn't a valid state in the type system._
