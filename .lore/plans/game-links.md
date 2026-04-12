---
title: "Implementation plan: game-links"
date: 2026-04-11
status: executed 
tags: [plan, web-ui, navigation, links]
modules: [web]
related:
  - .lore/specs/game-links.md
  - .lore/issues/game-links.md
  - .lore/designs/mvp-web-ui.md
---

# Plan: Game Links

## Spec Reference

**Spec**: `.lore/specs/game-links.md`

Requirements addressed:

- REQ-GLINK-1: Profile divergence game names link to `/games/{gameId}` → Step 1
- REQ-GLINK-2: Profile outliers game names link to `/games/{gameId}` → Step 2
- REQ-GLINK-3: Score breakdown reference game names link to `/games/{gameId}` → Step 3
- REQ-GLINK-4: Tournament recent comparison opponent names link to `/games/{opponentGameId}` → Step 4
- REQ-GLINK-5: Link styling (color, no underline default, underline on hover) → Step 5
- REQ-GLINK-6: Links don't change visual weight or layout → Step 5
- REQ-GLINK-7: No additional external links (already satisfied) → No action
- REQ-GLINK-8: Deleted-game links still point to `/games/{id}` (no pre-validation) → Step 4

## Codebase Context

### Current State

Four components render game names as plain text where they should be links:

1. **`components/profile/divergence.tsx:17`** renders `{game.gameName}` inside a `<div className="div-game-name">`. The `game` object is typed `DivergentGame`, which has `gameId: string`.

2. **`components/profile/outliers.tsx:43`** renders `{outlier.gameName}` inside a `<div className="outlier-name">`. The `outlier` object is typed `CollectionOutlier`, which has `gameId: string`.

3. **`components/score-breakdown.tsx:291`** renders `{ref.gameName}` inside a `<span className="ref-game-name">` within the `ConfidenceBreakdownPanel` function. The `ref` object is typed `ReferenceGame`, which has `gameId: string`. This component is `"use client"` (has `useState`), so the `Link` import works fine.

4. **`app/games/[id]/page.tsx:353`** renders `c.opponentGameName ?? c.opponentGameId.slice(0, 8)` inside a `<span className="tournament-opponent-id">`. The `c` object comes from `tournamentStats.recentComparisons`, and `c.opponentGameId` is always available.

### Existing Link Pattern

The collection table (`components/collection-table.tsx:543`) wraps entire rows in `<Link href={/games/${id}}>` from `next/link`. The game detail page (`app/games/[id]/page.tsx`) already imports `Link` from `next/link`.

### CSS Tokens

The app uses `--bgg-accent: #2e5f8a` as its primary interactive color. It appears on breadcrumb links, sort controls, filter chips, action buttons, and the BGG external link. No separate `--link-color` token exists. Using `--bgg-accent` for game name links keeps them visually consistent with other interactive elements without competing with score colors (`--fitness-green`, `--tourney-accent`, etc.).

The `.bgg-link` class on the game detail page already demonstrates the pattern: `color: var(--bgg-accent); text-decoration: none;` with underline on hover.

## Implementation Steps

### Step 1: Profile Divergence Links

**Files**: `packages/web/components/profile/divergence.tsx`
**Addresses**: REQ-GLINK-1

Add `import Link from "next/link"` at the top.

At line 17, replace:

```
<div className="div-game-name">{game.gameName}</div>
```

with:

```
<div className="div-game-name">
  <Link href={`/games/${game.gameId}`} className="game-link">{game.gameName}</Link>
</div>
```

The `game-link` class is defined in Step 5.

### Step 2: Profile Outliers Links

**Files**: `packages/web/components/profile/outliers.tsx`
**Addresses**: REQ-GLINK-2

Add `import Link from "next/link"` at the top.

At line 43, replace:

```
<div className="outlier-name">{outlier.gameName}</div>
```

with:

```
<div className="outlier-name">
  <Link href={`/games/${outlier.gameId}`} className="game-link">{outlier.gameName}</Link>
</div>
```

### Step 3: Score Breakdown Reference Game Links

**Files**: `packages/web/components/score-breakdown.tsx`
**Addresses**: REQ-GLINK-3

The file already has `"use client"` and imports from `react` and `@shelf-judge/shared`. Add `import Link from "next/link"`.

In the `ConfidenceBreakdownPanel` function at line 291, replace:

```
<span className="ref-game-name">{ref.gameName}</span>
```

with:

```
<Link href={`/games/${ref.gameId}`} className="game-link ref-game-name">{ref.gameName}</Link>
```

Keep the `ref-game-name` class so existing layout styles (if any) still apply. The `game-link` class adds the link color and hover behavior.

### Step 4: Tournament Recent Comparison Links

**Files**: `packages/web/app/games/[id]/page.tsx`
**Addresses**: REQ-GLINK-4, REQ-GLINK-8

The file already imports `Link` from `next/link`.

At line 353, replace:

```
<span className="tournament-opponent-id">
  vs {c.opponentGameName ?? c.opponentGameId.slice(0, 8)}
</span>
```

with:

```
<span className="tournament-opponent-id">
  vs <Link href={`/games/${c.opponentGameId}`} className="game-link">
    {c.opponentGameName ?? c.opponentGameId.slice(0, 8)}
  </Link>
</span>
```

Per REQ-GLINK-8, no pre-validation of whether the opponent game still exists. The link always points to `/games/{opponentGameId}`, and the game detail page handles missing games with its own error state.

### Step 5: Link Styling

**Files**: `packages/web/app/globals.css`
**Addresses**: REQ-GLINK-5, REQ-GLINK-6

Add a `.game-link` class:

```css
.game-link {
  color: var(--bgg-accent);
  text-decoration: none;
  font-weight: inherit;
  font-size: inherit;
}

.game-link:hover {
  text-decoration: underline;
}
```

`font-weight: inherit` and `font-size: inherit` ensure the link doesn't change the visual weight or layout of the row (REQ-GLINK-6). The `color` uses the app's established interactive color. The hover underline follows the same color and hover-underline pattern as `.bgg-link`, but without the badge styling (`.bgg-link` is a pill/chip with background, padding, and border-radius).

Place this near the other link styles in the CSS file (around line 796 where `.bgg-link` is defined).

### Step 6: Tests

**Files**: `packages/web/tests/game-links.test.tsx` (new)
**Addresses**: All REQs (validation)

Write unit tests for each of the four modified components:

1. **Divergence**: Render `<Divergence>` with a `DivergentGame[]` fixture. Assert each game name renders as a `<Link>` (or `<a>` in test output) with `href="/games/{gameId}"`.

2. **Outliers**: Render `<Outliers>` with a `CollectionOutlier[]` fixture. Assert each outlier name renders as a link with `href="/games/{gameId}"`.

3. **ScoreBreakdown**: Render `<ScoreBreakdown>` with a `FitnessResult` fixture that includes `referenceGames` on a predicted entry. Expand the confidence panel, then assert each reference game name renders as a link with `href="/games/{gameId}"`.

4. **Tournament recent comparisons**: This is embedded in the game detail server component. Test the link rendering by verifying that the `tournament-opponent-id` span contains a link to `/games/{opponentGameId}`.

For tests 1-3, the components are small enough to render directly. Test 4 is part of a server component; the simplest approach is to test the rendered HTML output. If server component testing proves difficult with the current test setup, extract the tournament comparisons markup into a client component that can be tested directly. The spec requires 90%+ coverage on new code, so skipping test 4 is a last resort, not an acceptable default.

### Step 7: Visual Validation

**Addresses**: REQ-GLINK-5, REQ-GLINK-6 (visual consistency)

After implementation, screenshot each of the four surfaces with the dev server running:

1. Profile page showing a game with divergence data
2. Profile page showing a game with outlier data
3. Game detail page with a predicted score showing the confidence panel expanded
4. Game detail page with tournament comparisons

Verify: link color is consistent across all four, hover underline works, layout is undisturbed.

### Step 8: Validate Against Spec

Launch a sub-agent that reads the spec at `.lore/specs/game-links.md`, reviews the implementation, and checks every requirement (REQ-GLINK-1 through REQ-GLINK-8) and every success criterion in the Success Criteria section. This includes the negative requirements: tournament session cards must remain unchanged (game names are not links), search result game names must remain unchanged, and game detail breadcrumb/hero title must remain unchanged. Flag any requirement or criterion not met.

## Delegation Guide

No specialized expertise required. All steps are straightforward frontend work (adding `<Link>` components and a CSS class). The implementer should be comfortable with Next.js `Link` and the existing component patterns.

Steps requiring review:

- **Step 5** (CSS): Verify `--bgg-accent` provides sufficient contrast against the backgrounds where game names appear (divergence rows, outlier rows, confidence panel, tournament breakdown). These all use white or near-white backgrounds, so `#2e5f8a` (dark blue) should be fine.
- **Step 8** (Validation): Use a fresh-context sub-agent for the spec compliance check.

## Open Questions

None. The spec is precise and all data needed for links is already present in component props.
