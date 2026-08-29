---
title: Previous and next navigation in game detail
date: 2026-08-29
status: implemented
tags: [navigation, game-detail, collection, sorting, filtering, accessibility]
modules: [web-ui]
related:
  - .lore/work/research/game-view-next-previous-navigation.md
  - .lore/work/brainstorm/game-view-next-previous-navigation.md
  - .lore/specs/collection/collection-filter-sort.md
  - .lore/specs/collection/game-links.md
  - .lore/work/specs/collection-purchase-utilization.md
  - .lore/specs/features/previously-owned.md
req-prefix: GAME-NAV
---

# Previous and next navigation in game detail

## Goal

A user reviewing games from Collection should be able to move through that same result set from game detail without repeatedly returning to Collection, finding the prior row, and opening another game.

"Previous" and "Next" mean the neighboring games in the exact flat Collection view from which the user entered. Search, filters, scope, sort direction, null groups, and specialized sort rules all participate because they determined what the user saw. Navigation does not invent a separate canonical order.

Game detail remains independently useful. A bookmark, shared link, profile link, tournament link, or direct `/games/{id}` visit has no implied Collection sequence and continues to work without Previous or Next controls.

## Examples

### Traverse Filtered Results

The user filters Collection to unplayed two-player games and sorts by play time ascending. They open the third of eight results. Game detail shows the second result as Previous and the fourth as Next. Following either link keeps the same eight-game sequence even if another tab later changes Collection filters.

### Reach A Boundary

The user opens the first game in a sorted Collection sequence. The navigation strip identifies that there is no previous game and links to the next game's name. It does not wrap to the final result. On the last game, the inverse applies.

### Open A Shared Link

Someone opens `/games/{id}` without locally available Collection context. The normal detail page loads with its Collection breadcrumb and no navigation strip. The page does not guess neighbors from default or currently persisted preferences.

## Core Rule

Collection owns the ordered sequence. After Collection has hydrated its client-owned state and computed the flat rows it will display, it records an ephemeral navigation snapshot and adds the snapshot's opaque key to those row links. Each row URL also identifies that row as the return origin. Game detail reads the snapshot to find the current game and its adjacent entries.

The snapshot is immutable for the resulting detail-navigation chain. It is disposable browser UI state, not durable application data. Losing it removes the navigation enhancement but never affects games, ratings, collection settings, or the stable game route.

## Visible Behavior

### Collection Entry

Every game link in the ordinary flat Collection result receives the current context key and its own game ID as the return origin once Collection has hydrated and successfully recorded the exact rendered sequence. Before that state is ready, or if persistence fails, links remain normal `/games/{id}` links. A fast pre-hydration click may therefore open detail without adjacent navigation, but it must never open detail with neighbors from the wrong default order or an unresolvable key.

Search; rated, played, and player-count filters; ownership scope; missing-dimensions scope; prediction and niche enrichment that affect displayed values; the selected sort and direction; and the valued/no-value split all affect the recorded sequence. The sequence is the concatenation of the rendered valued and no-value groups in their displayed order.

"Group by Niche" does not produce a context. A game may occur in more than one niche group, so that view has no single honest previous or next game. Links in grouped mode remain ordinary game-detail links.

### Game Detail Controls

A valid context for a sequence of at least two games adds a dedicated navigation strip immediately below the existing detail topbar. Previous occupies the left side and Next the right side. Available destinations are normal links and include the destination game name.

At a boundary, the unavailable side remains visible as non-link text so the strip does not jump between games. It says "No previous game" or "No next game." The sequence does not wrap. A valid one-game sequence and any invalid or unavailable context omit the strip entirely.

Following Previous or Next carries the same context key and the initially opened return-origin game ID. The origin does not move as the user traverses the chain. The target game route remains `/games/{id}` with context and origin as optional query parameters; neither is part of game identity.

### Returning To Collection

When context and return origin are valid, the Collection breadcrumb returns to the originating Collection scope and carries enough context to restore the originating client-owned view. Collection restores the snapshot's sort, filters, and projection-affecting toggles before revealing the origin row and moving focus to that row's primary game link. URL-owned ownership and missing-dimensions scope are restored in the return destination.

Browser Back remains the preferred path when the user wants exact browser-maintained scroll restoration. The explicit breadcrumb restores the row, not a historical pixel coordinate, because layout and data may have changed.

If return context or origin is missing, expired, corrupt, version-incompatible, or inconsistent, Collection loads its normal URL and persisted state. It does not fail the page or promise row restoration. No dedicated warning is required for this fallback.

If context and origin are valid but current data no longer places the origin in the restored projection, Collection still restores the originating scope and controls but does not weaken filters or alter scope to reveal the game. This includes ownership and filter-affecting mutations as well as deletion. Focus moves to the Collection page heading instead of a row, with no dedicated warning required.

## Context Lifetime And Changes

Navigation contexts are available across reloads and same-browser tabs. Creation sets a context's last-access time. Successfully resolving a context for game-detail navigation or contextual Collection return refreshes that time; rendering Collection links without following them does not. Contexts expire seven days after that timestamp, and the browser retains at most the 20 contexts with the newest timestamps. Cleanup occurs whenever contexts are read or written. If a valid read succeeds but refreshing its timestamp fails, that page may use the already-read context, while future expiry and eviction continue to use the last timestamp successfully stored.

Each distinct ready projection receives a new opaque context key and immutable snapshot. When a Collection view changes sort, filters, scopes, or projection-affecting toggles, its links switch to a newly persisted key only after the new displayed projection is ready. Previously issued keys and already-open detail chains continue resolving to their original snapshots until expiry or least-recently-used eviction. Multiple Collection tabs therefore do not overwrite each other's sequences.

Once the user enters detail, the sequence is stable. A sort or filter change in another tab, an ownership change, a rating change, or another game-data mutation does not reorder that chain. Returning to Collection and entering again establishes context from the then-current view.

If the current game's ownership or data changes while detail remains open, navigation continues through the recorded sequence. If an adjacent target was deleted or became unavailable, following its normal link uses the existing game-detail error behavior. Navigation does not prevalidate or silently skip snapshot entries.

If the current game is absent from the named snapshot, the context does not apply and the navigation strip is omitted. This covers hand-edited URLs, corrupt data, unrelated context keys, and links copied onto another game route.

## Direct Entry And Sharing

- Direct game-detail entry without a context has no adjacent navigation.
- Reloading a contextual game URL in the same browser preserves navigation while the context remains valid.
- Opening a contextual Collection link in a new tab in the same browser preserves navigation.
- Copying a contextual URL to another browser still opens the game but has no navigation when that browser lacks the snapshot.
- Failure to create or read a context because browser storage is blocked, unavailable, full, or corrupt degrades to ordinary Collection and game-detail links without an application error. If a valid context was read but only its access-time refresh fails, the current page still uses that context under REQ-GAME-NAV-10.
- Links to game detail from Profile, Tournament, Search, Capacity, Wishlist, and within game detail do not acquire Collection context merely because another context exists in storage.

## Responsive And Accessible Presentation

The navigation strip is separate from game actions. On desktop it shows directional labels and destination names in left- and right-aligned regions. On narrow screens it uses two equal-width regions, permits destination-name truncation visually, and retains the full destination in the accessible name.

Available controls are semantic links that preserve reload, browser history, modifier-click, copy-link, and new-tab behavior. Unavailable boundary states are not focusable and are not styled as actionable links.

Keyboard users can reach Previous and Next in logical order and see a visible focus indicator. Each actionable target is at least 44 by 44 CSS pixels. Direction is communicated by text, not icon or color alone. The strip does not create horizontal overflow at 375x812, 768x1024, 1440x900, or 200% zoom.

## Scope Boundaries

- This feature does not make Collection views shareable across browsers.
- It does not move sort or ordinary filters into the URL.
- It does not add adjacent navigation to grouped-by-niche results.
- It does not define niche, redundancy, tournament, profile, search, capacity, or wishlist links as a Collection sequence.
- It does not wrap at sequence boundaries.
- It does not prefetch or prevalidate destination games.
- It does not guarantee exact pixel scroll restoration after Collection remounts.
- It does not turn sequence position into a recommendation, rank, or universal collection position.

## Requirements

### Sequence And Entry

- **REQ-GAME-NAV-1:** Previous and Next use the exact ordered flat result rendered by the originating Collection view after all active filters, URL scopes, projection-affecting toggles, sort rules, and valued/no-value grouping are applied.
- **REQ-GAME-NAV-2:** Collection records navigation context only after client-owned state has hydrated; before then, every row remains a valid plain game-detail link and no default-order context is exposed.
- **REQ-GAME-NAV-3:** After successful context persistence, every game link in a hydrated ordinary flat Collection result carries the new opaque context key and that row's game ID as the return origin; if persistence fails, every link remains context-free.
- **REQ-GAME-NAV-4:** Grouped-by-niche game links do not carry Collection navigation context.
- **REQ-GAME-NAV-5:** Equal sort values have deterministic adjacency. Collection uses ascending NFC-normalized game name and then stable game ID as total-order tie-breakers without reversing those tie-breakers when primary sort direction changes; the no-value group uses the same tie rule.
- **REQ-GAME-NAV-6:** Collection-origin context is added only by Collection result links. Other links to `/games/{id}` remain context-free unless they are already continuing a valid Previous/Next chain.

### Context Integrity

- **REQ-GAME-NAV-7:** A context records a schema version, opaque key, ordered game IDs and display names, originating Collection URL scope, originating client sort and filters, projection-affecting toggle state, and last-access time. The return origin is carried separately in each contextual row URL.
- **REQ-GAME-NAV-8:** A context is valid for game detail only when its schema is supported, its data is well-formed, it is unexpired, its ordered entries contain the route's current game ID exactly once, and any supplied return origin also occurs exactly once.
- **REQ-GAME-NAV-9:** Contexts are immutable while traversing detail. Previous and Next links preserve the same context key and initially opened return origin and never substitute ambient localStorage preferences.
- **REQ-GAME-NAV-10:** Creation sets last access; successful detail or contextual-return resolution refreshes it; mere link rendering does not. Contexts expire seven days after the last successfully stored access, at most 20 contexts with the newest access times are retained, and read/write cleanup removes expired and least-recently-used excess entries. A failed access-time refresh does not invalidate the context already read for the current page.
- **REQ-GAME-NAV-11:** Missing, malformed, expired, version-incompatible, inaccessible, or unwritable context storage causes no page error and no fallback neighbor order.
- **REQ-GAME-NAV-12:** Every changed ready Collection projection receives a newly persisted key before its links switch context. Previously issued keys remain immutable and usable until normal expiry or eviction, so projection changes and separate tabs do not replace active chains.

### Detail Navigation

- **REQ-GAME-NAV-13:** A valid context containing at least two games renders a navigation strip directly below the detail topbar.
- **REQ-GAME-NAV-14:** For a non-boundary game, the strip links to the immediately preceding and immediately following snapshot entries and displays both destination game names.
- **REQ-GAME-NAV-15:** At the first game, the Previous region displays non-focusable text "No previous game"; at the last game, the Next region displays non-focusable text "No next game."
- **REQ-GAME-NAV-16:** Navigation never wraps from first to last or last to first, and a one-game context omits the strip.
- **REQ-GAME-NAV-17:** An absent current ID, duplicate current ID, or otherwise invalid context omits the strip rather than guessing a position.
- **REQ-GAME-NAV-18:** Following an entry that has since become unavailable delegates to existing game-detail error behavior; it is not silently skipped or replaced.
- **REQ-GAME-NAV-19:** Mutations to game data, ratings, ownership, or another tab's Collection settings do not reorder an active detail chain.

### Reload, Tabs, And Return

- **REQ-GAME-NAV-20:** A valid context survives game-detail reload and opening a Collection game link in a same-browser new tab.
- **REQ-GAME-NAV-21:** A game URL opened where its context is unavailable still loads the same game without the navigation strip.
- **REQ-GAME-NAV-22:** With valid context and origin, the Collection breadcrumb restores the originating ownership and dimensions URL scope plus originating sort, filters, and projection-affecting toggles before focusing the origin row's primary game link.
- **REQ-GAME-NAV-23:** Contextual return restores a stable game row rather than a stored pixel coordinate; normal browser Back behavior remains unchanged.
- **REQ-GAME-NAV-24:** Invalid context or origin returns Collection to its normal URL and persisted preferences. If valid restored controls and current data exclude or no longer contain the origin, Collection keeps those restored controls, does not weaken them to reveal the game, and focuses the Collection heading. Neither fallback causes an application error or requires a warning.

### Accessibility And Layout

- **REQ-GAME-NAV-25:** Available Previous and Next destinations are semantic links supporting keyboard activation, browser history, reload, modifier-click, copy-link, and new-tab behavior.
- **REQ-GAME-NAV-26:** Link accessible names include direction and full destination game name; visual truncation does not truncate the accessible name.
- **REQ-GAME-NAV-27:** Available links have visible focus indicators and targets of at least 44 by 44 CSS pixels; boundary text is not focusable or presented as actionable.
- **REQ-GAME-NAV-28:** Direction and availability are understandable without color or icon recognition.
- **REQ-GAME-NAV-29:** The detail page has no horizontal overflow at 375x812, 768x1024, 1440x900, or at 200% browser zoom from a 1440x900 viewport with long adjacent game names.

## AI Validation

### Automated Behavior

1. Add unit tests for context parsing, exact-once current-ID and origin validation, schema mismatch, malformed JSON, unavailable storage, seven-day expiry, the defined access refresh events, failed refresh writes, 20-context least-recently-used eviction, immutable old keys, and separate keys.
2. Add projection tests for every Collection filter and URL scope, both sort directions, valued/no-value concatenation, generic equal-value ties, duplicate normalized names, stable-ID ties, value-remaining categories, estimated-additional-plays categories, and projection-affecting toggles. Assert that snapshot IDs exactly equal rendered flat row IDs.
3. Add Collection component tests showing plain links before hydration and after failed persistence; contextual links with per-row origins after successful persistence; a new immutable key after a projection change while the old key remains unchanged; separate context keys for separate mounts; and plain links in grouped-by-niche mode.
4. Add game-detail navigation tests for middle, first, last, two-game, one-game, absent-current-ID, duplicate-current-ID, expired, malformed, and unavailable-storage contexts. Assert exact hrefs, destination names, boundary text, non-wrapping behavior, and strip omission.
5. Add return tests proving URL-owned scope and client-owned sort, filters, and projection-affecting toggles restore before the origin row's primary link receives focus. Cover traversal retaining the initially opened origin, another tab changing persisted preferences, invalid context or origin falling back normally, and current data excluding or deleting the origin while restored controls remain unchanged and heading focus is used.
6. Preserve existing tests proving non-Collection links remain plain `/games/{id}` destinations and existing missing-game behavior remains authoritative.

### Browser Acceptance

Use the existing Playwright fixture-daemon path and pinned browser to verify:

1. Apply search and ordinary filters, select a non-default specialized sort, enter a middle game, and traverse Previous and Next through the exact visible result order.
2. Repeat with `ownership=all` and `dimensions=missing`, including first and last boundaries and no wrapping.
3. Reload a contextual detail page and open a Collection row with modifier-click/new-tab; both retain the same sequence in the same browser context.
4. Open a direct game route, a malformed/expired contextual route, and a contextual route in an isolated browser context; all load detail without misleading adjacent controls.
5. Change Collection preferences in another tab while traversing detail and verify the active chain remains stable. Use the contextual breadcrumb and verify the originating view, not the other tab's preferences, is restored before the row is focused.
6. Activate Group by Niche, open a game, and verify detail has no Collection adjacency.
7. Verify keyboard order, visible focus, full accessible names, non-focusable boundaries, 44px targets, and no horizontal overflow at 375x812, 768x1024, 1440x900, and 200% browser zoom from 1440x900 with long names.

### Quality Gates

Run the repository's changed-file formatting checks, typecheck, lint, web unit/integration tests, browser tests, and production build. Distinguish the known repository-wide formatting baseline from failures introduced by this feature.

## Technical Contract

The context query parameter is `collectionContext`, and `collectionOrigin` carries the initially opened row's stable game ID. The browser store uses a feature-specific versioned key rather than either existing sort/filter key. Stored content and both parameters are treated as untrusted input and validated before use.

Collection is the only producer of a new context. It records the already-computed ordered rows rather than asking game detail to import or rerun Collection sorting. The ordered list contains stable IDs and display names only; it does not duplicate game records or scores. Each changed ready projection is persisted under a new key before links adopt it; an existing key is never overwritten with a different sequence.

The detail server component continues to fetch only the requested game and its existing supporting data. A client navigation boundary reads optional context after hydration and renders the strip. Server rendering and pre-hydration output must not contain guessed neighbors.

Each Collection row href appends the same `collectionContext` value and its own game ID as `collectionOrigin`. Contextual Previous and Next hrefs preserve both values while changing only the stable destination game route. Non-Collection game links and invalid contexts do not copy ambient values.

The contextual Collection breadcrumb carries the key and origin back to `/collection` together with the snapshot's URL-owned scope. Collection consumes that explicit return context before normal persisted sort/filter hydration, persists the restored client state under the existing preference contract, and focuses the origin row's primary game link only after the matching projection renders. If current data excludes that row, the restored state remains active and the Collection heading receives focus. Consuming return context must not delete the snapshot because reload and new-tab detail navigation may still use it.
