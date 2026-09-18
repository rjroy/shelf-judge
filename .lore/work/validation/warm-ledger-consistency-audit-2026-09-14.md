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
    passing tests, 1 skip, and 0 failures; build passed. A later formatting
    cleanup resolved the 24 files reported by root `format:check`; the root
    check now passes. Changed-file Prettier and `git diff --check` passed.
  - Full branch verification completed on 2026-09-14: `bun run format:check`,
    `bun run lint`, `bun run typecheck`, `bun run typecheck:browser`,
    `bun test` (2,995 pass, 1 skip, 0 fail), `bun run build`, and
    `git diff --check` all passed. A whitespace-insensitive comparison of the
    outstanding formatting candidates confirmed their changes are formatting
    only; the non-whitespace changes remain limited to the separately reviewed
    implementation and audit updates.

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

## Follow-up triage: shelf-judge-66b (2026-09-15)

This follow-up treats the detector as a mechanical prompt, not as a directive to
flatten the established Warm Ledger language. The detector evidence above is the
source record for all findings that were intentionally excluded from the
consistency pass.

| Finding | Disposition | Evidence and rationale |
| --- | --- | --- |
| Neutral analyst blockquote side rule (`globals.css:9526`) | Fixed | Reduced from 3px to a 1px `--border-strong` rule. It continues to separate quoted analysis under the Design System's rule-first depth vocabulary without becoming decorative emphasis. |
| Semantic/status side rules for stale reflections, curve-affected rows, niche champions, assignment conflicts, and benchmark examples (`globals.css:185`, `:3079`, `:6850`, `:8515`, `:9015`) | Fixed | Reduced from 3–4px to 1px while preserving their existing semantic colors and the scan cue each surface already uses. This removes the detector's thick side-tab treatment without flattening score, warning, or action meaning. |
| Four `transition: width` declarations | Fixed | The progress fills at `globals.css:2419`, `:3920`, `:6499`, and `:8559` animate a layout property for cosmetic feedback. Warm Ledger does not require that motion, so the declarations are removed rather than introducing transform wrappers or altering the existing data-bar geometry. |
| Legacy literal color, typography-step, and radius advisories | Retained as migration work | The existing tokens intentionally include audited exception values with comments, and the stylesheet spans unrelated implemented surfaces. A broad token migration is not a safe P3 follow-up. The existing application-wide cleanup finding above remains the appropriate scoped work item. |

The disposition preserves the incumbent Operate-mode system: semantic color
remains reserved for domain meaning, borders provide flat hierarchy, and this
follow-up avoids visual redesign or unrelated stylesheet normalization.

### Validation limits

On 2026-09-15, the scoped detector command completed successfully after these
changes with no side-tab or `transition: width` findings. It still reported the
pre-existing advisory-only legacy literal color, typography-step, and radius
findings described above. `bun run typecheck:browser` and `git diff --check`
completed successfully. The prior `bun run build` completed successfully before
this follow-up's final border refinements. Browser tests were started earlier
but interrupted by the tool runtime; they are not confirmed and were not
rerun, because the workspace has a live Playwright fixture that this follow-up
must not start, stop, or otherwise modify. No browser or visual-server
inspection was performed for the same reason.

## Positive findings

- Browser coverage is unusually concrete: it checks actual computed contrast,
  target dimensions, focus outlines, and overflow instead of relying on visual
  inspection alone.
- Thumbnail loading is both lazy and dimension-stable.
- The existing light/dark Warm Ledger palette preserves semantic score and
  provenance roles.
