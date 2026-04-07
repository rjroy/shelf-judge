---
title: "Commission: Plan: Collection Page Filter and Sort"
date: 2026-04-07
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Prepare an implementation plan for the collection page filter and sort feature using the `/lore-development:prep-plan` skill.\n\n**Input:** `.lore/specs/collection-filter-sort.md`\n\nAlso reference the mockup visuals (check `.lore/designs/` for the `.pen` file Sienna created for collection filter/sort) and the revised brainstorm at `.lore/brainstorms/collection-filter-sort.md` for additional context.\n\nRead the current collection page implementation (web UI components, styles, the existing sort toggle) to understand what exists and what needs to change. The plan should give Dalton everything he needs to build this without ambiguity.\n\nSave to `.lore/plans/collection-filter-sort.md`."
dependencies: []
linked_artifacts:
  - .lore/plans/collection-filter-sort.md

activity_timeline:
  - timestamp: 2026-04-07T15:08:00.533Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T15:08:00.535Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-07T15:08:00.555Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-07T15:08:11.949Z
    event: progress_report
    reason: "Starting plan preparation. Reading spec, brainstorm, and current implementation to build context."
  - timestamp: 2026-04-07T15:09:04.227Z
    event: progress_report
    reason: "Context gathered: spec (30 reqs), brainstorm, mockup HTML, current page.tsx (266 lines), CollectionSortToggle, shared types, CSS patterns, and compendium guidance. Now writing the plan."
  - timestamp: 2026-04-07T15:11:32.333Z
    event: progress_report
    reason: "Plan written to .lore/plans/collection-filter-sort.md. Verifying requirement coverage before submitting."
  - timestamp: 2026-04-07T15:11:48.159Z
    event: result_submitted
    reason: "Implementation plan written to `.lore/plans/collection-filter-sort.md`.\n\nFive sequential phases covering all 30 requirements from the spec:\n\n1. **Sort State and Dropdown** — Creates `CollectionTable` client component, extracts `relativeDate()` to utility, builds sort dropdown with 4 groups, persists to localStorage. Strips server component down to data fetch + empty state. (REQ-CFS-1-4, 21, 23, 27, 29, 30)\n\n2. **Score Column and Separator** — Dynamic score column reflecting active sort metric, two-line header with subtitle, contextual separator labels, clickable column headers for Score/Game/Last Rated. (REQ-CFS-5-14)\n\n3. **Filters** — Search input, rated status segmented control, player count filter, expandable filter panel, dismissible chips, stats strip update, localStorage persistence. (REQ-CFS-15-20, 22)\n\n4. **Remove CollectionSortToggle and Mobile** — Delete old toggle, add mobile sort overlay with dimmed background, responsive filter bar, touch-optimized tap targets. (REQ-CFS-24-26, 28)\n\n5. **Tests and Final Verification** — Unit tests for pure functions (sort comparator, filter predicate, score display, separator label), full verification checklist against all 10 success criteria.\n\nThe plan names every file to create, modify, or delete, specifies the sort field config structure, filter state shape, CSS class names (matched to mockup), and localStorage keys. Delegation guide assigns all phases to Dalton with Thorne reviews after Phase 4 and Phase 5."
  - timestamp: 2026-04-07T15:11:52.306Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Plan written to .lore/plans/collection-filter-sort.md. Verifying requirement coverage before submitting."
projectName: shelf-judge
---
Implementation plan written to `.lore/plans/collection-filter-sort.md`.

Five sequential phases covering all 30 requirements from the spec:

1. **Sort State and Dropdown** — Creates `CollectionTable` client component, extracts `relativeDate()` to utility, builds sort dropdown with 4 groups, persists to localStorage. Strips server component down to data fetch + empty state. (REQ-CFS-1-4, 21, 23, 27, 29, 30)

2. **Score Column and Separator** — Dynamic score column reflecting active sort metric, two-line header with subtitle, contextual separator labels, clickable column headers for Score/Game/Last Rated. (REQ-CFS-5-14)

3. **Filters** — Search input, rated status segmented control, player count filter, expandable filter panel, dismissible chips, stats strip update, localStorage persistence. (REQ-CFS-15-20, 22)

4. **Remove CollectionSortToggle and Mobile** — Delete old toggle, add mobile sort overlay with dimmed background, responsive filter bar, touch-optimized tap targets. (REQ-CFS-24-26, 28)

5. **Tests and Final Verification** — Unit tests for pure functions (sort comparator, filter predicate, score display, separator label), full verification checklist against all 10 success criteria.

The plan names every file to create, modify, or delete, specifies the sort field config structure, filter state shape, CSS class names (matched to mockup), and localStorage keys. Delegation guide assigns all phases to Dalton with Thorne reviews after Phase 4 and Phase 5.
