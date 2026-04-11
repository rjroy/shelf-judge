---
title: "Implementation plan: llm-narrative"
date: 2026-04-11
status: approved
tags: [plan, llm, agent-sdk, profiling, narration, mcp]
modules: [shared, daemon, web, cli]
related:
  - .lore/specs/collection-profiling.md
  - .lore/issues/actually-implement-the-llm-narrative.md
  - .lore/research/claude-agent-sdk.md
  - .lore/plans/collection-profiling.md
  - .lore/designs/mvp-data-model.md
  - .lore/vision.md
---

# Plan: LLM Narrative for Collection Profile

## Spec Reference

**Spec**: `.lore/specs/collection-profiling.md` (LLM Narration section)
**Issue**: `.lore/issues/actually-implement-the-llm-narrative.md`
**Agent SDK Research**: `.lore/research/claude-agent-sdk.md`

Requirements addressed:

- REQ-PROFILE-18: Claude Agent SDK integration → Phase 2
- REQ-PROFILE-19: Structured outputs with named sections → Phase 2
- REQ-PROFILE-20: In-process MCP tools for collection data → Phase 2
- REQ-PROFILE-21: Budget control (`maxBudgetUsd`) → Phase 2
- REQ-PROFILE-22: Interpretation layer (surprises, tensions, blind spots) → Phase 2
- REQ-PROFILE-23: LLM narrates scores, never determines them → Phase 2 (system prompt constraint)
- REQ-PROFILE-26: Three-state narration cache (fresh, stale, empty) → Phase 1
- REQ-PROFILE-27: Regeneration is always user-initiated → Phase 3, Phase 4
- REQ-PROFILE-28: Agent SDK handles its own auth → Phase 2
- REQ-PROFILE-34: CLI `profile narrate` subcommand → Phase 4

## Codebase Context

### Architecture

Bun monorepo, four workspace packages. The daemon owns all data via services injected through factory functions. Web talks to daemon via Unix socket proxy (`/api/daemon/[...path]`). CLI talks to daemon over Unix socket (Bun `fetch` with `unix` option). Shared types and Zod schemas in `packages/shared/`.

### Existing Patterns

**Service layer**: Each domain has a service interface and `create*Service(deps)` factory. Services receive `StorageService` and peer services via dependency injection. No classes, just closures over deps. See `game-service.ts`, `profile-service.ts`, `prediction-service.ts`.

**Pure math modules**: `profile-engine.ts`, `curve-engine.ts`, `elo-engine.ts`, `feature-vector.ts` are pure-function modules with no service dependencies, no I/O.

**Routes**: Each route module exports `{ routes: Hono, operations: OperationDefinition[] }` via `createXRoutes(deps)`. Routes parse/validate input, call service, map errors to HTTP status codes.

**Storage**: `StorageService` handles JSON file persistence at `~/.shelf-judge/`. Atomic writes via temp file + rename. Each data domain has its own file: `collection.json`, `tournament.json`, `profile.json`, `prediction-settings.json`.

### Key Files That Will Change

**Shared types** (`packages/shared/src/types.ts`):

- `CollectionProfile` (line 325): add nullable `narration` field
- New types: `ProfileNarration`, `NarrationSection`, `NarrationCacheState`
- `ProfileData` (line 344): add nullable `narration` and `narrationComputedAt` fields for cache management

**Daemon services**:

- `packages/daemon/src/services/narration-service.ts` (new): Agent SDK integration, MCP tool registration, structured output parsing, budget control
- `packages/daemon/src/services/profile-service.ts` (modify): add `generateNarration()` method, narration cache state logic
- `packages/daemon/src/services/storage-service.ts` (modify): narration fields stored as part of `ProfileData`

**Daemon routes**:

- `packages/daemon/src/routes/profile.ts` (modify): add `POST /api/profile/narrate` endpoint

**Daemon entry**:

- `packages/daemon/src/index.ts` (modify): create and wire `NarrationService`
- `packages/daemon/src/app.ts` (modify): pass `narrationService` to profile routes

**Web**:

- `packages/web/lib/api.ts` (modify): add `generateNarration()` helper
- Profile Overview page (whatever component renders the profile): add narration display with cache state indicator and regenerate button

**CLI**:

- `packages/cli/src/commands/profile.ts` (modify): add `narrate` subcommand
- `packages/cli/src/client.ts` (modify): add `generateNarration()` helper
- `packages/cli/src/index.ts` (modify): register narrate subcommand

**Dependencies**:

- `packages/daemon/package.json`: add `@anthropic-ai/claude-agent-sdk` dependency

### Cross-Cutting Concerns

**Narration never affects scores.** The Agent SDK integration is strictly read-only. The agent receives the computed profile and collection data. It produces text. No service mutation, no score modification. The system prompt enforces this (REQ-PROFILE-23), and the architecture enforces it: the narration service has no write access to game, axis, or fitness data.

**Auth is external.** The Agent SDK authenticates via `ANTHROPIC_API_KEY` environment variable. The daemon does not store, proxy, or manage this key (REQ-PROFILE-28). If the key is missing, `query()` throws; the narration service catches and returns an unavailable state.

**Client/daemon divergence risk.** When the profile route shape changes (adding `narration` field, adding `POST /narrate` endpoint), both web `lib/api.ts` and CLI `client.ts` must be updated in the same change. This is the most common bug class in this project. The plan groups route + client helper changes in the same phase.

**Narration is stored as part of `ProfileData`, not separately.** The narration cache rides alongside the computed profile in `profile.json`. The `ProfileData` type gains `narration` (the content) and `narrationComputedAt` (timestamp for staleness). This keeps the storage model simple: one file, one load, one save. The narration is nullable, so profiles computed before LLM integration work identically.

## Technical Decisions

### 1. Agent SDK interface: `query()` vs. `ClaudeSDKClient`

**Decision**: Use `query()` (one-shot). No persistent sessions, no conversational follow-up.

**Rationale**: REQ-PROFILE-27 says narration regeneration is always user-initiated. There's no conversation to resume. Each narration request is independent: the agent receives the current profile, produces structured output, done. `query()` is simpler, requires no session management, and aligns with the spec's "one-shot narration only" resolution (Open Question 3). Hooks and interrupts are not needed for this use case.

### 2. MCP tool surface for the agent

**Decision**: Register two in-process MCP tools:

1. `get_collection_games` - Returns the full list of games with BGG data, ratings, and fitness scores. Accepts optional filters (e.g., `{ mechanic: "Worker Placement" }`, `{ outlier: true }`).
2. `get_profile_detail` - Returns a specific section of the algorithmic profile in full detail (e.g., `{ section: "divergence" }` or `{ section: "outliers" }`).

**Rationale**: REQ-PROFILE-20 says the agent can pull additional context beyond the initial structured profile. The initial prompt includes the full `CollectionProfile` as structured data. MCP tools let the agent drill into specific games or sections when it wants to trace a pattern back to individual games. Two focused tools are better than one mega-tool: the agent can request exactly what it needs without pulling the entire collection on every call.

### 3. Structured output schema

**Decision**: The agent returns a JSON object with four named sections per REQ-PROFILE-19:

```typescript
interface ProfileNarration {
  summary: string; // 2-4 paragraph overview of collection identity
  surprises: string[]; // Unexpected patterns (REQ-PROFILE-22)
  tensions: string[]; // Disagreements between stated and revealed preferences
  blindSpots: string[]; // Absent or underrepresented attribute categories
  curveInsights: string[]; // Utility curve observations (REQ-PROFILE-22: curve connection)
}
```

Each section is a string or string array, not free-form markdown. The web UI renders these into structured sections. The CLI returns them as part of the profile JSON.

The `curveInsights` field addresses REQ-PROFILE-22's "utility curve connection" requirement: relating configured curves to actual collection distributions. When no utility curves are configured, this array is empty. The system prompt (decision 7) directs the agent to compare curve shapes (sweet spot, lean, linear) against the actual rating distributions from the profile, naming specific games that fall outside configured sweet spots or veto thresholds.

**Rationale**: Structured outputs (`outputFormat` with JSON Schema) guarantee parseable responses. String arrays for surprises/tensions/blind spots/curve insights allow the UI to render each item distinctly (bullet points, cards, expandable sections). A single blob of markdown would require client-side parsing. The schema enforces that the agent always produces all five sections.

### 4. Narration cache as part of ProfileData

**Decision**: Store narration in `ProfileData` alongside the computed profile. Add `narration: ProfileNarration | null` and `narrationComputedAt: string | null` to `ProfileData`.

Cache state derivation (REQ-PROFILE-26):

- **Fresh**: `narration !== null && narrationComputedAt >= computedAt`
- **Stale**: `narration !== null && narrationComputedAt < computedAt`
- **Empty**: `narration === null`

**Rationale**: Separate storage adds complexity for no benefit. The narration is a property of a specific profile computation. Storing them together makes staleness detection trivial: compare two timestamps in the same record. The `CollectionProfile` response gains a `narration` field (nullable) and a `narrationState: "fresh" | "stale" | "empty"` field derived at read time.

### 5. Budget control default

**Decision**: Default `maxBudgetUsd` of `0.05` per narration generation. Not configurable via UI in the first version.

**Rationale**: A single profile narration for a 200-game collection should consume ~2-4K input tokens (profile JSON) plus tool calls for drilling into specifics. At current Claude pricing, $0.05 is generous for a one-shot narration. The budget prevents runaway consumption if the agent enters a tool-call loop. The value is a constant in the narration service, easily adjustable. If users need to tune it, a future `narration-settings.json` (following the `prediction-settings.json` pattern) can expose it.

### 6. Model selection

**Decision**: Use `sonnet` as the default model for narration. No model selection UI.

**Rationale**: Narration is interpretive text generation over structured data, a task where Sonnet excels without requiring Opus-tier reasoning. Sonnet is faster and cheaper, keeping the budget realistic. The model is a constant in the narration service. If a user wants Opus, they can set `CLAUDE_MODEL` environment variable (a pattern the Agent SDK supports).

### 7. System prompt design

**Decision**: The system prompt establishes three constraints:

1. You are interpreting a board game collection profile. You narrate what the data shows; you do not determine scores or recommend actions.
2. Every claim must trace to specific data in the profile or collection. Do not fabricate patterns.
3. Use the provided tools to drill into specific games when naming examples.

The system prompt also receives:

- The user's axis names, weights, and any utility curve configurations (shape, ideal value, veto thresholds)
- Explicit instruction to compare curve configurations against actual rating distributions when utility curves are present
- The profile's `utilityCurves` declarations as structured data, so the agent can relate configured preferences to observed patterns

**Rationale**: REQ-PROFILE-23 (LLM never determines scores) and REQ-PROFILE-38 (not a prescriptive curation coach) require explicit guardrails. The system prompt is the primary enforcement mechanism. Including axis names and curve configurations prevents the agent from inventing dimensions that don't exist. REQ-PROFILE-22's "utility curve connection" requirement needs explicit direction in the prompt, or the agent will overlook the curve data in favor of simpler patterns.

## Phases

### Phase 1: Types and Cache State (shared + daemon storage)

**Goal**: Define the narration types, extend `ProfileData` and `CollectionProfile`, and implement cache state derivation. No Agent SDK dependency yet. This phase creates the data contract that all later phases build on.

**Changes**:

1. **`packages/shared/src/types.ts`**: Add types:
   - `ProfileNarration`: `{ summary: string; surprises: string[]; tensions: string[]; blindSpots: string[]; curveInsights: string[] }`
   - `NarrationCacheState`: `"fresh" | "stale" | "empty"` (union type)
   - Extend `CollectionProfile` with `narration: ProfileNarration | null` and `narrationState: NarrationCacheState`
   - Extend `ProfileData` with `narration: ProfileNarration | null` and `narrationComputedAt: string | null`

2. **`packages/daemon/src/services/profile-service.ts`**: When returning a profile, derive `narrationState` from the stored narration timestamp vs. the profile `computedAt`:
   - `narration === null` → state is `"empty"`, set `narration: null`
   - `narrationComputedAt >= computedAt` → state is `"fresh"`, include narration
   - `narrationComputedAt < computedAt` → state is `"stale"`, include narration (stale but still displayable per REQ-PROFILE-27)

3. **`packages/daemon/src/services/storage-service.ts`**: No interface changes needed. `ProfileData` already goes through `loadProfile()`/`saveProfile()`. The new fields serialize naturally as JSON. Existing stored profiles without narration fields will deserialize with `narration: undefined`, which the profile service treats as `null` (empty state).

**Verification**: Unit tests on cache state derivation logic. Test all three transitions: empty (no narration), fresh (narration timestamp matches profile), stale (profile recomputed after narration). Typecheck clean. Existing profile tests still pass (no behavioral change for profiles without narration).

**Dependencies**: None. This is the foundation phase.

### Phase 2: Agent SDK Integration (narration service)

**Goal**: Build the narration service that calls the Agent SDK, registers MCP tools, and returns structured narration. This is the core LLM integration.

**Changes**:

1. **Verify TypeScript Agent SDK API** before writing any code. Install the latest `@anthropic-ai/claude-agent-sdk` (do not pin to an older version quoted in prior research — check the npm registry or run `bun add @anthropic-ai/claude-agent-sdk@latest`) and confirm: (a) `query()` accepts `outputFormat` for structured JSON output, (b) in-process MCP tool registration works with Zod schemas (the research doc shows the Python `@tool` decorator but the TypeScript equivalent is not documented), (c) `maxBudgetUsd` is a supported option. If any of these APIs have changed since the last research snapshot, adjust the implementation accordingly. This step prevents building against a stale API.

2. **`packages/daemon/package.json`**: Add `@anthropic-ai/claude-agent-sdk` (latest) to dependencies via `bun add @anthropic-ai/claude-agent-sdk@latest --filter daemon` (or equivalent from the daemon package directory).

3. **`packages/daemon/src/services/narration-service.ts`** (new): Create the narration service with a `create*Service(deps)` factory following project conventions.

   Interface:

   ```typescript
   interface NarrationService {
     generateNarration(profile: CollectionProfile): Promise<ProfileNarration>;
     isAvailable(): boolean;
   }
   ```

   `isAvailable()` checks whether `ANTHROPIC_API_KEY` (or equivalent cloud provider env vars) is present. Returns false if the key is missing. Note: this only checks key presence, not validity. An invalid key will be caught at `query()` time, not at startup. The route layer (Phase 3) handles both cases: missing key (503 via `isAvailable()` check) and invalid key (502 from SDK auth error during `query()`).

   `generateNarration(profile)` implementation:
   - Builds the system prompt (decision 7)
   - Serializes `CollectionProfile` (minus the narration fields) as the user message
   - Registers two in-process MCP tools (decision 2):
     - `get_collection_games`: calls `gameService.listGames()` with optional filtering
     - `get_profile_detail`: returns specific profile sections from the pre-computed profile
   - Calls `query()` with:
     - `model: "sonnet"` (decision 6)
     - `maxBudgetUsd: 0.05` (decision 5)
     - `maxTurns: 10` (prevent runaway tool loops)
     - `outputFormat: { type: "json", schema: <ProfileNarration JSON Schema> }` (REQ-PROFILE-19)
     - `permissionMode: "plan"` if SDK supports read-only; otherwise `"default"` with `allowedTools` restricted to the two MCP tools
     - `systemPrompt: <constructed prompt>`
   - Parses the structured output into `ProfileNarration`
   - On SDK auth failure: throws a typed error that callers handle as "unavailable"
   - On budget exhaustion or other SDK errors: throws with context for logging

   **MCP tool implementation detail**: The TypeScript Agent SDK uses Zod schemas for in-process MCP tools. The tools are defined as functions with Zod-validated input schemas. The `get_collection_games` tool needs access to `gameService`, so it's created inside the factory closure where the dep is available.

4. **`packages/daemon/src/index.ts`**: Import and create `narrationService` with `{ gameService }` deps. Pass it into `createApp()`.

5. **`packages/daemon/src/app.ts`**: Accept `narrationService` in `AppDeps`. Pass it to `createProfileRoutes()`.

**Verification**: Unit tests for `narration-service.ts` with the Agent SDK mocked at the `query()` boundary. Test cases:

- Happy path: `query()` returns valid structured output; parse succeeds
- Auth failure: `query()` throws auth error; `isAvailable()` returns false
- Budget exhaustion: `query()` throws budget error; error propagates with context
- Malformed output: structured output missing a required field; error propagates
- Tool calls: verify MCP tools are registered with correct Zod schemas (unit test on tool definitions, not on SDK internals)

Typecheck clean. Existing tests unaffected (narration service is additive).

**Dependencies**: Phase 1 (types must exist for `ProfileNarration`).

### Phase 3: Daemon Route and Profile Service Wiring

**Goal**: Expose narration generation via a new endpoint. Wire the narration service into the profile service's cache management.

**Changes**:

1. **`packages/daemon/src/services/profile-service.ts`**: Extend `ProfileService` interface with `generateNarration(): Promise<CollectionProfile>`. Implementation:
   - Calls `getProfile()` to get the current profile (recomputes if stale)
   - Calls `narrationService.generateNarration(profile)`
   - Writes the narration and current timestamp back to `ProfileData`
   - Returns the profile with narration attached and state `"fresh"`

   Also add `narrationService` to `ProfileServiceDeps`. Existing test mocks of `ProfileService` (in `profile-service.test.ts`, `routes/profile.test.ts`) will need updating to include the new `generateNarration` method.

2. **`packages/daemon/src/routes/profile.ts`**: Add `POST /api/profile/narrate` endpoint:
   - Calls `profileService.generateNarration()`
   - Returns the updated `CollectionProfile` (with narration)
   - On narration unavailable (no API key): returns 503 with `{ error: "LLM narration unavailable: Agent SDK not configured" }`
   - On budget/SDK error: returns 502 with error context
   - Add operation definition: `shelf.profile.narrate`

3. **`packages/daemon/src/routes/profile.ts`**: Update the existing `GET /api/profile` response. The `CollectionProfile` already includes narration fields from Phase 1. The route returns whatever the profile service returns, which now includes cache state.

**Verification**: Route-level tests for `POST /api/profile/narrate`:

- 200 with valid narration when SDK is available
- 503 when SDK is unavailable
- 502 on SDK error
- Narration persists: call POST, then GET; narration appears with state "fresh"
- Staleness: call POST to generate narration, then mutate collection (e.g., add a rating), then call GET (which triggers profile recomputation because collection is dirty); the recomputed profile advances `computedAt` past `narrationComputedAt`, so narration appears with state "stale"
- REQ-PROFILE-27: verify no narration is generated on `GET /api/profile` (narration is never auto-triggered)

Typecheck clean.

**Dependencies**: Phase 1 (types), Phase 2 (narration service).

### Phase 4: CLI and Web Client Updates

**Goal**: Both clients can trigger narration generation and display narration state. This phase updates all client helpers and UI in one change to avoid client/daemon divergence.

**Changes**:

1. **`packages/cli/src/client.ts`**: Add `generateNarration(): Promise<CollectionProfile>` that calls `POST /api/profile/narrate`.

2. **`packages/cli/src/commands/profile.ts`**: Add `narrate` subcommand (REQ-PROFILE-34):
   - Calls `client.generateNarration()`
   - Returns the full profile JSON (narration included)
   - On 503: prints "LLM narration unavailable" and returns the algorithmic profile without narration
   - On other errors: prints error message

3. **`packages/cli/src/index.ts`**: Register `profile narrate` in the command map.

4. **`packages/web/lib/api.ts`**: Add `generateNarration(): Promise<CollectionProfile>` that calls `POST /api/daemon/profile/narrate`.

5. **Web Profile Overview page**: Replace and extend the existing narration stub. A `NarrationEmpty` component already exists at `packages/web/components/profile/narration-empty.tsx` (imported in `app/page.tsx` at line 4, rendered at line 71). It renders a disabled "Generate Narrative" button. This is the starting point, not greenfield work.

   Replace the single `NarrationEmpty` component with a narration section that renders conditionally based on `narrationState`:
   - **Fresh state**: Render `summary` as prose, `surprises`/`tensions`/`blindSpots`/`curveInsights` as labeled lists. No generate button (narration is current).
   - **Stale state**: Same render, plus a visual indicator ("Narration based on an older profile") and a "Regenerate" button.
   - **Empty state**: Enable the existing "Generate Narrative" button (currently disabled). Show the button regardless of whether the SDK is configured; unavailability is discovered when the user clicks (503 from POST) and displayed as an inline error message.
   - The "Generate" / "Regenerate" button calls `generateNarration()` via the daemon proxy. This is a user-initiated mutation, so it must be a **client component** with loading state. The rest of the profile page uses server components. There is no existing example of a POST-triggering client component in this web package, so this is the first instance of this pattern.
   - Update the `app/page.tsx` import to use the new narration section component instead of `NarrationEmpty`.

**Verification**:

- CLI: test `profile narrate` command with mocked client responses (success, 503, error)
- Web: manual verification that all three cache states render correctly with the 200-game dataset
- Client/daemon alignment: both `client.ts` and `api.ts` call the same endpoint with the same response shape
- REQ-PROFILE-27: verify the generate button is the only trigger; no auto-generation on page load
- REQ-PROFILE-28: verify that when `ANTHROPIC_API_KEY` is unset, the daemon returns 503 and the UI shows empty state gracefully

**Dependencies**: Phase 3 (route must exist for clients to call).

### Phase 5: Testing and Validation

**Goal**: End-to-end validation against the spec requirements. Fresh-context review.

**Changes**:

1. **Integration test**: With the Agent SDK mocked at the `query()` boundary, test the full flow:
   - Start daemon with narration service wired
   - `GET /api/profile` returns profile with `narrationState: "empty"`
   - `POST /api/profile/narrate` returns profile with narration and state `"fresh"`
   - Mutate collection (add a rating)
   - `GET /api/profile` returns recomputed profile with state `"stale"` and the old narration
   - `POST /api/profile/narrate` returns new narration with state `"fresh"`

2. **Requirement traceability check**: Verify each REQ-PROFILE is addressed:
   - REQ-PROFILE-18: Agent SDK integrated via `narration-service.ts`
   - REQ-PROFILE-19: Structured output with four named sections
   - REQ-PROFILE-20: Two in-process MCP tools (`get_collection_games`, `get_profile_detail`)
   - REQ-PROFILE-21: `maxBudgetUsd: 0.05`
   - REQ-PROFILE-22: System prompt directs interpretation (surprises, tensions, blind spots)
   - REQ-PROFILE-23: System prompt constrains to narration only; no write access in MCP tools
   - REQ-PROFILE-26: Three-state cache implemented and tested
   - REQ-PROFILE-27: No auto-generation; POST-only trigger
   - REQ-PROFILE-28: Auth via `ANTHROPIC_API_KEY`; 503 when missing
   - REQ-PROFILE-34: CLI `profile narrate` subcommand

3. **Fresh-context code review**: Sub-agent reviews the implementation for:
   - Client/daemon divergence (both web and CLI updated?)
   - Type consistency between shared types and actual API responses
   - Error handling at service/route/client boundaries
   - System prompt effectiveness (does it actually prevent score determination?)

**Verification**: All tests pass. Review findings addressed. Typecheck, lint, format clean.

**Dependencies**: All previous phases.

## Delegation Guide

| Phase   | Primary Worker  | Reviewer                          | Notes                                                      |
| ------- | --------------- | --------------------------------- | ---------------------------------------------------------- |
| Phase 1 | Dalton          | Thorne (typecheck)                | Foundation types, must be right before Phase 2             |
| Phase 2 | Dalton          | Thorne (SDK integration review)   | Heaviest phase. Agent SDK patterns need fresh-eyes review. |
| Phase 3 | Dalton          | Thorne (route shape review)       | Route + service wiring. Check error response shapes.       |
| Phase 4 | Dalton          | Thorne (client/daemon divergence) | Both clients in one change. Reviewer checks alignment.     |
| Phase 5 | Thorne (review) | -                                 | Fresh-context validation pass                              |

## Risk Register

**Agent SDK API instability.** The SDK ships frequently, so whatever version the research doc quotes will likely be behind by the time this plan is worked. Phase 2 must start by installing the current latest via `bun add @anthropic-ai/claude-agent-sdk@latest` and verifying that `query()`, `outputFormat`, and in-process MCP tool registration still work as documented. Do not rely on version numbers cached in prior research; always pull the current release before building against it.

**Structured output reliability.** If the agent returns malformed JSON despite `outputFormat`, the narration service needs a retry strategy. Decision: one retry on parse failure, then surface the error. No silent fallback to unstructured text.

**Budget calibration.** $0.05 is estimated. The actual cost depends on how many MCP tool calls the agent makes. Phase 5 testing should measure actual cost on the 200-game dataset and adjust if needed.

**MCP tool Zod schema shape.** The TypeScript Agent SDK's in-process MCP tool API uses Zod for input schemas. The exact registration pattern (decorator vs. function call) should be verified against the current SDK version before implementing Phase 2.
