---
title: "Commission: Mockup: Tournament Session Filter UX"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Sienna
workerDisplayTitle: "Guild Illuminator"
prompt: "Create mockups for the tournament session filter UX described in `.lore/specs/tournament-ranking.md` (Open Question #3).\n\n## Context\n\nRead these files for visual and design context:\n- `.lore/specs/tournament-ranking.md` — the full spec, especially REQ-TOURN-12 (filter types) and Open Question #3\n- `.lore/designs/visual-direction.md` — the project's visual language\n- `.lore/visual-direction/` — existing mockups for style reference\n\n## What to mock up\n\nThe user starts a tournament session and optionally scopes it to a subset of their collection. Four filter types exist:\n\n1. **Name substring** — text search on game name\n2. **Minimum axis fitness** — numeric threshold (\"games rated above 6\")\n3. **BGG tag** — mechanic or category from BGG data (e.g., \"Worker Placement\", \"Cooperative\")\n4. **Staleness** — games with fewer than N comparisons (helps graduate provisional games)\n\nFilters can be combined. The minimum for a session is 4 games. If the filter produces fewer than 4, the user is told why and the session doesn't start.\n\n## Mockup requirements\n\nShow the session start flow:\n1. **Start screen** — where the user initiates a session, with the filter options visible but optional. Show both the \"no filter / full collection\" path and the \"filtered\" path.\n2. **Filter builder** — how the user constructs filters. Consider: inline controls, dropdown/chip pattern, or a compact filter bar. The UX should feel lightweight, not like building a database query. Preset filters (\"unranked games\", \"top rated\") would reduce friction.\n3. **Filter preview** — after applying filters, show how many games match before confirming. This prevents the \"fewer than 4\" error from feeling abrupt.\n4. **Active comparison screen** — what a head-to-head comparison looks like during a session (two game names, thumbnails, pick-one interaction).\n\nFollow the existing visual direction (colors, typography, spacing, layout patterns from the current mockups). Both desktop and phone layouts are relevant since the app now has responsive support.\n\nSave mockups to `.lore/visual-direction/tournament/`."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T21:40:19.857Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T21:40:19.859Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
