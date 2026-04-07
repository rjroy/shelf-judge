---
title: "Collection page filtering and sorting"
date: 2026-04-07
status: approved
tags: [spec, web-ui, filtering, sorting, ux, collection]
modules: [web-ui]
related:
  - .lore/brainstorms/collection-filter-sort.md
  - .lore/art/mockup-collection-filter-sort.html
  - .lore/designs/mvp-web-ui.md
  - .lore/designs/mvp-data-model.md
  - .lore/specs/mvp.md
  - .lore/specs/tournament-ranking.md
  - .lore/issues/collection-page-filter.md
  - .lore/issues/collection-page-sorting.md
req-prefix: CFS
---

# Spec: Collection Page Filtering and Sorting

## Overview

Replaces the collection page's hardcoded two-mode sort toggle with a full sort dropdown and adds client-side filtering. The user can sort by any game property (fitness, ELO, name, year, player count, play time, date added, last updated, BGG rating, BGG weight, or any individual axis rating) and filter by text search, rated status, and player count range. All filtering and sorting happens in the browser. No daemon API changes.

This resolves two open issues: `collection-page-filter` and `collection-page-sorting`.

## Entry Points

- User opens the collection page and sees games sorted by their last-used sort preference (or fitness score by default).
- User selects a different sort field from the sort dropdown.
- User clicks a clickable column header to sort by that column.
- User types in the search box to filter games by name.
- User expands the filter panel and applies rated status or player count filters.
- User clears individual filters via chip dismissal or clears all filters.

## Key Decision: Client-Side Only

All games are already loaded by the initial `listGames()` call. Collection sizes are tens to low hundreds. Client-side filtering and sorting is instant (no network round-trip), simple (no new daemon endpoints), and consistent (no redundant re-fetching). If the CLI later needs server-side filtering, daemon params can be added independently.

**Implementation consequence:** The collection page is currently a server component (`packages/web/app/page.tsx`). The data fetch stays in the server component. The game list rendering, sort controls, and filter controls move into a client component that receives the full game list, axes, and tournament stats as props. This expands the pattern already established by `CollectionSortToggle`.

## Key Decision: Sort Dropdown Replaces Tournament Toggle

The `CollectionSortToggle` component (fitness/tournament toggle) is removed. Its functionality is subsumed by the sort dropdown, which includes both "Fitness Score" and "Tournament ELO" among its options. The `?sort=` URL param is also removed; sort state moves to localStorage.

## Key Decision: Score Column Reflects Active Sort

The Score column is not a fixed "fitness score" display. It shows whatever metric the user is currently sorting by. When sorting by fitness, it shows the fitness score. When sorting by tournament ELO, it shows the ELO display label. When sorting by a specific axis, it shows that axis's rating value (1-10). When sorting by player count, it shows player count.

The Score column header reads "Score" with a subtitle indicating the active metric (e.g., "Fitness", "Tournament ELO", "Wife Will Play It"). This avoids renaming the column while keeping the context visible.

**Exception:** When sorting alphabetically by name, the Score column falls back to fitness score. There is no meaningful "name score" to display.

## Key Decision: "Has Value / No Value" Separator

The current rated/unrated visual split generalizes to a sort-aware split. Games with a value for the active sort field appear above the separator; games without appear below. When sorting by fitness score, unrated games (score === null) fall below. When sorting by an axis rating, games without a rating on that axis fall below. When sorting by player count, games with null player counts fall below. When sorting alphabetically, every game has a name, so no separator appears.

The separator label is contextual: "No rating on 'Wife Will Play It'" when sorting by that axis, "No player count data" when sorting by player count, "Not yet rated" when sorting by fitness.

## Requirements

### Sort Fields

- REQ-CFS-1: The sort dropdown MUST include the following built-in sort fields, organized into groups:

  **Score group:**
  - Fitness Score (default, descending)
  - Tournament ELO (descending; hidden if no tournament data exists)

  **Identity group:**
  - Name (ascending A-Z)
  - Year Published (descending, newest first)
  - Date Added (descending, most recent first)
  - Last Updated (descending, most recent first)

  **Specs group:**
  - Player Count (ascending, fewest first)
  - Play Time (ascending, shortest first)
  - BGG Community Rating (descending; hidden if no games have BGG data)
  - BGG Weight (descending; hidden if no games have BGG data)

  **Your Axes group:**
  - One entry per user-defined axis, using the axis name as the label. This group is hidden if no axes exist.

- REQ-CFS-2: Every sort field MUST support both ascending and descending direction. The default direction is specified per field above. Clicking the same sort field again reverses direction.

- REQ-CFS-3: The sort dropdown MUST visually group items into the four groups listed in REQ-CFS-1 using group headers.

### Sort Behavior

- REQ-CFS-4: When a sort is selected, the game list MUST be reordered client-side without a network request.

- REQ-CFS-5: Games without a value for the active sort field MUST appear below a separator line, after all games that have a value. Within the "no value" group, games are sorted alphabetically by name.

- REQ-CFS-6: The separator label MUST be contextual based on the active sort. Examples:
  - Fitness sort: "Not yet rated - N games"
  - Axis sort: "No rating on '{axis name}' - N games"
  - Player count sort: "No player count data - N games"
  - Name sort: no separator (every game has a name)

- REQ-CFS-7: Null values in numeric sort fields (yearPublished, minPlayers, playingTime, bggData.communityRating, bggData.weight) MUST sort to the "no value" group.

### Score Column

- REQ-CFS-8: The Score column MUST display the value of the active sort metric for each game:
  - Fitness sort: fitness score (e.g., "7.9") with score-range color dot
  - Tournament ELO sort: ELO display label (e.g., "8.3", "8.3 (provisional)", "not yet ranked")
  - Axis sort: that axis's rating value (1-10) or "---" if unrated on that axis
  - Player count sort: player count range (e.g., "2-4")
  - Play time sort: play time in minutes (e.g., "60 min")
  - BGG rating sort: community rating (e.g., "7.8")
  - BGG weight sort: weight value (e.g., "3.2")
  - Year sort: year published (e.g., "2017")
  - Date added sort: relative date
  - Last updated sort: relative date
  - Name sort (fallback): fitness score

- REQ-CFS-9: The Score column header MUST display "Score" as the primary label with a subtitle indicating the active metric name (e.g., "Fitness", "Tournament ELO", "Wife Will Play It", "Player Count"). A sort direction arrow (up/down) appears next to "Score."

- REQ-CFS-10: When sorting by an axis, the Axes Rated column SHOULD display alternate context: fitness score and ELO rating (if available) for the game, since the Score column is occupied by the axis value.

### Clickable Column Headers

- REQ-CFS-11: The Score column header MUST be clickable. Clicking it cycles through: the current score metric descending, then the current score metric ascending. It does not change which metric is displayed; it toggles direction.

- REQ-CFS-12: The "Last Rated" column header MUST be clickable and sort by `updatedAt`.

- REQ-CFS-13: The "Game" column header MUST be clickable and sort by name (alphabetical).

- REQ-CFS-14: Column headers with an active sort MUST show a directional arrow indicator. Headers without active sort show no arrow.

### Filters

- REQ-CFS-15: A text search input MUST be always visible in the controls area. It filters games by name substring match, case-insensitive. Filtering is applied as the user types (no submit button).

- REQ-CFS-16: An expandable filter panel MUST be accessible via a filter button/icon next to the search input. The filter panel contains:
  - **Rated status**: toggle between "All", "Rated only", "Unrated only"
  - **Player count**: "Plays at N" input where the user enters a player count and sees games whose minPlayers..maxPlayers range includes that number. Games with null player counts are excluded when this filter is active.

- REQ-CFS-17: Active filters MUST be displayed as dismissible chips below the controls area. Each chip shows the filter value (e.g., "Rated only", "2-5 players", search text). Clicking the X on a chip removes that filter.

- REQ-CFS-18: Multiple filters MUST combine with AND logic. A game must match all active filters to appear.

- REQ-CFS-19: The stats strip MUST update to reflect filtered results. Show "N of M games" when filters are active, with a note like "Filtered, K games hidden."

- REQ-CFS-20: The filter button/icon MUST have a visual indicator (e.g., filled/colored state) when any non-search filter is active.

### Persistence

- REQ-CFS-21: Sort selection (field and direction) MUST persist in localStorage under a key like `shelf-judge-sort`. On page load, the persisted sort is applied. If no persisted sort exists, default to fitness score descending.

- REQ-CFS-22: Filter state MUST persist in localStorage under a key like `shelf-judge-filters`. On page load, persisted filters are re-applied. Active filter chips appear immediately.

- REQ-CFS-23: The `?sort=` URL search param currently used by `CollectionSortToggle` MUST be removed. Sort state moves entirely to localStorage. Existing URLs with `?sort=tournament` should not break; the page should simply ignore the param.

### Mobile

- REQ-CFS-24: On mobile viewports, the sort dropdown MUST replace the existing tournament toggle position. The dropdown opens as a full-width overlay with touch-optimized row height (minimum 44px tap targets).

- REQ-CFS-25: On mobile, the controls row MUST contain: search input, sort button (showing current sort label), and filter icon. Active filter chips appear below the controls row.

- REQ-CFS-26: The sort dropdown overlay on mobile MUST dim the background and contain the same four groups as desktop.

### Component Architecture

- REQ-CFS-27: A new client component (e.g., `CollectionTable`) MUST be created to own the interactive game list. It receives the full game list (`GameWithScore[]`), axes (`Axis[]`), and tournament stats (`Record<string, TournamentGameStatsDisplay>`) as props from the server component.

- REQ-CFS-28: The `CollectionSortToggle` component MUST be removed. Its file (`packages/web/components/collection-sort-toggle.tsx`) is deleted.

- REQ-CFS-29: The server component (`packages/web/app/page.tsx`) MUST remain responsible for data fetching. It passes all data to the client component and renders the topbar, empty state, and stats strip shell.

### Removal of URL Param Sort

- REQ-CFS-30: The `searchParams` prop on `CollectionPage` for sort handling MUST be removed. The page no longer reads `?sort=` from the URL for sort behavior.

## Filters NOT in First Pass

The following filter types are deferred. They are natural extensions but add UI complexity beyond the first pass:

- Score range (min/max slider)
- Play time range
- BGG mechanics/categories tag filter
- Year published range
- BGG subdomain filter
- Axis-specific rating range ("show me games rated above 7 on complexity")
- Tournament provisional status
- Has BGG data / manually added

These can be added incrementally by extending the filter panel. The architecture (AND-combining filter predicates in the client component) supports them without structural changes.

## Visual Reference

Sienna's mockup at `.lore/art/mockup-collection-filter-sort.html` shows three panels:

1. **Desktop: full filter/sort state.** Sort dropdown expanded with four groups (Score, Identity, Specs, Your Axes). Filter bar with search input and expanded panel (rated status, player count range). Active filter chips row. Stats strip shows filtered count. Score column header: "Score" with sort arrow and subtitle.

2. **Desktop: axis sort active, no filters.** Sort by "Wife Will Play It" axis. Score column shows axis rating values. Sort button turns action-navy to signal non-default sort. Separator label: "No rating on 'Wife Will Play It' - 14 games below."

3. **Mobile: two states.** Controls visible with active filter chips (search + sort button + filter icon). Sort dropdown open as full-width overlay with touch-optimized rows, dimmed background.

The mockup uses three chip color classes: search (warm gray), rated status (amber tint), spec/numeric filters (green tint).

## Success Criteria

1. A user can sort their collection by any of the fields listed in REQ-CFS-1 and see the list reorder instantly.
2. The Score column updates to reflect the active sort metric with appropriate formatting.
3. Games without a value for the active sort field appear below a contextual separator.
4. A user can filter by text search, rated status, and player count, with filters combining via AND.
5. Active filters are visible as dismissible chips, and the stats strip reflects the filtered count.
6. Sort and filter preferences survive page reloads via localStorage.
7. The `CollectionSortToggle` and `?sort=` URL param are removed without breaking existing functionality.
8. Mobile layout matches the mockup: sort dropdown as full-width overlay, controls row with search/sort/filter.
9. Column headers for Score, Game, and Last Rated are clickable and trigger the corresponding sort.
10. No daemon API changes. All filtering and sorting is client-side.
