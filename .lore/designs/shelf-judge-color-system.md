---
title: "Shelf Judge Color System"
date: 2026-04-11
status: active
tags: [design, visual, web-ui, color, css]
modules: [web-ui]
related:
  - .lore/reference/color-system-principles.md
  - .lore/designs/visual-direction.md
  - .lore/designs/mvp-web-ui.md
  - .lore/notes/color-system-consolidation.md
---

# Shelf Judge Color System

This document defines the canonical color token system for `packages/web/app/globals.css`. It is the source of truth for what the `:root` color block contains and why. For background on color-token design in general, see [color-system-principles.md](../reference/color-system-principles.md).

---

## Architecture

Shelf Judge is a single-user app with light and dark themes. It uses **architecture B** from the principles doc: hex roots live directly in semantic tokens, with derivations and aliases on top. There is no primitive palette layer (architecture A). Dark mode is implemented via a `[data-theme="dark"]` override block on `:root` that redefines the ~31 hex roots and ~26 derivations. Aliases cascade automatically and require no overrides.

The three kinds of value in the system:

- **Explicit (hex) roots.** The only values that require a designer decision to change.
- **Derivations.** `color-mix()` variants of a root (backgrounds, borders, badge backgrounds).
- **Aliases.** `var()` references that express "these two concepts share a color."

Components reference tokens by name. No hex values appear in component CSS.

### Dark mode derivation strategy

In light mode, derivations mix toward `white` (e.g. `color-mix(in hsl, var(--bgg-accent), white 92%)`). In dark mode, mixing toward white produces washed-out pastels on dark backgrounds. The dark override block replaces `white` with `var(--bg-base)` in all derivations, producing subtle tints appropriate for dark surfaces:

- `-bg` variants: `color-mix(in hsl, <root>, var(--bg-base) 85%)`
- `-border` variants: `color-mix(in hsl, <root>, var(--bg-base) 70%)`
- `-badge-bg` variants: `color-mix(in hsl, <root>, var(--bg-base) 80%)`

### Button text tokens

`--on-action` and `--on-danger` represent text color on filled button backgrounds. In light mode these are `white`; in dark mode they are `var(--bg-base)` (dark text on lighter button surfaces). This resolves the mathematical impossibility of a single action color meeting 4.5:1 contrast against both a dark page background (as text) and white (as button label).

---

## Domain archetypes

The system has three kinds of color domain. Each follows a different vocabulary, and each is justified differently.

### 1. Single-accent domains

One canonical hue with derived variants. The standard variant vocabulary:

| Suffix      | Purpose                                        | Source                                 |
| ----------- | ---------------------------------------------- | -------------------------------------- |
| `-bg`       | Light background wash                          | `color-mix(in hsl, <root>, white 92%)` |
| `-border`   | Medium outline                                 | `color-mix(in hsl, <root>, white 78%)` |
| `-badge-bg` | Slightly stronger background for inline badges | `color-mix(in hsl, <root>, white 85%)` |

**Root naming.** Single-accent roots come in two forms:

- **Suffixed form**, `--<domain>-accent`, for data-provenance domains where the domain name (`bgg`, `override`, `predict`) needs a suffix to read as a noun.
- **Bare form**, `--<domain>`, for domains where the domain name is already a complete noun (`--filter-spec`, `--success`, `--warning`, `--danger`, `--action`).

Both forms share the same variant suffixes (`-bg`, `-border`, `-badge-bg`). Which form a domain uses is a naming choice, not a structural one; the derivation rules are identical.

Domains in this archetype:

| Domain          | Root                | Notes                                                                                                                                                   |
| --------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Personal**    | `--personal-accent` | Aliases to `--text-primary`. No variants because personal data uses the default surface; the accent is the only token.                                  |
| **BGG**         | `--bgg-accent`      | Data provenance: community-sourced. Full vocabulary (`-bg`, `-border`, `-badge-bg`).                                                                    |
| **Override**    | `--override-accent` | Data provenance: user override of BGG. Full vocabulary.                                                                                                 |
| **Prediction**  | `--predict-accent`  | Data provenance: model-predicted ratings. `-bg` and `-border` only.                                                                                     |
| **Tournament**  | `--tourney-accent`  | Aliases to BGG palette since tournament data is BGG-sourced. `-accent` and `-bg` only.                                                                  |
| **Filter spec** | `--filter-spec`     | Bare-form root. Active filter indicators. `-bg` and `-border` only.                                                                                     |
| **Success**     | `--success`         | Bare-form root. Aliases `--score-high`; `--success-bg` is kept explicit (see "Kept explicit" below).                                                    |
| **Warning**     | `--warning`         | Bare-form root. Full explicit variants (`-subtle`, `-border`, `-text`) because the orange sits outside the score spectrum and needs independent tuning. |
| **Danger**      | `--danger`          | Bare-form root. Aliases `--score-low`; subtle/border follow.                                                                                            |
| **Action**      | `--action`          | Bare-form root. Plus `-hover` (explicit, for contrast control) in addition to the standard variants.                                                    |

Not every domain needs every variant. `-badge-bg` is optional; `-border` is the minimum variant alongside `-bg`.

### 2. Tiered-scale domains

A semantic gradient where each tier is its own root. Each tier uses single-accent-style derivations, but the domain has no single "accent" because the whole point is the gradient.

| Domain                | Tier roots                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Score spectrum**    | `--score-high`, `--score-mid`, `--score-low` (tier indicators), plus `--score-color` (hero display, separate from the tier scale) |
| **Confidence levels** | `--conf-strong`, `--conf-moderate`, `--conf-weak`, `--conf-insufficient`                                                          |

`--score-color` sits in the score spectrum domain but is not a tier. It is the precious hero accent used for score displays themselves (see Usage guidance below). The three tier roots (`-high`, `-mid`, `-low`) are the actual tiered scale.

Tiered-scale roots alias cross-domain when the semantics match (`--conf-strong: var(--score-high)`). Aliasing is preferred over new hex values when the visual concept is the same.

### 3. Application-wide UI plumbing

Cross-cutting concerns that are not bounded domains: neutral surfaces, text, navigation, and aliased tag surfaces. These use their own vocabularies because they do not have a single "accent" around which variants cluster.

| Group                | Tokens                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Neutrals**         | `--bg-base`, `--bg-surface`, `--bg-elevated`, `--bg-subtle`, `--bg-muted`, `--border`, `--border-strong`, `--row-hover`, `--table-header-bg` |
| **Text**             | `--text-primary`, `--text-secondary`, `--text-muted`                                                                                         |
| **Navigation**       | `--nav-bg`, `--nav-text`, `--nav-active`                                                                                                     |
| **Outlier tags**     | `--outlier-lone`, `--outlier-orphan`, `--outlier-fitness` and variants (all aliases to other domains)                                        |
| **UI surfaces**      | `--suggest-bg`, `--suggest-border`, `--overlay-bg`, `--placeholder-from`, `--placeholder-to`                                                 |
| **Shadows**          | `--shadow-menu`                                                                                                                              |
| **Sidebar overlays** | `--sidebar-divider`, `--sidebar-item-hover-bg`, `--sidebar-track-bg` (light-on-dark composites)                                              |

---

## Usage guidance

**`--score-color` vs `--score-high/-mid/-low`.** These are four score tokens with distinct jobs.

- `--score-color` is the hero amber, the "precious" color reserved for score _displays themselves_: the large score number on the detail view, the score column text in the collection table.
- `--score-high/-mid/-low` are _tier indicators_ used where a score's bucket matters: tier dots, spectrum backgrounds, heatmap cells.

Never use `--score-color` for tier indication. Never use `--score-high/-mid/-low` for the hero display.

**Data provenance.** Any UI surface showing data has a provenance: personal, BGG, or override. The provenance determines the accent. A mixed-provenance display (a table with rows from all three) uses each row's own provenance accent, not a single shared color. This is the product's core transparency signal and should not be compromised for visual simplicity.

**`--danger` vs `--score-low`.** `--danger` is an alias of `--score-low`. If a design calls for destructive-action styling, use `--danger`. If it calls for low-score indication, use `--score-low`. The alias keeps them in sync; the separation lets components name what they mean.

**Warm vs gray neutrals.** Default to the warm parchment neutrals (`--bg-base`, `--bg-surface`, `--bg-subtle`). Use `--bg-muted` (neutral gray) only in the one place where the warm cast would look wrong. If a second use case appears, discuss it before adding more neutral-gray surfaces; the exception should stay an exception.

---

## Contrast requirements

WCAG 2.1 AA targets: **4.5:1** for normal text, **3:1** for large text (18px+ or 14px+ bold), **3:1** for non-text UI components and graphical objects (WCAG 1.4.11). The canonical token values in this spec have been audited against these thresholds. Measured ratios:

| Foreground         | Background       |     Ratio | Target         | Status                                                                   |
| ------------------ | ---------------- | --------: | -------------- | ------------------------------------------------------------------------ |
| `--text-primary`   | `--bg-base`      | 15.84 : 1 | AA normal text | PASS (AAA)                                                               |
| `--text-primary`   | `--bg-surface`   | 17.43 : 1 | AA normal text | PASS (AAA)                                                               |
| `--text-primary`   | `--bg-subtle`    | 16.69 : 1 | AA normal text | PASS (AAA)                                                               |
| `--text-secondary` | `--bg-base`      |  5.10 : 1 | AA normal text | PASS                                                                     |
| `--text-secondary` | `--bg-surface`   |  5.61 : 1 | AA normal text | PASS                                                                     |
| `--text-muted`     | `--bg-base`      |  4.75 : 1 | AA normal text | PASS (after fix, was 2.62 at `#9c9590`)                                  |
| `--text-muted`     | `--bg-surface`   |  5.22 : 1 | AA normal text | PASS (after fix)                                                         |
| `--text-muted`     | `--bg-subtle`    |  5.00 : 1 | AA normal text | PASS (after fix)                                                         |
| `--nav-text`       | `--nav-bg`       | 14.08 : 1 | AA normal text | PASS (AAA)                                                               |
| `--action`         | `--bg-base`      |  9.92 : 1 | AA normal text | PASS (AAA)                                                               |
| `--action`         | `--bg-surface`   | 10.92 : 1 | AA normal text | PASS (AAA)                                                               |
| `--action-hover`   | `--bg-base`      |  6.88 : 1 | AA normal text | PASS                                                                     |
| `white`            | `--action`       | 11.18 : 1 | AA normal text | PASS (AAA)                                                               |
| `white`            | `--action-hover` |  7.75 : 1 | AA normal text | PASS (AAA)                                                               |
| `white`            | `--danger`       |  5.46 : 1 | AA normal text | PASS                                                                     |
| `--score-high`     | `--bg-base`      |  4.67 : 1 | AA normal text | PASS                                                                     |
| `--score-mid`      | `--bg-base`      |  4.59 : 1 | AA normal text | PASS (after fix, was 4.26 at `#8a6f20`)                                  |
| `--score-low`      | `--bg-base`      |  4.85 : 1 | AA normal text | PASS                                                                     |
| `--warning-text`   | `--bg-base`      |  5.37 : 1 | AA normal text | PASS                                                                     |
| `--warning`        | `--bg-base`      |  3.36 : 1 | AA non-text UI | PASS (banner background and icon use only; `--warning-text` covers text) |

**Two token values were adjusted by this audit:**

- **`--text-muted`**: `#9c9590` → `#706a62`. Original value was 2.62:1 on `--bg-base`, which fails even the AA large threshold. `--text-muted` is used for 11px uppercase labels, which WCAG classifies as normal text (4.5:1). The new value clears AA with modest margin and stays visually distinct from `--text-secondary` (`#6b6560`, 5.10:1).
- **`--score-mid`**: `#8a6f20` → `#846a1d`. Original value was 4.26:1, a fraction shy of 4.5:1. The shift is a luminance delta of 0.016 (near-imperceptible) and clears AA normal for use as score tier text.

Both changes are reflected in the canonical `:root` block below.

**`--warning` is not text.** The project provides `--warning-text` (`#7a5f10`, 5.37:1) for text that needs to read as "warning-colored." `--warning` itself (`#e65100`) is the orange used on banner backgrounds, icons, and borders, where the 3:1 non-text-UI threshold applies. Components must use `--warning-text` for text, not `--warning`.

**Audit method.** Ratios computed via the WCAG 2.1 relative-luminance formula in a Python script on 2026-04-11. Values cross-checked against the WebAIM Contrast Checker spot-checks. Re-run the audit whenever a root hex value changes.

**Rule for new tokens.** Any new foreground/background pair must be checked before adoption. Derived backgrounds at 92% white preserve contrast against `--text-primary` in typical use (15-17:1), but "typical use" is not a guarantee, especially for non-primary text colors or saturated accents.

### Dark-mode contrast audit

Audited 2026-04-11 against the `[data-theme="dark"]` override block values. Same WCAG 2.1 method as the light-mode audit.

| Foreground          | Background       |     Ratio | Target         | Status     |
| ------------------- | ---------------- | --------: | -------------- | ---------- |
| `--text-primary`    | `--bg-base`      | 13.86 : 1 | AA normal text | PASS (AAA) |
| `--text-primary`    | `--bg-surface`   | 12.39 : 1 | AA normal text | PASS (AAA) |
| `--text-primary`    | `--bg-subtle`    | 13.00 : 1 | AA normal text | PASS (AAA) |
| `--text-secondary`  | `--bg-base`      |  6.29 : 1 | AA normal text | PASS       |
| `--text-secondary`  | `--bg-surface`   |  5.63 : 1 | AA normal text | PASS       |
| `--text-muted`      | `--bg-base`      |  5.13 : 1 | AA normal text | PASS       |
| `--text-muted`      | `--bg-surface`   |  4.59 : 1 | AA normal text | PASS       |
| `--text-muted`      | `--bg-subtle`    |  4.81 : 1 | AA normal text | PASS       |
| `--nav-text`        | `--nav-bg`       | 14.88 : 1 | AA normal text | PASS (AAA) |
| `--score-color`     | `--bg-base`      |  6.16 : 1 | AA normal text | PASS       |
| `--score-high`      | `--bg-base`      |  5.37 : 1 | AA normal text | PASS       |
| `--score-mid`       | `--bg-base`      |  5.92 : 1 | AA normal text | PASS       |
| `--score-low`       | `--bg-base`      |  5.03 : 1 | AA normal text | PASS       |
| `--bgg-accent`      | `--bg-base`      |  4.84 : 1 | AA normal text | PASS       |
| `--override-accent` | `--bg-base`      |  5.32 : 1 | AA normal text | PASS       |
| `--action`          | `--bg-base`      |  5.18 : 1 | AA normal text | PASS       |
| `--action-hover`    | `--bg-base`      |  6.32 : 1 | AA normal text | PASS       |
| `--on-action`       | `--action`       |  5.18 : 1 | AA normal text | PASS       |
| `--on-action`       | `--action-hover` |  6.32 : 1 | AA normal text | PASS       |
| `--on-danger`       | `--score-low`    |  5.03 : 1 | AA normal text | PASS       |
| `--warning`         | `--bg-base`      |  5.61 : 1 | AA non-text UI | PASS (AAA) |
| `--warning-text`    | `--bg-base`      |  7.91 : 1 | AA normal text | PASS (AAA) |
| `--filter-spec`     | `--bg-base`      |  4.67 : 1 | AA normal text | PASS       |
| `--predict-accent`  | `--bg-base`      |  6.11 : 1 | AA normal text | PASS       |
| `--conf-moderate`   | `--bg-base`      |  6.50 : 1 | AA normal text | PASS       |
| `--conf-weak`       | `--bg-base`      |  4.52 : 1 | AA normal text | PASS       |
| `--text-primary`    | `--success-bg`   | 10.10 : 1 | AA normal text | PASS (AAA) |

**Dark-mode-specific "kept explicit" values:**

- **`--on-action: var(--bg-base)` / `--on-danger: var(--bg-base)`**: Button text tokens. In light mode, buttons use white text on dark action/danger backgrounds. In dark mode, the action/danger colors are lighter (for text-link contrast on dark backgrounds), so button text flips to dark. These tokens bridge the gap.
- **`--success-bg: #1a3828`**: Dark green surface for success feedback, replacing the light-mode `#d5f0e0`.
- **`--warning-subtle: #2e2010`**: Dark warm surface for warning backgrounds.

---

## Enforcement

"No hex values in component CSS" is a rule, and a rule without enforcement is a wish.

**Hex values in component code (manual check).** Before a color-touching PR, run:

```bash
grep -rn '#[0-9a-fA-F]\{3,6\}' packages/web \
  --include='*.tsx' --include='*.ts' --include='*.css' \
  --exclude='globals.css'
```

This covers every TypeScript and CSS file under `packages/web`, not just specific subdirectories, so new folders are caught automatically. Zero matches is the goal. Any match is either a token that should exist in this file but doesn't, or a violation to fix.

**Invalid `color-mix` syntax (manual check).** The previous implementation used `color-mix(in rgb, ..., <pct>%, transparent)`, which is invalid CSS (the correct color space is `srgb` and the percentage must be adjacent to its color). Grep for residue:

```bash
grep -rn 'color-mix(in rgb,' packages/web
```

Zero matches is the goal. Replace any match with the correct form: `color-mix(in srgb, <color> <pct>%, transparent)`.

**Promotion path.** If either manual check surfaces drift more than once, promote it to a pre-commit hook or a CI step. Until then, the rule lives in PR review.

**Adding tokens.** A PR that adds a color token must also update this file. A token that exists in `globals.css` but not here is undocumented state.

---

## The canonical `:root` block

This is the authoritative color token block. The existing `:root` color section in `globals.css` should match this exactly. Non-color tokens (typography scale, spacing) are unrelated and live elsewhere in the same file.

```css
:root {
  /* ── Neutral surfaces ─────────────────────────────────────── */
  --bg-base: #f4f1ec; /* page background, warm parchment */
  --bg-surface: #fefcf9; /* cards, panels */
  --bg-elevated: #ffffff; /* modals, popovers */
  --bg-subtle: #f9f7f4; /* warm-tinted inset areas */
  --bg-muted: #f5f5f5; /* neutral-gray inset, exception case */
  --border: #ddd8d0;
  --border-strong: #c4bfb8;
  --row-hover: #f0ede8;
  --table-header-bg: #ede9e3;

  /* ── Text ─────────────────────────────────────────────────── */
  --text-primary: #1a1714;
  --text-secondary: #6b6560;
  --text-muted: #706a62; /* darkened from #9c9590 for WCAG AA; see Contrast requirements */

  /* ── Score spectrum (tiered-scale domain) ────────────────── */
  --score-color: #b86c1a; /* hero display accent, "precious amber" */
  --score-high: #2d7a4a; /* tier indicator: 7.5-10.0 */
  --score-mid: #846a1d; /* tier indicator: 5.0-7.4 (darkened from #8a6f20 for WCAG AA) */
  --score-low: #b84040; /* tier indicator: 1.0-4.9 */

  --score-bg: color-mix(in hsl, var(--score-color), white 92%);
  --score-high-bg: color-mix(in hsl, var(--score-high), white 92%);
  --score-mid-bg: color-mix(in hsl, var(--score-mid), white 93%);
  --score-low-bg: color-mix(in hsl, var(--score-low), white 93%);
  --score-border: color-mix(in hsl, var(--score-color), white 75%);
  --score-mid-border: color-mix(in hsl, var(--score-mid), white 78%);
  --score-low-border: color-mix(in hsl, var(--score-low), white 79%);
  /* Note: --score-high-border is intentionally absent; no current surface uses it.
     Add if needed: color-mix(in hsl, var(--score-high), white 78%). */

  /* ── Status ───────────────────────────────────────────────── */
  --success: var(--score-high); /* alias: same concept */
  --success-bg: #d5f0e0; /* kept explicit: deeper green for prominent feedback */
  --success-subtle: var(--score-high-bg); /* alias */
  --warning: #e65100;
  --warning-subtle: #fff3e0;
  --warning-border: #e8d060;
  --warning-text: #7a5f10;
  --danger: var(--score-low); /* alias */
  --danger-subtle: var(--score-low-bg); /* alias */
  --danger-border: color-mix(in hsl, var(--score-low), white 75%);

  /* ── Data source languages (single-accent domains) ──────── */
  --personal-accent: var(--text-primary); /* personal data = default text */
  --bgg-accent: #2e5f8a;
  --bgg-bg: color-mix(in hsl, var(--bgg-accent), white 92%);
  --bgg-border: color-mix(in hsl, var(--bgg-accent), white 78%);
  --bgg-badge-bg: color-mix(in hsl, var(--bgg-accent), white 85%);
  --override-accent: #5c3d99;
  --override-bg: color-mix(in hsl, var(--override-accent), white 94%);
  --override-border: color-mix(in hsl, var(--override-accent), white 78%);
  --override-badge-bg: color-mix(in hsl, var(--override-accent), white 85%);

  /* ── Action (primary interactive color) ──────────────────── */
  --action: #1c3d5e;
  --action-hover: #2a5580; /* kept explicit: accessibility-contrast control */
  --action-subtle: color-mix(in hsl, var(--action), white 93%);
  --action-border: color-mix(in hsl, var(--action), white 77%);

  /* ── Navigation ───────────────────────────────────────────── */
  --nav-bg: var(--text-primary);
  --nav-text: #e8e4dc;
  --nav-active: var(--score-color);

  /* ── Filter spec (single-accent domain) ──────────────────── */
  --filter-spec: #4a6e42;
  --filter-spec-bg: color-mix(in hsl, var(--filter-spec), white 92%);
  --filter-spec-border: color-mix(in hsl, var(--filter-spec), white 78%);

  /* ── Prediction (single-accent domain) ───────────────────── */
  --predict-accent: #1a706a;
  --predict-bg: color-mix(in hsl, var(--predict-accent), white 92%);
  --predict-border: color-mix(in hsl, var(--predict-accent), white 75%);

  /* ── Confidence levels (tiered-scale domain) ─────────────── */
  --conf-strong: var(--score-high);
  --conf-strong-bg: var(--score-high-bg);
  --conf-moderate: #7a5e1a; /* kept explicit; see rationale below */
  --conf-moderate-bg: color-mix(in hsl, var(--conf-moderate), white 92%);
  --conf-weak: #8a3a10;
  --conf-weak-bg: color-mix(in hsl, var(--conf-weak), white 92%);
  --conf-insufficient: var(--text-muted);
  --conf-insufficient-bg: var(--row-hover);

  /* ── Outlier tags (aliases to semantic colors) ───────────── */
  --outlier-lone: var(--override-accent);
  --outlier-lone-bg: var(--override-bg);
  --outlier-lone-border: var(--override-border);
  --outlier-orphan: var(--score-mid);
  --outlier-orphan-bg: var(--score-mid-bg);
  --outlier-orphan-border: var(--score-mid-border);
  --outlier-fitness: var(--score-high);
  --outlier-fitness-bg: var(--score-high-bg);
  --outlier-fitness-border: color-mix(in hsl, var(--score-high), white 78%);

  /* ── Tournament (aliases to BGG palette) ─────────────────── */
  --tourney-accent: var(--bgg-accent);
  --tourney-bg: var(--bgg-bg);

  /* ── UI surface tokens ────────────────────────────────────── */
  --suggest-bg: var(--bg-subtle);
  --suggest-border: var(--border-strong);
  --overlay-bg: rgb(0 0 0 / 0.5);
  --placeholder-from: var(--nav-text);
  --placeholder-to: #d0cbc0;

  /* ── Shadows ──────────────────────────────────────────────── */
  --shadow-menu: 0 8px 32px rgb(0 0 0 / 0.14), 0 2px 8px rgb(0 0 0 / 0.08);

  /* ── Sidebar (light-on-dark overlays) ────────────────────── */
  --sidebar-divider: color-mix(in srgb, var(--nav-text) 8%, transparent);
  --sidebar-item-hover-bg: color-mix(in srgb, var(--nav-text) 6%, transparent);
  --sidebar-track-bg: color-mix(in srgb, var(--nav-text) 10%, transparent);
}
```

---

## Kept explicit despite being near-derivable

A few tokens stay as hex values even though they could be aliased or derived. Each has a reason.

**`--action-hover: #2a5580`.** Hover states need precise contrast control against both the hover background and any text sitting on top. Kept explicit so it can be tuned independently of `--action`.

**`--success-bg: #d5f0e0`.** Deeper green than `var(--score-high-bg)` would produce. Used for prominent success feedback (toast banners, confirmation flashes) where a stronger read is needed than the subtle score-tier background.

**`--score-mid` (`#8a6f20`) and `--conf-moderate` (`#7a5e1a`).** These are visually similar ambers that sit on different semantic axes. `--score-mid` indicates a mid-range fitness score; `--conf-moderate` indicates moderate confidence in a value. They happen to currently render close to each other, but the project wants the freedom to shift them apart later without coupling the two concepts. Documented near-duplicate, not a bug.

**`--bg-subtle` (warm) and `--bg-muted` (neutral gray).** Subtle is warm-tinted, consistent with the parchment palette. Muted is neutral gray, used only in the one place where warm would look wrong. Keeping both forces an explicit choice instead of a warm-by-default creep into a gray-needed context.

---

## Rules for adding new tokens

1. **Check first.** Before adding a token, verify no existing token serves the purpose.
2. **Classify the domain.** Is it single-accent, tiered-scale, or application-wide UI plumbing? Follow the vocabulary for that archetype.
3. **Single-accent domains get the standard vocabulary.** `-accent` (hex), `-bg` (derived), `-border` (derived), optionally `-badge-bg` (derived). No additional tokens without justification.
4. **No hex values in component CSS.** If a component needs a color that does not have a token, add the token here first.
5. **Near-duplicates are usually bugs.** If a new hex value is visually indistinguishable from an existing one in similar contexts, alias instead.
6. **Near-duplicates are sometimes intentional signals.** If two values are close but belong to independent semantic axes the project wants the freedom to shift apart, keep them distinct and document the reason in the "Kept explicit" section above. An undocumented near-duplicate is a bug; a documented one is a decision.
7. **Derivation by default for variants.** Background washes and borders should be `color-mix()` derivations unless you have a specific accessibility or design reason to tune them independently.
8. **Update this file in the same PR.** A token that exists in `globals.css` but not here is undocumented state.
