---
title: "MVP Web UI"
date: 2026-04-04
status: draft
tags: [design, web-ui, frontend, mvp]
modules: [web-ui]
related:
  - .lore/specs/mvp.md
  - .lore/designs/mvp-api-surface.md
---

# Design: MVP Web UI

Satisfies: REQ-MVP-6, REQ-MVP-1, REQ-MVP-2, REQ-MVP-3, REQ-MVP-4, REQ-MVP-8, REQ-MVP-11

MVP web interface. Minimal, functional, not polished. Next.js App Router, server components where possible, client components for interactive elements.

## Screens

**1. Collection View** (home page)
- Table/grid of all games, sorted by fitness score (descending)
- Each row shows: game name, thumbnail, fitness score, last rated date
- Click a game to see its detail view
- "Add Game" button (opens search)
- "Import from BGG" button

**2. Game Detail View**
- Game info: name, year, player count, play time, thumbnail
- Fitness score with full breakdown (the transparency display from the score model design)
- Rating form: one slider or number input per axis, pre-filled with existing ratings
- BGG-derived axes show auto-populated value with option to override
- "Refresh BGG Data" button

**3. Game Search / Add**
- Text search field that queries BGG
- Results list with name, year, and thumbnail
- Click to add a game (fetches full BGG data on add)
- Manual add option for games not on BGG

**4. Axes Management**
- List of all axes with name, weight, source
- Create new axis (name, description, weight, source type)
- Edit axis weight and description
- Delete axis (with confirmation noting that ratings on this axis will be removed)

**5. Import Status**
- Shown during BGG collection import
- Progress indicator: "Importing 12 of 47..."
- List of imported games as they arrive
- Error summary at completion

## Navigation

Persistent sidebar or top nav with: Collection, Axes, Add Game. The collection view is the landing page.
