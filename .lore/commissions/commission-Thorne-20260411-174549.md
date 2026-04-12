---
title: "Commission: Review: LLM narrative implementation"
date: 2026-04-12
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the LLM narrative implementation against the spec requirements REQ-PROFILE-18 through REQ-PROFILE-28 and REQ-PROFILE-34 in `.lore/specs/collection-profiling.md`. Plan is at `.lore/plans/llm-narrative.md`.\n\nReview focus:\n1. Agent SDK integration: is `query()` used correctly? Are MCP tools registered with proper Zod schemas?\n2. System prompt: does it enforce REQ-PROFILE-23 (narrate only, never determine scores)?\n3. Structured output: does the schema match `ProfileNarration` type?\n4. Cache state: fresh/stale/empty transitions correct? Timestamp comparison logic sound?\n5. Client/daemon divergence: both web `lib/api.ts` AND CLI `client.ts` updated with matching shapes?\n6. Error handling: 503 when SDK unavailable, 502 on SDK error, consistent across route/service/client\n7. REQ-PROFILE-27: no auto-generation (POST-only trigger, no generation on GET)\n8. REQ-PROFILE-28: auth via env var only, daemon doesn't manage keys\n9. Budget control: `maxBudgetUsd` set, `maxTurns` capped\n10. MCP tools are read-only (no write access to game/axis/fitness data)\n\nReport all findings."
dependencies:
  - commission-Dalton-20260411-172109
linked_artifacts:
  - packages/daemon/src/services/narration-service.ts

  - packages/daemon/src/services/profile-service.ts
  - packages/daemon/src/routes/profile.ts
  - packages/daemon/tests/narration-service.test.ts
  - packages/daemon/tests/routes/profile-narrate.test.ts
  - packages/web/components/profile/narration-section.tsx
  - packages/web/components/profile/narration-actions.tsx
  - packages/web/lib/api.ts
  - packages/cli/src/commands/profile.ts
  - packages/cli/src/client.ts
  - packages/daemon/src/services/profile-service.ts
  - packages/daemon/src/routes/profile.ts
  - packages/daemon/tests/narration-service.test.ts
  - packages/daemon/tests/routes/profile-narrate.test.ts
  - packages/web/components/profile/narration-section.tsx
  - packages/web/components/profile/narration-actions.tsx
  - packages/web/lib/api.ts
  - packages/cli/src/commands/profile.ts
  - packages/cli/src/client.ts
activity_timeline:
  - timestamp: 2026-04-12T00:45:49.061Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T00:45:49.063Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T00:45:49.085Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T00:45:56.058Z
    event: progress_report
    reason: "Starting review. Reading spec, plan, and implementation commission artifact."
  - timestamp: 2026-04-12T00:46:19.501Z
    event: progress_report
    reason: "Read core implementation files (narration-service.ts, profile-service.ts, profile route). Now reading client files, tests, web components, and types."
  - timestamp: 2026-04-12T00:46:43.102Z
    event: progress_report
    reason: "All implementation files read. Now reading CLI index.ts for subcommand registration and checking the web page.tsx for narration rendering. Then beginning finding analysis."
  - timestamp: 2026-04-12T00:50:18.104Z
    event: progress_report
    reason: "All findings recorded. Compiling final review against all 10 review focus areas plus req traceability. Preparing submit_result."
  - timestamp: 2026-04-12T00:51:10.801Z
    event: result_submitted
    reason: "## LLM Narrative Implementation Review\n\nReviewed against REQ-PROFILE-18 through REQ-PROFILE-28 and REQ-PROFILE-34, plus the plan at `.lore/plans/llm-narrative.md`.\n\n---\n\n### Findings (Priority Order)\n\n**1. generateNarration() has zero test coverage**\nSeverity: High. File: `packages/daemon/tests/narration-service.test.ts`\n\nThe test file contains 3 tests, all for `isAvailable()`. The `generateNarration()` function — the core of the feature — is completely untested. The plan specifies five test cases at the `query()` boundary: happy path with structured output, auth failure, budget exhaustion, malformed output, and MCP tool schema verification. None exist.\n\nThis function contains non-trivial logic: dynamic imports, async generator iteration, structured output parsing with fallback to JSON.parse, manual field validation, and MCP tool construction. All of this executes untested.\n\nAction: Write the five test cases from the plan. Mock `query()` at the import boundary (dynamic import makes this straightforward to inject).\n\n---\n\n**2. Missing staleness transition route test**\nSeverity: High. File: `packages/daemon/tests/routes/profile-narrate.test.ts`\n\nThe plan (Phase 3 Verification) specifies: \"call POST to generate narration, then mutate collection (e.g., add a rating), then call GET; narration appears with state 'stale'.\" This test does not exist.\n\nThe \"narration persists across GET requests\" test (line 76) only verifies that narration survives a GET. It never mutates the collection between POST and GET, so it never exercises the stale transition through the full stack (profile recomputation advances `computedAt` past `narrationComputedAt`).\n\n`deriveNarrationState` has unit coverage for the stale case, but the integration — profile recomputation preserving narration while advancing the timestamp — is only tested at the unit level, not through the route.\n\nAction: Add the staleness transition test as specified in the plan.\n\n---\n\n**3. Web api.ts `generateNarration()` is dead code**\nSeverity: Medium. Files: `packages/web/lib/api.ts:135-137`, `packages/web/components/profile/narration-actions.tsx:20`\n\n`api.ts` exports `generateNarration()` using `daemonJson()`, but `NarrationActions` (the only narration trigger in the web UI) calls `fetch(\"/api/daemon/profile/narrate\")` directly. The api.ts function is unreachable.\n\nThis happened because NarrationActions is a client component (needs `useState`, `useRouter`) and can't use server-side `daemonJson()`. The direct `fetch()` is correct for client components. But the api.ts function creates the illusion of coverage that doesn't exist.\n\nAction: Either remove the dead `generateNarration()` from api.ts, or add a comment explaining it exists for future server action use.\n\n---\n\n**4. Fresh state shows Regenerate button (plan deviation)**\nSeverity: Low. Files: `packages/web/components/profile/narration-section.tsx:35`, `packages/web/components/profile/narration-actions.tsx:39`\n\nPlan Phase 4 says fresh state has \"No generate button (narration is current).\" The implementation renders \"Regenerate\" for both fresh and stale. REQ-PROFILE-27 doesn't prescribe button visibility — only that generation is user-initiated. Showing the button for fresh is arguably more useful (lets user regenerate after reading the narration and wanting a different take). But it deviates from the plan.\n\nAction: Decide whether to suppress the button in fresh state or accept the deviation and update the plan.\n\n---\n\n**5. get_collection_games tool omits outlier filter**\nSeverity: Low. File: `packages/daemon/src/services/narration-service.ts:113-114`\n\nPlan Technical Decision 2 mentions `{ outlier: true }` as an example filter. The implementation supports `mechanic` and `category` but not `outlier`. The agent can still retrieve all games and identify outliers from the profile data via `get_profile_detail({ section: \"outliers\" })`, so this is a convenience gap, not a capability gap.\n\nAction: Consider adding the filter if agent behavior testing shows it would reduce token consumption.\n\n---\n\n**6. Structured output validated by type assertion, not Zod**\nSeverity: Low. File: `packages/daemon/src/services/narration-service.ts:226, 245-252`\n\n`message.structured_output as ProfileNarration` is a type assertion. The manual validation at lines 245-252 checks top-level types but not array element types or string content. The SDK's `outputFormat` should enforce the JSON schema, making this defense-in-depth. But the project uses Zod elsewhere, and defining a `ProfileNarrationSchema` would be more consistent and catch edge cases the SDK might miss.\n\nAction: Consider adding a Zod schema for parse-time validation, matching the project's pattern in shared types.\n\n---\n\n### Requirement Traceability\n\n| Requirement | Status | Evidence |\n|---|---|---|\n| REQ-PROFILE-18 (Agent SDK integration) | **Satisfied** | `narration-service.ts` uses `query()` from `@anthropic-ai/claude-agent-sdk` via dynamic import |\n| REQ-PROFILE-19 (Structured outputs) | **Satisfied** | JSON schema with 5 named sections passed via `outputFormat: { type: \"json_schema\" }` |\n| REQ-PROFILE-20 (In-process MCP tools) | **Satisfied** | Two tools: `get_collection_games`, `get_profile_detail`. Read-only. Registered via `createSdkMcpServer()` |\n| REQ-PROFILE-21 (Budget control) | **Satisfied** | `maxBudgetUsd: 0.05`, `maxTurns: 10` at narration-service.ts:209-210 |\n| REQ-PROFILE-22 (Interpretation layer) | **Satisfied** | System prompt directs interpretation. Schema captures surprises, tensions, blindSpots, curveInsights |\n| REQ-PROFILE-23 (Never determines scores) | **Satisfied** | System prompt constraint + no write MCP tools + narration type has no score fields |\n| REQ-PROFILE-26 (Three-state cache) | **Satisfied** | `deriveNarrationState()` with 6 unit tests. Profile recomputation preserves narration |\n| REQ-PROFILE-27 (No auto-generation) | **Satisfied** | POST-only trigger. GET never calls generateNarration. Route test verifies (line 96-117) |\n| REQ-PROFILE-28 (Auth via env var) | **Satisfied** | `isAvailable()` checks `ANTHROPIC_API_KEY`. Daemon never stores keys. 503 when missing |\n| REQ-PROFILE-34 (CLI profile narrate) | **Satisfied** | Registered as \"profile narrate\" subcommand. Handles success, 503 fallback, errors. Tested |\n\n### Architecture Assessment\n\nThe implementation follows project conventions: factory functions with dependency injection, service/route separation, shared types. The dynamic import pattern for the Agent SDK is a good call for startup performance. Cache state derivation is clean and testable. Client/daemon alignment is correct (both CLI and web call the same endpoint with compatible handling).\n\nThe two high-priority findings (missing generateNarration tests and missing staleness route test) are the items to address before considering this complete. The implementation logic appears correct from code reading, but \"appears correct\" is what tests are for."
  - timestamp: 2026-04-12T00:51:21.833Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All findings recorded. Compiling final review against all 10 review focus areas plus req traceability. Preparing submit_result."
projectName: shelf-judge
---
## LLM Narrative Implementation Review

Reviewed against REQ-PROFILE-18 through REQ-PROFILE-28 and REQ-PROFILE-34, plus the plan at `.lore/plans/llm-narrative.md`.

---

### Findings (Priority Order)

**1. generateNarration() has zero test coverage**
Severity: High. File: `packages/daemon/tests/narration-service.test.ts`

The test file contains 3 tests, all for `isAvailable()`. The `generateNarration()` function — the core of the feature — is completely untested. The plan specifies five test cases at the `query()` boundary: happy path with structured output, auth failure, budget exhaustion, malformed output, and MCP tool schema verification. None exist.

This function contains non-trivial logic: dynamic imports, async generator iteration, structured output parsing with fallback to JSON.parse, manual field validation, and MCP tool construction. All of this executes untested.

Action: Write the five test cases from the plan. Mock `query()` at the import boundary (dynamic import makes this straightforward to inject).

---

**2. Missing staleness transition route test**
Severity: High. File: `packages/daemon/tests/routes/profile-narrate.test.ts`

The plan (Phase 3 Verification) specifies: "call POST to generate narration, then mutate collection (e.g., add a rating), then call GET; narration appears with state 'stale'." This test does not exist.

The "narration persists across GET requests" test (line 76) only verifies that narration survives a GET. It never mutates the collection between POST and GET, so it never exercises the stale transition through the full stack (profile recomputation advances `computedAt` past `narrationComputedAt`).

`deriveNarrationState` has unit coverage for the stale case, but the integration — profile recomputation preserving narration while advancing the timestamp — is only tested at the unit level, not through the route.

Action: Add the staleness transition test as specified in the plan.

---

**3. Web api.ts `generateNarration()` is dead code**
Severity: Medium. Files: `packages/web/lib/api.ts:135-137`, `packages/web/components/profile/narration-actions.tsx:20`

`api.ts` exports `generateNarration()` using `daemonJson()`, but `NarrationActions` (the only narration trigger in the web UI) calls `fetch("/api/daemon/profile/narrate")` directly. The api.ts function is unreachable.

This happened because NarrationActions is a client component (needs `useState`, `useRouter`) and can't use server-side `daemonJson()`. The direct `fetch()` is correct for client components. But the api.ts function creates the illusion of coverage that doesn't exist.

Action: Either remove the dead `generateNarration()` from api.ts, or add a comment explaining it exists for future server action use.

---

**4. Fresh state shows Regenerate button (plan deviation)**
Severity: Low. Files: `packages/web/components/profile/narration-section.tsx:35`, `packages/web/components/profile/narration-actions.tsx:39`

Plan Phase 4 says fresh state has "No generate button (narration is current)." The implementation renders "Regenerate" for both fresh and stale. REQ-PROFILE-27 doesn't prescribe button visibility — only that generation is user-initiated. Showing the button for fresh is arguably more useful (lets user regenerate after reading the narration and wanting a different take). But it deviates from the plan.

Action: Decide whether to suppress the button in fresh state or accept the deviation and update the plan.

---

**5. get_collection_games tool omits outlier filter**
Severity: Low. File: `packages/daemon/src/services/narration-service.ts:113-114`

Plan Technical Decision 2 mentions `{ outlier: true }` as an example filter. The implementation supports `mechanic` and `category` but not `outlier`. The agent can still retrieve all games and identify outliers from the profile data via `get_profile_detail({ section: "outliers" })`, so this is a convenience gap, not a capability gap.

Action: Consider adding the filter if agent behavior testing shows it would reduce token consumption.

---

**6. Structured output validated by type assertion, not Zod**
Severity: Low. File: `packages/daemon/src/services/narration-service.ts:226, 245-252`

`message.structured_output as ProfileNarration` is a type assertion. The manual validation at lines 245-252 checks top-level types but not array element types or string content. The SDK's `outputFormat` should enforce the JSON schema, making this defense-in-depth. But the project uses Zod elsewhere, and defining a `ProfileNarrationSchema` would be more consistent and catch edge cases the SDK might miss.

Action: Consider adding a Zod schema for parse-time validation, matching the project's pattern in shared types.

---

### Requirement Traceability

| Requirement | Status | Evidence |
|---|---|---|
| REQ-PROFILE-18 (Agent SDK integration) | **Satisfied** | `narration-service.ts` uses `query()` from `@anthropic-ai/claude-agent-sdk` via dynamic import |
| REQ-PROFILE-19 (Structured outputs) | **Satisfied** | JSON schema with 5 named sections passed via `outputFormat: { type: "json_schema" }` |
| REQ-PROFILE-20 (In-process MCP tools) | **Satisfied** | Two tools: `get_collection_games`, `get_profile_detail`. Read-only. Registered via `createSdkMcpServer()` |
| REQ-PROFILE-21 (Budget control) | **Satisfied** | `maxBudgetUsd: 0.05`, `maxTurns: 10` at narration-service.ts:209-210 |
| REQ-PROFILE-22 (Interpretation layer) | **Satisfied** | System prompt directs interpretation. Schema captures surprises, tensions, blindSpots, curveInsights |
| REQ-PROFILE-23 (Never determines scores) | **Satisfied** | System prompt constraint + no write MCP tools + narration type has no score fields |
| REQ-PROFILE-26 (Three-state cache) | **Satisfied** | `deriveNarrationState()` with 6 unit tests. Profile recomputation preserves narration |
| REQ-PROFILE-27 (No auto-generation) | **Satisfied** | POST-only trigger. GET never calls generateNarration. Route test verifies (line 96-117) |
| REQ-PROFILE-28 (Auth via env var) | **Satisfied** | `isAvailable()` checks `ANTHROPIC_API_KEY`. Daemon never stores keys. 503 when missing |
| REQ-PROFILE-34 (CLI profile narrate) | **Satisfied** | Registered as "profile narrate" subcommand. Handles success, 503 fallback, errors. Tested |

### Architecture Assessment

The implementation follows project conventions: factory functions with dependency injection, service/route separation, shared types. The dynamic import pattern for the Agent SDK is a good call for startup performance. Cache state derivation is clean and testable. Client/daemon alignment is correct (both CLI and web call the same endpoint with compatible handling).

The two high-priority findings (missing generateNarration tests and missing staleness route test) are the items to address before considering this complete. The implementation logic appears correct from code reading, but "appears correct" is what tests are for.

## Decisions

**Does narration-service.ts have adequate test coverage for generateNarration()?**
Finding: narration-service.test.ts only tests isAvailable() (3 tests). The generateNarration() function has zero test coverage. The plan specified five test cases: happy path with structured output, auth failure, budget exhaustion, malformed output, and MCP tool schema verification. None were implemented.
*Reasoning: File: packages/daemon/tests/narration-service.test.ts (lines 20-50). The plan (Phase 2 Verification) explicitly requires: "Unit tests for narration-service.ts with the Agent SDK mocked at the query() boundary. Test cases: Happy path, Auth failure, Budget exhaustion, Malformed output, Tool call verification." The actual test file contains only three tests, all for isAvailable(). The generateNarration() function contains non-trivial logic: dynamic imports, MCP tool construction, async generator iteration, structured output parsing, and field validation. All of this is untested. The Agent SDK's query() is designed to be mockable at the boundary, so dependency injection is not a barrier here.*

**Is the staleness transition tested end-to-end through the route?**
Finding: The staleness transition test specified in the plan is missing. No test verifies: POST narrate → mutate collection → GET profile → narrationState is "stale".
*Reasoning: File: packages/daemon/tests/routes/profile-narrate.test.ts. The plan (Phase 3 Verification) specifies: "Staleness: call POST to generate narration, then mutate collection (e.g., add a rating), then call GET (which triggers profile recomputation because collection is dirty); the recomputed profile advances computedAt past narrationComputedAt, so narration appears with state 'stale'." This test does not exist. The test "narration persists across GET requests" (line 76-94) only verifies fresh state persistence, not the stale transition. While deriveNarrationState has unit tests for the stale case (narration-cache-state.test.ts:33-37), the full flow through profile recomputation after mutation is never exercised. This is the most important cache state to test because it involves the interaction between profile recomputation and narration timestamp comparison.*

**Does the NarrationSection component match the plan's fresh-state specification?**
Finding: Plan deviation. The plan says "No generate button (narration is current)" for fresh state. The implementation renders a "Regenerate" button for both fresh and stale states.
*Reasoning: File: packages/web/components/profile/narration-section.tsx:35 always renders NarrationActions when narration exists. File: packages/web/components/profile/narration-actions.tsx:39 shows "Regenerate" for any non-empty state. Plan Phase 4 says fresh state has "No generate button (narration is current)." The spec (REQ-PROFILE-27) says "Narration regeneration is always user-initiated" but doesn't prescribe whether the button should be hidden when fresh. Showing it for fresh is arguably more user-friendly (lets user regenerate at will). This is a plan deviation, not a spec violation. The reader decides whether to align with the plan's intent.*

**Does the get_collection_games MCP tool support all filters specified in the plan?**
Finding: The get_collection_games tool supports mechanic and category filters but omits the outlier filter mentioned in the plan.
*Reasoning: File: packages/daemon/src/services/narration-service.ts:113-114. The Zod schema accepts optional `mechanic` and `category` string parameters. Plan Technical Decision 2 says: "Accepts optional filters (e.g., { mechanic: 'Worker Placement' }, { outlier: true })." While "e.g." indicates examples, the outlier filter would let the agent drill into outlier games specifically, which is relevant for REQ-PROFILE-22's "blind spot surfacing." Without it, the agent must retrieve all games and filter client-side. Not a spec violation (REQ-PROFILE-20 just says "can pull additional context"), but a capability gap that limits the agent's efficiency.*

**Is the structured output parsed safely from the Agent SDK response?**
Finding: The structured output is type-asserted (`as ProfileNarration`) without Zod validation. Manual field checking at lines 245-252 is shallow.
*Reasoning: File: packages/daemon/src/services/narration-service.ts:226. `result = message.structured_output as ProfileNarration` is a type assertion. Lines 245-252 check top-level field types (typeof summary === "string", Array.isArray for arrays), but don't validate array element types or string non-emptiness. The JSON schema at lines 13-44 is passed to the SDK's outputFormat, so the SDK should enforce the schema before returning. This is defense-in-depth, and the defense layer is thin. If the SDK fails to validate (or a future SDK version changes behavior), malformed data passes through. Since the project uses Zod elsewhere, validating with a Zod schema here would be more robust and consistent. Low severity because the SDK should enforce the schema.*

**Does the web client's generateNarration handle 503 errors consistently with the daemon route?**
Finding: The web api.ts generateNarration() uses daemonJson() which throws on non-ok responses. But NarrationActions calls fetch() directly, bypassing api.ts entirely.
*Reasoning: File: packages/web/lib/api.ts:135-137 defines `generateNarration()` using `daemonJson("/api/profile/narrate", { method: "POST" })`. But packages/web/components/profile/narration-actions.tsx:20 calls `fetch("/api/daemon/profile/narrate", { method: "POST" })` directly. The api.ts helper is unused for narration. This means: (1) the api.ts function is dead code for narration, and (2) the client component handles errors manually at the fetch level (which it does correctly at lines 21-29). The api.ts helper exists for server components, while the client component needs direct fetch for interactivity. Not a bug, but the api.ts generateNarration() function is unreachable from any code path. If a future server action needs it, it's there. But currently it's dead code.*

**REQ-PROFILE-23: Does the system prompt and architecture enforce that the LLM never determines scores?**
Satisfied. The system prompt explicitly says "You do NOT determine scores, recommend purchases, or prescribe actions." MCP tools are read-only. No write access to game, axis, or fitness data exists in the narration service's dependency set.
*Reasoning: File: packages/daemon/src/services/narration-service.ts:75: "You do NOT determine scores, recommend purchases, or prescribe actions." The narration service receives only gameService (read-only via listGames). MCP tools return data without mutations. The tools: [] option disables built-in tools. The narration result (ProfileNarration) is a text-only type with no score fields. The architecture enforces this at three levels: system prompt (soft), tool surface (hard, no write tools), and type system (hard, narration type has no score fields).*

**REQ-PROFILE-26: Are the three cache states (fresh/stale/empty) correctly implemented?**
Satisfied. deriveNarrationState() correctly maps: null narration → "empty", narrationComputedAt >= computedAt → "fresh", otherwise → "stale". Unit tested with 6 cases including edge cases (null timestamp with existing narration, undefined narration).
*Reasoning: File: packages/daemon/src/services/profile-service.ts:50-58. The function handles null, undefined, and string comparison correctly. ISO 8601 timestamps compare correctly as strings when in the same format (which they are, since both are produced by `new Date().toISOString()`). Tests at packages/daemon/tests/narration-cache-state.test.ts cover all six transitions. Profile recomputation at lines 128-144 preserves existing narration while advancing computedAt, which correctly triggers "stale" on next read.*

**REQ-PROFILE-27 and REQ-PROFILE-28: Are no-auto-generation and external auth correctly implemented?**
Both satisfied. GET /api/profile never calls generateNarration (tested). POST /api/profile/narrate is the only trigger. Auth is via ANTHROPIC_API_KEY env var; daemon never stores or manages keys; 503 returned when absent.
*Reasoning: REQ-PROFILE-27: File packages/daemon/src/routes/profile.ts:16-22 (GET handler) only calls profileService.getProfile(), which never invokes narrationService. Route test at profile-narrate.test.ts:96-117 explicitly verifies this with a spy on generateNarration. REQ-PROFILE-28: File packages/daemon/src/services/narration-service.ts:98-100 checks process.env.ANTHROPIC_API_KEY. Route profile.ts:26-27 returns 503 when !isAvailable(). CLI profile.ts:22-26 handles 503 gracefully. Web narration-actions.tsx:21-23 handles 503 with user-facing message.*

**REQ-PROFILE-34: Does the CLI support profile narrate subcommand?**
Satisfied. CLI registers "profile narrate" as a 2-word command, routes to profileNarrateCommand, handles success/503/error. On 503, falls back to algorithmic profile without narration.
*Reasoning: File: packages/cli/src/index.ts registers "profile narrate" with word count 2 (line 51) and routes it at line 310-312. File: packages/cli/src/commands/profile.ts:16-33 implements profileNarrateCommand. On success, returns full profile with narration. On 503, prints stderr warning and returns plain profile. On other errors, throws. Tested at packages/cli/tests/commands/profile.test.ts:85-128 with three cases: success, 503 fallback, and error propagation.*

**Is the error categorization (503 vs 502) correct and consistent across route, service, and clients?**
Correct and consistent. 503 for "SDK not configured" (missing API key). 502 for SDK runtime errors (auth failure, budget exhaustion, malformed output). Both clients handle both cases.
*Reasoning: Route (profile.ts:26-27): !narrationService || !isAvailable() → 503. Route (profile.ts:33): catch block → 502. CLI (profile.ts:22-26): status 503 → fallback. CLI (profile.ts:28-30): !ok → throw. Web (narration-actions.tsx:21-23): status 503 → user message. Web (narration-actions.tsx:25-28): !ok → error display. The distinction is meaningful: 503 is a configuration issue (user can fix by setting env var), 502 is a runtime failure (transient or key invalid). The route correctly separates the two paths.*
