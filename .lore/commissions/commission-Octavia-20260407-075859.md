---
title: "Commission: Spec: Collection Page Filter and Sort"
date: 2026-04-07
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write a spec for collection page filtering and sorting using the `/lore-development:specify` skill.\n\n**Inputs:**\n- Revised brainstorm: `.lore/brainstorms/collection-filter-sort.md` (read this first for all settled decisions)\n- Sienna's mockup: check `.lore/designs/` for any new `.pen` files related to collection filter/sort. Also check Sienna's commission output for the mockup file path.\n\nThe brainstorm has already resolved the major design questions. Your job is to turn those decisions into a proper spec with requirements, success criteria, and enough detail for Dalton to implement. Key decisions already settled:\n\n1. Client-side only filtering and sorting (no daemon API changes)\n2. Sort dropdown replaces tournament toggle, persisted via localStorage\n3. Score column reflects active sort metric (fitness, ELO, axis rating, or fallback to fitness for alphabetical)\n4. \"Has value / no value\" split generalizes the rated/unrated separator\n5. Axis-specific sorting included\n6. Filter bar with always-visible text search, expandable filter controls\n7. Filters combine with AND logic only\n8. localStorage for both sort and filter persistence\n9. Mobile: sort dropdown replaces existing toggle\n10. Clickable column headers where they map to a single sort field\n\nReference the mockup visuals in the spec so the implementer knows what to build toward. Resolve any remaining open questions from the brainstorm (axis sort grouping, Score column header labeling, which filters ship first, unrated-for-axis handling).\n\nSave to `.lore/specs/collection-filter-sort.md`."
dependencies:
  - commission-Octavia-20260407-064903
  - commission-Sienna-20260407-064916
linked_artifacts:
  - .lore/specs/collection-filter-sort.md

activity_timeline:
  - timestamp: 2026-04-07T14:58:59.608Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T15:03:07.982Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-07T15:03:08.002Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-07T15:03:24.672Z
    event: progress_report
    reason: "Reading brainstorm and Sienna's commission output to gather context before writing spec."
  - timestamp: 2026-04-07T15:04:09.903Z
    event: progress_report
    reason: "Context gathered: brainstorm decisions, Sienna's mockup details, current page.tsx implementation, shared types (Game, Axis, FitnessResult, TournamentGameStatsDisplay, GameWithScore), existing spec format from tournament-ranking.md. Now writing the spec."
  - timestamp: 2026-04-07T15:05:51.758Z
    event: result_submitted
    reason: "Wrote spec at `.lore/specs/collection-filter-sort.md` with 30 requirements (CFS-1 through CFS-30) and 10 success criteria.\n\n**Open questions from brainstorm, resolved:**\n- Axis sort grouping: Yes, the dropdown uses four groups (Score, Identity, Specs, Your Axes) per the mockup. Axis sorts are in \"Your Axes\" group, hidden if no axes exist.\n- Score column header labeling: \"Score\" as primary label with a subtitle for the active metric (e.g., \"Fitness\", \"Wife Will Play It\"). Sort arrow next to \"Score.\"\n- Which filters ship first: Text search (always visible), rated status toggle, and player count range. Score range, play time, BGG tags, and the rest are deferred (listed explicitly in a \"NOT in first pass\" section).\n- Unrated-for-axis handling: Falls into the \"no value\" group below the separator, consistent with the general null handling rule. Separator label is contextual.\n\n**Key spec decisions:**\n- Client component architecture: new `CollectionTable` client component receives full data as props from the server component\n- `CollectionSortToggle` deleted, `?sort=` URL param removed (gracefully ignored if present)\n- localStorage keys for sort and filter persistence\n- Clickable column headers for Score, Game, and Last Rated\n- Stats strip updates to show \"N of M games\" when filtered\n- Mobile: full-width overlay dropdown, controls row with search/sort/filter\n- References Sienna's mockup at `.lore/art/mockup-collection-filter-sort.html` throughout"
  - timestamp: 2026-04-07T15:05:56.909Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Context gathered: brainstorm decisions, Sienna's mockup details, current page.tsx implementation, shared types (Game, Axis, FitnessResult, TournamentGameStatsDisplay, GameWithScore), existing spec format from tournament-ranking.md. Now writing the spec."
projectName: shelf-judge
---
Wrote spec at `.lore/specs/collection-filter-sort.md` with 30 requirements (CFS-1 through CFS-30) and 10 success criteria.

**Open questions from brainstorm, resolved:**
- Axis sort grouping: Yes, the dropdown uses four groups (Score, Identity, Specs, Your Axes) per the mockup. Axis sorts are in "Your Axes" group, hidden if no axes exist.
- Score column header labeling: "Score" as primary label with a subtitle for the active metric (e.g., "Fitness", "Wife Will Play It"). Sort arrow next to "Score."
- Which filters ship first: Text search (always visible), rated status toggle, and player count range. Score range, play time, BGG tags, and the rest are deferred (listed explicitly in a "NOT in first pass" section).
- Unrated-for-axis handling: Falls into the "no value" group below the separator, consistent with the general null handling rule. Separator label is contextual.

**Key spec decisions:**
- Client component architecture: new `CollectionTable` client component receives full data as props from the server component
- `CollectionSortToggle` deleted, `?sort=` URL param removed (gracefully ignored if present)
- localStorage keys for sort and filter persistence
- Clickable column headers for Score, Game, and Last Rated
- Stats strip updates to show "N of M games" when filtered
- Mobile: full-width overlay dropdown, controls row with search/sort/filter
- References Sienna's mockup at `.lore/art/mockup-collection-filter-sort.html` throughout
