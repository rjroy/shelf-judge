---
title: "Commission: Mockup: Shelf Capacity UI Screens"
date: 2026-04-13
status: dispatched
tags: [commission]
worker: Sienna
workerDisplayTitle: "Guild Illuminator"
prompt: "Create UI mockups for the Shelf Capacity feature based on the spec at `.lore/specs/shelf-capacity.md`.\n\n**Context:** Shelf Judge is a board game collection curation tool. The web UI is a Next.js app at `packages/web/`. Read the existing pages, components, and styles to match the current visual language before designing.\n\n**Key files to read first:**\n- `.lore/specs/shelf-capacity.md` (the spec — read fully for requirements)\n- `packages/web/app/collection/page.tsx` (current collection page)\n- `packages/web/app/games/[id]/page.tsx` (current game detail page)\n- `packages/web/app/globals.css` (current styles, colors, dark mode tokens)\n- `packages/web/app/redundancy/page.tsx` (settings page pattern — the shelf config page will follow a similar settings page pattern)\n- `packages/web/components/` (existing component patterns)\n- `.lore/mockups/` (existing mockups for reference on style consistency)\n\n**What to mock up (5 screens as HTML mockups in `.lore/mockups/`):**\n\n1. **`mockup-shelf-game-dimensions.html`** — Game detail page showing box dimensions alongside existing metadata. Show two states: dimensions available (\"Box: 11.4 x 11.4 x 2.75 in\") and dimensions unknown (\"Box: not measured\"). Also include the game edit form with three numeric fields for width/height/depth and a clear button. (REQ-SHELF-6, REQ-SHELF-26)\n\n2. **`mockup-shelf-configuration.html`** — Shelf configuration settings page. Show shelf units as expandable sections, each containing a list of shelves with dimensions. Include: add unit button, add shelf to unit, edit shelf names and dimensions, remove shelf/unit, height-optional for \"on top of\" spaces (null height), live summary bar showing total shelves/capacity/unconstrained count. (REQ-SHELF-27, REQ-SHELF-28, REQ-SHELF-29)\n\n3. **`mockup-shelf-capacity-indicator.html`** — Collection page with the capacity indicator. Show four states: (a) all games placed successfully with average utilization, (b) overflow with count of unplaced games in warning style, (c) unfittable games warning, (d) shelves configured but no game dimensions available. The indicator should sit naturally in the collection page's existing header/filter area. (REQ-SHELF-30)\n\n4. **`mockup-shelf-capacity-detail.html`** — The capacity detail view. Three sections: (a) Per-shelf assignments showing each shelf with its assigned games, utilization bar, and letter grade (S/A/B/C/D/F). (b) Unfittable games section with game name, fitness, dimensions, and reason. (c) Displaced games section with game name, fitness, and volume. Include the dimension coverage note at the bottom. (REQ-SHELF-31)\n\n5. **`mockup-shelf-capacity-detail-empty.html`** — The capacity detail view in empty/unconfigured states: no shelf configuration (prompt to configure), and configured but no game dimensions (prompt to add dimensions). (REQ-SHELF-23, REQ-SHELF-24)\n\n**Design direction:**\n- Match the existing app's visual language (read the CSS and components first)\n- Shelf grades should have distinct visual treatment (color-coded badges: S=gold, A=green, B=blue, C=neutral, D=orange, F=red or similar)\n- Utilization bars on shelf assignments should show fill percentage visually\n- The capacity indicator on the collection page should be compact and non-intrusive when everything fits, but visually prominent when there's overflow\n- Unfittable games are the strongest cull signal — make them visually distinct from displaced games\n- Support both light and dark mode"
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-13T07:15:04.117Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T07:15:04.121Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
