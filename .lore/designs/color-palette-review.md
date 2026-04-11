# Color Palette Review

**Date:** 2026-04-11
**File reviewed:** `packages/web/app/globals.css`

---

## Summary

The file defines **83 color-related custom properties**: 67 hard-coded hex values, 12 aliases to other variables, and 3 `color-mix()` derivations from `--nav-text`. For a utility-focused single-user app, this is about 1.5x what a clean system needs.

**Current count:** 83 color variables (67 unique hex values)
**Recommended count:** ~55 color variables (34 unique hex values + 21 aliases/derivations)
**Reduction:** ~28 fewer variables, achieved entirely through aliasing and `color-mix()` — no color changes required.

---

## Baseline: What's the Right Count?

A well-designed token system for a utility app at this complexity level typically has:

- **Neutral scale:** 10–12 (3 backgrounds, 2 borders, 3 text, 2–3 derived surface tones)
- **Brand/semantic accents:** 5–6 hue "keys" with base + bg per key
- **Status colors:** 3 semantic states (success, warning, danger) with base + bg each
- **Total:** 35–50 variables

Shelf Judge has legitimate complexity that justifies going higher: it has three distinct data provenance "languages" (Personal, BGG, Override), a score spectrum with three levels, a prediction state, and a confidence gradient. A target of **50–55 is appropriate** — this is not a simple marketing site.

The current 83 represents accumulation rather than design: each feature added its own variables without checking whether something nearby already served the purpose.

---

## Near-Duplicates

### 1. `--success` and `--score-high` are the same green

```
--success:    #2e7d32  (hsl 123°, 47%, 34%)
--score-high: #2d7a4a  (hsl 145°, 47%, 33%)
```

Two dark greens, one degree of lightness apart, used for the same semantic concept: "good." Score-high was the original palette color; success was added later for UI feedback states. The hue difference (123° vs 145°) is barely perceptible at this darkness.

**Recommendation:** Make `--success` an alias to `--score-high`. Keep the score-high hue as the single canonical "good" green.

### 2. `--success-subtle` and `--score-high-bg` are virtually identical

```
--success-subtle: #e8f5e9  (hsl 124°, 44%, 93%)
--score-high-bg:  #eaf5ef  (hsl 144°, 45%, 93%)
```

Same lightness, 1% saturation difference, hue shift of 20° that is imperceptible at 93% lightness. If success aliases to score-high (above), this naturally follows.

**Recommendation:** Make `--success-subtle` an alias to `--score-high-bg`.

### 3. `--score-low-bg` and `--danger-subtle` are near-identical light reds

```
--score-low-bg:  #fdeaea  (hsl 0°, 90%, 96%)
--danger-subtle: #fdf0f0  (hsl 0°, 67%, 97%)
```

Both are "barely there" red washes. danger-subtle is slightly more desaturated and 1% lighter. The distinction has no semantic meaning — a background this pale reads identically to a user.

**Recommendation:** Make `--danger-subtle` an alias to `--score-low-bg`.

### 4. `--conf-moderate` and `--score-mid` are nearly the same dark amber

```
--conf-moderate: #7a5e1a  (hsl 44°, 65%, 29%)
--score-mid:     #8a6f20  (hsl 44°, 63%, 34%)
```

Same hue (44°), almost identical saturation, 5% lightness difference. They represent different concepts (confidence level vs score tier) but happen to be the same amber family. The lightness gap is enough to see side-by-side but not in isolation.

**Recommendation:** Keep both — they serve different contexts and appear independently on screen. But document this as an intentional near-duplicate, not an accident.

### 5. `--placeholder-from` and `--nav-text` are exactly the same hex

```
--placeholder-from: #e8e4dc
--nav-text:         #e8e4dc
```

Exact match. `--placeholder-from` is used in a gradient for image placeholders; `--nav-text` is the sidebar text color. They happen to be the same warm cream.

**Recommendation:** Make `--placeholder-from: var(--nav-text)`. This makes the relationship explicit and removes one hard-coded value.

### 6. `--suggest-border` and `--border-strong` are essentially the same

```
--suggest-border: #c8c0b4
--border-strong:  #c4bfb8
```

Values differ by 4 units on each channel — imperceptible at any scale. `--suggest-border` appears in exactly one place (the suggestion/autocomplete dropdown border).

**Recommendation:** Remove `--suggest-border`, replace the one usage with `--border-strong`.

### 7. `--warning-subtle` and `--warning-bg` are redundant

```
--warning-subtle: #fff3e0  (very light warm yellow)
--warning-bg:     #fff8e6  (very light warm yellow)
```

Two near-identical light yellow backgrounds for warning states. The difference is invisible without side-by-side comparison.

**Recommendation:** Remove `--warning-bg`. Alias any usage to `--warning-subtle`, or just pick one and use it consistently.

---

## Color "Languages" That Could Use Derivation

The most significant structural issue is that each "language" (BGG data, Override data, Action state, Filter spec, Prediction) defines 3–4 variables as independent hex values when a base + two `color-mix()` derivations would cover them.

### BGG data language (4 variables → 2 + 2 derived)

```css
/* Current */
--bgg-accent: #2e5f8a;
--bgg-bg: #edf3f9;
--bgg-border: #c0d8ec;
--bgg-badge-bg: #d4e7f5;

/* Proposed */
--bgg-accent: #2e5f8a;
--bgg-bg: color-mix(in hsl, var(--bgg-accent), white 92%); /* ≈ #edf3f9 */
--bgg-border: color-mix(in hsl, var(--bgg-accent), white 78%); /* ≈ #c0d8ec */
--bgg-badge-bg: color-mix(in hsl, var(--bgg-accent), white 85%); /* ≈ #d4e7f5 */
```

This means if the BGG blue ever needs to shift (theming, accessibility pass), one value change propagates everywhere.

### Override data language (4 variables → 2 + 2 derived)

```css
/* Current */
--override-accent: #5c3d99;
--override-bg: #f0ecfa;
--override-border: #c5b8e8;
--override-badge-bg: #e0d6f5;

/* Proposed */
--override-accent: #5c3d99;
--override-bg: color-mix(in hsl, var(--override-accent), white 94%); /* ≈ #f0ecfa */
--override-border: color-mix(in hsl, var(--override-accent), white 78%); /* ≈ #c5b8e8 */
--override-badge-bg: color-mix(in hsl, var(--override-accent), white 85%); /* ≈ #e0d6f5 */
```

### Action language (4 variables → 2 + 2 derived)

```css
/* Current */
--action: #1c3d5e;
--action-hover: #2a5580;
--action-subtle: #e8eff6;
--action-border: #b8ccdc;

/* Proposed */
--action: #1c3d5e;
--action-hover: color-mix(in hsl, var(--action), white 20%); /* ≈ #2a5580 */
--action-subtle: color-mix(in hsl, var(--action), white 93%); /* ≈ #e8eff6 */
--action-border: color-mix(in hsl, var(--action), white 77%); /* ≈ #b8ccdc */
```

Note: `--action-hover` as a derivation is a judgment call. If hover states need to be tuned precisely for accessibility contrast, keeping it explicit may be preferable.

### Filter-spec language (3 variables → 1 + 2 derived)

```css
/* Current */
--filter-spec: #4a6e42;
--filter-spec-bg: #eaf2e8;
--filter-spec-border: #c4ddbf;

/* Proposed */
--filter-spec: #4a6e42;
--filter-spec-bg: color-mix(in hsl, var(--filter-spec), white 92%); /* ≈ #eaf2e8 */
--filter-spec-border: color-mix(in hsl, var(--filter-spec), white 78%); /* ≈ #c4ddbf */
```

### Prediction language (3 variables → 1 + 2 derived)

```css
/* Current */
--predict-accent: #1a706a;
--predict-bg: #eaf5f3;
--predict-border: #a8d9d4;

/* Proposed */
--predict-accent: #1a706a;
--predict-bg: color-mix(in hsl, var(--predict-accent), white 92%); /* ≈ #eaf5f3 */
--predict-border: color-mix(in hsl, var(--predict-accent), white 75%); /* ≈ #a8d9d4 */
```

---

## Score Spectrum Analysis

The score spectrum defines 9 independent hex values (3 accent + 3 bg + 3 border). The bg and border tiers could be derived:

```css
/* Keep these 4 as explicit roots */
--score-color: #b86c1a; /* the "precious number" amber — keep explicit */
--score-high: #2d7a4a; /* high score green */
--score-mid: #8a6f20; /* mid score amber */
--score-low: #b84040; /* low score red */

/* Backgrounds — derived */
--score-bg: color-mix(in hsl, var(--score-color), white 92%); /* ≈ #fdf3e7 */
--score-high-bg: color-mix(in hsl, var(--score-high), white 92%); /* ≈ #eaf5ef */
--score-low-bg: color-mix(in hsl, var(--score-low), white 93%); /* ≈ #fdeaea */

/* Borders — derived (currently 3 separate hex values) */
--score-border: color-mix(in hsl, var(--score-color), white 75%); /* ≈ #e8c898 */
--score-mid-border: color-mix(in hsl, var(--score-mid), white 78%); /* ≈ #ddd0a0 */
--score-low-border: color-mix(in hsl, var(--score-low), white 79%); /* ≈ #f0b8b8 */
```

The score spectrum is the most visible design language in the app — the derivation values should be validated visually before shipping. The `color-mix()` approximations above are close but the exact percentages need tuning against the current hex values.

---

## Outlier Tag Variables

The outlier section (9 variables) is already mostly aliases:

```
--outlier-lone          → --override-accent       ✓ alias
--outlier-lone-bg       → --override-bg           ✓ alias
--outlier-lone-border:  #c8b8e0    ⚠ near-duplicate of --override-border: #c5b8e8
--outlier-orphan        → --score-mid             ✓ alias
--outlier-orphan-bg:    #f5f0e2    could alias to --score-bg or derive
--outlier-orphan-border: #d8c890   could derive from --score-mid
--outlier-fitness       → --score-high            ✓ alias
--outlier-fitness-bg    → --score-high-bg         ✓ alias
--outlier-fitness-border: #a8d8b8  could alias to a score-high border derivation
```

**Recommendation:** If score spectrum borders are moved to `color-mix()` derivations, the outlier borders can reference those same derivations or be removed entirely. `--outlier-lone-border: #c8b8e0` is 3 units from `--override-border: #c5b8e8` — make it an alias.

---

## Proposed Consolidated Palette

The 34 "root" (non-derived, non-alias) variables after consolidation:

```css
:root {
  /* ── Neutral surfaces ── */
  --bg-base: #f4f1ec;
  --bg-surface: #fefcf9;
  --bg-elevated: #ffffff;
  --bg-subtle: #f9f7f4; /* keep — warm-tinted, distinct from bg-muted */
  --bg-muted: #f5f5f5; /* keep — neutral gray, only place where warmth isn't wanted */
  --border: #ddd8d0;
  --border-strong: #c4bfb8;
  --row-hover: #f0ede8;
  --table-header-bg: #ede9e3;

  /* ── Text ── */
  --text-primary: #1a1714;
  --text-secondary: #6b6560;
  --text-muted: #9c9590;

  /* ── Score spectrum (4 roots, rest derived) ── */
  --score-color: #b86c1a;
  --score-high: #2d7a4a;
  --score-mid: #8a6f20;
  --score-low: #b84040;

  /* ── Status ── */
  --warning: #e65100;
  --warning-subtle: #fff3e0;
  --warning-border: #e8d060;
  --warning-text: #7a5f10;

  /* ── Data source languages (2 roots each, rest derived) ── */
  --bgg-accent: #2e5f8a;
  --override-accent: #5c3d99;

  /* ── Action ── */
  --action: #1c3d5e;
  --action-hover: #2a5580; /* optionally derived; keep explicit for accessibility control */

  /* ── Navigation ── */
  --nav-text: #e8e4dc;

  /* ── Filter spec (1 root) ── */
  --filter-spec: #4a6e42;

  /* ── Prediction (1 root) ── */
  --predict-accent: #1a706a;

  /* ── Confidence gradient ── */
  --conf-moderate: #7a5e1a;
  --conf-moderate-bg: #f5ecd8; /* optionally derive from conf-moderate */
  --conf-weak: #8a3a10;
  --conf-weak-bg: #f5e4d8; /* optionally derive from conf-weak */

  /* ── Skeleton/placeholder ── */
  --placeholder-to: #d0cbc0; /* --placeholder-from aliases to --nav-text */
}
```

That's **34 root values**. Add back the aliases and derivations (~21) and the total lands at ~55.

---

## Migration Map

| Remove                           | Replace with                                           |
| -------------------------------- | ------------------------------------------------------ |
| `--success: #2e7d32`             | `var(--score-high)`                                    |
| `--success-subtle: #e8f5e9`      | `var(--score-high-bg)`                                 |
| `--danger-subtle: #fdf0f0`       | `var(--score-low-bg)`                                  |
| `--suggest-border: #c8c0b4`      | `var(--border-strong)`                                 |
| `--warning-bg: #fff8e6`          | `var(--warning-subtle)`                                |
| `--placeholder-from: #e8e4dc`    | `var(--nav-text)`                                      |
| `--outlier-lone-border: #c8b8e0` | `var(--override-border)` _(derived)_                   |
| `--bgg-bg: #edf3f9`              | `color-mix(in hsl, var(--bgg-accent), white 92%)`      |
| `--bgg-border: #c0d8ec`          | `color-mix(in hsl, var(--bgg-accent), white 78%)`      |
| `--bgg-badge-bg: #d4e7f5`        | `color-mix(in hsl, var(--bgg-accent), white 85%)`      |
| `--override-bg: #f0ecfa`         | `color-mix(in hsl, var(--override-accent), white 94%)` |
| `--override-border: #c5b8e8`     | `color-mix(in hsl, var(--override-accent), white 78%)` |
| `--override-badge-bg: #e0d6f5`   | `color-mix(in hsl, var(--override-accent), white 85%)` |
| `--action-subtle: #e8eff6`       | `color-mix(in hsl, var(--action), white 93%)`          |
| `--action-border: #b8ccdc`       | `color-mix(in hsl, var(--action), white 77%)`          |
| `--filter-spec-bg: #eaf2e8`      | `color-mix(in hsl, var(--filter-spec), white 92%)`     |
| `--filter-spec-border: #c4ddbf`  | `color-mix(in hsl, var(--filter-spec), white 78%)`     |
| `--predict-bg: #eaf5f3`          | `color-mix(in hsl, var(--predict-accent), white 92%)`  |
| `--predict-border: #a8d9d4`      | `color-mix(in hsl, var(--predict-accent), white 75%)`  |
| `--score-bg: #fdf3e7`            | `color-mix(in hsl, var(--score-color), white 92%)`     |
| `--score-high-bg: #eaf5ef`       | `color-mix(in hsl, var(--score-high), white 92%)`      |
| `--score-low-bg: #fdeaea`        | `color-mix(in hsl, var(--score-low), white 93%)`       |
| `--score-border: #e8c898`        | `color-mix(in hsl, var(--score-color), white 75%)`     |
| `--score-mid-border: #ddd0a0`    | `color-mix(in hsl, var(--score-mid), white 78%)`       |
| `--score-low-border: #f0b8b8`    | `color-mix(in hsl, var(--score-low), white 79%)`       |

---

## Variables Worth Keeping Despite Apparent Redundancy

A few variables look redundant but have defensible reasons to stay explicit:

- **`--score-mid: #8a6f20` and `--conf-moderate: #7a5e1a`** — Nearly the same amber, but serve different features displayed independently. The gap is intentional (moderate confidence ≠ mid score). Mark with a comment.
- **`--bg-subtle: #f9f7f4` and `--bg-muted: #f5f5f5`** — Subtle is warm-tinted (consistent with the app's cardboard palette); muted is neutral gray (used in the one place warmth would look wrong). Worth keeping both.
- **`--success-bg: #d5f0e0`** — This is notably deeper green than `--score-high-bg`. It's used for prominent "operation succeeded" feedback where a stronger read is appropriate. Don't derive; keep explicit.

---

## Implementation Priority

1. **Quick wins (aliases, no visual change):** success, success-subtle, danger-subtle, suggest-border, warning-bg, placeholder-from, outlier-lone-border — these are pure cleanup.

2. **Moderate effort (color-mix derivations):** bgg/override/action/filter-spec/predict background and border families — validate visually that color-mix matches current hex before shipping.

3. **Higher care (score spectrum derivations):** These are the most visible colors in the product. Validate the color-mix percentages precisely against the current values before removing the explicit definitions.
