---
name: Shelf Judge Web
description: A calm, data-dense board game collection fitness workspace.
colors:
  bg-base: "#f4f1ec"
  bg-surface: "#fefcf9"
  bg-elevated: "#ffffff"
  bg-subtle: "#f9f7f4"
  text-primary: "#1a1714"
  text-secondary: "#6b6560"
  border: "#ddd8d0"
  border-strong: "#c4bfb8"
  action: "#1c3d5e"
  action-hover: "#2a5580"
  score: "#b86c1a"
  score-high: "#2d7a4a"
  score-mid: "#846a1d"
  score-low: "#b84040"
  bgg-accent: "#2e5f8a"
  override-accent: "#5c3d99"
  nav-bg: "#1a1714"
  nav-text: "#e8e4dc"
typography:
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.06em"
rounded:
  xs: "3px"
  sm: "4px"
  md: "5px"
  lg: "6px"
  xl: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  content: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "7px 14px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: "7px 14px"
  card:
    backgroundColor: "{colors.bg-surface}"
    rounded: "{rounded.lg}"
    padding: "16px 20px"
  input:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  nav-active:
    backgroundColor: "{colors.score}"
    textColor: "{colors.nav-text}"
    padding: "9px 20px"
  score-high:
    backgroundColor: "{colors.score-high}"
    textColor: "{colors.score-high}"
---

# Design System: Shelf Judge Web

## Overview

**Creative North Star: "The Warm Ledger"**

Shelf Judge is an Operate-mode workspace for judging a board game collection. It favors quiet, durable clarity: warm paper-like surfaces, charcoal navigation, compact data rows, and a small number of semantically meaningful accents. The visual system makes the collection and its scores legible rather than competing with them.

The interface maintains an editorial restraint while serving dense administrative tasks. Borders, tonal surface changes, alignment, and tabular numerals establish hierarchy; color communicates action, score tiers, source provenance, and status. Light and dark themes preserve those role relationships rather than merely inverting colors.

**Key Characteristics:**

- Warm neutral surfaces with a dark, persistent navigation rail.
- Compact, scan-friendly typography and measured spacing.
- Semantic accents reserved for actions, scores, sources, and states.
- Flat surfaces organized by borders and tonal layering, with one elevated menu shadow.

## Colors

The palette is a warm neutral ledger with functional, restrained semantic color.

### Primary

- **Action Navy**: Primary interactive controls, links, focus treatments, and selected configuration states.
- **Precious Amber**: Fitness scores, active navigation marker, and score-derived progress fills.

### Secondary

- **BoardGameGeek Blue**: Imported BGG data, BGG tags, source rows, and their focus ring.
- **Override Violet**: Explicit personal overrides and their supporting treatment.

### Tertiary

- **Healthy Green**: High score and success tier indicators.
- **Caution Olive**: Mid score tier indicators.
- **Alert Red**: Low score tiers and destructive actions.

### Neutral

- **Warm Parchment**: The page canvas.
- **Paper Surface**: Cards, panels, and top bars.
- **Ink**: Primary text and the light-theme navigation background.
- **Soft Rule**: Borders, table divisions, and subdued chips.

**The Semantic Accent Rule.** Use an accent to communicate a domain meaning, not to decorate a neutral surface. Preserve the source-specific blue and violet language, and the green, olive, and red score scale.

## Typography

**Body Font:** Inter, with system sans-serif fallbacks.

**Character:** A practical sans-serif system optimized for collection management. Dense labels and tabular figures support comparison without making the interface feel crowded.

### Hierarchy

- **Display** (700, 40px, 1): Reserved for a featured score number.
- **Title** (700, 24px, 1.2): Game titles and page-level headings.
- **Body** (400, 15px, 1.5): Default application copy and primary game names.
- **Label** (600, 11px, 0.06em tracking, uppercase): Table headers, metadata labels, navigation groups, and score labels.

**The Numbers-Align Rule.** Scores, weights, ranks, dates, and table values use tabular numerals and align to their comparison edge.

## Layout

The desktop shell is a full-height flex layout with a fixed 200px sidebar and a flexible main column. A 56px top bar anchors each route; scrolling occurs inside the main content region. Default content padding is 32px, with compact 8px, 16px, 20px, and 24px rhythms inside controls, cards, and sections.

Collection rows use explicit grids for aligned metadata and scores. Page content narrows where a task benefits from focus, such as the 780px axes view and 680px import view. At mobile widths, the sidebar becomes an overlay opened by a mobile header, preserving the same navigation and theme controls without compressing desktop rows into an unusable rail.

## Elevation & Depth

The system is flat by default. Borders and adjacent warm tonal surfaces separate cards, panels, table headers, and inset regions. The menu/popover shadow is the sole named elevation treatment; modal overlays use a translucent black scrim.

### Shadow Vocabulary

- **Menu Elevation**: Used for menus and popovers above otherwise flat application surfaces. It is stronger in dark mode to retain separation.

**The Rule-First Depth Rule.** Establish hierarchy with the surface and border vocabulary before adding elevation; reserve shadows for overlays that must clearly float.

## Shapes

Forms are gently rounded but structurally rectilinear. Small metadata badges use tight corners, buttons and fields use compact corners, cards use a modest larger radius, and circular score/status indicators are reserved for dots and icons. Borders are thin and neutral, becoming stronger on hover or at table boundaries.

## Components

### Buttons

- **Shape:** Compact rounded rectangle (5px).
- **Primary:** Navy action fill with white text and 7px × 14px padding.
- **Hover / Focus:** Primary buttons shift to the hover navy; keyboard focus is a 2px action-color outline with a 1px offset where fields expose focus.
- **Secondary / Ghost / Danger:** Secondary actions are transparent with a strong neutral border; ghost actions remain borderless and gain an action-tinted hover background; danger actions use the low-score red vocabulary.

### Cards / Containers

- **Corner Style:** Modest rounding (6px, with 8px on some status containers).
- **Background:** Paper Surface with a Soft Rule border.
- **Shadow Strategy:** Flat at rest; use the menu elevation only for floating UI.
- **Internal Padding:** Usually 16px × 20px, increasing to 20px × 24px for status banners.

### Inputs / Fields

- **Style:** Elevated white surface, strong neutral 1px border, 4px corners, and 8px × 12px padding.
- **Focus:** A visible 2px Action Navy outline with a 1px offset.
- **Error / Disabled:** Errors use the alert-red text role; disabled controls reduce opacity and remove the action cursor.

### Navigation

- **Style:** A 200px Ink rail with light text, section labels in uppercase tracking, and 16px inline SVG icons.
- **State:** Hover uses a light translucent overlay. The active item gains an amber left rule, a translucent amber background, brighter text, and medium weight.
- **Mobile treatment:** The navigation becomes a closable overlay, with a visible mobile header and a backdrop that locks page scroll while open.

### Score Indicators

- **Style:** Amber featured values and 8px circular tier dots; high, mid, and low score values switch to their matching semantic colors.
- **Behavior:** Scores use tabular numerals, and the featured game score is the only 40px metric treatment.

## Do's and Don'ts

### Do:

- **Do** preserve warm neutrals as the dominant surface language in both themes.
- **Do** use compact uppercase labels to structure dense data, and tabular numerals to compare it.
- **Do** retain semantic color boundaries for score tiers, BGG data, and personal overrides.
- **Do** use borders and tonal surfaces to group information before reaching for shadows.

### Don't:

- **Don't** use action navy, amber, BGG blue, or override violet as arbitrary decoration.
- **Don't** replace the dark navigation rail with a light card-like navigation treatment.
- **Don't** introduce oversized rounding, oversized display typography, or expansive white space that weakens collection scanning.
- **Don't** remove visible keyboard focus treatments or rely on color alone for a score or state.
