---
title: "Commission: Document families as BGG tag type in specs"
date: 2026-04-11
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Resolve the open issue at `.lore/issues/document-families-tag-type.md`.\n\nBGG game data includes `families` as a tag type (e.g., \"Game: Catan\", \"Crowdfunding: Kickstarter\"). The codebase already imports and stores families, but specs and design docs only reference mechanics and categories.\n\nUpdate these documents to treat families as a peer to mechanics and categories:\n\n1. `.lore/designs/mvp-bgg-integration.md` — enumerate all tag types including families\n2. `.lore/specs/collection-profiling.md` — feature vector inputs should reference families alongside mechanics/categories\n\nAfter updating the docs, update the issue status to `resolved` in `.lore/issues/document-families-tag-type.md`."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-11T13:52:39.585Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T13:52:39.586Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
