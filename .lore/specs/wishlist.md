---
title: "Wishlist"
date: 2026-04-12
status: implemented
tags: [spec, wishlist, search, prediction, curation]
modules: [daemon, shared, web, cli]
req-prefix: WISH
related:
  - .lore/issues/wishlist.md
  - .lore/vision.md
  - .lore/specs/mvp.md
  - .lore/specs/prediction-engine.md
  - .lore/specs/niche-champion-display.md
  - .lore/designs/mvp-data-model.md
  - .lore/designs/mvp-api-surface.md
---

# Spec: Wishlist

## Overview

The search page lets a user preview a game's predicted fitness before adding it to their collection. But that preview is ephemeral: close the page, lose the context. A user browsing at a game store or reading recommendations has no way to bookmark "interesting, worth considering" without committing the game to their collection.

The wishlist is a lightweight holding pen. It captures a game's BGG identity and the fitness prediction at time of save, so the user can return later with full context about why a game caught their attention and how it fits their shelf. No ratings, no axes, no collection membership. Just the data the search preview already shows, persisted.

The goal, per the issue: help the user understand fitness. The wishlist does this by letting the user accumulate candidates over time and compare their predicted fitness side by side, without polluting the collection with games they haven't decided on yet.

## Entry Points

- Search page (web): "Wishlist" button alongside "Add" on each search result
- Wishlist page (web): dedicated page showing all wishlisted games with predicted fitness
- Game search CLI: `shelf-judge wishlist add <bgg-id>` to bookmark a game
- Wishlist CLI: `shelf-judge wishlist list` to view all wishlisted games

## Requirements

### Wishlist Entry Data Model

- REQ-WISH-1: A wishlist entry stores the game's BGG identity and a snapshot of its predicted fitness at time of wishlisting. The shape:

```typescript
interface WishlistEntry {
  id: string; // UUID
  bggId: number;
  name: string;
  yearPublished: number | null;
  thumbnailUrl: string | null;
  predictedScore: number | null; // fitness score at time of save, null if prediction was unavailable
  predictionConfidence: PredictionConfidence | null; // confidence at time of save
  predictedBreakdown: WishlistBreakdownEntry[] | null; // per-axis snapshot, null if unavailable
  nicheImpact: NicheImpact | null; // niche impact at time of save
  addedAt: string; // ISO 8601
}

interface WishlistBreakdownEntry {
  axisName: string;
  rating: number;
  confidence: PredictionConfidence;
}
```

- REQ-WISH-2: `WishlistEntry` and `WishlistBreakdownEntry` are shared types defined in `packages/shared/src/types.ts`. They are consumed by web, CLI, and daemon.

- REQ-WISH-3: A wishlist entry is identified by BGG ID. Only BGG games can be wishlisted. Manual games (no BGG ID) cannot be wishlisted because they have no BGG data to preview, and the wishlist's purpose is fitness evaluation, not bookmarking. Attempting to wishlist a game already in the wishlist (same `bggId`) is rejected with a clear message.

- REQ-WISH-4: A wishlist entry stores a snapshot, not a live reference. The `predictedScore`, `predictionConfidence`, `predictedBreakdown`, and `nicheImpact` fields reflect the state at time of wishlisting. They are not automatically refreshed when axes, ratings, or collection composition change. Rationale: the snapshot records the user's decision context. A "Refresh" action (REQ-WISH-11) lets the user explicitly update predictions when they want current data.

### Adding to Wishlist

- REQ-WISH-5: Games are added to the wishlist from the search/add-game flow. The daemon endpoint accepts a BGG ID, fetches game data from BGG (or uses cached data if available), runs the prediction engine to compute fitness, and stores the result as a `WishlistEntry`. If the prediction engine is at Stage 0 (insufficient data), the entry is still created with `predictedScore: null`, `predictionConfidence: null`, `predictedBreakdown: null`.

- REQ-WISH-6: If the BGG ID already exists in the user's collection, the wishlist add is rejected with: "This game is already in your collection." A game cannot be both collected and wishlisted. The user already has full fitness data for collected games.

- REQ-WISH-7: The daemon does not persist full `Game` or `BggGameData` objects for wishlisted games. The wishlist entry stores only the fields in REQ-WISH-1. BGG data fetched during wishlisting is used transiently for prediction but not cached in the wishlist. This keeps the wishlist lightweight and avoids maintaining a parallel data cache.

### Removing from Wishlist

- REQ-WISH-8: Users can remove individual entries from the wishlist. Removal is immediate and not reversible. No confirmation dialog is needed (the cost of re-adding is trivial: search and wishlist again).

- REQ-WISH-9: Users can clear the entire wishlist in one action. This requires confirmation: "Remove all N wishlisted games?"

### Wishlist and Collection Interaction

- REQ-WISH-10: When a wishlisted game is added to the collection (via the search page "Add" button or CLI `shelf-judge game add`), the wishlist entry for that BGG ID is automatically removed. The user does not need to manually clean up the wishlist after deciding on a game. The daemon handles this in the add-game flow: after successfully adding the game, check the wishlist for a matching `bggId` and delete it if found.

### Refreshing Predictions

- REQ-WISH-11: Users can refresh the predicted fitness for a single wishlist entry or for all entries. A refresh re-runs the prediction engine against the current collection state (current axes, ratings, and games) and updates `predictedScore`, `predictionConfidence`, `predictedBreakdown`, and `nicheImpact` in place. The `addedAt` timestamp does not change. This lets the user see how a wishlisted game's fitness has changed as their collection evolves.

- REQ-WISH-12: A bulk refresh ("Refresh All") re-fetches BGG data and re-runs predictions for every entry. This is potentially expensive (one BGG API call per entry if data is stale). The daemon processes entries sequentially with rate limiting, same as collection refresh. The response reports how many entries were refreshed and any errors.

### Storage

- REQ-WISH-13: The wishlist is stored as a separate JSON file: `~/.shelf-judge/data/wishlist.json`. It is not embedded in `collection.json`. Rationale: the wishlist is orthogonal to the collection. It has no effect on fitness scores, profiling, niche computation, or any collection-level feature. A separate file keeps concerns isolated and avoids bloating the collection file with transient candidate data.

```
~/.shelf-judge/
  data/
    collection.json
    wishlist.json         # Array of WishlistEntry
    tournament.json
    profile.json
    prediction-settings.json
    niche-settings.json
```

- REQ-WISH-14: Wishlist writes follow the same atomic write pattern as all other storage: write to temp file, rename into place (`storage-service.ts` pattern). An empty wishlist is stored as `[]`.

### Daemon API

- REQ-WISH-15: New API endpoints for wishlist operations:

| Operation ID                 | Method | Path                        | Description                           |
| ---------------------------- | ------ | --------------------------- | ------------------------------------- |
| `shelf.wishlist.list`        | GET    | `/api/wishlist`             | List all wishlist entries             |
| `shelf.wishlist.add`         | POST   | `/api/wishlist`             | Add a game to the wishlist by BGG ID  |
| `shelf.wishlist.remove`      | DELETE | `/api/wishlist/:id`         | Remove a wishlist entry               |
| `shelf.wishlist.clear`       | DELETE | `/api/wishlist`             | Remove all wishlist entries           |
| `shelf.wishlist.refresh`     | POST   | `/api/wishlist/:id/refresh` | Refresh prediction for a single entry |
| `shelf.wishlist.refresh-all` | POST   | `/api/wishlist/refresh`     | Refresh predictions for all entries   |

- REQ-WISH-16: Request/response shapes:

**POST `/api/wishlist`** (add to wishlist):

```typescript
// Request
{
  bggId: number;
}

// Response (201)
{
  entry: WishlistEntry;
}

// Error: already wishlisted (409)
{
  error: "This game is already on your wishlist";
}

// Error: already in collection (409)
{
  error: "This game is already in your collection";
}
```

**GET `/api/wishlist`** (list):

```typescript
// Response
WishlistEntry[]
```

**DELETE `/api/wishlist/:id`** (remove):

```typescript
// Response (200)
{
  removed: true;
}
```

**DELETE `/api/wishlist`** (clear):

```typescript
// Response (200)
{
  removed: number;
} // count of entries removed
```

**POST `/api/wishlist/:id/refresh`** (refresh one):

```typescript
// Response (200)
{
  entry: WishlistEntry;
}
```

**POST `/api/wishlist/refresh`** (refresh all):

```typescript
// Response (200)
{ refreshed: number, errors: string[] }
```

- REQ-WISH-17: The wishlist routes are a new route module (`packages/daemon/src/routes/wishlist.ts`) following the existing pattern. The route factory receives `StorageService`, `PredictionService`, and `BggClient` as dependencies.

### Web UI

- REQ-WISH-18: The search page gains a "Wishlist" button alongside "Add" for each search result. The button is available regardless of whether a preview has been loaded. Clicking "Wishlist" calls `POST /api/wishlist` with the BGG ID. On success, the button changes to a checkmark or "Wishlisted" indicator. If the game is already wishlisted, the button shows "Wishlisted" from the start (the search page checks against the current wishlist on load).

- REQ-WISH-19: To show "already wishlisted" state on search results, the search page fetches the current wishlist on mount and maintains a `Set<number>` of wishlisted BGG IDs. This is a single `GET /api/wishlist` call. The set is updated optimistically when the user wishlists a game.

- REQ-WISH-20: A dedicated Wishlist page at `/wishlist` shows all wishlisted games. Each entry displays:
  - Thumbnail (from `thumbnailUrl`)
  - Game name and year
  - Predicted fitness score (or "No prediction" if null)
  - Prediction confidence badge (if available)
  - Per-axis breakdown (collapsed by default, expandable)
  - Niche impact summary (if available)
  - "Add to Collection" button
  - "Remove" button
  - "Refresh" button (refreshes this entry's prediction)

- REQ-WISH-21: The wishlist page supports sorting by: date added (default, newest first), predicted score (descending), and name (alphabetical). No filtering beyond sorting. The wishlist is expected to be small (tens of entries, not hundreds).

- REQ-WISH-22: The wishlist page has a "Refresh All" button in the page header that refreshes predictions for all entries. During refresh, entries update in place as each completes.

- REQ-WISH-23: The "Add to Collection" button on a wishlist entry calls `POST /api/games` with the BGG ID (same as the search page "Add" button). On success, the entry disappears from the wishlist (per REQ-WISH-10). The user is navigated to the new game's detail page.

- REQ-WISH-24: The wishlist page is added to the sidebar navigation under the "Library" group, below "Collection" and above "Add Game":
  - Collection (/collection)
  - Wishlist (/wishlist)
  - Add Game (/search)

### CLI

- REQ-WISH-25: New CLI commands under `shelf-judge wishlist`:

| Command                             | Description                              |
| ----------------------------------- | ---------------------------------------- |
| `shelf-judge wishlist list`         | List all wishlisted games                |
| `shelf-judge wishlist add <bgg-id>` | Add a game to the wishlist by BGG ID     |
| `shelf-judge wishlist remove <id>`  | Remove a wishlist entry                  |
| `shelf-judge wishlist clear`        | Remove all wishlist entries              |
| `shelf-judge wishlist refresh [id]` | Refresh one entry, or all if no ID given |

- REQ-WISH-26: `shelf-judge wishlist list` text output shows a table: name, year, predicted score, confidence, date added. In `--json` mode, returns the full `WishlistEntry[]` array.

- REQ-WISH-27: `shelf-judge wishlist add <bgg-id>` prints the created entry summary (name, predicted score) on success. In `--json` mode, returns the full `WishlistEntry`.

### Interactions

- REQ-WISH-28: The wishlist has no effect on fitness scoring, collection profiling, niche computation, tournament ranking, or prediction engine behavior. Wishlisted games are not part of the collection. They do not appear in collection lists, do not contribute to the profile, and do not participate in niche or redundancy calculations.

- REQ-WISH-29: The prediction engine is called during wishlist add and refresh, but this is a read-only operation. The prediction does not modify any collection state. It uses the same `predictBggGame` codepath as the search preview (`GET /predictions/bgg/:bggId`).

## Scope Exclusions

- **Wishlist sharing or export.** No social features per the vision's anti-goals. The wishlist is personal.
- **Wishlist-based recommendations.** The wishlist does not feed into any recommendation or suggestion engine. It is a passive holding pen.
- **Notes or tags on wishlist entries.** The entry stores BGG identity and prediction snapshot only. If the user wants to annotate why they wishlisted a game, that's outside scope.
- **Wishlist-aware niche computation.** Wishlisted games do not appear in niche displays or niche impact calculations for other games. The niche impact stored on the wishlist entry is a snapshot from time of wishlisting, not a live integration.
- **Manual game wishlisting.** Only BGG games can be wishlisted (REQ-WISH-3). Manual games have no BGG data for prediction.
- **Wishlist import from BGG.** BGG wishlists are a different concept (purchase intent). Importing them could be a future feature but is not part of this spec.
- **Price tracking or purchase links.** The wishlist is about fitness evaluation, not shopping.

## Exit Points

| Exit                     | Triggers When                                            | Target                       |
| ------------------------ | -------------------------------------------------------- | ---------------------------- |
| Wishlist notes/tags      | User wants to annotate why a game was wishlisted         | [STUB: wishlist-annotations] |
| BGG wishlist import      | User wants to pull their BGG wishlist into shelf-judge   | [STUB: bgg-wishlist-import]  |
| Wishlist comparison view | User wants side-by-side fitness comparison of candidates | [STUB: wishlist-comparison]  |

## Success Criteria

### Automated Tests (bun test)

- [ ] Adding a game by BGG ID creates a wishlist entry with correct fields populated
- [ ] Adding a game that is already wishlisted returns 409
- [ ] Adding a game that is already in the collection returns 409
- [ ] Removing an entry by ID deletes it from storage
- [ ] Clearing the wishlist removes all entries
- [ ] When a wishlisted game is added to the collection, the wishlist entry is auto-removed
- [ ] Refreshing an entry updates `predictedScore`, `predictionConfidence`, `predictedBreakdown`, and `nicheImpact` without changing `addedAt`
- [ ] When prediction is unavailable (Stage 0), entry is created with null prediction fields
- [ ] Wishlist storage follows atomic write pattern (temp file + rename)
- [ ] Wishlist entries do not appear in `GET /games` (collection list)
- [ ] Wishlist entries do not affect profile computation
- [ ] `GET /api/wishlist` returns entries sorted by `addedAt` descending
- [ ] Duplicate BGG ID rejection works correctly across both wishlist and collection

### Manual Verification

- [ ] Search a game on BGG, click "Wishlist", verify entry appears on wishlist page with predicted score
- [ ] Wishlist page shows thumbnail, name, year, predicted score, confidence badge for each entry
- [ ] Click "Add to Collection" on a wishlist entry, verify game is added and entry disappears from wishlist
- [ ] Rate some games on new axes, click "Refresh All" on wishlist, verify predicted scores update
- [ ] CLI `shelf-judge wishlist list` shows wishlisted games in table format
- [ ] CLI `shelf-judge wishlist add <bgg-id>` adds a game and shows confirmation
- [ ] Wishlist appears in sidebar navigation between Collection and Add Game

## AI Validation

**Defaults** (apply unless overridden):

- Unit tests with mocked time/network/filesystem
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom:**

- Verify that `POST /api/games` (add to collection) checks and removes matching wishlist entries (REQ-WISH-10), tested with a game that is wishlisted and one that is not
- Verify that both web proxy route and CLI client helper are updated for all new endpoints (per tournament retro lesson)
- Verify that wishlist operations do not trigger profile dirty flag or niche recomputation
- Test the search page "already wishlisted" indicator: wishlist a game, re-search, verify the button state reflects wishlisted status

## Constraints

- No modification to `FitnessResult`, `CollectionProfile`, `NichePosition`, or any collection-level type. The wishlist is a separate data domain.
- No new external service dependencies. The wishlist uses the same BGG API access and prediction engine already available.
- The wishlist file does not grow unbounded in practice. A user wishlisting 100+ games is an edge case but not a problem: the entry is small (~500 bytes) and the file is read/written atomically like all others.
- The prediction used for wishlist snapshots comes from the same `predictBggGame` codepath as search preview. No new prediction logic.

## Open Questions

1. **Stale prediction indicator.** Should the wishlist page show an indicator when the snapshot is old (e.g., axes or ratings have changed since the snapshot was taken)? The simplest approach: show the `addedAt` date and let the user decide when to refresh. A "stale" indicator would require tracking collection mutations, which adds complexity for marginal value. The spec defers this to user feedback.

## Context

- [Issue: Wishlist](.lore/issues/wishlist.md): The original request. "Add Game should allow adding to a wishlist... preview information like on the Add Game screen... help a user understand fitness."
- [Vision](.lore/vision.md): Principle 4 ("Data serves judgment, not replaces it") supports showing fitness predictions as information. Anti-goal ("Automated purchase decisions") means the wishlist presents data, not recommendations.
- [Search page](packages/web/app/search/page.tsx): The "Add Game" screen referenced in the issue. Shows BGG search results with thumbnail, name, year, and (on preview) predicted fitness score, per-axis breakdown, niche impact. The wishlist captures the same data.
- [Prediction route](packages/daemon/src/routes/prediction.ts): `GET /predictions/bgg/:bggId` is the existing endpoint that computes predictions for unowned games. The wishlist add flow reuses this codepath.
- [Spec: Niche Champion Display](.lore/specs/niche-champion-display.md): Defines `NicheImpact` type used in wishlist entries.
- [Spec: Prediction Engine](.lore/specs/prediction-engine.md): Defines prediction stages, confidence levels, and the `PredictedGameResponse` shape.
