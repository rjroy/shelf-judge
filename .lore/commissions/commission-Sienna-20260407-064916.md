---
title: "Commission: Mockup: Collection Page Filter and Sort UX"
date: 2026-04-07
status: completed
tags: [commission]
worker: Sienna
workerDisplayTitle: "Guild Illuminator"
prompt: "Design a mockup for the collection page's new filter and sort UX.\n\nRead the revised brainstorm at `.lore/brainstorms/collection-filter-sort.md` for all decisions and context. Also read the existing web UI mockups in `.lore/designs/` and any `.pen` files that show the current collection page, so your mockup is visually consistent.\n\nKey design points from the brainstorm:\n\n1. **Sort dropdown** replaces the current tournament/fitness toggle. Includes: fitness score, tournament ELO, name, year published, date added, last updated, player count, play time, BGG rating, BGG weight, and individual axis ratings.\n2. **Score column shows the active sort metric.** If sorting by an axis rating, the score column shows that axis's value. If sorting alphabetically, show fitness score as the default.\n3. **\"Has value / no value\" split.** Games without a value for the current sort field drop below a separator (generalizing the current rated/unrated split).\n4. **Filter bar** with always-visible text search and expandable filter controls (rated status, player count range, score range, play time).\n5. **Clickable column headers** for columns that map directly to a sort field (Score, Last Rated).\n6. **Mobile view:** sort dropdown replaces the existing toggle. Filters collapse appropriately.\n\nShow both desktop and mobile states. Show what the sort dropdown looks like expanded. Show an active filter state with filter chips/pills."
dependencies:
  - commission-Octavia-20260407-064903
linked_artifacts:
  - .lore/art/mockup-collection-filter-sort.html

activity_timeline:
  - timestamp: 2026-04-07T13:49:16.042Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T13:51:15.867Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-07T13:51:15.887Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-07T13:52:15.317Z
    event: progress_report
    reason: "Read brainstorm, style memory, and existing collection mockup. Now building the filter/sort UX mockup as HTML. Plan: one file with three annotated panels — desktop with active filters and sort dropdown expanded, desktop with a different sort active (axis rating), and mobile view."
  - timestamp: 2026-04-07T13:57:16.901Z
    event: result_submitted
    reason: "Created `.lore/art/mockup-collection-filter-sort.html` — a three-panel HTML mockup for the collection page's new filter and sort UX.\n\n**Panel 1 — Desktop: filter bar expanded, sort dropdown open, active filters**\nShows the full filter/sort state: sort dropdown expanded with four groups (Score, Identity, Specs, Your Axes), filter bar with search input + expanded panel (rated status, player count range, score range, play time range), and active filter chips row with search/\"Rated only\"/\"2–5 players\" chips. Stats strip shows filtered count (12 of 47) with \"Filtered — 35 games hidden\" note. Score column header has a two-line label: \"Score ↓\" main + \"Fitness\" subtitle.\n\n**Panel 2 — Desktop: axis sort active, no filters**\nShows what the table looks like when sorting by \"Wife Will Play It\" axis rating. Sort control button turns action-navy to signal non-default state. Score column shows axis rating (1–10) in navy, subtitle reads axis name verbatim. Axes column repurposed to show fitness score + ELO as alternate context. \"No value\" separator label changes to \"No rating on 'Wife Will Play It' — 14 games below.\"\n\n**Panel 3 — Mobile: two states side by side**\nState A: controls visible with active filter chips. Single-row layout: search + sort button (\"Fitness ↓\") + filter icon (navy when active). Chips shown directly below controls without \"Active:\" prefix.\nState B: sort dropdown open as full-width overlay, same four groups but touch-optimized (44px rows, larger font), background dimmed.\n\n**Key design decisions:**\n- Sort dropdown replaces the tournament toggle entirely; localStorage persists the selection\n- Score column header is always \"Score\" with a subtitle indicating what metric it reflects — avoids a confusing column rename while keeping context visible\n- \"Has value / no value\" separator generalizes the old rated/unrated split; label is contextual based on the active sort\n- Filter chips use three color classes: search (warm gray), rated (amber tint), spec (green tint) — matching the existing tournament filter chip vocabulary\n- No OR logic, no slide-out panel on mobile, no separate filter page\n\nAll annotations in each panel explain the interaction design decisions for developer handoff."
  - timestamp: 2026-04-07T13:57:28.982Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Read brainstorm, style memory, and existing collection mockup. Now building the filter/sort UX mockup as HTML. Plan: one file with three annotated panels — desktop with active filters and sort dropdown expanded, desktop with a different sort active (axis rating), and mobile view."
projectName: shelf-judge
---
Created `.lore/art/mockup-collection-filter-sort.html` — a three-panel HTML mockup for the collection page's new filter and sort UX.

**Panel 1 — Desktop: filter bar expanded, sort dropdown open, active filters**
Shows the full filter/sort state: sort dropdown expanded with four groups (Score, Identity, Specs, Your Axes), filter bar with search input + expanded panel (rated status, player count range, score range, play time range), and active filter chips row with search/"Rated only"/"2–5 players" chips. Stats strip shows filtered count (12 of 47) with "Filtered — 35 games hidden" note. Score column header has a two-line label: "Score ↓" main + "Fitness" subtitle.

**Panel 2 — Desktop: axis sort active, no filters**
Shows what the table looks like when sorting by "Wife Will Play It" axis rating. Sort control button turns action-navy to signal non-default state. Score column shows axis rating (1–10) in navy, subtitle reads axis name verbatim. Axes column repurposed to show fitness score + ELO as alternate context. "No value" separator label changes to "No rating on 'Wife Will Play It' — 14 games below."

**Panel 3 — Mobile: two states side by side**
State A: controls visible with active filter chips. Single-row layout: search + sort button ("Fitness ↓") + filter icon (navy when active). Chips shown directly below controls without "Active:" prefix.
State B: sort dropdown open as full-width overlay, same four groups but touch-optimized (44px rows, larger font), background dimmed.

**Key design decisions:**
- Sort dropdown replaces the tournament toggle entirely; localStorage persists the selection
- Score column header is always "Score" with a subtitle indicating what metric it reflects — avoids a confusing column rename while keeping context visible
- "Has value / no value" separator generalizes the old rated/unrated split; label is contextual based on the active sort
- Filter chips use three color classes: search (warm gray), rated (amber tint), spec (green tint) — matching the existing tournament filter chip vocabulary
- No OR logic, no slide-out panel on mobile, no separate filter page

All annotations in each panel explain the interaction design decisions for developer handoff.
