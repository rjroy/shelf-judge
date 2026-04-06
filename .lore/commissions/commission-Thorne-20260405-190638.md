---
title: "Commission: Visual Transition Review: Validation Against Mockups"
date: 2026-04-06
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Visual validation review (Step 11 of the visual transition plan at `.lore/plans/visual-transition.md`).\n\nRead these as your reference standard:\n- `.lore/designs/visual-direction.md` (every token defined here must exist in globals.css)\n- `.lore/art/mockup-collection-view.html`\n- `.lore/art/mockup-game-detail.html`\n- `.lore/art/mockup-axes.html`\n- `.lore/art/mockup-bgg-import.html`\n\nThen audit the implementation:\n\n1. Open `packages/web/app/globals.css` and verify every token from the visual direction doc is present in `:root`\n2. Read each page and component file, compare CSS class usage against the mockup structure\n3. Search for hardcoded hex colors in `.tsx` files (`grep -r \"#[0-9a-fA-F]\" packages/web/ --include=\"*.tsx\"`). Flag any that aren't in SVG icon markup.\n4. Search for remaining inline styles (`grep -r \"style={{\" packages/web/ --include=\"*.tsx\"`). Flag any that aren't genuinely dynamic values.\n5. Verify `font-variant-numeric: tabular-nums` is applied to all numerical displays (scores, weights, ratings, contribution percentages)\n6. Check that the score spectrum colors are correctly applied: `--score-high` for 7.5-10.0, `--score-mid` for 5.0-7.4, `--score-low` for 1.0-4.9\n7. Verify Inter font is loaded and configured\n8. Check sidebar: dark background, active state with amber border, correct navigation grouping\n9. Verify source badges use correct colors (personal grey, BGG blue, override purple)\n\nReport ALL findings. This is the quality gate for the visual transition."
dependencies:
  - commission-Dalton-20260405-190626
linked_artifacts:
  - packages/web/app/globals.css

  - packages/web/app/page.tsx
  - packages/web/app/import/page.tsx
  - packages/web/components/score-badge.tsx
  - packages/web/components/sidebar.tsx
  - packages/web/app/page.tsx
  - packages/web/app/import/page.tsx
  - packages/web/components/score-badge.tsx
  - packages/web/components/sidebar.tsx
activity_timeline:
  - timestamp: 2026-04-06T02:06:38.784Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T02:08:30.944Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-06T02:26:41.327Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-06T02:26:41.330Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-06T02:26:41.352Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-06T02:26:50.677Z
    event: progress_report
    reason: "Starting visual validation review. Reading reference documents first: visual direction spec, mockups, and the visual transition plan."
  - timestamp: 2026-04-06T02:27:28.617Z
    event: progress_report
    reason: "Read globals.css (1740 lines) and visual direction doc. Now auditing implementation files: searching for hardcoded hex colors, inline styles, and reading all page/component files."
  - timestamp: 2026-04-06T02:28:19.763Z
    event: progress_report
    reason: "All implementation files read. Now compiling findings: token completeness, hardcoded colors, inline styles, tabular-nums coverage, score spectrum, sidebar, source badges, Inter font."
  - timestamp: 2026-04-06T02:31:54.563Z
    event: result_submitted
    reason: "# Visual Validation Review — Shelf Judge Web UI\n\n## Summary\n\nThe visual transition is substantially complete. Token system, font loading, sidebar, buttons, badges, score spectrum, and all five screens have been transitioned from inline styles to CSS classes using design tokens. The implementation follows the visual direction doc and transition plan with high fidelity.\n\nTwo functional defects, one structural issue, and several observations.\n\n---\n\n## Findings (priority order)\n\n### 1. DEFECT — Collection page missing scroll wrapper\n\n**File:** `packages/web/app/page.tsx`\n**Impact:** Long collections are unscrollable.\n\nThe collection page does not wrap its content in a `.main-scroll` div. All four other pages do. The parent `.main-content` has `overflow: hidden` (globals.css:192), and `.main-scroll` provides `overflow-y: auto` (globals.css:197). Without the wrapper, the stats strip, table header, and game rows have no scroll container. A collection with more games than fit in the viewport is truncated.\n\n**Fix:** Wrap everything after the topbar in `<div className=\"main-scroll\">...</div>`.\n\n---\n\n### 2. DEFECT — Missing CSS class definitions for 7 classes used in .tsx files\n\n**File:** `packages/web/app/globals.css` (missing), `packages/web/app/page.tsx` (references)\n**Impact:** Elements render without intended styling.\n\nThese classes are referenced in component code but have no CSS definition:\n\n| Class | Used at | Purpose |\n|---|---|---|\n| `.no-ratings` | page.tsx:216 | \"No ratings yet\" text in unrated game rows |\n| `.game-thumb-col` | page.tsx:145, 194 | Thumbnail column wrapper |\n| `.game-info-col` | page.tsx:128 | Header label for Game column |\n| `.axes-used-col` | page.tsx:129 | Header label for Axes column |\n| `.last-rated-col` | page.tsx:130 | Header label for Last Rated column |\n| `.score-col` | page.tsx:131 | Header label for Score column |\n| `.empty-state-actions` | page.tsx:72 | CTA button group in empty state |\n\nThe column label classes (`.game-thumb-col` through `.score-col`) likely render fine because they're inside the `.collection-header` CSS grid, which positions children by order. But `.no-ratings` gets no styling (should probably match `.score-unrated` in treatment), and `.empty-state-actions` gets no flex/gap treatment for the button group.\n\n**Fix:** Add CSS definitions for these classes, or rename to existing equivalents where appropriate.\n\n---\n\n### 3. DEFECT — Collection page topbar uses bare `<h1>` instead of `.topbar-title`\n\n**File:** `packages/web/app/page.tsx:67, 88`\n**Impact:** Visual inconsistency between collection page and all other pages.\n\nThe collection page renders `<h1>My Collection</h1>` inside `.topbar`, while all other pages use `<div className=\"topbar-title\">`. There is no CSS rule for `.topbar h1`, so the h1 inherits browser defaults (typically 2em font size, bold) rather than the `.topbar-title` styling (16px, weight 600, `var(--text-primary)`). The title will appear oversized compared to other page titles.\n\n**Fix:** Change to `<div className=\"topbar-title\">My Collection</div>` or add a `.topbar h1` rule.\n\n---\n\n### 4. OBSERVATION — Import page game log not implemented (CSS classes orphaned)\n\n**File:** `packages/web/app/import/page.tsx`, `packages/web/app/globals.css:1374-1461`\n**Impact:** Feature gap vs. mockup.\n\nThe import page implements the status banner, progress bar, and completion summary but does not render the per-game log list shown in `mockup-bgg-import.html`. CSS classes for this are defined (`.game-log-list`, `.game-log-item`, `.log-status`, `.log-game-name`, `.log-game-year`, `.log-tag`) but unused. This may be blocked by the SSE data structure (`ImportProgress`) not providing per-game status detail. The reader should decide whether this is a visual transition gap or a functional feature not yet implemented.\n\n---\n\n### 5. OBSERVATION — Duplicated `scoreRangeClass` function\n\n**Files:** `packages/web/components/score-badge.tsx:3-7`, `packages/web/app/page.tsx:32-36`\n**Impact:** Maintenance risk; if score spectrum thresholds change, both must be updated.\n\nThe same function is defined identically in two files. Should be extracted to a shared utility (e.g., `packages/web/lib/score-utils.ts`).\n\n---\n\n### 6. OBSERVATION — 16 hardcoded hex values in globals.css outside :root\n\n**File:** `packages/web/app/globals.css` (lines 265, 307, 312, 359, 394, 430, 558, 630, 776, 809, 926, 946, 1167, 1411, 1416)\n**Impact:** Maintenance burden for future palette changes.\n\nValues like `#f0ede8` (row hover), `#ede9e3` (table headers), `#d4e7f5` (BGG badge bg), `#e0d6f5` (override badge bg) are used directly in CSS rather than as tokens. The transition plan constraint (\"No hardcoded hex values in component code\") applies to .tsx files, which is satisfied. However, a palette change would require hunting through globals.css for these derived tints. Consider tokenizing the most-used values (`--row-hover`, `--table-header-bg`, etc.) in a future pass.\n\n---\n\n### 7. OBSERVATION — `.weight-pct` missing tabular-nums\n\n**File:** `packages/web/app/globals.css:1109-1112`\n**Impact:** Minor alignment issue in axes management.\n\nThe `.weight-pct` class displays percentage values (e.g., \"45% of total\") but does not include `font-variant-numeric: tabular-nums`. When weight percentages change (e.g., from \"9%\" to \"45%\"), digits may shift slightly. All other numerical display classes include tabular-nums.\n\n---\n\n## Passing checks\n\n- **Token completeness:** All 21 design tokens from the visual direction present in `:root` with correct values.\n- **Hardcoded hex in .tsx:** Only in SVG icon markup (sidebar.tsx:74-76), which is acceptable.\n- **Inline styles:** All 5 instances are genuinely dynamic (runtime percentage widths).\n- **Score spectrum:** Correct ranges (7.5+ high, 5.0+ mid, below low) in both implementations.\n- **Inter font:** Correctly loaded via next/font/google with proper fallback stack.\n- **Sidebar:** Dark background, amber active state, correct nav grouping (Library/Add).\n- **Source badges:** Personal (grey), BGG (blue), Override (purple) all correct.\n- **Button tiers:** Primary, secondary, danger, danger-outline, ghost, sm all defined and used correctly.\n- **Two-panel layout:** Game detail uses `grid-template-columns: 1fr 380px` as specified.\n- **BGG/override row backgrounds:** Breakdown table correctly applies `var(--bgg-bg)` and `var(--override-bg)`."
  - timestamp: 2026-04-06T02:32:00.217Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All implementation files read. Now compiling findings: token completeness, hardcoded colors, inline styles, tabular-nums coverage, score spectrum, sidebar, source badges, Inter font."
projectName: shelf-judge
---
# Visual Validation Review — Shelf Judge Web UI

## Summary

The visual transition is substantially complete. Token system, font loading, sidebar, buttons, badges, score spectrum, and all five screens have been transitioned from inline styles to CSS classes using design tokens. The implementation follows the visual direction doc and transition plan with high fidelity.

Two functional defects, one structural issue, and several observations.

---

## Findings (priority order)

### 1. DEFECT — Collection page missing scroll wrapper

**File:** `packages/web/app/page.tsx`
**Impact:** Long collections are unscrollable.

The collection page does not wrap its content in a `.main-scroll` div. All four other pages do. The parent `.main-content` has `overflow: hidden` (globals.css:192), and `.main-scroll` provides `overflow-y: auto` (globals.css:197). Without the wrapper, the stats strip, table header, and game rows have no scroll container. A collection with more games than fit in the viewport is truncated.

**Fix:** Wrap everything after the topbar in `<div className="main-scroll">...</div>`.

---

### 2. DEFECT — Missing CSS class definitions for 7 classes used in .tsx files

**File:** `packages/web/app/globals.css` (missing), `packages/web/app/page.tsx` (references)
**Impact:** Elements render without intended styling.

These classes are referenced in component code but have no CSS definition:

| Class | Used at | Purpose |
|---|---|---|
| `.no-ratings` | page.tsx:216 | "No ratings yet" text in unrated game rows |
| `.game-thumb-col` | page.tsx:145, 194 | Thumbnail column wrapper |
| `.game-info-col` | page.tsx:128 | Header label for Game column |
| `.axes-used-col` | page.tsx:129 | Header label for Axes column |
| `.last-rated-col` | page.tsx:130 | Header label for Last Rated column |
| `.score-col` | page.tsx:131 | Header label for Score column |
| `.empty-state-actions` | page.tsx:72 | CTA button group in empty state |

The column label classes (`.game-thumb-col` through `.score-col`) likely render fine because they're inside the `.collection-header` CSS grid, which positions children by order. But `.no-ratings` gets no styling (should probably match `.score-unrated` in treatment), and `.empty-state-actions` gets no flex/gap treatment for the button group.

**Fix:** Add CSS definitions for these classes, or rename to existing equivalents where appropriate.

---

### 3. DEFECT — Collection page topbar uses bare `<h1>` instead of `.topbar-title`

**File:** `packages/web/app/page.tsx:67, 88`
**Impact:** Visual inconsistency between collection page and all other pages.

The collection page renders `<h1>My Collection</h1>` inside `.topbar`, while all other pages use `<div className="topbar-title">`. There is no CSS rule for `.topbar h1`, so the h1 inherits browser defaults (typically 2em font size, bold) rather than the `.topbar-title` styling (16px, weight 600, `var(--text-primary)`). The title will appear oversized compared to other page titles.

**Fix:** Change to `<div className="topbar-title">My Collection</div>` or add a `.topbar h1` rule.

---

### 4. OBSERVATION — Import page game log not implemented (CSS classes orphaned)

**File:** `packages/web/app/import/page.tsx`, `packages/web/app/globals.css:1374-1461`
**Impact:** Feature gap vs. mockup.

The import page implements the status banner, progress bar, and completion summary but does not render the per-game log list shown in `mockup-bgg-import.html`. CSS classes for this are defined (`.game-log-list`, `.game-log-item`, `.log-status`, `.log-game-name`, `.log-game-year`, `.log-tag`) but unused. This may be blocked by the SSE data structure (`ImportProgress`) not providing per-game status detail. The reader should decide whether this is a visual transition gap or a functional feature not yet implemented.

---

### 5. OBSERVATION — Duplicated `scoreRangeClass` function

**Files:** `packages/web/components/score-badge.tsx:3-7`, `packages/web/app/page.tsx:32-36`
**Impact:** Maintenance risk; if score spectrum thresholds change, both must be updated.

The same function is defined identically in two files. Should be extracted to a shared utility (e.g., `packages/web/lib/score-utils.ts`).

---

### 6. OBSERVATION — 16 hardcoded hex values in globals.css outside :root

**File:** `packages/web/app/globals.css` (lines 265, 307, 312, 359, 394, 430, 558, 630, 776, 809, 926, 946, 1167, 1411, 1416)
**Impact:** Maintenance burden for future palette changes.

Values like `#f0ede8` (row hover), `#ede9e3` (table headers), `#d4e7f5` (BGG badge bg), `#e0d6f5` (override badge bg) are used directly in CSS rather than as tokens. The transition plan constraint ("No hardcoded hex values in component code") applies to .tsx files, which is satisfied. However, a palette change would require hunting through globals.css for these derived tints. Consider tokenizing the most-used values (`--row-hover`, `--table-header-bg`, etc.) in a future pass.

---

### 7. OBSERVATION — `.weight-pct` missing tabular-nums

**File:** `packages/web/app/globals.css:1109-1112`
**Impact:** Minor alignment issue in axes management.

The `.weight-pct` class displays percentage values (e.g., "45% of total") but does not include `font-variant-numeric: tabular-nums`. When weight percentages change (e.g., from "9%" to "45%"), digits may shift slightly. All other numerical display classes include tabular-nums.

---

## Passing checks

- **Token completeness:** All 21 design tokens from the visual direction present in `:root` with correct values.
- **Hardcoded hex in .tsx:** Only in SVG icon markup (sidebar.tsx:74-76), which is acceptable.
- **Inline styles:** All 5 instances are genuinely dynamic (runtime percentage widths).
- **Score spectrum:** Correct ranges (7.5+ high, 5.0+ mid, below low) in both implementations.
- **Inter font:** Correctly loaded via next/font/google with proper fallback stack.
- **Sidebar:** Dark background, amber active state, correct nav grouping (Library/Add).
- **Source badges:** Personal (grey), BGG (blue), Override (purple) all correct.
- **Button tiers:** Primary, secondary, danger, danger-outline, ghost, sm all defined and used correctly.
- **Two-panel layout:** Game detail uses `grid-template-columns: 1fr 380px` as specified.
- **BGG/override row backgrounds:** Breakdown table correctly applies `var(--bgg-bg)` and `var(--override-bg)`.

## Decisions

**Are all design tokens from the visual direction doc present in globals.css :root?**
PASS. All 21 tokens from the visual direction doc are present in :root with correct values. The --score-hero token is 52px (vs 40px in the doc), which is an intentional deviation documented in the visual transition plan as matching the mockup.
*Reasoning: Compared every token table in visual-direction.md against globals.css lines 3-48. Base (5 tokens), Text (3), Score Spectrum (4), Data Source (4 + override-bg extra), Actions (5), Navigation (3 extras for nav), Typography scale (6 tokens). All match. --override-bg and --nav-* tokens are additions not in the visual direction doc but specified in the transition plan.*

**Are there hardcoded hex colors in .tsx component files?**
PASS with acceptable exception. Only hex colors found in .tsx files are in SVG icon markup in sidebar.tsx:74-76 (#b86c1a, #e8e4dc). These are fill attributes on inline SVG elements which cannot use CSS custom properties directly. The transition plan explicitly allows this.
*Reasoning: grep for #[0-9a-fA-F] across all .tsx files returned only sidebar.tsx SVG fills and one HTML entity (&#8599;) which is not a hex color.*

**Are there remaining inline styles that aren't genuinely dynamic?**
PASS. All 5 inline style instances are genuinely dynamic percentage widths computed from runtime data: contribution bar width (score-breakdown.tsx:56), progress bar (import/page.tsx:185), weight total fill (axes/page.tsx:166), and weight bar fills (axes/page.tsx:284, 409).
*Reasoning: grep for style={{ across all .tsx files. Each instance uses template literals with runtime-computed percentages. No static values or hardcoded colors.*

**Are there missing CSS class definitions referenced in .tsx files?**
DEFECT. Six CSS classes are used in .tsx files but have no definition in globals.css: .no-ratings (page.tsx:216), .game-thumb-col (page.tsx:145,194), .game-info-col (page.tsx:128), .axes-used-col (page.tsx:129), .last-rated-col (page.tsx:130), .score-col (page.tsx:131), .empty-state-actions (page.tsx:72).
*Reasoning: Searched globals.css for these class names and found no matches. The collection header uses .game-thumb-col, .game-info-col, .axes-used-col, .last-rated-col, .score-col as column labels inside the grid, and .no-ratings for "No ratings yet" text in unrated rows. .empty-state-actions wraps the CTA buttons in the empty collection state. These elements will render without styling, relying only on parent grid positioning (which may work for the column divs) but .no-ratings and .empty-state-actions have no visual treatment.*

**Is font-variant-numeric: tabular-nums applied to all numerical displays?**
PASS with minor gap. tabular-nums is applied to 14 CSS classes covering scores, weights, ratings, contribution percentages, rank numbers, dates, progress fractions, and summary values. The .weight-pct class (showing "45% of total") lacks tabular-nums, which could cause visual misalignment when weight percentages change. The .tabular-nums utility class is defined but never used directly in .tsx files — all application is via CSS class definitions, which is the correct approach.
*Reasoning: Searched globals.css for font-variant-numeric occurrences: 14 instances across .stat-value, .rank, .score-value, .last-rated, .score-hero-number, .breakdown-table td, .rating-value-input, .weight-summary-total, .weight-number, .count-value, .progress-fraction, .log-game-year, .summary-stat-value. Searched .tsx files for tabular-nums class usage — none found (correct, it's applied via CSS). The .weight-pct class at line 1109-1112 shows percentage values but does not include tabular-nums.*

**Are score spectrum colors correctly applied per the specified ranges?**
PASS. Both scoreRangeClass implementations (score-badge.tsx:3-7 and page.tsx:32-36) use identical logic: >= 7.5 returns "high", >= 5.0 returns "mid", below returns "low". CSS maps .score-dot.high to var(--score-high), .mid to var(--score-mid), .low to var(--score-low). Ranges match the visual direction spec exactly: 7.5-10.0 high, 5.0-7.4 mid, 1.0-4.9 low.
*Reasoning: Read both function implementations and CSS class definitions. Note: the function is duplicated across two files, which is a code quality concern but not a visual correctness issue.*

**Is the Inter font correctly loaded and configured?**
PASS. Inter is loaded via next/font/google with subsets: ["latin"], display: "swap", and the correct fallback stack [-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif] matching the visual direction. Applied to body via inter.className in layout.tsx:26.
*Reasoning: Read layout.tsx lines 2, 6-10, 26. Configuration matches both the visual direction doc font stack and the transition plan step 1b.*

**Does the sidebar match the visual direction spec?**
PASS. Sidebar has dark background (var(--nav-bg) = #1a1714), 200px fixed width, white-ish text, active state with amber left border (3px solid var(--nav-active)), amber-tinted background (rgba(184,108,26,0.12)), correct navigation grouping ("Library": Collection/Axes, "Add": Add Game/Import BGG). Brand section includes SVG icon and subtitle.
*Reasoning: Read sidebar.tsx and globals.css sidebar section. All structural and color requirements from the visual direction nav spec are met. Active state detection uses pathname comparison (sidebar.tsx:55-58).*

**Do source badges use the correct colors per the visual direction?**
PASS. Source badges correctly differentiate all three sources: Personal uses grey (text: var(--text-secondary), bg: var(--border)), BGG uses blue (text: var(--bgg-accent), bg: #d4e7f5), Override uses purple (text: var(--override-accent), bg: #e0d6f5). The score breakdown table (score-breakdown.tsx:83-91) renders the correct badge variant per source type. BGG rows get var(--bgg-bg) background, override rows get var(--override-bg) background.
*Reasoning: Read globals.css lines 290-313 for badge definitions and score-breakdown.tsx lines 28-91 for usage. All three variants present and correctly mapped.*

**Are there hardcoded hex colors in globals.css that should be tokens?**
OBSERVATION. globals.css contains 16 hardcoded hex values outside :root. These include row hover (#f0ede8), table header background (#ede9e3), gradient placeholders, badge backgrounds (#d4e7f5, #e0d6f5), border accents (#e0c0c0, #c0d8ec, #c5b8e8), and status backgrounds (#d5f0e0, #f9f7f4). The transition plan constraint states "No hardcoded hex values in component code" — component code means .tsx files, and this constraint is satisfied. However, these CSS-level hex values create a maintenance burden: a palette change would require hunting through globals.css for related values. The visual direction doc defines #f0ede8 and #ede9e3 as literal values in the Tables section, so their presence in CSS is spec-compliant.
*Reasoning: Searched globals.css for all # occurrences. Found 16 hex values outside the :root block. These are either values defined literally in the visual direction (row hover, header bg) or are derivative tints/shades of tokenized colors (e.g., #d4e7f5 is a lighter version of --bgg-accent). None appear in .tsx component files.*

**Is there duplicated logic across component files?**
OBSERVATION. The scoreRangeClass function is defined identically in both score-badge.tsx:3-7 and page.tsx:32-36. If the score spectrum thresholds change, both must be updated. This should be extracted to a shared utility.
*Reasoning: Both files define the same function with identical logic (>= 7.5 = "high", >= 5.0 = "mid", else "low"). score-badge.tsx is a shared component, so the collection page could import from there instead of duplicating.*

**Does the import page implement the game log from the mockup?**
OBSERVATION. The import page (import/page.tsx) implements the status banner, progress bar, and completion summary but does NOT implement the per-game log list. The mockup (mockup-bgg-import.html) and plan (Step 7d) specify a game log showing each imported game with status indicators (green check for added, grey for skipped, red for errors, animated loading for current). CSS classes for this exist in globals.css (game-log-list, game-log-item, log-status, log-game-name, log-game-year, log-tag at lines 1385-1461) but no .tsx file uses them. The current SSE progress data structure (ImportProgress: imported, total, current) may not provide per-game status detail needed for the log.
*Reasoning: Searched all .tsx files for game-log, log-status, and log-game class names — no matches. Read import/page.tsx in full: it shows importing state (banner + progress bar + throttle note) and completion state (summary block) but no per-game status list during or after import. The CSS classes are orphaned.*

**Does the collection page topbar h1 have styling?**
MINOR DEFECT. The collection page uses <h1>My Collection</h1> inside .topbar (page.tsx:67,88), while other pages use <div className="topbar-title">. There is no CSS rule for .topbar h1, so the h1 will inherit browser defaults (bold, larger font) rather than matching the topbar-title styling (16px, 600 weight, --text-primary). This creates visual inconsistency between the collection page title and all other page titles.
*Reasoning: Collection page.tsx lines 67 and 88 use h1 inside topbar. All other pages (axes, import, search, game detail) use either .topbar-title or .breadcrumb. globals.css defines .topbar-title at line 1585 but has no rule for .topbar h1.*

**Does the collection page use the main-scroll wrapper for scrollable content?**
DEFECT. The collection page (page.tsx) does not wrap its scrollable content in a .main-scroll div. All other pages (game detail, axes, import, search) do. The layout shell (layout.tsx:29) renders children directly inside .main-content, which has overflow: hidden. Without .main-scroll, the collection page content (stats strip + table rows) has no scroll container, making long collections unscrollable.
*Reasoning: Searched all .tsx files for "main-scroll". Found in axes, import, search, and game detail pages but not in page.tsx (collection). The collection page returns a fragment with topbar, stats-strip, collection-header, and game rows at the top level. The .main-content class has overflow: hidden (globals.css:192), and .main-scroll provides overflow-y: auto (globals.css:197). Without the wrapper, the collection table cannot scroll.*
