---
title: "Shelf Judge Visual Direction"
date: 2026-04-05
status: draft
tags: [design, visual, ui, branding]
modules: [web-ui]
related:
  - .lore/designs/mvp-web-ui.md
  - .lore/vision.md
---

# Visual Direction: Shelf Judge

## Personality

Shelf Judge is a personal curation tool, not a game store or social platform. It belongs to one person and holds their honest, opinionated judgments. The visual language should feel like a well-maintained notebook or a carefully organized record collection — considered, precise, slightly analog. Not gamified. Not corporate. Not cartoonish.

The fitness score is the hero of the product. The UI exists to support that number and make it trustworthy. Every design decision defers to legibility of numerical data.

---

## Color Palette

### Base

| Token | Value | Use |
|-------|-------|-----|
| `--bg-base` | `#f4f1ec` | Page background — warm off-white, like quality cardboard stock |
| `--bg-surface` | `#fefcf9` | Card and panel backgrounds |
| `--bg-elevated` | `#ffffff` | Modals, dropdowns, overlays |
| `--border` | `#ddd8d0` | Default borders and dividers |
| `--border-strong` | `#c4bfb8` | Emphasized borders (table headers, active states) |

### Text

| Token | Value | Use |
|-------|-------|-----|
| `--text-primary` | `#1a1714` | Body text — warm near-black (ink on paper) |
| `--text-secondary` | `#6b6560` | Supporting text, descriptions |
| `--text-muted` | `#9c9590` | Labels, hints, placeholders |

### Score Spectrum

The fitness score has a range of 1.0–10.0. Use color to convey where a score sits within that range — not as gamification, but as rapid orientation for the eye.

| Token | Value | Range | Use |
|-------|-------|-------|-----|
| `--score-color` | `#b86c1a` | — | Primary score color (large display, hero number) |
| `--score-high` | `#2d7a4a` | 7.5–10.0 | High fitness scores |
| `--score-mid` | `#8a6f20` | 5.0–7.4 | Mid-range fitness scores |
| `--score-low` | `#b84040` | 1.0–4.9 | Low fitness scores |

### Data Source Distinction

BGG-derived data and personal ratings are fundamentally different in provenance. They get different visual treatment so the user always knows what came from the community vs. themselves.

| Token | Value | Use |
|-------|-------|-----|
| `--personal-accent` | `#1a1714` | Personal ratings — default text color (these are the user's own words) |
| `--bgg-accent` | `#2e5f8a` | BGG-derived values — slate blue (third-party data, different authority) |
| `--bgg-bg` | `#edf3f9` | Background tint for BGG-sourced rows or cells |
| `--override-accent` | `#5c3d99` | User override of a BGG value — purple (intersection of both) |

### Actions

| Token | Value | Use |
|-------|-------|-----|
| `--action` | `#1c3d5e` | Primary buttons, links |
| `--action-hover` | `#2a5580` | Hover state |
| `--action-subtle` | `#e8eff6` | Subtle action backgrounds |
| `--danger` | `#b84040` | Delete, remove, destructive actions |
| `--danger-subtle` | `#fdf0f0` | Danger confirmation backgrounds |

---

## Typography

**Font stack:** `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

Inter is preferred for its excellent tabular numerals (use `font-variant-numeric: tabular-nums` on all numerical displays). Fall back to system sans-serif.

| Scale | Size | Weight | Use |
|-------|------|--------|-----|
| `--text-xs` | 11px | 500 | Uppercase labels, axis tags, source badges |
| `--text-sm` | 13px | 400 | Table content, secondary text |
| `--text-base` | 15px | 400 | Body text, descriptions |
| `--text-lg` | 18px | 600 | Section headings, card titles |
| `--text-xl` | 24px | 700 | Game name (detail view) |
| `--score-hero` | 40px | 700 | The fitness score (large display) |

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
- Row hover: `background: #f0ede8`
- Header row: `background: #ede9e3; text-transform: uppercase; font-size: 11px; letter-spacing: 0.06em`
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

Left sidebar, 200px. Dark background (`#1a1714`) with white text — the nav is a dark panel against the warm cream content area. This creates a strong visual anchor without being heavy.

Nav items: uppercase, 12px, letter-spaced. Active state: amber-tinted left border `4px solid var(--score-color)`.

### Progress / Import

Import progress uses a linear bar, not a spinner. The user should see the count moving: "12 of 47 games imported." Each game appearing in the list below the bar gives a satisfying confirmation of progress.

---

## Icon

**Concept:** Three vertical bars of uneven heights inside a rounded square frame. The bars represent ranked scores — the tallest bar has an upward caret above it indicating "ranked #1." Simple enough to read at 32px. Distinctive enough to not look like a generic chart icon.

**Color:** Deep navy (`#1c3d5e`) on transparent background. The navbar uses dark background, so the icon renders in reverse there. For the web app favicon: deep navy on warm off-white.

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
