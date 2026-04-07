---
title: "Responsive Web Plan"
date: 2026-04-06
status: executed
tags: [plan, web-ui, responsive, css, mobile, tablet]
modules: [web-ui]
related:
  - .lore/designs/visual-direction.md
  - .lore/plans/visual-transition.md
---

# Plan: Responsive Web UI

## Goal

Make the Shelf Judge web UI usable on phone and tablet displays in addition to the existing desktop layout. The existing desktop experience stays the same. No functional changes, only layout adaptation.

## Current State

The web UI was built desktop-first. Every layout uses fixed pixel widths and multi-column grids that assume a viewport wider than ~900px. There are zero `@media` queries in `globals.css` (1787 lines). No responsive patterns exist anywhere in the codebase.

### What breaks at small viewports

**Phone (~375px):**

1. **Sidebar** (`globals.css:92`): Fixed 200px width. On a 375px screen, the sidebar consumes 53% of the viewport, leaving 175px for content. The collection table, game hero, and all forms are unusable.
2. **Collection table** (`globals.css:367-393`): 6-column grid `36px 58px 1fr 180px 110px 100px` totals ~584px minimum. Columns overflow or collapse to unreadable widths.
3. **Game hero** (`globals.css:663-669`): Horizontal flex with 100px cover + info + 160px score section. Cannot fit in 375px minus any sidebar.
4. **Detail panels** (`globals.css:768-783`): `grid-template-columns: 1fr 380px`. The right panel alone exceeds a phone viewport.
5. **Axis cards** (`globals.css:1119-1125`): 6-column grid `1fr auto auto auto auto auto` with 16px gaps. Weight display, bar, and buttons overflow on narrow screens.
6. **Topbar** (`globals.css:212-222`): 32px horizontal padding + title + meta + multiple buttons won't fit. The collection topbar is especially crowded with count text, two link buttons, and the refresh-all button.
7. **Form rows** (`globals.css:1240-1245`): `grid-template-columns: 1fr 1fr` creates very narrow inputs at small widths.

**Tablet (~768px):**

1. **Collection table**: The 6-column grid fits at 768px (sidebar hidden or collapsed), but the "Axes Rated" column (180px) is wasted space on a smaller screen.
2. **Detail panels**: 1fr + 380px leaves roughly 388px for the breakdown table, which is tight but usable. At exactly 768px with a sidebar, it doesn't fit.
3. **Axis cards**: Workable but the grid starts looking cramped, especially in edit mode.
4. **Topbar buttons**: The collection topbar's button group wraps awkwardly.

### What already works

- **Buttons** (`.btn`): Sized with padding, no fixed widths. Work at any viewport.
- **Import page**: Content area is `max-width: 680px` with padding. Naturally responsive once sidebar is handled.
- **Search page**: Same pattern, `max-width: 680px`. Just needs sidebar resolution.
- **Score breakdown table**: HTML `<table>` with percentage-based contribution bars. Will need horizontal scroll or column hiding on phone, but the structure is sound.
- **Rating form**: Vertical flex layout. Already single-column. Works fine at any width.
- **Progress bar, status banner, summary stats**: Flex-based layouts that tolerate narrow widths.

### Effort estimate by screen

| Screen                 | Phone work | Tablet work | Notes                                                                           |
| ---------------------- | ---------- | ----------- | ------------------------------------------------------------------------------- |
| Layout shell (sidebar) | Heavy      | Medium      | Sidebar must collapse to hamburger on phone, off-canvas drawer on tablet        |
| Collection (home)      | Heavy      | Medium      | Table needs complete redesign for phone (card layout), column hiding for tablet |
| Game detail            | Medium     | Light       | Hero stacks vertically, panels stack vertically. Mostly reflow.                 |
| Axes management        | Medium     | Light       | Card grid reflows. Edit state needs attention.                                  |
| Search/Add             | Light      | None        | Already narrow. Just needs sidebar fix.                                         |
| Import                 | Light      | None        | Already narrow. Just needs sidebar fix.                                         |

---

## Breakpoint Strategy

Three breakpoints, applied via `@media` queries in `globals.css`:

| Name    | Query              | Viewport       | Sidebar behavior                                                             |
| ------- | ------------------ | -------------- | ---------------------------------------------------------------------------- |
| Phone   | `max-width: 599px` | ~375px target  | Hidden by default. Hamburger icon in topbar opens a full-screen overlay nav. |
| Tablet  | `600px` to `899px` | ~768px target  | Collapsed to icon-only rail (56px) or hidden with toggle.                    |
| Desktop | `900px+` (default) | Current layout | 200px sidebar, no changes.                                                   |

**Why these breakpoints:**

- 600px is the natural break where the 6-column collection grid stops fitting, even without a sidebar.
- 900px is where the sidebar (200px) plus the detail panel grid (1fr + 380px) first becomes comfortable.
- The CSS is written mobile-first in the media query blocks, but the existing desktop styles remain as the base to minimize churn. Media queries override downward.

**Implementation note:** Use `max-width` queries against the existing desktop-first CSS rather than rewriting everything mobile-first. The entire CSS file (1787 lines) targets desktop. Rewriting it mobile-first would be a full rewrite for no functional gain. Instead, add `@media` blocks at the end of `globals.css` (or at the end of each section) that override specific properties for smaller viewports.

Add CSS custom properties for responsive spacing:

```css
:root {
  --content-padding: 32px;
  --topbar-padding: 0 32px;
}

@media (max-width: 599px) {
  :root {
    --content-padding: 16px;
    --topbar-padding: 0 16px;
  }
}

@media (max-width: 899px) and (min-width: 600px) {
  :root {
    --content-padding: 24px;
    --topbar-padding: 0 24px;
  }
}
```

Then update `.topbar`, `.game-hero`, `.axes-content`, `.search-content`, `.import-content`, etc. to use `var(--content-padding)` instead of hardcoded `32px`. This is a one-time migration that makes all future responsive work simpler.

---

## Implementation Steps

### Step 1: Responsive Spacing Tokens and Viewport Meta

**Files:** `packages/web/app/globals.css`, `packages/web/app/layout.tsx`

**1a.** Verify the viewport meta tag exists. Next.js 16 adds `<meta name="viewport" content="width=device-width, initial-scale=1">` by default, but confirm it's not being overridden.

**1b.** Add responsive spacing custom properties to `:root` and media query overrides as shown above.

**1c.** Replace all hardcoded padding values that should scale with viewport:

- `.topbar` padding: `0 32px` becomes `var(--topbar-padding)` (line 219)
- `.game-hero` padding: `28px 32px` becomes `28px var(--content-padding)` (line 667)
- `.axes-content` padding: `32px` becomes `var(--content-padding)` (line 1051)
- `.search-content` padding: `32px` becomes `var(--content-padding)` (line 1577)
- `.import-content` padding: `40px 32px` becomes `40px var(--content-padding)` (line 1291)
- `.panel-left` padding: `28px 32px` becomes `28px var(--content-padding)` (line 776)
- `.empty-state` padding: `80px 32px` becomes `80px var(--content-padding)` (line 584)

**Verification:** Desktop layout unchanged. Padding narrows on smaller viewports.

### Step 2: Sidebar Responsive Behavior

**Files:** `packages/web/components/sidebar.tsx`, `packages/web/app/layout.tsx`, `packages/web/app/globals.css`

This is the highest-leverage change. Once the sidebar collapses, every content area gets the full viewport width.

**2a. Mobile sidebar (phone, `max-width: 599px`):**

The sidebar becomes a full-screen overlay triggered by a hamburger button in the topbar. Implementation:

- Add a `SidebarToggle` client component (or expand the existing `Sidebar` component) that manages open/closed state.
- In `layout.tsx`, wrap the sidebar in a container that responds to the toggle state.
- CSS: At `max-width: 599px`, the sidebar gets `position: fixed; inset: 0; z-index: 100; transform: translateX(-100%); transition: transform 0.2s ease`. When open class is applied: `transform: translateX(0)`. A backdrop overlay (`position: fixed; inset: 0; background: rgba(0,0,0,0.5)`) covers the content area.
- Add a hamburger icon (three horizontal lines SVG) to the topbar, visible only at `max-width: 599px`.
- The `.app-shell` drops to `flex-direction: column` (topbar-then-content) since the sidebar isn't in the normal flow.

**2b. Tablet sidebar (600px-899px):**

Two viable approaches:

1. **Same as phone** (hidden by default, toggle to open). Simpler to implement.
2. **Icon-only rail** (56px wide, showing only the nav icons without labels). More polished but requires careful icon sizing.

**Decision:** Use the same hidden-with-toggle approach for both phone and tablet. The app has only 4 nav items. An icon rail for 4 items is more confusing than helpful since the icons aren't universally recognizable. A single `max-width: 899px` media query handles both phone and tablet sidebar behavior, reducing CSS complexity.

**2c. Topbar modification for mobile:**

On screens where the sidebar is hidden, the topbar needs:

- A hamburger button (left side) to open the sidebar
- The brand name "Shelf Judge" (since it's no longer visible in the sidebar)

CSS: `.topbar-hamburger { display: none; }` at desktop. `@media (max-width: 899px) { .topbar-hamburger { display: flex; } }`

**Verification:** At 375px and 768px, sidebar is hidden. Hamburger opens overlay. Navigation works. Closing overlay (tap backdrop or select nav item) hides sidebar. Desktop layout unchanged.

### Step 3: Collection Table Responsive Layout

**Files:** `packages/web/app/page.tsx`, `packages/web/app/globals.css`

The collection table is the most complex responsive challenge.

**3a. Phone layout (max-width: 599px):**

The 6-column grid cannot work at 375px. Replace with a card-style layout per game:

```
[Rank] [Thumb] [Name + Meta]        [Score]
                [Axes chips]
```

CSS approach: At `max-width: 599px`, change `.game-row` and `.collection-header` grid to a 2-row layout. Hide the "Axes Rated" and "Last Rated" columns entirely (they're secondary information). The remaining layout is:

```css
@media (max-width: 599px) {
  .collection-header {
    display: none; /* Column headers aren't useful in card layout */
  }

  .game-row {
    grid-template-columns: 24px 40px 1fr auto;
    grid-template-rows: auto auto;
    gap: 4px 8px;
    padding: 10px var(--content-padding);
  }

  .rank {
    grid-row: 1 / 3;
    align-self: center;
  }
  .game-thumb-col {
    grid-row: 1 / 3;
    align-self: center;
  }
  .game-info {
    grid-column: 3;
    grid-row: 1;
  }
  .score-cell {
    grid-column: 4;
    grid-row: 1 / 3;
    align-self: center;
  }
  .axes-used {
    grid-column: 3;
    grid-row: 2;
  }
  .last-rated {
    display: none;
  }
}
```

**3b. Tablet layout (600px-899px):**

The full 6-column grid can work at 768px+ if we reduce the "Axes Rated" column. Change to:

```css
@media (min-width: 600px) and (max-width: 899px) {
  .collection-header,
  .game-row {
    grid-template-columns: 30px 50px 1fr 120px 80px;
  }
  .axes-used-col,
  .axes-used {
    display: none;
  }
}
```

This drops the "Axes Rated" column (least critical for scanning) and tightens the remaining columns.

**3c. Stats strip (phone):**

The 4-stat horizontal strip overflows at 375px. Wrap to 2x2 grid:

```css
@media (max-width: 599px) {
  .stats-strip {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .stat-block {
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
  .stat-block:nth-child(odd) {
    border-right: 1px solid var(--border);
  }
  .stat-block:nth-last-child(-n + 2) {
    border-bottom: none;
  }
}
```

**3d. Topbar (phone):**

The collection topbar has: title, game count text, "Import BGG" button, "Add Game" button, "Refresh All" button. This won't fit at 375px.

At `max-width: 599px`:

- Move the count text below the title (or hide it; it's duplicated in the stats strip)
- Stack the action buttons below the title row, or move them into a "..." overflow menu

Simplest approach: wrap `.topbar-meta` to a second line.

```css
@media (max-width: 599px) {
  .topbar {
    height: auto;
    flex-wrap: wrap;
    padding: 12px var(--content-padding);
    gap: 8px;
  }
  .topbar-meta {
    width: 100%;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
}
```

**Verification:** At 375px, game rows are readable with score visible. No horizontal overflow. Stats are in 2x2 grid. At 768px, table has 5 columns and is scannable.

### Step 4: Game Detail Responsive Layout

**Files:** `packages/web/app/games/[id]/page.tsx`, `packages/web/app/globals.css`

**4a. Game hero (phone):**

The hero section is horizontal flex: cover + info + score. At 375px, stack vertically:

```css
@media (max-width: 599px) {
  .game-hero {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
    padding: 20px var(--content-padding);
  }

  .game-hero-score-section {
    align-items: flex-start;
    flex-direction: row;
    gap: 12px;
    align-items: baseline;
  }

  .score-hero-number {
    font-size: 36px;
  }

  .game-cover {
    width: 72px;
    height: 72px;
  }
}
```

The score section moves below the game info. The cover image shrinks to 72px. The score number shrinks from 52px to 36px.

For a slightly more refined phone layout, put the cover and info side-by-side (they still fit at 375px since the cover is only 72px), and put the score below both:

```css
@media (max-width: 599px) {
  .game-hero {
    flex-wrap: wrap;
  }
  .game-hero-info {
    flex: 1;
    min-width: 200px;
  }
  .game-hero-score-section {
    width: 100%;
    flex-direction: row;
    align-items: baseline;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
}
```

**4b. Detail panels (phone and tablet):**

The two-panel grid (`1fr 380px`) must stack on phone and tablet:

```css
@media (max-width: 899px) {
  .detail-panels {
    grid-template-columns: 1fr;
  }
  .panel-left {
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
}
```

This stacks score breakdown above the rating form. Both get full width.

**4c. Score breakdown table (phone):**

The breakdown table has 5 columns: Axis, Rating, Weight, Contribution, Source. At 375px, the Contribution column (with its bar visualization) and Source column create overflow.

Options:

1. Make the table horizontally scrollable (`overflow-x: auto` on a wrapper div).
2. Hide the Contribution column on phone (the percentage is nice-to-have, not essential).

**Decision:** Hide the Contribution column on phone. The Source column stays because it's critical for understanding where data came from.

```css
@media (max-width: 599px) {
  .breakdown-table th:nth-child(4),
  .breakdown-table td:nth-child(4) {
    display: none;
  }
}
```

**4d. Breadcrumb topbar (phone):**

Long game names will overflow the breadcrumb. Add `overflow: hidden; text-overflow: ellipsis` to the breadcrumb `strong` element and ensure the topbar actions don't get pushed off-screen:

```css
@media (max-width: 599px) {
  .breadcrumb {
    flex: 1;
    min-width: 0;
  }
  .breadcrumb strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
```

**Verification:** Hero section readable at 375px. Score is prominent. Breakdown table doesn't overflow. Rating form is usable (it's already single-column). Panels stack on tablet.

### Step 5: Axes Management Responsive Layout

**Files:** `packages/web/app/globals.css`

**5a. Axis cards (phone):**

The axis card main row is a 6-column grid: `1fr auto auto auto auto auto`. At 375px, this needs to become a stacked layout:

```css
@media (max-width: 599px) {
  .axis-card-main {
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto auto;
    gap: 8px 12px;
  }

  /* Name + description spans full width */
  .axis-card-main > div:first-child {
    grid-column: 1 / -1;
  }

  /* Source tag and weight on same row */
  .weight-display {
    flex-direction: row;
    gap: 8px;
    align-items: baseline;
  }

  /* Weight bar full width */
  .weight-bar-track {
    grid-column: 1 / -1;
    width: 100%;
  }

  /* Actions full width */
  .axis-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
}
```

**5b. Axes content width:**

`.axes-content` has `max-width: 780px`. On phone, this is fine (the viewport is smaller). No change needed.

**5c. Create form (phone):**

The form row uses `grid-template-columns: 1fr 1fr`. Stack to single column:

```css
@media (max-width: 599px) {
  .form-row {
    grid-template-columns: 1fr;
  }
}
```

**5d. Edit fields in axis cards:**

When editing, the inline inputs appear inside the card grid. The phone layout from 5a handles this since the first grid child (containing edit fields) spans full width.

**Verification:** Axis cards are readable at 375px. Weight bars span full card width. Edit/create forms have usable input sizes.

### Step 6: Search and Import Pages (Minor Adjustments)

**Files:** `packages/web/app/globals.css`

Both pages already use `max-width: 680px` with padding. Once the sidebar collapses (Step 2), these pages are nearly phone-ready.

**6a. Search input row:** The search input has `max-width: 400px`. At 375px with 16px padding on each side, that leaves 343px. The input is `flex: 1` within a `max-width: 400px` constraint, so it naturally shrinks. No change needed.

**6b. Manual add form:** Uses `.form-row` with `1fr 1fr` grid. Already handled by the form-row override in Step 5c.

**6c. Import status banner:** The `.status-banner` is a horizontal flex with icon (44px), text (flex:1), and count display. At 375px:

```css
@media (max-width: 599px) {
  .status-banner {
    flex-wrap: wrap;
    gap: 12px;
  }
  .status-count {
    width: 100%;
    text-align: left;
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .count-value {
    font-size: 22px;
  }
}
```

**6d. Import summary stats:** The 3-column grid `.summary-stats` works at 375px (three cells each get ~105px), but might benefit from stacking:

```css
@media (max-width: 599px) {
  .summary-stats {
    grid-template-columns: 1fr;
  }
}
```

**Verification:** Both pages are usable at 375px. Forms are single-column. Progress bar renders correctly.

### Step 7: Touch Target and Interaction Polish

**Files:** `packages/web/app/globals.css`

Mobile users tap instead of click. Ensure touch targets meet the 44px minimum recommended by Apple and Google.

**7a. Nav items:** Currently 9px vertical padding + 13px font = ~31px height. Increase to `padding: 12px 20px` on phone for a ~37px height. Combined with the 10px gap between icon and text, the touch target area is adequate.

**7b. Game rows:** Currently 10px vertical padding. The row contains a 40px thumbnail, so the total height is at least 60px. Adequate.

**7c. Buttons:** `.btn` has `padding: 7px 14px`. The total height with 13px font and line-height is approximately 35px. Increase slightly on phone:

```css
@media (max-width: 599px) {
  .btn {
    padding: 10px 16px;
  }
  .btn-sm {
    padding: 8px 12px;
  }
}
```

**7d. Form inputs:** `.form-input` has `padding: 8px 12px` with 13px font. Total height ~35px. Increase:

```css
@media (max-width: 599px) {
  .form-input {
    padding: 10px 14px;
    font-size: 16px; /* Prevents iOS zoom on focus */
  }
}
```

The `font-size: 16px` on phone inputs is critical. iOS Safari auto-zooms the page when a user focuses an input with font-size below 16px. This is a common responsive bug.

**7e. Rating slider:** The slider track is 4px tall, which is hard to tap. The native range input has a larger hit area than its visual track, so this is acceptable. No change needed.

**Verification:** All interactive elements are comfortably tappable. No iOS zoom on input focus.

### Step 8: CSS Organization and Cleanup

**Files:** `packages/web/app/globals.css`

**8a. Add all responsive overrides at the end of `globals.css`**, grouped by breakpoint:

```css
/* ===== Responsive: Tablet (600px-899px) ===== */
@media (min-width: 600px) and (max-width: 899px) {
  /* Sidebar collapse, collection table adjustments, detail panel stack */
}

/* ===== Responsive: Phone (max-width: 599px) ===== */
@media (max-width: 599px) {
  /* All phone-specific overrides */
}
```

This keeps the responsive rules in two clearly marked sections rather than scattered throughout the file. It's easier to audit and modify.

**8b. Verify no horizontal overflow** by adding to the base styles:

```css
html {
  overflow-x: hidden;
}
```

This is a safety net, not a fix. If content overflows horizontally, the root cause should be fixed. But this prevents the "wobbly page" experience on phone where horizontal scroll appears intermittently.

**Verification:** `globals.css` has clean responsive sections. No horizontal scroll at any viewport width.

---

## Ordering and Dependencies

```
Step 1 (tokens)  ──→  Step 2 (sidebar)  ──→  Steps 3-6 (screens)  ──→  Step 7 (touch)  ──→  Step 8 (cleanup)
```

Step 1 must come first because responsive spacing tokens are used everywhere.
Step 2 must come second because every screen's usable width depends on sidebar behavior.
Steps 3-6 are independent of each other and can be done in any order.
Step 7 is a polish pass that depends on all layouts being in place.
Step 8 is a final cleanup.

## Recommended Commission Sequence

1. **Commission 1** (Dalton): Steps 1-2. Responsive tokens and sidebar collapse. This is the foundation. Once the sidebar hides on mobile, every page gets full viewport width and the remaining work is incremental layout adjustment.

2. **Commission 2** (Dalton): Steps 3-4. Collection table and game detail responsive layouts. These are the two hardest screens and benefit from being done together since they share patterns (topbar wrapping, grid column hiding).

3. **Commission 3** (Dalton): Steps 5-7. Axes, search, import responsive layouts plus touch target polish. These are lighter screens. Touch polish applies globally so it goes here.

4. **Commission 4** (Dalton): Step 8. CSS cleanup and horizontal overflow audit.

5. **Commission 5** (Thorne): Review. Fresh-context validation at 375px, 768px, and 1024px+ viewports. Check for overflow, truncation, touch target sizes, and visual consistency with the desktop design.

## What This Plan Does Not Cover

- **No new components.** This plan adds CSS media queries and modifies one component (`sidebar.tsx` for the toggle). No new pages, no new features.
- **No JavaScript-based responsive logic** beyond the sidebar toggle state. All layout adaptation is CSS-only.
- **No dark mode.** The visual direction doesn't define a dark theme. Responsive is viewport adaptation, not theme variation.
- **No landscape phone optimization.** Landscape at 667px width falls into the tablet breakpoint and gets the tablet layout, which is acceptable.
- **No print styles.** Out of scope.
