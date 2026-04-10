---
title: "Commission: Review: Utility Curves Phase 5+6"
date: 2026-04-10
status: blocked
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review Phase 5 (Web UI) and Phase 6 (CLI) of the utility curves implementation.\n\nRead the plan at `.lore/plans/utility-curves.md` for Phase 5 and Phase 6 context.\n\n**Phase 5 (Web) checks:**\n1. Axis config UI: shape selector, sweet spot controls, curve preview, veto threshold config\n2. Score breakdown: raw vs effective columns, curve-affected highlighting, veto banner\n3. Collection table: veto badge display\n4. curve-math.ts: Does the client-side math match the daemon's curve-engine.ts?\n5. Local Axis type: Updated to include curve fields?\n6. API helpers: createAxis/updateAxis accept curve config?\n\n**Phase 6 (CLI) checks:**\n1. New flags: --shape, --ideal, --tolerance, --lean, --veto-below, --veto-above, --no-veto\n2. axisList: Shape column and veto indicator\n3. Score display: Raw column, curve-affected markers, veto output\n4. JSON output: Mirrors FitnessResult with all new fields\n5. Arg parsing: New flags recognized in index.ts\n\n**Cross-cutting:**\n- Native-scale values shown correctly for both personal and BGG axes (REQ-CURVE-26)\n- Veto display visually distinct from low scores (REQ-CURVE-22)\n\nRun `bun run test` and `bun run typecheck`.\n\nReport all findings."
dependencies:
  - commission-Dalton-20260409-200910
  - commission-Dalton-20260409-200920
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T03:09:29.609Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T03:09:29.611Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
current_progress: ""
projectName: shelf-judge
---
