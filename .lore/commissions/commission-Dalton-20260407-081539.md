---
title: "Commission: Collection Filter/Sort Phase 1+2 Fix + Phase 3: Filters"
date: 2026-04-07
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Two tasks in this commission:\n\n**Task 1: Fix Phase 1+2 review findings.**\nRead Thorne's review from the commission that just completed before this one (it reviewed Phases 1+2). Address ALL findings before starting Phase 3. Do not skip any finding regardless of severity.\n\n**Task 2: Implement Phase 3 (Filters).**\nRead the plan at `.lore/plans/collection-filter-sort.md` — Phase 3 has full implementation details.\nRead the spec at `.lore/specs/collection-filter-sort.md` — requirements REQ-CFS-15 through REQ-CFS-22.\nRead the mockup at `.lore/art/mockup-collection-filter-sort.html` — filter bar, chips, stats strip.\n\n**Phase 3 deliverables:**\n- Text search filter (always-visible search input, immediate filtering, REQ-CFS-15)\n- Rated status filter (segmented control: All/Rated/Unrated, REQ-CFS-16)\n- Player count filter (\"Plays at N\" input, REQ-CFS-16)\n- AND combination logic (REQ-CFS-18)\n- Active filter chips with dismiss buttons, \"Clear all\" link (REQ-CFS-17)\n- Filter toggle button with count badge (REQ-CFS-20)\n- Stats strip \"Filtered, K hidden\" note (REQ-CFS-19)\n- localStorage persistence for filters (key: `shelf-judge-filters`, REQ-CFS-22)\n- CSS classes matching mockup conventions\n\n**Verification:** `bun run typecheck`, `bun run lint`, `bun run test` all clean. Filters work independently and in combination. Chips render and dismiss correctly. Stats strip updates. localStorage persists filter state."
dependencies:
  - commission-Thorne-20260407-081526
linked_artifacts:
  - packages/web/components/collection-table.tsx

  - packages/web/lib/collection-utils.ts
  - packages/web/app/page.tsx
  - packages/web/app/globals.css
  - packages/web/lib/collection-utils.ts
  - packages/web/app/page.tsx
  - packages/web/app/globals.css
activity_timeline:
  - timestamp: 2026-04-07T15:15:39.445Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T15:20:49.755Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-07T15:26:16.277Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-07T15:26:16.280Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-07T15:26:16.298Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-07T15:26:22.788Z
    event: progress_report
    reason: "Starting commission. Reading Thorne's review findings and Phase 3 plan/spec."
  - timestamp: 2026-04-07T15:27:06.630Z
    event: progress_report
    reason: "Context gathered. Now fixing Thorne's 5 findings (score arrow condition, hover feedback, separator character, component extraction, useCallback memoization), then implementing Phase 3 filters."
  - timestamp: 2026-04-07T15:31:35.256Z
    event: progress_report
    reason: "All 5 findings fixed, Phase 3 filter logic implemented, all checks pass. Component at 914 lines, extracting filter bar to address Finding #4 size concern."
  - timestamp: 2026-04-07T15:35:07.258Z
    event: progress_report
    reason: "All work complete. Findings fixed, Phase 3 filters implemented, pure functions extracted to collection-utils.ts. 398 tests pass, typecheck/lint/format clean. Component down to 543 lines, utils at 388 lines."
  - timestamp: 2026-04-07T15:35:32.772Z
    event: result_submitted
    reason: "## Task 1: Thorne's Review Findings (all 6 addressed)\n\n**Finding #1 (Score arrow unconditional):** Added `scoreOwnsSort` flag gating the arrow to render only when `sort.field !== \"name\" && sort.field !== \"updatedAt\"`. REQ-CFS-14 now satisfied.\n\n**Finding #2 (Score header hover):** Added `.score-col-label.sortable:hover .score-col-main { color: var(--text-primary) }` to globals.css.\n\n**Finding #3 (Separator character):** Changed all `\\u00b7` (middle dot) to ` - ` (hyphen) per spec REQ-CFS-6.\n\n**Finding #4 (Component size):** Extracted all pure functions (sort field definitions, sort/filter persistence, sort comparator, filter predicate, score display, separator label, score subtitle) into `packages/web/lib/collection-utils.ts` (388 lines). Component reduced from 914 to 543 lines.\n\n**Finding #5 (useCallback memoization):** Wrapped `buildSortFields()` in `useMemo` with deps `[axes, hasTournamentData, hasBggData]` so `sortFields` reference is stable.\n\n**Finding #6 (Stats strip migration):** Stats strip moved from server component into `CollectionTable`. New props `totalGames`, `ratedCount`, `avgFitness` passed from server component. Stats strip now renders \"N of M games\" and \"Filtered, K hidden\" when filters active (REQ-CFS-19).\n\n## Task 2: Phase 3 Filters (REQ-CFS-15 through REQ-CFS-22)\n\n**Filter state** (`FilterState`): search string, ratedStatus (\"all\"/\"rated\"/\"unrated\"), playerCount (number|null). Persisted to `localStorage` key `shelf-judge-filters` (REQ-CFS-22). Validated on load same pattern as sort state.\n\n**Filter predicate** (`matchesFilters`): AND combination of all active filters (REQ-CFS-18). Search is case-insensitive name substring (REQ-CFS-15). Player count checks `minPlayers <= N <= maxPlayers`, excludes null-player-count games (REQ-CFS-16).\n\n**Filter bar UI**: Search input always visible with magnifying glass icon. Input border turns action-navy when has value. Sort control moved into filter-row-1. Filter toggle button with count badge for non-search filters (REQ-CFS-20). Expandable panel with rated status segmented control and \"Plays at N\" player count input (REQ-CFS-16).\n\n**Active filter chips** (REQ-CFS-17): Color-coded pills (chip-search warm gray, chip-rated amber, chip-spec green). Each with X dismiss. \"Clear all\" link when 2+ active.\n\n**Stats strip** (REQ-CFS-19): Shows \"N of M\" games when filtered. \"Filtered, K games hidden\" note.\n\n**CSS**: All class names match mockup conventions. New variables `--filter-spec` and `--filter-spec-bg` added to `:root`.\n\n## Verification\n\n- `bun run typecheck`: clean\n- `bun run lint`: clean\n- `bun run format:check`: clean (changed files)\n- `bun test`: 398 pass, 0 fail\n\n## Files modified\n\n- `packages/web/components/collection-table.tsx` (543 lines, down from 665)\n- `packages/web/app/page.tsx` (94 lines, down from 112)\n- `packages/web/app/globals.css` (new filter CSS + hover fix)\n\n## Files created\n\n- `packages/web/lib/collection-utils.ts` (388 lines, extracted pure functions)"
  - timestamp: 2026-04-07T15:35:36.568Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All work complete. Findings fixed, Phase 3 filters implemented, pure functions extracted to collection-utils.ts. 398 tests pass, typecheck/lint/format clean. Component down to 543 lines, utils at 388 lines."
projectName: shelf-judge
---
## Task 1: Thorne's Review Findings (all 6 addressed)

**Finding #1 (Score arrow unconditional):** Added `scoreOwnsSort` flag gating the arrow to render only when `sort.field !== "name" && sort.field !== "updatedAt"`. REQ-CFS-14 now satisfied.

**Finding #2 (Score header hover):** Added `.score-col-label.sortable:hover .score-col-main { color: var(--text-primary) }` to globals.css.

**Finding #3 (Separator character):** Changed all `\u00b7` (middle dot) to ` - ` (hyphen) per spec REQ-CFS-6.

**Finding #4 (Component size):** Extracted all pure functions (sort field definitions, sort/filter persistence, sort comparator, filter predicate, score display, separator label, score subtitle) into `packages/web/lib/collection-utils.ts` (388 lines). Component reduced from 914 to 543 lines.

**Finding #5 (useCallback memoization):** Wrapped `buildSortFields()` in `useMemo` with deps `[axes, hasTournamentData, hasBggData]` so `sortFields` reference is stable.

**Finding #6 (Stats strip migration):** Stats strip moved from server component into `CollectionTable`. New props `totalGames`, `ratedCount`, `avgFitness` passed from server component. Stats strip now renders "N of M games" and "Filtered, K hidden" when filters active (REQ-CFS-19).

## Task 2: Phase 3 Filters (REQ-CFS-15 through REQ-CFS-22)

**Filter state** (`FilterState`): search string, ratedStatus ("all"/"rated"/"unrated"), playerCount (number|null). Persisted to `localStorage` key `shelf-judge-filters` (REQ-CFS-22). Validated on load same pattern as sort state.

**Filter predicate** (`matchesFilters`): AND combination of all active filters (REQ-CFS-18). Search is case-insensitive name substring (REQ-CFS-15). Player count checks `minPlayers <= N <= maxPlayers`, excludes null-player-count games (REQ-CFS-16).

**Filter bar UI**: Search input always visible with magnifying glass icon. Input border turns action-navy when has value. Sort control moved into filter-row-1. Filter toggle button with count badge for non-search filters (REQ-CFS-20). Expandable panel with rated status segmented control and "Plays at N" player count input (REQ-CFS-16).

**Active filter chips** (REQ-CFS-17): Color-coded pills (chip-search warm gray, chip-rated amber, chip-spec green). Each with X dismiss. "Clear all" link when 2+ active.

**Stats strip** (REQ-CFS-19): Shows "N of M" games when filtered. "Filtered, K games hidden" note.

**CSS**: All class names match mockup conventions. New variables `--filter-spec` and `--filter-spec-bg` added to `:root`.

## Verification

- `bun run typecheck`: clean
- `bun run lint`: clean
- `bun run format:check`: clean (changed files)
- `bun test`: 398 pass, 0 fail

## Files modified

- `packages/web/components/collection-table.tsx` (543 lines, down from 665)
- `packages/web/app/page.tsx` (94 lines, down from 112)
- `packages/web/app/globals.css` (new filter CSS + hover fix)

## Files created

- `packages/web/lib/collection-utils.ts` (388 lines, extracted pure functions)

## Decisions

**How to decompose collection-table.tsx at 914 lines?**
Extract pure functions (sort definitions, sort comparator, filter predicate, score display, separator label, score subtitle) into a collection-utils.ts module. Keep the component focused on state management and rendering. This reduces collection-table.tsx to ~550 lines and makes the pure functions independently testable.
*Reasoning: The plan's Risk Note #1 flags >300 lines as an extraction trigger. The component is at 914 lines. The pure functions (sort field building, sort comparator, filter predicate, score display, separator label, score subtitle) account for ~330 lines and have zero React dependencies. Extracting them reduces the component to rendering and state, and the pure functions become directly importable for Phase 5 tests without needing component test infrastructure.*
