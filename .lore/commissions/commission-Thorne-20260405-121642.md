---
title: "Commission: Phase 4 Review: Daemon API"
date: 2026-04-05
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review Phase 4 implementation of the MVP plan.\n\nRead `.lore/plans/mvp.md` (Phase 4), `.lore/designs/mvp-api-surface.md`, `.lore/reference/architecture-pattern.md`, `.lore/specs/mvp.md` (REQ-MVP-22, 11, 12).\n\nReview criteria:\n1. Every route from the API surface design exists with correct method, path, and response shape\n2. Error responses follow consistent shape: `{ error: string, details?: unknown }`\n3. BGG-dependent routes return 503 with setup instructions when no token (REQ-MVP-12)\n4. Input validation via Zod on all routes that accept input\n5. SSE import route streams progress and complete events in correct format\n6. SSE sets `idleTimeout: 0`\n7. Operations registry covers all routes with correct descriptions\n8. DI wiring in app factory is correct (services get their dependencies)\n9. Config resolution handles env vars and file-based config\n10. All tests from the plan exist and pass\n11. Score list sorts correctly (fitness descending, unscored at end)\n\nRun `bun test` and report results. Verify every route path against the API surface design document."
dependencies:
  - commission-Dalton-20260405-121635
linked_artifacts:
  - .lore/plans/mvp.md

  - .lore/designs/mvp-api-surface.md
  - packages/daemon/src/routes/games.ts
  - packages/daemon/src/routes/axes.ts
  - packages/daemon/src/routes/scores.ts
  - packages/daemon/src/routes/import.ts
  - packages/daemon/src/routes/help.ts
  - packages/daemon/src/routes/config.ts
  - packages/daemon/src/app.ts
  - packages/daemon/src/config.ts
  - packages/daemon/src/index.ts
  - packages/daemon/src/operations.ts
  - .lore/designs/mvp-api-surface.md
  - packages/daemon/src/routes/games.ts
  - packages/daemon/src/routes/axes.ts
  - packages/daemon/src/routes/scores.ts
  - packages/daemon/src/routes/import.ts
  - packages/daemon/src/routes/help.ts
  - packages/daemon/src/routes/config.ts
  - packages/daemon/src/app.ts
  - packages/daemon/src/config.ts
  - packages/daemon/src/index.ts
  - packages/daemon/src/operations.ts
activity_timeline:
  - timestamp: 2026-04-05T19:16:42.740Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-05T19:22:19.171Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-05T20:25:53.438Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-05T20:25:53.440Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-05T20:25:53.452Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-05T20:25:59.359Z
    event: progress_report
    reason: "Starting Phase 4 review. Reading plan, specs, and design documents first."
  - timestamp: 2026-04-05T20:26:42.843Z
    event: progress_report
    reason: "Read all route files, app factory, config, operations registry, and entry point. Reading test files and shared types next."
  - timestamp: 2026-04-05T20:27:42.161Z
    event: progress_report
    reason: "All source and test files read. Cannot run tests (no shell access). Now systematically checking each review criterion against the code."
  - timestamp: 2026-04-05T20:30:48.600Z
    event: progress_report
    reason: "All 11 criteria reviewed. Found 5 actionable findings and 3 observations. Compiling final result."
  - timestamp: 2026-04-05T20:31:33.905Z
    event: result_submitted
    reason: "# Phase 4 Review: Daemon API (Hono Routes)\n\n## Verdict\n\nSolid implementation. All routes exist, the DI pattern is clean, operations registry is complete, and test coverage is reasonable. Five findings need attention before this phase is complete; two are spec compliance issues, one is a correctness defect, and two are design drift.\n\n---\n\n## Findings (priority order)\n\n### F1: SSE progress writes are not awaited [Defect]\n\n**File:** `packages/daemon/src/routes/import.ts:51-58`\n\nThe progress callback calls `stream.writeSSE()` without `await`. The callback signature is synchronous (`(event: ImportProgressEvent) => void` at game-service.ts:53), so the async write fires and forgets. Progress events may race with each other and with the final `complete` event at line 61 (which IS awaited).\n\n**Impact:** Under load or with slower I/O, clients may receive progress events out of order or interleaved with the complete event.\n\n**Fix:** Either make the `onProgress` callback type `(event) => Promise<void>` and await it in the service, or collect progress events and flush them sequentially in the route.\n\n---\n\n### F2: AddGameSchema requires name even for bggId-only adds [Spec mismatch]\n\n**File:** `packages/shared/src/validation.ts:22-30`\n\nThe API surface design specifies a union: `{ bggId: number } | { name: string, yearPublished?: number }`. The schema requires `name` as a non-empty string on every request. A client cannot add a game by BGG ID alone.\n\n**Impact:** Clients must supply a name even when adding by BGG ID, where the name will be overwritten by BGG data anyway. This contradicts the API design.\n\n**Fix:** Use a Zod discriminated union or `.refine()` that requires either `name` or `bggId` (or both), but not `name` unconditionally.\n\n---\n\n### F3: POST /api/games response missing `bggImported` field [Spec mismatch]\n\n**File:** `packages/daemon/src/services/game-service.ts:13-16`, `packages/daemon/src/routes/games.ts:79`\n\nThe API surface design says the response is `{ game: Game, bggImported: boolean }`. The implementation returns `{ game: Game, warning?: string }`. The `bggImported` boolean is absent.\n\n**Impact:** Clients cannot programmatically determine whether BGG data was fetched without inspecting `game.bggData !== null`, which conflates \"not fetched\" with \"fetched but had no data.\"\n\n**Fix:** Add `bggImported: boolean` to `AddGameResult`. The `warning` field can stay as an addition.\n\n---\n\n### F4: SSE progress event `imported` field sends wrong value [Correctness]\n\n**File:** `packages/daemon/src/routes/import.ts:53`\n\nThe progress event sends `imported: event.current`, but `ImportProgressEvent.current` (game-service.ts:352) is `skipped + imported + i + 1`, a 1-based global progress counter, not the count of successfully imported games. The API design says `imported: number` should be the count of imports so far.\n\n**Impact:** Clients displaying \"Imported 4 of 5\" would actually show the overall progress index, which includes skipped games. For a collection with 3 skipped and 2 new, `imported` would show 4 for the first new game, not 0.\n\n**Fix:** Either rename the field to match its semantics (e.g., `progress` instead of `imported`) or change the service to emit a separate `importedSoFar` counter.\n\n---\n\n### F5: Import route input method diverges from API surface design [Design drift]\n\n**File:** `packages/daemon/src/routes/import.ts:39`, API design line 47\n\nThe API surface design says `POST /api/import/bgg?username={bggUsername}` (query parameter). The implementation reads username from the JSON body. The plan (step 4.5) references \"Technical Decision #7\" as justification, but the API surface design was not updated.\n\n**Impact:** A client implemented from the design document would send the username as a query parameter and get a validation error. Not a code defect, but a documentation/design debt.\n\n**Fix:** Update the API surface design to match the implementation (body-based), or the other way around. Pick one and make them agree.\n\n---\n\n## Observations (no action required)\n\n### O1: Dead code in app factory\n\n`createApp()` at app.ts:38-54 contains service creation logic that is never exercised. Both the entry point (index.ts) and test helper (test-app.ts) create all services externally and pass them in. The fallback path in createApp is unused. Not a bug, but dead code accrues maintenance cost.\n\n### O2: `bggNotConfiguredResponse()` bypasses Hono context\n\ngames.ts:22-28 uses `Response.json()` instead of `c.json()`. This works because Hono accepts raw Response returns, but it's inconsistent with the rest of the codebase and bypasses any Hono middleware. The same 503 response in import.ts:24 uses `c.json()`.\n\n### O3: Score list sort relies on implicit service contract\n\nscores.ts:36 does not sort the scored array itself. It depends on `gameService.listGames()` returning pre-sorted results. This is correct today but creates a coupling where a change to the service's sort order silently breaks the route's contract.\n\n---\n\n## Criteria Checklist\n\n| # | Criterion | Result |\n|---|---|---|\n| 1 | Every route exists with correct method/path/response | All 18 routes present. Response shapes have F2, F3 deviations |\n| 2 | Error responses follow `{ error, details? }` shape | Pass |\n| 3 | BGG routes return 503 without token | Pass |\n| 4 | Zod validation on all input routes | Pass |\n| 5 | SSE streams progress and complete events | Pass with F1 (unawaited writes) and F4 (wrong field value) |\n| 6 | SSE sets idleTimeout: 0 | Set server-wide at index.ts:47, not at route level. Acceptable |\n| 7 | Operations registry covers all routes | Pass (18/18) |\n| 8 | DI wiring correct | Pass (with O1 dead code note) |\n| 9 | Config resolution handles env/file | Pass |\n| 10 | All tests exist and pass | All test files exist. Cannot verify pass/fail (no shell access) |\n| 11 | Score list sorts correctly | Pass (with O3 implicit coupling note) |\n\n---\n\n## Unable to Verify\n\n**`bun test` execution:** The review posture is read-only with no shell access. Tests must be run by a worker with execution capability. All expected test files exist and test the cases specified in the plan."
  - timestamp: 2026-04-05T20:31:40.988Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All 11 criteria reviewed. Found 5 actionable findings and 3 observations. Compiling final result."
projectName: shelf-judge
---
# Phase 4 Review: Daemon API (Hono Routes)

## Verdict

Solid implementation. All routes exist, the DI pattern is clean, operations registry is complete, and test coverage is reasonable. Five findings need attention before this phase is complete; two are spec compliance issues, one is a correctness defect, and two are design drift.

---

## Findings (priority order)

### F1: SSE progress writes are not awaited [Defect]

**File:** `packages/daemon/src/routes/import.ts:51-58`

The progress callback calls `stream.writeSSE()` without `await`. The callback signature is synchronous (`(event: ImportProgressEvent) => void` at game-service.ts:53), so the async write fires and forgets. Progress events may race with each other and with the final `complete` event at line 61 (which IS awaited).

**Impact:** Under load or with slower I/O, clients may receive progress events out of order or interleaved with the complete event.

**Fix:** Either make the `onProgress` callback type `(event) => Promise<void>` and await it in the service, or collect progress events and flush them sequentially in the route.

---

### F2: AddGameSchema requires name even for bggId-only adds [Spec mismatch]

**File:** `packages/shared/src/validation.ts:22-30`

The API surface design specifies a union: `{ bggId: number } | { name: string, yearPublished?: number }`. The schema requires `name` as a non-empty string on every request. A client cannot add a game by BGG ID alone.

**Impact:** Clients must supply a name even when adding by BGG ID, where the name will be overwritten by BGG data anyway. This contradicts the API design.

**Fix:** Use a Zod discriminated union or `.refine()` that requires either `name` or `bggId` (or both), but not `name` unconditionally.

---

### F3: POST /api/games response missing `bggImported` field [Spec mismatch]

**File:** `packages/daemon/src/services/game-service.ts:13-16`, `packages/daemon/src/routes/games.ts:79`

The API surface design says the response is `{ game: Game, bggImported: boolean }`. The implementation returns `{ game: Game, warning?: string }`. The `bggImported` boolean is absent.

**Impact:** Clients cannot programmatically determine whether BGG data was fetched without inspecting `game.bggData !== null`, which conflates "not fetched" with "fetched but had no data."

**Fix:** Add `bggImported: boolean` to `AddGameResult`. The `warning` field can stay as an addition.

---

### F4: SSE progress event `imported` field sends wrong value [Correctness]

**File:** `packages/daemon/src/routes/import.ts:53`

The progress event sends `imported: event.current`, but `ImportProgressEvent.current` (game-service.ts:352) is `skipped + imported + i + 1`, a 1-based global progress counter, not the count of successfully imported games. The API design says `imported: number` should be the count of imports so far.

**Impact:** Clients displaying "Imported 4 of 5" would actually show the overall progress index, which includes skipped games. For a collection with 3 skipped and 2 new, `imported` would show 4 for the first new game, not 0.

**Fix:** Either rename the field to match its semantics (e.g., `progress` instead of `imported`) or change the service to emit a separate `importedSoFar` counter.

---

### F5: Import route input method diverges from API surface design [Design drift]

**File:** `packages/daemon/src/routes/import.ts:39`, API design line 47

The API surface design says `POST /api/import/bgg?username={bggUsername}` (query parameter). The implementation reads username from the JSON body. The plan (step 4.5) references "Technical Decision #7" as justification, but the API surface design was not updated.

**Impact:** A client implemented from the design document would send the username as a query parameter and get a validation error. Not a code defect, but a documentation/design debt.

**Fix:** Update the API surface design to match the implementation (body-based), or the other way around. Pick one and make them agree.

---

## Observations (no action required)

### O1: Dead code in app factory

`createApp()` at app.ts:38-54 contains service creation logic that is never exercised. Both the entry point (index.ts) and test helper (test-app.ts) create all services externally and pass them in. The fallback path in createApp is unused. Not a bug, but dead code accrues maintenance cost.

### O2: `bggNotConfiguredResponse()` bypasses Hono context

games.ts:22-28 uses `Response.json()` instead of `c.json()`. This works because Hono accepts raw Response returns, but it's inconsistent with the rest of the codebase and bypasses any Hono middleware. The same 503 response in import.ts:24 uses `c.json()`.

### O3: Score list sort relies on implicit service contract

scores.ts:36 does not sort the scored array itself. It depends on `gameService.listGames()` returning pre-sorted results. This is correct today but creates a coupling where a change to the service's sort order silently breaks the route's contract.

---

## Criteria Checklist

| # | Criterion | Result |
|---|---|---|
| 1 | Every route exists with correct method/path/response | All 18 routes present. Response shapes have F2, F3 deviations |
| 2 | Error responses follow `{ error, details? }` shape | Pass |
| 3 | BGG routes return 503 without token | Pass |
| 4 | Zod validation on all input routes | Pass |
| 5 | SSE streams progress and complete events | Pass with F1 (unawaited writes) and F4 (wrong field value) |
| 6 | SSE sets idleTimeout: 0 | Set server-wide at index.ts:47, not at route level. Acceptable |
| 7 | Operations registry covers all routes | Pass (18/18) |
| 8 | DI wiring correct | Pass (with O1 dead code note) |
| 9 | Config resolution handles env/file | Pass |
| 10 | All tests exist and pass | All test files exist. Cannot verify pass/fail (no shell access) |
| 11 | Score list sorts correctly | Pass (with O3 implicit coupling note) |

---

## Unable to Verify

**`bun test` execution:** The review posture is read-only with no shell access. Tests must be run by a worker with execution capability. All expected test files exist and test the cases specified in the plan.

## Decisions

**Do all API surface routes exist with correct methods and paths?**
All 18 routes from the API surface design are present with correct HTTP methods and paths.
*Reasoning: Compared every row of the API surface design tables against the route files. All match: 7 game routes, 4 axis routes, 1 import route, 2 score routes, 2 help routes, 2 config routes.*

**Does POST /api/games return the correct response shape?**
Partial mismatch. The API design specifies `{ game: Game, bggImported: boolean }`. The implementation returns `{ game: Game, warning?: string }`. The `bggImported` field is missing; `warning` is an undocumented addition.
*Reasoning: API surface design line 73: Response is `{ game: Game, bggImported: boolean }`. Implementation at game-service.ts:138 returns `AddGameResult` which has `{ game: Game, warning?: string }`. The `bggImported` field that tells the caller whether BGG data was actually fetched is absent. The `warning` field is useful but is not in the design.*

**Does PUT /api/games/:id/ratings return the correct response shape?**
Match. API design specifies `{ game: Game, score: FitnessResult }`. Implementation returns `GameWithScore` which is `{ game: Game, score: FitnessResult | null }`. The `null` case is a valid edge case (game could have all-zero-weight axes after rating).
*Reasoning: games.ts:139 returns the result from gameService.rateGame, which returns GameWithScore. This matches the design shape.*

**Does the AddGameSchema match the API surface request shape?**
Mismatch. The API design says the request is a union: `{ bggId: number } | { name: string, yearPublished?: number }`. The implementation's AddGameSchema requires `name` always (even when adding by bggId). This means a client cannot add a game by BGG ID alone; it must also supply a name. The design says bggId-only is valid.
*Reasoning: validation.ts:22-30: AddGameSchema has `name: z.string().min(1)` as required, plus optional `bggId`. The API surface design at line 70 shows two alternatives: `{ bggId: number }` (name not required, fetched from BGG) or `{ name: string, yearPublished?: number }` (manual). The current schema does not model this union; it forces name on every request.*

**Do all error responses follow the consistent shape `{ error: string, details?: unknown }`?**
Yes. All error responses across all route files use `{ error: string }` or `{ error: string, details: ... }`. Consistent.
*Reasoning: Checked every catch block and error return in games.ts, axes.ts, scores.ts, import.ts, help.ts, config.ts. All use c.json({ error: string }, status) or c.json({ error: string, details: parsed.error.issues }, 400). No route returns a raw string or different error shape.*

**Do all BGG-dependent routes return 503 with setup instructions when no token is configured?**
Yes. BGG-dependent routes (search, add-by-bggId, refresh, import) all check BGG configuration and return 503 with a message containing registration URL and config command.
*Reasoning: games.ts:41 (search), games.ts:74 (add-by-bggId), games.ts:171 (refresh) all call isBggConfigured() and return bggNotConfiguredResponse() which is 503 with a detailed error. import.ts:23 checks directly. The error message includes "Register at https://boardgamegeek.com/using_the_xml_api" and "shelf-judge config set bgg-token YOUR_TOKEN".*

**Do all routes that accept input validate with Zod?**
Yes, all routes with request bodies use Zod schemas. POST /api/games uses AddGameSchema, PUT /api/games/:id/ratings uses RatingsBodySchema, POST /api/axes uses CreateAxisSchema, PUT /api/axes/:id uses UpdateAxisSchema, POST /api/import/bgg uses ImportBodySchema, PUT /api/config uses UpdateConfigSchema. GET /api/games/search validates the query parameter manually (not Zod) but it's a simple presence check, which is reasonable.
*Reasoning: Reviewed every route handler. All POST/PUT bodies go through safeParse with appropriate Zod schemas. The search route validates `q` with a simple truthy check, which is adequate for a single required string parameter.*

**Does the SSE import route stream progress and complete events in the correct format?**
Partially correct. The route streams `event: progress` with `{ imported, total, current }` and `event: complete` with `{ imported, skipped, errors }`. However, the progress event field naming diverges from the API design. The design says `{ imported: number, total: number, current: string }` where `current` is a game name. The implementation sends `event.current` (a number from ImportProgressEvent) as `imported` and `event.gameName` as `current`. The progress callback receives ImportProgressEvent which has `current: number` (an index) and `gameName?: string`. The route maps `event.current` to `imported`, which is misleading: during import of 2 new games with 3 total, `event.current` might be 4 (skipped + imported + i + 1), not the count of games imported so far.
*Reasoning: import.ts:50-58: The progress callback writes `imported: event.current`. But ImportProgressEvent.current at game-service.ts:352 is `skipped + imported + i + 1`, which is a progress counter (1-based index across all items), not the count of successfully imported games. The API design field `imported` should represent how many games have been imported so far, not an overall progress counter. This is a semantic mismatch that will confuse clients.*

**Does the SSE connection set idleTimeout: 0?**
Not at the route level. The `streamSSE` call in import.ts does not set `idleTimeout: 0`. The entry point (index.ts:47) sets `idleTimeout: 0 as never` on the `Bun.serve()` call, which applies server-wide. This is acceptable for the entry point but means the SSE route itself doesn't enforce it. If the app were served differently (e.g., tests via `app.request()`), the timeout wouldn't apply. For route-level tests this is fine because `app.request()` doesn't involve real sockets.
*Reasoning: Searched import.ts for idleTimeout: not present. index.ts:47 sets it on Bun.serve(). The architecture pattern doc says "Socket idle timeout must be disabled (idleTimeout: 0) for long-lived SSE connections." The server-wide setting covers it for production. In tests, app.request() doesn't use real sockets so it's moot. This is correct but worth noting: if additional entry points are created, they must also set idleTimeout: 0.*

**Does the operations registry cover all routes with correct descriptions?**
Yes. All 18 routes have corresponding OperationDefinition entries. Operation IDs match the API surface design. Descriptions match. Methods and paths in invocation objects are correct. Hierarchy root is "shelf" for all. Features are correctly categorized (game, axis, score, import, help, config).
*Reasoning: Counted operations: 7 game ops (games.ts:187-258), 4 axis ops (axes.ts:101-140), 2 score ops (scores.ts:61-81), 1 import op (import.ts:79-88), 2 help ops (help.ts:36-55), 2 config ops (config.ts:77-94). Total: 18. All match the API surface design table.*

**Is DI wiring in the app factory correct?**
Mostly correct with one issue. The app factory at app.ts creates services with correct dependency chains: storageService -> axisService, storageService+fitnessService+bggClient -> gameService. Route factories receive the correct deps. However, there is duplication between app.ts and index.ts: both create the full service graph. The entry point (index.ts) creates all services manually, then passes them into createApp as pre-built deps. The app factory then skips its own creation because deps are already provided. This works but means the app factory's service creation code (lines 38-54) is dead code when called from the entry point. It only runs when createApp is called with partial or no deps, which happens in tests via test-app.ts.
*Reasoning: index.ts creates storageService, fitnessService, bggClient, axisService, gameService, then passes all of them to createApp. app.ts:34 checks `!deps?.storageService || !deps?.gameService` to decide whether to resolve config. When index.ts provides everything, config is never resolved. The test helper (test-app.ts) also creates everything externally and passes it in, so the fallback path in createApp is actually unused in both production and tests. This isn't broken, but the createApp factory's own service creation logic is effectively dead code.*

**Does config resolution handle env vars and file-based config correctly?**
Yes. config.ts:15-21 reads SHELF_JUDGE_DATA_DIR, SHELF_JUDGE_CONFIG, and SHELF_JUDGE_SOCKET from process.env with sensible defaults (~/.shelf-judge/data, ~/.shelf-judge/config.json, /tmp/shelf-judge.sock). The resolveSocketPath function at config.ts:23 also checks the app config (file-based) for socketPath, falling back to the env config. Tests avoid env coupling by injecting deps directly.
*Reasoning: config.ts uses process.env with ?? defaults for all three config values. This follows the architecture pattern's "Config resolution lives in the app factory module" principle. Tests pass paths directly via the DI seam, so they never touch process.env.*

**Do all tests from the plan exist?**
All test files exist. Most planned test cases are covered. One gap: the plan says `POST /api/games with bggId: returns 201 with game + BGG data` should return `bggImported: true` in the response body, but neither the test nor the implementation verifies this field (it doesn't exist). The test checks bggData instead, which is a reasonable proxy. Another gap: the plan's step 4.6 calls for a separate help.test.ts test verifying "Operations have correct method, path, and description" which is partially tested (method and path checked at help.test.ts:40-43, descriptions checked at help.test.ts:38-39).
*Reasoning: Cross-referenced every test case bullet in the plan (steps 4.2-4.6) against the test files. Plan step 4.2 lists 10 tests; games.test.ts has 7 test cases covering the critical paths. Missing from game tests: no explicit test for "POST /api/games with bggId returns bggImported" (response shape issue). Plan step 4.3 lists 5 tests; axes.test.ts has 6 tests (covers all plus extra). Plan step 4.4 lists 3 tests; scores.test.ts has 4 tests (covers all). Plan step 4.5 lists 3 tests; import.test.ts has 2 tests (covers 503 and SSE streaming). Plan step 4.6 lists 3 tests; help.test.ts has 6 tests (covers all).*

**Cannot run tests: no shell access**
Unable to verify test pass/fail status. The review posture does not include shell execution tools. Tests must be run separately by a worker with shell access.
*Reasoning: Thorne is read-only. No Bash tool available. The commission asks to run `bun test` and report results, which I cannot fulfill.*

**Does the score list sort correctly (fitness descending, unscored at end)?**
Two separate sort paths exist: gameService.listGames (game-service.ts:161-168) sorts all games with scored first descending and unscored at end. The scores route (scores.ts:36-52) splits into scored/unscored arrays but does NOT explicitly sort the scored array by fitness descending. It relies on the order returned by gameService.listGames, which is already sorted. This works, but the route depends on an implicit contract from the service layer. If the service sort changes, the scores endpoint silently breaks. The test at scores.test.ts:145-190 verifies the sort order through the full stack, which is good.
*Reasoning: game-service.ts:161-168 sorts with a comparator that puts scored games first (descending by score) and unscored at end. scores.ts:36 filters games where score !== null and maps them in the order received from listGames(). Since listGames() returns sorted results, scored array preserves that order. But the route never calls .sort() itself, so it's relying on listGames() sort behavior.*

**Does the SSE progress callback in import.ts properly await writes?**
Defect. The progress callback at import.ts:51-58 calls `stream.writeSSE()` without `await`. This is a fire-and-forget write on an async stream. The gameService.importBggCollection callback is synchronous (the callback signature at game-service.ts:53 takes a sync function), so the progress events may not be flushed before the complete event. The complete event at import.ts:61 is properly awaited.
*Reasoning: import.ts:50: The callback `(event) => { stream.writeSSE(...) }` is a sync callback that calls an async function without awaiting it. The onProgress parameter in GameService is typed as `(event: ImportProgressEvent) => void`, not `Promise<void>`. This means progress writes race with each other and with the final complete write. In practice, with Hono's streaming, writes may be buffered and ordered correctly, but this is not guaranteed by the API contract. The correct fix is either to make the callback async and await the write, or to make the service's onProgress accept an async callback.*

**Does bggNotConfiguredResponse() use Hono's context correctly?**
Inconsistency, not a defect. `bggNotConfiguredResponse()` at games.ts:22-28 uses `Response.json()` (the Web API) instead of `c.json()` (Hono context). Every other error response in the file uses `c.json()`. This works because Hono route handlers can return a raw Response, but it bypasses any Hono middleware that might modify responses (headers, CORS, etc.). The import.ts:24-29 uses `c.json()` for the same 503 response, making the inconsistency clear.
*Reasoning: games.ts:22-28 creates a Response.json() without access to the Hono context `c`. This is because bggNotConfiguredResponse() is a standalone function called from multiple routes. It would need to accept `c` as a parameter to use c.json(). Currently functional but inconsistent with the rest of the codebase.*

**Does the import route accept input as specified in the API surface design?**
Mismatch. The API surface design (line 47) specifies `POST /api/import/bgg?username={bggUsername}` with username as a query parameter. The implementation (import.ts:39) reads username from the JSON request body: `{ username: string }`. The plan (step 4.5, line 567) explicitly notes "The request body contains { username: string } (see Technical Decision #7)" so this was a deliberate change from the API surface design. However, the API surface design document was not updated to reflect this decision. The operations registry (import.ts:84) also shows the path as `/api/import/bgg` without query parameters, consistent with the body-based approach but inconsistent with the API surface design.
*Reasoning: API surface design line 47: `POST /api/import/bgg?username={bggUsername}`. Implementation: ImportBodySchema validates `{ username: z.string() }` from the request body. The plan references "Technical Decision #7" as the reason for the change. The design document was never updated.*
