---
title: "Commission: Utility Curves Phase 5: Web UI"
date: 2026-04-10
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 5 of the utility curves plan at `.lore/plans/utility-curves.md`.\n\n**Files**: `packages/web/app/axes/page.tsx`, `packages/web/components/score-breakdown.tsx`, `packages/web/app/games/[id]/page.tsx`, `packages/web/app/page.tsx`, `packages/web/components/collection-table.tsx`, `packages/web/lib/api.ts`, `packages/web/lib/curve-math.ts` (new), global CSS\n\n**IMPORTANT**: This commission runs in parallel with Phase 6 (CLI). Only touch web package files.\n\nKey changes:\n\n1. **Axis configuration** (axes page):\n   - Shape selector (radio/segmented: Higher is better, Lower is better, Sweet spot)\n   - Sweet spot controls: ideal value input, tolerance selector, lean direction toggle\n   - Curve preview: SVG/canvas showing the curve shape with live updates\n   - Veto threshold config: checkbox, direction, threshold value, confirmation dialog\n   - Update the local Axis type duplicate to include curve fields\n\n2. **Curve preview**: Create `packages/web/lib/curve-math.ts` with the same pure curve functions as curve-engine.ts for client-side computation. ~50 lines of duplicated math for instant preview updates.\n\n3. **Score breakdown** (game detail):\n   - Remove the broken \"scaled\" rendering logic (lines 42-43 of score-breakdown.tsx)\n   - Add Raw column showing native-scale values\n   - Rename Rating to Effective\n   - Highlight curve-affected rows\n   - Veto banner with triggering axis, threshold, raw value, hypothetical score\n\n4. **Collection table veto display**: VETOED badge for vetoed games, hypothetical score shown smaller underneath.\n\n5. **API updates**: Update createAxis/updateAxis in lib/api.ts to accept curve config.\n\nRead the plan's Phase 5 section carefully for all UI details.\n\nRun `bun run typecheck` before declaring complete. (Web components don't have unit tests per the plan.)"
dependencies:
  - commission-Dalton-20260409-200854
linked_artifacts: []

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
current_progress: ""
projectName: shelf-judge
---
