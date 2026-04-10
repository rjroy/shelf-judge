---
title: "Commission: Utility Curves Phase 5: Web UI"
date: 2026-04-10
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 5 of the utility curves plan at `.lore/plans/utility-curves.md`.\n\n**Files**: `packages/web/app/axes/page.tsx`, `packages/web/components/score-breakdown.tsx`, `packages/web/app/games/[id]/page.tsx`, `packages/web/app/page.tsx`, `packages/web/components/collection-table.tsx`, `packages/web/lib/api.ts`, `packages/web/lib/curve-math.ts` (new), global CSS\n\n**IMPORTANT**: This commission runs in parallel with Phase 6 (CLI). Only touch web package files.\n\nKey changes:\n\n1. **Axis configuration** (axes page):\n   - Shape selector (radio/segmented: Higher is better, Lower is better, Sweet spot)\n   - Sweet spot controls: ideal value input, tolerance selector, lean direction toggle\n   - Curve preview: SVG/canvas showing the curve shape with live updates\n   - Veto threshold config: checkbox, direction, threshold value, confirmation dialog\n   - Update the local Axis type duplicate to include curve fields\n\n2. **Curve preview**: Create `packages/web/lib/curve-math.ts` with the same pure curve functions as curve-engine.ts for client-side computation. ~50 lines of duplicated math for instant preview updates.\n\n3. **Score breakdown** (game detail):\n   - Remove the broken \"scaled\" rendering logic (lines 42-43 of score-breakdown.tsx)\n   - Add Raw column showing native-scale values\n   - Rename Rating to Effective\n   - Highlight curve-affected rows\n   - Veto banner with triggering axis, threshold, raw value, hypothetical score\n\n4. **Collection table veto display**: VETOED badge for vetoed games, hypothetical score shown smaller underneath.\n\n5. **API updates**: Update createAxis/updateAxis in lib/api.ts to accept curve config.\n\nRead the plan's Phase 5 section carefully for all UI details.\n\nRun `bun run typecheck` before declaring complete. (Web components don't have unit tests per the plan.)"
dependencies:
  - commission-Dalton-20260409-200854
linked_artifacts:
  - packages/web/lib/curve-math.ts

  - packages/web/app/axes/page.tsx
  - packages/web/components/score-breakdown.tsx
  - packages/web/app/games/[id]/page.tsx
  - packages/web/components/collection-table.tsx
  - packages/web/lib/api.ts
  - packages/web/app/globals.css
  - packages/web/app/axes/page.tsx
  - packages/web/components/score-breakdown.tsx
  - packages/web/app/games/[id]/page.tsx
  - packages/web/components/collection-table.tsx
  - packages/web/lib/api.ts
  - packages/web/app/globals.css
activity_timeline:
  - timestamp: 2026-04-10T03:09:10.307Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T03:09:10.309Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-10T03:48:30.840Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-10T03:48:30.844Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T03:48:30.866Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T03:49:06.439Z
    event: progress_report
    reason: "Reading plan and existing web files. Phase 5 scope: axis config UI (shape selector, sweet spot controls, curve preview, veto threshold), score breakdown expansion, collection table veto display, API updates, and client-side curve math."
  - timestamp: 2026-04-10T03:49:49.861Z
    event: progress_report
    reason: "Read all target files. Starting implementation: (1) curve-math.ts client-side lib, (2) local Axis type update + curve config UI on axes page, (3) score breakdown expansion, (4) collection table veto display, (5) API updates, (6) CSS additions."
  - timestamp: 2026-04-10T03:58:14.826Z
    event: progress_report
    reason: "All implementation complete. Typecheck and tests pass (578 pass, 0 fail). Created curve-math.ts, updated axes page with shape selector + sweet spot controls + curve preview SVG + veto config, expanded score breakdown with Raw/Effective columns + veto banner + curve indicators, added collection table veto badge, updated API types, added ~200 lines of CSS."
  - timestamp: 2026-04-10T03:59:31.197Z
    event: result_submitted
    reason: "# Phase 5: Web UI for Utility Curves\n\nAll changes pass typecheck (web + shared + daemon + cli), lint, and tests (578 pass, 0 fail).\n\n## Created\n- `packages/web/lib/curve-math.ts` - Client-side pure curve math (~100 lines) duplicating `curve-engine.ts` functions for instant preview. Exports `getNativeScale`, `applyPreferenceCurve`, `calibrateTolerance`.\n\n## Modified\n\n### Axis Configuration (`packages/web/app/axes/page.tsx`)\n- Updated local `Axis` interface with curve fields (`preferenceShape`, `idealValue`, `tolerance`, `leanDirection`, `veto`)\n- Added `CurveState` type and helper functions (`curveStateFromAxis`, `curveStateToBody`) for form state management\n- Refactored axis cards into `AxisCard` component for code reuse between personal and BGG axes\n- Added `CurveConfig` component with:\n  - Shape selector (radio buttons: Higher is better, Lower is better, Sweet spot) with descriptions\n  - Sweet spot controls: ideal value input (native-scale bounds), tolerance segmented control (Flexible/Moderate/Strict), lean direction toggle (Symmetric/Prefer lower/Prefer higher)\n  - SVG curve preview showing the preference curve with live updates as controls change\n  - Veto threshold: enable checkbox, direction selector (below/above), threshold input\n- Curve config shown in both create form and edit mode\n- Axis cards now display curve summary (shape tag, ideal value, veto tag) when not editing\n\n### Score Breakdown (`packages/web/components/score-breakdown.tsx`)\n- Removed broken `breakdown-override-detail` \"scaled\" rendering (old `bggOriginal * 2` display)\n- Added Raw column between Axis and Effective (shows native-scale value when different from effective)\n- Renamed \"Rating\" header to \"Effective\"\n- Added curve-affected row highlighting (left border + `~` indicator)\n- Added veto banner above table showing triggering axis, threshold, raw value, and hypothetical score\n- Vetoed tables render with reduced opacity on data rows\n- Total row shows \"Hypothetical Score\" when vetoed\n\n### Game Detail (`packages/web/app/games/[id]/page.tsx`)\n- Hero score section shows \"VETOED\" with hypothetical score when game is vetoed\n\n### Collection Table (`packages/web/components/collection-table.tsx`)\n- Score cell displays \"VETOED\" badge (red, danger-styled) for vetoed games\n- Hypothetical score shown smaller underneath the badge\n\n### API (`packages/web/lib/api.ts`)\n- `createAxis` and `updateAxis` accept curve config fields (`preferenceShape`, `idealValue`, `tolerance`, `leanDirection`, `veto`)\n- Added curve type imports from shared\n\n### CSS (`packages/web/app/globals.css`)\n- ~200 lines of new styles for curve config UI, shape selector, sweet spot controls, curve preview, veto config, veto banner, curve-affected rows, vetoed hero score, collection table veto badge\n- Updated mobile breakpoint to hide Raw and Contribution columns (adjusted nth-child selectors for new column)"
  - timestamp: 2026-04-10T03:59:36.489Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All implementation complete. Typecheck and tests pass (578 pass, 0 fail). Created curve-math.ts, updated axes page with shape selector + sweet spot controls + curve preview SVG + veto config, expanded score breakdown with Raw/Effective columns + veto banner + curve indicators, added collection table veto badge, updated API types, added ~200 lines of CSS."
projectName: shelf-judge
---
# Phase 5: Web UI for Utility Curves

All changes pass typecheck (web + shared + daemon + cli), lint, and tests (578 pass, 0 fail).

## Created
- `packages/web/lib/curve-math.ts` - Client-side pure curve math (~100 lines) duplicating `curve-engine.ts` functions for instant preview. Exports `getNativeScale`, `applyPreferenceCurve`, `calibrateTolerance`.

## Modified

### Axis Configuration (`packages/web/app/axes/page.tsx`)
- Updated local `Axis` interface with curve fields (`preferenceShape`, `idealValue`, `tolerance`, `leanDirection`, `veto`)
- Added `CurveState` type and helper functions (`curveStateFromAxis`, `curveStateToBody`) for form state management
- Refactored axis cards into `AxisCard` component for code reuse between personal and BGG axes
- Added `CurveConfig` component with:
  - Shape selector (radio buttons: Higher is better, Lower is better, Sweet spot) with descriptions
  - Sweet spot controls: ideal value input (native-scale bounds), tolerance segmented control (Flexible/Moderate/Strict), lean direction toggle (Symmetric/Prefer lower/Prefer higher)
  - SVG curve preview showing the preference curve with live updates as controls change
  - Veto threshold: enable checkbox, direction selector (below/above), threshold input
- Curve config shown in both create form and edit mode
- Axis cards now display curve summary (shape tag, ideal value, veto tag) when not editing

### Score Breakdown (`packages/web/components/score-breakdown.tsx`)
- Removed broken `breakdown-override-detail` "scaled" rendering (old `bggOriginal * 2` display)
- Added Raw column between Axis and Effective (shows native-scale value when different from effective)
- Renamed "Rating" header to "Effective"
- Added curve-affected row highlighting (left border + `~` indicator)
- Added veto banner above table showing triggering axis, threshold, raw value, and hypothetical score
- Vetoed tables render with reduced opacity on data rows
- Total row shows "Hypothetical Score" when vetoed

### Game Detail (`packages/web/app/games/[id]/page.tsx`)
- Hero score section shows "VETOED" with hypothetical score when game is vetoed

### Collection Table (`packages/web/components/collection-table.tsx`)
- Score cell displays "VETOED" badge (red, danger-styled) for vetoed games
- Hypothetical score shown smaller underneath the badge

### API (`packages/web/lib/api.ts`)
- `createAxis` and `updateAxis` accept curve config fields (`preferenceShape`, `idealValue`, `tolerance`, `leanDirection`, `veto`)
- Added curve type imports from shared

### CSS (`packages/web/app/globals.css`)
- ~200 lines of new styles for curve config UI, shape selector, sweet spot controls, curve preview, veto config, veto banner, curve-affected rows, vetoed hero score, collection table veto badge
- Updated mobile breakpoint to hide Raw and Contribution columns (adjusted nth-child selectors for new column)
