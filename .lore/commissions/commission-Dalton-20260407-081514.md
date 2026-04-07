---
title: "Commission: Collection Filter/Sort Phase 1+2: Sort State, Dropdown, Score Column, Separator"
date: 2026-04-07
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 1 and 2 of the collection filter/sort feature.\n\n**Read the plan first:** `.lore/plans/collection-filter-sort.md` — it has full implementation details for both phases.\n**Read the spec:** `.lore/specs/collection-filter-sort.md` — requirements REQ-CFS-1 through REQ-CFS-14.\n**Read the mockup HTML:** `.lore/art/mockup-collection-filter-sort.html` — visual reference for the sort dropdown, score column, and separator.\n**Read current implementation:** `packages/web/app/page.tsx`, `packages/web/components/collection-sort-toggle.tsx`, `packages/web/app/globals.css`.\n\n**Phase 1 (Sort State and Dropdown):**\n- Create `packages/web/components/collection-table.tsx` as a client component\n- Extract `relativeDate()` to `packages/web/lib/date-utils.ts`\n- Move all row rendering, sort logic, and rated/unrated split from page.tsx into the client component\n- Build sort dropdown with all fields, four groups (Score, Identity, Specs, Your Axes), direction toggle\n- Persist sort in localStorage (key: `shelf-judge-sort`)\n- Strip page.tsx down to data fetching + passing props to CollectionTable\n\n**Phase 2 (Score Column and Separator):**\n- Score column shows the active sort metric's value (REQ-CFS-8)\n- Score column header has two-line label: \"SCORE\" + metric subtitle (REQ-CFS-9)\n- Clickable column headers for Score, Game, Last Rated (REQ-CFS-11-14)\n- Contextual separator labels (REQ-CFS-5-7)\n- Axes Rated column context switch when sorting by axis (REQ-CFS-10)\n\n**Verification:** `bun run typecheck`, `bun run lint`, `bun run test` all clean. Sort dropdown works for all field types. Score column updates. Separator labels are contextual. localStorage persists sort across reload."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-07T15:15:14.719Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T15:16:24.725Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
