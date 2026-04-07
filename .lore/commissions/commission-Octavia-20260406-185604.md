---
title: "Commission: Brainstorm: Collection Page Filter and Sorting"
date: 2026-04-07
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Brainstorm the two open issues together, since they're closely related UX concerns on the same page:\n\n1. `.lore/issues/collection-page-filter.md` — Collection page filter functionality\n2. `.lore/issues/collection-page-sorting.md` — Collection page sorting functionality\n\nUse the `/lore-development:brainstorm` skill. Read the existing collection page implementation (web UI, daemon API, shared types) to understand what's there now. Check `.lore/designs/` for any existing collection page design docs.\n\nKey questions to explore:\n- What fields make sense to filter by? (player count, weight, play time, fitness score, rating axes, BGG data, owned/wishlisted status, etc.)\n- What fields make sense to sort by? What's the default sort?\n- How should filter and sort interact with the existing table layout?\n- Should filters be persistent (remembered across sessions) or ephemeral?\n- Client-side filtering/sorting vs daemon API support — the collection is loaded in full, so client-side may be sufficient for MVP. What are the tradeoffs?\n- How does the tournament ELO ranking column interact with sorting?\n- Any UX patterns worth borrowing from BGG's own collection filtering?\n\nProduce a single brainstorm artifact covering both topics."
dependencies: []
linked_artifacts:
  - .lore/brainstorms/collection-filter-sort.md

activity_timeline:
  - timestamp: 2026-04-07T01:56:04.275Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T01:56:04.279Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-07T01:56:04.300Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-07T01:56:10.590Z
    event: progress_report
    reason: "Reading the two issues and gathering context from existing implementation and design docs."
  - timestamp: 2026-04-07T01:56:44.594Z
    event: progress_report
    reason: "Context gathered: both issues, all design docs, web UI implementation, shared types. Ready to consult compendium and run brainstorm skill."
  - timestamp: 2026-04-07T01:59:15.425Z
    event: result_submitted
    reason: "Produced a single brainstorm artifact covering both collection page filtering and sorting issues.\n\n**Artifact:** `.lore/brainstorms/collection-filter-sort.md`\n\nKey areas explored:\n\n**Sorting:** Identified 10 candidate sort fields ranked by value. Fitness score stays as default. Discussed column-header clicks vs dropdown, sort direction toggling, null handling, and whether individual axis ratings should be sortable.\n\n**Filtering:** Identified 11 candidate filter fields. Recommended a minimal first set of text search + rated/unrated status + player count range. Explored how filters interact with the existing rated/unrated visual split.\n\n**Client-side vs daemon API:** Strong recommendation for client-side only. The collection is already fully loaded; adding daemon filter endpoints would duplicate logic for no performance benefit at personal-collection scale.\n\n**UX patterns:** Always-visible search box with collapsible \"more filters\" panel. Sort dropdown that subsumes the existing tournament toggle. URL params for both sort and filter state.\n\n**Tournament interaction:** Explored separating \"sort by\" from \"display metric\" so users can sort by name while still seeing fitness scores, and whether tournament should become a second visible column rather than a toggle.\n\nFive open questions flagged for the next phase (persistence, tournament toggle retirement, mobile responsiveness, filter combination logic, column header clickability)."
  - timestamp: 2026-04-07T01:59:20.085Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Context gathered: both issues, all design docs, web UI implementation, shared types. Ready to consult compendium and run brainstorm skill."
projectName: shelf-judge
---
Produced a single brainstorm artifact covering both collection page filtering and sorting issues.

**Artifact:** `.lore/brainstorms/collection-filter-sort.md`

Key areas explored:

**Sorting:** Identified 10 candidate sort fields ranked by value. Fitness score stays as default. Discussed column-header clicks vs dropdown, sort direction toggling, null handling, and whether individual axis ratings should be sortable.

**Filtering:** Identified 11 candidate filter fields. Recommended a minimal first set of text search + rated/unrated status + player count range. Explored how filters interact with the existing rated/unrated visual split.

**Client-side vs daemon API:** Strong recommendation for client-side only. The collection is already fully loaded; adding daemon filter endpoints would duplicate logic for no performance benefit at personal-collection scale.

**UX patterns:** Always-visible search box with collapsible "more filters" panel. Sort dropdown that subsumes the existing tournament toggle. URL params for both sort and filter state.

**Tournament interaction:** Explored separating "sort by" from "display metric" so users can sort by name while still seeing fitness scores, and whether tournament should become a second visible column rather than a toggle.

Five open questions flagged for the next phase (persistence, tournament toggle retirement, mobile responsiveness, filter combination logic, column header clickability).
