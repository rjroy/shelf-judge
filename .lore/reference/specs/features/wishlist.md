---
title: "Wishlist"
date: 2026-04-12
status: implemented
tags: [spec, wishlist, search, prediction, curation]
modules: [daemon, shared, web, cli]
req-prefix: WISH
related:
  - .lore/work/issues/wishlist.md
  - .lore/reference/vision.md
  - .lore/work/specs/mvp.md
  - .lore/reference/specs/fitness/prediction-engine.md
  - .lore/reference/specs/fitness/niche-champion-display.md
  - .lore/reference/specs/fitness/redundancy-scoring.md
  - .lore/work/design/jev-redundancy-similarity.md
  - .lore/work/design/wishlist-jev-description-similarity.md
  - .lore/work/design/sqlite-jev-pair-cache.md
  - .lore/reference/designs/mvp-data-model.md
  - .lore/reference/designs/mvp-api-surface.md
---

# Spec: Wishlist

> **Authority and delivery status:** This reference defines the existing wishlist feature and the approved wishlist Jev extension. `implemented` applies to the original wishlist feature only; it does not claim that compact BGG source persistence, candidate-to-owned Jev comparisons, or their run/read projections have shipped. The [approved wishlist-to-owned design](../../../work/design/wishlist-jev-description-similarity.md) is normative target authority for that extension. Preserve the factual `redundancyPreview` snapshot and the collection prediction contract.

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
  redundancyPreview: RedundancyAdjustment | null; // factual-only candidate snapshot at save, null if disabled or unavailable
  bggSource?: WishlistBggSourceSnapshot; // approved optional-for-legacy BGG source; not yet delivered
  addedAt: string; // ISO 8601
}

interface WishlistBggSourceSnapshot {
  observedAt: string; // validated timestamp for the complete matching BGG Thing observation
  description: string | null; // exact source text; null/empty/whitespace is unusable by current Jev rules
  mechanics: string[]; // names consumed by the factual encoder
  categories: string[]; // names consumed by the factual encoder
  weight: number | null;
  communityRating: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  bestPlayers: number | null;
  playingTime: number | null;
}

interface WishlistBreakdownEntry {
  axisName: string;
  rating: number;
  confidence: PredictionConfidence;
}
```

- REQ-WISH-2: `WishlistEntry` and `WishlistBreakdownEntry` are shared types defined in `packages/shared/src/types.ts`. They are consumed by web, CLI, and daemon.

- REQ-WISH-3: A wishlist entry is identified by BGG ID. Only BGG games can be wishlisted. Manual games (no BGG ID) cannot be wishlisted because they have no BGG data to preview, and the wishlist's purpose is fitness evaluation, not bookmarking. Attempting to wishlist a game already in the wishlist (same `bggId`) is rejected with a clear message.

- REQ-WISH-4: A wishlist entry stores a snapshot, not a live reference. The `predictedScore`, `predictionConfidence`, `predictedBreakdown`, `nicheImpact`, and `redundancyPreview` fields remain saved snapshots and are not silently rewritten by ordinary reads or Jev cache changes. `redundancyPreview` is factual-only, contains no Jev judgments, owner notes, or prompts, and is replaced only by the existing explicit factual Refresh semantics (REQ-WISH-11). Separately, the approved Jev extension persists current C-only description judgments in daemon SQLite and exposes a non-persisted current candidate-to-owned redundancy projection. Wishlist prediction and sorting remain valid when C is unavailable; C cache state never partitions prediction-score ordering.

### Adding to Wishlist

- REQ-WISH-5: Games are added to the wishlist from the search/add-game flow. The daemon endpoint accepts a BGG ID, fetches game data from BGG (or uses cached data if available), runs the prediction engine to compute fitness, and stores the result as a `WishlistEntry`. If the prediction engine is at Stage 0 (insufficient data), the entry is still created with `predictedScore: null`, `predictionConfidence: null`, `predictedBreakdown: null`.

- REQ-WISH-6: If the BGG ID already exists in the user's collection, the wishlist add is rejected with: "This game is already in your collection." A game cannot be both collected and wishlisted. The user already has full fitness data for collected games.

- REQ-WISH-7: The daemon does not persist full `Game` or `BggGameData` objects for wishlisted games. The approved Jev extension adds only the compact optional-for-legacy `bggSource` projection in REQ-WISH-1, captured from the same verified BGG Thing observation as `name` and `bggId`. It stores the exact nullable description and the factual encoder inputs, not a full game or derived vector. The compact snapshot is the candidate source authority across restart/offline reads; ordinary reads do not hydrate BGG. This is approved target behavior, not a claim of current delivery.

### Removing from Wishlist

- REQ-WISH-8: Users can remove individual entries from the wishlist. Removal is immediate and not reversible. No confirmation dialog is needed (the cost of re-adding is trivial: search and wishlist again).

- REQ-WISH-9: Users can clear the entire wishlist in one action. This requires confirmation: "Remove all N wishlisted games?"

### Wishlist and Collection Interaction

- REQ-WISH-10: When a wishlisted game is added to the collection (via the search page "Add" button or CLI `shelf-judge game add`), collection commit remains authoritative and the matching wishlist candidate is excluded immediately. Before removing its wishlist recovery source, the coordinated acquisition flow transfers only fully validated compatible C_ONLY candidate cache rows to the corresponding raw owned-game identity. Transfer is idempotent; if post-collection cache or wishlist cleanup fails, return a truthful partial failure, keep the source for restart reconciliation, and fail closed against candidate reads/sends. This is not an atomic transaction across collection JSON, wishlist JSON, and SQLite. Ordinary user removal/clear instead fences in-flight work and purges candidate rows.

### Refreshing Predictions

- REQ-WISH-11: Users can refresh predicted fitness for one entry or all entries. The existing explicit factual Refresh recomputes and replaces the documented prediction, breakdown, niche-impact, and factual-only `redundancyPreview` snapshots in place, preserving `id` and `addedAt`; on a successful same-identity BGG observation it also updates compact `bggSource` and `name`. A failed BGG fetch leaves the prior entry intact. Refresh is not Jev inference and never copies collection C/D rows. A legacy entry without `bggSource` may acquire it only from explicit factual Refresh or explicit wishlist Jev-run preparation.

- REQ-WISH-12: A bulk factual Refresh re-fetches BGG data and re-runs predictions sequentially under the existing BGG rate limits. Successful observations replace source and documented snapshots; failed entries preserve their prior source and snapshots. The response reports refreshed entries and errors.

### Storage

- REQ-WISH-13: The wishlist is stored as a separate JSON file: `~/.shelf-judge/data/wishlist.json`. It is not embedded in `collection.json`. Rationale: wishlist membership and its approved compact BGG source are separate candidate authority; they do not change collection membership, owned fitness, profiling, niche computation, or existing owned-game scores.

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
  entry: WishlistEntryView;
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
// Current delivery: WishlistEntry[]
// Approved Jev target: WishlistEntryReadResult[]
```

The target read wrapper exposes the saved `WishlistEntryView` (without `bggSource`) plus a separate redundancy projection. Add/refresh responses likewise use `WishlistEntryView`; the daemon retains the compact source as local authority and does not expose description text in broad client responses. The read projection identifies `current`, `saved-factual`, or `base-prediction` provenance, carries the chosen `RedundancyAdjustment` when one exists, and carries the `orderingScore` (null when no prediction exists). It is a read result only: neither it nor Jev cache changes rewrite the persisted snapshots. Current redundancy sorting uses the projection's ordering score; predicted-score sorting continues to use saved `predictedScore`.

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
  entry: WishlistEntryView;
}
```

**POST `/api/wishlist/refresh`** (refresh all):

```typescript
// Response (200)
{ refreshed: number, errors: string[] }
```

- REQ-WISH-17: The wishlist routes are a new route module (`packages/daemon/src/routes/wishlist.ts`) following the existing pattern. The route factory receives `StorageService`, `PredictionService`, and `BggClient` as dependencies.

### Explicit wishlist Jev scope (approved target; not yet delivered)

- The existing Jev run-preview route remains `GET /redundancy/semantic/run-preview`. Its optional `scope` query selector accepts `collection` or `wishlist`; omission is exactly the existing collection scope. For wishlist scope, omitted selection means all current entries; a selected subset uses `selection=selected` and one repeated `bggId` query parameter per selected BGG ID (never a delimited list). `selection`/`bggId` are invalid for collection scope. Repeated `scope` or `selection` keys are invalid. The existing `POST /redundancy/semantic/run` body remains `{ requestId, precondition, noteTransmissionAuthorized }`: the preview precondition binds scope and canonical selection, and no new client-supplied scope is trusted at start. Current budget parsing strictly rejects every unrecognized query key; the approved implementation must extend that allowlist without weakening strictness or existing budget behavior. A collection preview can never authorize wishlist pairs, or vice versa.
- The selected-ID query must contain at least one distinct positive safe-integer BGG ID; duplicates and malformed IDs are rejected. Preparation rejects the entire selection if any selected BGG ID is absent from the wishlist capture; it never silently drops or broadens selection. A selected entry that overlaps owned collection data is counted separately and fenced out. Canonical selection identity normalizes omitted/all to `{ kind: "all" }`; selected BGG IDs are sorted numerically and captured as `{ kind: "selected", bggIds }`. Selection membership, source, eligibility, policy and pair scope are frozen into preview before disclosure; start only validates and consumes that exact capture, never hydrates, expands or reselects. If any frozen input changes after preview, start rejects before gateway construction/send and requires a fresh disclosure. BGG hydration/persistence is limited to the selected entries and completes before disclosure. Ordinary wishlist reads, sorting, status polling and refresh-progress reads do not hydrate BGG or infer.
- Wishlist preview adds a `scopeDisclosure` of the shared `JevRunScopeDisclosure` shape. `wishlistEntryCount` is the global captured list size. `selectedCandidateCount` is the distinct selected list size (equal to global size for all mode); `unselectedEntryCount = wishlistEntryCount - selectedCandidateCount`. Within selected entries, `ownedOverlapCandidateCount` is separate; `requestedCandidateCount = selectedCandidateCount - ownedOverlapCandidateCount`. Requested candidates partition exactly into `eligibleCandidateCount` (an established compact source object) and `unavailableCandidateCount` (no valid source object after preparation): `requestedCandidateCount = eligibleCandidateCount + unavailableCandidateCount`. Failed legacy hydration and invalid/mismatched source observations are unavailable; unselected entries are not unavailable. An established observation with null/empty/whitespace description is still eligible for factual comparison but cannot send C. `eligibleOwnedGameCount` counts only currently owned, scored, positive-score, non-vetoed games; unscored, vetoed and previously-owned games are outside that neighbor count and do not affect candidate availability counts. `comparisonPairCount` is eligible-candidate × eligible-owned pairs. Valid cache hits and sendable misses are C-usable pair subsets, not partitions of all comparison pairs. Existing provider/model, budget, retention, expiry, and explicit authorization information remains in the same aggregate preview. Only sendable misses are submitted; no D or shared C+D result may be used or requested for a wishlist candidate.
- Wishlist candidates are never collection members. Eligible neighbors are only currently owned, scored, positive-score, non-vetoed games; previously-owned and candidate games are excluded. F uses the existing factual encoder and the same current collection source universe used to build vocabulary/ranges, even where a BGG-bearing game in that universe is ineligible as a neighbor.
- The existing per-pair F/C blend omits unavailable signal and weight together, retaining valid zero. Wishlist O/D is absent. The same candidate-to-owned blended pair comparisons feed the existing candidate fitness/redundancy adjustment and strongest-owned-overlap result; no separate candidate ranker or overlap model is added. Candidate-only pair rows are not passed as an incomplete full-collection pair table. A single shared factual context, memoized vectors and eligible-owned index are reused for a coherent capture; no owned-owned pair work is introduced.
- The explicit read result and run selector types are declared in `packages/shared/src/types.ts` and exported from the shared package. The compact source is daemon-owned and omitted from public wishlist read projections. This contract amendment does not assert that storage, routes, run controls, cache scope, or projections have shipped.
- If BGG hydration for a legacy candidate fails, retain its prior entry/prediction snapshots, disclose the unavailable candidate, and do not fabricate F or send C without established source. Its saved valid prediction remains rankable using the existing fallback precedence. If acquisition reconciliation cannot safely finish, the owned/wishlist BGG-ID overlap remains hidden and unsendable as a wishlist candidate; daemon startup must reconcile overlaps before exposing candidate routes.

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

- REQ-WISH-21: The wishlist page supports sorting by date added (default, newest first), predicted score (descending), name (alphabetical), and redundancy adjustment when enabled. Redundancy ordering uses the separate read projection's current adjustment, then saved factual adjustment, then base prediction; predicted-score ordering always uses `predictedScore`. No filtering beyond sorting. The wishlist is expected to be small (tens of entries, not hundreds).

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

- REQ-WISH-28: Wishlist entries are not collection members: they do not affect owned-game fitness, collection profiling, collection niche computation, tournament ranking, or prediction-engine behavior; they do not appear in collection lists or contribute to the profile. The separately approved explicit wishlist-to-eligible-owned redundancy result does not insert candidates into the collection or alter owned-game penalties.

- REQ-WISH-29: The prediction engine is called during wishlist add and factual refresh, but remains read-only with respect to collection state and unchanged in its prediction calculation. Ordinary search prediction, wishlist reads/add, and factual refresh never trigger Jev inference. Wishlist entries are candidates, not collection games, and have no owner notes eligible for O/D. Separately, only an explicit wishlist-scoped Jev Run may compare a wishlisted candidate with eligible owned games using C; it uses persisted source snapshots, sends only disclosed C_ONLY misses, and does not write comparison results into `wishlist.json`. A successful current adjustment uses the saved `predictedScore` as its base once; it does not replace that score or double-apply an already-computed penalty.

## Scope Exclusions

- **Wishlist sharing or export.** No social features per the vision's anti-goals. The wishlist is personal.
- **Wishlist-based recommendations.** The wishlist does not feed into any recommendation or suggestion engine. It is a passive holding pen.
- **Notes or tags on wishlist entries.** The entry stores BGG identity, compact BGG source, and prediction snapshots only. If the user wants to annotate why they wishlisted a game, that's outside scope.
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
- [ ] Stored redundancyPreview remains a factual-only snapshot on add/explicit factual refresh; it includes no Jev result, note, or prompt
- [ ] Ordinary reads/search/add/factual refresh do not trigger inference; explicit wishlist Run is separately scoped, disclosed, C_ONLY, and writes only numeric judgments/minimal provenance to Jev SQLite
- [ ] Compact optional-for-legacy source survives wishlist persistence/restart and is omitted from all public wishlist projections; current redundancy projection is separate from saved snapshots
- [ ] Redundancy projection falls back current -> saved factual -> base prediction without modifying saved JSON; prediction sort is unchanged
- [ ] Explicit wishlist preview hydrates legacy source before disclosure; changed frozen inputs reject start before gateway construction/send
- [ ] Note edits/clear or cached-D revocation leave factual-only wishlist decision snapshots intact; existing invalidation for their defined non-note source changes is preserved
- [ ] When prediction is unavailable (Stage 0), entry is created with null prediction fields
- [ ] Wishlist storage follows atomic write pattern (temp file + rename)
- [ ] Wishlist entries do not appear in `GET /games` (collection list)
- [ ] Wishlist entries do not affect owned fitness, profile, collection niche computation, or owned redundancy adjustments
- [ ] `GET /api/wishlist` returns entries sorted by `addedAt` descending
- [ ] Duplicate BGG ID rejection works correctly across both wishlist and collection

### Manual Verification

- [ ] Search a game on BGG, click "Wishlist", verify entry appears on wishlist page with predicted score
- [ ] Wishlist page shows thumbnail, name, year, predicted score, confidence badge for each entry
- [ ] Click "Add to Collection" on a wishlist entry, verify game is added and entry disappears from wishlist
- [ ] Rate some games on new axes, click "Refresh All" on wishlist, verify predicted scores update
- [ ] CLI `shelf-judge wishlist list` shows wishlisted games in table format; JSON omits daemon-owned BGG source text
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
- The wishlist file does not grow unbounded in practice. The approved compact scoring source increases per-entry storage but remains a bounded source projection (not a full `Game`); the file is read/written atomically like all others.
- The prediction used for wishlist snapshots comes from the same `predictBggGame` codepath as search preview. No new prediction logic.

## Open Questions

1. **Stale prediction indicator.** Should the wishlist page show an indicator when the snapshot is old (e.g., axes or ratings have changed since the snapshot was taken)? The simplest approach: show the `addedAt` date and let the user decide when to refresh. A "stale" indicator would require tracking collection mutations, which adds complexity for marginal value. The spec defers this to user feedback.

## Context

- [Issue: Wishlist](.lore/work/issues/wishlist.md): The original request. "Add Game should allow adding to a wishlist... preview information like on the Add Game screen... help a user understand fitness."
- [Vision](.lore/reference/vision.md): Principle 4 ("Data serves judgment, not replaces it") supports showing fitness predictions as information. Anti-goal ("Automated purchase decisions") means the wishlist presents data, not recommendations.
- [Search page](../../../../packages/web/app/search/page.tsx): The "Add Game" screen referenced in the issue. Shows BGG search results with thumbnail, name, year, and (on preview) predicted fitness score, per-axis breakdown, niche impact. Wishlist captures the prediction and factual-only redundancy snapshot; explicit wishlist Jev comparison is a separate approved scope and result.
- [Prediction route](../../../../packages/daemon/src/routes/prediction.ts): `GET /predictions/bgg/:bggId` is the existing endpoint that computes predictions for unowned games. The wishlist add flow reuses this codepath.
- [Spec: Niche Champion Display](.lore/reference/specs/fitness/niche-champion-display.md): Defines `NicheImpact` type used in wishlist entries.
- [Spec: Prediction Engine](.lore/reference/specs/fitness/prediction-engine.md): Defines prediction stages, confidence levels, and the `PredictedGameResponse` shape.
