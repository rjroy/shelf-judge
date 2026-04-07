---
title: "Commission: Brainstorm: Collection Page Filter and Sorting"
date: 2026-04-07
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Brainstorm the two open issues together, since they're closely related UX concerns on the same page:\n\n1. `.lore/issues/collection-page-filter.md` — Collection page filter functionality\n2. `.lore/issues/collection-page-sorting.md` — Collection page sorting functionality\n\nUse the `/lore-development:brainstorm` skill. Read the existing collection page implementation (web UI, daemon API, shared types) to understand what's there now. Check `.lore/designs/` for any existing collection page design docs.\n\nKey questions to explore:\n- What fields make sense to filter by? (player count, weight, play time, fitness score, rating axes, BGG data, owned/wishlisted status, etc.)\n- What fields make sense to sort by? What's the default sort?\n- How should filter and sort interact with the existing table layout?\n- Should filters be persistent (remembered across sessions) or ephemeral?\n- Client-side filtering/sorting vs daemon API support — the collection is loaded in full, so client-side may be sufficient for MVP. What are the tradeoffs?\n- How does the tournament ELO ranking column interact with sorting?\n- Any UX patterns worth borrowing from BGG's own collection filtering?\n\nProduce a single brainstorm artifact covering both topics."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-07T01:56:04.275Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T01:56:04.279Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
