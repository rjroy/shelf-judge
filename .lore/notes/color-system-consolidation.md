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

## Contrast-driven value changes

The WCAG AA audit (run 2026-04-11, results captured in the spec's Contrast requirements section) surfaced two tokens with failing contrast ratios. Both were darkened to clear AA normal text on `--bg-base`. The migration must apply these new hex values:

| Token          | Old value | New value | Reason                                                                                                                                                                                                         |
| -------------- | --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--text-muted` | `#9c9590` | `#706a62` | Was 2.62:1 on `--bg-base`, failed even AA large. Used for 11px labels which WCAG treats as normal text. New value clears AA normal at 4.75:1 while staying visually distinct from `--text-secondary` (5.10:1). |
| `--score-mid`  | `#8a6f20` | `#846a1d` | Was 4.26:1, fractionally below AA normal 4.5:1. New value clears at 4.59:1 with a luminance delta of 0.016, essentially imperceptible.                                                                         |

**Derived tokens affected by `--score-mid` shift:** `--score-mid-bg`, `--score-mid-border`, and `--outlier-orphan-bg` (which references `--score-mid-bg`) all recompute slightly when `--score-mid` changes. The changes are imperceptible.

**`--conf-insufficient` is aliased to `--text-muted`** and inherits the new darker value automatically.

**Visual verification during migration.** The `--text-muted` change is visible (noticeably darker gray). Compare label and placeholder surfaces against pre-migration screenshots and confirm the new weight reads as "secondary information" rather than "disabled." If the darker value feels wrong in context, the fallback is to alias `--text-muted` to `--text-secondary` and drop the token entirely.

---

## Invalid `color-mix()` syntax to repair

Separate from the `:root` consolidation, the current `globals.css` uses an invalid `color-mix()` form in 21 places (not limited to the `:root` block; selectors throughout the file use it too). The pattern is:

```css
color-mix(in rgb, var(--some-token), 8%, transparent)
```

Two problems:

1. `in rgb` is not a valid CSS color interpolation method. The correct keyword is `in srgb`.
2. The percentage must be adjacent to its color. `var(--some-token), 8%` is parsed as a stray fourth argument and invalidates the whole expression.

The valid rewrite:

```css
color-mix(in srgb, var(--some-token) 8%, transparent)
```

Semantically: 8% of the token color mixed with 92% transparent, i.e. an 8% alpha overlay of the token.

**Why this has not been noticed so far.** The browser rejects the invalid `color-mix()` call and the property falls back. For subtle surfaces (sidebar dividers, 8% overlays) the absence is easy to miss visually. For higher-percentage overlays (30-65%) the absence is more obvious but may have been attributed to other causes.

**Migration step:** during the `:root` replacement, also grep the full `globals.css` for `color-mix(in rgb,` and repair every occurrence. The canonical block in the spec already uses the correct form, so the `:root` section is fixed automatically; the remaining ~18 occurrences in selector rules need individual edits.

```bash
grep -n 'color-mix(in rgb,' packages/web/app/globals.css
```

All matches must be gone before the migration is complete.

---

## Procedure

1. Replace the `:root` color section of `globals.css` with the canonical block from the spec. Non-color tokens (typography, spacing) stay as-is.
2. Repair every `color-mix(in rgb, ..., <pct>%, transparent)` occurrence throughout `globals.css` (selectors, not just `:root`). Use the form in the section above. Verify with `grep -n 'color-mix(in rgb,' packages/web/app/globals.css` returning zero matches.
3. Run the hex-in-components grep from the spec's Enforcement section. Fix each match either by using an existing token or by adding a new one to the spec and to `globals.css` in the same change.
4. Build and run the app. Visually compare against pre-migration screenshots for:
   - Score display in collection table and detail view
   - BGG-sourced rows and badges
   - Override indicators
   - Filter spec chips
   - Prediction panels
   - Confidence indicators
   - Success/warning/danger banners
   - Sidebar and navigation (especially the dividers, hover backgrounds, and scrollbar tracks, which were previously broken silently)
5. If any surface looks wrong, the alias or derivation for that token is the suspect. Revert just that token to its old explicit value and document the rationale in the "Kept explicit" section of the spec. Note: sidebar surfaces _should_ look different after the migration, because the previously-broken `color-mix(in rgb, ...)` was silently falling back. Verify they now render the intended subtle overlays.
6. Re-run the contrast audit script against the final token values. The pre-migration audit on 2026-04-11 passed for every spec-canonical pair; re-running confirms no regression from any last-minute tuning during the migration. Capture the output in the retro.
7. Retro: capture what actually changed visually (especially the `--text-muted` darkening and the sidebar overlays), what the contrast audit surfaced, and whether any tokens needed to revert. Then delete this notes file.

---

## Status

- [x] Contrast audit run against spec-canonical values (2026-04-11, all pairs pass)
- [x] `globals.css` `:root` block replaced with canonical (includes darkened `--text-muted` and `--score-mid`)
- [x] `color-mix(in rgb, ...)` occurrences repaired throughout `globals.css`
- [x] Enforcement grep (hex in components) clean
- [ ] Visual verification pass (including `--text-muted` darkening and sidebar overlays previously broken)
- [ ] Contrast audit re-run post-migration
- [ ] Retro written
- [ ] This file deleted
