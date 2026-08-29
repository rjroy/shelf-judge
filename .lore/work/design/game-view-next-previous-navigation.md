---
title: Design for Collection-scoped game detail navigation
date: 2026-08-29
status: implemented
tags: [navigation, game-detail, collection, local-storage, accessibility]
modules: [web-ui]
related:
  - .lore/work/specs/game-view-next-previous-navigation.md
  - .lore/work/brainstorm/game-view-next-previous-navigation.md
  - .lore/work/research/game-view-next-previous-navigation.md
  - .lore/specs/collection/collection-filter-sort.md
  - .lore/work/specs/collection-purchase-utilization.md
---

# Design for Collection-scoped game detail navigation

## Decision

Implement navigation as a browser-only, immutable snapshot produced by the hydrated flat `CollectionTable` projection and consumed by one client boundary around the game-detail breadcrumb and navigation strip.

Store each snapshot in its own versioned `localStorage` record. A changed projection creates a new opaque key; it never updates an existing sequence. Collection row URLs carry `collectionContext=<key>&collectionOrigin=<row-id>`. Previous and Next preserve both parameters. The contextual Collection breadcrumb returns both parameters with the snapshot's URL-owned scope.

No daemon, shared-domain, or game-detail collection fetch is added. The existing game route remains authoritative and usable without browser context.

## Existing Boundaries

`packages/web/components/collection-table.tsx` already owns the effective sequence:

1. select standard or prediction-enriched source games;
2. merge optional niche data;
3. apply ordinary client filters;
4. apply ownership scope;
5. apply missing-dimensions scope;
6. call `sortGames` to obtain `withValue` and `withoutValue`;
7. render `withValue`, the optional separator, and `withoutValue`.

The snapshot producer will consume those same two arrays as `[...withValue, ...withoutValue]`. It will not call another projection helper or reimplement a comparator.

`packages/web/app/games/[id]/page.tsx` remains a server component that fetches one game and supporting detail data. It will pass raw optional query values to a client boundary. The server does not read browser storage, load the collection, or derive neighbors.

`packages/web/app/collection/page.tsx` remains responsible for URL-owned ownership and dimensions scope. It passes optional contextual-return parameters to `CollectionTable` and supplies the semantic heading used by focus fallback.

## Snapshot Store

Add `packages/web/lib/collection-navigation-context.ts` as the only storage and validation boundary. Its mutating operations are asynchronous because cross-tab create, refresh, and cleanup run inside one named Web Lock.

### Stored Shape

```ts
interface CollectionNavigationContextV1 {
  version: 1;
  key: string;
  entries: Array<{ id: string; name: string }>;
  collectionScope: {
    showPreviouslyOwned: boolean;
    missingDimensionsOnly: boolean;
  };
  projection: {
    sort: SortState;
    filters: FilterState;
    predictionsOn: boolean;
    effectivePredictionsOn: boolean;
    nichesOn: boolean;
  };
  lastAccessedAt: number;
}
```

`nicheViewMode` is not stored because grouped mode never produces a snapshot; contextual return always restores the flat mode. `predictionsOn` records the user's toggle, while `effectivePredictionsOn` records whether prediction-enriched rows actually supplied the projection after integrated-redundancy behavior was applied. The ordered entries remain the historical traversal truth even when current server data later changes.

The context excludes scores, ratings, BGG data, and other game records. Detail needs only stable IDs and display names. Return needs only the projection controls and URL scope.

### Per-context Keys

Each record uses a prefix such as:

```text
shelf-judge-collection-navigation:v1:<opaque-key>
```

There is no shared registry object. A whole-registry read-modify-write can lose one tab's new context when another tab writes concurrently. Independent records allow tabs to create immutable sequences without overwriting each other.

The opaque key comes from `crypto.randomUUID()`. Store helpers receive an injectable storage object, clock, and key generator for deterministic tests. A key is accepted only as an opaque identifier matching the generated format; it can never select an arbitrary `localStorage` name.

### Creation And Immutability

`createCollectionNavigationContext(input)`:

1. validates projection state, scope, nonempty entry IDs and names, and uniqueness of all entry IDs;
2. generates a collision-free opaque key without replacing an existing record;
3. writes one complete versioned record;
4. reads it back or otherwise confirms the write succeeded;
5. runs retention cleanup;
6. returns the key only on success.

Any failure returns `null`. Collection keeps every row href plain until one complete snapshot succeeds. There is no partial contextual state.

An existing key's ordered entries and projection fields are never changed. Access refresh may rewrite only `lastAccessedAt` on the same validated record.

### Resolution And Retention

`resolveCollectionNavigationContext(key, options)` validates untrusted stored JSON before returning it. Resolution rejects unsupported versions, malformed fields, duplicate entry IDs, expired records, and a requested current or origin ID that does not occur exactly once.

Creation sets `lastAccessedAt`. Successful detail resolution and successful contextual-return resolution attempt to refresh it. Rendering Collection links does not. If validation and reading succeed but the refresh write fails, the resolver returns the already-read context for the current page and leaves the stored timestamp unchanged.

Every create or resolve requests the exclusive `shelf-judge-collection-navigation` Web Lock. Within that lock:

1. read and validate the requested or newly written record;
2. reject and remove it if its stored timestamp was already expired at operation start;
3. for a valid resolution, refresh `lastAccessedAt` to `max(stored timestamp, current clock)` before LRU selection;
4. re-read the successfully refreshed record, or retain the already-read record for this page if refresh alone failed;
5. scan only feature-prefixed records, remove malformed and expired records, and retain the 20 newest timestamps;
6. prefer the context being resolved when timestamps tie so the operation does not immediately evict its own valid result.

The exclusive lock prevents two tabs from applying stale access timestamps out of order and makes the 20-record postcondition exact when the operation completes. Independent records still prevent any sequence payload from being overwritten. If Web Locks are unavailable or lock acquisition fails, creation fails to plain links. Resolution may return a valid immutable record for the current page without refreshing or cleaning it; it does not attempt an unlocked write. This fallback preserves navigation without making unsupported cross-tab mutation guarantees.

Storage absence, access exceptions, quota failure, malformed JSON, and cleanup failure are contained inside this utility. Failure degrades to plain links or absent navigation.

## Deterministic Collection Ordering

`packages/web/lib/collection-utils.ts` needs one behavioral correction before adjacency depends on generic sorts.

Add one identity tie comparator that compares:

1. NFC-normalized game name by Unicode code point ascending;
2. stable game ID by Unicode code point ascending.

All generic `withValue` comparisons use the selected field and direction first, then this identity comparator without reversing it. `withoutValue` uses the identity comparator directly. The specialized value-remaining and estimated-additional-plays sorts already use this rule and should share the helper rather than duplicate it.

For Name sort, the existing case-insensitive primary value remains the primary user-facing order. Names equal under that primary comparison use normalized original name and ID as the stable tie. This narrows the change to deterministic equality rather than redefining alphabetical behavior.

## Collection Producer

### Projection Fingerprint

`CollectionTable` derives a canonical fingerprint from everything that identifies the ready flat projection:

- ordered entry IDs and names from `[...withValue, ...withoutValue]`;
- sort field and direction;
- all ordinary filters;
- ownership and dimensions scope;
- `predictionsOn` and the effective prediction-source state;
- `nichesOn`;
- flat versus grouped mode.

The fingerprint is internal component identity, not persisted protocol. A plain stable serialization is sufficient because collection sizes are small; no cryptographic hash is required.

Add `packages/web/lib/collection-navigation-producer.ts` for a small pure producer state machine plus its React hook. The state machine records the current fingerprint, the attempted fingerprint, and an optional successful `{ fingerprint, key }`. It accepts projection-change, persistence-success, and persistence-failure events; success for an obsolete fingerprint cannot activate a key. Its selector returns a key only when the caller's current fingerprint exactly matches the successful fingerprint.

`CollectionTable` uses that producer. A row receives contextual parameters only when all of these are true:

- client preference hydration completed;
- mode is flat;
- current projection has at least one entry;
- persistence returned a key;
- the active fingerprint exactly equals the current render's fingerprint.

This equality check is essential. React effects run after render, so state may still hold the old key during a sort or filter update. A mismatched fingerprint makes all newly rendered links plain immediately; an effect then persists the new projection and activates its new key.

### Effect Lifecycle

One effect creates a snapshot for a hydrated flat fingerprint. The producer records an attempt before awaiting asynchronous Web Lock/storage work, so development effect replay does not consume duplicate keys. A changed fingerprint clears contextual eligibility by derivation, receives a new creation attempt, and switches all flat links together only after successful persistence. A late success for an older projection remains stored for links already copied or opened but cannot activate on the current Collection render.

If creation fails, the attempted fingerprint remains context-free for that render lifecycle. A later genuine projection change retries with a new fingerprint. The implementation need not retry continuously and churn storage.

The source arrays and projection state may change quickly while typing search text. Each committed ready projection may create a context; seven-day/20-record cleanup bounds this behavior. Debouncing would leave hrefs out of sync with visible rows and is not used.

### Row Rendering

`GameRow` receives a complete `href` prop rather than reading ambient navigation state. Flat call sites construct contextual hrefs from the active key and each row's own ID as `collectionOrigin`. Grouped-by-niche call sites pass plain `/games/{id}` hrefs explicitly.

The same `withValue` and `withoutValue` arrays feed both row rendering and snapshot entries. This makes sequence parity structural rather than a test-only comparison between two algorithms.

Flat row links receive stable DOM IDs derived from game ID so contextual return can focus their primary actionable element. Grouped duplicates do not receive return targets.

### Empty Collection

`CollectionPage` no longer returns before mounting `CollectionTable` when the server list is empty. It always renders the semantic topbar heading and the client component; topbar actions may remain conditional on games being present. After running the same hydration or contextual-return path, `CollectionTable` renders the existing "No games yet" panel instead of controls and rows when the collection is empty.

Keeping the client boundary mounted allows a deleted final origin to resolve return context, restore preferences, focus the heading, and remove transport parameters. It also avoids a second return-consumption implementation for the empty branch. When the server collection is empty, structural and scope validation take precedence over row-derived capability checks because no sort control or row projection is visible: the snapshot state is restored, the empty panel is shown, and the heading is focused even if a BGG, tournament, prediction, or niche capability disappeared with the final game.

## Contextual Collection Return

### Server Scope First

The detail navigation boundary builds the breadcrumb destination from the validated snapshot's URL scope:

```text
/collection?ownership=all&dimensions=missing&collectionContext=<key>&collectionOrigin=<origin>#<row-target>
```

Only active scope parameters are included. `collectionContext` and `collectionOrigin` are transport parameters, not Collection preference ownership.

`CollectionPage` parses query parameters without accepting duplicate-array values. It uses ownership and dimensions normally for server fetching, then passes singular raw context/origin values to `CollectionTable`.

On mount, `CollectionTable` attempts contextual-return resolution before normal preference loading. Return is valid only when:

- context and origin validate;
- origin occurs exactly once in the snapshot;
- server-parsed ownership and dimensions flags equal the snapshot scope.
- the stored sort field still exists in the current enabled-axis and available tournament/BGG sort definitions;
- every stored enabled enrichment source is currently available;
- applying the stored user prediction toggle under the current integrated-redundancy setting produces the same effective prediction-source state recorded by the snapshot.

If valid, one state update restores sort, filters, `predictionsOn`, `nichesOn`, and flat mode, then marks hydration complete. It also persists restored sort and filters through their existing preference keys. If invalid, existing `loadSort()` and `loadFilters()` behavior applies.

The snapshot therefore records both the user's prediction-toggle state and whether prediction-enriched rows were effectively used. Niche return requires current niche-enriched data when `nichesOn` was stored. Removed or disabled axis sorts, unavailable tournament/BGG sort capabilities, unavailable enrichment data, or changed integrated-redundancy behavior invalidate contextual return rather than displaying one control while computing another order. The exception is a completely empty server collection, where no controls or rows are displayed and structurally valid snapshot state is restored only to satisfy the explicit return contract. On a later ordinary nonempty load, persisted sort hydration validates the field against then-current capabilities and normalizes an unavailable field to `DEFAULT_SORT` before rendering controls. This does not invalidate historical detail traversal, which uses the stored entries directly.

When singular context and origin parameters identify a return attempt, the server and initial client render show a neutral "Restoring collection..." status in the main content region instead of default controls, rows, fragments, or the empty panel. After resolution, one committed state reveals either the restored projection or the ordinary persisted-state fallback. Collection requests without a contextual-return attempt retain their existing server/default initial rendering. This prevents the browser from fragment-scrolling or exposing a guessed default projection before restoration.

### Focus And URL Cleanup

After hydrated projection commit, a one-shot effect checks whether the origin row exists in the current flat arrays:

- present: focus its primary row link;
- absent because of current data, ownership, filters, or deletion: leave every restored control unchanged and focus the Collection heading.

The heading becomes a semantic `h1` with `tabIndex={-1}` and a stable ID. Programmatic focus follows the existing profile drilldown pattern. Row and heading focus receive visible focus styling.

After the return state and focus target are resolved, `window.history.replaceState` removes `collectionContext` and `collectionOrigin` from the Collection URL while preserving ownership, dimensions, and the row fragment. This prevents a later reload from unexpectedly reapplying an old projection after the user changes controls. It does not add another history entry or delete the stored snapshot.

## Detail Consumer

Add `packages/web/components/game-detail-collection-navigation.tsx` as a single client boundary responsible for:

- the existing topbar breadcrumb;
- the existing `GameActions` slot passed from the server page;
- optional Previous/Next strip;
- context resolution and access refresh;
- contextual breadcrumb construction.

One boundary avoids reading and refreshing the same record independently for breadcrumb and navigation, and prevents those surfaces from disagreeing after a storage failure.

`GameDetailPage` accepts `searchParams` alongside `params`. It passes only singular string values for `collectionContext` and `collectionOrigin`; duplicate values are treated as absent. Raw values remain untrusted until the client utility validates them.

The boundary's initial render reproduces the current plain `/collection` breadcrumb and omits the strip. After hydration it resolves context against both the current route game ID and origin. Every valid context and origin, including a one-entry sequence, produces a contextual model:

```ts
interface DetailCollectionContextModel {
  collectionHref: string;
  contextKey: string;
  originId: string;
  navigation: {
    previous: { id: string; name: string } | null;
    next: { id: string; name: string } | null;
  } | null;
}
```

The contextual breadcrumb uses `collectionHref` whenever this model exists. `navigation` exists only for sequences of at least two games. Previous and Next hrefs preserve key and origin while changing the route game ID, and first/last boundaries render non-focusable text. A one-entry sequence therefore restores Collection context but renders no strip. Invalid current/origin membership, unavailable storage, or invalid context produces no model, no strip, and the plain breadcrumb.

The strip is inserted between the topbar and `GameDetailMain`, outside the scroll owner. Existing missing-game behavior returns before this boundary and remains unchanged. Tournament, niche, redundancy, profile, capacity, wishlist, search, and score-reference links remain plain unless they originate from the Collection row path.

## Presentation

Add styles in `packages/web/app/globals.css` near existing detail and responsive sections.

Desktop strip:

- fixed-height sibling between topbar and `.main-scroll` with `flex-shrink: 0`;
- two equal `min-width: 0` regions;
- Previous aligned left and Next aligned right;
- direction label plus destination name;
- boundary text occupying the same region.

Phone/tablet strip:

- two equal-width regions;
- at least 44px actionable height;
- destination text visually ellipsized inside a `min-width: 0` child;
- full direction and name retained in `aria-label`;
- no dependence on hover, swipe, icon, or color.

Links get explicit `:focus-visible` treatment. Boundary text is not a link, button, or tab stop. Long-name geometry is measured rather than hidden with page-level `overflow-x` clipping.

## Testing Design

### Pure Unit Tests

Add `packages/web/tests/collection-navigation-context.test.ts` with injected in-memory storage, clock, key generator, and lock runner. Cover:

- valid create/resolve;
- malformed JSON and every invalid field;
- unsupported schema;
- duplicate entry IDs;
- absent/duplicate current and origin membership;
- seven-day boundary;
- creation/detail/return access semantics;
- valid-read refresh-write failure;
- deterministic 20-record cleanup;
- refresh-before-cleanup ordering and retention of the requested context;
- monotonic serialized timestamps from competing-tab operations;
- unavailable-lock read-only resolution and failed creation;
- collision handling;
- write/read/quota exceptions;
- independent keys and immutable payloads.

Extend `packages/web/tests/collection-table.test.ts` for generic equal-primary-value ties, NFC-equivalent names, stable-ID fallback, direction-independent ties, and no-value ties. Existing filter, scope, and specialized-sort tests remain evidence for projection semantics.

Add `packages/web/tests/collection-navigation-producer.test.ts` for the pure producer state machine and structural sequence helpers. Cover pre-hydration ineligibility, grouped ineligibility, attempt deduplication, all-links activation only after success, failed persistence, immediate old-key rejection on fingerprint change, ignored late success, new-key activation, separate instances, and exact snapshot-entry order from the same valued/no-value arrays rendered by Collection.

Add `packages/web/tests/game-detail-collection-navigation.test.tsx` around exported pure model and presentational rendering. Cover middle, boundaries, two games, one game, preserved origin, exact hrefs and accessible labels, and omitted invalid states.

Extend `packages/web/tests/game-links.test.tsx` with negative assertions that unrelated detail links do not gain context parameters.

### Browser Tests

Expand `packages/web/e2e/fixture-daemon.ts` with deterministic multi-game list/detail endpoints and existing Collection dependencies. Fixtures include:

- valued and no-value rows;
- equal primary values and names;
- previously owned and missing-dimensions games;
- standard and prediction-enriched values;
- niche enrichment with duplicate grouped membership;
- long adjacent names;
- an unavailable/deleted detail target.

Add `packages/web/e2e/collection-navigation.pw.ts` for real hydration and focus behavior:

- exact filtered/sorted traversal;
- specialized sort order;
- ownership and dimensions scope;
- first/last/no-wrap behavior;
- reload and same-browser new tab;
- isolated browser context without stored snapshot;
- another tab changing persisted preferences while an active chain stays stable;
- explicit return restoring controls and focusing origin;
- origin excluded or deleted after mutation, preserving controls and focusing heading;
- grouped-by-niche omission;
- persisted snapshot IDs exactly matching flat DOM row IDs;
- all links switching together only after persistence;
- injected storage-write failure leaving every link plain;
- projection changes exposing no old-key/new-row combination;
- development effect replay creating no duplicate key for one fingerprint;
- an empty collection after final-origin deletion restoring state, focusing heading, and consuming return parameters;
- unavailable sort/enrichment capability falling back without inconsistent controls;
- keyboard order, focus visibility, accessible names, 44px targets, and overflow matrix.

The existing `200-percent` Playwright project uses a 720x450 CSS viewport with device scale factor 2 rather than changing Chromium's browser-zoom control. It provides the effective layout dimensions of 1440x900 at 200% for automated geometry checks. Final acceptance should additionally set Chromium to literal 200% zoom from 1440x900 if the browser runner can drive that control reliably; otherwise record the effective-dimension automated evidence and a manual literal-zoom observation rather than claiming device scale factor is identical to browser zoom.

## Failure Behavior

| Failure                                             | Result                                                                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Context write fails                                 | Collection rows remain plain links.                                                                                                                                            |
| Stored JSON is corrupt or unsupported               | Detail uses plain breadcrumb and no strip; cleanup may remove the record.                                                                                                      |
| Valid read succeeds but timestamp refresh fails     | Current page uses the context; stored expiry does not advance.                                                                                                                 |
| Context or origin query is duplicated or malformed  | Treat context as absent.                                                                                                                                                       |
| Current or origin ID is not unique in snapshot      | Treat context as invalid.                                                                                                                                                      |
| Adjacent target was deleted                         | Existing game-detail error behavior handles the destination.                                                                                                                   |
| Origin is absent from restored current projection   | Keep restored controls and focus Collection heading.                                                                                                                           |
| Final origin was deleted and Collection is empty    | Structural/scope validity overrides missing row-derived capabilities: restore snapshot state, render the empty panel, focus Collection heading, and consume return parameters. |
| Stored sort or enrichment capability is unavailable | Treat contextual return as invalid and reveal ordinary persisted-state Collection without mismatched controls.                                                                 |
| Context expires or is evicted in another tab        | Current mounted model may continue; a later route load degrades to plain detail.                                                                                               |
| Projection changes before new snapshot persists     | Newly rendered rows are immediately plain, never attached to the old key.                                                                                                      |

## Changed Surface

Production:

- modify `packages/web/lib/collection-utils.ts`;
- add `packages/web/lib/collection-navigation-context.ts`;
- add `packages/web/lib/collection-navigation-producer.ts`;
- modify `packages/web/components/collection-table.tsx`;
- add `packages/web/components/game-detail-collection-navigation.tsx`;
- modify `packages/web/app/collection/page.tsx`;
- modify `packages/web/app/games/[id]/page.tsx`;
- modify `packages/web/app/globals.css`.

Validation:

- add `packages/web/tests/collection-navigation-context.test.ts`;
- add `packages/web/tests/collection-navigation-producer.test.ts`;
- modify `packages/web/tests/collection-table.test.ts`;
- add `packages/web/tests/game-detail-collection-navigation.test.tsx`;
- modify `packages/web/tests/game-links.test.tsx`;
- modify `packages/web/e2e/fixture-daemon.ts`;
- add `packages/web/e2e/collection-navigation.pw.ts`.

No production daemon, shared package, dependency, proxy, or database change is required.

## Rejected Alternatives

### Shared Registry Object

One `localStorage` object is convenient for cleanup but permits cross-tab lost updates. Per-context records better preserve immutable chains.

### Reconstruct On Detail

Fetching the collection and rerunning filters/sorts in detail duplicates ownership, creates hydration ambiguity, and can disagree with the originating rendered sequence.

### Encode The Sequence In The URL

This preserves cross-browser sharing at the cost of long, stale URLs and reverses the established local preference contract. It is outside the product goal.

### Keep One Mutable Key Per Collection Tab

Updating a key when the projection changes would silently reorder already-open detail chains. New projection, new key is the required invariant.

### Browser History State

History state does not reliably preserve modifier-click, copy-link, reload, and new-tab behavior.

### Debounced Context Creation

Debouncing reduces writes but creates a period where contextual hrefs represent a previous projection or no longer match visible rows. Immediate plain-link fallback plus bounded creation is safer.

## Consequences

The design adds a small browser-state subsystem and true browser tests, but keeps sequence authority in one place and prevents detail from becoming a second Collection client. Navigation remains an enhancement: every storage, query, expiry, and mutation failure falls back to stable routes rather than changing application data or inventing adjacency.

The immutable-key rule intentionally retains some stale snapshots. Seven-day expiry and a 20-record cap bound storage. Contextual return may show a restored filter set that no longer contains its origin because current collection data changed; preserving the user's original controls is less surprising than weakening filters behind their back.
