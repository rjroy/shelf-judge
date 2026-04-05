---
title: "MVP Implementation Plan"
date: 2026-04-05
status: draft
tags: [plan, mvp, implementation]
spec: .lore/specs/mvp.md
related:
  - .lore/designs/mvp-data-model.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/designs/mvp-bgg-integration.md
  - .lore/designs/mvp-api-surface.md
  - .lore/designs/mvp-web-ui.md
  - .lore/designs/mvp-cli.md
  - .lore/reference/architecture-pattern.md
---

# Plan: Shelf Judge MVP

## Overview

This plan sequences the full MVP build from the approved spec (24 requirements across 3 modules: daemon, web-ui, cli). The ordering follows the dependency graph: data model and storage first, then fitness engine, then API surface, then clients (web UI and CLI in parallel). BGG integration threads through multiple phases because it touches storage, scoring, and the API.

The plan is organized into 7 phases. Each phase is a meaningful, testable increment. Phases 1-4 are strictly sequential (each depends on its predecessor). Phase 5 (web UI) and Phase 6 (CLI) can run in parallel after Phase 4 completes. Phase 7 is integration verification.

## Technical Decisions Locked Down

These decisions are resolved here so implementation commissions don't need to re-litigate them.

### 1. Axis weight UX (Open Question #1 from spec)

**Decision:** Raw integer weights (1-100) in storage. The fitness calculation normalizes by dividing by sum of weights, which produces effective percentages. The web UI displays weights as both raw numbers and computed percentages. No auto-normalization slider in MVP.

**Rationale:** Raw numbers are simpler to store, validate, and reason about. The API already normalizes in the score calculation (`sum(rating * weight) / sum(weight)`), so the math handles any weight values. A percentage display is a UI concern, not a data model change.

### 2. BGG library choice (Open Question #2 from spec)

**Decision:** Use `bgg-xml-api-client` as the primary choice. If it doesn't handle the 2025 auth token cleanly at implementation time, fall back to a thin custom client using `fast-xml-parser`. The API surface we use is exactly three endpoints (thing, search, collection), which makes a custom client tractable.

**Rationale:** The BGG API research identifies `bgg-xml-api-client` as the most actively maintained library with explicit auth token support (`authorizationKey` param). The fallback is defined because library fitness can only be verified at implementation time.

### 3. Project structure

**Decision:** Monorepo with three packages: `daemon`, `web`, `cli`. Shared types in `packages/shared/`. Bun workspace.

```
shelf-judge/
  package.json              # Workspace root
  packages/
    shared/
      src/
        types.ts            # Game, Axis, Collection, FitnessResult, etc.
        validation.ts       # Shared Zod schemas
    daemon/
      package.json
      src/
        index.ts            # Entry point, Bun.serve() on Unix socket
        app.ts              # Hono app factory with DI
        routes/
          games.ts          # Game CRUD route factory
          axes.ts           # Axis CRUD route factory
          scores.ts         # Score/breakdown route factory
          import.ts         # BGG import route factory
          config.ts         # Config route factory
          help.ts           # Operations registry route
        services/
          game-service.ts
          axis-service.ts
          fitness-service.ts
          bgg-client.ts
          storage-service.ts
        operations.ts       # OperationDefinition registry
      tests/
    web/
      package.json
      next.config.ts
      app/
        layout.tsx
        page.tsx            # Collection view
        games/
          [id]/page.tsx     # Game detail
        axes/page.tsx       # Axes management
        search/page.tsx     # Game search/add
        import/page.tsx     # BGG import status
      components/
      lib/
        api.ts              # Daemon API client
    cli/
      package.json
      src/
        index.ts            # Entry point
        client.ts           # Unix socket HTTP client
        commands/            # Command handlers (discovered from daemon)
        output.ts           # Table/JSON formatter
      tests/
```

### 4. Storage atomicity approach

**Decision:** Write-to-temp-then-rename using `Bun.write()` to a `.tmp` file in the same directory, followed by `fs.rename()`. Rename is atomic on the same filesystem. The StorageService wraps this pattern.

### 5. Config file location

**Decision:** `~/.shelf-judge/config.json` for app config (BGG token, socket path). `~/.shelf-judge/data/collection.json` for collection state. Configurable via `SHELF_JUDGE_DATA_DIR` and `SHELF_JUDGE_CONFIG` environment variables for testing.

### 6. Fitness score rounding method

**Decision:** Use `Math.round(score * 10) / 10` for rounding to one decimal place. Do not use `toFixed(1)` (returns a string and uses banker's rounding in some JS engines, causing inconsistent behavior). All fitness scores are stored and transmitted as numbers, formatted to one decimal place only at display time.

### 7. Import endpoint parameter style

**Decision:** `POST /api/import/bgg` accepts `{ username: string }` in the request body, not as a query parameter. The API surface design shows `?username={bggUsername}` but the body approach is more consistent with the other POST endpoints and avoids encoding issues in usernames. The web UI and CLI both send the username in the body.

### 8. CLI command discovery model

**Decision:** CLI commands are hardcoded mappings from command paths to API routes. The `help` command uses daemon discovery (fetching `/api/help`) to show the full operation tree, but individual command implementations know their routes statically. This makes the CLI testable without a running daemon and avoids the complexity of fully dynamic dispatch. The daemon's operations registry is the source of truth for what exists; the CLI's hardcoded mappings are the source of truth for how to invoke it from the command line.

### 9. Architecture pattern note

The architecture pattern reference doc says "All durable state is in YAML and markdown files." This does not apply to shelf-judge. The spec and data model design specify JSON files for all state. The architecture pattern is a general reference, not a project-specific constraint.

---

## Phase 1: Project Scaffolding and Data Model

**Goal:** Establish the project structure, shared types, and storage layer. After this phase, the project builds, tests run, and state can be persisted and loaded.

**Dependencies:** None (first phase).

**Requirements satisfied:** REQ-MVP-20, REQ-MVP-21

### Steps

#### 1.1 Project scaffolding

Create the monorepo workspace structure. Initialize `package.json` at root and in each package. Configure TypeScript (`tsconfig.json` with strict mode), ESLint (flat config with typescript-eslint), and Prettier. Add `.gitignore` for bun, node_modules, build artifacts, and `.shelf-judge/` data directory.

**Files created:**
- `package.json` (workspace root)
- `packages/shared/package.json`, `packages/shared/tsconfig.json`
- `packages/daemon/package.json`, `packages/daemon/tsconfig.json`
- `packages/web/package.json` (placeholder, built in Phase 5)
- `packages/cli/package.json` (placeholder, built in Phase 6)
- `tsconfig.json` (root, project references)
- `eslint.config.js`
- `.gitignore`

**Dependencies to install:**
- Root: `typescript`, `typescript-eslint`, `eslint`, `prettier`, `bun-types`
- Daemon: `hono`, `zod`, `fast-xml-parser` (for BGG XML parsing), `uuid`
- Shared: `zod` (for validation schemas)

**Verification:** `bun install` succeeds. `bun run typecheck` passes (empty project). `bun test` runs (no tests yet, zero failures).

#### 1.2 Shared types and validation

Define the core data types in `packages/shared/src/types.ts` following the data model design exactly: `Game`, `BggGameData`, `BggTag`, `SuggestedPlayerCount`, `Axis`, `Collection`. Define `FitnessResult` and `FitnessBreakdownEntry` from the fitness model design.

Create Zod schemas in `packages/shared/src/validation.ts` for input validation: `CreateAxisSchema`, `UpdateAxisSchema`, `RateGameSchema`, `AddGameSchema`. Validate: axis weight 1-100 (integer), rating 1-10 (integer), axis name non-empty.

**Files created:**
- `packages/shared/src/types.ts`
- `packages/shared/src/validation.ts`
- `packages/shared/src/index.ts` (barrel export)

**Tests (packages/shared/tests/):**
- Zod schema validation: valid inputs pass, invalid inputs (rating 0, rating 11, weight -1, weight 101, empty name) are rejected
- Type exports compile correctly (type-level test)

**Verification:** `bun test packages/shared` passes. Types are importable from `@shelf-judge/shared`.

#### 1.3 Storage service

Implement `StorageService` in `packages/daemon/src/services/storage-service.ts`. DI factory pattern: `createStorageService({ dataDir, fileOps }) -> StorageService`.

Interface:
- `loadCollection(): Promise<Collection>` -- reads `collection.json`, returns parsed Collection. Creates default collection with two BGG-derived axes (Community Rating, Complexity) if file doesn't exist.
- `saveCollection(collection: Collection): Promise<void>` -- atomic write (temp file + rename).
- `loadConfig(): Promise<AppConfig>` -- reads `config.json`.
- `saveConfig(config: AppConfig): Promise<void>` -- atomic write.

The `fileOps` dependency abstracts filesystem operations for testability (in-memory implementation for tests).

**Files created:**
- `packages/daemon/src/services/storage-service.ts`
- `packages/daemon/src/services/file-ops.ts` (interface + real implementation)
- `packages/daemon/tests/services/storage-service.test.ts`
- `packages/daemon/tests/helpers/mock-file-ops.ts` (in-memory fileOps for testing)

**Tests:**
- Load collection from valid JSON file
- Load collection returns default collection (with 2 BGG axes) when file doesn't exist
- Save collection writes to temp file then renames (verify atomic write sequence)
- Save collection produces valid JSON that round-trips through load
- Concurrent save doesn't corrupt data (sequential writes, verify last-write-wins)
- Load handles malformed JSON gracefully (error, not crash)

**Verification:** `bun test packages/daemon/tests/services/storage-service.test.ts` passes. Atomic write behavior confirmed via mock fileOps call sequence.

### Review Gate

After Phase 1 completes: review the shared types against the data model design, verify storage atomicity, confirm the default axes match REQ-MVP-3. This is the foundation everything else builds on.

**Commission chain:** implement (Dalton) -> review (Thorne) -> fix (Dalton)

---

## Phase 2: Fitness Engine and Axis/Game Services

**Goal:** Implement the core domain logic: fitness score calculation, axis CRUD with cascade deletion, and game CRUD with duplicate detection. After this phase, the business logic works in isolation (no HTTP layer yet).

**Dependencies:** Phase 1 (shared types, storage service).

**Requirements satisfied:** REQ-MVP-1, REQ-MVP-2, REQ-MVP-3, REQ-MVP-4, REQ-MVP-5, REQ-MVP-6, REQ-MVP-8, REQ-MVP-9, REQ-MVP-14, REQ-MVP-15, REQ-MVP-16, REQ-MVP-17

### Steps

#### 2.1 Fitness service

Implement `FitnessService` in `packages/daemon/src/services/fitness-service.ts`. Pure computation, no I/O. Factory: `createFitnessService() -> FitnessService`.

Interface:
- `calculateScore(game: Game, axes: Axis[], bggData: BggGameData | null): FitnessResult | null`

Logic:
1. For each axis, determine the rating: check `game.ratings[axis.id]` first (personal or override). If not present and axis is BGG-derived, compute from `bggData` using `bggField` mapping. Community Rating is pass-through. Complexity maps BGG weight 1-5 to 1-10 via `weight * 2`.
2. Collect all axes that have a rating (personal, BGG-derived, or override). If none, return `null` (REQ-MVP-14).
3. If sum of weights for rated axes is zero, return `null` (REQ-MVP-16).
4. Compute `sum(rating * weight) / sum(weight)` across rated axes.
5. Round to one decimal place (REQ-MVP-6).
6. Build the breakdown array with each axis's name, rating, weight, contribution, source, and bggOriginal (for overrides).

**Files created:**
- `packages/daemon/src/services/fitness-service.ts`
- `packages/daemon/tests/services/fitness-service.test.ts`

**Tests (these are critical, use the Wingspan example from the fitness model design):**
- Wingspan example: axes "Wife will play it" (w:40, r:8), "Visual design" (w:30, r:9), "Complexity" (w:20, BGG weight 2.9 -> 5.8), "Community Rating" (w:10, BGG 8.1). Expected score: 7.9. Verify breakdown entries sum to total.
- Single axis: score equals the rating
- Multiple axes, equal weights: simple average
- Missing ratings on some axes: excluded from calculation, shown as "not rated" in breakdown
- Zero rated axes: returns null
- All-zero weights on rated axes: returns null (no division by zero)
- BGG-derived axis with no BGG data: excluded (treated as unrated)
- Override of BGG-derived axis: source is "override", bggOriginal contains original BGG value
- Score rounds to one decimal place using `Math.round(x * 10) / 10`. Test cases: 7.84 -> 7.8, 7.85 -> 7.9, 7.94 -> 7.9, 7.95 -> 8.0

**Verification:** `bun test packages/daemon/tests/services/fitness-service.test.ts` passes. Hand-verify the Wingspan example arithmetic.

#### 2.2 Axis service

Implement `AxisService` in `packages/daemon/src/services/axis-service.ts`. Factory: `createAxisService({ storageService }) -> AxisService`.

Interface:
- `createAxis(input: CreateAxisInput): Promise<Axis>`
- `listAxes(): Promise<Axis[]>`
- `updateAxis(id: string, input: UpdateAxisInput): Promise<Axis>`
- `deleteAxis(id: string): Promise<{ deletedRatingsCount: number }>` -- cascade deletes all ratings on this axis across all games, returns count for confirmation UX (REQ-MVP-15)

**Files created:**
- `packages/daemon/src/services/axis-service.ts`
- `packages/daemon/tests/services/axis-service.test.ts`

**Tests:**
- Create axis: generates UUID, stores in collection, validates input via Zod schema
- Create axis rejects invalid weight (0, 101, -1, non-integer)
- List axes returns all axes including default BGG-derived ones
- Update axis: changes name/description/weight, preserves other fields
- Delete axis: removes axis, removes all ratings on that axis from all games, returns count of affected ratings
- Delete axis cascade verified end-to-end: after deletion, calling `gameService.getGame()` on a previously-rated game returns a different score (this test lives in `game-service.test.ts` or a cross-service integration test, not axis-service, because the score is computed on read)

**Verification:** `bun test packages/daemon/tests/services/axis-service.test.ts` passes.

#### 2.3 Game service

Implement `GameService` in `packages/daemon/src/services/game-service.ts`. Factory: `createGameService({ storageService, fitnessService }) -> GameService`.

Interface:
- `addGame(input: AddGameInput): Promise<Game>` -- accepts both `{ name: string }` (manual) and `{ bggId: number }` (BGG). In Phase 2, bggId is stored as-is with `bggData: null`; the actual BGG fetch is wired in Phase 3. The `AddGameInput` schema (defined in Phase 1.2) must support both variants from the start so Phase 3 doesn't need to change it.
- `getGame(id: string): Promise<{ game: Game, score: FitnessResult | null }>`
- `listGames(): Promise<Array<{ game: Game, score: FitnessResult | null }>>`
- `rateGame(id: string, ratings: Record<string, number>): Promise<{ game: Game, score: FitnessResult | null }>` -- validates each rating 1-10, validates axis IDs exist
- `removeGame(id: string): Promise<void>`

Duplicate detection (REQ-MVP-9): when adding a game with a bggId, check if any existing game has the same bggId. If so, reject with a clear error. Manual games (no bggId) are never duplicates of each other.

**Files created:**
- `packages/daemon/src/services/game-service.ts`
- `packages/daemon/tests/services/game-service.test.ts`

**Tests:**
- Add manual game: creates game with null bggId, generates UUID
- Add game with bggId: stores bggId for later BGG data fetch
- Duplicate bggId rejection: adding a game with bggId that already exists throws descriptive error
- Manual games are never duplicates (two games with null bggId, same name, both succeed)
- Get game: returns game with computed fitness score
- List games: returns all games sorted by fitness score descending (unscored games at end)
- Rate game: sets ratings, validates 1-10 range
- Rate game rejects rating outside 1-10 (0, 11, 1.5, negative)
- Rate game rejects unknown axis ID
- Remove game: deletes game and all its ratings
- Remove game: game no longer appears in list

**Verification:** `bun test packages/daemon/tests/services/game-service.test.ts` passes.

### Review Gate

After Phase 2: review the fitness calculation against hand-calculated examples. Verify axis cascade deletion works correctly. Confirm score breakdown entries sum to total in all test cases.

**Commission chain:** implement (Dalton) -> review (Thorne) -> fix (Dalton)

---

## Phase 3: BGG Integration

**Goal:** Implement the BGG API client with rate limiting, 202 retry logic, XML parsing, and collection import. After this phase, the daemon can fetch game data from BGG, search for games, and import collections.

**Dependencies:** Phase 2 (game service, storage service).

**Requirements satisfied:** REQ-MVP-7, REQ-MVP-10, REQ-MVP-11, REQ-MVP-12, REQ-MVP-13, REQ-MVP-18, REQ-MVP-19

### Steps

#### 3.0 BGG library spike

Before implementing the full client, verify that the chosen library (`bgg-xml-api-client`) handles the 2025 auth token requirement. Write a minimal test script that:
1. Imports `bgg-xml-api-client`
2. Makes one authenticated request to `/xmlapi2/thing?id=174430&stats=1` (Gloomhaven)
3. Verifies the response contains expected fields (name, stats, mechanics)

If the library doesn't handle auth tokens cleanly, switch to the fallback: a thin custom client using `fetch` + `fast-xml-parser`. Record the decision.

**Verification:** Either the library works with auth tokens, or the fallback plan is activated. This step takes < 30 minutes and prevents wasted effort in 3.1.

#### 3.1 BGG client service

Implement `BggClient` in `packages/daemon/src/services/bgg-client.ts`. Factory: `createBggClient({ config, fetchFn? }) -> BggClient`.

Interface:
- `searchGames(query: string): Promise<BggSearchResult[]>` -- calls `/xmlapi2/search`
- `getGame(bggId: number): Promise<BggGameData>` -- calls `/xmlapi2/thing` with `stats=1`
- `getGames(bggIds: number[]): Promise<Map<number, BggGameData>>` -- batch thing request (up to 250 per call)
- `getUserCollection(username: string): Promise<BggCollectionItem[]>` -- calls `/xmlapi2/collection` with 202 retry logic
- `isConfigured(): boolean` -- checks if BGG token is present

Rate limiting (internal):
- Implementation: a sequential request queue with a configurable `delayMs` parameter (default: 5000ms). Each request waits `delayMs` after the previous request completes before firing. Tests inject `delayMs: 0` for speed. The queue is internal to `BggClient`; callers don't see it.
- 429 response: back off 30 seconds, then 1 req/10s, gradually return to normal
- 502/503: retry after 30 seconds, up to 2 retries

202 handling (collection endpoint):
- Retry with exponential backoff: 5s, 10s, 20s
- Max 3 retries. If still 202, return error.

XML parsing:
- Use `fast-xml-parser` to parse XML responses
- Extract primary name (`type="primary"`), player count, play time, year, mechanics, categories, community rating, weight, suggested player counts
- Treat `averageweight` of 0 as null (known BGG bug)
- Handle `<median>` always being 0 (ignore it)

The `fetchFn` dependency defaults to global `fetch` but is injectable for testing.

**Files created:**
- `packages/daemon/src/services/bgg-client.ts`
- `packages/daemon/src/services/bgg-xml-parser.ts` (XML -> typed objects)
- `packages/daemon/tests/services/bgg-client.test.ts`
- `packages/daemon/tests/services/bgg-xml-parser.test.ts`
- `packages/daemon/tests/fixtures/` (captured real BGG API responses as XML files)

**Tests:**
- XML parser: parse a captured real `/xmlapi2/thing` response for a known game (e.g., Wingspan BGG ID 266192). Verify all fields extracted correctly.
- XML parser: parse a search response. Verify IDs, names, years.
- XML parser: parse a collection response. Verify game list with stats.
- XML parser: `averageweight` of 0 maps to null
- XML parser: primary name extracted correctly when multiple `<name>` elements exist
- BggClient: search delegates to fetch with correct URL and auth header
- BggClient: getGame delegates to fetch with `stats=1`
- BggClient: 202 response triggers retry (mock fetch returns 202, then 200)
- BggClient: 202 after max retries returns error
- BggClient: 429 response triggers backoff (verify timing via mock)
- BggClient: 502/503 triggers retry
- BggClient: malformed XML returns error, not crash
- BggClient: missing token returns clear error message with registration URL
- BggClient: batch getGames batches up to 250 IDs per request

**Critical:** Use captured real API responses for XML parser tests, not synthetic XML. The spec's AI validation criteria requires this.

**Verification:** `bun test packages/daemon/tests/services/bgg-client.test.ts` and `bgg-xml-parser.test.ts` pass.

#### 3.2 BGG integration into game service

Extend `GameService` to use `BggClient` for game addition and data refresh. Update factory: `createGameService({ storageService, fitnessService, bggClient }) -> GameService`.

New/modified interface:
- `addGame(input)` -- when `bggId` is provided, fetch full data from BGG via `bggClient.getGame()`, populate `bggData` field. When BGG is unavailable, still add the game but with null `bggData`.
- `searchGames(query: string): Promise<BggSearchResult[]>` -- delegates to bggClient
- `refreshBggData(gameId: string): Promise<Game>` -- re-fetches BGG data, updates cache, re-derives BGG axis ratings that haven't been overridden (REQ-MVP-19). Preserves user overrides.
- `refreshAllBggData(): Promise<RefreshSummary>` -- refreshes all games with bggIds

Auto-population of BGG-derived axes (REQ-MVP-17): when a game has `bggData`, and an axis has `source: "bgg"`, automatically compute the rating from `bggData` using the `bggField` mapping (unless the user has overridden it via `game.ratings[axisId]`). This happens at score calculation time in the fitness service, not at storage time. The rating in `game.ratings` represents user input only; BGG-derived values are computed on the fly.

**Design note on overrides:** When a user rates a BGG-derived axis explicitly, that rating is stored in `game.ratings[axisId]`. The fitness service checks `game.ratings` first; if present, it uses that value (source: "override") and records the original BGG value in `bggOriginal`. If not present, it computes from `bggData` (source: "bgg").

**Files modified:**
- `packages/daemon/src/services/game-service.ts`
- `packages/daemon/src/services/fitness-service.ts` (BGG-derived rating logic)

**Tests (new):**
- Add game by bggId: fetches BGG data, stores in game.bggData
- Add game by bggId when BGG unavailable: game added with null bggData, no crash
- Search games: returns results from BGG
- Search when BGG not configured: returns clear error
- Refresh game: updates bggData.fetchedAt, re-derives BGG axis ratings
- Refresh preserves user overrides (rate a BGG-derived axis, refresh, override remains)
- Fitness score includes BGG-derived axes when bggData present
- Fitness score excludes BGG-derived axes when bggData absent
- Override of BGG-derived axis: breakdown shows "override" source with bggOriginal

**Verification:** `bun test packages/daemon/tests/services/game-service.test.ts` passes (including new BGG tests).

#### 3.3 Collection import

Implement collection import in `GameService` (or a dedicated `ImportService` if the game service gets too large).

- `importBggCollection(username: string, onProgress: (event) => void): Promise<ImportSummary>`
- Fetches the user's owned games via `bggClient.getUserCollection()`
- For each game: check if bggId already exists in collection (skip if so, count as "skipped")
- For new games: fetch full data via `bggClient.getGame()` (or batch via `getGames()`), create game record
- Stream progress events via `onProgress` callback (for SSE in Phase 4)
- On individual game failure: continue with remaining games, record error
- Return summary: `{ imported: number, skipped: number, errors: string[] }`

**Files created/modified:**
- `packages/daemon/src/services/game-service.ts` (or new `import-service.ts`)
- `packages/daemon/tests/services/import.test.ts`

**Tests:**
- Import creates games for each item in BGG collection response
- Import skips games that already exist (matched by bggId), counts them
- Import reports progress (verify onProgress called with incrementing counts)
- Import handles partial failure (some games fail to fetch, others succeed)
- Import with empty collection returns zero imported
- Import when BGG not configured returns clear error

**Verification:** `bun test packages/daemon/tests/services/import.test.ts` passes.

### Review Gate

After Phase 3: review BGG client against the research document. Verify XML parsing against real captured responses. Confirm error handling doesn't crash the daemon. Test the offline scenario (REQ-MVP-11).

**Commission chain:** implement (Dalton) -> review (Thorne) -> fix (Dalton)

---

## Phase 4: Daemon API (Hono Routes)

**Goal:** Wire all services into Hono routes on a Unix socket. After this phase, the daemon is a running HTTP server that exposes the full API surface. Clients can interact via HTTP.

**Dependencies:** Phase 3 (all services complete).

**Requirements satisfied:** REQ-MVP-22 (daemon portion), REQ-MVP-11 (graceful degradation at API level), REQ-MVP-12 (token error messages)

### Steps

#### 4.1 App factory and server entry point

Create the Hono app factory with DI: `createApp(deps) -> { app, operations }`. The factory wires real dependencies (storage, fitness, BGG client, game service, axis service). Tests wire mock dependencies.

Create `packages/daemon/src/index.ts` entry point: resolve config, create services, create app, start `Bun.serve()` on Unix socket.

**Files created:**
- `packages/daemon/src/app.ts` (Hono app factory)
- `packages/daemon/src/index.ts` (entry point)
- `packages/daemon/src/config.ts` (config resolution from env/file)

**Verification:** `bun run packages/daemon/src/index.ts` starts a server on the Unix socket. `curl --unix-socket /path/to/socket http://localhost/api/help` returns a response.

#### 4.2 Game routes

Implement game route factory: `createGameRoutes({ gameService, bggClient }) -> RouteModule`.

Routes (from API surface design):
- `GET /api/games/search?q={query}` -> `shelf.game.search`
- `POST /api/games` -> `shelf.game.add`
- `GET /api/games/:id` -> `shelf.game.get`
- `GET /api/games` -> `shelf.game.list`
- `PUT /api/games/:id/ratings` -> `shelf.game.rate`
- `DELETE /api/games/:id` -> `shelf.game.remove`
- `POST /api/games/:id/refresh` -> `shelf.game.refresh-bgg`

Each route validates input (Zod schemas), delegates to service, returns typed JSON response. Error responses follow a consistent shape: `{ error: string, details?: unknown }`.

When BGG is not configured, BGG-dependent routes (search, add-by-bggId, refresh) return 503 with the configuration error message (REQ-MVP-12).

**Files created:**
- `packages/daemon/src/routes/games.ts`
- `packages/daemon/tests/routes/games.test.ts`

**Tests (integration-level, using Hono's `app.request()`):**
- POST /api/games with manual game: returns 201 with game
- POST /api/games with bggId: returns 201 with game + BGG data
- POST /api/games duplicate bggId: returns 409 with error message
- GET /api/games: returns list sorted by fitness score
- GET /api/games/:id: returns game with score breakdown
- PUT /api/games/:id/ratings: updates ratings, returns new score
- PUT /api/games/:id/ratings with invalid rating: returns 400
- DELETE /api/games/:id: returns 204
- GET /api/games/search?q=wingspan: returns search results
- BGG routes without token: returns 503 with setup instructions

**Verification:** `bun test packages/daemon/tests/routes/games.test.ts` passes.

#### 4.3 Axis routes

Implement axis route factory: `createAxisRoutes({ axisService }) -> RouteModule`.

Routes:
- `POST /api/axes` -> `shelf.axis.create`
- `GET /api/axes` -> `shelf.axis.list`
- `PUT /api/axes/:id` -> `shelf.axis.update`
- `DELETE /api/axes/:id` -> `shelf.axis.delete`

Delete returns the count of affected ratings (for confirmation UI).

**Files created:**
- `packages/daemon/src/routes/axes.ts`
- `packages/daemon/tests/routes/axes.test.ts`

**Tests:**
- POST /api/axes: creates axis, returns 201
- POST /api/axes with invalid weight: returns 400
- GET /api/axes: returns all axes
- PUT /api/axes/:id: updates axis
- DELETE /api/axes/:id: returns 200 with `{ deletedRatingsCount: N }`

**Verification:** `bun test packages/daemon/tests/routes/axes.test.ts` passes.

#### 4.4 Score routes

Implement score route factory: `createScoreRoutes({ gameService, fitnessService }) -> RouteModule`.

Routes:
- `GET /api/games/:id/score` -> `shelf.score.get`
- `GET /api/scores` -> `shelf.score.list`

**Endpoint division of responsibility:** `GET /api/games/:id` returns the game data with a summary score (the `FitnessResult` object). `GET /api/games/:id/score` returns only the `FitnessResult` with its full breakdown. Both include the breakdown; the difference is whether the game metadata is included. The web UI's game detail page calls `GET /api/games/:id` (gets everything in one call). The CLI's `score get` command calls `GET /api/games/:id/score` (score-focused output). In practice, both endpoints include the full breakdown because REQ-MVP-5 requires it wherever a score is shown.

The score.list endpoint returns all games ranked by fitness score (descending), with unscored games listed separately at the end.

**Files created:**
- `packages/daemon/src/routes/scores.ts`
- `packages/daemon/tests/routes/scores.test.ts`

**Tests:**
- GET /api/games/:id/score: returns FitnessResult with breakdown
- GET /api/games/:id/score for unrated game: returns null score with "not yet rated" indication
- GET /api/scores: returns games ranked by fitness, unscored at end

**Verification:** `bun test packages/daemon/tests/routes/scores.test.ts` passes.

#### 4.5 Import route (SSE)

Implement import route factory: `createImportRoutes({ gameService, bggClient }) -> RouteModule`.

Route:
- `POST /api/import/bgg` -> `shelf.import.bgg-collection`

This route uses Hono's `streamSSE` helper to stream progress events. The request body contains `{ username: string }` (see Technical Decision #7). The route calls `gameService.importBggCollection()` with a progress callback that writes SSE events.

SSE events (from API design):
- `event: progress` with `data: { imported, total, current }`
- `event: complete` with `data: { imported, skipped, errors }`

Set `idleTimeout: 0` on the SSE connection (per architecture pattern).

**Files created:**
- `packages/daemon/src/routes/import.ts`
- `packages/daemon/tests/routes/import.test.ts`

**Tests:**
- POST /api/import/bgg: streams progress events, ends with complete event
- POST /api/import/bgg without BGG token: returns 503
- Verify SSE event format matches the API design

**Verification:** `bun test packages/daemon/tests/routes/import.test.ts` passes.

#### 4.6 Operations registry and help routes

Implement the operations registry. Each route factory exports its `OperationDefinition[]`. The app factory collects all operations into a registry.

Routes:
- `GET /api/help` -> `shelf.help` (full operation tree)
- `GET /api/help/:feature` -> `shelf.help.feature` (subtree)

Config routes:
- `GET /api/config` -> `shelf.config.get`
- `PUT /api/config` -> `shelf.config.set`

**Files created:**
- `packages/daemon/src/operations.ts` (registry builder)
- `packages/daemon/src/routes/help.ts`
- `packages/daemon/src/routes/config.ts`
- `packages/daemon/tests/routes/help.test.ts`

**Tests:**
- GET /api/help returns all operations in tree structure
- GET /api/help/game returns game operations subtree
- Operations have correct method, path, and description

**Verification:** `bun test packages/daemon/tests/routes/help.test.ts` passes.

### Review Gate

After Phase 4: full API review. Verify every route against the API surface design. Test error handling paths (BGG down, invalid input, missing games). Verify SSE streaming works end-to-end.

**Commission chain:** implement (Dalton) -> review (Thorne) -> fix (Dalton)

---

## Phase 5: Web UI (Next.js)

**Goal:** Build the web interface as a client of the daemon API. After this phase, users can interact with shelf-judge through a browser.

**Dependencies:** Phase 4 (daemon API complete). Can run in parallel with Phase 6.

**Requirements satisfied:** REQ-MVP-22 (web UI portion), REQ-MVP-5 (breakdown display), REQ-MVP-24 (breakdown in web)

### Steps

#### 5.1 Next.js project setup

Initialize Next.js with App Router in `packages/web/`. Configure to proxy API requests to the daemon's Unix socket.

Create the daemon API client in `packages/web/lib/api.ts`: typed functions that call the daemon's REST API. This is the only file that knows about the socket/HTTP transport. The client uses Bun's `fetch` with the `unix` socket option for server components. If Next.js's fetch wrapper doesn't pass the `unix` option through cleanly, create a Next.js API route proxy at `/api/daemon/[...path]` that forwards requests to the Unix socket. This proxy approach keeps the web UI's client components making standard HTTP calls to the Next.js server, which handles the socket transport.

Create the root layout with navigation (sidebar or top nav with: Collection, Axes, Add Game).

**Files created:**
- `packages/web/` (full Next.js scaffold via `bunx create-next-app@latest`)
- `packages/web/lib/api.ts`
- `packages/web/app/layout.tsx` (with navigation)

**Verification:** `bun run dev` in `packages/web/` starts the dev server. Navigation renders. A test call from a server component to the daemon's `/api/help` endpoint succeeds (this validates the socket transport immediately).

#### 5.2 Collection view (home page)

Implement the collection view at `packages/web/app/page.tsx`.

- Fetches all games from `GET /api/games` (server component)
- Table/grid showing: game name, thumbnail, fitness score, rated axis count
- Sorted by fitness score descending
- Unscored games shown at bottom with "not yet rated"
- "Add Game" and "Import from BGG" buttons
- Click a game row to navigate to `/games/[id]`

**Files created:**
- `packages/web/app/page.tsx`
- `packages/web/components/game-list.tsx`
- `packages/web/components/score-badge.tsx`

**Verification:** Page renders with game data from daemon. Sorting is correct. Navigation works.

#### 5.3 Game detail view

Implement game detail at `packages/web/app/games/[id]/page.tsx`.

- Fetches game + score from `GET /api/games/:id`
- Displays game info: name, year, player count, play time, thumbnail
- Displays fitness score with full breakdown table (the transparency display from the fitness model design)
- Breakdown shows: axis name, rating, weight, contribution, source (personal/BGG/override), and BGG original value for overrides
- Rating form: number inputs per axis, pre-filled with existing ratings
- BGG-derived axes show auto-populated value with option to override
- "Refresh BGG Data" button
- "Remove Game" button with confirmation

**Files created:**
- `packages/web/app/games/[id]/page.tsx`
- `packages/web/components/score-breakdown.tsx`
- `packages/web/components/rating-form.tsx`

**Verification:** Score breakdown matches the Wingspan example format. Rating form submits successfully. Override display shows BGG original.

#### 5.4 Game search and add

Implement at `packages/web/app/search/page.tsx`.

- Text search field that queries `GET /api/games/search?q={query}` (client component, debounced)
- Results list with name, year, thumbnail
- Click to add (POST /api/games with bggId)
- Manual add form (name only, optional year)
- Duplicate detection: if add returns 409, show the error

**Files created:**
- `packages/web/app/search/page.tsx`
- `packages/web/components/game-search.tsx`

**Verification:** Search returns results. Adding a game navigates to collection. Duplicate shows error.

#### 5.5 Axes management

Implement at `packages/web/app/axes/page.tsx`.

- List all axes with name, weight, source, description
- Create new axis form (name, description, weight)
- Edit axis (inline or modal: weight, description)
- Delete axis with confirmation dialog. The confirmation must show the live count of games that have ratings on this axis (fetched from the API or pre-loaded with the axis list, not hardcoded). The delete flow: user clicks delete -> confirmation dialog shows "This will remove ratings from N games" -> user confirms -> DELETE request -> axis removed.

**Files created:**
- `packages/web/app/axes/page.tsx`
- `packages/web/components/axis-form.tsx`
- `packages/web/components/axis-list.tsx`

**Verification:** CRUD operations work. Delete confirmation shows a live count that matches the number of games with ratings on that axis.

#### 5.6 BGG import with progress

Implement at `packages/web/app/import/page.tsx`.

- Username input field
- Submit triggers POST /api/import/bgg
- Reads SSE stream for progress events
- Shows "Importing 12 of 47..." with game names as they arrive
- Shows error summary at completion
- Navigate to collection when done

**Files created:**
- `packages/web/app/import/page.tsx`
- `packages/web/components/import-progress.tsx`

**Verification:** Import streams progress. Errors displayed. Completion navigates to collection with imported games.

### Review Gate

After Phase 5: visual walkthrough of all screens. Verify score breakdown display matches the spec format. Test the no-BGG-token experience.

**Web UI testing note:** The web UI has no automated unit tests in this plan. This is a deliberate scope decision for MVP: the web UI is thin (display and forms, no business logic) and the daemon API is thoroughly tested. If the project continues past MVP, add component tests with `@testing-library/react` for the score breakdown display and rating form.

**Commission chain:** implement (Dalton) -> review (Thorne) -> fix (Dalton)

---

## Phase 6: CLI

**Goal:** Build the CLI client that discovers operations from the daemon and provides a command-line interface. After this phase, all three interfaces (daemon, web, CLI) are operational.

**Dependencies:** Phase 4 (daemon API complete). Can run in parallel with Phase 5.

**Requirements satisfied:** REQ-MVP-22 (CLI portion), REQ-MVP-23, REQ-MVP-24 (breakdown in CLI)

### Steps

#### 6.1 CLI scaffold and daemon client

Create the CLI entry point and the Unix socket HTTP client.

- `packages/cli/src/client.ts`: HTTP client that communicates with the daemon via Unix socket. Wraps fetch with socket transport.
- `packages/cli/src/index.ts`: entry point. Parses command-line arguments, discovers operations from daemon's `/api/help`, dispatches to appropriate handler.
- Operation discovery: on first run or when `help` is requested, fetch the operation tree from the daemon. Map CLI command paths to API routes.

**Files created:**
- `packages/cli/src/index.ts`
- `packages/cli/src/client.ts`
- `packages/cli/src/output.ts` (table and JSON formatting)
- `packages/cli/src/commands/` (directory)

**Verification:** `shelf-judge help` returns the operation tree from the daemon.

#### 6.2 Game and axis commands

Implement CLI commands that map to daemon API routes:

```
shelf-judge game search "wingspan"
shelf-judge game add --bgg-id 266192
shelf-judge game add --name "Custom Game"
shelf-judge game list
shelf-judge game rate <id> --axis "Wife will play it" 8 --axis "Visual design" 9
shelf-judge game remove <id>
shelf-judge axis list
shelf-judge axis create "Wife will play it" --weight 40
shelf-judge axis update <id> --weight 50
shelf-judge axis delete <id>
```

Default output: human-readable tables. `--json` flag outputs raw JSON on all commands.

**Files created:**
- `packages/cli/src/commands/game.ts`
- `packages/cli/src/commands/axis.ts`
- `packages/cli/tests/commands/game.test.ts`
- `packages/cli/tests/commands/axis.test.ts`

**Tests:**
- Game list outputs table format by default
- Game list with --json outputs valid JSON
- Axis list outputs table with name, weight, source
- Rate command parses multiple --axis flags correctly

**Verification:** Commands execute against running daemon. Table output is readable. JSON output is valid.

#### 6.3 Score commands

Implement score display commands:

```
shelf-judge score list          # Games ranked by fitness
shelf-judge score get <id>      # Full breakdown for one game
```

The score breakdown format must match the design (axis name, rating, weight, contribution, source). This is the same information as the web UI breakdown, in text format.

**Files created:**
- `packages/cli/src/commands/score.ts`
- `packages/cli/tests/commands/score.test.ts`

**Tests:**
- `score list` shows games ranked by fitness with scores
- `score list --json` outputs valid JSON
- `score get <id>` shows full breakdown matching the format from the CLI design
- `score get` for unrated game shows "not yet rated"

**Verification:** CLI output matches the breakdown format in the CLI design document.

#### 6.4 Import and config commands

```
shelf-judge import bgg-collection <username>
shelf-judge config set bgg-token <token>
shelf-judge config get
```

Import reads SSE stream and displays progress in the terminal.

Daemon management:
```
shelf-judge start               # Start daemon in background
shelf-judge stop                # Stop daemon
```

Commands that need the daemon check if it's running. If not, prompt to start.

**Files created:**
- `packages/cli/src/commands/import.ts`
- `packages/cli/src/commands/config.ts`
- `packages/cli/src/commands/daemon.ts`
- `packages/cli/tests/commands/import.test.ts`

**Tests:**
- Import shows progress as games are imported
- Config set stores BGG token
- Config get displays current config
- Daemon start/stop work

**Verification:** Full CLI workflow: start daemon, set token, import collection, list scores.

### Review Gate

After Phase 6: verify all CLI commands against the CLI design document. Test `--json` output on every command (REQ-MVP-23 requires this on all commands, not just list/get). Verify score breakdown matches web UI breakdown.

**`--json` coverage requirement:** Every CLI command must have at least one test asserting that `--json` produces parseable JSON. This includes: `game add`, `game search`, `game list`, `game rate`, `game remove`, `axis create`, `axis list`, `axis update`, `axis delete`, `score list`, `score get`, `import bgg-collection`, `config get`, `config set`.

**Commission chain:** implement (Dalton) -> review (Thorne) -> fix (Dalton)

---

## Phase 7: Integration Verification

**Goal:** End-to-end validation that all three interfaces work together over the same data. Run the manual verification checklist from the spec. This phase produces no new code; it verifies what exists.

**Dependencies:** Phases 5 and 6 complete.

**Requirements verified:** All REQ-MVP-* (full pass)

### Steps

#### 7.1 Automated integration tests

Write integration tests that exercise the full stack: daemon running on a test socket, API calls via HTTP.

**Tests:**
- Add game via API, rate it on 2+ axes, verify score calculation end-to-end
- Create custom axis, rate games, observe score changes
- Import BGG collection (mocked BGG responses), verify games created with BGG data
- Delete axis, verify cascade across all games
- Refresh BGG data, verify overrides preserved
- Start daemon without BGG token, verify manual operations work
- Verify `--json` output on CLI matches API response shapes

**Files created:**
- `packages/daemon/tests/integration/` (full-stack integration tests)

#### 7.2 Manual verification walkthrough

Execute the manual verification checklist from the spec:

- [ ] Add a game by searching BGG, rate it on 2+ axes, see the fitness score with breakdown
- [ ] Create a custom axis, re-rate games, observe score changes
- [ ] Import a BGG collection (10+ games), verify games appear with BGG data populated
- [ ] CLI `shelf-judge score list` shows all games ranked by fitness; `shelf-judge score get <id>` shows the full breakdown
- [ ] Web UI displays score breakdown that matches the math (manually verify one game's arithmetic)
- [ ] Start daemon without BGG token, verify manual game entry and personal scoring work
- [ ] Disconnect from network, verify local operations continue
- [ ] Override a BGG-derived axis rating, trigger refresh, confirm override preserved and original BGG value shown

Document results. Fix any failures before declaring MVP complete.

### Review Gate

Final review: fresh-context sub-agent reads the spec, examines the implementation, and confirms all 24 requirements are satisfied.

**Commission chain:** verify (Thorne) -> fix if needed (Dalton)

---

## Test Strategy

### Unit tests (bun test, mocked dependencies)

Written alongside implementation in every phase. Services receive mock `fileOps`, mock `fetchFn`, mock `storageService`. No real filesystem or network in unit tests.

**Coverage target:** 90%+ on new code (per spec AI validation criteria).

Key unit test areas:
- Fitness score calculation (Phase 2): the mathematical core. Tested against hand-calculated examples.
- BGG XML parsing (Phase 3): tested against captured real API responses, not synthetic XML.
- Input validation (Phase 1): Zod schemas reject invalid data at boundaries.
- Cascade deletion (Phase 2): axis deletion propagates correctly.

### Integration tests (bun test, real Hono app with mock external deps)

Written in Phase 4 for each route module. Use Hono's `app.request()` test client. Services are real; external deps (filesystem, BGG API) are mocked.

Key integration test areas:
- Route → service → storage pipeline (end-to-end data flow)
- Error responses (invalid input, missing resources, BGG unavailable)
- SSE streaming for import

### End-to-end tests (Phase 7)

Daemon running on a test Unix socket. Real HTTP calls. BGG responses mocked at the fetch level.

### Manual verification (Phase 7)

The 8-item checklist from the spec. Requires a real BGG application token and network connectivity for the BGG-dependent items.

---

## Commission Chain Summary

The full build decomposes into 7 phases. Each phase follows the implement -> review -> fix pattern from the commission-chaining compendium. Phases 5 and 6 fan out in parallel after Phase 4's review gate.

```
Phase 1 (scaffold + data model)
  implement (Dalton) -> review (Thorne) -> fix (Dalton)

Phase 2 (fitness engine + services)
  implement (Dalton) -> review (Thorne) -> fix (Dalton)

Phase 3 (BGG integration)
  implement (Dalton) -> review (Thorne) -> fix (Dalton)

Phase 4 (daemon API)
  implement (Dalton) -> review (Thorne) -> fix (Dalton)

Phase 5 (web UI) ─────────────────────┐
  implement (Dalton) -> review (Thorne) -> fix (Dalton)  │  parallel
Phase 6 (CLI) ────────────────────────┘
  implement (Dalton) -> review (Thorne) -> fix (Dalton)

Phase 7 (integration verification)
  verify (Thorne) -> fix if needed (Dalton)
```

Total commissions: 19-21 (7 phases x 3 commissions each, minus potential parallel savings on phases 5/6, plus the final verification pair).

---

## Risk Assessment

### Highest risk: BGG library fitness

The BGG library choice can only be verified at implementation time. If `bgg-xml-api-client` doesn't handle auth tokens correctly, the fallback (custom client with `fast-xml-parser`) adds scope to Phase 3. The three-endpoint surface makes this manageable.

**Mitigation:** Phase 3 starts with a spike: verify the library handles auth before committing to the full implementation. If it fails, switch to custom client immediately.

### Medium risk: SSE streaming on Unix socket

Hono's `streamSSE` over a Unix socket with `Bun.serve()` is a combination that may have edge cases (connection lifecycle, idle timeout, client disconnect handling). The architecture pattern documents the `idleTimeout: 0` workaround.

**Mitigation:** Phase 4.5 includes explicit SSE tests. If SSE over Unix socket is problematic, fall back to polling (POST to start import, GET to check status).

### Medium risk: Next.js proxying to Unix socket

Next.js server components need to call the daemon's Unix socket. `fetch()` in Node.js/Bun supports Unix sockets via the `unix` option, but Next.js's fetch wrapper may not pass it through cleanly.

**Mitigation:** Phase 5.1 validates this immediately. If it doesn't work, use a TCP port for daemon-to-web communication in development, with Unix socket for CLI.

### Low risk: XML parsing edge cases

BGG's XML has known quirks (double-escaped descriptions, averageweight=0 bug). The BGG research documents these.

**Mitigation:** Parse tests use captured real responses, which surface real-world quirks that synthetic XML would miss.

### Ordering rationale

The sequence (data model -> fitness engine -> BGG -> API -> clients) follows the dependency graph strictly. Each phase adds a layer that the next phase consumes. The fitness engine comes before BGG because the core scoring loop must work without BGG data (REQ-MVP-11). BGG integration extends the engine; it doesn't replace it. This ordering also means the riskiest unknown (BGG library fitness) is resolved in Phase 3, before the API and UI layers commit to assumptions about what data is available.

---

## Requirement Traceability Matrix

| Requirement | Phase(s) | Verified By |
|---|---|---|
| REQ-MVP-1 (axis CRUD) | 2.2 | Unit: axis-service.test.ts. Integration: axes route tests. |
| REQ-MVP-2 (rating 1-10) | 2.3, 4.2 | Unit: game-service.test.ts (validation). Integration: rate route tests. |
| REQ-MVP-3 (default BGG axes) | 1.3, 2.1, 3.2 | Unit: storage-service.test.ts (default creation). Fitness: BGG-derived scoring. |
| REQ-MVP-4 (weighted average) | 2.1 | Unit: fitness-service.test.ts (Wingspan example + edge cases). |
| REQ-MVP-5 (score breakdown) | 2.1, 5.3, 6.3 | Unit: fitness-service.test.ts. Web: score-breakdown component. CLI: score get format. |
| REQ-MVP-6 (one decimal place) | 2.1 | Unit: fitness-service.test.ts (rounding boundary tests). |
| REQ-MVP-7 (add by BGG ID/search/manual) | 3.2, 4.2 | Unit: game-service.test.ts. Integration: game route tests. |
| REQ-MVP-8 (remove game) | 2.3, 4.2 | Unit: game-service.test.ts. Integration: delete route test. |
| REQ-MVP-9 (duplicate detection) | 2.3, 4.2 | Unit: game-service.test.ts. Integration: 409 response test. |
| REQ-MVP-10 (BGG collection import) | 3.3, 4.5 | Unit: import.test.ts. Integration: SSE streaming test. |
| REQ-MVP-11 (offline operation) | 3.2, 4.2 | Unit: add-without-BGG test. Manual: start without token, verify local ops. |
| REQ-MVP-12 (missing token message) | 3.1, 4.2 | Unit: bgg-client.test.ts. Integration: 503 response with setup instructions. |
| REQ-MVP-13 (BGG error handling) | 3.1, 3.3 | Unit: bgg-client.test.ts (429, 5xx, malformed XML). Import: partial failure test. |
| REQ-MVP-14 (unrated = no score) | 2.1 | Unit: fitness-service.test.ts (zero rated axes returns null). |
| REQ-MVP-15 (axis deletion cascade) | 2.2 | Unit: axis-service.test.ts (cascade + recount). |
| REQ-MVP-16 (zero-weight handling) | 2.1 | Unit: fitness-service.test.ts (all-zero weights returns null). |
| REQ-MVP-17 (BGG override + preserve) | 2.1, 3.2 | Unit: fitness-service.test.ts (override source). BGG refresh: override preserved. |
| REQ-MVP-18 (7-day cache TTL) | 3.1 | Unit: cache staleness check in bgg-client.test.ts. |
| REQ-MVP-19 (manual refresh) | 3.2, 4.2 | Unit: game-service.test.ts (refresh + override preserve). Integration: refresh route. |
| REQ-MVP-20 (JSON persistence) | 1.3 | Unit: storage-service.test.ts (read/write round-trip). |
| REQ-MVP-21 (atomic writes) | 1.3 | Unit: storage-service.test.ts (temp file + rename sequence). |
| REQ-MVP-22 (three interfaces) | 4, 5, 6 | Integration: all three clients operational. Phase 7 verification. |
| REQ-MVP-23 (CLI --json flag) | 6.2, 6.3, 6.4 | Unit: CLI output tests. Manual: verify on all commands. |
| REQ-MVP-24 (breakdown in both UIs) | 5.3, 6.3 | Web: score-breakdown component. CLI: score get command. Phase 7 comparison. |
