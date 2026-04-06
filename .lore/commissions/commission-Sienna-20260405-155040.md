---
title: "Commission: Visual Direction, Mockups, and Icon for Shelf Judge"
date: 2026-04-05
status: completed
tags: [commission]
worker: Sienna
workerDisplayTitle: "Guild Illuminator"
prompt: "Define the visual direction for Shelf Judge and produce mockups and an app icon.\n\n**Context:** Shelf Judge is a personal board game collection scoring tool. Users create rating axes (like \"Wife will play it\", \"Visual design\", \"Complexity\"), rate their games, and get a transparent weighted fitness score for each game. It integrates with BoardGameGeek for community data. The vibe is personal, opinionated, transparent — one person's honest assessment of their shelf.\n\nRead these for full context:\n- `.lore/vision.md` — project identity and principles\n- `.lore/designs/mvp-web-ui.md` — the screens you're designing for\n- `.lore/specs/mvp.md` — what the product does\n\n**Deliverables:**\n\n1. **Visual direction document** at `.lore/designs/visual-direction.md` — Color palette, typography choices, spacing/layout philosophy, component style (cards, tables, buttons), mood/personality. This is a board game tool for someone who cares about their collection. It should feel considered, not corporate. Not gamified or cartoonish either.\n\n2. **Mockups** — Design key screens in a .pen file:\n   - Collection view (home page with game list ranked by fitness)\n   - Game detail view (the score breakdown is the hero — this is where transparency lives)\n   - Axes management page\n   - BGG import progress screen\n\n3. **App icon** — Something that works at 32px and 512px. The concept should connect to the idea of judging/scoring a shelf of games. Not literal scales or gavels. Think about what makes this tool distinctive: it's personal, transparent, and mathematical.\n\nThe MVP is already partially built with default Next.js styling. Your work here defines where the UI goes next. Don't feel constrained by what exists — propose the right visual identity and the implementation will follow."
dependencies: []
linked_artifacts:
  - .lore/designs/visual-direction.md

  - .lore/art/icon.png
  - .lore/art/mockup-collection-view.html
  - .lore/art/mockup-game-detail.html
  - .lore/art/mockup-axes.html
  - .lore/art/mockup-bgg-import.html
  - .lore/generated/shelf-judge-icon-final
  - .lore/art/icon.png
  - .lore/art/mockup-collection-view.html
  - .lore/art/mockup-game-detail.html
  - .lore/art/mockup-axes.html
  - .lore/art/mockup-bgg-import.html
  - .lore/generated/shelf-judge-icon-final
resource_overrides:
  model: sonnet

activity_timeline:
  - timestamp: 2026-04-05T22:50:40.827Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-05T22:50:40.829Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-05T22:50:40.844Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-05T23:05:21.137Z
    event: result_submitted
    reason: "Visual direction defined and mockups produced for Shelf Judge. Here's what was created and why.\n\n## Creative Direction\n\n**Personality:** Shelf Judge is a personal curation tool, not a product. The right analogy is a well-maintained notebook — considered, precise, slightly analog. No gamification, no corporate SaaS feel. The fitness score is the hero of every screen.\n\n**Palette:** Warm off-white base (#f4f1ec, like quality cardboard stock) with a dark navy sidebar (#1a1714). Amber-brown (#b86c1a) for fitness scores — the precious number. Slate blue (#2e5f8a) for BGG-derived data, because it has different provenance from personal ratings. Purple (#5c3d99) for user overrides of BGG values. Three-color score spectrum: green/amber-gold/red for high/mid/low fitness ranges.\n\n**Typography:** Inter with tabular numerals on all scores. Uppercase, letter-spaced labels for column headers and axis names. The 52px amber fitness number in the detail view hero is the product's visual anchor.\n\n**Layout:** 200px dark sidebar nav + warm cream content area. Collection view is a table (not cards) — this is a tool for someone comparing numbers, not browsing covers. Game detail is a two-panel split: score breakdown with contribution bars on the left, rating sliders on the right.\n\n## Deliverables\n\n### Visual Direction Document\n`.lore/designs/visual-direction.md` — Complete palette with CSS tokens, typography scale, spacing, component language, and mood reference. Ready to implement.\n\n### App Icon\n`.lore/art/icon.png` — FLUX 2 Pro, 512×512. Four game box spines on a shelf line, arranged tallest-to-shortest (ranking order). Amber \"1\" ribbon badge on the tallest (winner) box. Warm cream background. Reads as \"judged shelf\" at 512px, as \"boxes on a shelf\" at 32px favicon. Cost: $0.05.\n\n**Exploration path:** 5× FLUX Schnell ($0.003 ea) + 5× Ideogram V3 Turbo ($0.03 ea) + 1× FLUX 2 Pro final ($0.05). Total: ~$0.22 for icon work.\n\nExplored: bar chart (too generic/analytics), radar chart (FLUX failed), bookshelf/game boxes (winner), prism concept (rendered as caution triangle). The game box concept earned its place — it's the only option that literally shows a shelf being judged.\n\n### HTML Mockups (4 screens)\n\nAll mockups implement the full visual direction. Pencil editor was unavailable; HTML is the correct format for UI mockups (AI image generators garble readable text — per established working notes).\n\n**`.lore/art/mockup-collection-view.html`** — Home page. Dark sidebar nav with amber active indicator. Stats strip (total games, avg fitness, rated count, axes). Sortable table: rank | thumbnail | game name + BGG badge | axes rated chips | last rated date | score with color-dot indicator. \"Not yet rated\" section at bottom. Score column uses amber for all values, green/amber/red dots for range.\n\n**`.lore/art/mockup-game-detail.html`** — The transparency screen. Large 52px amber fitness score in the hero alongside game metadata. Split panel: LEFT — full score breakdown table (Axis / Rating / Weight / Contribution bar+% / Source badge). BGG rows get blue tint, override rows get purple tint. Contribution bars are thin inline percentage bars. Bottom row: \"Fitness Score: 9.1\" in bold amber. RIGHT — rating sliders for personal axes, auto-populated read-only displays for BGG axes with override affordance, purple styling for any active override. BGG value shown alongside override (\"BGG value: 8 · Your override: 9\").\n\n**`.lore/art/mockup-axes.html`** — Axes management. Total weight summary bar at top (shows weights sum to 100). Personal axes as cards with name, description, weight number + percentage, visual weight bar, edit/delete actions, usage stats strip (rated on N games, avg rating). BGG-derived axes section with blue-tinted stats strip showing auto-population and override counts.\n\n**`.lore/art/mockup-bgg-import.html`** — Import progress. Status banner with pulse animation during import, game count (12/47), linear progress bar with percentage, real-time log list with status icons (✓ added / ↷ skipped / ✗ error / ··· loading), and a pending note about BGG rate limiting.\n\n## Notes for Implementation\n\n1. **Score display is never optional.** The detail view always shows the full breakdown. This is REQ-MVP-5 expressed visually.\n\n2. **BGG vs personal color distinction** is load-bearing. The slate blue / purple / neutral three-way distinction tells the user immediately who contributed a rating. Don't collapse these.\n\n3. **Tabular numerals** everywhere numerical values appear. Without this, score columns won't align and the tool loses its analytical precision.\n\n4. **The sidebar nav is dark.** This is a deliberate contrast anchor. Without it, the warm cream content area reads as undifferentiated beige.\n\n5. **The icon works at 32px** as \"boxes on a shelf\" without the ribbon being legible. The ribbon is a 512px detail. This is intentional — small sizes communicate the shelf, large sizes communicate the judgment.\n"
  - timestamp: 2026-04-05T23:05:36.842Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: ""
projectName: shelf-judge
---
Visual direction defined and mockups produced for Shelf Judge. Here's what was created and why.

## Creative Direction

**Personality:** Shelf Judge is a personal curation tool, not a product. The right analogy is a well-maintained notebook — considered, precise, slightly analog. No gamification, no corporate SaaS feel. The fitness score is the hero of every screen.

**Palette:** Warm off-white base (#f4f1ec, like quality cardboard stock) with a dark navy sidebar (#1a1714). Amber-brown (#b86c1a) for fitness scores — the precious number. Slate blue (#2e5f8a) for BGG-derived data, because it has different provenance from personal ratings. Purple (#5c3d99) for user overrides of BGG values. Three-color score spectrum: green/amber-gold/red for high/mid/low fitness ranges.

**Typography:** Inter with tabular numerals on all scores. Uppercase, letter-spaced labels for column headers and axis names. The 52px amber fitness number in the detail view hero is the product's visual anchor.

**Layout:** 200px dark sidebar nav + warm cream content area. Collection view is a table (not cards) — this is a tool for someone comparing numbers, not browsing covers. Game detail is a two-panel split: score breakdown with contribution bars on the left, rating sliders on the right.

## Deliverables

### Visual Direction Document
`.lore/designs/visual-direction.md` — Complete palette with CSS tokens, typography scale, spacing, component language, and mood reference. Ready to implement.

### App Icon
`.lore/art/icon.png` — FLUX 2 Pro, 512×512. Four game box spines on a shelf line, arranged tallest-to-shortest (ranking order). Amber "1" ribbon badge on the tallest (winner) box. Warm cream background. Reads as "judged shelf" at 512px, as "boxes on a shelf" at 32px favicon. Cost: $0.05.

**Exploration path:** 5× FLUX Schnell ($0.003 ea) + 5× Ideogram V3 Turbo ($0.03 ea) + 1× FLUX 2 Pro final ($0.05). Total: ~$0.22 for icon work.

Explored: bar chart (too generic/analytics), radar chart (FLUX failed), bookshelf/game boxes (winner), prism concept (rendered as caution triangle). The game box concept earned its place — it's the only option that literally shows a shelf being judged.

### HTML Mockups (4 screens)

All mockups implement the full visual direction. Pencil editor was unavailable; HTML is the correct format for UI mockups (AI image generators garble readable text — per established working notes).

**`.lore/art/mockup-collection-view.html`** — Home page. Dark sidebar nav with amber active indicator. Stats strip (total games, avg fitness, rated count, axes). Sortable table: rank | thumbnail | game name + BGG badge | axes rated chips | last rated date | score with color-dot indicator. "Not yet rated" section at bottom. Score column uses amber for all values, green/amber/red dots for range.

**`.lore/art/mockup-game-detail.html`** — The transparency screen. Large 52px amber fitness score in the hero alongside game metadata. Split panel: LEFT — full score breakdown table (Axis / Rating / Weight / Contribution bar+% / Source badge). BGG rows get blue tint, override rows get purple tint. Contribution bars are thin inline percentage bars. Bottom row: "Fitness Score: 9.1" in bold amber. RIGHT — rating sliders for personal axes, auto-populated read-only displays for BGG axes with override affordance, purple styling for any active override. BGG value shown alongside override ("BGG value: 8 · Your override: 9").

**`.lore/art/mockup-axes.html`** — Axes management. Total weight summary bar at top (shows weights sum to 100). Personal axes as cards with name, description, weight number + percentage, visual weight bar, edit/delete actions, usage stats strip (rated on N games, avg rating). BGG-derived axes section with blue-tinted stats strip showing auto-population and override counts.

**`.lore/art/mockup-bgg-import.html`** — Import progress. Status banner with pulse animation during import, game count (12/47), linear progress bar with percentage, real-time log list with status icons (✓ added / ↷ skipped / ✗ error / ··· loading), and a pending note about BGG rate limiting.

## Notes for Implementation

1. **Score display is never optional.** The detail view always shows the full breakdown. This is REQ-MVP-5 expressed visually.

2. **BGG vs personal color distinction** is load-bearing. The slate blue / purple / neutral three-way distinction tells the user immediately who contributed a rating. Don't collapse these.

3. **Tabular numerals** everywhere numerical values appear. Without this, score columns won't align and the tool loses its analytical precision.

4. **The sidebar nav is dark.** This is a deliberate contrast anchor. Without it, the warm cream content area reads as undifferentiated beige.

5. **The icon works at 32px** as "boxes on a shelf" without the ribbon being legible. The ribbon is a 512px detail. This is intentional — small sizes communicate the shelf, large sizes communicate the judgment.

