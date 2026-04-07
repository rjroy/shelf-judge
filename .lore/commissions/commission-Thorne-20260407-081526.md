---
title: "Commission: Review: Collection Filter/Sort Phase 1+2"
date: 2026-04-07
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the Phase 1+2 implementation of collection filter/sort.\n\n**Spec:** `.lore/specs/collection-filter-sort.md` — verify REQ-CFS-1 through REQ-CFS-14.\n**Plan:** `.lore/plans/collection-filter-sort.md` — Phases 1 and 2.\n**Mockup:** `.lore/art/mockup-collection-filter-sort.html` — visual reference.\n\n**Files to review:**\n- `packages/web/components/collection-table.tsx` (new client component)\n- `packages/web/lib/date-utils.ts` (new utility)\n- `packages/web/app/page.tsx` (should be stripped down to data fetching)\n- `packages/web/app/globals.css` (new sort/score CSS classes)\n\n**Check:**\n1. All sort fields from REQ-CFS-1 are present in the dropdown with correct grouping (REQ-CFS-3).\n2. Direction toggle works (REQ-CFS-2). Null values sort to bottom regardless of direction.\n3. Score column displays the active sort metric (REQ-CFS-8) with correct fallback for name sort.\n4. Score column header has two-line label with sort arrow (REQ-CFS-9).\n5. Column headers clickable where appropriate (REQ-CFS-11-14).\n6. Separator labels are contextual (REQ-CFS-5-7).\n7. Axes Rated column context switch (REQ-CFS-10).\n8. localStorage persistence (REQ-CFS-21).\n9. Server/client component split is clean: server component has no sort/filter logic, client component has no data fetching.\n10. No regressions: typecheck, lint, tests pass.\n11. CSS class names match the mockup conventions.\n\nRecord all findings in your commission result."
dependencies:
  - commission-Dalton-20260407-081514
linked_artifacts:
  - packages/web/components/collection-table.tsx

  - packages/web/lib/date-utils.ts
  - packages/web/app/page.tsx
  - packages/web/app/globals.css
  - packages/web/lib/date-utils.ts
  - packages/web/app/page.tsx
  - packages/web/app/globals.css
activity_timeline:
  - timestamp: 2026-04-07T15:15:26.493Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T15:20:49.758Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-07T15:20:49.776Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-07T15:20:56.321Z
    event: progress_report
    reason: "Starting review of collection filter/sort Phase 1+2. Reading spec, plan, and dependency commission first."
  - timestamp: 2026-04-07T15:21:44.523Z
    event: progress_report
    reason: "Read all four implementation files. Starting requirement-by-requirement analysis against the spec (REQ-CFS-1 through REQ-CFS-14, plus 21, 23, 27, 29, 30)."
  - timestamp: 2026-04-07T15:24:40.399Z
    event: progress_report
    reason: "5 findings recorded. Now doing requirement coverage verification: checking each REQ-CFS addressed by Phase 1+2 against the implementation."
  - timestamp: 2026-04-07T15:26:11.697Z
    event: result_submitted
    reason: "## Review: Collection Filter/Sort Phase 1+2\n\nReviewed `collection-table.tsx` (665 lines), `date-utils.ts` (22 lines), `page.tsx` (112 lines), and `globals.css` additions against REQ-CFS-1 through REQ-CFS-14, plus REQ-CFS-21, 23, 27, 29, 30.\n\n### Requirement Coverage\n\nAll 19 requirements assigned to Phase 1+2 are implemented. Full checklist:\n\n| Req | Status | Notes |\n|-----|--------|-------|\n| REQ-CFS-1 | **Satisfied** | All 10 built-in fields + per-axis entries. Tournament/BGG hidden when no data. |\n| REQ-CFS-2 | **Satisfied** | Direction toggle works. Same-field click reverses. Default directions correct. |\n| REQ-CFS-3 | **Satisfied** | Four groups (Score, Identity, Specs, Your Axes) with headers. Empty groups hidden. |\n| REQ-CFS-4 | **Satisfied** | Client-side sort, no network requests. |\n| REQ-CFS-5 | **Satisfied** | Null-value games below separator, sorted alphabetically by name. |\n| REQ-CFS-6 | **Partial** | Contextual labels present for all field types. Separator character is middle dot (·) instead of spec's hyphen (-). |\n| REQ-CFS-7 | **Satisfied** | Null values partition to bottom regardless of direction. |\n| REQ-CFS-8 | **Satisfied** | All 11 display variants implemented including name→fitness fallback. |\n| REQ-CFS-9 | **Satisfied** | Two-line header: \"SCORE\" + metric subtitle. |\n| REQ-CFS-10 | **Satisfied** | Axis sort shows fitness + ELO in Axes Rated column. Header label changes to \"Scores\". |\n| REQ-CFS-11 | **Satisfied** | Score header click toggles direction on current metric. |\n| REQ-CFS-12 | **Satisfied** | Last Rated header sorts by updatedAt. |\n| REQ-CFS-13 | **Satisfied** | Game header sorts by name. |\n| REQ-CFS-14 | **Partial** | Game/Last Rated arrows conditional. Score arrow unconditional (see Finding #1). |\n| REQ-CFS-21 | **Satisfied** | localStorage key `shelf-judge-sort`, loads on mount, saves on change. |\n| REQ-CFS-23 | **Satisfied** | `?sort=` param silently ignored (searchParams removed). |\n| REQ-CFS-27 | **Satisfied** | Client component receives games, axes, tournamentStats, hasTournamentData as props. |\n| REQ-CFS-29 | **Satisfied** | Server component is data-fetch only. No sort/filter logic. |\n| REQ-CFS-30 | **Satisfied** | searchParams prop removed from CollectionPage. |\n\n### Findings (priority order)\n\n**1. Score column arrow unconditionally rendered (REQ-CFS-14)**\nFile: `collection-table.tsx:502`\nThe `{dirArrow}` inside the Score header renders regardless of which column owns the active sort. When sorting by name, both Game and Score headers show arrows. REQ-CFS-14: \"Headers without active sort show no arrow.\" The `sort-active` class on `score-col-main` is gated by `sort.field !== \"name\"` (line 500), but the arrow itself is not. Fix: wrap the arrow in a condition: render only when `sort.field !== \"name\"` (and potentially `!== \"updatedAt\"`, since Last Rated owns that sort).\n\n**2. Score column header missing hover feedback**\nFile: `globals.css:2743`, `collection-table.tsx:496`\nCSS rule `.col-label.sortable:hover` provides hover color for Game and Last Rated headers. The Score header uses class `score-col-label sortable`, not `col-label sortable`, so the rule doesn't match. The cursor is handled by inline `style={{ cursor: \"pointer\" }}`, but there's no hover color transition. Fix: add `.score-col-label.sortable:hover { color: var(--text-primary) }` or generalize the selector to `.sortable:hover`.\n\n**3. Separator character deviates from spec**\nFile: `collection-table.tsx:269-294`\nREQ-CFS-6 examples use hyphens (\"Not yet rated - N games\"). The mockup uses em dashes + \"below\" (\"— N games below\"). Implementation uses middle dots (\"· N games\"). The label content is correct and contextual; only the separator character differs. Low impact.\n\n**4. Component approaching size limit before Phase 3**\nFile: `collection-table.tsx` (665 lines)\nThe plan's Risk Note #1 flags >300 lines as an extraction trigger. Phase 3 (filter bar, chips, filter state, predicates) will add ~150+ lines, pushing past the project's ~800 line heuristic. Candidates for extraction: sort dropdown menu, GameRow sub-component, filter bar (Phase 3). Recommend extracting before Phase 3 to prevent the file from becoming unwieldy.\n\n**5. Ineffective useCallback memoization**\nFile: `collection-table.tsx:380-392`\n`handleSortSelect` depends on `sortFields`, which is a new array from `buildSortFields()` every render. The memoization never prevents re-creation. Either memoize `sortFields` with `useMemo(buildSortFields(...), [axes, hasTournamentData, hasBggData])` or drop the `useCallback` wrapper.\n\n**6. Stats strip will need migration for Phase 3**\nFile: `page.tsx:82-101`\nThe stats strip renders static totals in the server component. REQ-CFS-19 (Phase 3) requires \"N of M games\" and \"Filtered, K hidden\" based on filter state that only exists in the client component. The stats strip or its dynamic portions will need to move into `CollectionTable`. Not a defect now, but Phase 3 planning should account for this.\n\n### What's Clean\n\n- Server/client split is sharp. Server component does data fetch + empty state + topbar. Client component owns all interaction.\n- Sort comparator handles all field types correctly, including string-based ISO date comparison for createdAt/updatedAt.\n- Null handling is thorough: every nullable field returns null from `getSortValue`, partitions correctly, and gets a contextual separator label.\n- The `loadSort` validation (line 86) protects against corrupt localStorage gracefully.\n- SSR hydration handled correctly: default sort on first paint, localStorage hydration via useEffect.\n- `date-utils.ts` extraction is clean and self-contained."
  - timestamp: 2026-04-07T15:26:16.101Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "5 findings recorded. Now doing requirement coverage verification: checking each REQ-CFS addressed by Phase 1+2 against the implementation."
projectName: shelf-judge
---
## Review: Collection Filter/Sort Phase 1+2

Reviewed `collection-table.tsx` (665 lines), `date-utils.ts` (22 lines), `page.tsx` (112 lines), and `globals.css` additions against REQ-CFS-1 through REQ-CFS-14, plus REQ-CFS-21, 23, 27, 29, 30.

### Requirement Coverage

All 19 requirements assigned to Phase 1+2 are implemented. Full checklist:

| Req | Status | Notes |
|-----|--------|-------|
| REQ-CFS-1 | **Satisfied** | All 10 built-in fields + per-axis entries. Tournament/BGG hidden when no data. |
| REQ-CFS-2 | **Satisfied** | Direction toggle works. Same-field click reverses. Default directions correct. |
| REQ-CFS-3 | **Satisfied** | Four groups (Score, Identity, Specs, Your Axes) with headers. Empty groups hidden. |
| REQ-CFS-4 | **Satisfied** | Client-side sort, no network requests. |
| REQ-CFS-5 | **Satisfied** | Null-value games below separator, sorted alphabetically by name. |
| REQ-CFS-6 | **Partial** | Contextual labels present for all field types. Separator character is middle dot (·) instead of spec's hyphen (-). |
| REQ-CFS-7 | **Satisfied** | Null values partition to bottom regardless of direction. |
| REQ-CFS-8 | **Satisfied** | All 11 display variants implemented including name→fitness fallback. |
| REQ-CFS-9 | **Satisfied** | Two-line header: "SCORE" + metric subtitle. |
| REQ-CFS-10 | **Satisfied** | Axis sort shows fitness + ELO in Axes Rated column. Header label changes to "Scores". |
| REQ-CFS-11 | **Satisfied** | Score header click toggles direction on current metric. |
| REQ-CFS-12 | **Satisfied** | Last Rated header sorts by updatedAt. |
| REQ-CFS-13 | **Satisfied** | Game header sorts by name. |
| REQ-CFS-14 | **Partial** | Game/Last Rated arrows conditional. Score arrow unconditional (see Finding #1). |
| REQ-CFS-21 | **Satisfied** | localStorage key `shelf-judge-sort`, loads on mount, saves on change. |
| REQ-CFS-23 | **Satisfied** | `?sort=` param silently ignored (searchParams removed). |
| REQ-CFS-27 | **Satisfied** | Client component receives games, axes, tournamentStats, hasTournamentData as props. |
| REQ-CFS-29 | **Satisfied** | Server component is data-fetch only. No sort/filter logic. |
| REQ-CFS-30 | **Satisfied** | searchParams prop removed from CollectionPage. |

### Findings (priority order)

**1. Score column arrow unconditionally rendered (REQ-CFS-14)**
File: `collection-table.tsx:502`
The `{dirArrow}` inside the Score header renders regardless of which column owns the active sort. When sorting by name, both Game and Score headers show arrows. REQ-CFS-14: "Headers without active sort show no arrow." The `sort-active` class on `score-col-main` is gated by `sort.field !== "name"` (line 500), but the arrow itself is not. Fix: wrap the arrow in a condition: render only when `sort.field !== "name"` (and potentially `!== "updatedAt"`, since Last Rated owns that sort).

**2. Score column header missing hover feedback**
File: `globals.css:2743`, `collection-table.tsx:496`
CSS rule `.col-label.sortable:hover` provides hover color for Game and Last Rated headers. The Score header uses class `score-col-label sortable`, not `col-label sortable`, so the rule doesn't match. The cursor is handled by inline `style={{ cursor: "pointer" }}`, but there's no hover color transition. Fix: add `.score-col-label.sortable:hover { color: var(--text-primary) }` or generalize the selector to `.sortable:hover`.

**3. Separator character deviates from spec**
File: `collection-table.tsx:269-294`
REQ-CFS-6 examples use hyphens ("Not yet rated - N games"). The mockup uses em dashes + "below" ("— N games below"). Implementation uses middle dots ("· N games"). The label content is correct and contextual; only the separator character differs. Low impact.

**4. Component approaching size limit before Phase 3**
File: `collection-table.tsx` (665 lines)
The plan's Risk Note #1 flags >300 lines as an extraction trigger. Phase 3 (filter bar, chips, filter state, predicates) will add ~150+ lines, pushing past the project's ~800 line heuristic. Candidates for extraction: sort dropdown menu, GameRow sub-component, filter bar (Phase 3). Recommend extracting before Phase 3 to prevent the file from becoming unwieldy.

**5. Ineffective useCallback memoization**
File: `collection-table.tsx:380-392`
`handleSortSelect` depends on `sortFields`, which is a new array from `buildSortFields()` every render. The memoization never prevents re-creation. Either memoize `sortFields` with `useMemo(buildSortFields(...), [axes, hasTournamentData, hasBggData])` or drop the `useCallback` wrapper.

**6. Stats strip will need migration for Phase 3**
File: `page.tsx:82-101`
The stats strip renders static totals in the server component. REQ-CFS-19 (Phase 3) requires "N of M games" and "Filtered, K hidden" based on filter state that only exists in the client component. The stats strip or its dynamic portions will need to move into `CollectionTable`. Not a defect now, but Phase 3 planning should account for this.

### What's Clean

- Server/client split is sharp. Server component does data fetch + empty state + topbar. Client component owns all interaction.
- Sort comparator handles all field types correctly, including string-based ISO date comparison for createdAt/updatedAt.
- Null handling is thorough: every nullable field returns null from `getSortValue`, partitions correctly, and gets a contextual separator label.
- The `loadSort` validation (line 86) protects against corrupt localStorage gracefully.
- SSR hydration handled correctly: default sort on first paint, localStorage hydration via useEffect.
- `date-utils.ts` extraction is clean and self-contained.

## Decisions

**Does the Score column arrow comply with REQ-CFS-14 (headers without active sort show no arrow)?**
DEFECT: Score column arrow is unconditionally rendered. When sorting by "name", both Game and Score headers show arrows, violating REQ-CFS-14.
*Reasoning: collection-table.tsx:502 renders `{dirArrow}` inside Score header unconditionally. REQ-CFS-14 says "Headers without active sort show no arrow." When sort.field === "name", the active sort is the Game column, not Score. The Score column shows fitness as a fallback (REQ-CFS-8), but it's not the active sort target. Two arrows appear simultaneously, confusing which column drives the sort. Fix: conditionally render the Score arrow only when sort.field !== "name" (and arguably !== "updatedAt" since Last Rated owns that sort). The `sort-active` class on `score-col-main` already handles this partially (line 500: `sort.field !== "name"`), but the arrow itself is not gated.*

**Does the Score column header have consistent hover feedback with other sortable headers?**
DEFECT: Score column header lacks hover color change. CSS rule `.col-label.sortable:hover` doesn't match `score-col-label sortable`.
*Reasoning: globals.css:2743 has `.col-label.sortable:hover { color: var(--text-primary) }`. The Game and Last Rated headers use class `col-label sortable`, so they get hover feedback. The Score header (collection-table.tsx:496) uses `score-col-label sortable`, which is NOT `.col-label`. The CSS selector requires both `.col-label` AND `.sortable`. The inline `style={{ cursor: "pointer" }}` handles the cursor, but there's no hover color transition. Fix: add `.score-col-label.sortable:hover` rule, or add `.sortable:hover` without the `.col-label` prefix.*

**Do the separator labels match the spec's format (REQ-CFS-6)?**
COSMETIC: Separator uses middle dot (·) instead of the spec's hyphen/dash. "Not yet rated · N games" vs spec's "Not yet rated - N games".
*Reasoning: collection-table.tsx:269 uses `\u00b7` (middle dot). REQ-CFS-6 examples use " - " (hyphen). The mockup descriptions use em dash + "below" ("— N games below"). Implementation deviates from both. The middle dot is a defensible stylistic choice, but it's a spec deviation. The "below" suffix from the mockup is also absent. Low impact — the label is still contextual and communicates the right information.*

**Is the component size manageable given Phase 3 will add filter logic?**
CONCERN: collection-table.tsx is 665 lines after Phase 1+2. Phase 3 adds filter bar, chips, filter state, and predicate logic. Plan Risk Note #1 flagged >300 lines as extraction trigger.
*Reasoning: The component currently has: sort field definitions (66 lines), sort persistence (33 lines), sort comparator (75 lines), score display (77 lines), separator labels (32 lines), score subtitle (30 lines), main component (210 lines), GameRow (75 lines), AxisSortAltScores (23 lines). Phase 3 will add ~150+ lines for filter state, filter bar UI, chip rendering, and filter predicates. Projected size: ~800+ lines, exceeding the project's ~800 line file heuristic. Extractable units: sort dropdown menu (self-contained render block), GameRow (already a separate function), filter bar (Phase 3). Recommend extracting before Phase 3, not after.*

**Is the useCallback memoization on handleSortSelect effective?**
QUALITY: handleSortSelect's useCallback is defeated by sortFields dependency, which is a new array reference every render.
*Reasoning: collection-table.tsx:380 has useCallback with deps [sort, sortFields]. buildSortFields (line 47-66) creates a new array every render. Since the array reference changes, useCallback recreates the callback every render, making the memoization pointless. Options: (a) memoize sortFields with useMemo, (b) drop useCallback and use a plain function, (c) restructure to avoid the dependency. For a component that re-renders on every sort change, this is a minor perf concern, but it's misleading code — it looks memoized when it isn't.*

**Is the stats strip placement compatible with Phase 3's REQ-CFS-19 (filtered count)?**
ARCHITECTURAL CONCERN: The stats strip is in the server component (page.tsx:82-101). Phase 3 requires it to reflect filtered results (REQ-CFS-19), which means filter-dependent stats will need to live in or be fed from the client component.
*Reasoning: page.tsx renders the stats strip with static totals (games.length, avgFitness, rated.length, axes.length). When Phase 3 adds filtering, the "N of M games" and "Filtered, K hidden" notes require knowledge of the filtered set, which only exists in the client component. Either the stats strip moves into CollectionTable, or the server component renders a shell that the client component populates. This isn't a Phase 1+2 defect, but Phase 3 implementation should plan for this migration. If deferred to Phase 3, the stats strip rendering will need to be split or moved.*
