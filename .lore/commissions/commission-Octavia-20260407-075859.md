---
title: "Commission: Spec: Collection Page Filter and Sort"
date: 2026-04-07
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write a spec for collection page filtering and sorting using the `/lore-development:specify` skill.\n\n**Inputs:**\n- Revised brainstorm: `.lore/brainstorms/collection-filter-sort.md` (read this first for all settled decisions)\n- Sienna's mockup: check `.lore/designs/` for any new `.pen` files related to collection filter/sort. Also check Sienna's commission output for the mockup file path.\n\nThe brainstorm has already resolved the major design questions. Your job is to turn those decisions into a proper spec with requirements, success criteria, and enough detail for Dalton to implement. Key decisions already settled:\n\n1. Client-side only filtering and sorting (no daemon API changes)\n2. Sort dropdown replaces tournament toggle, persisted via localStorage\n3. Score column reflects active sort metric (fitness, ELO, axis rating, or fallback to fitness for alphabetical)\n4. \"Has value / no value\" split generalizes the rated/unrated separator\n5. Axis-specific sorting included\n6. Filter bar with always-visible text search, expandable filter controls\n7. Filters combine with AND logic only\n8. localStorage for both sort and filter persistence\n9. Mobile: sort dropdown replaces existing toggle\n10. Clickable column headers where they map to a single sort field\n\nReference the mockup visuals in the spec so the implementer knows what to build toward. Resolve any remaining open questions from the brainstorm (axis sort grouping, Score column header labeling, which filters ship first, unrated-for-axis handling).\n\nSave to `.lore/specs/collection-filter-sort.md`."
dependencies:
  - commission-Octavia-20260407-064903
  - commission-Sienna-20260407-064916
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-07T14:58:59.608Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T15:03:07.982Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
