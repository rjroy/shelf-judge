---
title: "Commission: Mockup: Tournament Session Filter UX"
date: 2026-04-06
status: completed
tags: [commission]
worker: Sienna
workerDisplayTitle: "Guild Illuminator"
prompt: "Create mockups for the tournament session filter UX described in `.lore/specs/tournament-ranking.md` (Open Question #3).\n\n## Context\n\nRead these files for visual and design context:\n- `.lore/specs/tournament-ranking.md` — the full spec, especially REQ-TOURN-12 (filter types) and Open Question #3\n- `.lore/designs/visual-direction.md` — the project's visual language\n- `.lore/visual-direction/` — existing mockups for style reference\n\n## What to mock up\n\nThe user starts a tournament session and optionally scopes it to a subset of their collection. Four filter types exist:\n\n1. **Name substring** — text search on game name\n2. **Minimum axis fitness** — numeric threshold (\"games rated above 6\")\n3. **BGG tag** — mechanic or category from BGG data (e.g., \"Worker Placement\", \"Cooperative\")\n4. **Staleness** — games with fewer than N comparisons (helps graduate provisional games)\n\nFilters can be combined. The minimum for a session is 4 games. If the filter produces fewer than 4, the user is told why and the session doesn't start.\n\n## Mockup requirements\n\nShow the session start flow:\n1. **Start screen** — where the user initiates a session, with the filter options visible but optional. Show both the \"no filter / full collection\" path and the \"filtered\" path.\n2. **Filter builder** — how the user constructs filters. Consider: inline controls, dropdown/chip pattern, or a compact filter bar. The UX should feel lightweight, not like building a database query. Preset filters (\"unranked games\", \"top rated\") would reduce friction.\n3. **Filter preview** — after applying filters, show how many games match before confirming. This prevents the \"fewer than 4\" error from feeling abrupt.\n4. **Active comparison screen** — what a head-to-head comparison looks like during a session (two game names, thumbnails, pick-one interaction).\n\nFollow the existing visual direction (colors, typography, spacing, layout patterns from the current mockups). Both desktop and phone layouts are relevant since the app now has responsive support.\n\nSave mockups to `.lore/visual-direction/tournament/`."
dependencies: []
linked_artifacts:
  - .lore/visual-direction/tournament/01-session-start.html

  - .lore/visual-direction/tournament/02-filter-builder.html
  - .lore/visual-direction/tournament/03-filter-preview.html
  - .lore/visual-direction/tournament/04-active-comparison.html
  - .lore/visual-direction/tournament/02-filter-builder.html
  - .lore/visual-direction/tournament/03-filter-preview.html
  - .lore/visual-direction/tournament/04-active-comparison.html
activity_timeline:
  - timestamp: 2026-04-06T21:40:19.857Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T21:40:19.859Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-06T21:40:19.878Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-06T21:47:45.027Z
    event: result_submitted
    reason: "Created four HTML mockups for the tournament session filter UX in `.lore/visual-direction/tournament/`.\n\n**Files delivered:**\n- `01-session-start.html` — Tournament landing page. Shows resume banner for active session (green dot, session name, comparisons count, Resume/End buttons). Below it: New Session panel with quick presets (All games / Unranked / Top rated / Needs more data, each with live count) plus custom filter builder entry point. Stats strip at bottom (total comparisons, top rank, provisional count, past sessions).\n- `02-filter-builder.html` — Filter construction state. Active filters render as colored chips (navy for axis fitness, slate blue for BGG tag) with × remove buttons. Adding a filter shows inline controls: type select + value input side by side. BGG tag input has autocomplete dropdown showing tag name + game count. Live count in footer updates as filters change. \"Clear all\" and \"Preview scope →\" at footer.\n- `03-filter-preview.html` — Two scenarios on one page. Scenario A (11 games match): count displayed hero-large, \"Minimum met\" in green, scrollable list of first 4 matching games showing both axis and tournament scores, \"Game list is fixed at session start\" caveat, \"Start with 11 games →\" CTA. Scenario B (2 games match): count in danger red, \"Minimum not met\", error message explaining minimum, Start button disabled with 0.4 opacity.\n- `04-active-comparison.html` — Desktop and mobile layouts. Desktop: full sidebar + topbar with session name and \"End session\" danger-ghost button, two game cards centered with \"vs\" divider, each card has 120px thumbnail, game name, axis score (amber) + tournament score (slate blue), \"Keep this one\" button. Cards lift on hover (border + shadow + translateY). Footer shows comparison count, a decorative progress bar labeled \"Comparing games with fewer comparisons first\", and End session button. Mobile (390px phone frame): cards stacked vertically, tap-to-select with checkmark indicator. Interaction notes section documents: no skip (per spec), score display handling for unranked games, progress bar intent.\n\n**Creative decisions:**\n- Preset buttons solve the \"lightweight, not a database query\" requirement from the brief. The most common session types (all games, unranked) are one click. Custom filters are secondary.\n- Filter chips use color coding by provenance: slate blue for BGG-derived (matching the existing visual language where BGG data is always slate blue), navy for axis fitness (user's own data), amber/mid for staleness.\n- BGG tag autocomplete shows game count alongside each tag — critical context for knowing if a filter will produce enough games before committing.\n- Tournament rank displayed in slate blue on comparison cards — visually consistent with the rest of the app where BGG-derived/external signals are always slate blue.\n- The filter preview step is its own screen (not an inline update) so the user can see the full game list before committing. This prevents the \"fewer than 4\" error from feeling abrupt.\n- Progress bar is explicitly labeled as a reference count, not a goal counter, to preserve the spec's intent that sessions have no fixed length.\n\n**Estimated API cost:** $0 — all deliverables are HTML/CSS mockups. No image generation calls were made per the project's UI mockup convention (FLUX garbles readable UI text; HTML is the correct medium)."
  - timestamp: 2026-04-06T21:47:54.680Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: ""
projectName: shelf-judge
---
Created four HTML mockups for the tournament session filter UX in `.lore/visual-direction/tournament/`.

**Files delivered:**
- `01-session-start.html` — Tournament landing page. Shows resume banner for active session (green dot, session name, comparisons count, Resume/End buttons). Below it: New Session panel with quick presets (All games / Unranked / Top rated / Needs more data, each with live count) plus custom filter builder entry point. Stats strip at bottom (total comparisons, top rank, provisional count, past sessions).
- `02-filter-builder.html` — Filter construction state. Active filters render as colored chips (navy for axis fitness, slate blue for BGG tag) with × remove buttons. Adding a filter shows inline controls: type select + value input side by side. BGG tag input has autocomplete dropdown showing tag name + game count. Live count in footer updates as filters change. "Clear all" and "Preview scope →" at footer.
- `03-filter-preview.html` — Two scenarios on one page. Scenario A (11 games match): count displayed hero-large, "Minimum met" in green, scrollable list of first 4 matching games showing both axis and tournament scores, "Game list is fixed at session start" caveat, "Start with 11 games →" CTA. Scenario B (2 games match): count in danger red, "Minimum not met", error message explaining minimum, Start button disabled with 0.4 opacity.
- `04-active-comparison.html` — Desktop and mobile layouts. Desktop: full sidebar + topbar with session name and "End session" danger-ghost button, two game cards centered with "vs" divider, each card has 120px thumbnail, game name, axis score (amber) + tournament score (slate blue), "Keep this one" button. Cards lift on hover (border + shadow + translateY). Footer shows comparison count, a decorative progress bar labeled "Comparing games with fewer comparisons first", and End session button. Mobile (390px phone frame): cards stacked vertically, tap-to-select with checkmark indicator. Interaction notes section documents: no skip (per spec), score display handling for unranked games, progress bar intent.

**Creative decisions:**
- Preset buttons solve the "lightweight, not a database query" requirement from the brief. The most common session types (all games, unranked) are one click. Custom filters are secondary.
- Filter chips use color coding by provenance: slate blue for BGG-derived (matching the existing visual language where BGG data is always slate blue), navy for axis fitness (user's own data), amber/mid for staleness.
- BGG tag autocomplete shows game count alongside each tag — critical context for knowing if a filter will produce enough games before committing.
- Tournament rank displayed in slate blue on comparison cards — visually consistent with the rest of the app where BGG-derived/external signals are always slate blue.
- The filter preview step is its own screen (not an inline update) so the user can see the full game list before committing. This prevents the "fewer than 4" error from feeling abrupt.
- Progress bar is explicitly labeled as a reference count, not a goal counter, to preserve the spec's intent that sessions have no fixed length.

**Estimated API cost:** $0 — all deliverables are HTML/CSS mockups. No image generation calls were made per the project's UI mockup convention (FLUX garbles readable UI text; HTML is the correct medium).
