---
title: "Game links"
date: 2026-04-11
status: approved
tags: [spec, web-ui, navigation, links]
modules: [web-ui]
related:
  - .lore/issues/game-links.md
  - .lore/designs/mvp-web-ui.md
  - .lore/specs/collection-profiling.md
req-prefix: GLINK
---

# Spec: Game Links

## Overview

Every game name rendered in the web UI should be a clickable link to that game's detail page (`/games/{id}`). The collection table already wraps entire rows in a `<Link>`, but game names elsewhere (profile views, tournament comparisons, score breakdowns) are plain text. This spec standardizes the pattern: if a game name is visible and the game is in the collection, the name links to its detail page.

## Entry Points

- User sees a game name anywhere in the UI and clicks it.
- User hovers over a game name and sees a pointer cursor indicating it's interactive.

## Current State

Ten surfaces render game names today. Two already link; eight do not.

**Already linked:**

1. **Collection table** (`components/collection-table.tsx:543`) wraps the full row in `<Link href={/games/${id}}>`.
2. **Search preview** (`app/search/page.tsx:67`) shows "View details" link when a previewed game is already in the collection.

**Not yet linked:**

<!-- prettier-ignore-start -->

3. **Game detail breadcrumb** (`app/games/[id]/page.tsx:88`) shows the game name as `<strong>` text. This is the current page, so no link needed. Excluded from scope.
4. **Game detail hero title** (`app/games/[id]/page.tsx:100`) shows the game name as the page heading. Same page, no link. Excluded from scope.
5. **Tournament session cards** (`app/tournament/session/page.tsx:244,289`) show `pair.gameA.name` and `pair.gameB.name` as plain text inside clickable cards.
6. **Tournament recent comparisons** (`app/games/[id]/page.tsx:353`) shows opponent name as `c.opponentGameName ?? c.opponentGameId.slice(0, 8)`, with `c.opponentGameId` available.
7. **Score breakdown reference games** (`components/score-breakdown.tsx:291`) shows `ref.gameName` in the confidence detail panel, with `ref.gameId` available.
8. **Profile divergence** (`components/profile/divergence.tsx:17`) shows `game.gameName` with `game.gameId` available.
9. **Profile outliers** (`components/profile/outliers.tsx:43`) shows `outlier.gameName` with `outlier.gameId` available.
10. **Search results** (`app/search/page.tsx:294`) shows `r.name` for BGG search results not yet in the collection. These games don't have a detail page. Excluded from scope.
<!-- prettier-ignore-end -->

## Key Decision: Link the Name, Not the Row

In surfaces #6-#9, the game name itself becomes a `<Link>`. The surrounding row or card retains its existing click behavior (if any). Tournament session cards (#5) are excluded per the next decision.

## Key Decision: Tournament Cards Are an Exception

Tournament session cards (#5) use the entire card as a "pick this game" button. Adding a navigation link inside a pick target creates a confusing interaction. For tournament cards, the game name does NOT become a link. The user picks a game by clicking the card. They can view game details from the game detail page or the collection table. This keeps the tournament interaction clean.

## Key Decision: Search Results Stay Plain

BGG search results (#10) represent games not in the collection. They have no detail page to link to. The existing "Preview" button and "View details" link (for games already in the collection) handle navigation. No change needed.

## Requirements

### Linking game names

- REQ-GLINK-1: In the profile divergence view, each game name links to `/games/{gameId}`.
- REQ-GLINK-2: In the profile outliers view, each game name links to `/games/{gameId}`.
- REQ-GLINK-3: In the score breakdown reference games list, each game name links to `/games/{gameId}`.
- REQ-GLINK-4: In the tournament recent comparisons section on the game detail page, each opponent game name links to `/games/{opponentGameId}`. When `opponentGameName` is null and the truncated ID fallback is displayed, that text is also a link.

### Styling

- REQ-GLINK-5: Game name links are visually distinguishable from plain text (different color or weight), with no underline by default and underline on hover. The design system does not currently define a link color token; implementation should pick an existing token that provides sufficient contrast without competing with score colors. These are internal navigation links, not external ones (no new-tab icon, no `target="_blank"`).
- REQ-GLINK-6: Game name links do not change the visual weight or layout of the row they appear in. The name should look the same as it does today except for the color and hover underline.

### External links

- REQ-GLINK-7: The game detail page already shows a "BGG" external link when `bggId` is present (`app/games/[id]/page.tsx:115-124`). No additional external links are required.

### Edge cases

- REQ-GLINK-8: If `opponentGameId` in a tournament comparison refers to a game that has been deleted from the collection, the link still points to `/games/{opponentGameId}`. The game detail page handles missing games with its own error state. The link does not need to pre-validate whether the game exists.

## Exit Points

| Exit             | Triggers When                  | Target                         |
| ---------------- | ------------------------------ | ------------------------------ |
| Game detail page | User clicks any game name link | `/games/{id}` (existing route) |

## Success Criteria

- [ ] Profile divergence game names are clickable links to the correct game detail page.
- [ ] Profile outlier game names are clickable links to the correct game detail page.
- [ ] Score breakdown reference game names are clickable links to the correct game detail page.
- [ ] Tournament recent comparison opponent names are clickable links to the correct game detail page.
- [ ] Link styling is visually consistent across all four surfaces.
- [ ] Tournament session cards are unchanged (game names are not links).
- [ ] Search result game names are unchanged (not links).
- [ ] Game detail page breadcrumb and hero title are unchanged (not links to self).

## AI Validation

**Defaults apply:**

- Unit tests with mocked dependencies
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom:**

- Visual inspection: screenshot each of the four modified components to confirm link styling is consistent and layout is undisturbed.

## Constraints

- Web-only. The CLI displays game names as text and is out of scope.
- No new daemon API endpoints. All data needed for links (game IDs) is already present in the component props.
- Uses Next.js `<Link>` component for internal navigation (client-side routing), not `<a>` tags.

## Context

- The MVP web UI design (`.lore/designs/mvp-web-ui.md`) established that clicking a game in the collection opens its detail view. This spec extends that intent to every surface.
- The collection profiling spec (`.lore/specs/collection-profiling.md`) introduced the divergence and outlier views where game names appear without links.
- Navigation has shifted since the MVP design: Profile Overview is now the home page, and the collection table is at `/collection`.
