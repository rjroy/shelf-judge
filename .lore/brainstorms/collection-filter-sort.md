---
title: "Collection page filtering and sorting"
date: 2026-04-06
status: open
tags: [web-ui, filtering, sorting, ux, collection]
modules: [web-ui]
related:
  - .lore/issues/collection-page-filter.md
  - .lore/issues/collection-page-sorting.md
  - .lore/designs/mvp-web-ui.md
  - .lore/designs/mvp-data-model.md
  - .lore/designs/mvp-fitness-model.md
---

# Brainstorm: Collection Page Filtering and Sorting

## Context

The collection page shows a ranked table of games. Currently it supports two sort modes (fitness score descending, tournament ELO descending) via a toggle button in the topbar, driven by a `?sort=` query param. There's no filtering at all. Both issues are open and thinly specified ("needs filter/sorting functionality").

The collection loads all games in a single `listGames()` call. The daemon returns every game with its computed fitness score. For a personal curation tool, collection sizes are realistically in the tens to low hundreds, not thousands. That shapes which approaches make sense.

## What Data Is Available

Before asking "what should we filter/sort by," inventory what the daemon already returns per game:

**Game fields (always present):**

- `name`, `yearPublished`, `minPlayers`, `maxPlayers`, `playingTime`
- `ratings` (Record of axisId to rating value, 1-10)
- `imageUrl`, `bggId`, `createdAt`, `updatedAt`

**Computed at response time:**

- `score` (FitnessResult: `score`, `ratedAxisCount`, `totalAxisCount`, `breakdown`)

**BGG data (nullable, per game):**

- `communityRating`, `bayesAverage`, `weight`
- `mechanics[]`, `categories[]`, `subdomains[]`
- `suggestedPlayerCounts[]`

**Tournament data (loaded separately):**

- `eloRating`, `normalizedScore`, `comparisonCount`, `isProvisional`, `displayLabel`

Everything is already in the client's hands after the initial fetch. No new API calls needed.

---

## Sorting Ideas

### What fields make sense to sort by?

**Strong candidates (immediately useful, data always present):**

1. **Fitness score** (current default, descending). The whole point of the app. Keep as default.
2. **Tournament ELO** (already implemented as toggle). Natural complement to fitness.
3. **Name** (alphabetical). Universal expectation. Users look for a specific game by scrolling.
4. **Year published**. "Show me my newest/oldest games." Natural for a collection.
5. **Date added** (`createdAt`). "What did I add recently?" Useful after import sessions.
6. **Last updated** (`updatedAt`). Proxy for "last rated." Already shown in the table.

**Moderate candidates (useful but data may be missing):**

7. **Player count** (min or max). "Sort by how many people I need." Useful for planning game nights. Nulls for manually-added games.
8. **Play time**. Similar to player count. Useful for "quick game" browsing.
9. **BGG community rating**. "What does the crowd think?" Available for BGG-imported games only.
10. **BGG weight/complexity**. "Sort light to heavy." Same null caveat.

**What if we could sort by individual axis rating?** A user with a "Wife will play it" axis might want to sort by that rating alone, ignoring the aggregated fitness. This is powerful but adds UI complexity (axis selector in the sort dropdown). Worth considering but probably not for the first pass.

### Default sort

Keep fitness score descending. It's the app's thesis: the score tells you what belongs on your shelf. Every other sort is an alternate lens.

### Sort direction

Every sort field should support ascending and descending. Click-to-toggle on column headers is the expected pattern for tables. First click sorts descending (highest first) for numeric fields, ascending (A-Z) for name. Second click reverses.

### Null handling

Games with null values for the sort field go to the bottom regardless of direction. This is the least surprising behavior. A game with no `playingTime` shouldn't jump to position 1 when sorting ascending.

---

## Filtering Ideas

### What fields make sense to filter by?

Filters answer the question: "Show me only games that match these criteria." The interesting question is which criteria matter for a collection curation tool specifically, not a general game database.

**High-value filters:**

1. **Rated / Not rated status.** The page already visually separates these. A filter makes it explicit and removes the other group entirely. Use case: "Show me only unrated games so I can work through the backlog."

2. **Player count range.** "Show me games that play at 2." This is the most common real-world filter: "We have 3 people tonight, what works?" Needs to check whether the requested count falls within `minPlayers..maxPlayers`. What if a game has null player counts? Exclude it from results when filtering by player count (safe default), or show it with a visual indicator that count is unknown.

3. **Score range.** "Show me games scoring below 5.0." Identifies cull candidates. Or "above 8.0" to see the cream. A slider or min/max input.

4. **Has BGG data / manually added.** Quick way to find games that might need a BGG link, or to focus on the BGG-enriched portion of the collection.

**Medium-value filters:**

5. **Play time range.** "Show me games under 60 minutes." Same pattern as player count.

6. **BGG mechanics/categories.** "Show me all my worker-placement games." Powerful for collection analysis, but only works for BGG-imported games. Could use tag chips as filter toggles.

7. **Year published range.** Niche but useful for "show me my classics" or "show me recent acquisitions."

8. **Text search on name.** Not a filter in the dropdown sense, but a search box that narrows the visible rows. Fast, familiar, low UI cost. Arguably the single most useful "filter."

**Lower-value for MVP (but interesting):**

9. **BGG subdomain.** "Strategy Games," "Family Games," etc. Only a few values, could be a simple dropdown. But only for BGG games.

10. **Axis-specific rating range.** "Show me games I rated above 7 on 'Wife will play it'." Extremely powerful for the tool's thesis, but complex UI. A second-pass feature.

11. **Tournament provisional status.** "Show me games that need more comparisons." Useful for tournament workflows but niche.

### What about "owned/wishlisted" status?

The data model doesn't track ownership status. Every game in the collection is implicitly "owned" (or at least "being evaluated"). There's no wishlist concept in MVP. So this filter doesn't apply yet, but it's worth noting as a natural extension if wishlists are ever added.

---

## UX Patterns

### How should filter and sort interact with the existing table layout?

**Sort: column header clicks.** The table already has column headers (Game, Axes Rated, Last Rated, Score). Make them clickable sort targets. Active sort column gets a directional indicator (arrow up/down). This is the most discoverable pattern for tabular data, and the collection view is already a table.

What if we add sortable columns that aren't currently displayed? Player count and play time are shown in the `game-meta` line under the game name, not as their own columns. Options:

- Add them as full columns (wider table, more info density)
- Only show them as sort options in a dropdown, keeping the table compact
- Show them as columns only when sorted by that field (dynamic columns, more complex)

The current table has: Rank, Thumbnail, Game (name + meta), Axes Rated, Last Rated, Score. That's already six columns. Adding player count and play time as full columns might crowd it on narrower screens. A sort dropdown is probably cleaner.

**What if sort lived in a dropdown rather than column headers?** A dropdown button like the existing sort toggle but with all options listed. Pro: doesn't require every sort field to be a visible column. Con: less discoverable than clickable headers for the columns that are visible. Hybrid approach: clickable headers for visible columns, dropdown for the rest.

**Filter: a filter bar above the table.** Collapsible, so it doesn't eat space when not in use. Could be:

- A single "Filter" button that reveals a panel with filter controls
- An always-visible search box (text filter) with an expandable "More filters" section
- Chips/pills showing active filters, click to remove

The search box is the highest-value filter with the lowest UI cost. It should be always visible. Other filters collapse behind a button.

### What if filters and sort were URL-driven (query params)?

The sort toggle already uses `?sort=`. Extending this to `?sort=name&dir=asc&players=2&minScore=5` makes the page state shareable and bookmarkable. More importantly for a Next.js server component page, it means the server can render the filtered/sorted view on initial load. But since all the data is fetched anyway and filtering/sorting is pure transformation, this is really about URL hygiene and browser back-button behavior, not performance.

**Recommendation:** URL params for sort field and direction. Filter state in URL params too, but only the active ones. Empty params = no filter = show everything.

---

## Client-Side vs Daemon API

### The case for client-side (strong)

The collection page already loads all games with scores in a single request. For a single-user tool with tens to low hundreds of games, filtering and sorting in the browser is:

- **Instant.** No network round-trip for filter changes.
- **Simple.** No new daemon API endpoints, no query parameter parsing, no server-side filter logic to test.
- **Consistent.** The client already has the full dataset. Re-fetching a filtered subset would be redundant.

### The case for daemon API support (weak for MVP)

- **CLI parity.** The CLI might want `sj list --sort=name --min-score=5`. But the CLI already gets the full list and could filter client-side too.
- **Future scale.** If collections grew to thousands of games, server-side filtering would matter. But the vision doc says this is a personal curation tool, not a database. Hundreds of games is a large personal collection.
- **Consistency.** If daemon owns filtering, web and CLI get identical behavior. But for simple sort/filter logic, the risk of divergence is low.

### What if we did both?

The daemon already sorts by fitness score server-side (the response comes pre-sorted). We could add optional `sort` and `filter` query params to `GET /api/games` for the CLI's benefit, while the web UI ignores them and sorts/filters client-side. This gives CLI users a nice interface without blocking web UI progress. But it's also two implementations of the same logic. Not worth it for MVP.

**Recommendation:** Client-side only for the first pass. The page already has all the data. If CLI needs filtering, add daemon params later.

### Client-side implementation consequence

The collection page is currently a server component. Client-side filtering and sorting requires making the game list interactive, which means a client component for the table section. The data fetch stays in the server component; the rendering and interaction move to a client component that receives the full game list as props.

This is the same pattern the `CollectionSortToggle` already uses, but expanded. The toggle is a small client component that manipulates URL params and triggers a server re-render. For client-side filtering, the table itself needs to be a client component that holds filter/sort state locally and transforms the game list before rendering.

**What if we kept URL params for sort but used client state for filters?** Sort changes the URL (back-button friendly, shareable), filter state is ephemeral (resets on page reload). This matches the expectation that "I sorted my collection by name" is a view preference, while "I'm filtering to 2-player games" is a momentary query. But the inconsistency could be confusing. Simpler to put everything in URL params or everything in client state.

---

## Tournament Column Interaction

The current sort toggle switches between fitness and tournament ranking. Both show in the same Score column, which changes what it displays. What if sorting by other fields still showed the score column with the currently-selected score type?

That is: sort field and score display are independent. You might sort by name alphabetically but still see fitness scores. Or sort by player count but see tournament rankings. The current toggle conflates "sort by" with "display metric." Separating them is more flexible.

**What if the score column always showed fitness, and tournament was a separate column?** The table could have both columns visible when tournament data exists. This avoids the toggle entirely and lets users sort by either column independently. Downside: another column on an already-wide table. But tournament data is the user's other ranking signal; hiding one to show the other is a real loss.

---

## The "Rated vs Unrated" Split

Currently the page renders rated games first (sorted), then unrated games below a separator. This is a visual filter that's always active. How does explicit filtering interact with it?

- If the user filters to "unrated only," the rated section disappears and unrated games fill the page. The separator is unnecessary.
- If the user filters to "rated only," unrated disappears. Again, no separator needed.
- If no rated/unrated filter is active, keep the current split.

**What if "unrated" was just a filter state rather than a permanent split?** Make the default view show all games in one list, sorted by fitness (unrated games sort to bottom with score "-"). Add a "Rated/Unrated/All" filter toggle. This simplifies the page structure and makes the separation a filter choice rather than a layout assumption. But the current split is nice because it visually communicates "these need attention." Removing it might lose that signal.

**Recommendation:** Keep the rated/unrated split as the default visual grouping. When the user applies a sort other than fitness or tournament, merge them into a single list (the split only makes sense for score-based sorts). When filtering to rated-only or unrated-only, show only that group.

---

## Open Questions

1. **Should filter state persist across sessions?** URL params persist per-tab but not across sessions. localStorage could remember "last used filters." But for a curation tool, ephemeral filters seem right; you filter to answer a question, then go back to the full view. If users find themselves re-applying the same filters repeatedly, that's a signal for a saved-views feature later.
USER RESPONSE: ephemeral filtering is right.

2. **How should the sort dropdown interact with the existing tournament toggle?** Replace it. The toggle is a special case of sort-by-field. A proper sort dropdown subsumes it. The toggle can be removed once the dropdown exists.
USER RESPONSE: 

3. **Should column headers be clickable for sorting?** Yes for columns that map to a single sort field (Score, Last Rated). Not practical for "Game" (which contains name, year, player count) or "Axes Rated" (which is a count but not obviously sortable). A sort dropdown covers the fields that don't map to a column.

4. **Mobile responsiveness.** The current table is wide. Filters add another bar above it. On mobile, should filters collapse into a slide-out panel? Or is the collection page simply a desktop-first experience for now?

5. **What about combining filters?** If I filter to "2 players" AND "under 60 minutes" AND "score above 7," that's a conjunction. Are there cases where OR logic matters? Probably not for MVP. AND is the natural default.

## Next Steps

This brainstorm covers the problem space. The natural next step is a spec or design that commits to specific filter fields, sort fields, UI placement, and component structure. Key decisions to lock in:

- Which filters ship first (text search + rated status + player count is a strong minimal set)
- Sort dropdown vs column headers vs hybrid
- Whether to keep or retire the tournament toggle
- Client component boundaries (how much of the page becomes interactive)
