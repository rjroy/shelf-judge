---
title: "Implementation plan: dark-mode"
date: 2026-04-11
status: executed
tags: [plan, web-ui, css, color]
modules: [web]
related:
  - .lore/issues/ui/dark-mode.md
  - .lore/designs/shelf-judge-color-system.md
  - .lore/reference/color-system-principles.md
  - .lore/designs/visual-direction.md
  - .lore/plans/ui/visual-transition.md
---

# Plan: Dark Mode

## Goal

Add a dark mode toggle to Shelf Judge. The user clicks a toggle in the navigation area to switch between light and dark themes. The preference persists across sessions via localStorage and defaults to the system preference (`prefers-color-scheme`) on first visit.

Dark mode is implemented entirely through CSS custom property overrides. No component code changes are needed for color, because the visual-transition plan already ensured all colors are referenced via `var()` tokens.

### Constraints

- **Preserve warmth.** The visual direction defines Shelf Judge as "ink on quality cardboard stock." Dark mode must feel like the same notebook in dim light, not a different app. Warm dark neutrals, not cold grays.
- **Architecture B stays.** The color system uses Architecture B (semantic roots with derivations). Dark mode is implemented via a `[data-theme="dark"]` override block on `:root`, not a full migration to Architecture A's primitive palette. The `color-mix()` derivations and `var()` aliases cascade automatically when roots are overridden, so only the ~31 explicit hex roots need dark equivalents.
- **WCAG AA.** All dark-mode foreground/background pairings must meet the same contrast targets documented in the color system spec: 4.5:1 for normal text, 3:1 for large text and non-text UI.
- **No component CSS changes for color.** Components reference semantic tokens. The theme switch happens at the token definition layer only. Component changes are limited to the toggle UI itself.

## Codebase Context

**Post-migration baseline.** The color system consolidation (2026-04-11) replaced the `:root` color block with the canonical block from the color system spec, fixed all `color-mix(in rgb, ...)` syntax to `color-mix(in srgb, ...)`, and eliminated hard-coded hex values from components. The numbers and analysis below reflect the post-migration state.

### Color system (`packages/web/app/globals.css:1-118`)

The `:root` block contains 77 color tokens organized into three kinds:

- **~31 explicit hex roots** (e.g. `--bg-base: #f4f1ec`, `--bgg-accent: #2e5f8a`). These are the only values that need dark equivalents.
- **~26 derivations** via `color-mix()` (e.g. `--bgg-bg: color-mix(in hsl, var(--bgg-accent), white 92%)`). These auto-adapt when roots change. In dark mode, the "white 92%" formula inverts poorly (mixing toward white on a dark background produces washed-out pastels). These derivations need to be overridden to mix toward the dark background or use opacity-based alternatives. Post-migration, the derivation pattern is systematic: `-bg` at 92%, `-border` at 75-79%, `-badge-bg` at 85%. The dark overrides can follow an equally systematic pattern (see Derivation problem below).
- **~24 aliases** via `var()` (e.g. `--danger: var(--score-low)`). These cascade automatically and require no overrides. The migration increased the alias count by converting near-duplicate hex values to aliases (e.g. `--success` now references `var(--score-high)` instead of a separate `#2e7d32`).

### Derivation problem

The `color-mix(in hsl, <root>, white 92%)` pattern creates light washes by mixing toward white. In dark mode, this produces pale pastels on dark backgrounds, which looks wrong and fails contrast. The override block must redefine derivations to produce appropriate dark-mode variants: either mixing toward a dark base color, using reduced-opacity tints, or providing explicit hex values.

Two approaches for dark derivations:

1. **Mix toward dark base**: `color-mix(in hsl, var(--bgg-accent), var(--bg-base) 85%)` produces a subtle tint of the accent against the dark background. Keeps the derivation pattern consistent.
2. **Explicit hex per derivation**: More control, but doubles the maintenance surface.

Approach 1 is preferred because it preserves the Architecture B derivation pattern and auto-adapts if roots change.

### Sidebar component (`packages/web/components/sidebar.tsx`)

- `SidebarProvider` at lines 121-161: React context for sidebar open/close state. Pattern to replicate for theme.
- `Sidebar` at lines 163-257: Desktop nav. The sidebar footer (line 257) contains only "Shelf Judge v0.1" and is the natural location for a theme toggle.
- `MobileHeader` at lines 262-275: Mobile nav bar with hamburger + brand name. Space on the right side for a toggle button.

### Sidebar is already dark

The sidebar uses `--nav-bg: var(--text-primary)` (dark background) with `--nav-text: #e8e4dc` (light text). In dark mode, the sidebar colors likely need minimal change, or the relationship inverts differently. The sidebar's light-on-dark overlay tokens (`--sidebar-divider`, `--sidebar-item-hover-bg`, `--sidebar-track-bg`) use `color-mix(in srgb, var(--nav-text) N%, transparent)` which will cascade if `--nav-text` changes. Note: these `color-mix` expressions now use the correct `in srgb` syntax (the migration fixed the broken `in rgb` form), so the sidebar overlays actually render for the first time. Any dark-mode work inherits a working baseline.

### localStorage patterns (`packages/web/lib/collection-utils.ts`)

Established pattern: `loadXxx()` / `saveXxx()` functions with SSR guard (`typeof window === "undefined"`), try/catch, and state loaded in `useEffect` after mount to avoid hydration mismatch.

### CSS file structure

Single CSS file: `packages/web/app/globals.css` (~5,500 lines). All tokens, component styles, and responsive rules live here.

## Implementation Steps

### Step 1: Define dark-mode color tokens

**Files**: `packages/web/app/globals.css`
**Expertise**: Color design (contrast auditing)

Add a `[data-theme="dark"]` block after the existing `:root` block (after line 118 in `globals.css`). Override the ~31 explicit hex roots with dark equivalents. Override the ~26 `color-mix()` derivations to mix toward the dark base instead of white. The light-mode palette is finalized (the color system migration landed 2026-04-11), so dark-mode roots can be designed against the current values.

The dark palette design:

**Neutrals.** Warm dark tones:

- `--bg-base`: warm charcoal (e.g. `#1a1916` or similar, not `#121212` cold gray)
- `--bg-surface`: slightly lighter warm dark (e.g. `#242320`)
- `--bg-elevated`: one more step (e.g. `#2e2d29`)
- `--bg-subtle`, `--bg-muted`: intermediate warm darks
- `--border`, `--border-strong`: warm mid-tone borders
- `--row-hover`, `--table-header-bg`: subtle warm variations

**Text.** Flip to light-on-dark:

- `--text-primary`: warm off-white (e.g. `#e8e4dc`, similar to current `--nav-text`)
- `--text-secondary`: medium warm gray
- `--text-muted`: darker warm gray (must still clear 4.5:1 on dark backgrounds)

**Accent colors.** Score spectrum, data-provenance accents, action, filter-spec, prediction, confidence: these hues stay recognizable but may need luminance adjustments for contrast on dark backgrounds. The score-color amber, bgg-accent blue, override-accent purple should retain their hue identity.

**Navigation.** The sidebar is already dark. In dark mode, it should either stay the same (if it's darker than the new base) or shift subtly to maintain the visual hierarchy of sidebar-darker-than-content.

**Status colors.** `--warning`, `--success-bg`, etc. may need luminance tweaks for dark backgrounds. In particular, the "kept explicit" tokens from the color system spec (`--success-bg: #d5f0e0`, `--warning-subtle: #fff3e0`, `--action-hover: #2a5580`, `--conf-moderate: #7a5e1a`, `--placeholder-to: #d0cbc0`) are explicit hex values that will not auto-adapt through any cascade. Audit each one against dark backgrounds and override as needed.

**Placeholder gradients.** `--placeholder-from` aliases `var(--nav-text)`, and `--placeholder-to` is `#d0cbc0`. In light mode these produce a dark-to-lighter gradient for game thumbnails. In dark mode, if `--nav-text` stays light (see Step 5), both ends of the gradient become light-on-dark, producing a washed-out result. Override both `--placeholder-from` and `--placeholder-to` in the dark block to produce a subtle gradient appropriate for dark surfaces.

**Derivations.** Override the ~26 `color-mix()` lines to use `color-mix(in hsl, <accent>, var(--bg-base) 85%)` (or similar ratio) instead of mixing toward white. The post-migration derivation vocabulary is systematic (`-bg` at 92%, `-border` at 75-79%, `-badge-bg` at 85%), so the dark equivalents can follow a similarly mechanical pattern: replace `white` with `var(--bg-base)` and adjust ratios for appropriate subtlety on dark surfaces.

**Shadows.** `--shadow-menu` may need stronger opacity on dark backgrounds to remain visible.

**Overlay.** `--overlay-bg` (`rgb(0 0 0 / 0.5)`) may work as-is or need adjustment.

All values must be contrast-audited before shipping. Use the same WCAG 2.1 relative-luminance method documented in the color system spec.

### Step 2: Create theme context and persistence

**Files**: `packages/web/lib/theme.ts` (new), `packages/web/components/theme-provider.tsx` (new)
**Expertise**: React, SSR hydration

**`packages/web/lib/theme.ts`**: Theme persistence utilities.

```
type Theme = "light" | "dark" | "system"
```

- `loadTheme(): Theme` -- reads from `localStorage` key `shelf-judge-theme`. Returns `"system"` if absent or invalid. SSR guard: returns `"system"` on server.
- `saveTheme(theme: Theme): void` -- writes to localStorage. Try/catch for storage-full.
- `resolveTheme(theme: Theme): "light" | "dark"` -- if `"system"`, check `window.matchMedia("(prefers-color-scheme: dark)")`. Returns resolved value.

**`packages/web/components/theme-provider.tsx`**: React context provider.

- `ThemeContext` with `{ theme: Theme, resolvedTheme: "light" | "dark", setTheme: (t: Theme) => void }`.
- `ThemeProvider` component:
  - Loads saved theme in `useEffect` (post-mount, like sidebar pattern).
  - Sets `document.documentElement.dataset.theme` to the resolved value (`"light"` or `"dark"`).
  - Listens to `matchMedia` change event so `"system"` preference tracks OS changes in real time.
  - Saves to localStorage on change.
- Export `useTheme()` hook.

**Hydration concern**: The initial server render has no theme preference. The `[data-theme]` attribute is set client-side after mount. This causes a flash of light theme on first dark-mode load. Mitigation: add an inline `<script>` in `layout.tsx` `<head>` that reads localStorage and sets `data-theme` before paint, similar to next-themes' approach. This script runs before React hydration and prevents the flash.

### Step 3: Add theme provider to app layout

**Files**: `packages/web/app/layout.tsx`

Wrap the app shell with `ThemeProvider`, inside `SidebarProvider` (theme doesn't depend on sidebar state, but the toggle lives inside the sidebar component, so it needs access to `useTheme`).

Add the inline anti-flash script to `<head>`. In Next.js App Router, `layout.tsx` is a Server Component; place a `<script>` element with a static inline string as a direct child of `<head>`, before `<body>`. This runs before React hydration and prevents a flash of the wrong theme. The content is a hardcoded string literal with no user input, so there is no XSS risk. The ThemeProvider's `matchMedia` listener handles subsequent OS preference changes at runtime; the script only handles the initial paint.

```js
(function () {
  try {
    var t = localStorage.getItem("shelf-judge-theme");
    var dark =
      t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (e) {}
})();
```

### Step 4: Add toggle UI to sidebar and mobile header

**Files**: `packages/web/components/sidebar.tsx`, `packages/web/app/globals.css`

**Sidebar toggle (desktop)**: Add a theme toggle button in the sidebar footer area (after the version string). The toggle cycles through three states: light, dark, system. Display as an icon (sun/moon/monitor) with the current mode label. Use `useTheme()` to read and set. Note: `localStorage` stores the user's choice (`"light"` | `"dark"` | `"system"`), but `data-theme` on the document only ever holds the resolved value (`"light"` | `"dark"`). Never set `data-theme="system"`.

**Mobile header toggle**: Add the same toggle icon button to the right side of the mobile header bar, after the brand name.

**CSS**: Style the toggle button to match the sidebar's existing visual language (light-on-dark in the sidebar, standard in mobile header). Add dark-mode overrides for the mobile header's own background and text if needed.

### Step 5: Handle sidebar color relationship in dark mode

**Files**: `packages/web/app/globals.css`

The sidebar is currently always dark (`--nav-bg: var(--text-primary)`). In dark mode, `--text-primary` flips to light, so the alias chain breaks: the sidebar would get a light background.

Two options:

1. Override `--nav-bg` in the dark block to an explicit dark value (darker than `--bg-base` in dark mode).
2. Make the sidebar slightly lighter than the content area in dark mode (reversed hierarchy).

Option 1 is safer: the sidebar should remain the darkest element in both themes for visual consistency. Override `--nav-bg` explicitly in the `[data-theme="dark"]` block to a value darker than the dark `--bg-base`. **`--nav-text` retains its current value (`#e8e4dc`)** because the sidebar remains dark in both themes and needs light text. The sidebar overlay tokens (`--sidebar-divider`, `--sidebar-item-hover-bg`, `--sidebar-track-bg`) use `color-mix(in srgb, var(--nav-text) N%, transparent)`, so they cascade correctly as long as `--nav-text` stays light.

### Step 6: Contrast audit

**Files**: None (verification step)
**Expertise**: Accessibility, color contrast

Run the same WCAG 2.1 relative-luminance audit documented in the color system spec, but against the dark-mode pairings. Produce a contrast table matching the format in the "Contrast requirements" section of `shelf-judge-color-system.md`. Fix any failures before merging.

Key pairings to check:

- `--text-primary` / `--text-secondary` / `--text-muted` on `--bg-base`, `--bg-surface`, `--bg-subtle`
- All accent colors on their respective `-bg` derivations
- `--nav-text` on `--nav-bg` (dark sidebar persists)
- `--action` and `--action-hover` on dark surfaces
- `--warning-text` on dark surfaces
- Score spectrum colors as text on dark backgrounds
- White text on `--action`, `--danger` buttons

### Step 7: Update color system documentation

**Files**: `.lore/designs/shelf-judge-color-system.md`

Update the color system spec to:

- Remove the statement "Shelf Judge is a single-user, single-theme app" and replace with the current reality.
- Reframe the Architecture B section: the system remains Architecture B but accommodates dark mode via a `[data-theme="dark"]` override block. This is not Architecture A (no primitive palette layer was introduced). Clarify that Architecture B can support a second theme when the override surface is limited to the ~31 hex roots and ~26 derivations.
- Add the dark-mode contrast audit table alongside the existing light-mode table.
- Document the derivation strategy change (mix toward dark base instead of white).
- Note any dark-mode-specific "kept explicit" values.

### Step 8: Write tests

**Files**: `packages/web/tests/theme.test.ts` (new)

Test the theme utilities:

- `loadTheme()` returns `"system"` when localStorage is empty.
- `loadTheme()` returns the stored value when valid.
- `loadTheme()` returns `"system"` for invalid stored values.
- `saveTheme()` persists to localStorage.
- `resolveTheme("system")` returns `"dark"` when `matchMedia` matches.
- `resolveTheme("light")` returns `"light"` regardless of system.
- `resolveTheme("dark")` returns `"dark"` regardless of system.

`resolveTheme` depends on `window.matchMedia`, which doesn't exist in Bun's test environment. Use dependency injection: `resolveTheme` should accept an optional `matchMedia` parameter (defaulting to `window.matchMedia`) so tests can provide a stub without `mock.module()`.

The `ThemeProvider` component test:

- Verify `data-theme` attribute is set on `documentElement` after mount.
- Verify theme change updates `data-theme` and localStorage.

### Step 9: Validate against goal

Launch a sub-agent that reads this plan's Goal section, reviews the implementation, and flags any requirements not met. This step is not optional.

Check specifically:

- Toggle exists in sidebar footer (desktop) and mobile header (mobile).
- `[data-theme="dark"]` block defines dark equivalents for all ~31 hex roots.
- All `color-mix()` derivations are overridden for dark mode.
- `prefers-color-scheme` is respected by default.
- Preference persists via localStorage.
- No flash of wrong theme on load.
- WCAG AA contrast passes for all dark-mode pairings.
- Color system documentation is updated.

## Delegation Guide

Steps requiring specialized expertise:

- **Step 1**: Color design. The dark palette values need a designer's eye, not just mechanical inversion. Candidate: Sienna, if available, for palette selection. If not, Dalton applies the warm-dark constraint and contrast-audits against WCAG thresholds.
- **Step 6**: Accessibility audit. Can be scripted (Python luminance calculation, same as the existing audit). Dalton or Thorne can run this.
- **Step 7**: Documentation update. Octavia, if the plan warrants a separate commission. Otherwise Dalton updates in the same PR.

Consult `.lore/lore-agents.md` if available for domain-specific agents.

## Migration Impact Summary

The color system migration (2026-04-11) simplified dark mode implementation:

- **Fewer tokens to override.** 77 tokens (down from 83). Six near-duplicate hex values became aliases that cascade automatically.
- **Systematic derivation patterns.** Consistent vocabulary (`-bg` at 92%, `-border` at 75-79%, `-badge-bg` at 85%) means the dark override block can follow an equally systematic pattern rather than handling one-off derivations.
- **Sidebar overlays now functional.** The `color-mix(in srgb, ...)` sidebar tokens were silently broken before (invalid `in rgb` syntax caused fallback). They now render correctly, giving dark mode a working baseline to adapt from rather than a broken one to fix.
- **Alias chains verified.** The migration confirmed that alias chains like `--danger` -> `--score-low` and `--conf-strong` -> `--score-high` cascade correctly. Dark mode only needs to override the root, not every alias.
- **Light palette finalized.** The light-mode hex roots are now their canonical values (including WCAG AA fixes to `--text-muted` and `--score-mid`). Dark-mode palette design can proceed against stable reference values.

## Open Questions

1. **Three-state toggle UX.** The plan includes light/dark/system as three toggle states. If the user prefers a simpler two-state toggle (light/dark only, with system detection only on first visit), the `resolveTheme` function simplifies and the toggle icon reduces to sun/moon. This is a UX preference, not a technical blocker.

2. **Sidebar in dark mode.** Option 1 (sidebar stays darkest) is assumed. If the user prefers option 2 (sidebar lighter than content in dark mode), the `--nav-bg` override changes but the plan structure is the same.
