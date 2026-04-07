---
title: "Implementation plan: collection-filter-sort"
date: 2026-04-07
status: executed
tags: [plan, web-ui, filtering, sorting, collection, client-component]
modules: [web]
related:
  - .lore/specs/collection-filter-sort.md
  - .lore/brainstorms/collection-filter-sort.md
  - .lore/art/mockup-collection-filter-sort.html
  - .lore/designs/mvp-web-ui.md
---

# Plan: Collection Page Filter and Sort

## Spec Reference

**Spec**: `.lore/specs/collection-filter-sort.md`
**Visual mockup**: `.lore/art/mockup-collection-filter-sort.html` (three panels: desktop full state, desktop axis-sort, mobile)

Requirements addressed: REQ-CFS-1 through REQ-CFS-30 (all). Every requirement maps to at least one phase below.

## Codebase Context

### What Exists

The collection page is a single server component at `packages/web/app/page.tsx` (266 lines). It fetches all games, axes, and tournament stats via `listGames()`, `listAxes()`, and `getAllTournamentStats()` from `packages/web/lib/api.ts`. It then splits games into `rated` and `unrated` arrays, sorts rated games by fitness or tournament ELO (depending on a `?sort=` URL param), and renders everything inline: topbar, stats strip, table header, rated rows, separator, unrated rows.

`CollectionSortToggle` (`packages/web/components/collection-sort-toggle.tsx`, 38 lines) is a client component that reads `?sort=` from URL search params and calls `router.push()` to toggle between fitness and tournament sort. It renders as a two-button toggle in the topbar.

CSS for the collection lives in `packages/web/app/globals.css`. Key selectors: `.collection-header` and `.game-row` use `grid-template-columns: 36px 58px 1fr 180px 110px 100px` (6 columns: rank, thumb, info, axes-rated, last-rated, score). Tablet breakpoint (max-width: 899px) hides axes-rated and switches to 5 columns. Phone breakpoint (max-width: 599px) hides the header entirely, renders rows as mini-cards (4-column, 2-row grid), and hides last-rated. The `.sort-toggle` styles will be removed.

The `relativeDate()` utility function is currently defined at the top of `page.tsx`. It will need to be accessible from the new client component.

### Shared Types

`GameWithScore` has `game: Game` and `score: FitnessResult | null`. `Game` has `name`, `yearPublished`, `minPlayers`, `maxPlayers`, `playingTime`, `imageUrl`, `bggData: BggGameData | null`, `ratings: Record<string, number>`, `createdAt`, `updatedAt`. `BggGameData` has `communityRating`, `weight` (nullable), `bayesAverage`. `Axis` has `id`, `name`, `description`, `weight`, `source`. `TournamentGameStatsDisplay` has `normalizedScore`, `displayLabel`, `isProvisional`, `comparisonCount`, `eloRating`.

No new shared types are needed. All filtering and sorting is client-side against these existing types.

### Mockup Patterns

The HTML mockup (`.lore/art/mockup-collection-filter-sort.html`) establishes:

- **Sort control** in the topbar: a composite widget with "SORT BY" prefix label, a dropdown trigger showing the active sort name + chevron, and a direction toggle button. The dropdown menu has four groups (Score, Identity, Specs, Your Axes) with group headers, checkmark on the active item, and axis items slightly smaller.
- **Filter bar** below the topbar: search input (always visible, with magnifying glass icon), a "Filters" toggle button (with count badge when active), and an expandable panel with rated-status segmented control and player-count input.
- **Active filter chips** below the filter bar: color-coded by type (search: warm gray, rated: amber, spec: green), each with an X dismiss button. "Clear all" link when multiple filters active.
- **Stats strip** shows "Filtered, K games hidden" note when filters active.
- **Score column header** has a two-line label: "SCORE" with sort arrow on top, metric subtitle below (e.g., "FITNESS", "WIFE WILL PLAY IT").
- **Separator** label is contextual: "No rating on '{axis name}' — N games below" when axis-sorting.
- **Mobile** sort: full-width overlay with dimmed background, same four groups, touch-sized rows (44px min).

## Architecture Decision: Component Split

The page splits into two parts:

1. **Server component** (`packages/web/app/page.tsx`): fetches data, handles the empty state, and passes everything to the client component. It no longer sorts, splits rated/unrated, or renders game rows. It renders the topbar shell (title, nav links, RefreshAllButton) and delegates everything below to the client component.

2. **Client component** (`packages/web/components/collection-table.tsx`): receives `games: GameWithScore[]`, `axes: Axis[]`, `tournamentStats: Record<string, TournamentGameStatsDisplay>` as props. Owns all sort/filter state via `useState`. Renders the filter bar, stats strip, table header, and game rows. No network requests.

This is a clean boundary: server component owns data, client component owns interaction.

## Phases

### Phase 1: Sort State and Dropdown

**What changes:** Create `packages/web/components/collection-table.tsx` as the client component. Move the `relativeDate()` function to a new utility at `packages/web/lib/date-utils.ts`. Extract game-row rendering and the sort/filter logic into the client component. Build the sort dropdown with all sort fields (REQ-CFS-1), direction toggle (REQ-CFS-2), and grouped menu (REQ-CFS-3). Persist sort selection in localStorage (REQ-CFS-21).

**Files created:**

- `packages/web/components/collection-table.tsx` — client component with sort state, dropdown, and game list rendering
- `packages/web/lib/date-utils.ts` — `relativeDate()` extracted here

**Files modified:**

- `packages/web/app/page.tsx` — strip out all row rendering, sort logic, rated/unrated split, the `relativeDate` function, and `CollectionSortToggle` import. Pass `games`, `axes`, `tournamentStats`, and `hasTournamentData` to `<CollectionTable>`. Remove the `searchParams` prop and `?sort=` handling (REQ-CFS-30).

**Sort field definitions:** Define a `SortField` type union or config array inside the client component (not in shared, since this is UI-only). Each entry has: `id` (string key like `"fitness"`, `"tournament"`, `"name"`, `"yearPublished"`, `"createdAt"`, `"updatedAt"`, `"playerCount"`, `"playTime"`, `"bggRating"`, `"bggWeight"`, or `"axis:{axisId}"`), `label` (display name), `group` (`"score" | "identity" | "specs" | "axes"`), `defaultDirection` (`"asc" | "desc"`), and a `hidden` condition (tournament hidden when no tournament data, BGG fields hidden when no games have BGG data, axes group hidden when no axes).

**Sort state:** `useState<{ field: string; direction: "asc" | "desc" }>` initialized from localStorage (key: `shelf-judge-sort`) or defaulting to `{ field: "fitness", direction: "desc" }`. On change, write to localStorage.

**Sort logic:** A single comparator function that takes the active sort field and direction, handles null values (nulls always sort to bottom, regardless of direction), and returns a sorted copy of the games array. Within the "has value" group, apply the direction. Within the "no value" group, sort alphabetically by name.

**Dropdown UI:** Match the mockup's `.sort-control` pattern: "SORT BY" prefix, dropdown trigger with active sort label + chevron, direction toggle button. Dropdown menu with four groups, group headers, checkmark on active item. Click to select, click again to toggle direction (REQ-CFS-2). Close on selection or outside click.

**Depends on:** Nothing. This is the foundation.

**Verification:**

- Sort dropdown renders with all four groups. Tournament ELO option hidden when no tournament data. BGG options hidden when no games have BGG data. Axis group hidden when no axes.
- Selecting a sort reorders the list client-side without a network request (REQ-CFS-4).
- Sort persists across page reload via localStorage (REQ-CFS-21).
- `?sort=tournament` in the URL is silently ignored (REQ-CFS-23).
- Typecheck clean. Existing tests still pass.

**Reqs covered:** REQ-CFS-1, 2, 3, 4, 21, 23, 27, 29, 30.

---

### Phase 2: Score Column and Separator

**What changes:** The Score column becomes dynamic: it shows the value of the active sort metric (REQ-CFS-8). The Score column header shows "Score" with a subtitle for the active metric and a sort arrow (REQ-CFS-9). The separator line becomes contextual (REQ-CFS-5, 6, 7). Column headers for Score, Game, and Last Rated become clickable sort triggers (REQ-CFS-11, 12, 13, 14).

**Files modified:**

- `packages/web/components/collection-table.tsx` — update the Score column rendering to branch on active sort field. Update the table header to include clickable column headers with sort arrows. Update the separator to use contextual labels.

**Score column display logic (REQ-CFS-8):** A function `getScoreDisplay(game, score, sortField, tournamentStats, axes)` returns `{ text: string; className: string }`. For fitness: score value with color dot. For tournament: `displayLabel`. For axis sort: rating value or `"---"`. For player count: range string. For play time: `"{N} min"`. For BGG rating: community rating. For BGG weight: weight value. For year: year string. For dates: relative date. For name sort: fall back to fitness score (REQ-CFS-8 fallback).

**Score column header (REQ-CFS-9):** Two-line structure matching the mockup. Top line: "SCORE" + sort direction arrow (up/down unicode arrow). Bottom line: active metric name in small caps. Arrow appears only when Score column is the active sort target (REQ-CFS-14).

**Clickable headers (REQ-CFS-11, 12, 13):** Score header click toggles direction on whatever metric is currently displayed. Game header click sorts by name. Last Rated header click sorts by `updatedAt`. Active header gets a `.sort-active` class for visual indicator (REQ-CFS-14).

**Separator (REQ-CFS-5, 6, 7):** After the "has value" games, render a separator only if "no value" games exist. Label is contextual:

- Fitness: "Not yet rated — N games"
- Tournament: "Not yet ranked — N games"
- Axis: "No rating on '{axis name}' — N games"
- Player count: "No player count data — N games"
- Name: no separator (every game has a name)
- Other fields: "No {field name} data — N games"

**Axes Rated column context switch (REQ-CFS-10):** When sorting by an axis, the Axes Rated column shifts to show fitness score and ELO (if available) instead of axis chips, since the Score column is occupied by the axis value.

**CSS additions to `globals.css`:**

- `.score-col-label`, `.score-col-main`, `.score-col-sub` for the two-line score header (match mockup styles).
- `.col-label.sortable` and `.col-label.sort-active` for clickable headers with cursor and arrow styling.
- `.sort-arrow` for the direction indicator.

**Depends on:** Phase 1 (sort state drives what the Score column shows).

**Verification:**

- Sort by fitness: Score column shows fitness score with color dot, separator says "Not yet rated."
- Sort by tournament: Score column shows ELO display label.
- Sort by an axis: Score column shows that axis's rating or "---". Separator says "No rating on '{name}'."
- Sort by player count: Score column shows range. Separator says "No player count data."
- Sort by name: Score column shows fitness (fallback). No separator.
- Click Score header: toggles direction. Click Game header: sorts A-Z. Click Last Rated: sorts by date.
- Active sort column has arrow indicator; others do not.
- Typecheck clean.

**Reqs covered:** REQ-CFS-5, 6, 7, 8, 9, 10, 11, 12, 13, 14.

---

### Phase 3: Filters

**What changes:** Add text search, rated status, and player count filters. Add the filter bar UI with search input, filter toggle button, expandable panel, and active filter chips (REQ-CFS-15 through 20). Persist filter state in localStorage (REQ-CFS-22).

**Files modified:**

- `packages/web/components/collection-table.tsx` — add filter state, filter bar UI, chip rendering, and filter predicate logic.

**Filter state:** `useState<FilterState>` where `FilterState` is:

```typescript
interface FilterState {
  search: string; // text search substring
  ratedStatus: "all" | "rated" | "unrated";
  playerCount: number | null; // "plays at N" filter
}
```

Initialize from localStorage (key: `shelf-judge-filters`) or default to `{ search: "", ratedStatus: "all", playerCount: null }`. Write to localStorage on every change.

**Filter predicate:** A function `matchesFilters(gameWithScore: GameWithScore, filters: FilterState): boolean` that returns true if the game passes all active filters (AND logic, REQ-CFS-18):

- `search`: `game.name.toLowerCase().includes(search.toLowerCase())`
- `ratedStatus`: "rated" requires `score !== null`, "unrated" requires `score === null`
- `playerCount`: `game.minPlayers !== null && game.maxPlayers !== null && game.minPlayers <= N && game.maxPlayers >= N`

Apply filters before sorting. The sort then operates on the filtered subset.

**Filter bar layout (matching mockup `.filter-bar`):**

- Row 1: search input (always visible, max-width 320px, magnifying glass icon, immediate filtering on input), sort control (from Phase 1, moved into this row or kept in topbar depending on layout), filter toggle button.
- Row 2 (expandable): rated status segmented control ("All" / "Rated" / "Unrated"), player count input ("Plays at \_\_\_ players").
- Row 3 (conditional): active filter chips when any filter is non-default.

**Filter toggle button (REQ-CFS-20):** Shows "Filters" text. When non-search filters are active, gets `.has-filters` class (action-navy border and background tint) with a count badge.

**Active filter chips (REQ-CFS-17):** Each active filter renders as a pill:

- Search: warm gray chip showing search text, `.chip-search`
- Rated status: amber chip showing "Rated only" or "Unrated only", `.chip-rated`
- Player count: green chip showing "Plays at N", `.chip-spec`
  Each chip has an X button that clears that filter. "Clear all" link when 2+ filters active.

**Stats strip update (REQ-CFS-19):** When filters reduce the visible count, show "N of M games" in the Games stat block. Add a "Filtered, K hidden" note (italic, muted) to the strip.

**Search input behavior:** The search input in the filter bar replaces any need for a separate search. Typing immediately filters (REQ-CFS-15). When the search has a value, the input border turns action-navy (`.has-value` class from mockup).

**CSS additions to `globals.css`:**

- `.filter-bar`, `.filter-row-1`, `.search-input-wrap`, `.search-icon`, `.search-input`, `.search-input.has-value`
- `.filter-toggle-btn`, `.filter-toggle-btn.has-filters`, `.filter-count-badge`
- `.filter-panel`, `.filter-group`, `.filter-group-label`, `.filter-group-controls`
- `.seg-btn`, `.seg-btn.active` (for rated status segmented control)
- `.range-input` (for player count input)
- `.active-chips-row`, `.chips-label`, `.filter-chip`, `.chip-search`, `.chip-rated`, `.chip-spec`, `.chip-x`, `.clear-all-link`
- `.filtered-note` (for stats strip filtered indicator)
- New CSS variables: `--filter-spec: #4a6e42`, `--filter-spec-bg: #eaf2e8` (from mockup)

All new CSS class names match the mockup HTML exactly to reduce visual discrepancy.

**Depends on:** Phase 1 (filter is applied before sort), Phase 2 (separator reflects filtered results).

**Verification:**

- Type in search: list filters immediately by name substring, case-insensitive.
- Toggle rated status: "Rated only" hides unrated games, "Unrated only" hides rated, "All" shows both.
- Enter player count: only games whose range includes that number appear. Null-player-count games excluded.
- All three filters combine with AND.
- Active filters show as colored chips. Clicking X removes that filter.
- Stats strip shows "N of M games" and "Filtered, K hidden" when filters active.
- Filter state persists across page reload.
- Filter button has visual indicator when non-search filters active.
- Typecheck clean.

**Reqs covered:** REQ-CFS-15, 16, 17, 18, 19, 20, 22.

---

### Phase 4: Remove CollectionSortToggle and Mobile

**What changes:** Delete the old `CollectionSortToggle` component and its CSS. Add mobile-responsive styles for the filter bar, sort dropdown overlay, and filter chips. Verify the entire feature on all three breakpoints.

**Files deleted:**

- `packages/web/components/collection-sort-toggle.tsx` (REQ-CFS-28)

**Files modified:**

- `packages/web/app/globals.css` — remove `.sort-toggle`, `.sort-toggle-btn`, `.sort-toggle-btn.active`, `.sort-toggle-btn:not(.active):hover`, and the phone-breakpoint `.sort-toggle` rule. Add mobile styles for the new sort dropdown and filter bar.
- `packages/web/components/collection-table.tsx` — add mobile sort overlay behavior.

**Mobile sort overlay (REQ-CFS-24, 25, 26):** On mobile (max-width: 599px), the sort dropdown opens as a full-width fixed overlay rather than an absolutely-positioned dropdown. The overlay dims the background (`.sort-overlay-backdrop`), has the same four groups as desktop, and uses 44px minimum tap targets on each item. Close on selection or backdrop tap.

**Mobile controls row (REQ-CFS-25):** Search input, sort button (showing current sort label, compact), filter icon. Active filter chips appear below. The sort button replaces the old tournament toggle position.

**CSS responsive additions:**

- Tablet (max-width: 899px): filter bar stacks search and controls more tightly. Sort dropdown position adjusts.
- Phone (max-width: 599px): filter bar goes full-width. Sort button shows abbreviated label. Sort dropdown becomes full-screen overlay. Filter panel stacks vertically. Chips row wraps.

**Depends on:** Phases 1, 2, 3 (all features must exist before mobile adaptation).

**Verification:**

- Desktop (900px+): sort dropdown positions below trigger, filter bar has horizontal layout.
- Tablet (600-899px): layout adapts, sort dropdown still works, filter bar remains usable.
- Phone (<600px): sort opens as full-width overlay with dimmed background. Controls row has search + sort button + filter icon. Filter chips below. All tap targets >= 44px.
- `CollectionSortToggle` file is gone. No remaining imports or references.
- Typecheck clean. `bun run lint` clean.

**Reqs covered:** REQ-CFS-24, 25, 26, 28.

---

### Phase 5: Tests and Final Verification

**What changes:** Write unit tests for the sorting comparator, filter predicate, score display function, and separator label function. Write integration-style tests for the `CollectionTable` component if the test infrastructure supports React component testing (check existing test patterns). Run the full verification suite.

**Files created:**

- `packages/web/tests/collection-table.test.ts` — tests for the extracted pure functions (sort comparator, filter predicate, score display, separator label). These functions should be exported from a utilities module or from the component file for testability.

**Test cases (at minimum):**

- Sort by each field type: fitness, tournament, name, year, createdAt, updatedAt, playerCount, playTime, bggRating, bggWeight, axis.
- Null handling: games without values for the sort field sort to bottom regardless of direction.
- Direction toggle: ascending vs descending produces reversed order.
- Filter: search matches case-insensitively on name.
- Filter: rated status includes/excludes correctly.
- Filter: player count range checks minPlayers <= N <= maxPlayers.
- Filter: AND combination of multiple filters.
- Score display: returns correct text for each sort field type.
- Separator label: returns correct contextual text for each sort field type. Returns null for name sort.

**Full verification checklist (maps to spec success criteria):**

1. Sort by every field in REQ-CFS-1. List reorders instantly.
2. Score column updates per REQ-CFS-8.
3. Separator appears with contextual label per REQ-CFS-5, 6.
4. Search, rated status, player count filters work with AND combination.
5. Chips appear, dismiss works, stats strip updates.
6. localStorage persists sort and filter across reload.
7. `CollectionSortToggle` gone, `?sort=` param ignored.
8. Mobile layout matches mockup.
9. Column headers clickable and trigger sort.
10. No daemon API changes. `packages/daemon/` untouched.

**Depends on:** All previous phases.

**Verification:** All tests pass. `bun run test`, `bun run typecheck`, `bun run lint` all clean.

**Reqs covered:** Verification of all 30 requirements.

## Delegation Guide

All five phases are assigned to **Dalton** (implementation). Phases are sequential; each depends on the previous. After Phase 4, invoke **Thorne** (review) to check the implementation against the spec before Phase 5 tests are written. This catches structural issues before tests lock in behavior.

After Phase 5, a final Thorne review confirms full requirement coverage.

## Risk Notes

1. **Component size.** `CollectionTable` will be a large client component (sort dropdown, filter bar, chips, table header, game rows, separator). If it exceeds ~300 lines, extract the sort dropdown and filter bar into sub-components within the same file or as sibling components. The spec doesn't prescribe internal decomposition, so use judgment.

2. **CSS class collisions.** The new CSS classes are drawn directly from the mockup HTML. Before adding them, verify no existing class in `globals.css` conflicts. The mockup uses some of the same base class names (`.game-row`, `.score-cell`) as the existing page, which is intentional (they're the same elements), but new classes like `.filter-bar`, `.sort-control`, `.sort-menu` must not collide with anything existing.

3. **localStorage SSR.** The client component reads localStorage on mount. During SSR, localStorage is not available. Use a `useEffect` to hydrate sort/filter state after mount, with the default values as the initial render. This avoids hydration mismatches. The list will briefly show default sort on first paint, then snap to the persisted sort. This is acceptable for a local-only tool.

4. **Filter bar placement.** The spec says the filter bar sits between the topbar and the stats strip. The mockup confirms this. The current page has no element in that position, so it's a straightforward insertion. The filter bar is part of the client component, not the server component.
