---
title: "Visual Transition Plan"
date: 2026-04-05
status: executed
tags: [plan, web-ui, visual, css, design-tokens, typography]
modules: [web-ui]
related:
  - .lore/designs/visual-direction.md
  - .lore/designs/mvp-web-ui.md
  - .lore/plans/mvp.md
  - .lore/specs/mvp.md
---

# Plan: Visual Transition

## Goal

Transition the Shelf Judge web UI from its current inline-styled state to match the approved visual direction and HTML mockups. The functional behavior stays the same. Only the visual layer changes.

The current web UI (`packages/web/`) has all 5 screens working (collection, game detail, search/add, axes management, BGG import) but uses 195+ inline `style` objects with hardcoded hex values, system fonts, and a light grey sidebar. The target is the warm, paper-stock aesthetic defined in the visual direction doc and demonstrated in the HTML mockups at `.lore/art/mockup-*.html`.

**Key constraint**: All colors must be CSS custom properties. No hardcoded hex values in component code. This is foundational for future theming.

## Design Reference

**Visual direction**: `.lore/designs/visual-direction.md` (approved)
**Target mockups**:
- `.lore/art/mockup-collection-view.html` (collection table with stats strip, score dots, axis chips)
- `.lore/art/mockup-game-detail.html` (hero score, breakdown table, rating form, two-panel layout)
- `.lore/art/mockup-axes.html` (axis cards with weight bars, source tags, stats strips)
- `.lore/art/mockup-bgg-import.html` (progress bar, status banner, game log)

## Codebase Context

### Current State

The web package at `packages/web/` is a Next.js 16.2.2 app with React 19. No CSS framework installed (no Tailwind, no CSS modules, no styled-components). All styling is inline:

```tsx
// Typical pattern throughout the codebase
<nav style={{
  width: 200,
  padding: "20px 16px",
  borderRight: "1px solid #e0e0e0",
  backgroundColor: "#fafafa",
}}>
```

Current hardcoded colors include `#2563eb` (blue buttons), `#059669` (green actions), `#7c3aed` (purple overrides), `#dc2626` (red/delete), and various greys. None of these match the visual direction palette.

### Key Files

- `packages/web/app/layout.tsx` (58 lines, root layout with sidebar nav)
- `packages/web/app/page.tsx` (127 lines, collection view)
- `packages/web/app/games/[id]/page.tsx` (game detail with score breakdown)
- `packages/web/app/axes/page.tsx` (axes management)
- `packages/web/app/search/page.tsx` (game search/add)
- `packages/web/app/import/page.tsx` (BGG import with SSE progress)
- `packages/web/components/score-badge.tsx` (27 lines, hue-based score color)
- `packages/web/components/score-breakdown.tsx` (breakdown table)
- `packages/web/components/rating-form.tsx` (rating inputs)
- `packages/web/components/game-actions.tsx` (delete/refresh buttons)
- `packages/web/components/refresh-all-button.tsx` (batch refresh)
- `packages/web/lib/api.ts` (type definitions for daemon API)
- `packages/web/lib/daemon.ts` (Unix socket client)

### What Doesn't Change

- `packages/web/lib/daemon.ts` (transport layer, no visual concern)
- `packages/web/lib/api.ts` (type definitions)
- `packages/web/app/api/daemon/[...path]/route.ts` (proxy, no visual concern)
- `packages/web/next.config.ts` (except potentially adding font optimization)
- `packages/web/tsconfig.json`

---

## Implementation Steps

### Step 1: CSS Foundation (Variables, Font, Reset)

**Files**: `packages/web/app/globals.css` (new), `packages/web/app/layout.tsx` (modified)

Create `globals.css` as the single source of truth for the visual system. This file contains three sections:

**1a. CSS Custom Properties** in `:root`

Transcribe every token from the visual direction doc into custom properties. Group by function:

```css
:root {
  /* Base */
  --bg-base: #f4f1ec;
  --bg-surface: #fefcf9;
  --bg-elevated: #ffffff;
  --border: #ddd8d0;
  --border-strong: #c4bfb8;

  /* Text */
  --text-primary: #1a1714;
  --text-secondary: #6b6560;
  --text-muted: #9c9590;

  /* Score spectrum */
  --score-color: #b86c1a;
  --score-high: #2d7a4a;
  --score-mid: #8a6f20;
  --score-low: #b84040;

  /* Data source */
  --personal-accent: #1a1714;
  --bgg-accent: #2e5f8a;
  --bgg-bg: #edf3f9;
  --override-accent: #5c3d99;
  --override-bg: #f0ecfa;

  /* Actions */
  --action: #1c3d5e;
  --action-hover: #2a5580;
  --action-subtle: #e8eff6;
  --danger: #b84040;
  --danger-subtle: #fdf0f0;

  /* Navigation */
  --nav-bg: #1a1714;
  --nav-text: #e8e4dc;
  --nav-active: #b86c1a;

  /* Typography scale */
  --text-xs: 11px;
  --text-sm: 13px;
  --text-base: 15px;
  --text-lg: 18px;
  --text-xl: 24px;
  --score-hero: 52px;
}
```

**Note on `--score-hero`**: The visual direction doc defines this as 40px, but the game detail mockup uses 52px. The mockup is the implementation target. Set the token to 52px. If the visual direction doc is later updated, only the token value needs to change.

**1b. Inter font loading** via `next/font/google` in `layout.tsx`. Configure with `subsets: ["latin"]` and `display: "swap"`. Apply to `<body>`. The fallback stack matches the visual direction: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.

**1c. Base styles** in `globals.css`:

- Box-sizing reset (`*, *::before, *::after { box-sizing: border-box; }`)
- Body defaults: `background: var(--bg-base); color: var(--text-primary); font-size: var(--text-base); line-height: 1.5;`
- Tabular numerals utility class: `.tabular-nums { font-variant-numeric: tabular-nums; }`
- Uppercase label utility: `.label-caps { text-transform: uppercase; letter-spacing: 0.06em; }`

**1d. Import `globals.css`** in `layout.tsx`. Next.js App Router supports global CSS imports from the root layout.

**Verification**: App renders with warm off-white background, Inter font loads, all text uses the new base color. Existing inline styles will still override (that's fine, they get replaced in later steps).

### Step 2: Layout Shell (Sidebar + Content Area)

**Files**: `packages/web/app/layout.tsx`, `packages/web/app/globals.css` (additions)

Replace the inline-styled sidebar with the dark nav panel from the mockups. This is the biggest structural change in `layout.tsx`.

**Sidebar** (matching mockup-collection-view.html):
- 200px fixed width, `background: var(--nav-bg)`, full viewport height
- Brand section: "Shelf Judge" with the bar-chart SVG icon, "Board Game Collection" subtitle
- Nav items grouped under "Library" (Collection, Axes) and "Add" (Add Game, Import BGG) section labels
- SVG icons for each nav item (extracted from the mockups)
- Active state: amber left border `border-left: 3px solid var(--nav-active)`, amber-tinted background `rgba(184,108,26,0.12)`, white text
- Inactive state: muted text `rgba(232,228,220,0.65)`, transparent left border
- Hover state: `background: rgba(255,255,255,0.06)`, text brightens to `var(--nav-text)`
- Active state detection: compare `pathname` from `usePathname()` against each link's `href`
- Footer: "Last synced: ..." text (or static placeholder, the daemon API does not currently expose a sync timestamp)

**Content area**:
- `flex: 1`, vertical flex column
- Overflow-y auto for scrolling

**Note on client vs server**: The sidebar needs `usePathname()` for active link styling. Extract the sidebar into a `components/sidebar.tsx` client component. The root layout stays a server component that renders the sidebar component.

**CSS additions** in `globals.css`: Sidebar, nav-item, nav-label, brand classes. Keep these in globals since the sidebar is a single shared layout element, not a reusable component.

**Verification**: Dark sidebar renders with correct colors, active page is highlighted, navigation works between all 5 pages.

### Step 3: Shared UI Components (Buttons, Badges, Score Display)

**Files**: `packages/web/app/globals.css` (additions), `packages/web/components/score-badge.tsx` (rewrite)

Add reusable CSS classes for elements that appear across multiple screens:

**3a. Button classes** (from visual direction, Component Language > Buttons):
- `.btn` base: `inline-flex, align-items center, gap 6px, padding 7px 14px, border-radius 5px, font-size 13px, font-weight 500`
- `.btn-primary`: `background: var(--action); color: white`
- `.btn-secondary`: `border: 1px solid var(--border-strong); color: var(--text-secondary); background: transparent`
- `.btn-danger`: `background: var(--danger); color: white` (for primary destructive actions)
- `.btn-danger-outline`: `border: 1px solid #e0c0c0; color: var(--danger); background: transparent` (for inline destructive actions like "Remove" on the game detail page and "Delete" on axis cards)
- `.btn-ghost`: `no border, color: var(--action)`
- `.btn-sm`: `padding 5px 10px, font-size 12px`

All button variants inherit the `.btn` base styles. Usage: `className="btn btn-primary"`, `className="btn btn-danger-outline btn-sm"`, etc.

**3b. Source badges**:
- `.source-badge` base: `font-size 9px, font-weight 700, padding 2px 5px, border-radius 3px, uppercase, letter-spacing 0.04em`
- `.source-personal`: text `var(--text-secondary)`, bg `var(--border)`
- `.source-bgg`: text `var(--bgg-accent)`, bg `#d4e7f5`
- `.source-override`: text `var(--override-accent)`, bg `#e0d6f5`

**3c. Score badge rewrite** (`score-badge.tsx`):
Replace the current hue-based color calculation with the visual direction's score spectrum. The component should:
- Display score with `font-weight: 700; color: var(--score-color); font-variant-numeric: tabular-nums`
- Include a score dot (8px circle) colored by range: `var(--score-high)` for 7.5-10.0, `var(--score-mid)` for 5.0-7.4, `var(--score-low)` for 1.0-4.9
- Show "not rated" in muted italic for games without a score

**3d. Refresh-all button** (`refresh-all-button.tsx`): Apply `.btn .btn-secondary` classes, replace inline styles with token-based colors. Result message styling should use `var(--text-muted)` for success and `var(--danger)` for errors.

**3e. Topbar pattern**: A recurring element across screens. `.topbar` class: `height: 56px, background: var(--bg-surface), border-bottom: 1px solid var(--border), flex display, align center, padding 0 32px`.

**Verification**: Buttons render in all three tiers. Score badge shows correct spectrum colors. Source badges display correctly.

### Step 4: Collection View

**Files**: `packages/web/app/page.tsx`, `packages/web/app/globals.css` (additions)

Restyle the collection view to match `mockup-collection-view.html`. This is the most complex screen.

**4a. Topbar**: Title "My Collection", game/axis count, "Import BGG" secondary button, "Add Game" primary button.

**4b. Stats strip**: Horizontal row below topbar showing Games count, Avg Fitness (score-colored), Rated count, Axes count. Each stat block has a large number and an uppercase label. Separated by vertical borders.

**4c. Table structure**: The mockup uses a hybrid approach. The header and each game row use CSS Grid for column alignment: `display: grid; grid-template-columns: 36px 58px 1fr 180px 110px 100px`. The header row is sticky (`position: sticky; top: 0; z-index: 10`). Uppercase labels, `font-size: 11px`, `background: #ede9e3; border-bottom: 1px solid var(--border-strong)`. Each game row is a clickable `<div>` (or `<a>`) with the same grid template, not a `<table>` element. This keeps the layout simple and avoids table-cell alignment issues with the complex cell contents.

**4d. Game rows**: Each row uses the same grid template as the header. Contents:
- Rank number (tabular-nums, muted)
- 40x40 thumbnail (rounded, with placeholder gradient if no image)
- Game info: name (14px, 600 weight), meta line (year, player count, BGG badge)
- Axis chips: compact tags with border, showing rated axes with "+N" overflow
- Last rated date (muted, right-aligned)
- Score cell: score dot + score value (right-aligned, 16px, 700 weight, score-color)

**4e. Unrated section**: Separator row "Not yet rated, N games" in muted uppercase, followed by game rows at reduced opacity with "not rated" text instead of score.

**4f. Row hover**: `background: #f0ede8` on hover. Cursor pointer (rows are clickable).

**4g. Empty state**: When the collection has zero games, show a centered empty state: heading "No games yet" in `var(--text-secondary)`, description text in `var(--text-muted)`, and "Add Game" / "Import from BGG" CTAs. The mockup includes `.empty-state` styles for this. If the current page already handles the zero-game case, restyle it. If not, add the conditional.

**Verification**: Compare rendered page against `mockup-collection-view.html` opened in a browser. Stats strip numbers are correct. Score dots show correct spectrum colors. Grid alignment is clean with tabular numerals. Empty state renders when collection is empty.

### Step 5: Game Detail View

**Files**: `packages/web/app/games/[id]/page.tsx`, `packages/web/components/score-breakdown.tsx`, `packages/web/components/rating-form.tsx`, `packages/web/components/game-actions.tsx`

Restyle to match `mockup-game-detail.html`. This screen has the most visual complexity.

**5a. Topbar**: Breadcrumb navigation ("Collection > Wingspan"), right-aligned action buttons (Refresh BGG secondary, Remove danger).

**5b. Game hero section**: Full-width panel below topbar with:
- Game cover image (100x100 rounded, with placeholder)
- Game info: title (26px, 700 weight), meta row (year, players, play time, BGG weight, BGG link badge)
- BGG data freshness line
- Score display (right-aligned): "Fitness Score" label, huge score number (`font-size: var(--score-hero)`, 700 weight, score-color), "out of 10.0", "N axes rated"

**5c. Two-panel layout**: `grid-template-columns: 1fr 380px`.
- Left panel: Score breakdown table + calculation explanation
- Right panel: Rating form (bg-surface background)

**5d. Score breakdown table** (`score-breakdown.tsx` rewrite):
- Table headers: Axis, Rating, Weight, Contribution, Source
- Contribution column includes a thin bar visualization (60px track with fill) plus percentage
- BGG rows get `background: var(--bgg-bg)`
- Override rows get `background: var(--override-bg)`
- Total row: bold, bordered top/bottom with `var(--border-strong)`, score in `var(--score-color)`
- Source column: badge chips (Personal grey, BGG blue, Override purple)

**5e. Rating form** (`rating-form.tsx` rewrite):
- Personal axes section with slider + number input per axis
- Each field shows: axis name, weight, optional description
- Slider accent color: `var(--score-color)`
- Number input: centered, bold, `var(--score-color)` text
- BGG-derived axes section (separated by divider):
  - Auto-populated display with BGG-bg background, "Override >" link
  - Override state: purple tint, revert link, editable slider
- Save/Cancel buttons at bottom

**5f. Game actions** (`game-actions.tsx`):
- Apply button classes (`.btn-secondary` for refresh, `.btn-danger` for remove)

**Verification**: Score breakdown math is visible and correct. Contribution bars are proportional. BGG/personal/override rows are visually distinct. Rating form inputs are functional.

### Step 6: Axes Management View

**Files**: `packages/web/app/axes/page.tsx`

Restyle to match `mockup-axes.html`.

**6a. Topbar**: Title "Rating Axes", "+ New Axis" primary button.

**6b. Weight summary bar**: Card showing total weight with a filled bar and numeric total. `background: var(--bg-surface), border: 1px solid var(--border), border-radius: 6px`.

**6c. Section labels**: "Personal axes, N" and "BGG-derived axes, N" with uppercase styling and bottom border.

**6d. Axis cards**: Each axis as a card with:
- Main row (grid): axis name + description, source tag (Personal grey or BGG blue), weight display (large number + percentage), weight bar (80px track), action buttons (Edit, Delete)
- Stats strip below: rated count, avg rating, created date. BGG axes show auto-populated/overridden counts with `background: var(--bgg-bg)`.

**6e. Create form** (if visible): Dashed border card (`border: 2px dashed var(--border-strong)`) with form fields for name, description, weight, source type. Form inputs use the shared input pattern: `border: 1px solid var(--border-strong); border-radius: 4px; padding: 8px 12px; font-size: 13px; background: var(--bg-elevated)`. Focus state: `outline: 2px solid var(--action)`.

**6f. Edit state**: When a user clicks "Edit" on an axis card, the current implementation likely shows inline form fields or a modal. Whatever the current mechanism, apply the same form input styling from 6e. The edit state doesn't need a structural change, just the visual treatment.

**6g. Delete confirmation**: Must show live count of affected games (this is functional behavior that should already exist from Phase 5, just needs visual treatment).

**Verification**: Weight bars are proportional. Source tags are correctly colored. Stats strips show real data.

### Step 7: BGG Import View

**Files**: `packages/web/app/import/page.tsx`

Restyle to match `mockup-bgg-import.html`.

**7a. Import header**: Title "Importing Collection", description with username.

**7b. Status banner**: Rounded card with pulsing icon (CSS animation), headline, sub-text showing current game being fetched, count display (large "12 / 47" with "games" label).

**7c. Progress bar**: 8px track with `var(--bgg-accent)` fill, label and fraction text above.

**7d. Game log**: List of imported games with status indicators:
- Green circle + checkmark for added
- Grey circle for skipped ("already in collection")
- Red circle for errors
- Animated loading state for current game

**7e. Completion summary**: When the import finishes, show a summary card with a 3-column grid of Added (green), Skipped (grey), and Errors (red) counts. The mockup defines `.summary-block` and `.summary-stats` for this. Each stat cell has a large number and an uppercase label, separated by 1px borders, with colored numbers matching the status.

**7f. Username input form** (pre-import state): Simple form with text input and submit button, using the shared form input styling from the axes mockup (`.form-input`, `.form-label` patterns).

**Verification**: Progress bar animates during import. Status indicators use correct colors. Error states are visible. Completion summary shows correct counts.

### Step 8: Search/Add Game View

**Files**: `packages/web/app/search/page.tsx`

This screen doesn't have a dedicated mockup. Reference the form element styling from `mockup-axes.html` (`.form-input`, `.form-label`, `.form-group` patterns) for the search input and manual add form. Otherwise, match the overall visual system.

**8a. Topbar**: Title "Add Game", breadcrumb or back link.

**8b. Search input**: Styled form input matching the mockup input patterns (border: `var(--border-strong)`, border-radius 4px, focus outline: `var(--action)`).

**8c. Results list**: Game rows with thumbnail, name, year. "Add" button per row using `.btn-primary`.

**8d. Manual add form**: Card with dashed border for manual entry.

**8e. Duplicate error**: Use danger-subtle background with danger text for 409 responses.

**Verification**: Search results render cleanly. Add button states are correct.

### Step 9: Icon and Favicon Integration

**Files**: `packages/web/app/layout.tsx` (metadata), `packages/web/app/favicon.ico` or `packages/web/app/icon.png`

**9a. Check for generated icon files** at `.lore/art/favicon-32.png`, `.lore/art/favicon-16.png`, `.lore/art/icon.webp`. If they exist, copy them into the web app's public directory.

**9b. Configure favicon** in the root layout's metadata export or via the App Router's `icon.tsx` convention.

**9c. Set page title** to "Shelf Judge" with per-page suffixes via the `metadata` export pattern.

**Verification**: Favicon appears in browser tab. Page titles are correct.

### Step 10: Inline Style Cleanup Sweep

**Files**: All files in `packages/web/app/` and `packages/web/components/`

After Steps 1-9, do a final sweep to catch any remaining inline styles that weren't addressed during the per-screen work. Search for `style={{` across the web package. Every instance should either:
- Be replaced with a CSS class from `globals.css`
- Be replaced with a CSS custom property reference
- Be justified with a comment if truly dynamic (e.g., a percentage width calculated from data)

The only acceptable inline styles after this step are genuinely dynamic values (contribution bar widths, progress bar percentages) that depend on runtime data.

**Verification**: `grep -r "style={{" packages/web/` returns only dynamic-value cases. No hardcoded hex colors remain in `.tsx` files (except in the SVG icon markup, which is acceptable).

### Step 11: Visual Validation

Launch a fresh-context sub-agent that:

1. Opens each of the 4 HTML mockups in context
2. Reads each corresponding page/component file
3. Compares the CSS class usage against the visual direction tokens
4. Flags any hardcoded colors, missing tokens, or structural deviations from the mockups
5. Verifies that `globals.css` contains every token from the visual direction doc
6. Checks that `font-variant-numeric: tabular-nums` is applied to all numerical displays

This step catches drift between the mockups and the implementation.

---

## Ordering and Parallelism

Steps 1-3 are sequential (foundation before components).

Steps 4-8 depend on Steps 1-3 but are independent of each other. They can be done in a single pass or parallelized across sub-agents if the file count justifies it. In practice, a single implementer working through them sequentially is fine because each screen shares patterns established in Steps 1-3, and later screens benefit from patterns refined in earlier ones.

Step 9 (icon) is independent of all other steps and can be done at any point.

Step 10 (cleanup) must follow Steps 4-8.

Step 11 (validation) must be last.

**Recommended commission sequence:**

1. **Commission 1** (Dalton): Steps 1-3 (foundation). Small scope, high leverage. Everything else depends on this.
2. **Commission 2** (Dalton): Steps 4-8 (all screens). The bulk of the work. Steps 1-3 provide the vocabulary; this commission applies it. Can be split into parallel sub-agents per screen if context pressure is a concern, but the total file count (10-12 files) is manageable in one pass.
3. **Commission 3** (Dalton): Steps 9-10 (icon + cleanup sweep).
4. **Commission 4** (Thorne): Step 11 (visual validation review).

## Delegation Guide

- **Steps 1-3, 4-8, 9-10**: Implementation (Dalton). Standard frontend work. No specialized expertise beyond CSS and React.
- **Step 11**: Review (Thorne). Fresh-context visual validation. The reviewer reads the visual direction doc and mockups, then audits the implementation.

## Open Questions

1. **Inter font hosting**: Next.js `next/font/google` handles font optimization automatically. If the deployment environment has no internet access, Inter would need to be self-hosted. Assume `next/font/google` is fine for now; this can be changed later without touching any component code.

2. **Icon file availability**: The visual direction doc specifies icon files at `.lore/art/icon.webp`, `.lore/art/favicon-32.png`, `.lore/art/favicon-16.png`. If these don't exist when Step 9 runs, skip favicon integration and note it as a follow-up. The icon was part of Sienna's commission scope, so it may or may not be generated yet.

3. **CSS organization**: All styles live in a single `globals.css` for MVP. If the file grows past 500 lines, consider splitting into `globals.css` (variables + reset) and `components.css` (component classes). This is a judgment call for the implementer, not a blocker.
