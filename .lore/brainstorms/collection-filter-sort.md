---
title: "Collection page filtering and sorting"
date: 2026-04-06
status: resolved
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

## Sorting

### Sort fields

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

**Axis-specific rating.** A user with a "Wife will play it" axis should be able to sort by that rating alone, ignoring the aggregated fitness. This adds UI complexity (axis selector in the sort dropdown) but serves the tool's core thesis: the axes are what the user cares about, and sorting by a single axis is a natural way to explore the collection through a specific lens.

### The Score column reflects the active sort

Selecting a sort value is a signal of what the user cares about at that moment. The Score column changes to display the active sort metric. When sorting by fitness, it shows fitness score. When sorting by tournament ELO, it shows ELO rating. When sorting by a specific axis, it shows that axis's rating value. When sorting by player count, it shows player count.

The special case: sorting alphabetically by name. There's no meaningful "name score" to display, so the Score column falls back to showing fitness score. This is a pragmatic edge case, not a design principle.

This means the current tournament toggle is replaced by a proper sort dropdown. The toggle was a special case of "sort by X." The dropdown subsumes it. The user's sort selection persists via localStorage so they don't have to reselect it each session.

### Default sort

Fitness score descending. It's the app's thesis: the score tells you what belongs on your shelf. Every other sort is an alternate lens.

### Sort direction

Every sort field supports ascending and descending. Click-to-toggle on column headers works for columns that map to a single sort field. First click sorts descending (highest first) for numeric fields, ascending (A-Z) for name. Second click reverses.

### Null handling and the "has value / no value" split

The current page renders rated games first, then unrated games below a separator. This split generalizes: it's really "has sort value" vs "doesn't have sort value." When sorting by fitness score, unrated games have no meaningful score, so they fall below the line. When sorting by minimum player count, games without a player count have no sort value, so they fall below the line. When sorting alphabetically, every game has a name, so there's no split.

This replaces the hardcoded "rated vs unrated" visual grouping with a sort-aware grouping. The separator line and visual treatment stay the same; what changes is which games end up in which group.

---

## Filtering

### Filter fields

Filters answer the question: "Show me only games that match these criteria." The interesting question is which criteria matter for a collection curation tool specifically, not a general game database.

**High-value filters:**

1. **Rated / Not rated status.** The page already visually separates these. A filter makes it explicit and removes the other group entirely. Use case: "Show me only unrated games so I can work through the backlog."

2. **Player count range.** "Show me games that play at 2." The most common real-world filter: "We have 3 people tonight, what works?" Checks whether the requested count falls within `minPlayers..maxPlayers`. Games with null player counts are excluded from results when filtering by player count.

3. **Score range.** "Show me games scoring below 5.0." Identifies cull candidates. Or "above 8.0" to see the cream. A slider or min/max input.

4. **Has BGG data / manually added.** Quick way to find games that might need a BGG link, or to focus on the BGG-enriched portion of the collection.

**Medium-value filters:**

5. **Play time range.** "Show me games under 60 minutes." Same pattern as player count.

6. **BGG mechanics/categories.** "Show me all my worker-placement games." Powerful for collection analysis, but only works for BGG-imported games. Could use tag chips as filter toggles.

7. **Year published range.** Niche but useful for "show me my classics" or "show me recent acquisitions."

8. **Text search on name.** Not a filter in the dropdown sense, but a search box that narrows the visible rows. Fast, familiar, low UI cost. Arguably the single most useful "filter."

**Lower-value for first pass (but interesting):**

9. **BGG subdomain.** "Strategy Games," "Family Games," etc. Only a few values, could be a simple dropdown. But only for BGG games.

10. **Axis-specific rating range.** "Show me games I rated above 7 on 'Wife will play it'." Extremely powerful for the tool's thesis, but complex UI. A second-pass feature.

11. **Tournament provisional status.** "Show me games that need more comparisons." Useful for tournament workflows but niche.

### Ownership status

The data model doesn't track ownership status. Every game in the collection is implicitly "owned" (or at least "being evaluated"). There's no wishlist concept in MVP. This filter doesn't apply yet, but it's a natural extension if wishlists are ever added.

### Filter combination logic

Filters combine with AND logic only. "2 players AND under 60 minutes AND score above 7" is a conjunction. No OR logic.

---

## Implementation Decisions

### Client-side only

All filtering and sorting happens in the browser. No daemon API filtering endpoints. The collection page already loads all games with scores in a single request. For a single-user tool with tens to low hundreds of games, client-side filtering and sorting is:

- **Instant.** No network round-trip for filter changes.
- **Simple.** No new daemon API endpoints, no query parameter parsing, no server-side filter logic to test.
- **Consistent.** The client already has the full dataset. Re-fetching a filtered subset would be redundant.

If the CLI later needs filtering, daemon params can be added at that point. The web UI won't use them.

### Client-side implementation consequence

The collection page is currently a server component. Client-side filtering and sorting requires making the game list interactive, which means a client component for the table section. The data fetch stays in the server component; the rendering and interaction move to a client component that receives the full game list as props.

This is the same pattern the `CollectionSortToggle` already uses, but expanded. The toggle is a small client component that manipulates URL params and triggers a server re-render. For client-side filtering, the table itself needs to be a client component that holds filter/sort state locally and transforms the game list before rendering.

### State persistence

Both sort selection and filter state persist in localStorage. The user shouldn't have to reconfigure their preferred sort or active filters each session. This replaces URL params as the persistence mechanism for sort/filter state.

---

## UX Patterns

### Sort: hybrid of column headers and dropdown

Column headers are clickable where they map to a single sort field. The Score column sorts by whatever metric it's currently displaying (fitness or tournament ELO or axis rating). "Last Rated" sorts by `updatedAt`. A sort dropdown covers fields that don't have their own column: player count, play time, year published, date added, BGG rating, BGG weight, and individual axis ratings.

The dropdown replaces the existing tournament toggle. The toggle was a two-state switch; the dropdown generalizes it to all sort options. The user's selection persists via localStorage.

### Filter: a filter bar above the table

Collapsible, so it doesn't eat space when not in use. Options:

- A single "Filter" button that reveals a panel with filter controls
- An always-visible search box (text filter) with an expandable "More filters" section
- Chips/pills showing active filters, click to remove

The search box is the highest-value filter with the lowest UI cost. It should be always visible. Other filters collapse behind a button.

### Mobile

The current mobile layout uses a toggle to switch between fitness and tournament sorting. Replace that toggle with the sort dropdown. No slide-out panel or additional mobile-specific filter UI needed for the first pass.

---

## Open Questions

1. **Should the sort dropdown group axis-specific sorts separately?** If the user has 8 axes, the dropdown could get long. Grouping built-in sorts (fitness, ELO, name, year, etc.) separately from axis sorts would keep it navigable.

2. **What visual treatment does the Score column header get?** It needs to communicate that it reflects the active sort, not always fitness. A dynamic label ("Score: Fitness" / "Score: ELO" / "Score: Wife Factor") or just the metric name with an appropriate sort arrow.

3. **Which filters ship in the first pass?** Text search + rated status + player count is a strong minimal set. Score range and play time are natural follow-ups.

4. **How should axis-specific sorting handle unrated games for that axis?** These games have no value for the sort axis. They fall into the "no sort value" group below the separator, consistent with the general null handling rule.

---

## Next Steps

The key decisions are settled: client-side only, sort dropdown replacing the tournament toggle, Score column reflecting the active sort, "has value / no value" grouping, localStorage persistence, AND-only filters, column headers clickable where they map to a single field, and axis-specific sorting included in the design.

The natural next step is a spec or design that commits to specific filter fields, sort fields, UI placement, and component structure. Key items to lock in:

- Which filters ship first (text search + rated status + player count is a strong minimal set)
- Axis sort UI in the dropdown (grouping, naming)
- Score column dynamic labeling
- Client component boundaries (how much of the page becomes interactive)
- localStorage key structure for persistence
