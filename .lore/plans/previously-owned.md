---
title: "Implementation plan: previously owned"
date: 2026-04-12
status: approved
tags: [plan, ownership, data-model, redundancy, niche, collection, lifecycle]
modules: [shared, daemon, web, cli]
related:
  - .lore/specs/previously-owned.md
  - .lore/brainstorms/previously-owned-state.md
  - .lore/plans/wishlist.md
  - .lore/designs/mvp-data-model.md
  - .lore/designs/mvp-api-surface.md
  - .lore/mockups/mockup-previously-owned-collection.html
  - .lore/mockups/mockup-previously-owned-game-detail.html
---

# Plan: Previously Owned

## Goal

Implement the previously-owned feature specified in `.lore/specs/previously-owned.md` (REQ-PREV-1 through REQ-PREV-32). A game marked as previously owned keeps all its data (ratings, BGG data, tournament history) but stops affecting redundancy and niche computations. The shelf reflects what's physically there; preferences reflect everything the user has played.

The feature spans four layers: shared types (the `ownership` field), daemon API (new endpoint + query parameter filtering + call-site filtering for redundancy/niche), web UI (collection toggle, game detail status actions, visual distinction), and CLI (new command + flag).

## Codebase Context

### Game Type and Creation

`Game` is defined at `types.ts:47-61`. It has no `ownership` field. `createGameService` at `game-service.ts:78` builds games in `addGame` (lines 98-144), setting every field explicitly. The `addGame` implementation constructs the `Game` object inline (lines 111-125) without spreading a default, so the new `ownership` field needs an explicit assignment there.

### Route Handler: GET /games

`routes/games.ts:158-211` handles `GET /games`. The route has two paths: `includePredicted=true` (calls `predictionService.listGamesWithPredictions()`) and the default (calls `gameService.listGames()`). Both paths compute niches via `computeNichePositions` and redundancy via `applyRedundancy`. The ownership filter must be applied before both computations. The route currently has no `ownership` query parameter.

### Route Handler: GET /games/:id

`routes/games.ts:213-255` fetches a single game. It computes niche and redundancy for that game against the full collection. Per REQ-PREV-18, this endpoint returns the game regardless of ownership. Per REQ-PREV-19, niche/redundancy computation always uses the owned-only set.

### Redundancy and Niche Engines

`computeRedundancyAdjustments` at `redundancy-engine.ts` takes `GameWithScore[]`. `computeNichePositions` at `niche-engine.ts` takes `GameWithScore[]`. Both are pure functions. The spec requires filtering at call sites (REQ-PREV-8, REQ-PREV-9), not inside the engines. The `applyRedundancy` helper at `routes/games.ts:57-92` is the consolidation point for redundancy computation.

### Wishlist Duplicate Check

`wishlist-service.ts:80-82` checks if a game is already in the collection by scanning `collection.games.some(g => g.bggId === bggId)`. This check currently finds all games regardless of ownership status. Per REQ-PREV-31, this is correct: previously-owned games are still in the collection and must not be wishlistable. No change needed here.

### Web Proxy

`app/api/daemon/[...path]/route.ts` already exports handlers for GET, POST, PUT, PATCH, and DELETE. The new `PATCH /api/games/:id/ownership` endpoint will work through the existing proxy without modification (REQ-PREV-26).

### Collection Page

`app/collection/page.tsx` is a server component. It fetches `listGames()` and passes the result to `CollectionTable`. The collection page will need to become ownership-aware: fetching with the `ownership` query parameter and passing previously-owned count to the filter UI.

### Game Detail Page

`app/games/[id]/page.tsx` is a server component. It fetches `getGame(id)` and renders the hero section, score breakdown, rating form, and `GameActions` component. The page will need the status badge, annotation panel, and ownership toggle action.

### CLI Game Commands

`packages/cli/src/commands/game.ts` exports `gameSearch`, `gameAdd`, `gameList`, `gameRate`, `gameRemove`. The `gameList` function calls `GET /games` without query parameters. The new `set-status` subcommand and `--ownership` flag follow the same pattern as existing commands.

## Implementation Steps

### Phase 1: Shared Types and Schema Default

**Files**: `packages/shared/src/types.ts`
**Depends on**: nothing
**Covers**: REQ-PREV-1, REQ-PREV-2, REQ-PREV-3

Add the `OwnershipStatus` type and the `ownership` field to `Game`:

```typescript
export type OwnershipStatus = "owned" | "previously-owned";

// In the Game interface, add after numPlays:
ownership: OwnershipStatus;
```

The Zod schema for `Game` (if one exists for parsing stored data) needs `.default("owned")` on the `ownership` field. If the project relies on TypeScript types without runtime Zod validation of stored games, the default must be applied at load time in the storage service instead. Check `storageService.loadCollection()` for how games are deserialized.

The `addGame` implementation in `game-service.ts:111-125` must set `ownership: "owned"` in the new game object.

**Verification**: `bun run typecheck` passes. Existing tests pass (the new field has a sensible default everywhere it's constructed).

**Tests**:

- A game created via `addGame` has `ownership: "owned"`
- A game object without `ownership` (simulating legacy data) is assigned `"owned"` at parse time

### Phase 2: Daemon API (Ownership Endpoint + Query Filter)

**Files**: `packages/daemon/src/routes/games.ts`, `packages/daemon/src/services/game-service.ts`
**Depends on**: Phase 1
**Covers**: REQ-PREV-4, REQ-PREV-5, REQ-PREV-6, REQ-PREV-7, REQ-PREV-14, REQ-PREV-15, REQ-PREV-16, REQ-PREV-17, REQ-PREV-18

**2a: Game service method.** Add a `setOwnership(id: string, ownership: OwnershipStatus): Promise<Game>` method to the `GameService` interface and implementation. The method:

1. Loads the collection
2. Finds the game by ID (404 if not found)
3. If the new status matches the current status, returns the game unchanged (no `updatedAt` bump)
4. Sets `game.ownership = ownership` and `game.updatedAt = new Date().toISOString()`
5. Saves the collection
6. Returns the updated game

**2b: PATCH endpoint.** Add `PATCH /games/:id/ownership` to `routes/games.ts`. Register it after `DELETE /games/:id` (path specificity is not a concern since the HTTP method differs). Parse the request body with a Zod schema:

```typescript
const OwnershipBodySchema = z.object({
  ownership: z.enum(["owned", "previously-owned"]),
});
```

Return shapes per REQ-PREV-15: `{ game }` on success, `{ error }` on 400/404.

**2c: Query parameter on GET /games.** Add `ownership` query parameter handling to the `GET /games` handler at `routes/games.ts:158`. Valid values: `"owned"`, `"previously-owned"`, `"all"`. Default: `"owned"`.

The filter logic:

1. `gameService.listGames()` returns all games (it always has)
2. After getting the full list, filter by ownership based on the query parameter
3. Compute the owned-only subset for niche/redundancy regardless of the query parameter (REQ-PREV-19)
4. Apply niche positions and redundancy to owned games only
5. For previously-owned games in the response (when `ownership=all`), leave `nichePosition: null` and `redundancyAdjustment: null`

The same filter-before-compute pattern applies to the `includePredicted=true` path.

**2d: GET /games/:id unchanged.** Per REQ-PREV-18, this endpoint returns any game regardless of ownership. Per REQ-PREV-19, niche and redundancy are computed against owned-only games. The existing code at lines 220-244 already computes against `allGames` from `predictionService.listGamesWithPredictions()`. The owned-only filter must be applied to this set before passing to `computeNichePositions` and `applyRedundancy`. For a previously-owned game, the result will naturally have `nichePosition: null` (it won't appear in the nicheMap) and `redundancyAdjustment: null` (it won't appear in the adjustment map).

**2e: Operation definition.** Add the new endpoint to the operations array:

```typescript
{
  operationId: "shelf.game.set-status",
  name: "set-status",
  description: "Change a game's ownership status",
  invocation: { method: "PATCH", path: "/api/games/:id/ownership" },
  hierarchy: { root: "shelf", feature: "game" },
  parameters: [{ name: "id", in: "path", description: "Game ID", required: true }],
  idempotent: true,
}
```

**Verification**: Route-level tests covering all success criteria from the spec's automated test list (see below). `bun run typecheck` and `bun run lint` pass.

**Tests** (new file `packages/daemon/tests/ownership-routes.test.ts` or added to existing game route tests):

- PATCH with `"previously-owned"` changes status and updates `updatedAt`
- PATCH with `"owned"` reverses status (reacquisition)
- PATCH with invalid status returns 400
- PATCH for nonexistent game returns 404
- PATCH with current status returns 200 without changing `updatedAt`
- GET /games (default) returns only owned games
- GET /games?ownership=all returns both owned and previously-owned
- GET /games?ownership=previously-owned returns only previously-owned
- GET /games/:id returns game regardless of ownership
- Redundancy adjustments exclude previously-owned games
- Niche positions exclude previously-owned games
- Redundancy/niche use owned-only set even when ownership=all
- Fitness scores are computed for previously-owned games
- Previously-owned games remain in prediction reference pool
- Previously-owned games contribute to profile computation
- Previously-owned games in ownership=all have nichePosition: null and redundancyAdjustment: null
- Redundancy/niche scores for owned games are identical between GET /games and GET /games?ownership=all
- Marking as previously-owned does not delete any data

### Phase 3: Web Client Helpers

**Files**: `packages/web/lib/api.ts`
**Depends on**: Phase 2
**Covers**: part of REQ-PREV-20, REQ-PREV-21, REQ-PREV-24

**3a: Update listGames.** The existing `listGames` helper at `api.ts:26-31` accepts `{ includeNiches?: boolean }`. Extend the options type to include `ownership?: "owned" | "previously-owned" | "all"`. When provided, append the `ownership` query parameter. The default (omitted) maps to the daemon's default of `"owned"`.

**3b: Add setOwnership helper.**

```typescript
export async function setGameOwnership(
  id: string,
  ownership: "owned" | "previously-owned",
): Promise<{ game: Game }> {
  return daemonJson(`/api/games/${id}/ownership`, {
    method: "PATCH",
    body: { ownership },
  });
}
```

Export `OwnershipStatus` from the shared type re-exports.

**Verification**: `bun run typecheck` passes.

### Phase 4: Web UI, Collection Page

**Files**: `packages/web/app/collection/page.tsx`, `packages/web/components/collection-table.tsx` (or wherever the filter bar lives), `packages/web/app/globals.css`
**Depends on**: Phase 3
**Covers**: REQ-PREV-20, REQ-PREV-21, REQ-PREV-22

The collection page is currently a server component. The ownership toggle requires a server-side re-fetch (not client-side filtering) because the redundancy/niche computation universe changes. This means the toggle needs to trigger a page refresh with different query parameters, or the page needs client-side state that re-fetches.

The mockup shows three states:

**State A (default):** Owned-only view. The filter bar shows Search, Filters, Sort. No visible indication of previously-owned games. The "Owned Status" filter group only appears inside the expanded Filters panel, and only when `previouslyOwnedCount > 0`.

**State B (filters panel open):** The Filters panel shows an "Owned Status" group with segmented buttons: "Owned only" (active by default) and "+ Prev Owned". A hint below shows "(N previously owned)".

**State C (prev-owned filter active):** Panel closed. Active filter chip "Prev Owned x" in the chips row. Filters button shows a count badge. Info banner: "Niche and redundancy scores reflect your current shelf (owned games only)." Previously-owned rows have `tr.prev-owned` class: muted background (`--prev-owned-bg`), dimmed thumbnail (opacity 0.7), secondary text color for name, "Previously Owned" badge below the game name, reduced score opacity, and dashes for niche/redundancy columns.

**Implementation approach:**

1. The collection page needs to know if any previously-owned games exist (to show/hide the filter group). Fetch `GET /games?ownership=all` to get the count, or add a lightweight count endpoint. The simpler approach: fetch `listGames({ ownership: "all" })` when the toggle is active, `listGames()` when it's not. To know whether the filter group should appear, the page can make a separate lightweight check or the daemon can include a count header. The simplest approach: always fetch all games on the server side, compute `previouslyOwnedCount`, and only show owned games by default. When the user toggles, re-fetch with `ownership=all`. This avoids an extra API call on every page load.

   Decision: The server component fetches `listGames()` (owned only) by default. It also fetches `listGames({ ownership: "previously-owned" })` to get the previously-owned count. This second call is lightweight (the daemon returns scored games, but the page only uses the `.length`). The `CollectionTable` receives `previouslyOwnedCount` as a prop and shows the filter group only when > 0.

   When the user toggles to "+ Prev Owned", the page re-fetches with `ownership=all`. This is a server-side re-fetch (using searchParams or client-side state with `useRouter`). The collection page is currently a server component. To support the toggle without converting to a client component, use URL search params: the toggle links to `?ownership=all`. The server component reads the search param and fetches accordingly.

2. Add CSS for previously-owned visual distinction. New tokens from the mockup:
   - `--prev-owned-bg`, `--prev-owned-badge-bg`, `--prev-owned-badge-border`, `--prev-owned-badge-text`
   - Dark mode overrides for all four

3. The `CollectionTable` component renders `tr.prev-owned` for games with `ownership === "previously-owned"`. The badge, muted styles, and dash placeholders for niche/redundancy columns follow the mockup.

4. The info banner (State C) appears when previously-owned games are visible in the list.

**Verification**: Manual verification against mockup states A, B, C. Both light and dark mode.

**Tests**: The collection page is server-rendered; unit testing is limited. The daemon route tests (Phase 2) cover the data correctness. Manual verification covers the visual presentation.

### Phase 5: Web UI, Game Detail Page

**Files**: `packages/web/app/games/[id]/page.tsx`, `packages/web/components/game-actions.tsx` (or equivalent), `packages/web/app/globals.css`
**Depends on**: Phase 3
**Covers**: REQ-PREV-23, REQ-PREV-24, REQ-PREV-25

The mockup shows two states:

**State A (previously-owned game):** "Previously Owned" status badge in the hero beside the title. Fitness score shown normally. Annotation panel below the hero: "Niche and redundancy data excluded. This game is no longer on your shelf..." The breakdown table shows niche and redundancy rows as "excluded" with inline labels. The right panel actions section has: "Mark as Owned" (green `btn-success`, full width) with descriptive text, a separator, and a danger zone with "Remove from Collection" (outlined danger button).

**State B (owned game):** "Owned" status badge in green. Standard detail page with full niche/redundancy data. Actions section has: "Mark as Previously Owned" (secondary button, `btn-secondary`) with descriptive text, separator, danger zone with "Remove from Collection".

**Implementation:**

1. The page already has `data.game` from `getGame(id)`. Read `data.game.ownership` to determine which state to render.

2. Status badge in hero: `<span className="status-badge prev-owned">Previously Owned</span>` or `<span className="status-badge owned">Owned</span>`. CSS tokens from the mockup: `--prev-owned-badge-*` and `--success-*`.

3. Annotation panel: render below the hero when `ownership === "previously-owned"`. The `prev-owned-notice` class from the mockup.

4. Breakdown table: when `ownership === "previously-owned"`, render niche and redundancy rows with `excluded-row` class showing dashes and "Excluded" label. The `ScoreBreakdown` component needs a prop or context to know the ownership status.

5. Ownership toggle action: a client component (like the existing `GameActions`) that calls `PATCH /api/daemon/games/:id/ownership` via the proxy. On success, `router.refresh()` to reload the page with the new status.

6. Visual hierarchy: the status toggle is the primary action; "Remove from Collection" is secondary in a danger zone. The mockup's layout is: ownership section first, separator, danger zone last.

7. New CSS tokens for the notice panel: `--prev-owned-notice-bg`, `--prev-owned-notice-border`, `--prev-owned-notice-text`. Plus `--success`, `--success-subtle`, `--success-border` for the owned badge (check if these already exist in `globals.css`).

**Verification**: Manual verification against both mockup states. Previously-owned game shows annotation, excluded breakdown rows, "Mark as Owned" button. Owned game shows "Mark as Previously Owned" button. Both in light and dark mode.

### Phase 6: CLI Commands

**Files**: `packages/cli/src/commands/game.ts`, CLI command registry
**Depends on**: Phase 2
**Covers**: REQ-PREV-27, REQ-PREV-28, REQ-PREV-29

**6a: `gameSetStatus` command.** Add to `game.ts`:

```typescript
export async function gameSetStatus(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const [id, status] = args;
  if (!id || !status) {
    throw new Error("Usage: shelf-judge game set-status <id> <owned|previously-owned>");
  }
  // PATCH /api/games/:id/ownership
  const { ok, data } = await client.patch(`/api/games/${id}/ownership`, { ownership: status });
  // Format output...
}
```

Text output: `"<game name>" marked as <status>.`
JSON output: full updated `Game` object.

**6b: `--ownership` flag on `gameList`.** The existing `gameList` function calls `GET /api/games`. Add `--ownership` flag support. When provided, append `?ownership=<value>` to the URL. Values: `owned` (default), `previously-owned`, `all`. Previously-owned games in the table output should be visually marked (e.g., `[prev]` prefix or suffix on the game name).

**6c: Register command.** Add `set-status` to the game command group in the CLI's command registry, alongside `search`, `add`, `list`, `rate`, `remove`. If the CLI client doesn't have a `patch` method, add one following the pattern of `post`/`put`/`delete`.

**Verification**: CLI commands work against a running daemon. `--json` mode returns well-formed JSON.

**Tests**: CLI commands are thin wrappers around HTTP calls. The daemon route tests (Phase 2) cover correctness. Manual verification covers the CLI formatting.

### Phase 7: Validate

Launch a fresh-context sub-agent that:

1. Reads the spec (`.lore/specs/previously-owned.md`) and this plan
2. Reviews the implementation across all packages
3. Verifies the new PATCH endpoint is implemented and tested
4. Verifies both web client helpers (Phase 3) and CLI commands (Phase 6) cover the new endpoint (client/daemon divergence lesson)
5. Verifies ownership filtering happens at call sites in `games.ts`, not inside `computeRedundancyAdjustments` or `computeNichePositions` (REQ-PREV-8, REQ-PREV-9)
6. Verifies GET /games default returns only owned games (backward compatibility, REQ-PREV-17)
7. Verifies the owned-only computation universe is independent of the response filter (REQ-PREV-19)
8. Tests reacquisition round-trip: owned -> previously-owned -> owned, verify data intact
9. Verifies the wishlist add route's collection membership check queries all ownership statuses (REQ-PREV-31)
10. Verifies the game detail page and collection page render correctly in both light and dark mode
11. Runs `bun run test`, `bun run typecheck`, `bun run lint`

## Delegation Guide

**Phase 1** (shared types): Small, fast. Straightforward type addition. Can be done in minutes.

**Phase 2** (daemon API): The meatiest backend phase. The ownership filter integration into the GET /games handler is the critical section. The route already has two code paths (standard and includePredicted), and both need the filter. The `applyRedundancy` helper also needs the filter applied to its universe parameter. This phase should get focused attention. **Reviewer attention:** verify that the owned-only filter is applied to every path through niche and redundancy computation, including the `GET /games/:id` path.

**Phase 3** (web helpers): Trivial, can be done as part of Phase 2 or Phase 4.

**Phases 4-5** (web UI): Can run in parallel after Phase 3. Phase 4 (collection) and Phase 5 (game detail) touch different files. The collection page changes are more structurally complex (server component with search param-driven re-fetch, filter panel integration). The game detail changes are more visually complex (new annotation panel, conditional breakdown rows, ownership action).

**Phase 6** (CLI): Can run in parallel with Phases 4-5 after Phase 2. Touches only CLI files.

**Phase 7** (validation): Fresh-context sub-agent. Must run after all other phases.

**Parallelization opportunity:** After Phases 1-3 complete (types + daemon + helpers), three streams can run in parallel:

- Stream A: Phase 4 (collection page)
- Stream B: Phase 5 (game detail page)
- Stream C: Phase 6 (CLI)

**Review attention points:**

- **Phase 2c** (GET /games filter): The ownership filter and the niche/redundancy computation universe must be independently maintained. The response can include previously-owned games (ownership=all) while niche/redundancy always use owned-only. This is the most error-prone integration point.
- **Phase 2d** (GET /games/:id): The niche/redundancy computation for a single game fetches `allGames` from the prediction service. This set must be filtered to owned-only before passing to the engines. Currently it's passed unfiltered.
- **Phase 4** (collection page): The server component's data fetching strategy determines whether the toggle is fast (URL search param) or requires client-side conversion. The URL search param approach keeps it as a server component but requires a full page navigation on toggle.
- **Phase 5** (game detail): The `ScoreBreakdown` component may need modification to handle excluded rows. Check whether it already renders niche/redundancy rows or if those are separate sections on the page.

## Architectural Decisions

### Ownership filter location

**Decision:** Filter at call sites before engines, not inside engines.

**Why:** REQ-PREV-8 and REQ-PREV-9 mandate this. The brainstorm's interaction map identifies the filter points. The engines (`computeRedundancyAdjustments`, `computeNichePositions`) are pure functions that operate on whatever `GameWithScore[]` they receive. Keeping them pure means the ownership concept doesn't leak into computation logic. The call sites in `routes/games.ts` already assemble the game arrays, so filtering there is a one-line addition per call site.

### Migration strategy

**Decision:** Schema default via Zod `.default("owned")`, no explicit migration.

**Why:** REQ-PREV-3 specifies this approach. Games loaded from `collection.json` without an `ownership` field get `"owned"` at parse time. The Zod parse-with-defaults pattern is already used for other settings in the project. If the project doesn't Zod-validate stored games (check the storage service), the default must be applied in `loadCollection` or in the `Game` construction path. The `addGame` method already constructs games field-by-field, so adding `ownership: "owned"` there covers new games. For existing games, the default at load time covers the migration.

### Collection page data fetching

**Decision:** URL search param (`?ownership=all`) for the toggle, keeping the page as a server component.

**Why:** The collection page is currently a server component. Converting it to a client component for one toggle would lose SSR benefits and require restructuring. The URL param approach is the same pattern used by the existing filter/sort behavior (if those use search params). The trade-off is a full page navigation on toggle, which triggers a server re-fetch. This is acceptable because the toggle changes the computation universe (niche/redundancy), not just the display filter. A server re-fetch is the correct behavior.

If the existing filter/sort is entirely client-side (the collection page fetches once and filters/sorts in the browser), the ownership toggle is a deliberate departure. REQ-PREV-21 explains why: "the toggle triggers a new fetch (not client-side filtering on a cached set). This is a departure from the collection-filter-sort feature's client-side-only approach, but ownership filtering must happen server-side because the redundancy/niche computation universe changes based on which games are included."

### Mockup visual patterns

The mockup defines specific CSS tokens for previously-owned elements:

**Collection table:**

- `tr.prev-owned td { background: var(--prev-owned-bg) }` for muted row background
- `.prev-owned .game-thumb { opacity: 0.7 }` for dimmed thumbnails
- `.prev-owned .game-name { color: var(--text-secondary) }` for muted names
- `.badge-prev-owned` for the inline badge below game name
- `.prev-owned .score-cell { opacity: 0.8 }` for slightly muted scores
- Niche and redundancy columns show `–` (the `.no-data` class)

**Game detail page:**

- `.status-badge.prev-owned` in the hero title row
- `.status-badge.owned` in green for owned games
- `.prev-owned-notice` annotation panel below the hero
- `.excluded-row` in the breakdown table for niche/redundancy rows
- `.btn-success` for "Mark as Owned" (reacquisition), `.btn-secondary` for "Mark as Previously Owned"
- `.danger-zone` wrapping the "Remove from Collection" action

**Dark mode:** Both mockups include complete dark mode token overrides. All previously-owned tokens have dark variants.

## Open Questions

1. **Collection page implementation pattern.** The existing collection table's filter/sort behavior should be examined before implementing Phase 4. If filters are driven by URL search params, the ownership toggle fits naturally. If they're purely client-side state, the ownership toggle introduces a mixed pattern. The implementer should match the existing pattern where possible and only introduce the server re-fetch where the spec requires it (the toggle itself). Check `CollectionTable` props and the filter bar component for the current pattern.
