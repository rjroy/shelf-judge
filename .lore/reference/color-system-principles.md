---
title: Color System Principles
status: current
tags: [design, reference, portable, css, color]
date: 2026-04-11
related:
  - .lore/designs/shelf-judge-color-system.md
---

# Color System Principles

A reference for how to design and maintain a CSS custom property color system that stays coherent as a project grows.

---

## The core problem

Color variables accumulate. A feature ships and adds three new hex values. Another feature ships and adds four more. Nobody checks whether something nearby already serves the purpose. Six months later you have 80+ color variables and no one can say with confidence which one to use for a new component.

The fix is a strict separation between _color identity_ (where a value comes from) and _color usage_ (where it gets applied). Every value in the system is one of three kinds: an explicit hex root, a derivation from a root, or an alias to another token. Components only touch the usage layer.

---

## Two architectures

There are two valid ways to build this system. The choice turns on whether you need theming.

### A. Primitive palette + semantic aliases

Use when the product needs dark mode, branded themes, or high-contrast variants.

The primitive palette is a set of named color scales, structured grids of shades per hue.

```css
/* Primitive layer, never referenced by components */
--blue-50: #e6f1fb;
--blue-200: #85b7eb;
--blue-600: #185fa5;
--blue-800: #0c447c;
```

Semantic tokens alias specific primitive stops and name them by purpose:

```css
--color-background-info: var(--blue-50);
--color-border-info: var(--blue-200);
--color-text-info: var(--blue-800);
```

Theme switching redefines the primitives inside a `[data-theme="dark"]` block (or equivalent). The semantic layer is the stable contract; the primitive layer is the swappable identity. Components never touch primitives directly, because that would break theme switching.

This architecture is real work. The strict "components never touch primitives" rule exists to make theming reliable. Without a theming reason, the rule is ceremony.

### B. Semantic roots with derivations

Use for single-theme apps.

Hex values live directly in semantic tokens. Variants are derived from them via `color-mix()` or aliased via `var()`.

```css
--bgg-accent: #2e5f8a; /* the root */
--bgg-bg: color-mix(in hsl, var(--bgg-accent), white 92%);
--bgg-border: color-mix(in hsl, var(--bgg-accent), white 78%);
```

One layer, fewer variables, the root and its variants live together. A brand refresh changes `--bgg-accent` and the derivations follow.

The trade-off: switching themes means editing every root, not flipping one variable. For a single-user, single-theme app this is fine. For a product with dark mode on the roadmap, it is a migration you will regret putting off.

### The rest of this document applies to both

In architecture A, "root" means "primitive stop." In architecture B, "root" means "hex-valued semantic token." The rules about derivation, aliasing, naming, and red flags apply the same way to both.

---

## Aliases, derivations, explicit values

Every value in the system is one of three kinds.

**Explicit (hex) roots.** Values that define the color identity of a domain or concept. These are the values a designer edits during a brand refresh.

**Aliases** (`var(--other-token)`). Use when two conceptually distinct things share a color. The alias makes the relationship visible and keeps the concepts in sync.

```css
--danger: var(--score-low); /* danger IS the score-low red */
--conf-strong: var(--score-high); /* strong confidence = high score green */
```

**Derivations** (`color-mix()`). Use for predictable light/dark variants of a root. Backgrounds at 90-93% white, borders at 75-80% white. These should never need tuning separately from their source.

**When to stay explicit instead of deriving.** Hover states often need precise contrast control. A "precious" color that defines the app's character (a hero accent) should stay a real hex value even if its variants are derived. Any color where the exact value matters to the design read, not just the structural relationship.

---

## Domain vocabularies

Real systems have two archetypes of color domain, and they want different vocabularies.

### Single-accent domains

One canonical color with derived variants. Use the same suffix vocabulary across every domain of this type:

```css
--bgg-accent     /* the hex root */
--bgg-bg         /* background wash (derived, ~92% white) */
--bgg-border     /* outline (derived, ~78% white) */
--bgg-badge-bg   /* badge background (derived, ~85% white) */
```

Every single-accent domain follows this vocabulary. A developer knows that if a domain exists, it has an `-accent`, a `-bg`, and a `-border`, with no guessing required. The predictability is the point.

### Tiered-scale domains

A semantic gradient like score levels, confidence levels, or heatmap buckets. Each tier is its own root with its own variants:

```css
--score-high: #2d7a4a;
--score-mid: #8a6f20;
--score-low: #b84040;

--score-high-bg: color-mix(in hsl, var(--score-high), white 92%);
--score-mid-bg: color-mix(in hsl, var(--score-mid), white 92%);
--score-low-bg: color-mix(in hsl, var(--score-low), white 93%);
```

Tiered-scale domains do not fit the `-accent` pattern because there is no single accent. The convention is that each tier shares the domain's prefix and follows the single-accent suffix rules internally.

Tiered-scale roots can alias cross-domain when the semantics match (`--conf-strong: var(--score-high)`). Aliasing is preferred over new hex values when the visual concept is the same.

---

## Naming

Names answer _what is this for_, not _what does it look like_.

```css
/* Bad, describes appearance */
--light-blue-bg: #e6f1fb;
--dark-blue-text: #0c447c;

/* Good, describes purpose */
--color-background-info: #e6f1fb;
--color-text-info: #0c447c;
```

Good patterns: `--{property}-{context}` (`--color-text-info`) or `--{domain}-{role}` (`--bgg-accent`). Pick one pattern per project and keep it.

**Never name tokens after components.** `--modal-bg` and `--sidebar-text` couple the token to an implementation. A modal that becomes a popover has to rename its tokens. A sidebar that gets reused in a different context drags its naming along. Name by role.

---

## Size targets

The only measurement that matters is the count of **explicit hex roots**, the values a designer has to think about during a refresh. Aliases and derivations are free; they carry no maintenance cost once the root is set.

Rough targets for explicit-root count:

| Complexity   | Roots | What fits                                                                             |
| ------------ | ----- | ------------------------------------------------------------------------------------- |
| **Simple**   | 12-20 | Neutrals, brand, status (success/warning/danger)                                      |
| **Standard** | 20-30 | Adds domain distinctions, action states, a hero accent                                |
| **Complex**  | 30-45 | Adds multiple data provenance languages, tiered scales, prediction/confidence systems |

Going above this range is legitimate only if each additional root earns its place. A new root that could have been an alias or derivation is waste.

The total token count (roots + aliases + derivations) is not a useful metric. A system with 30 roots and 60 aliases is healthier than one with 50 roots and 10 aliases.

---

## Red flags

- **Two tokens that could be used interchangeably in the same context.** Consolidate. Exception: see "near-duplicates" below.
- **Tokens named after a component.** Couples the token to an implementation. Name by purpose.
- **Near-duplicate hex values that are not intentional.** If you cannot tell two colors apart side by side and they are used in similar contexts, one should alias to the other. Perceptual similarity, not channel distance, is the test.
- **Near-duplicates that _are_ intentional.** Sometimes two colors are close but belong to independent semantic axes the project wants the freedom to shift apart later. Keep them distinct and document the reason in the spec. An undocumented near-duplicate is a bug; a documented one is a decision.
- **Hex values inside component CSS.** Any hardcoded color in a component stylesheet is a token that did not get created.
- **Single-accent domains that have grown past the standard vocabulary.** If a domain has `-accent`, `-bg`, `-border`, `-badge-bg`, `-text`, `-hover`, ask whether the new ones should be derivations, aliases, or belong to a different domain entirely.

---

## Enforcement

Rules without enforcement are wishes. Pick at least one:

- **Lint rule.** Stylelint's `color-no-hex` flags any hex value in component CSS. Allow it only in the token definition file.
- **Grep gate.** A CI step that fails if hex values appear outside the designated color config file.
- **Manual audit.** A checklist line in the PR template: "no new hex values in components."

A color rule that no one enforces is indistinguishable from no rule.

---

## How to audit an existing system

1. Extract every color variable. Separate them into explicit hex, derivations, and aliases.
2. Group the explicit hex values by hue family. Near-duplicates within a family are consolidation candidates. Verify visually, not by channel math.
3. For each group, identify the root (the "truest" or most-used value). Other values in the group become aliases or derivations of it.
4. Classify each token's domain: single-accent, tiered-scale, or application-wide UI plumbing. Check that single-accent domains follow the standard vocabulary.
5. Check every token name: can a developer pick the right one without looking it up? If not, the naming or the count is wrong.
6. Grep components for hex values. Any you find are tokens that should exist but do not.
7. Recount explicit hex roots. If the count is above the range for your app's complexity, identify the least-justified ones.
