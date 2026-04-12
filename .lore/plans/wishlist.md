---
title: "Implementation plan: wishlist"
date: 2026-04-12
status: draft
tags: [plan, wishlist, search, prediction, curation]
modules: [shared, daemon, web, cli]
related:
  - .lore/specs/wishlist.md
  - .lore/plans/niche-tag-filtering.md
  - .lore/plans/redundancy-scoring.md
  - .lore/designs/mvp-data-model.md
  - .lore/designs/mvp-api-surface.md
---

# Plan: Wishlist

## Goal

Implement the wishlist feature specified in `.lore/specs/wishlist.md` (REQ-WISH-1 through REQ-WISH-29). The wishlist is a lightweight holding pen for games the user is considering but hasn't committed to their collection. It captures BGG identity and a fitness prediction snapshot at time of save, stored in a separate JSON file, accessed through new daemon API endpoints, and surfaced in both web UI and CLI.

The feature reuses the existing `predictBggGame` codepath for prediction snapshots and follows the established settings storage pattern for persistence. The web UI adds a "Wishlist" button to the search page and a dedicated `/wishlist` page. The sidebar gains a new nav entry between Collection and Add Games.

## Codebase Context

### Prediction Codepath (reused for wishlist add/refresh)

`PredictionService.predictBggGame(bggId)` at `prediction-service.ts:220-299`:

- Fetches BGG data via `bggClient.getGame(bggId)`
- Builds a temporary `Game` object (ID: `preview-{bggId}`, not persisted)
- Runs `computePredictedFitness` against the collection's vocabulary, ranges, and axes
- Returns `PredictedGameResult` with `game`, `score` (FitnessResult), `tension`, `predictionUnavailable`

The wishlist add flow calls this same method, extracts the fields defined by `WishlistEntry`, and persists them. The `predictBggGame` codepath already handles Stage 0 (returns `predictionUnavailable` with null prediction fields), which maps directly to REQ-WISH-5's null-prediction case.

Niche impact computation happens in `routes/prediction.ts:70-73`: after `predictBggGame`, the route loads niche settings, loads all games, and calls `computeNicheImpact`. The wishlist add flow needs this same niche impact computation for the `nicheImpact` snapshot.

### Storage Pattern (settings files)

Three settings files follow identical patterns:

1. Shared type in `types.ts` (e.g., `PredictionSettings` at line 401)
2. Default constant in the engine module (e.g., `DEFAULT_PREDICTION_SETTINGS` in `prediction-engine.ts`)
3. Storage interface methods (`loadX`/`saveX` on `StorageService`, lines 30-35)
4. Implementation: file path in data dir, return defaults when missing, `atomicWrite` on save

The wishlist file (`wishlist.json`) follows this pattern for the file I/O but stores an array of entries rather than a settings object. The load/save methods are `loadWishlist()`/`saveWishlist()`.

### Add-Game Flow (REQ-WISH-10 auto-removal)

`GameService.addGame()` at `game-service.ts:98-138`:

- Parses input, checks for duplicate `bggId`
- Fetches BGG data if `bggId` provided
- Creates `Game` object, saves collection

The auto-removal of wishlisted games on collection add (REQ-WISH-10) should be handled at the route level (`routes/games.ts`, POST /games handler at line 60). After the game service successfully adds the game, the route handler loads the wishlist, checks for a matching `bggId`, removes the entry if found, and saves. This keeps the game service unaware of the wishlist (separation of concerns) and matches how niche computation is handled in routes rather than services.

### Search Page (web, wishlist button integration)

`packages/web/app/search/page.tsx` (445 lines, client component):

- State: `query`, `results` (BggSearchResult[]), `previews` (Record<number, PreviewState>), `adding`, `error`
- Each result row has `search-result-actions` div with Preview and Add buttons (lines 354-377)
- No current wishlist awareness

Per REQ-WISH-18/19, the search page needs:

1. On mount, fetch `GET /api/wishlist` to populate a `Set<number>` of wishlisted BGG IDs
2. For each result, show a Wishlist button alongside Add (with "Wishlisted" state if BGG ID is in the set)
3. Optimistic update on wishlist add

### Sidebar Navigation (REQ-WISH-24)

`packages/web/components/sidebar.tsx:17-92` defines `navGroups` as a static array. The "Library" group (line 32) contains Collection and Add Games. The wishlist nav item goes between them, matching the mockup's nav structure.

### Dark Mode System

`packages/web/app/globals.css` defines CSS custom properties in `:root` (light) and `[data-theme="dark"]` (dark override, starting at line 136). Components use `var(--token)` references exclusively. The pattern for new pages: use existing tokens (`--bg-surface`, `--bg-subtle`, `--border`, `--text-primary`, etc.) and add new semantic tokens only when needed. The wishlist page's visual elements (score display, confidence badges, niche impact) already have tokens from the search preview and game detail pages. New tokens are needed only for wishlist-specific accents (the mockup uses `--action` and `--danger` patterns already in the system).

### CLI Command Pattern

Commands at `packages/cli/src/commands/`. Each file exports async functions taking `(client: DaemonClient, args: string[], opts: OutputOptions)`, returning formatted strings. The niche commands (`niche.ts`, 96 lines) are the closest pattern: `nicheIgnored`, `nicheIgnore`, `nicheUnignore`, each calling a daemon endpoint and formatting output.

## Implementation Steps

### Phase 1: Shared Types

**Files**: `packages/shared/src/types.ts`
**Depends on**: nothing
**Covers**: REQ-WISH-1, REQ-WISH-2

Add after the redundancy types (line 511):

```typescript
// Wishlist types (wishlist spec)

export interface WishlistBreakdownEntry {
  axisName: string;
  rating: number;
  confidence: PredictionConfidence;
}

export interface WishlistEntry {
  id: string; // UUID
  bggId: number;
  name: string;
  yearPublished: number | null;
  thumbnailUrl: string | null;
  predictedScore: number | null;
  predictionConfidence: PredictionConfidence | null;
  predictedBreakdown: WishlistBreakdownEntry[] | null;
  nicheImpact: NicheImpact | null;
  addedAt: string; // ISO 8601
}
```

Export both types.

**Verification**: `bun run typecheck` passes.

### Phase 2: Storage Layer

**Files**: `packages/daemon/src/services/storage-service.ts`
**Depends on**: Phase 1 (types exist)
**Covers**: REQ-WISH-13, REQ-WISH-14

**2a: Storage interface.** Add to `StorageService` interface (after `saveRedundancySettings` at line 35):

```typescript
loadWishlist(): Promise<WishlistEntry[]>;
saveWishlist(entries: WishlistEntry[]): Promise<void>;
```

**2b: Storage implementation.** In `createStorageService()`, add methods following the settings pattern:

- File: `wishlist.json` in the data directory
- Load returns `[]` when file doesn't exist (empty wishlist is an empty array, no default constant needed)
- Save writes full array via `atomicWrite`

Import `WishlistEntry` from `@shelf-judge/shared`.

**Verification**: Unit test: `loadWishlist()` returns `[]` when no file exists. `saveWishlist([entry])` writes and subsequent load returns the saved entry. Atomic write behavior matches other storage methods.

### Phase 3: Wishlist Service

**Files**: new file `packages/daemon/src/services/wishlist-service.ts`
**Depends on**: Phase 1 (types), Phase 2 (storage)
**Covers**: REQ-WISH-3, REQ-WISH-4, REQ-WISH-5, REQ-WISH-6, REQ-WISH-7, REQ-WISH-8, REQ-WISH-9, REQ-WISH-11, REQ-WISH-12, REQ-WISH-28, REQ-WISH-29

The wishlist has enough logic (duplicate checking, prediction snapshot extraction, refresh orchestration) that a service layer is warranted. This mirrors how `GameService` wraps storage + business logic, rather than putting all logic in route handlers.

**3a: Interface.**

```typescript
export interface WishlistService {
  list(): Promise<WishlistEntry[]>;
  add(bggId: number): Promise<WishlistEntry>;
  remove(id: string): Promise<void>;
  clear(): Promise<number>;
  refresh(id: string): Promise<WishlistEntry>;
  refreshAll(): Promise<{ refreshed: number; errors: string[] }>;
  removeByBggId(bggId: number): Promise<boolean>;
}

export interface WishlistServiceDeps {
  storageService: StorageService;
  predictionService: PredictionService;
  gameService: GameService;
  bggClient?: BggClient;
}
```

**3b: `add(bggId)` implementation.** This is the core logic:

1. Load current wishlist. Check if `bggId` already exists. If so, throw: "This game is already on your wishlist" (REQ-WISH-3).
2. Load collection via `storageService.loadCollection()`. Check if any game has this `bggId`. If so, throw: "This game is already in your collection" (REQ-WISH-6).
3. Call `predictionService.predictBggGame(bggId)` to get prediction data. This fetches BGG data, runs the prediction engine, and returns a temporary `Game` with `FitnessResult`.
4. Compute niche impact: load all games via `predictionService.listGamesWithPredictions()`, load niche settings, call `computeNicheImpact(allGames, result.game, result.score, nicheSettings)`.
5. Build `WishlistEntry` from the result:
   - `id`: `uuidv4()`
   - `bggId`: from input
   - `name`: from `result.game.name`
   - `yearPublished`: from `result.game.yearPublished`
   - `thumbnailUrl`: from `result.game.imageUrl`
   - `predictedScore`: `result.predictionUnavailable ? null : result.score.score`
   - `predictionConfidence`: `result.score.predictionMeta?.confidence ?? null`
   - `predictedBreakdown`: extract from `result.score.breakdown`, mapping each entry to `{ axisName, rating, confidence }` (only entries where `rating !== null`). Null if `predictionUnavailable`.
   - `nicheImpact`: from computed niche impact. Null if no entries.
   - `addedAt`: `new Date().toISOString()`
6. Append to wishlist, save.

**3c: `refresh(id)` implementation.** Same prediction + niche impact computation as `add`, but updates the existing entry in place. The `addedAt` timestamp does not change (REQ-WISH-11). The `bggId` from the existing entry is used to re-call `predictBggGame`.

**3d: `refreshAll()` implementation.** Iterates all entries sequentially, calling `refresh` for each. Collects errors per entry (game name + error message). Returns count of successfully refreshed entries and error list (REQ-WISH-12).

**3e: `removeByBggId(bggId)` implementation.** Used by the auto-removal flow (REQ-WISH-10). Loads wishlist, finds entry with matching `bggId`, removes it if found, saves, returns whether an entry was removed.

**Verification**: Unit tests covering:

- Add creates entry with correct fields from prediction
- Add with null prediction (Stage 0) creates entry with null prediction fields
- Add rejects duplicate `bggId` in wishlist (409)
- Add rejects `bggId` already in collection (409)
- Remove deletes entry by ID
- Clear removes all entries, returns count
- Refresh updates prediction fields without changing `addedAt`
- `removeByBggId` finds and removes matching entry

### Phase 4: Daemon Routes

**Files**: new file `packages/daemon/src/routes/wishlist.ts`, `packages/daemon/src/routes/games.ts`, `packages/daemon/src/app.ts`
**Depends on**: Phase 3 (wishlist service)
**Covers**: REQ-WISH-10, REQ-WISH-15, REQ-WISH-16, REQ-WISH-17

**4a: Route module.** Create `packages/daemon/src/routes/wishlist.ts`:

```typescript
export interface WishlistRoutesDeps {
  wishlistService: WishlistService;
}
```

Endpoints following the spec's API table (REQ-WISH-15, REQ-WISH-16):

- `GET /wishlist` returns `WishlistEntry[]` sorted by `addedAt` descending
- `POST /wishlist` accepts `{ bggId: number }`, validates body, calls `wishlistService.add(bggId)`, returns `{ entry }` with 201. Catches known errors for 409 responses.
- `DELETE /wishlist/:id` calls `wishlistService.remove(id)`, returns `{ removed: true }`. 404 if not found.
- `DELETE /wishlist` calls `wishlistService.clear()`, returns `{ removed: count }`.
- `POST /wishlist/:id/refresh` calls `wishlistService.refresh(id)`, returns `{ entry }`. 404 if not found.
- `POST /wishlist/refresh` calls `wishlistService.refreshAll()`, returns `{ refreshed, errors }`.

Note on path ordering: `POST /wishlist/refresh` must be registered before `POST /wishlist/:id/refresh` to avoid "refresh" being parsed as an `:id`. This is the same pattern used in `games.ts` where `POST /games/refresh` precedes `POST /games/:id/refresh` (lines 207-238).

**4b: Auto-removal in game routes.** In `routes/games.ts`, POST /games handler (line 60), after `gameService.addGame(parsed.data)` succeeds:

```typescript
// REQ-WISH-10: remove matching wishlist entry when game is added to collection
if (parsed.data.bggId && wishlistService) {
  await wishlistService.removeByBggId(parsed.data.bggId);
}
```

Add `wishlistService?: WishlistService` to `GameRoutesDeps` (line 11). The `?` makes it optional so existing tests don't break.

**4c: Register routes in app.ts.** Import `createWishlistRoutes`, create `WishlistService` in the app wiring, pass to both wishlist routes and game routes:

```typescript
const wishlistService = createWishlistService({
  storageService,
  predictionService,
  gameService,
  bggClient,
});
const wishlistRouteModule = createWishlistRoutes({ wishlistService });
```

Wire: `app.route("/api", wishlistRouteModule.routes)`.

Update `createGameRoutes` call to include `wishlistService`.

**4d: Operation definitions.** Add `OperationDefinition[]` for the six endpoints with `hierarchy: { root: "shelf", feature: "wishlist" }`.

**Verification**: Route tests in new file `packages/daemon/tests/wishlist-routes.test.ts`:

- GET returns empty array when no wishlist exists
- POST creates entry and returns 201
- POST with duplicate bggId returns 409
- POST with bggId already in collection returns 409
- DELETE /:id removes entry, returns `{ removed: true }`
- DELETE /:id with nonexistent ID returns 404
- DELETE / clears all, returns count
- POST /:id/refresh updates prediction fields
- POST /refresh refreshes all entries
- GET returns entries sorted by addedAt descending
- Adding a game to collection (POST /games) auto-removes matching wishlist entry

### Phase 5: Web Client Helpers

**Files**: `packages/web/lib/api.ts`
**Depends on**: Phase 4 (routes exist)
**Covers**: part of REQ-WISH-18, REQ-WISH-19

Add after the niche settings helpers (line 271):

```typescript
import type { WishlistEntry } from "@shelf-judge/shared";

export async function listWishlist(): Promise<WishlistEntry[]> {
  return daemonJson("/api/wishlist");
}

export async function addToWishlist(bggId: number): Promise<{ entry: WishlistEntry }> {
  return daemonJson("/api/wishlist", {
    method: "POST",
    body: { bggId },
  });
}

export async function removeFromWishlist(id: string): Promise<{ removed: boolean }> {
  return daemonJson(`/api/wishlist/${id}`, { method: "DELETE" });
}

export async function clearWishlist(): Promise<{ removed: number }> {
  return daemonJson("/api/wishlist", { method: "DELETE" });
}

export async function refreshWishlistEntry(id: string): Promise<{ entry: WishlistEntry }> {
  return daemonJson(`/api/wishlist/${id}/refresh`, { method: "POST" });
}

export async function refreshAllWishlist(): Promise<{ refreshed: number; errors: string[] }> {
  return daemonJson("/api/wishlist/refresh", { method: "POST" });
}
```

Add `WishlistEntry`, `WishlistBreakdownEntry` to the type re-exports (line 274-293).

**Verification**: Typecheck passes.

### Phase 6: Web UI, Search Page Wishlist Button

**Files**: `packages/web/app/search/page.tsx`
**Depends on**: Phase 5 (client helpers)
**Covers**: REQ-WISH-18, REQ-WISH-19

**6a: Wishlist state on mount.** Add state for wishlisted BGG IDs:

```typescript
const [wishlistedIds, setWishlistedIds] = useState<Set<number>>(new Set());
const [wishlisting, setWishlisting] = useState<number | null>(null);
```

Add a `useEffect` that fetches `GET /api/daemon/wishlist` on mount and populates `wishlistedIds` from the response (mapping `entry.bggId` to a Set).

**6b: Wishlist button per result.** In the `search-result-actions` div (between Preview and Add buttons, matching the mockup layout), add a Wishlist button:

- Default state: `btn btn-wishlist btn-sm` with "Wishlist" text and the circle-plus SVG icon from the mockup
- Wishlisted state: `btn btn-wishlisted btn-sm` with "Wishlisted" text and checkmark SVG icon
- Loading state: disabled with "..." text

On click, call `POST /api/daemon/wishlist` with `{ bggId }`. On success, optimistically add the bggId to `wishlistedIds`. On 409 (already wishlisted or in collection), show error in the existing error banner.

**6c: CSS classes.** Add to `globals.css` (or the search page's styles section):

```css
.btn-wishlist {
  background: transparent;
  border: 1px solid var(--action-border);
  color: var(--action);
}
.btn-wishlist:hover {
  background: var(--action-subtle);
}
.btn-wishlisted {
  background: var(--score-high-bg);
  border: 1px solid color-mix(in hsl, var(--score-high), white 75%);
  color: var(--score-high);
  font-weight: 500;
}
```

These use existing tokens and automatically adapt to dark mode because `--action-border`, `--action-subtle`, `--score-high`, and `--score-high-bg` are all redefined in the dark theme block.

**Verification**: Manual verification per the spec's criteria. Search a game, click Wishlist, verify button changes to "Wishlisted". Re-search the same game, verify button shows "Wishlisted" from the start.

### Phase 7: Web UI, Wishlist Page

**Files**: new file `packages/web/app/wishlist/page.tsx`, `packages/web/app/globals.css`
**Depends on**: Phase 5 (client helpers)
**Covers**: REQ-WISH-20, REQ-WISH-21, REQ-WISH-22, REQ-WISH-23

This is the largest web UI phase. The mockup at `.lore/mockups/mockup-wishlist.html` defines the visual design precisely.

**7a: Page component.** Create `packages/web/app/wishlist/page.tsx` as a client component (needs interactivity for sort, expand/collapse, refresh, remove).

Structure from the mockup:

- Topbar: "Wishlist" title, game count, sort widget, "Refresh All" button
- Content: list of wishlist cards

**7b: Sort controls.** Three sort options (REQ-WISH-21):

- Date Added (default, newest first)
- Predicted Score (descending, nulls last)
- Name (alphabetical)

Use a dropdown or toggle widget matching the collection page's sort pattern.

**7c: Wishlist card component.** Each card follows the mockup's `wishlist-card` structure:

Main row (`wc-main`):

- Thumbnail (60x60, `wc-thumb`)
- Info section: name, year, score row (tilde prefix + score + confidence badge), "Added [date]"
- Actions column: "Add to Collection" primary button, "Refresh" ghost button, "Remove" danger-ghost button

Expand section (`wc-expand`):

- Toggle button: "Per-axis breakdown" with caret and axis count
- Expanded content: axis breakdown rows (name, rating, confidence badge per axis)
- Niche impact panel (if `nicheImpact` is non-null and has entries)

Null prediction state: when `predictedScore` is null, show "No prediction" message with "Refresh to check again" link (per the mockup's Spirit Island card).

**7d: "Add to Collection" button.** Calls `POST /api/daemon/games` with `{ bggId }` (same as search page Add). On success, the entry disappears from the wishlist (auto-removal via REQ-WISH-10) and the user is navigated to `/games/{newGameId}` (REQ-WISH-23). Use `router.push()`.

**7e: "Remove" button.** Calls `DELETE /api/daemon/wishlist/{id}`. On success, removes the card from the local state. No confirmation needed (REQ-WISH-8).

**7f: "Refresh" button.** Calls `POST /api/daemon/wishlist/{id}/refresh`. On success, updates the card's prediction data in local state. Show a loading state on the button during the request.

**7g: "Refresh All" button.** Calls `POST /api/daemon/wishlist/refresh`. During refresh, refetch the full wishlist to update all cards (REQ-WISH-22). Show loading state on the button.

**7h: "Clear All" button.** The spec mentions this (REQ-WISH-9) but the mockup doesn't show it prominently. Add it as a subtle link or secondary button below the list, with a confirmation prompt: "Remove all N wishlisted games?"

**7i: Empty state.** When the wishlist is empty, show a centered message: "No wishlisted games" with a link to the search page ("Browse games to add to your wishlist").

**7j: Dark mode.** All new CSS uses existing design tokens (`--bg-surface`, `--bg-subtle`, `--border`, `--predict-accent`, `--conf-*`, `--niche-*`, `--action`, `--danger`). No new dark mode overrides needed because the tokens are already redefined in the `[data-theme="dark"]` block. The page must be verified in both light and dark mode during manual testing.

**7k: CSS additions.** Add wishlist-specific classes to `globals.css`:

```css
/* Wishlist card styles */
.wishlist-card { ... }
.wc-main { ... }
.wc-thumb { ... }
.wc-info { ... }
.wc-score-row { ... }
.wc-score { ... }
.wc-actions { ... }
.wc-expand { ... }
.wc-expand-toggle { ... }
.wc-breakdown { ... }
/* etc. */
```

Reference the mockup HTML for exact property values. Use `var()` references for all colors.

**Verification**: Manual verification against the spec and mockup. All four card states from the mockup must render correctly: strong confidence with expanded breakdown, moderate confidence collapsed, weak confidence collapsed, and null prediction.

### Phase 8: Sidebar Navigation

**Files**: `packages/web/components/sidebar.tsx`
**Depends on**: Phase 7 (wishlist page exists to navigate to)
**Covers**: REQ-WISH-24

In `sidebar.tsx`, update the `navGroups` array. In the "Library" group (line 32), insert the Wishlist item between Collection and Add Games:

```typescript
{
  href: "/wishlist",
  name: "Wishlist",
  icon: (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3 2h10a1 1 0 011 1v11l-2-1.5L10 14l-2-1.5L6 14l-2-1.5L2 14V3a1 1 0 011-1zm1 3v1h8V5H4zm0 3v1h8V8H4zm0 3v1h5v-1H4z" />
    </svg>
  ),
},
```

The SVG is the list/receipt icon from the wishlist mockup's sidebar. The mockup uses a different icon than the search page's circle-plus, which is correct because the wishlist page is about reviewing saved candidates, not adding new ones.

**Verification**: Sidebar shows Collection, Wishlist, Add Games in that order. Wishlist link highlights when on `/wishlist`.

### Phase 9: CLI Commands

**Files**: new file `packages/cli/src/commands/wishlist.ts`, CLI command registry
**Depends on**: Phase 4 (routes exist)
**Covers**: REQ-WISH-25, REQ-WISH-26, REQ-WISH-27

**9a: Command implementations.** Create `packages/cli/src/commands/wishlist.ts` following the niche command pattern:

```typescript
// wishlistList: GET /api/wishlist
// Text output: table with Name, Year, Score, Confidence, Added columns
// JSON output: full WishlistEntry[]

// wishlistAdd: POST /api/wishlist with { bggId: parsed from args[0] }
// Text output: "Added [name] (predicted: X.X)" or "Added [name] (no prediction)"
// JSON output: full WishlistEntry

// wishlistRemove: DELETE /api/wishlist/:id
// Text output: "Removed."
// JSON output: { removed: true }

// wishlistClear: DELETE /api/wishlist (with confirmation prompt)
// Text output: "Removed N entries."
// JSON output: { removed: N }

// wishlistRefresh: POST /api/wishlist/:id/refresh or POST /api/wishlist/refresh
// If args[0] provided, refresh single entry. Otherwise refresh all.
// Text output: "Refreshed [name]: X.X" or "Refreshed N entries (M errors)"
// JSON output: full response
```

**9b: Register commands.** Add the `wishlist` command group to the CLI's command registry, matching how `niche` is registered. Subcommands: `list`, `add`, `remove`, `clear`, `refresh`.

**Verification**: CLI commands work against a running daemon. `--json` mode returns well-formed JSON.

### Phase 10: Tests

**Files**: `packages/daemon/tests/wishlist-service.test.ts` (new), `packages/daemon/tests/wishlist-routes.test.ts` (new or expanded from Phase 4)
**Depends on**: Phases 1-4
**Covers**: All success criteria from the spec

Consolidating test expectations from the spec's automated test list:

**Service-level tests** (`wishlist-service.test.ts`):

- Adding a game by BGG ID creates entry with correct fields (name, year, thumbnail, prediction, confidence, breakdown, nicheImpact, addedAt)
- Adding with Stage 0 prediction creates entry with null prediction fields
- Adding duplicate bggId (already in wishlist) throws with "already on your wishlist"
- Adding bggId already in collection throws with "already in your collection"
- Removing by ID deletes from storage
- Clearing removes all, returns count
- Refresh updates predictedScore/confidence/breakdown/nicheImpact without changing addedAt
- `removeByBggId` finds and removes, returns true. Returns false when not found.

**Route-level tests** (`wishlist-routes.test.ts`):

- GET returns entries sorted by addedAt descending
- POST returns 201 with entry
- POST duplicate returns 409
- POST in-collection returns 409
- DELETE /:id returns `{ removed: true }`
- DELETE /:id with bad ID returns 404
- DELETE / returns `{ removed: count }`
- POST /:id/refresh returns updated entry
- POST /refresh returns `{ refreshed, errors }`
- Wishlist entries do not appear in GET /games
- Wishlist entries do not affect profile computation
- Adding a game to collection auto-removes matching wishlist entry

Tests use dependency injection for `BggClient` and `PredictionService` to avoid network calls. Hand-craft BGG XML fixtures or use the existing test helpers.

**Verification**: `bun test packages/daemon/tests/wishlist-` passes with 90%+ coverage on new code.

### Phase 11: Validate

Launch a fresh-context sub-agent that:

1. Reads the spec (`.lore/specs/wishlist.md`) and this plan
2. Reviews the implementation across all packages
3. Verifies all six wishlist API endpoints are implemented and tested
4. Verifies both web client helpers (Phase 5) and CLI commands (Phase 9) cover all endpoints (client/daemon divergence lesson)
5. Verifies POST /games auto-removes matching wishlist entries (REQ-WISH-10)
6. Verifies wishlist operations do not trigger profile dirty flag or niche recomputation (REQ-WISH-28)
7. Verifies the search page wishlist button works in both "not wishlisted" and "already wishlisted" states (REQ-WISH-18/19)
8. Verifies the wishlist page renders correctly in both light and dark mode
9. Verifies sidebar navigation order: Collection, Wishlist, Add Games (REQ-WISH-24)
10. Runs `bun run test`, `bun run typecheck`, `bun run lint`

## Delegation Guide

**Phases 1-4** (types, storage, service, routes): Sequential, single implementer. Straightforward backend work following established patterns. Phase 3 is the meatiest (wishlist service with prediction snapshot extraction), but the logic is mostly "call predictBggGame, copy fields to WishlistEntry." Phase 4b (auto-removal in game routes) is a small but critical integration point; the reviewer should verify it.

**Phase 5** (web helpers): Trivial, can be done as part of Phase 4 or Phase 6.

**Phase 6** (search page wishlist button): Can run after Phase 5 completes. Moderate complexity. The wishlist state management (mount-time fetch + optimistic update) is the main new pattern. Frontend awareness helpful.

**Phase 7** (wishlist page): Can run in parallel with Phase 6 after Phase 5 completes. This is the largest phase. The mockup is detailed enough that the implementer should reproduce it faithfully. Frontend awareness required. Dark mode must use existing tokens.

**Phase 8** (sidebar navigation): Trivial, one line insertion. Can be done as part of Phase 7 or independently.

**Phase 9** (CLI): Can run in parallel with Phases 6-8 after Phase 4 completes. Simple command registration and output formatting.

**Phase 10** (tests): Service and route tests should be written alongside Phases 3 and 4. Listed separately for completeness. If the implementer follows the project's "tests alongside implementation" practice, Phase 10 is already done by the time Phase 4 finishes.

**Phase 11** (validation): Fresh-context sub-agent. Must run after all other phases. This is the gate.

**Parallelization opportunity**: After Phases 1-5 complete (the backend + client helpers), three streams can run in parallel:

- Stream A: Phase 6 (search button) + Phase 8 (sidebar)
- Stream B: Phase 7 (wishlist page)
- Stream C: Phase 9 (CLI)

In practice, these touch different files and have no conflicts. A single implementer doing them sequentially is also fine given the bounded scope.

**Review attention points:**

- **Phase 3b** (add flow): The prediction snapshot extraction is the trickiest part. Verify that the mapping from `PredictedGameResult` + `NicheImpact` to `WishlistEntry` covers all fields correctly, especially the null cases (Stage 0, no niche impact).
- **Phase 4b** (auto-removal): This modifies `routes/games.ts`, which is a high-traffic file. Verify the wishlist removal is fire-and-forget (doesn't block or error if wishlist removal fails) and only triggers when `bggId` is present.
- **Phase 6** (search page): The wishlist fetch on mount is a new network request on every search page load. Verify it doesn't block search result display (fetch in parallel with search, not sequentially).
- **Phase 7** (wishlist page): The "Add to Collection" flow must navigate to the new game's detail page after success. This requires extracting the new game ID from the `POST /api/games` response. Verify the response shape is handled correctly.

## Open Questions

1. **Wishlist count in sidebar.** The mockup shows "4 games" in the topbar but doesn't show a count badge on the sidebar nav item. Should the sidebar show a count badge (e.g., "Wishlist (4)")? The simplest approach: no badge. The topbar on the wishlist page shows the count. Adding a badge would require the sidebar (a server component) to fetch wishlist data on every page load, which is a cost for marginal value. Defer to user feedback.

2. **Refresh error handling granularity.** REQ-WISH-12 says "the response reports how many entries were refreshed and any errors." The current design collects error strings per entry. Should the web UI show individual error messages, or just a summary ("3 of 4 refreshed, 1 error")? The mockup doesn't show an error state. Decision: show a summary toast/banner. Individual errors are available in the `errors` array for `--json` CLI output.

3. **Web proxy route.** The web frontend uses `/api/daemon/[...path]` as a proxy to the daemon. Verify that this proxy handles all HTTP methods (GET, POST, DELETE) used by wishlist endpoints. If the proxy only handles GET/POST, DELETE requests will fail silently. Check `packages/web/app/api/daemon/[...path]/route.ts` during implementation.
