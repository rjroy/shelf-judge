---
title: Prior lore for game-view next and previous navigation
date: 2026-08-29
status: active
tags: [navigation, game-detail, collection, sorting, filtering]
modules: [web-ui]
related:
  - .lore/brainstorms/collection-filter-sort.md
  - .lore/specs/collection/collection-filter-sort.md
  - .lore/specs/collection/game-links.md
  - .lore/specs/features/previously-owned.md
  - .lore/work/specs/collection-purchase-utilization.md
  - .lore/work/specs/useful-collection-profile.md
---

# Prior lore for game-view next and previous navigation

## Key Findings

1. Collection order is a client-side projection, not a daemon-owned sequence. The browser filters the loaded games and then applies the selected sort. Previous and next cannot be derived from the game-detail response alone without defining how that projection reaches or is reconstructed by the detail view.
2. Collection context has split ownership. Sort, search, rated status, played status, and player count persist in `localStorage`; ownership and missing-dimensions scope are URL parameters that can change the server-rendered collection. A design must preserve or deliberately replace this hybrid contract.
3. `/games/{id}` is an independently meaningful route. Direct loads, reloads, shared links, new tabs, previously owned games, and missing-game errors must continue to work without an originating collection page.
4. "Displayed collection order" includes filter-before-sort behavior, a separate no-value group at the end, and specialized purchase-utilization ordering. Navigation must reuse the same projection rather than implement an approximate comparator.
5. Prior lore does not decide whether direct entry gets neighbors, whether filters participate, how context is transported, whether ends wrap, or how return scroll position is restored. Those decisions belong in the next brainstorm and specification.

## Relevant Prior Decisions

### Collection Filtering And Sorting

`.lore/brainstorms/collection-filter-sort.md` (`resolved`) and `.lore/specs/collection/collection-filter-sort.md` (`implemented`) establish:

- Filtering and sorting happen in the browser for a personal collection of tens to low hundreds of games.
- Filters combine with AND logic and are applied before sorting.
- The default sort is fitness descending.
- Sort field and direction persist under `shelf-judge-sort` in `localStorage`.
- Search, rated status, played status, and player count persist under `shelf-judge-filters` in `localStorage`.
- Sort state was deliberately removed from URL query parameters.
- Games without the active sort value remain after games with values in both directions.
- The no-value group sorts by name.

The implemented collection now also supports prediction-enriched rows, niche data, a grouped-by-niche mode, and additional sort fields. Grouped-by-niche mode is not a single sequence because one game can occur in multiple niche groups. It should not silently define collection-wide previous and next.

### Deterministic Purchase-Utilization Sorts

`.lore/work/specs/collection-purchase-utilization.md` (`implemented`) tightens ordering for value remaining and estimated additional plays:

- Value remaining sorts by the displayed rounded-hundredths key, not hidden precision.
- Estimated plays distinguishes finite, unreachable, unavailable, and not-applicable categories.
- Values without a sort key remain after values with one in both directions.
- Ties use ascending NFC-normalized Unicode code-point game name, then stable game ID, regardless of primary direction.

These comparators are part of what the user sees. Navigation following collection order must call the same collection projection. Reimplementing only field and direction would drift on categories, precision, nulls, and ties.

### Collection Scope And Ownership

`.lore/specs/features/previously-owned.md` (`implemented`) establishes:

- The default collection view contains owned games.
- `?ownership=all` adds previously owned games to the displayed list.
- A previously owned game remains directly accessible at `/games/{id}`.
- Display membership and niche/redundancy computation membership are not the same. Previously owned rows can appear without entering owned-only shelf computations.

The current collection also uses `?dimensions=missing`. Both URL-owned scopes must be considered if previous and next claim to follow the visible collection.

The older previously-owned spec says those games contribute to profiling. `.lore/work/specs/useful-collection-profile.md` (`implemented`) supersedes that point for current collection identity, which uses currently owned games. This conflict does not change collection-list navigation, but the newer ownership meaning should be used when describing scope.

### Game Detail Links And Routing

`.lore/specs/collection/game-links.md` (`implemented`) establishes:

- The stable detail route is `/games/{id}`.
- Internal destinations use Next.js `Link` semantics.
- Collection rows already link to game detail.
- Links are not prevalidated. A missing or deleted game is handled by the detail route.
- Game detail must remain useful when reached from collection, profile, score breakdown, tournament history, search preview, a bookmark, or a shared URL.

The existing detail breadcrumb returns to plain `/collection`. It does not preserve collection query parameters, client-side filters, sort, or scroll position.

### Responsive And Accessible Navigation

Prior responsive plans and the newer profile explorer work establish useful constraints:

- Internal destination controls should remain normal links so reload, browser history, modifier-click, and new-tab behavior work.
- Controls must not be swipe-only.
- Touch targets should be at least 44px.
- The game detail composition must work at phone, tablet, desktop, and 200% zoom without horizontal overflow.
- The existing topbar already contains the collection breadcrumb and game actions, so control placement needs an explicit mobile decision.

The draft `.lore/work/design/profile-evidence-explorer.md` offers a non-binding precedent for returning to a selected result, fragment targeting, focus restoration, and explaining when a selected item falls outside current filters. It is a useful option, not an approved game-detail contract.

## Current Implementation Constraints

`packages/web/components/collection-table.tsx` owns the effective sequence. It hydrates sort and filters from `localStorage` after mount, then computes:

1. prediction or standard source rows
2. optional niche enrichment
3. ordinary client filters
4. ownership scope
5. missing-dimensions scope
6. active sort into with-value and without-value groups

`packages/web/lib/collection-utils.ts` owns sort and filter persistence, predicates, sort keys, category ordering, and utilization tie-breakers. This is the reusable semantic boundary unless later design moves the collection projection elsewhere.

`packages/web/app/games/[id]/page.tsx` is a server component. It fetches one game and supporting detail data. It does not fetch the collection, receive collection context, or expose a client boundary for adjacent navigation.

Hydration matters: the collection initially renders default fitness-descending state and then applies stored preferences. A design that reconstructs context on game detail must avoid briefly showing neighbors from the default order before switching to persisted order.

## Decisions The Next Work Must Preserve

- Keep `/games/{id}` valid without navigation context.
- Keep missing-game handling in the destination.
- Use the exact filtered and sorted collection projection if navigation is described as following collection order.
- Preserve URL-owned ownership and dimensions scope when navigation originates from those views.
- Keep null and unavailable rows at the end and preserve specialized utilization ordering.
- Do not substitute niche neighbors for collection neighbors.
- Do not imply that sequence position is a recommendation or universal rank.
- Use stable IDs as the final deterministic tie-breaker when a total sequence is required.
- Support normal link behavior, keyboard operation, touch targets, narrow screens, and zoom.

## Questions For Brainstorming

1. Does adjacency mean the currently visible filtered rows, the ownership-scoped collection regardless of ordinary filters, or a canonical unfiltered order?
2. Does direct entry show no adjacent controls, use the browser's persisted collection preferences, or use a documented canonical default?
3. Is context encoded in query parameters, carried in history/session state, reconstructed from `localStorage`, or represented by a short context identifier?
4. Must opening a game in a new tab preserve the originating sequence? If so, history state alone is insufficient.
5. What happens when the current game no longer matches the filters or leaves the ownership scope after a detail-page mutation?
6. Do collection mutations recompute neighbors immediately, on the next navigation, or only after returning to collection?
7. Are first and last boundaries disabled, wrapped, or linked back to collection?
8. How is collection return handled: browser Back, explicit breadcrumb, stored scroll coordinates, a row fragment, or a combination?
9. Is navigation unavailable in grouped-by-niche mode, or does that mode provide an explicit niche-scoped context?
10. Where do controls fit without crowding the detail topbar on mobile?
11. Should controls show adjacent game names, position within results, or only previous and next labels?
12. Should the older generic sort comparators adopt the newer NFC name and stable-ID tie rule before navigation depends on them?

## Research Handoff

The next brainstorm should compare at least three coherent context models rather than jumping directly to controls:

- origin-only context, where adjacent controls exist only when the collection link carries context
- persisted-preference context, where detail reconstructs the user's current collection projection
- URL-addressable context, where enough state travels with the detail URL to reproduce the sequence

Each model should be tested against direct links, new tabs, filter changes, ownership changes, deletion, hydration, return scroll position, and grouped-by-niche mode.
