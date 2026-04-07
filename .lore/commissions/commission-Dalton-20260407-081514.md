---
title: "Commission: Collection Filter/Sort Phase 1+2: Sort State, Dropdown, Score Column, Separator"
date: 2026-04-07
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 1 and 2 of the collection filter/sort feature.\n\n**Read the plan first:** `.lore/plans/collection-filter-sort.md` — it has full implementation details for both phases.\n**Read the spec:** `.lore/specs/collection-filter-sort.md` — requirements REQ-CFS-1 through REQ-CFS-14.\n**Read the mockup HTML:** `.lore/art/mockup-collection-filter-sort.html` — visual reference for the sort dropdown, score column, and separator.\n**Read current implementation:** `packages/web/app/page.tsx`, `packages/web/components/collection-sort-toggle.tsx`, `packages/web/app/globals.css`.\n\n**Phase 1 (Sort State and Dropdown):**\n- Create `packages/web/components/collection-table.tsx` as a client component\n- Extract `relativeDate()` to `packages/web/lib/date-utils.ts`\n- Move all row rendering, sort logic, and rated/unrated split from page.tsx into the client component\n- Build sort dropdown with all fields, four groups (Score, Identity, Specs, Your Axes), direction toggle\n- Persist sort in localStorage (key: `shelf-judge-sort`)\n- Strip page.tsx down to data fetching + passing props to CollectionTable\n\n**Phase 2 (Score Column and Separator):**\n- Score column shows the active sort metric's value (REQ-CFS-8)\n- Score column header has two-line label: \"SCORE\" + metric subtitle (REQ-CFS-9)\n- Clickable column headers for Score, Game, Last Rated (REQ-CFS-11-14)\n- Contextual separator labels (REQ-CFS-5-7)\n- Axes Rated column context switch when sorting by axis (REQ-CFS-10)\n\n**Verification:** `bun run typecheck`, `bun run lint`, `bun run test` all clean. Sort dropdown works for all field types. Score column updates. Separator labels are contextual. localStorage persists sort across reload."
dependencies: []
linked_artifacts:
  - packages/web/components/collection-table.tsx

  - packages/web/lib/date-utils.ts
  - packages/web/app/page.tsx
  - packages/web/app/globals.css
  - packages/web/lib/date-utils.ts
  - packages/web/app/page.tsx
  - packages/web/app/globals.css
activity_timeline:
  - timestamp: 2026-04-07T15:15:14.719Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T15:16:24.725Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-07T15:16:24.748Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-07T15:17:20.344Z
    event: progress_report
    reason: "Read the plan, spec, mockup, and all existing source files. Starting Phase 1: creating date-utils.ts, then building the CollectionTable client component with sort dropdown, and stripping page.tsx to a data-fetching shell."
  - timestamp: 2026-04-07T15:20:26.011Z
    event: progress_report
    reason: "Phase 1 and Phase 2 complete. Created date-utils.ts, collection-table.tsx (client component with sort dropdown, score column, clickable headers, separator labels). Stripped page.tsx to data-fetching shell. Added all CSS from mockup. Typecheck clean, lint clean, 398 tests pass."
  - timestamp: 2026-04-07T15:20:44.541Z
    event: result_submitted
    reason: "Phases 1 and 2 of collection filter/sort implemented. All verification passes: typecheck clean, lint clean, 398 tests pass (0 fail).\n\n**Phase 1 (Sort State and Dropdown):**\n- Created `packages/web/lib/date-utils.ts` with extracted `relativeDate()` function\n- Created `packages/web/components/collection-table.tsx` as client component with full sort state management\n- Sort dropdown with 4 groups (Score, Identity, Specs, Your Axes), direction toggle, outside-click close\n- Sort state persists in localStorage (`shelf-judge-sort`), defaults to fitness descending\n- Tournament ELO hidden when no tournament data; BGG fields hidden when no games have BGG data; Axes group hidden when no axes\n- `searchParams` prop removed from page.tsx (REQ-CFS-30); `?sort=` URL param silently ignored (REQ-CFS-23)\n- Stripped `packages/web/app/page.tsx` down to data fetching + passing props to `<CollectionTable>`\n\n**Phase 2 (Score Column and Separator):**\n- Score column dynamically shows active sort metric value for each game (REQ-CFS-8)\n- Score column header has two-line label: \"SCORE\" + metric subtitle (REQ-CFS-9)\n- Clickable column headers: Score toggles direction, Game sorts A-Z, Last Rated sorts by updatedAt (REQ-CFS-11-14)\n- Active sort column shows directional arrow indicator (REQ-CFS-14)\n- Contextual separator labels: \"Not yet rated\", \"No rating on '{axis}'\", \"No player count data\", etc. (REQ-CFS-5-7)\n- Axes Rated column shows fitness score + ELO when sorting by axis (REQ-CFS-10)\n- Null values sort to bottom regardless of direction, alphabetically by name within the null group (REQ-CFS-7)\n\n**CSS updates in globals.css:**\n- Replaced old `.sort-toggle` styles with `.sort-control`, `.sort-menu`, and all dropdown styles from mockup\n- Added `.col-label.sortable`, `.sort-active`, `.sort-arrow` for clickable headers\n- Added `.score-col-label`, `.score-col-main`, `.score-col-sub` for two-line score header\n- Added `.axis-sort-alt`, `.axis-sort-fitness`, `.axis-sort-elo` for axis-sort alternate column\n- Added `.section-sep-line` for separator visual\n- Updated phone breakpoint from `.sort-toggle` to `.sort-control`\n\n**Requirements covered:** REQ-CFS-1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21, 23, 27, 29, 30."
  - timestamp: 2026-04-07T15:20:49.591Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Phase 1 and Phase 2 complete. Created date-utils.ts, collection-table.tsx (client component with sort dropdown, score column, clickable headers, separator labels). Stripped page.tsx to data-fetching shell. Added all CSS from mockup. Typecheck clean, lint clean, 398 tests pass."
projectName: shelf-judge
---
Phases 1 and 2 of collection filter/sort implemented. All verification passes: typecheck clean, lint clean, 398 tests pass (0 fail).

**Phase 1 (Sort State and Dropdown):**
- Created `packages/web/lib/date-utils.ts` with extracted `relativeDate()` function
- Created `packages/web/components/collection-table.tsx` as client component with full sort state management
- Sort dropdown with 4 groups (Score, Identity, Specs, Your Axes), direction toggle, outside-click close
- Sort state persists in localStorage (`shelf-judge-sort`), defaults to fitness descending
- Tournament ELO hidden when no tournament data; BGG fields hidden when no games have BGG data; Axes group hidden when no axes
- `searchParams` prop removed from page.tsx (REQ-CFS-30); `?sort=` URL param silently ignored (REQ-CFS-23)
- Stripped `packages/web/app/page.tsx` down to data fetching + passing props to `<CollectionTable>`

**Phase 2 (Score Column and Separator):**
- Score column dynamically shows active sort metric value for each game (REQ-CFS-8)
- Score column header has two-line label: "SCORE" + metric subtitle (REQ-CFS-9)
- Clickable column headers: Score toggles direction, Game sorts A-Z, Last Rated sorts by updatedAt (REQ-CFS-11-14)
- Active sort column shows directional arrow indicator (REQ-CFS-14)
- Contextual separator labels: "Not yet rated", "No rating on '{axis}'", "No player count data", etc. (REQ-CFS-5-7)
- Axes Rated column shows fitness score + ELO when sorting by axis (REQ-CFS-10)
- Null values sort to bottom regardless of direction, alphabetically by name within the null group (REQ-CFS-7)

**CSS updates in globals.css:**
- Replaced old `.sort-toggle` styles with `.sort-control`, `.sort-menu`, and all dropdown styles from mockup
- Added `.col-label.sortable`, `.sort-active`, `.sort-arrow` for clickable headers
- Added `.score-col-label`, `.score-col-main`, `.score-col-sub` for two-line score header
- Added `.axis-sort-alt`, `.axis-sort-fitness`, `.axis-sort-elo` for axis-sort alternate column
- Added `.section-sep-line` for separator visual
- Updated phone breakpoint from `.sort-toggle` to `.sort-control`

**Requirements covered:** REQ-CFS-1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21, 23, 27, 29, 30.
