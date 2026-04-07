---
title: "Commission: Review: Collection Filter/Sort Phase 1+2"
date: 2026-04-07
status: dispatched
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the Phase 1+2 implementation of collection filter/sort.\n\n**Spec:** `.lore/specs/collection-filter-sort.md` — verify REQ-CFS-1 through REQ-CFS-14.\n**Plan:** `.lore/plans/collection-filter-sort.md` — Phases 1 and 2.\n**Mockup:** `.lore/art/mockup-collection-filter-sort.html` — visual reference.\n\n**Files to review:**\n- `packages/web/components/collection-table.tsx` (new client component)\n- `packages/web/lib/date-utils.ts` (new utility)\n- `packages/web/app/page.tsx` (should be stripped down to data fetching)\n- `packages/web/app/globals.css` (new sort/score CSS classes)\n\n**Check:**\n1. All sort fields from REQ-CFS-1 are present in the dropdown with correct grouping (REQ-CFS-3).\n2. Direction toggle works (REQ-CFS-2). Null values sort to bottom regardless of direction.\n3. Score column displays the active sort metric (REQ-CFS-8) with correct fallback for name sort.\n4. Score column header has two-line label with sort arrow (REQ-CFS-9).\n5. Column headers clickable where appropriate (REQ-CFS-11-14).\n6. Separator labels are contextual (REQ-CFS-5-7).\n7. Axes Rated column context switch (REQ-CFS-10).\n8. localStorage persistence (REQ-CFS-21).\n9. Server/client component split is clean: server component has no sort/filter logic, client component has no data fetching.\n10. No regressions: typecheck, lint, tests pass.\n11. CSS class names match the mockup conventions.\n\nRecord all findings in your commission result."
dependencies:
  - commission-Dalton-20260407-081514
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-07T15:15:26.493Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T15:20:49.758Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
