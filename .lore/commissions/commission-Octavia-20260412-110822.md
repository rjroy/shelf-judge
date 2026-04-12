---
title: "Commission: Plan: Redundancy Setting Move"
date: 2026-04-12
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Prepare an implementation plan for the issue at `.lore/issues/redundancy-setting-move.md`.\n\nThe issue: The redundancy settings UI is currently embedded in the Collection page. It needs to move to its own dedicated page under a \"Settings\" section in the sidebar (alongside the existing \"Import BGG\" and \"Axes\" entries). The new page should be called \"Redundancy\" (or similar). It also needs a Save button that both persists the settings AND triggers fitness regeneration in one action, replacing the current behavior where settings auto-save but regeneration is a separate manual step.\n\nRead the issue file, then explore the current implementation to understand:\n1. Where the redundancy settings UI currently lives in `packages/web/`\n2. How the sidebar navigation is structured\n3. How redundancy settings are persisted (daemon API)\n4. How fitness regeneration is triggered\n5. How other settings pages (Import BGG, Axes) are structured as reference patterns\n\nThen write a plan to `.lore/plans/redundancy-setting-move.md` covering:\n- What moves, what's new, what changes\n- Frontend: new page, sidebar entry, save+regenerate button\n- Daemon: any API changes needed (or confirmation none are needed)\n- Migration path (remove from Collection page, add to Settings section)\n- Ordered phases suitable for commissioning to Dalton"
dependencies: []
linked_artifacts:
  - .lore/plans/redundancy-setting-move.md

activity_timeline:
  - timestamp: 2026-04-12T18:08:22.285Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T18:08:22.291Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T18:08:22.315Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T18:08:33.010Z
    event: progress_report
    reason: "Reading issue file and exploring current implementation to understand redundancy settings UI, sidebar structure, and related patterns."
  - timestamp: 2026-04-12T18:09:07.918Z
    event: progress_report
    reason: "Finished code exploration. Understand: sidebar nav structure, redundancy settings component (auto-save via debounced PATCH), normalize-fitness button (POST to /tournament/normalize-fitness), collection page embedding, and settings page patterns. Now checking for existing plans/specs and consulting compendium before writing."
  - timestamp: 2026-04-12T18:10:31.911Z
    event: result_submitted
    reason: "Plan written to `.lore/plans/redundancy-setting-move.md`.\n\nFour phases:\n1. **New page + sidebar entry** — Create `packages/web/app/redundancy/page.tsx`, add \"Redundancy\" to sidebar Settings group\n2. **Save + Regenerate button** — Replace auto-save with local state and explicit \"Save & Regenerate\" that PATCHes settings then POSTs normalize-fitness\n3. **Remove from Collection** — Strip `RedundancySettingsPanel` from Collection page (keep `isIntegrated` check for table)\n4. **Cleanup** — Delete old component file, run typecheck/lint/test\n\nNo daemon API changes needed. Suggested commission split: Dalton gets phases 1+2 and 3+4 as two commissions, Thorne reviews."
  - timestamp: 2026-04-12T18:10:38.941Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Finished code exploration. Understand: sidebar nav structure, redundancy settings component (auto-save via debounced PATCH), normalize-fitness button (POST to /tournament/normalize-fitness), collection page embedding, and settings page patterns. Now checking for existing plans/specs and consulting compendium before writing."
projectName: shelf-judge
---
Plan written to `.lore/plans/redundancy-setting-move.md`.

Four phases:
1. **New page + sidebar entry** — Create `packages/web/app/redundancy/page.tsx`, add "Redundancy" to sidebar Settings group
2. **Save + Regenerate button** — Replace auto-save with local state and explicit "Save & Regenerate" that PATCHes settings then POSTs normalize-fitness
3. **Remove from Collection** — Strip `RedundancySettingsPanel` from Collection page (keep `isIntegrated` check for table)
4. **Cleanup** — Delete old component file, run typecheck/lint/test

No daemon API changes needed. Suggested commission split: Dalton gets phases 1+2 and 3+4 as two commissions, Thorne reviews.
