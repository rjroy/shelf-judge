---
title: Next and previous navigation from game detail
date: 2026-08-29
status: resolved
tags: [navigation, game-detail, collection, sorting, filtering]
modules: [web-ui]
related:
  - .lore/work/research/game-view-next-previous-navigation.md
  - .lore/brainstorms/collection-filter-sort.md
  - .lore/specs/collection/collection-filter-sort.md
  - .lore/specs/collection/game-links.md
---

# Next and previous navigation from game detail

## The Product Question

The feature is not merely two arrows. It needs to preserve the answer to: "Previous and next within which list?"

When a user enters game detail from Collection, the useful list is the one they were actually looking at: the filtered, ownership-scoped, dimensions-scoped, sorted sequence rendered by Collection. A canonical collection order would be easier to reconstruct, but it would make the controls disagree with the page the user just left. Ignoring ordinary filters would be especially surprising after a search such as "Arkham" or a player-count filter.

The detail route also has an independent job. `/games/{id}` must remain a stable destination from bookmarks, shared links, profile evidence, tournament history, and other non-Collection surfaces. Collection-relative navigation should therefore be optional context attached to a visit, not a new requirement of the game route.

## Context Models Considered

### 1. Origin-Only Navigation Snapshot

Collection computes the visible ordered sequence it already renders, stores a compact snapshot client-side, and adds an opaque context key to each game-detail link. The snapshot contains enough information to render links without recomputing the projection, such as ordered game IDs and names plus the Collection return destination and selected row.

Strengths:

- preserves the exact visible projection, including search, filters, URL-owned scope, null groups, rounded utilization categories, and deterministic ties;
- does not duplicate collection comparators or make detail wait for localStorage hydration before it knows the sequence;
- keeps modifier-click and new-tab navigation when the snapshot store is shared across same-browser tabs;
- allows multiple collection views to coexist if each snapshot has its own key;
- keeps the stable game URL useful when context is absent or expired.

Weaknesses:

- a copied contextual URL does not reproduce navigation on another browser unless the entire snapshot travels in the URL;
- snapshots need bounded retention and graceful handling when browser storage is unavailable;
- mutations can make a snapshot stale;
- navigation controls require a client boundary on an otherwise server-rendered detail page.

This model best matches the user's actual collection view while keeping collection projection ownership in Collection.

### 2. Reconstruct From Persisted Preferences

Detail loads the collection and rebuilds the sequence from `shelf-judge-sort`, `shelf-judge-filters`, and route query parameters.

Strengths:

- direct entry can always offer neighbors based on the user's latest preferences;
- no explicit origin token is needed;
- changes made in another Collection tab could be reflected after recomputation.

Weaknesses:

- detail must fetch and enrich an entire collection to navigate one game;
- it risks duplicating the effective projection currently owned by `CollectionTable`;
- it creates a hydration transition where controls are absent or initially based on defaults;
- the latest persisted preferences are not necessarily the context that led to this detail visit;
- grouped-by-niche mode still cannot become a single unambiguous sequence;
- a filter change elsewhere can move or remove the current game while the user navigates.

This model makes adjacency globally ambient rather than tied to the user's action. That sounds convenient but produces unstable semantics.

### 3. URL-Addressable Projection

Every relevant sort, filter, search, ownership, and dimensions value travels in the detail URL. Detail reloads the collection and reconstructs that projection.

Strengths:

- contextual URLs can be bookmarked and shared;
- new tabs and reloads preserve context without browser storage;
- context is inspectable and deterministic in principle.

Weaknesses:

- it reverses the established decision that ordinary collection sort and filters live in localStorage rather than the URL;
- URLs grow with every filter capability and require versioning;
- exact parity still requires reuse of the complete collection projection and its enrichments;
- a URL describes projection rules, not necessarily the exact historical sequence after collection data changes;
- sensitive or merely noisy search text becomes part of copied URLs and history.

This is appropriate only if shareable collection views become a broader product goal. It is too much architecture for detail adjacency alone.

### 4. History State Only

Collection places the sequence in browser history state while navigating to detail.

This is tempting because the data is visit-scoped and leaves the URL clean. It fails normal link semantics: modifier-click, copy-link, open-in-new-tab, reload behavior, and server rendering become inconsistent. It should not be the primary transport.

### 5. Canonical Unfiltered Neighbors

Detail always navigates the owned collection in a documented default order, regardless of origin.

This is technically simple and gives direct links controls, but the labels "previous" and "next" would quietly change meaning when the user entered from a filtered or differently sorted collection. It solves implementation complexity by discarding the workflow's context, so it is rejected.

## Working Model

Use an origin-only navigation snapshot with an opaque context key.

The conceptual snapshot is:

| Field | Purpose |
|-------|---------|
| Version | Allows incompatible stored shapes to fail closed. |
| Ordered entries | Stable game ID and display name for every visible result. |
| Collection destination | Restores URL-owned ownership and dimensions scope. |
| Projection state | Restores the originating client-owned sort and filters on explicit return. |
| Origin row | Identifies the row to restore or focus when returning. |
| Created or accessed time | Supports bounded cleanup of stale snapshots. |

The URL needs only the context key. The key is navigation enhancement, not game identity. Removing it leaves the same game route.

A localStorage-backed snapshot is preferable to sessionStorage for same-browser new tabs. It must be bounded by count and/or age rather than becoming permanent application data. Failure to read or write storage degrades to an ordinary game detail page. Multiple Collection tabs create separate immutable snapshots instead of mutating one global "current sequence."

The specification and design should confirm whether a snapshot is created whenever the projection changes or only when a game link is activated. Creating it on activation avoids storage churn and captures exactly the sequence used by that click, while link hrefs still need a context key before default browser navigation. A per-render context key with lazy snapshot persistence on pointer, keyboard, or link activation may be too fragile. A bounded snapshot written when the visible projection changes is simpler if writes are small at realistic collection sizes.

## Sequence Semantics

- Ordinary search, rated status, played status, player-count filters, ownership scope, and missing-dimensions scope participate. The sequence is exactly the visible flat Collection result.
- The current Sort By field and direction participate. Existing collection projection code determines order; detail does not implement its own comparator.
- Stable game ID is the final tie-breaker wherever Collection needs a total order. Generic comparators should be audited so repeated renders cannot change adjacency among equal values.
- Grouped-by-niche mode does not provide game-detail adjacency in the first version. A game can appear in several groups, so there is no single honest previous or next. The Collection link remains normal but omits navigation context.
- Empty and one-result projections produce no adjacent destination.
- Boundaries do not wrap. Wrapping hides where the result set begins and ends and can make a small filtered set feel infinite.
- At the first result, Previous is unavailable. At the last result, Next is unavailable. Controls may remain visible but disabled if that improves spatial stability and clearly communicates the boundary.
- Adjacent game names should be visible on desktop where space permits. Mobile may use compact Previous and Next labels, but accessible names should include the destination game name.

## Context Lifetime And State Changes

A snapshot is immutable for the detail-navigation chain. Following Next or Previous carries the same context key, so sequence meaning does not shift between games.

Changes in another Collection tab do not rewrite an in-progress chain. Returning to Collection and entering a game again creates or selects a fresh snapshot from the newly visible projection. This favors predictable traversal over "live" neighbors that can jump while the user is reading.

If the current game no longer belongs to the latest Collection projection, the existing snapshot still explains how the user arrived. Navigation continues using that snapshot until a destination is unavailable. The UI should not claim the game is currently visible under today's filters.

If a target game was deleted or otherwise became unavailable, normal detail-route handling remains authoritative. The first version need not prevalidate every link. A later enhancement could skip invalid entries only if it can do so without fetching each candidate or silently changing the recorded sequence.

If the current game ID is not present in the snapshot, the context is invalid for that page and adjacent controls are omitted. This covers hand-edited URLs, reused keys, corrupt storage, and a context key copied onto another game URL.

Sort or filter changes cannot occur in the same detail view in the first version because those controls belong to Collection. Changes made elsewhere produce a new Collection snapshot and do not mutate this chain.

## Direct Entry, Reload, And Sharing

- Direct entry without a context key shows normal game detail with no Previous or Next controls.
- A reload with a valid same-browser context key restores navigation.
- Opening a Collection game link in a new same-browser tab restores navigation through the shared bounded snapshot store.
- Sharing or opening the URL in another browser still opens the game, but navigation context is unavailable and controls are omitted.
- Missing, expired, malformed, version-incompatible, or storage-blocked context all fail closed without an error page or misleading fallback order.

The absence of adjacent controls is preferable to inventing canonical neighbors. If desired, the page can retain its Collection breadcrumb so a direct entrant can establish context by visiting Collection.

## Return To Collection

The explicit Collection breadcrumb should carry the snapshot's Collection destination and context key, preserving `ownership` and `dimensions` query parameters. Browser Back remains the strongest restoration mechanism because it naturally preserves the mounted Collection page and scroll position.

For explicit return or a remounted Collection page, Collection should restore the snapshot's originating sort and ordinary filters before identifying the originating game row with a fragment or equivalent stable marker. Contextual return deliberately restores that prior view even if another tab has since changed the globally persisted preferences; the restored state becomes the current Collection state. This avoids promising row restoration while leaving the row hidden by unrelated ambient filters.

Exact pixel-coordinate restoration is brittle across responsive layouts and data changes; row restoration is the better fallback. If the context expired, is corrupt, or the row no longer exists, Collection uses its normal persisted state and makes no restoration promise. The specification should define whether that fallback is silent or briefly explains that the previous view is unavailable.

## Control Placement Ideas

The existing detail topbar is already crowded with the Collection breadcrumb and game actions. Previous and Next are traversal controls, not game actions, so forcing them into that row may collapse poorly.

A dedicated navigation strip immediately below the topbar is the leading option:

- desktop: Previous game name on the left, optional position context in the center, Next game name on the right;
- mobile: two equal-width touch targets with compact labels and truncated destination names;
- all viewports: normal links, visible focus styles, at least 44px touch targets, and no horizontal overflow at 200% zoom.

An alternative is side arrows pinned to the viewport. They preserve content space but have weak discoverability, collide with mobile gestures, and become awkward at zoom. Swipe gestures may supplement links later but cannot replace them.

Position text such as "12 of 37" is useful only if the context is valid and the denominator is explicitly the filtered results. It should be optional rather than required for the first version.

## Bad Ideas Worth Keeping Visible

- Put the entire ordered ID list in every game URL. This is portable but creates enormous, stale, leak-prone URLs.
- Infer adjacency from browser Back and Forward. Those traverse visit history, not collection order.
- Use whatever sort localStorage contains at the moment each detail page mounts. This makes Next change meaning mid-chain.
- Wrap at both ends. This obscures boundaries and can trap users in a cycle detached from Collection.
- Skip grouped-mode duplicates by first occurrence. The chosen occurrence would be arbitrary and would silently turn a grouped exploration into a flat ranking.
- Prefetch every adjacent detail to discover deletions. This adds network work to solve an uncommon stale-context case already handled by routing.

## Decisions Established Here

1. Adjacency means the exact visible flat Collection projection at the time context is captured.
2. Ordinary filters and search participate, as do ownership and missing-dimensions scope.
3. Context is origin-only and snapshot-based, carried by an opaque key rather than reconstructed from ambient preferences.
4. Direct and shared game links remain valid without contextual navigation.
5. Same-browser new tabs should preserve context; storage failure or expiration removes the enhancement.
6. A navigation chain uses one immutable sequence even if Collection state changes elsewhere.
7. First and last boundaries do not wrap.
8. Grouped-by-niche mode does not provide adjacency in the first version.
9. Missing targets use existing detail-route handling; invalid context never invents fallback neighbors.
10. Browser Back preserves exact scroll when available; explicit contextual Collection return restores URL scope, originating client sort and filters, and the origin row rather than a pixel coordinate.
11. Controls are normal accessible links in a dedicated responsive navigation strip, not swipe-only or overloaded game actions.

## Specification Handoff

The specification should turn the working model into verifiable behavior while leaving storage shape and component extraction to design. It must define:

- when snapshots are written and how keys are attached to every relevant Collection game link without breaking normal link behavior;
- bounded retention, version mismatch, unavailable storage, corrupt context, absent current ID, and unavailable target behavior;
- exact inclusion of all flat filters and scopes and explicit exclusion of grouped-by-niche mode;
- immutable-chain behavior across sort, filter, ownership, game-data, and deletion changes;
- first, last, one-result, empty, direct-entry, reload, same-browser new-tab, and cross-browser sharing behavior;
- responsive placement, destination naming, keyboard behavior, focus indication, touch target size, and 200% zoom behavior;
- Collection return URL, originating projection-state restoration, and row-restoration semantics, including expired context and another tab changing persisted preferences;
- tests proving the detail controls consume the same ordered projection Collection renders rather than a second comparator.
