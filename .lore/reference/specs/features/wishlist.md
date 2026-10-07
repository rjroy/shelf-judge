---
title: "Wishlist"
date: 2026-04-12
status: implemented
tags: [spec, wishlist, search, prediction, curation]
modules: [daemon, shared, web, cli]
req-prefix: WISH
related:
  - .lore/work/design/unified-similarity-prediction-redundancy.md
  - .lore/work/issues/wishlist.md
  - .lore/reference/vision.md
  - .lore/work/intents/mvp.md
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

> **Current authority and delivery status — 2026-10-04:** The [approved unified-similarity design](../../../work/design/unified-similarity-prediction-redundancy.md) and accepted Phase 6 activation supersede the saved-score-as-current, factual-only prediction, and Jev-not-yet-delivered statements below. Wishlist facts and historical derived fields remain stored, but current reads use a current prediction projection or explicit unavailable state; old derived values are never current fallback. Candidate-to-owned comparisons are active under the same F/S algorithm as collection scoring and use C_ONLY evidence only. Public shapes differ by endpoint: `GET /api/wishlist` remains a flat array whose legacy derived fields alias current values or null; `GET /api/wishlist/redundancy` returns `{entry,prediction,redundancy}` rows; add and single-refresh return `{entry}` with current legacy aliases; refresh-all returns its refreshed/error counts. The CLI list uses the rich redundancy endpoint. None exposes compact private BGG source. The [approved wishlist-to-owned design](../../../work/design/wishlist-jev-description-similarity.md), [SQLite cache design](../../../work/design/sqlite-jev-pair-cache.md), and prior JEV redundancy/contract amendments remain linked historical authority subject to the unified design. `implemented` describes the original wishlist feature, not live-provider validation.

## Overview

The search page lets a user preview a game's predicted fitness before adding it to their collection. But that preview is ephemeral: close the page, lose the context. A user browsing at a game store or reading recommendations has no way to bookmark "interesting, worth considering" without committing the game to their collection.

The wishlist is a lightweight holding pen. It stores a game's BGG identity, compact verified factual source where available, and saved historical prediction fields. Ordinary reads calculate a current projection from saved verified facts and current collection/tournament/settings/cache sources; missing evidence is explicitly unavailable rather than replaced with historic derived output. No ratings, no axes, no collection membership.

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
  bggSource?: WishlistBggSourceSnapshot; // compact verified BGG source; optional for legacy entries
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

- REQ-WISH-4: The `predictedScore`, `predictionConfidence`, `predictedBreakdown`, `nicheImpact`, and `redundancyPreview` fields are saved snapshots/history and ordinary reads do not rewrite storage. They are not current-read fallbacks. `redundancyPreview` remains the factual-only save/refresh snapshot with no JEV judgments, notes or prompts. The required read projection supplies current prediction and current redundancy when available; otherwise it reports unavailable/current null and never exposes historical derived score as current. Candidate-to-owned JEV judgments remain in daemon SQLite and only independent C_ONLY evidence is valid for wishlist candidates. Prediction remains available when factual prediction evidence suffices without C.

### Adding to Wishlist

- REQ-WISH-5: Games are added to the wishlist from the search/add-game flow. The daemon endpoint accepts a BGG ID, fetches game data from BGG (or uses cached data if available), runs the prediction engine to compute fitness, and stores the result as a `WishlistEntry`. If the prediction engine is at Stage 0 (insufficient data), the entry is still created with `predictedScore: null`, `predictionConfidence: null`, `predictedBreakdown: null`.

- REQ-WISH-6: If the BGG ID already exists in the user's collection, the wishlist add is rejected with: "This game is already in your collection." A game cannot be both collected and wishlisted. The user already has full fitness data for collected games.

- REQ-WISH-7: The daemon does not persist full `Game` or `BggGameData` objects for wishlisted games. It stores only the compact optional-for-legacy `bggSource` projection in REQ-WISH-1, captured from the same verified BGG Thing observation as `name` and `bggId`. It stores the exact nullable description and factual encoder inputs, not a full game or derived vector. The compact snapshot is candidate source authority across restart/offline reads; ordinary reads do not hydrate BGG. Legacy entries may lack this snapshot until explicit factual refresh or explicit run preparation establishes verified source.

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
// Current response: flat public WishlistEntryView[] whose legacy derived fields
// alias current prediction/redundancy values or null; bggSource is omitted.
```

The flat list shape is preserved for compatibility: it contains safe public entry fields, and its legacy `predictedScore`, confidence, and breakdown aliases reflect the current prediction or are null. It is not the rich projection wrapper. The explicit `GET /api/wishlist/redundancy` endpoint returns rows containing the public `entry`, strict V2 `prediction`, and `redundancy` projections. Current prediction is `source: current`, with a result or null and explicit readiness/unavailability reason. Current redundancy identifies current adjustment, base prediction, or unavailable and provides current adjusted/base ordering score or null. The daemon retains compact source as local authority and omits `bggSource` from every public entry.

`POST /api/wishlist` and `POST /api/wishlist/:id/refresh` each return `{ entry }`; that public entry carries the same current legacy aliases or null, not the rich `{ entry, prediction, redundancy }` wrapper. `POST /api/wishlist/refresh` returns only `{ refreshed, errors }`. The CLI `wishlist list` reads `/api/wishlist/redundancy` and formats the V2 current projections; CLI add/single-refresh unwrap the route's `{ entry }` for text and JSON output. No endpoint or CLI path falls back to saved prediction/redundancy history as current. Reads do not rewrite persisted snapshots. Prediction sorting uses current prediction; redundancy sorting uses current ordering and places unavailable entries last.

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

### Explicit wishlist Jev scope (active; provider behavior not live-validated)

- The existing Jev run-preview route remains `GET /redundancy/semantic/run-preview`. Its optional `scope` query selector accepts `collection` or `wishlist`; omission is exactly the existing collection scope. For wishlist scope, omitted selection means all current entries; a selected subset uses `selection=selected` and one repeated `bggId` query parameter per selected BGG ID (never a delimited list). `selection`/`bggId` are invalid for collection scope. Repeated `scope` or `selection` keys are invalid. The existing `POST /redundancy/semantic/run` body remains `{ requestId, precondition, noteTransmissionAuthorized }`: the preview precondition binds scope and canonical selection, and no new client-supplied scope is trusted at start. Current budget parsing strictly rejects every unrecognized query key; the approved implementation must extend that allowlist without weakening strictness or existing budget behavior. A collection preview can never authorize wishlist pairs, or vice versa.
- The selected-ID query must contain at least one distinct positive safe-integer BGG ID; duplicates and malformed IDs are rejected. Preparation rejects the entire selection if any selected BGG ID is absent from the wishlist capture; it never silently drops or broadens selection. A selected entry that overlaps owned collection data is counted separately and fenced out. Canonical selection identity normalizes omitted/all to `{ kind: "all" }`; selected BGG IDs are sorted numerically and captured as `{ kind: "selected", bggIds }`. Selection membership, source, eligibility, policy and pair scope are frozen into preview before disclosure; start only validates and consumes that exact capture, never hydrates, expands or reselects. If any frozen input changes after preview, start rejects before gateway construction/send and requires a fresh disclosure. BGG hydration/persistence is limited to the selected entries and completes before disclosure. Ordinary wishlist reads, sorting, status polling and refresh-progress reads do not hydrate BGG or infer.
- **Current frozen scope:** Wishlist run preparation constructs prediction demand `P` from selected wishlist candidates crossed with actual-rated local collection references for each required axis; genuine previously-owned ratings are eligible references where the axis rules permit. It resolves P cache-only, computes current fitness, derives redundancy demand `R` from current owned positive-score, non-veto collection members, then resolves `R \ P` cache-only. Preview freezes and discloses exact source-authorized `U0 = deduplicate(Pscope ∪ Rscope)`; start and execution consume only that authorized pair set. Cache growth cannot expand the currently authorized U0; newly eligible work requires a fresh preview and authorization. Owned-local cache-only prediction dependencies are a separate read-only demand: they are not provider/inference authorization and never enter wishlist U0. Wishlist candidate-domain R comparisons are C_ONLY: no candidate note exists, and shared C+D rows cannot be used or requested. Collection-scope authorization remains separate.
- Wishlist candidates are never collection members. R references are only currently owned, scored, positive-score, non-vetoed games; previously-owned games may be P prediction references but are not R members. Candidate factual vectors use the same collection context built from all BGG-bearing collection records, including previously-owned/ineligible records; the candidate is not added to that vocabulary/range context.
- The existing per-pair F/C blend omits unavailable signal and weight together, retaining valid zero. Wishlist O/D is absent. The same candidate-to-owned blended pair comparisons feed the existing candidate fitness/redundancy adjustment and strongest-owned-overlap result; no separate candidate ranker or overlap model is added. Candidate-only pair rows are not passed as an incomplete full-collection pair table. A single shared factual context, memoized vectors and eligible-owned index are reused for a coherent capture; no owned-owned pair work is introduced.
- The current read result and run selector use the strict V2 public contract declared/exported by the shared package. The compact source is daemon-owned and omitted from public wishlist projections. The current storage, route, run-control, cache-scope, and projection behavior is active after Phase 6; this specification remains the authority for the contract, not a claim of live-provider validation.
- If explicit preparation for a legacy candidate cannot establish valid source, disclose it as unavailable and do not fabricate F or send C. Ordinary reads do not hydrate BGG; missing legacy facts become current `missing-source`/unavailable until explicit factual Refresh or authorized run preparation establishes a verified source. Saved prediction snapshots remain historical only and are never rankable as current fallback. If acquisition reconciliation cannot safely finish, the owned/wishlist BGG-ID overlap remains hidden and unsendable as a wishlist candidate; daemon startup must reconcile overlaps before exposing candidate routes.

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

- REQ-WISH-21: The wishlist page supports sorting by date added (default, newest first), current predicted score (descending), name (alphabetical), and current redundancy ordering when enabled. Current prediction sorting uses the current projection, not historical saved `predictedScore`. Redundancy ordering uses current adjusted/base ordering score; unavailable entries sort last. No filtering beyond sorting. The wishlist is expected to be small (tens of entries, not hundreds).

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

- REQ-WISH-26: `shelf-judge wishlist list` text output shows current score/confidence or explicit unavailable state, with name, year, and date added. In `--json` mode, returns the flat current read projection; daemon-owned `bggSource` is omitted.

- REQ-WISH-27: `shelf-judge wishlist add <bgg-id>` prints the created entry summary (name, current predicted score or unavailable) on success. In `--json` mode, it returns the safe public `entry` object from the endpoint response; it contains current legacy aliases or null and omits daemon-private `bggSource`.

### Interactions

- REQ-WISH-28: Wishlist entries are not collection members: they do not affect owned-game fitness, collection profiling, collection niche computation, tournament ranking, or prediction-engine behavior; they do not appear in collection lists or contribute to the profile. The separately approved explicit wishlist-to-eligible-owned redundancy result does not insert candidates into the collection or alter owned-game penalties.

- REQ-WISH-29: Wishlist add, refresh and current reads use the same predictor, axis estimator, readiness and confidence rules as collection prediction; the algorithm is not forked, though the actual-rated reference set is purpose-specific. Candidate factual vectors use the same full collection factual context, including previously-owned/ineligible BGG factual records; actual-rated previously-owned collection games may be prediction references where axis rules allow. Owned-local cache-only prediction may be a calculation dependency of a wishlist read, but does not authorize collection-pair inference in a wishlist run. Reads/add/factual refresh never trigger JEV inference. Wishlist entries are candidates, not collection games, and have no owner notes eligible for O. Only an explicit wishlist-scoped JEV Run may compare a wishlisted candidate with eligible owned games using independent C_ONLY evidence; shared C+D rows are prohibited. It uses persisted source snapshots, sends only disclosed C_ONLY misses, and does not write comparison results into `wishlist.json`. A successful current adjustment uses the current prediction base exactly once; it does not rewrite the saved historic `predictedScore` or double-apply an already-computed penalty.

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
- [ ] Current redundancy projection reports current adjustment, current base prediction, or explicit unavailable; it never falls back to saved historical derived values. Reads do not modify saved JSON; prediction sort uses current prediction.
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
