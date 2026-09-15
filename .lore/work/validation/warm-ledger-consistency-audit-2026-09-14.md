---
title: Warm Ledger consistency and technical audit
date: 2026-09-14
status: completed
issue: shelf-judge-g6m
scope: packages/web collection controls, navigation, thumbnails, and Collection Profile
---

# Warm Ledger Consistency And Technical Audit

## Bounded consistency changes

- Removed duplicate light and dark previously-owned token declarations from
  `packages/web/app/globals.css`; the later canonical declarations remain the
  single source of each value.
- Added a reusable visually-hidden utility and an associated visible-to-screen-
  reader label for the Collection search input.
- Made Collection toolbar state explicit to assistive technology: sort-popup
  expansion and relationship, sort direction's next action, filter expansion,
  and selected states are now exposed through native button semantics. The
  close control has a descriptive accessible name.

No layout, copy, data behavior, or product decision was changed.

## Independent review correction

Independent review identified that the initial sort-popup edit incorrectly
declared a `menu` and `menuitemradio` controls without the required composite
widget focus management or Arrow, Home, End, and Escape keyboard behavior.
The correction removes those roles and the now-inaccurate `aria-haspopup`.
The popup returns to native button semantics: the sort trigger remains a
standard disclosure button with `aria-expanded` and `aria-controls`, and each
sort choice is a native button with `aria-pressed` for its selected state.

This preserves the real keyboard behavior supplied by buttons while avoiding a
claim to the menu interaction contract. The affected typecheck, lint, and
targeted browser checks were rerun after this correction: the collection
controls sort/toggle case passed in all four projects, and the collection
navigation keyboard/semantics/targets/overflow case passed in all four
projects.

## Audit health score

| #         | Dimension                | Score     | Key finding                                                                                                                                                                                                          |
| --------- | ------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Accessibility            | 4/4       | Profile checks cover AA contrast, focus, keyboard operation, labels, 44px targets, and non-hover evidence in four viewport cases. Collection control relationships and labels were tightened in this pass.           |
| 2         | Performance              | 4/4       | Collection thumbnails use native lazy loading plus intrinsic 40px dimensions; browser coverage verifies distant thumbnails defer and rows do not shift.                                                              |
| 3         | Responsive design        | 4/4       | Profile and collection navigation browser checks exercise 375x812, 768x1024, 1440x900, and the project 200% layout-equivalent viewport for overflow, focus, and target size.                                         |
| 4         | Theming                  | 3/4       | Light/dark semantic token layers cover the audited surfaces and profile coverage reloads dark theme. The audited CSS still contains legacy explicit roots and fallback literals outside this bounded pass.           |
| 5         | Implementation integrity | 3/4       | The reviewed controls use semantic native controls and stable tested state. Duplicate previously-owned token declarations were eliminated. Full application-wide detector output is recorded below after validation. |
| **Total** |                          | **18/20** | **Excellent: minor follow-up only**                                                                                                                                                                                  |

## Implementation integrity verdict

**Pass for the audited surfaces.** The collection expresses the product-specific
Warm Ledger system through warm semantic surface tokens, compact tabular rows,
semantic score/source accents, and persistent contextual navigation. Profile
tests verify evidence remains visible rather than hover-dependent. This pass
did not attempt a broad application redesign or token migration.

## Evidence and validation

- `e2e/useful-profile.pw.ts` asserts AA contrast, visible keyboard focus,
  44px targets, no horizontal overflow, dark-theme persistence, and all four
  configured viewport cases.
- `e2e/collection-navigation.pw.ts` asserts accessible full navigation labels,
  44px detail-navigation targets, keyboard focus, no overflow in every
  configured viewport, plus a literal 200% Chromium zoom probe.
- `e2e/collection-controls.pw.ts` exercises collection toggle and sort keyboard
  operation; `e2e/collection-thumbnails.pw.ts` verifies deferred offscreen
  thumbnail loads and stable dimensions.
- Validation completed on 2026-09-14:
  - `bun run typecheck` passed.
  - `bun run typecheck:browser` passed.
  - `bunx eslint packages/web/components/collection-table.tsx` passed.
  - Prettier check passed for the changed TSX, CSS, and this note.
  - Profile contrast/interaction release-gate case passed in all four projects.
  - Collection navigation keyboard/semantics/targets/overflow case passed in
    all four projects; its literal Chromium 200% desktop probe passed.
  - Collection controls and thumbnail suites passed: 16 tests across the four
    projects. Initial deferred image requests ranged from 39 to 56 of 100,
    confirming distant images were not all requested eagerly.
  - Independent-review full gates: lint passed; `bun test` passed with 2,995
    passing tests, 1 skip, and 0 failures; build passed. Root
    `format:check` still fails only on 24 pre-existing unrelated files.
    Changed-file Prettier and `git diff --check` passed.

## Detector evidence

`impeccable detect --json components/collection-table.tsx app/globals.css`
completed with no finding in the changed TSX and existing global-CSS findings:

- six side-tab warnings, including one neutral border and five pre-existing
  semantic/status treatments;
- four `transition: width` performance warnings; and
- design-system advisories for legacy literal colors, typography steps, and
  radii across the large shared stylesheet.

These are deterministic detector results, not a claim that every warning is a
product defect. They are outside this pass because each needs component-context
design judgment; follow-up `shelf-judge-66b` tracks that triage.

## Findings retained for later scope

- **[P3] Application-wide legacy color cleanup**
  - **Category:** Theming
  - **Location:** `packages/web/app/globals.css` and unrelated web surfaces
  - **Impact:** The audited surfaces are themed, but broader component/fallback
    color cleanup is a separate migration rather than a safe consistency edit.
  - **Recommendation:** Audit all remaining component color literals against the
    semantic token system in a dedicated theming task.
  - **Suggested command:** `/impeccable colorize`, then `/impeccable polish`.

## Positive findings

- Browser coverage is unusually concrete: it checks actual computed contrast,
  target dimensions, focus outlines, and overflow instead of relying on visual
  inspection alone.
- Thumbnail loading is both lazy and dimension-stable.
- The existing light/dark Warm Ledger palette preserves semantic score and
  provenance roles.
