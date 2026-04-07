---
title: "Commission: Collection Filter/Sort Phase 1+2 Fix + Phase 3: Filters"
date: 2026-04-07
status: pending
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Two tasks in this commission:\n\n**Task 1: Fix Phase 1+2 review findings.**\nRead Thorne's review from the commission that just completed before this one (it reviewed Phases 1+2). Address ALL findings before starting Phase 3. Do not skip any finding regardless of severity.\n\n**Task 2: Implement Phase 3 (Filters).**\nRead the plan at `.lore/plans/collection-filter-sort.md` — Phase 3 has full implementation details.\nRead the spec at `.lore/specs/collection-filter-sort.md` — requirements REQ-CFS-15 through REQ-CFS-22.\nRead the mockup at `.lore/art/mockup-collection-filter-sort.html` — filter bar, chips, stats strip.\n\n**Phase 3 deliverables:**\n- Text search filter (always-visible search input, immediate filtering, REQ-CFS-15)\n- Rated status filter (segmented control: All/Rated/Unrated, REQ-CFS-16)\n- Player count filter (\"Plays at N\" input, REQ-CFS-16)\n- AND combination logic (REQ-CFS-18)\n- Active filter chips with dismiss buttons, \"Clear all\" link (REQ-CFS-17)\n- Filter toggle button with count badge (REQ-CFS-20)\n- Stats strip \"Filtered, K hidden\" note (REQ-CFS-19)\n- localStorage persistence for filters (key: `shelf-judge-filters`, REQ-CFS-22)\n- CSS classes matching mockup conventions\n\n**Verification:** `bun run typecheck`, `bun run lint`, `bun run test` all clean. Filters work independently and in combination. Chips render and dismiss correctly. Stats strip updates. localStorage persists filter state."
dependencies:
  - commission-Thorne-20260407-081526
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-07T15:15:39.445Z
    event: created
    reason: "Commission created"
current_progress: ""
projectName: shelf-judge
---
