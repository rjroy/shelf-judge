---
title: "Commission: Tournament Phase 4 Review"
date: 2026-04-06
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the tournament API routes (Phase 4 from `.lore/plans/tournament-ranking.md`).\n\nCheck:\n1. All 11 endpoints implemented with correct methods, paths, request/response shapes per the plan\n2. Operations registry entries for all endpoints\n3. Zod validation on request bodies\n4. Error handling: 400 for validation, 404 for not found, correct error messages\n5. Wiring: tournamentService in AppDeps, construction order in index.ts (tournament before game), onGameDeleted callback\n6. next-pair returns full Game objects + tournament stats (needs gameService access)\n7. Route tests cover happy paths and error cases\n8. No new TypeScript or lint errors\n\nFiles: `packages/daemon/src/routes/tournament.ts`, `packages/daemon/src/app.ts`, `packages/daemon/src/index.ts`, route test files"
dependencies:
  - commission-Dalton-20260406-153859
linked_artifacts:
  - packages/daemon/src/routes/tournament.ts

  - packages/daemon/src/app.ts
  - packages/daemon/src/index.ts
  - packages/daemon/tests/routes/tournament.test.ts
  - packages/daemon/tests/helpers/test-app.ts
  - packages/daemon/src/app.ts
  - packages/daemon/src/index.ts
  - packages/daemon/tests/routes/tournament.test.ts
  - packages/daemon/tests/helpers/test-app.ts
activity_timeline:
  - timestamp: 2026-04-06T22:39:07.145Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T22:39:07.146Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-06T23:13:55.100Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-06T23:13:55.102Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-06T23:13:55.120Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-06T23:14:01.212Z
    event: progress_report
    reason: "Starting review. Reading the plan, dependency commission, and target files."
  - timestamp: 2026-04-06T23:14:26.268Z
    event: progress_report
    reason: "Context gathered. Reviewing: endpoints vs plan, operations registry, Zod validation, error handling, wiring, next-pair response shape, test coverage. Recording findings."
  - timestamp: 2026-04-06T23:16:46.469Z
    event: result_submitted
    reason: "## Tournament API Routes Review (Phase 4)\n\n**Scope**: `packages/daemon/src/routes/tournament.ts`, `packages/daemon/src/app.ts`, `packages/daemon/src/index.ts`, `packages/daemon/tests/routes/tournament.test.ts`, `packages/daemon/tests/helpers/test-app.ts`\n\n### Findings (priority order)\n\n**1. DEFECT: PUT /settings has no runtime validation** — `tournament.ts:207`\n\nThe route casts the parsed JSON body with `body as Partial<TournamentSettings>`, a TypeScript type assertion that provides zero runtime safety. Any JSON passes through to `updateSettings` unchecked. Send `{ \"kFactorThreshold\": \"banana\", \"garbage\": true }` and the service receives it without complaint.\n\nEvery other mutation endpoint in this file uses Zod (`StartSessionSchema`, `SubmitComparisonSchema`). The plan's review checklist explicitly requires \"Zod validation on request bodies.\"\n\n**Fix**: Add a `TournamentSettingsUpdateSchema` using `z.object({ kFactorThreshold: z.number().optional(), normalizationHalfWidth: z.number().optional(), provisionalThreshold: z.number().optional() }).strict()` and safeParse the body before passing it to the service.\n\n---\n\n**2. DEFECT: submit-comparison and start-session default to 400 for internal errors** — `tournament.ts:40-42`, `tournament.ts:148-153`\n\nBoth handlers catch all service errors and return 400. If `saveTournament` fails due to an I/O error, the client sees a 400 (client error) instead of 500 (server error). The canonical pattern in `games.ts:81-86` defaults to 500 for unexpected errors, reserving specific status codes for known conditions.\n\n**Fix**: Return 400 only for known validation-class errors (message contains \"fewer than\", \"winnerId must equal\", etc.). Default unrecognized errors to 500, matching the game route pattern.\n\n---\n\n**3. GAP: No test for the `{ done: true }` response from next-pair** — `tournament.test.ts`\n\nThe next-pair endpoint has three response shapes: pair with games/stats, `{ done: true }` when exhausted, and 404 for missing session. Tests cover shapes 1 and 3 but not 2. This is the response the UI will receive at the end of every session.\n\n**Fix**: Add a test that starts a 4-game session (minimum size), submits all 6 possible pair comparisons, then verifies the next request returns `{ done: true }`.\n\n---\n\n**4. LOW: TOCTOU race in next-pair between getNextPair and getGame** — `tournament.ts:87-104`\n\nIf a game is deleted after `getNextPair` returns its ID but before `getGame` resolves, the route throws \"Game not found\" and returns 404, which is misleading (the session exists, the game doesn't). Single-user local-only tool makes this extremely unlikely. Not worth fixing now, but worth noting.\n\n---\n\n### Verified (no issues)\n\n- **All 11 endpoints** implemented with correct methods, paths, operation IDs per the plan's specification table.\n- **Operations registry** has all 11 entries with correct hierarchy, idempotency flags, and parameter definitions.\n- **Wiring** is correct: `tournamentService` in `AppDeps`, constructed before `gameService` in `index.ts`, `onGameDeleted` callback wired. Test helper mirrors production construction order.\n- **next-pair** returns full `Game` objects (via `gameService.getGame`) plus `TournamentGameStatsDisplay` (via `tournamentService.getGameStats`), loaded in parallel.\n- **Request/response shapes** match the plan specification for all 11 endpoints, including the 201 status for start-session.\n- **Zod schemas** are well-structured: `SubmitComparisonSchema` includes a refinement ensuring `winnerId` equals one of the pair IDs; `StartSessionSchema` defaults null filters.\n- **22 tests** cover happy paths and error cases across all endpoints. Coverage is adequate aside from finding #3.\n- **No new TypeScript or lint errors** per the commission result (341 tests pass, typecheck clean, lint clean)."
  - timestamp: 2026-04-06T23:16:51.090Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Context gathered. Reviewing: endpoints vs plan, operations registry, Zod validation, error handling, wiring, next-pair response shape, test coverage. Recording findings."
projectName: shelf-judge
---
## Tournament API Routes Review (Phase 4)

**Scope**: `packages/daemon/src/routes/tournament.ts`, `packages/daemon/src/app.ts`, `packages/daemon/src/index.ts`, `packages/daemon/tests/routes/tournament.test.ts`, `packages/daemon/tests/helpers/test-app.ts`

### Findings (priority order)

**1. DEFECT: PUT /settings has no runtime validation** — `tournament.ts:207`

The route casts the parsed JSON body with `body as Partial<TournamentSettings>`, a TypeScript type assertion that provides zero runtime safety. Any JSON passes through to `updateSettings` unchecked. Send `{ "kFactorThreshold": "banana", "garbage": true }` and the service receives it without complaint.

Every other mutation endpoint in this file uses Zod (`StartSessionSchema`, `SubmitComparisonSchema`). The plan's review checklist explicitly requires "Zod validation on request bodies."

**Fix**: Add a `TournamentSettingsUpdateSchema` using `z.object({ kFactorThreshold: z.number().optional(), normalizationHalfWidth: z.number().optional(), provisionalThreshold: z.number().optional() }).strict()` and safeParse the body before passing it to the service.

---

**2. DEFECT: submit-comparison and start-session default to 400 for internal errors** — `tournament.ts:40-42`, `tournament.ts:148-153`

Both handlers catch all service errors and return 400. If `saveTournament` fails due to an I/O error, the client sees a 400 (client error) instead of 500 (server error). The canonical pattern in `games.ts:81-86` defaults to 500 for unexpected errors, reserving specific status codes for known conditions.

**Fix**: Return 400 only for known validation-class errors (message contains "fewer than", "winnerId must equal", etc.). Default unrecognized errors to 500, matching the game route pattern.

---

**3. GAP: No test for the `{ done: true }` response from next-pair** — `tournament.test.ts`

The next-pair endpoint has three response shapes: pair with games/stats, `{ done: true }` when exhausted, and 404 for missing session. Tests cover shapes 1 and 3 but not 2. This is the response the UI will receive at the end of every session.

**Fix**: Add a test that starts a 4-game session (minimum size), submits all 6 possible pair comparisons, then verifies the next request returns `{ done: true }`.

---

**4. LOW: TOCTOU race in next-pair between getNextPair and getGame** — `tournament.ts:87-104`

If a game is deleted after `getNextPair` returns its ID but before `getGame` resolves, the route throws "Game not found" and returns 404, which is misleading (the session exists, the game doesn't). Single-user local-only tool makes this extremely unlikely. Not worth fixing now, but worth noting.

---

### Verified (no issues)

- **All 11 endpoints** implemented with correct methods, paths, operation IDs per the plan's specification table.
- **Operations registry** has all 11 entries with correct hierarchy, idempotency flags, and parameter definitions.
- **Wiring** is correct: `tournamentService` in `AppDeps`, constructed before `gameService` in `index.ts`, `onGameDeleted` callback wired. Test helper mirrors production construction order.
- **next-pair** returns full `Game` objects (via `gameService.getGame`) plus `TournamentGameStatsDisplay` (via `tournamentService.getGameStats`), loaded in parallel.
- **Request/response shapes** match the plan specification for all 11 endpoints, including the 201 status for start-session.
- **Zod schemas** are well-structured: `SubmitComparisonSchema` includes a refinement ensuring `winnerId` equals one of the pair IDs; `StartSessionSchema` defaults null filters.
- **22 tests** cover happy paths and error cases across all endpoints. Coverage is adequate aside from finding #3.
- **No new TypeScript or lint errors** per the commission result (341 tests pass, typecheck clean, lint clean).

## Decisions

**Are all 11 endpoints implemented with correct methods, paths, and operation IDs per the plan?**
All 11 endpoints present and correct. Methods, paths, and operation IDs match the plan's endpoint specification table exactly.
*Reasoning: Compared each row of the plan's endpoint table against the route definitions in tournament.ts and the operations array. All 11 operation IDs, HTTP methods, and paths align. The operations registry includes correct hierarchy, idempotency flags, and parameter definitions for path params.*

**Does PUT /api/tournament/settings validate the request body with Zod?**
DEFECT: No runtime validation. Line 207 uses a type assertion (`body as Partial<TournamentSettings>`) instead of a Zod schema. Arbitrary JSON passes through to the service layer unchecked.
*Reasoning: Every other mutation endpoint in this file (start-session, submit-comparison) uses Zod safeParse. The existing game routes (games.ts:125-128) also validate PUT bodies with Zod. The plan's review checklist explicitly requires "Zod validation on request bodies." A type assertion provides zero runtime safety: `{ kFactorThreshold: "banana", garbage: true }` would reach `updateSettings` without error. A `TournamentSettingsUpdateSchema` using `z.object({ kFactorThreshold: z.number().optional(), ... }).strict()` would close this gap.*

**Does submit-comparison use the correct default HTTP status for unexpected errors?**
DEFECT: submit-comparison (line 148-153) and start-session (line 39-42) default to 400 for all non-"not found" errors. If the service throws due to a storage write failure or other internal issue, the client receives 400 (client error) instead of 500 (server error).
*Reasoning: Compared against the canonical pattern in games.ts. The POST /games route (line 81-86) defaults to 500 for unexpected errors, only returning 409 for the specific "already exists" case. The tournament routes invert this: they return 400 as the default catch-all. This means an I/O failure during `saveTournament` would present as a validation error. The fix is to check for known 400-class messages (like "winnerId must equal" or "fewer than 4 games") and default the rest to 500.*

**Does the test suite cover the done:true branch of next-pair?**
GAP: No test covers the `{ done: true }` response from GET /sessions/:id/next. The test suite only covers the happy path (pair returned) and the 404 case.
*Reasoning: The next-pair endpoint has three distinct response shapes: (1) pair with full game objects and stats, (2) `{ done: true }` when no more pairs, (3) 404 when session doesn't exist. Tests cover (1) and (3) but not (2). To test (2), a test would need to exhaust all pairs in a small session (4 games = 6 possible pairs = 6 comparisons) or end the session and then request next.*

**Is the wiring correct: tournamentService in AppDeps, construction order, onGameDeleted callback?**
Wiring is correct. tournamentService is in AppDeps (app.ts:21), constructed before gameService (index.ts:32-33), and the onGameDeleted callback is wired (index.ts:37). Test helper mirrors production construction order (test-app.ts:39-44).
*Reasoning: The plan specifies: "construct tournamentService before gameService. The onGameDeleted callback must exist before it can be passed to gameServiceDeps." index.ts follows this exactly. The callback `(gameId) => tournamentService.onGameDeleted(gameId)` is passed at gameService construction. game-service.ts:233 calls `deps.onGameDeleted?.(id)` after splicing the game from collection. The test helper (test-app.ts) replicates the same construction order and callback wiring.*

**Does next-pair return full Game objects plus tournament stats as specified?**
Correct. Lines 92-104 resolve both games via gameService.getGame and both stats via tournamentService.getGameStats in parallel, then returns `{ gameA: gameA.game, gameB: gameB.game, gameAStats, gameBStats }`. The `.game` accessor extracts the raw Game object from GameWithScore.
*Reasoning: The plan says: "Returns full Game objects (with imageUrl for thumbnails) plus tournament stats so the UI can display both scores. The next-pair endpoint must load from both tournament and collection data." The implementation does exactly this. The route needs gameService access, which is provided via TournamentRoutesDeps.*

**Are there edge cases in next-pair where getGame could throw after getNextPair returns a valid pair?**
LOW-SEVERITY: TOCTOU race between getNextPair returning game IDs and getGame resolving them. If a game is deleted between these calls, getGame throws "Game not found" and the route returns 404, which is misleading (the session exists, the game doesn't).
*Reasoning: This is a single-user, local-only tool, so concurrent deletion during a request is extremely unlikely. The tournament service's getNextPair already filters deleted games from active sessions. This is not worth fixing now, but worth noting for completeness. If it ever becomes a concern, the fix is to catch the specific "Game not found" error in the next-pair handler and retry getNextPair.*

**Does the request/response shape for each endpoint match the plan specification?**
All shapes match. POST /sessions returns 201 with { session }. GET /sessions/active returns { session } or 404. POST /sessions/:id/end returns { session }. GET /sessions returns TournamentSession[]. GET /sessions/:id/next returns { gameA, gameB, gameAStats, gameBStats } or { done: true }. POST /sessions/:id/compare returns { comparison, updatedStats: { gameA, gameB } }. GET /games/:id/stats returns TournamentGameStatsDisplay. GET /stats returns Record. POST /recalculate returns { gamesUpdated }. GET/PUT /settings returns TournamentSettings.
*Reasoning: Checked each route handler's return shape against the plan's Request/Response Shapes section. All match. The one subtlety is that start-session correctly catches body parse errors and defaults to {} (line 23-28), allowing the filters to default to null via the Zod schema's `.default(null)`.*
