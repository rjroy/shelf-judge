---
title: "Commission: Redundancy Settings Page: Final Review"
date: 2026-04-12
status: blocked
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the redundancy settings page move. Read the plan at `.lore/plans/redundancy-setting-move.md` and issue at `.lore/issues/redundancy-setting-move.md`.\n\nReview across:\n- `packages/web/app/redundancy/page.tsx` (new page)\n- `packages/web/components/sidebar.tsx` (new nav entry)\n- `packages/web/app/collection/page.tsx` (panel removed)\n- `packages/web/components/redundancy-settings.tsx` (should be deleted)\n- `packages/web/app/globals.css` (orphaned CSS removed)\n\nVerify:\n1. Redundancy settings page renders all controls (toggle, stage selector, sliders, weights, min/expected neighbors, reset)\n2. Save & Regenerate button: disabled when not dirty, PATCHes settings then POSTs normalize-fitness on click\n3. No auto-save behavior remains\n4. Collection page no longer shows redundancy settings panel but still has `isIntegrated` for the table\n5. NormalizeFitnessButton still present in Collection topbar\n6. Sidebar Settings group shows Axes, Redundancy, Import/BGG in correct order\n7. No dead imports or unused code\n8. Dark mode works correctly on the new page\n9. `bun run typecheck`, `bun run lint`, `bun run test` all pass\n\nSurface ALL findings."
dependencies:
  - commission-Dalton-20260412-115042
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T18:50:52.581Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T18:50:52.583Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
current_progress: ""
projectName: shelf-judge
---
