---
title: "Commission: Redundancy Settings Page: Remove Old + Cleanup (Phases 3-4)"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 3-4 of the plan at `.lore/plans/redundancy-setting-move.md`. Read that plan thoroughly before starting.\n\n**Phase 3: Remove from Collection page**\n- Remove `RedundancySettingsPanel` import and render from `packages/web/app/collection/page.tsx`\n- Keep the `getRedundancySettings` fetch and `isIntegrated` variable (CollectionTable still needs it)\n- Keep `NormalizeFitnessButton` in the Collection topbar\n\n**Phase 4: Cleanup**\n- Check if `RedundancySettingsPanel` in `packages/web/components/redundancy-settings.tsx` is imported anywhere. If not, delete the file.\n- Remove any orphaned CSS classes from the collapsible header (`.redundancy-settings-toggle` etc.) in `globals.css` if no longer used\n- Run `bun run typecheck && bun run lint && bun run test` to confirm no dangling references\n- Navigate logic: verify Collection, Redundancy settings, Axes, Import pages all work correctly"
dependencies:
  - commission-Dalton-20260412-115035
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T18:50:42.857Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T18:50:42.859Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T18:56:55.058Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T18:56:55.060Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
