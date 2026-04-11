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

Shelf Judge is a single-user, single-theme app. It uses **architecture B** from the principles doc: hex roots live directly in semantic tokens, with derivations and aliases on top. There is no primitive palette and no theme-switching layer.

The three kinds of value in the system:

- **Explicit (hex) roots.** The only values that require a designer decision to change.
- **Derivations.** `color-mix()` variants of a root (backgrounds, borders, badge backgrounds).
- **Aliases.** `var()` references that express "these two concepts share a color."

Components reference tokens by name. No hex values appear in component CSS.

---

## Domain archetypes

The system has three kinds of color domain. Each follows a different vocabulary, and each is justified differently.

### 1. Single-accent domains

One canonical hue with derived variants. These follow the standard domain vocabulary:

| Suffix      | Purpose                                         | Source                                          |
| ----------- | ----------------------------------------------- | ----------------------------------------------- |
| `-accent`   | Canonical color for text, icons, strong borders | Explicit hex                                    |
| `-bg`       | Light background wash                           | `color-mix(in hsl, var(--X-accent), white 92%)` |
| `-border`   | Medium outline                                  | `color-mix(in hsl, var(--X-accent), white 78%)` |
| `-badge-bg` | Slightly stronger background for inline badges  | `color-mix(in hsl, var(--X-accent), white 85%)` |

Domains in this archetype:

- **BGG** (`--bgg-*`): community-sourced data
- **Override** (`--override-*`): user overrides of BGG values
- **Prediction** (`--predict-*`): predicted ratings
- **Filter spec** (`--filter-spec-*`): active filter indicators
- **Tournament** (`--tourney-*`): aliases to BGG since tournament data is BGG-sourced

Not every domain needs `-badge-bg`. `-accent`, `-bg`, and `-border` are the minimum.

### 2. Tiered-scale domains

A semantic gradient where each tier is its own root. Each tier uses single-accent-style derivations, but the domain has no single "accent" because the whole point is the gradient.

| Domain                | Roots                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------- |
| **Score spectrum**    | `--score-high`, `--score-mid`, `--score-low`, plus `--score-color` as the hero display accent |
| **Confidence levels** | `--conf-strong`, `--conf-moderate`, `--conf-weak`, `--conf-insufficient`                      |

Tiered-scale roots alias cross-domain when the semantics match (`--conf-strong: var(--score-high)`). Aliasing is preferred over new hex values when the visual concept is the same.

### 3. Application-wide UI plumbing

Neutrals, text, action states, navigation, and status feedback. These are not bounded domains but cross-cutting concerns, so they use ad-hoc vocabularies.

| Group            | Tokens                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Neutrals**     | `--bg-base`, `--bg-surface`, `--bg-elevated`, `--bg-subtle`, `--bg-muted`, `--border`, `--border-strong`, `--row-hover`, `--table-header-bg` |
| **Text**         | `--text-primary`, `--text-secondary`, `--text-muted`                                                                                         |
| **Action**       | `--action`, `--action-hover`, `--action-subtle`, `--action-border`                                                                           |
| **Status**       | `--success`, `--warning`, `--danger` and variants                                                                                            |
| **Navigation**   | `--nav-bg`, `--nav-text`, `--nav-active`                                                                                                     |
| **Outlier tags** | `--outlier-lone`, `--outlier-orphan`, `--outlier-fitness` and variants                                                                       |

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

Text tokens must meet WCAG AA (4.5:1 for normal text, 3:1 for text at 18px+ / 14px+ bold) against the background they sit on. The combinations in active use:

| Foreground               | Background                                 | Required  | Used for                              |
| ------------------------ | ------------------------------------------ | --------- | ------------------------------------- |
| `--text-primary`         | `--bg-base`, `--bg-surface`, `--bg-subtle` | AA normal | Body text                             |
| `--text-secondary`       | `--bg-base`, `--bg-surface`                | AA normal | Supporting text                       |
| `--text-muted`           | `--bg-base`, `--bg-surface`                | AA large  | Labels, hints (only at 15px+)         |
| `--nav-text`             | `--nav-bg`                                 | AA normal | Sidebar navigation                    |
| `--action`               | `--bg-base`, `--bg-surface`                | AA normal | Link text                             |
| `white`                  | `--action`, `--danger`                     | AA normal | Primary and destructive button labels |
| `--score-high/-mid/-low` | `--bg-base`                                | AA normal | Score tier text                       |

> **Unverified.** This table names the combinations that exist; a contrast audit has not been run. Before the next color-touching PR: measure each row with a real contrast checker and either confirm the claim or tune the affected tokens. Hover states (`--action-hover`) are kept as explicit hex (not derived) specifically so they can be adjusted for contrast independently of `--action`.

**Rule for new tokens.** Any new foreground/background pair must be checked before adoption. Derived backgrounds at 92% white preserve contrast against warm near-black text in typical use, but "typical use" is not a guarantee.

---

## Enforcement

"No hex values in component CSS" is a rule, and a rule without enforcement is a wish.

**Current check (manual).** Before a color-touching PR, run:

```bash
grep -rn '#[0-9a-fA-F]\{3,6\}' packages/web/app packages/web/components \
  --include='*.tsx' --include='*.css' --exclude='globals.css'
```

Zero matches is the goal. Any match is either a token that should exist in this file but doesn't, or a violation to fix.

**Promotion path.** If the manual grep surfaces drift more than once, promote it to a pre-commit hook or a CI step. Until then, the rule lives in PR review.

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
  --text-muted: #9c9590;

  /* ── Score spectrum (tiered-scale domain) ────────────────── */
  --score-color: #b86c1a; /* hero display accent, "precious amber" */
  --score-high: #2d7a4a; /* tier indicator: 7.5-10.0 */
  --score-mid: #8a6f20; /* tier indicator: 5.0-7.4 */
  --score-low: #b84040; /* tier indicator: 1.0-4.9 */

  --score-bg: color-mix(in hsl, var(--score-color), white 92%);
  --score-high-bg: color-mix(in hsl, var(--score-high), white 92%);
  --score-low-bg: color-mix(in hsl, var(--score-low), white 93%);
  --score-border: color-mix(in hsl, var(--score-color), white 75%);
  --score-mid-border: color-mix(in hsl, var(--score-mid), white 78%);
  --score-low-border: color-mix(in hsl, var(--score-low), white 79%);

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
  --outlier-orphan-bg: color-mix(in hsl, var(--score-mid), white 93%);
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
  --sidebar-divider: color-mix(in rgb, var(--nav-text), 8%, transparent);
  --sidebar-item-hover-bg: color-mix(in rgb, var(--nav-text), 6%, transparent);
  --sidebar-track-bg: color-mix(in rgb, var(--nav-text), 10%, transparent);
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
