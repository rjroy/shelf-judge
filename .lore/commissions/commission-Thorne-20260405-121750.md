---
title: "Commission: Phase 7: Integration Verification"
date: 2026-04-05
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Final integration verification for the MVP plan at `.lore/plans/mvp.md`.\n\nRead the full plan (Phase 7), the spec at `.lore/specs/mvp.md` (all 24 requirements), and all design documents.\n\nThis is the final quality gate. Verify:\n\n**7.1 Automated integration tests** — Check that integration tests exist in `packages/daemon/tests/integration/` covering:\n- Add game, rate on 2+ axes, verify score end-to-end\n- Create custom axis, rate games, observe score changes\n- Import BGG collection (mocked), verify games created with BGG data\n- Delete axis, verify cascade across all games\n- Refresh BGG data, verify overrides preserved\n- Daemon without BGG token: manual operations work\n- CLI --json output matches API response shapes\n\n**7.2 Requirement traceability** — Walk through ALL 24 requirements (REQ-MVP-1 through REQ-MVP-24) and verify each has:\n- Implementation code\n- Test coverage\n- No spec deviations\n\nRun `bun test` across the entire project. Report:\n1. Test results (pass/fail counts)\n2. Any requirements not fully satisfied\n3. Any spec deviations\n4. Any code quality issues that slipped through phase reviews\n\nThis review determines whether the MVP is ready for the manual verification walkthrough."
dependencies:
  - commission-Dalton-20260405-121733
  - commission-Dalton-20260405-121737
linked_artifacts:
  - .lore/specs/mvp.md

  - .lore/plans/mvp.md
  - .lore/plans/mvp.md
activity_timeline:
  - timestamp: 2026-04-05T19:17:50.735Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-05T19:22:19.172Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-05T22:49:56.092Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-05T22:49:56.094Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-05T22:49:56.109Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-05T22:50:23.914Z
    event: progress_report
    reason: "Starting final integration verification. Read spec (24 requirements) and plan. Found 22 test files across daemon, CLI, and shared packages. No dedicated integration test directory exists — first finding. Now reading implementation source and running tests."
  - timestamp: 2026-04-05T22:53:19.988Z
    event: progress_report
    reason: "Source code review complete via 4 parallel agents. Key findings emerging: (1) No integration tests exist, (2) Weight validation allows 0 but spec says \"0-100\" which is ambiguous, (3) Fitness service looks correct. Now checking specific concerns and running test suite."
  - timestamp: 2026-04-05T22:54:55.860Z
    event: progress_report
    reason: "Deep code review complete. Major findings: (1) Phase 7.1 integration tests don't exist, (2) refreshAllBggData has no route/CLI/UI entry point (REQ-MVP-19 partial), (3) REQ-MVP-18 staleness indicator not surfaced. Now checking for the refresh-all route gap more closely and looking at the game detail page, then running tests."
  - timestamp: 2026-04-05T22:57:15.466Z
    event: progress_report
    reason: "Cannot execute `bun test` directly - no shell/bash execution tool is available in my toolset. Analyzing test files statically and reporting findings from the file system."
  - timestamp: 2026-04-05T22:57:53.946Z
    event: progress_report
    reason: "Starting requirement traceability pass (7.2). Walking through all 24 requirements against implementation and test coverage. Cannot run tests (read-only posture), but can verify code and test existence statically. Major findings so far: (1) No integration tests, (2) No refresh-all route, (3) No staleness indicator for REQ-MVP-18."
  - timestamp: 2026-04-05T22:58:49.424Z
    event: progress_report
    reason: "Requirement traceability complete. Compiling final review with all findings in priority order. Ready to submit."
  - timestamp: 2026-04-05T23:00:02.920Z
    event: result_submitted
    reason: "# Final Integration Verification: Shelf Judge MVP\n\n## Test Execution\n\n**Cannot run tests.** Thorne is read-only (no Bash tool). All findings below are from static analysis. Running `bun test` from the project root is a prerequisite before declaring MVP ready. The test command is configured in root `package.json:17`.\n\n---\n\n## CRITICAL FINDINGS (block MVP readiness)\n\n### F1. Phase 7.1 integration tests do not exist\n\n**Where:** `packages/daemon/tests/integration/` — directory does not exist.\n\n**Impact:** The plan's Phase 7.1 specifies 7 integration test scenarios (add+rate+score end-to-end, custom axis with score changes, mocked BGG import, axis deletion cascade, refresh with overrides preserved, daemon without BGG token, CLI --json shape matching). None of these tests were written. The existing tests are all unit-level (service tests with mocked deps) and route-level (Hono `app.request()` with mock services). No test exercises the full stack from HTTP request through real services to storage.\n\n**What to do:** Write the 7 integration tests in `packages/daemon/tests/integration/`. They should use a real Hono app with real services (mocked only at external boundaries: filesystem via mock-file-ops, BGG API via mock fetch). These validate that the wiring between layers is correct, not just that each layer works in isolation.\n\n### F2. REQ-MVP-19 \"refresh all games\" has no route, CLI command, or UI entry point\n\n**Where:** `game-service.ts:249` implements `refreshAllBggData()`, but no route calls it.\n\n**Impact:** REQ-MVP-19 says \"Users can manually trigger a BGG data refresh for a single game or for all games in the collection.\" Single-game refresh exists (`POST /api/games/:id/refresh`, CLI `game refresh-bgg`, web UI \"Refresh BGG Data\" button). But \"refresh all\" is implemented only in the service layer. It is unreachable from any interface. Users cannot refresh all games.\n\n**What to do:** Add `POST /api/games/refresh` route (or `POST /api/refresh/all`), wire it in CLI as `game refresh-all-bgg`, and add a button in the web UI (probably on the collection page or as a global action).\n\n---\n\n## HIGH FINDINGS (spec deviations)\n\n### F3. REQ-MVP-18 staleness indicator not surfaced\n\n**Where:** `bgg-xml-parser.ts:101` stores `fetchedAt` timestamp. No code compares it to current time.\n\n**Impact:** REQ-MVP-18 says \"Cached data older than 7 days is considered stale.\" The `fetchedAt` field exists on `BggGameData`, but nothing checks whether data is older than 7 days. No staleness indicator is shown in any interface. Users have no way to know which games have stale BGG data. The spec also says \"stale data is acceptable; missing data is not,\" which reduces severity, but the intent is that users should be aware of staleness.\n\n**What to do:** Add a computed `isStale` field or check in the score/game responses. Surface it in the web UI (e.g., \"BGG data last updated 12 days ago\" with a refresh prompt) and CLI output.\n\n### F4. Score list views show scores without breakdown (REQ-MVP-5 strict reading)\n\n**Where:** `packages/web/app/page.tsx:112` (collection page shows ScoreBadge only), `packages/cli/src/commands/score.ts:44-55` (score list shows table without breakdown).\n\n**Impact:** REQ-MVP-5: \"Every displayed fitness score must include its full breakdown.\" Both the web collection page and CLI `score list` display fitness scores as bare numbers without the breakdown. The breakdown is available on drill-down (game detail page, `score get` command). The `--json` output of `score list` does include the breakdown.\n\n**Interpretation:** The spec's intent (from success criteria: \"CLI `shelf-judge score list` shows all games ranked by fitness; `shelf-judge score get <id>` shows the full breakdown for any game\") suggests this is the intended design: summary list + detail drill-down. This is a spec interpretation question. If the strict reading is enforced, the list views need inline expandable breakdowns.\n\n**What to do:** Clarify with the user whether list views satisfy REQ-MVP-5 by linking to detail, or whether inline breakdown is required.\n\n---\n\n## MEDIUM FINDINGS (quality/consistency issues)\n\n### F5. Web UI axis weight input restricts to 1-100, backend allows 0-100\n\n**Where:** `packages/web/app/axes/page.tsx:198` (edit form `min={1}`), `packages/web/app/axes/page.tsx:320` (create form `min={1}`). Backend: `packages/shared/src/validation.ts:6` allows `min(0)`.\n\n**Impact:** REQ-MVP-1 says \"weight (0-100)\". REQ-MVP-16 explicitly contemplates all-zero weights. The web UI prevents setting weight to 0, which means the REQ-MVP-16 scenario is only reachable via CLI or direct API. Minor inconsistency, but the UI should match the spec.\n\n**What to do:** Change `min={1}` to `min={0}` in both the create and edit weight inputs, or add a note that weight 0 effectively disables the axis.\n\n### F6. Fitness breakdown contribution is raw `rating * weight`, not normalized\n\n**Where:** `packages/daemon/src/services/fitness-service.ts:65` computes `rawContribution = rating * axis.weight`.\n\n**Impact:** For the Wingspan example (r:8, w:40), the contribution shows 320.0 while the score is 7.9. A user looking at the breakdown has to mentally divide by sum(weight) to relate contributions to the score. The spec says \"contribution to the total\" which is ambiguous. A normalized contribution (`(rating * weight) / sum(weight)` = 3.2) would be more meaningful alongside a score of 7.9.\n\n**What to do:** This is a design question, not a defect. Consider whether \"contribution\" should represent the raw weighted value or the contribution to the final score number. If raw, add a note in the UI explaining the relationship. If normalized, change the calculation and update tests.\n\n### F7. BGG client has no fetch timeout\n\n**Where:** `packages/daemon/src/services/bgg-client.ts:85` (fetch calls with no AbortController).\n\n**Impact:** If BGG hangs, the daemon blocks indefinitely on that request. This affects import (blocking the SSE stream), refresh, and search. REQ-MVP-13 says \"BGG API failures (timeouts, 5xx errors, malformed responses) must not crash the daemon,\" but without an AbortController, a hanging connection is never classified as a timeout.\n\n**What to do:** Add `AbortController` with a 30-second timeout to all fetch calls in the BGG client.\n\n---\n\n## REQUIREMENT TRACEABILITY (REQ-MVP-1 through REQ-MVP-24)\n\n| REQ | Status | Evidence |\n|-----|--------|----------|\n| **REQ-MVP-1** | PASS | `axis-service.ts` CRUD, `CreateAxisSchema` validates weight 0-100, tests cover boundaries |\n| **REQ-MVP-2** | PASS | `game-service.ts:181-192` validates 1-10 integer, tests cover 0/11/1.5/negative |\n| **REQ-MVP-3** | PASS | `storage-service.ts:25-45` creates Community Rating + Complexity on first run |\n| **REQ-MVP-4** | PASS | `fitness-service.ts:77-87` implements `sum(rating*weight)/sum(weight)` correctly |\n| **REQ-MVP-5** | PARTIAL | Breakdown returned in API; web detail page and CLI `score get` display it. List views show score only (see F4) |\n| **REQ-MVP-6** | PASS | `fitness-service.ts:30` uses `Math.round(value * 10) / 10`, tests verify boundary rounding |\n| **REQ-MVP-7** | PASS | BGG search (`games/search?q=`), add by bggId, manual add by name all implemented |\n| **REQ-MVP-8** | PASS | `game-service.ts:207-218` removes game, tested |\n| **REQ-MVP-9** | PASS | `game-service.ts:97-103` checks bggId duplicates, manual games exempt |\n| **REQ-MVP-10** | PASS | `game-service.ts:286-378` imports collection, skips duplicates, reports summary |\n| **REQ-MVP-11** | PASS | `bggClient` is optional dep. Routes check `isBggConfigured()` and return 503. Local features work without BGG. |\n| **REQ-MVP-12** | PASS | `games.ts:21-29` returns actionable 503 message with registration URL and config command |\n| **REQ-MVP-13** | PASS | Import reports `{ imported, skipped, errors }`. BGG client retries 429/5xx/202. No daemon crash on failure. **Exception:** no fetch timeout (F7) |\n| **REQ-MVP-14** | PASS | `fitness-service.ts:84` returns null when ratedCount=0. UI shows \"not yet rated\" |\n| **REQ-MVP-15** | PASS | `axis-service.ts:85-91` cascades delete, returns count. Web UI shows count in confirmation |\n| **REQ-MVP-16** | PASS | `fitness-service.ts:85` returns null when weightSum=0. No division by zero |\n| **REQ-MVP-17** | PASS | `fitness-service.ts:49-57` handles overrides with source=\"override\" and bggOriginal |\n| **REQ-MVP-18** | PARTIAL | `fetchedAt` stored but no staleness check or indicator (see F3) |\n| **REQ-MVP-19** | PARTIAL | Single-game refresh works. Refresh-all has no route/CLI/UI entry point (see F2) |\n| **REQ-MVP-20** | PASS | JSON files, `storage-service.ts` reads on load, writes on mutation |\n| **REQ-MVP-21** | PASS | `storage-service.ts:61-65` writes temp + rename. Tested. |\n| **REQ-MVP-22** | PASS | Daemon (Hono/Unix socket), Web (Next.js), CLI all implemented as clients of daemon |\n| **REQ-MVP-23** | PASS | All CLI commands accept `--json`, tested in each command test file |\n| **REQ-MVP-24** | PASS | Both CLI `score get` and web game detail page display full breakdown |\n\n**Summary:** 20/24 PASS, 3 PARTIAL (F2, F3, F4), 1 PASS-with-caveat (REQ-MVP-13 re: timeout).\n\n---\n\n## STATIC ANALYSIS NOTES\n\n- **Test count:** ~265 tests across 22 files (agent estimate from describe/test analysis)\n- **Dependency injection:** All services use DI, no module mocking. Clean pattern.\n- **BGG XML parsing:** Tested against real captured XML fixtures, not synthetic data.\n- **Atomic writes:** Verified temp-file-then-rename pattern in storage-service.\n- **Rate limiting:** 429 backoff, 202 retry, 5xx retry all implemented and tested.\n- **Code quality:** Clean separation of concerns. Route -> Service -> Storage layering is consistent. No obvious security issues (input validation via Zod at boundaries).\n\n---\n\n## VERDICT\n\n**Not yet ready for manual verification walkthrough.** Three blockers:\n\n1. **F1 (Critical):** Integration tests don't exist. The plan's Phase 7.1 is unfulfilled.\n2. **F2 (High):** REQ-MVP-19 refresh-all is unreachable. Spec requirement not satisfied.\n3. **Tests not run.** Static analysis suggests they should pass, but \"tests pass\" must be verified by execution.\n\nAfter F1 and F2 are addressed and `bun test` confirms all green, the remaining findings (F3-F7) are medium/low and could be resolved during or after the manual walkthrough."
  - timestamp: 2026-04-05T23:00:11.896Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Requirement traceability complete. Compiling final review with all findings in priority order. Ready to submit."
projectName: shelf-judge
---
# Final Integration Verification: Shelf Judge MVP

## Test Execution

**Cannot run tests.** Thorne is read-only (no Bash tool). All findings below are from static analysis. Running `bun test` from the project root is a prerequisite before declaring MVP ready. The test command is configured in root `package.json:17`.

---

## CRITICAL FINDINGS (block MVP readiness)

### F1. Phase 7.1 integration tests do not exist

**Where:** `packages/daemon/tests/integration/` — directory does not exist.

**Impact:** The plan's Phase 7.1 specifies 7 integration test scenarios (add+rate+score end-to-end, custom axis with score changes, mocked BGG import, axis deletion cascade, refresh with overrides preserved, daemon without BGG token, CLI --json shape matching). None of these tests were written. The existing tests are all unit-level (service tests with mocked deps) and route-level (Hono `app.request()` with mock services). No test exercises the full stack from HTTP request through real services to storage.

**What to do:** Write the 7 integration tests in `packages/daemon/tests/integration/`. They should use a real Hono app with real services (mocked only at external boundaries: filesystem via mock-file-ops, BGG API via mock fetch). These validate that the wiring between layers is correct, not just that each layer works in isolation.

### F2. REQ-MVP-19 "refresh all games" has no route, CLI command, or UI entry point

**Where:** `game-service.ts:249` implements `refreshAllBggData()`, but no route calls it.

**Impact:** REQ-MVP-19 says "Users can manually trigger a BGG data refresh for a single game or for all games in the collection." Single-game refresh exists (`POST /api/games/:id/refresh`, CLI `game refresh-bgg`, web UI "Refresh BGG Data" button). But "refresh all" is implemented only in the service layer. It is unreachable from any interface. Users cannot refresh all games.

**What to do:** Add `POST /api/games/refresh` route (or `POST /api/refresh/all`), wire it in CLI as `game refresh-all-bgg`, and add a button in the web UI (probably on the collection page or as a global action).

---

## HIGH FINDINGS (spec deviations)

### F3. REQ-MVP-18 staleness indicator not surfaced

**Where:** `bgg-xml-parser.ts:101` stores `fetchedAt` timestamp. No code compares it to current time.

**Impact:** REQ-MVP-18 says "Cached data older than 7 days is considered stale." The `fetchedAt` field exists on `BggGameData`, but nothing checks whether data is older than 7 days. No staleness indicator is shown in any interface. Users have no way to know which games have stale BGG data. The spec also says "stale data is acceptable; missing data is not," which reduces severity, but the intent is that users should be aware of staleness.

**What to do:** Add a computed `isStale` field or check in the score/game responses. Surface it in the web UI (e.g., "BGG data last updated 12 days ago" with a refresh prompt) and CLI output.

### F4. Score list views show scores without breakdown (REQ-MVP-5 strict reading)

**Where:** `packages/web/app/page.tsx:112` (collection page shows ScoreBadge only), `packages/cli/src/commands/score.ts:44-55` (score list shows table without breakdown).

**Impact:** REQ-MVP-5: "Every displayed fitness score must include its full breakdown." Both the web collection page and CLI `score list` display fitness scores as bare numbers without the breakdown. The breakdown is available on drill-down (game detail page, `score get` command). The `--json` output of `score list` does include the breakdown.

**Interpretation:** The spec's intent (from success criteria: "CLI `shelf-judge score list` shows all games ranked by fitness; `shelf-judge score get <id>` shows the full breakdown for any game") suggests this is the intended design: summary list + detail drill-down. This is a spec interpretation question. If the strict reading is enforced, the list views need inline expandable breakdowns.

**What to do:** Clarify with the user whether list views satisfy REQ-MVP-5 by linking to detail, or whether inline breakdown is required.

---

## MEDIUM FINDINGS (quality/consistency issues)

### F5. Web UI axis weight input restricts to 1-100, backend allows 0-100

**Where:** `packages/web/app/axes/page.tsx:198` (edit form `min={1}`), `packages/web/app/axes/page.tsx:320` (create form `min={1}`). Backend: `packages/shared/src/validation.ts:6` allows `min(0)`.

**Impact:** REQ-MVP-1 says "weight (0-100)". REQ-MVP-16 explicitly contemplates all-zero weights. The web UI prevents setting weight to 0, which means the REQ-MVP-16 scenario is only reachable via CLI or direct API. Minor inconsistency, but the UI should match the spec.

**What to do:** Change `min={1}` to `min={0}` in both the create and edit weight inputs, or add a note that weight 0 effectively disables the axis.

### F6. Fitness breakdown contribution is raw `rating * weight`, not normalized

**Where:** `packages/daemon/src/services/fitness-service.ts:65` computes `rawContribution = rating * axis.weight`.

**Impact:** For the Wingspan example (r:8, w:40), the contribution shows 320.0 while the score is 7.9. A user looking at the breakdown has to mentally divide by sum(weight) to relate contributions to the score. The spec says "contribution to the total" which is ambiguous. A normalized contribution (`(rating * weight) / sum(weight)` = 3.2) would be more meaningful alongside a score of 7.9.

**What to do:** This is a design question, not a defect. Consider whether "contribution" should represent the raw weighted value or the contribution to the final score number. If raw, add a note in the UI explaining the relationship. If normalized, change the calculation and update tests.

### F7. BGG client has no fetch timeout

**Where:** `packages/daemon/src/services/bgg-client.ts:85` (fetch calls with no AbortController).

**Impact:** If BGG hangs, the daemon blocks indefinitely on that request. This affects import (blocking the SSE stream), refresh, and search. REQ-MVP-13 says "BGG API failures (timeouts, 5xx errors, malformed responses) must not crash the daemon," but without an AbortController, a hanging connection is never classified as a timeout.

**What to do:** Add `AbortController` with a 30-second timeout to all fetch calls in the BGG client.

---

## REQUIREMENT TRACEABILITY (REQ-MVP-1 through REQ-MVP-24)

| REQ | Status | Evidence |
|-----|--------|----------|
| **REQ-MVP-1** | PASS | `axis-service.ts` CRUD, `CreateAxisSchema` validates weight 0-100, tests cover boundaries |
| **REQ-MVP-2** | PASS | `game-service.ts:181-192` validates 1-10 integer, tests cover 0/11/1.5/negative |
| **REQ-MVP-3** | PASS | `storage-service.ts:25-45` creates Community Rating + Complexity on first run |
| **REQ-MVP-4** | PASS | `fitness-service.ts:77-87` implements `sum(rating*weight)/sum(weight)` correctly |
| **REQ-MVP-5** | PARTIAL | Breakdown returned in API; web detail page and CLI `score get` display it. List views show score only (see F4) |
| **REQ-MVP-6** | PASS | `fitness-service.ts:30` uses `Math.round(value * 10) / 10`, tests verify boundary rounding |
| **REQ-MVP-7** | PASS | BGG search (`games/search?q=`), add by bggId, manual add by name all implemented |
| **REQ-MVP-8** | PASS | `game-service.ts:207-218` removes game, tested |
| **REQ-MVP-9** | PASS | `game-service.ts:97-103` checks bggId duplicates, manual games exempt |
| **REQ-MVP-10** | PASS | `game-service.ts:286-378` imports collection, skips duplicates, reports summary |
| **REQ-MVP-11** | PASS | `bggClient` is optional dep. Routes check `isBggConfigured()` and return 503. Local features work without BGG. |
| **REQ-MVP-12** | PASS | `games.ts:21-29` returns actionable 503 message with registration URL and config command |
| **REQ-MVP-13** | PASS | Import reports `{ imported, skipped, errors }`. BGG client retries 429/5xx/202. No daemon crash on failure. **Exception:** no fetch timeout (F7) |
| **REQ-MVP-14** | PASS | `fitness-service.ts:84` returns null when ratedCount=0. UI shows "not yet rated" |
| **REQ-MVP-15** | PASS | `axis-service.ts:85-91` cascades delete, returns count. Web UI shows count in confirmation |
| **REQ-MVP-16** | PASS | `fitness-service.ts:85` returns null when weightSum=0. No division by zero |
| **REQ-MVP-17** | PASS | `fitness-service.ts:49-57` handles overrides with source="override" and bggOriginal |
| **REQ-MVP-18** | PARTIAL | `fetchedAt` stored but no staleness check or indicator (see F3) |
| **REQ-MVP-19** | PARTIAL | Single-game refresh works. Refresh-all has no route/CLI/UI entry point (see F2) |
| **REQ-MVP-20** | PASS | JSON files, `storage-service.ts` reads on load, writes on mutation |
| **REQ-MVP-21** | PASS | `storage-service.ts:61-65` writes temp + rename. Tested. |
| **REQ-MVP-22** | PASS | Daemon (Hono/Unix socket), Web (Next.js), CLI all implemented as clients of daemon |
| **REQ-MVP-23** | PASS | All CLI commands accept `--json`, tested in each command test file |
| **REQ-MVP-24** | PASS | Both CLI `score get` and web game detail page display full breakdown |

**Summary:** 20/24 PASS, 3 PARTIAL (F2, F3, F4), 1 PASS-with-caveat (REQ-MVP-13 re: timeout).

---

## STATIC ANALYSIS NOTES

- **Test count:** ~265 tests across 22 files (agent estimate from describe/test analysis)
- **Dependency injection:** All services use DI, no module mocking. Clean pattern.
- **BGG XML parsing:** Tested against real captured XML fixtures, not synthetic data.
- **Atomic writes:** Verified temp-file-then-rename pattern in storage-service.
- **Rate limiting:** 429 backoff, 202 retry, 5xx retry all implemented and tested.
- **Code quality:** Clean separation of concerns. Route -> Service -> Storage layering is consistent. No obvious security issues (input validation via Zod at boundaries).

---

## VERDICT

**Not yet ready for manual verification walkthrough.** Three blockers:

1. **F1 (Critical):** Integration tests don't exist. The plan's Phase 7.1 is unfulfilled.
2. **F2 (High):** REQ-MVP-19 refresh-all is unreachable. Spec requirement not satisfied.
3. **Tests not run.** Static analysis suggests they should pass, but "tests pass" must be verified by execution.

After F1 and F2 are addressed and `bun test` confirms all green, the remaining findings (F3-F7) are medium/low and could be resolved during or after the manual walkthrough.

## Decisions

**Does the integration test directory (packages/daemon/tests/integration/) exist as specified in Phase 7.1?**
No integration test directory exists. The plan calls for `packages/daemon/tests/integration/` but only `tests/routes/` and `tests/services/` directories are present.
*Reasoning: Glob for `packages/daemon/tests/integration/**/*.test.ts` returned zero results. The plan's Phase 7 specifies 7 specific integration test scenarios that should live in this directory. These tests do not exist.*

**What is the complete status of daemon service file implementations against spec requirements?**
All daemon service files have been thoroughly reviewed. Key findings documented in comprehensive analysis below.
*Reasoning: Full read of all 9 files complete; cross-referencing against spec requirements from previous analysis.*

**Should the test analysis report focus on what is tested versus what gaps exist?**
Focus on both coverage patterns and gaps. The goal is to provide a complete picture of test strengths and what remains untested or under-tested.
*Reasoning: The user asked for a complete analysis of all tests to understand what is tested and what is missing. A balanced view covering both will be most useful for identifying where additional tests are needed.*

**Does REQ-MVP-19's "refresh all games" have an API route?**
The `refreshAllBggData()` method exists in game-service.ts but has no HTTP route. Only single-game refresh has a route (`POST /api/games/:id/refresh`). The "refresh all" capability is implemented in the service layer but unreachable via any API endpoint, web UI, or CLI.
*Reasoning: Grep for "refresh.*all" in routes directory returned no matches. The service layer defines `refreshAllBggData()` at game-service.ts:249 and the interface at line 51, but no route calls it. REQ-MVP-19 requires "refresh for a single game or for all games in the collection."*

**Is REQ-MVP-18 (stale data indicator for BGG cache older than 7 days) implemented?**
REQ-MVP-18 is partially implemented. The `fetchedAt` timestamp is stored on `BggGameData` (types.ts:26) and set during parsing (bgg-xml-parser.ts:101), but no code checks whether cached data is older than 7 days. No staleness indicator is communicated to the user.
*Reasoning: Grep for "stale", "7 days", and "604800" (7 days in seconds) returned no matches. The `fetchedAt` field is stored but never compared against the current time. REQ-MVP-18 says "Cached data older than 7 days is considered stale" but the spec also says "stale data is acceptable; missing data is not." The field exists for future use, but the staleness concept is not surfaced anywhere.*

**Does the web UI collection list view comply with REQ-MVP-5 (every displayed fitness score must include its full breakdown)?**
The collection list view at packages/web/app/page.tsx displays fitness scores via ScoreBadge (line 112) without showing the breakdown. The score is a link to the game detail page where the breakdown is shown. REQ-MVP-5 says "Every displayed fitness score must include its full breakdown." Strictly read, this is a violation. However, the spec's intent (from Principle 2: "One number, honestly derived") is that the derivation must always be accessible. The list links directly to the detail page where the breakdown is displayed. This is a spec interpretation question, not a clear defect.
*Reasoning: Collection page (page.tsx:112) shows `ScoreBadge` for each game. ScoreBadge likely shows the score number. The full breakdown is only visible on the game detail page (/games/[id]). REQ-MVP-5's "must include its full breakdown" could mean inline display or could mean accessible from the same context. The CLI's `score list` command also shows scores without inline breakdowns (score.ts:44-55), only `score get` shows the breakdown. Both interfaces treat the list as a summary view with breakdowns accessible on drill-down.*

**Can the test suite be run as part of this review?**
Cannot run tests. As Thorne (read-only posture), I have no write or execute tools. The test suite must be run manually as part of the manual verification walkthrough. All findings in this review are based on static analysis of the code.
*Reasoning: My posture explicitly states "You are read-only. You inspect code and artifacts; you never modify them. You cannot write files. Do not attempt to use Write, Edit, or Bash tools." The `bun test` command requires shell execution, which is outside my capabilities.*

**Does the web UI axis edit form's weight min=1 contradict the spec's 0-100 range?**
Minor UI inconsistency. The axes page create form (line 320) and edit form (line 198) both use min={1}, preventing weight 0 from the UI. The backend Zod schema allows min(0). REQ-MVP-1 says "0-100" and REQ-MVP-16 explicitly contemplates all-zero weights. Users cannot set weight to 0 from the web UI, only via CLI or direct API call.
*Reasoning: Spec says "0-100" for weight range. REQ-MVP-16 says "When all axis weights sum to zero (e.g., the user sets every weight to zero)." The HTML input min=1 prevents this from the web UI. The backend allows it. This means the web UI is more restrictive than the spec allows.*

**Does the fitness breakdown "contribution" field represent what the spec intends?**
The contribution field stores `rating * weight` (raw), not the normalized contribution to the score. For the Wingspan example, "Wife will play it" (r:8, w:40) would show contribution=320.0, but the score is 7.9. The raw contribution is not intuitive for understanding "how much did this axis contribute to my 7.9 score." A normalized contribution (`(rating * weight) / sum(weight)` = 3.2) would be more readable. This is a design choice, not a defect, but worth noting for usability.
*Reasoning: fitness-service.ts:65 computes `rawContribution = rating * axis.weight`. REQ-MVP-5 says "contribution to the total." The total is computed as `sum(rating * weight) / sum(weight)`. The raw contribution of 320 for a score of 7.9 requires the user to understand they need to divide by sum of weights to relate it to the score. The web UI shows this as `.toFixed(2)` which would display "320.00" for a score of 7.9.*
