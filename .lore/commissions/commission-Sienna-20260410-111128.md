---
title: "Commission: Mockup: Profile Overview Page"
date: 2026-04-10
status: pending
tags: [commission]
worker: Sienna
workerDisplayTitle: "Guild Illuminator"
prompt: "Create an HTML mockup of the Profile Overview page based on the spec at `.lore/specs/collection-profiling.md`.\n\nThis page replaces the home page and is the primary entry point for the collection profiling feature. Read the spec thoroughly to understand all the sections and data the profile page needs to display.\n\n**Key sections from the spec to visualize:**\n- Axis rating distributions (mean, median, std dev, range per axis)\n- Axis weight interpretation (relative importance as percentages)\n- BGG attribute clustering (mechanics, categories, subdomains, weight range concentrations)\n- Utility curve declarations (how curves shape the profile)\n- Divergence detection (games where stated preference differs from revealed/tournament preference)\n- Outlier detection (games that don't fit the collection's statistical identity, using composite distance from centroid)\n- LLM narration section (cached natural language interpretation, user-initiated)\n\n**Design context:**\n- Read the existing web UI for visual style reference. Check `packages/web/` for the current design patterns, colors, layout conventions.\n- Previous mockups are in `.lore/mockups/` for style reference (especially the collection filter/sort mockup).\n- This is a data-rich dashboard page. Prioritize clarity and scannability over decoration.\n- The page should work responsively (the app supports phone and tablet).\n- Show realistic sample data that illustrates what each section communicates.\n\n**Deliverable:** An HTML mockup file at `.lore/mockups/profile-overview.html` with annotated sections explaining design decisions and how each section maps to spec requirements."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T18:11:28.880Z
    event: created
    reason: "Commission created"
current_progress: ""
projectName: shelf-judge
---
