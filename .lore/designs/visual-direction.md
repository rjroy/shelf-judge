---
title: "Shelf Judge Visual Direction"
date: 2026-04-05
status: active
tags: [design, visual, web-ui]
modules: [web-ui]
related:
  - .lore/designs/mvp-web-ui.md
  - .lore/designs/shelf-judge-color-system.md
  - .lore/vision.md
---

# Visual Direction: Shelf Judge

## Personality

Shelf Judge is a personal curation tool, not a game store or social platform. It belongs to one person and holds their honest, opinionated judgments. The visual language should feel like a well-maintained notebook or a carefully organized record collection — considered, precise, slightly analog. Not gamified. Not corporate. Not cartoonish.

The fitness score is the hero of the product. The UI exists to support that number and make it trustworthy. Every design decision defers to legibility of numerical data.

---

## Color Palette

> **Source of truth:** All color token values live in [`shelf-judge-color-system.md`](./shelf-judge-color-system.md). This section covers _intent_ — what the palette is trying to communicate. For token names, hex values, and derivation rules, see that spec.

The palette has four jobs, in order of importance:

**1. Warm parchment neutrals.** Backgrounds are off-white with a warm cast (`--bg-base`, `--bg-surface`), not gray. Text is a warm near-black (`--text-primary`), not pure black. The mental image is ink on quality cardboard stock — a tool someone uses on purpose, not a dashboard they happened to land on. The one neutral-gray exception is `--bg-muted`, used only where warmth would look wrong.

**2. Score as hero.** The fitness score has its own amber (`--score-color`) — a "precious" color that nothing else in the UI uses. The score spectrum (`--score-high/mid/low`) gives the eye rapid orientation across 1.0–10.0 without feeling gamified: a muted green, an amber, a muted red. High scores at 7.5+, mid at 5.0–7.4, low below 5.0.

**3. Data provenance as language.** BGG-derived data, personal ratings, and user overrides are three different authorities. Each gets a distinct hue that appears consistently wherever that data surfaces: personal = default text, BGG = slate blue (`--bgg-accent`), override = purple (`--override-accent`). A user should be able to tell at a glance where a number came from.

**4. Actions and status.** Actions use a deep navy (`--action`). Destructive actions reuse the score-low red via alias (`--danger` → `--score-low`) — "dangerous" and "low score" are the same visual concept. Success and confidence colors alias into the score spectrum for the same reason.

### Why these choices

- **Warm over cool neutrals:** cool grays read as corporate SaaS; warm off-whites read as considered craft.
- **Muted saturations:** bright colors draw attention to themselves; this UI needs attention on the numbers, not the chrome.
- **Aliasing semantic concepts:** when "danger" and "score-low" are the same red, they can't drift, and a brand refresh only touches one value.

---

## Typography

**Font stack:** `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

Inter is preferred for its excellent tabular numerals (use `font-variant-numeric: tabular-nums` on all numerical displays). Fall back to system sans-serif.

| Scale          | Size | Weight | Use                                        |
| -------------- | ---- | ------ | ------------------------------------------ |
| `--text-xs`    | 11px | 500    | Uppercase labels, axis tags, source badges |
| `--text-sm`    | 13px | 400    | Table content, secondary text              |
| `--text-base`  | 15px | 400    | Body text, descriptions                    |
| `--text-lg`    | 18px | 600    | Section headings, card titles              |
| `--text-xl`    | 24px | 700    | Game name (detail view)                    |
| `--score-hero` | 40px | 700    | The fitness score (large display)          |

**Numbers always use tabular numerals.** Scores, weights, ratings, contribution percentages — all `font-variant-numeric: tabular-nums`. This keeps columns aligned and lets the eye compare values without visual distortion.

**Uppercase labels:** Axis names, source labels, and column headers use `text-transform: uppercase; letter-spacing: 0.06em` at 11px/500 weight. This creates clear visual hierarchy without adding a second typeface.

---

## Spacing and Layout

### Grid

- **Sidebar nav:** 200px fixed left
- **Content area:** flex:1, max-width 920px, `padding: 0 32px`
- **Full-page max width:** 1120px

### Spacing Scale

`4 / 8 / 12 / 16 / 24 / 32 / 48 / 64px`

Prefer 16px and 24px for internal component spacing. 32px for section gaps. 8px for tight inline spacing (label+value pairs).

### Cards

Single-level elevation. All cards use:

- `background: var(--bg-surface)`
- `border: 1px solid var(--border)`
- `border-radius: 6px`
- No drop shadows — shadows imply depth hierarchy that doesn't exist here. The surface and card are one layer.

### Tables

The collection view is a table. Embrace that — don't card-ify rows.

- `border-collapse: collapse`
- Row hover: `background: var(--row-hover)`
- Header row: `background: var(--table-header-bg); text-transform: uppercase; font-size: 11px; letter-spacing: 0.06em`
- Score column: right-aligned, tabular numerals, `--score-color` tint
- Thumbnail: 40×40px in a circle or rounded square, left of game name

---

## Component Language

### Fitness Score Display

The fitness score is the most important element in the product. It gets the most prominent treatment:

**List view:** Right-aligned score column. `font-size: 17px; font-weight: 700; color: var(--score-color)`. Use score spectrum colors (`--score-high/mid/low`) for the background dot indicator — a small 8px circle to the left of the number.

**Detail view hero:** Large block at top of the detail page. `font-size: 40px; font-weight: 700; color: var(--score-color)`. Below it: "out of 10 · X axes rated" in muted text. The score is immediately followed by the breakdown.

### Score Breakdown

This is the product's core transparency feature. Design it as a structured table, not a chart.

Columns: **Axis** | **Rating** | **Weight** | **Contribution** | **Source**

- Source column: badge — "Personal" (default text), "BGG" (slate blue chip), "Override" (purple chip)
- Contribution: percentage of total score this axis drove (`rating × weight / total_weight_sum`)
- A contribution bar (thin, inline) running the width of the contribution percentage value — visual without being a chart
- Final row: "Fitness Score: **7.4**" — bold, no source badge

BGG-derived rows get the `--bgg-bg` background tint. Override rows get a light `--override-accent` tint.

### Axis Tags

Axes shown inline (on a game card or row) as compact chips:

- `border: 1px solid var(--border); border-radius: 4px; padding: 2px 8px; font-size: 11px`
- Weight shown as a subtle number suffix: `Partner play ×2.5`

### Buttons

Three tiers:

- **Primary:** `background: var(--action); color: white; border-radius: 5px; padding: 8px 16px`
- **Secondary:** `border: 1px solid var(--action); color: var(--action); background: transparent`
- **Danger:** `background: var(--danger); color: white` (primary style in danger color)
- **Ghost:** No border, `color: var(--action)` — for low-prominence actions

### Navigation

Left sidebar, 200px. Dark background (`var(--nav-bg)`, which aliases `--text-primary`) with `var(--nav-text)` — the nav is a dark panel against the warm cream content area. This creates a strong visual anchor without being heavy.

Nav items: uppercase, 12px, letter-spaced. Active state: amber-tinted left border `4px solid var(--score-color)`.

### Progress / Import

Import progress uses a linear bar, not a spinner. The user should see the count moving: "12 of 47 games imported." Each game appearing in the list below the bar gives a satisfying confirmation of progress.

---

## Icon

**Concept:** Three vertical bars of uneven heights inside a rounded square frame. The bars represent ranked scores — the tallest bar has an upward caret above it indicating "ranked #1." Simple enough to read at 32px. Distinctive enough to not look like a generic chart icon.

**Color:** Deep navy (`var(--action)`) on transparent background. The navbar uses dark background, so the icon renders in reverse there. For the web app favicon: deep navy on warm off-white.

**File targets:**

- `.lore/art/icon.webp` — 512×512, production
- `.lore/art/favicon-32.png` — 32×32, favicon
- `.lore/art/favicon-16.png` — 16×16, favicon (simplified)

---

## Mood Reference

If this tool had a physical equivalent, it would be a well-maintained spreadsheet printed on quality paper, annotated by hand in a small, precise script. The person who built it cares about the shelf — they're not browsing, they're curating. The UI should feel like a tool for someone who has already made up their mind about what quality means.

**References:**

- A record shop's carefully typed catalog cards
- Vintage board game box design — functional typography, no wasted space
- The score breakdown in a competitive analysis document

**Not references:**

- Board game retailer websites (transactional, promotional)
- Gaming achievement platforms (gamified, social)
- Generic SaaS dashboards (corporate, spacious, feature-agnostic)
