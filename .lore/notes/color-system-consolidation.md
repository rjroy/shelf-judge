---
title: "Migration notes: color system consolidation"
date: 2026-04-11
status: pending
tags: [implementation, notes, web-ui, css, color]
source: .lore/designs/shelf-judge-color-system.md
modules: [web-ui]
---

# Migration Notes: Color System Consolidation

These notes describe the migration of `packages/web/app/globals.css` from its pre-consolidation state to the canonical `:root` block defined in [`.lore/designs/shelf-judge-color-system.md`](../designs/shelf-judge-color-system.md).

**Why this is a notes file, not part of the spec.** The migration is a one-time event. Once `globals.css` matches the spec and has been verified in a retro, this file can be deleted. Keeping the migration rationale in the living spec would bloat a long-lived document with short-half-life content.

---

## Scope

The spec is authoritative. `globals.css` currently has 83 color-related custom properties; the spec defines 77. The differences fall into three categories: aliases that replaced near-duplicate hex values, derivations that replaced explicit hex backgrounds and borders, and a small number of tokens that stayed explicit for documented reasons.

---

## Aliases (no visual change expected)

These tokens lose their own hex values and reference something that already exists.

| Old                              | New reference            | Reason                                            |
| -------------------------------- | ------------------------ | ------------------------------------------------- |
| `--success: #2e7d32`             | `var(--score-high)`      | Near-identical green, same semantic concept       |
| `--success-subtle: #e8f5e9`      | `var(--score-high-bg)`   | Imperceptible difference                          |
| `--danger-subtle: #fdf0f0`       | `var(--score-low-bg)`    | Imperceptible difference at this lightness        |
| `--suggest-border: #c8c0b4`      | `var(--border-strong)`   | 4-unit channel difference, invisible side by side |
| `--placeholder-from: #e8e4dc`    | `var(--nav-text)`        | Exact duplicate hex                               |
| `--outlier-lone-border: #c8b8e0` | `var(--override-border)` | 3-unit channel difference                         |
| `--warning-bg: #fff8e6`          | removed entirely         | `--warning-subtle` covers this usage              |

**Verification step:** after applying, visually compare the affected UI surfaces against screenshots taken before the migration. Any perceptible difference means the alias was wrong and the old value needs to come back as an explicit kept-explicit entry in the spec.

---

## Derivations replacing explicit hex values

These tokens become `color-mix()` expressions of their domain accent.

| Token                      | Old value | New derivation                                         |
| -------------------------- | --------- | ------------------------------------------------------ |
| `--bgg-bg`                 | `#edf3f9` | `color-mix(in hsl, var(--bgg-accent), white 92%)`      |
| `--bgg-border`             | `#c0d8ec` | `color-mix(in hsl, var(--bgg-accent), white 78%)`      |
| `--bgg-badge-bg`           | `#d4e7f5` | `color-mix(in hsl, var(--bgg-accent), white 85%)`      |
| `--override-bg`            | `#f0ecfa` | `color-mix(in hsl, var(--override-accent), white 94%)` |
| `--override-border`        | `#c5b8e8` | `color-mix(in hsl, var(--override-accent), white 78%)` |
| `--override-badge-bg`      | `#e0d6f5` | `color-mix(in hsl, var(--override-accent), white 85%)` |
| `--action-subtle`          | `#e8eff6` | `color-mix(in hsl, var(--action), white 93%)`          |
| `--action-border`          | `#b8ccdc` | `color-mix(in hsl, var(--action), white 77%)`          |
| `--filter-spec-bg`         | `#eaf2e8` | `color-mix(in hsl, var(--filter-spec), white 92%)`     |
| `--filter-spec-border`     | `#c4ddbf` | `color-mix(in hsl, var(--filter-spec), white 78%)`     |
| `--predict-bg`             | `#eaf5f3` | `color-mix(in hsl, var(--predict-accent), white 92%)`  |
| `--predict-border`         | `#a8d9d4` | `color-mix(in hsl, var(--predict-accent), white 75%)`  |
| `--conf-moderate-bg`       | `#f5ecd8` | `color-mix(in hsl, var(--conf-moderate), white 92%)`   |
| `--conf-weak-bg`           | `#f5e4d8` | `color-mix(in hsl, var(--conf-weak), white 92%)`       |
| `--danger-border`          | `#e0c0c0` | `color-mix(in hsl, var(--score-low), white 75%)`       |
| `--outlier-orphan-bg`      | `#f5f0e2` | `color-mix(in hsl, var(--score-mid), white 93%)`       |
| `--outlier-orphan-border`  | `#d8c890` | `var(--score-mid-border)`                              |
| `--outlier-fitness-border` | `#a8d8b8` | `color-mix(in hsl, var(--score-high), white 78%)`      |

**Verification step:** `color-mix(in hsl, X, white Y%)` does not always produce the exact value that a hand-picked hex would. Spot-check each row above by computing the derived value and comparing to the old hex. Differences greater than ~3 units per channel warrant a closer look at whether the percentage is right or the old hex had non-trivial tuning worth preserving.

---

## Tokens that stayed explicit

Documented in the spec under "Kept explicit despite being near-derivable." Summary for migration purposes:

- `--action-hover`
- `--success-bg`
- `--score-mid` and `--conf-moderate` (both)
- `--bg-subtle` and `--bg-muted` (both)

No migration action needed on these; they keep their existing values.

---

## Procedure

1. Replace the `:root` color section of `globals.css` with the canonical block from the spec. Non-color tokens (typography, spacing) stay as-is.
2. Run the enforcement grep from the spec to surface any hex values in component CSS. Fix each one either by using an existing token or by adding a new one to the spec and to `globals.css` in the same change.
3. Build and run the app. Visually compare against the pre-migration screenshots for:
   - Score display in collection table and detail view
   - BGG-sourced rows and badges
   - Override indicators
   - Filter spec chips
   - Prediction panels
   - Confidence indicators
   - Success/warning/danger banners
   - Sidebar and navigation
4. If any surface looks wrong, the alias or derivation for that token is the suspect. Revert just that token to its old explicit value and document the rationale in the "Kept explicit" section of the spec.
5. Run the contrast audit called out in the spec. Any failing pair means tuning either the foreground or the background before declaring the migration complete.
6. Retro: capture what actually changed visually (if anything), what the contrast audit surfaced, and whether any tokens needed to revert. Then delete this notes file.

---

## Status

- [ ] `globals.css` `:root` block replaced with canonical
- [ ] Enforcement grep clean
- [ ] Visual verification pass
- [ ] Contrast audit pass
- [ ] Retro written
- [ ] This file deleted
