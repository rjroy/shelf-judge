---
title: "Commission: Review: Collection Filter/Sort Phases 1-4"
date: 2026-04-07
status: dispatched
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Full review of the collection filter/sort implementation against the spec before tests are written.\n\n**Spec:** `.lore/specs/collection-filter-sort.md` — verify ALL 30 requirements (REQ-CFS-1 through REQ-CFS-30).\n**Plan:** `.lore/plans/collection-filter-sort.md` — all four phases.\n**Mockup:** `.lore/art/mockup-collection-filter-sort.html` — visual reference for all states.\n\n**Files to review:**\n- `packages/web/components/collection-table.tsx` (main client component)\n- `packages/web/lib/date-utils.ts` (utility)\n- `packages/web/app/page.tsx` (should be minimal: data fetch + CollectionTable)\n- `packages/web/app/globals.css` (new filter/sort CSS, old sort-toggle CSS removed)\n- Confirm `packages/web/components/collection-sort-toggle.tsx` is deleted\n\n**Systematic check:**\n1. Walk through every REQ-CFS-* requirement and verify it's implemented.\n2. Check component size: if CollectionTable exceeds ~300 lines, are sub-components extracted?\n3. Check CSS class names match mockup conventions, no collisions with existing classes.\n4. Check localStorage SSR handling (useEffect hydration, no hydration mismatch).\n5. Check mobile overlay has proper backdrop, 44px tap targets, close-on-selection.\n6. Check filter/sort interaction: filters applied before sort, separator reflects filtered results.\n7. Check no daemon API changes were made (REQ-CFS-27).\n8. Typecheck, lint, test status.\n9. Any dead code, unused imports, or remnants of the old sort toggle.\n\nRecord all findings in your commission result. This review gates the test-writing phase."
dependencies:
  - commission-Dalton-20260407-081548
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-07T15:16:01.389Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T15:20:49.755Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-07T15:39:35.491Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-07T15:39:35.494Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
