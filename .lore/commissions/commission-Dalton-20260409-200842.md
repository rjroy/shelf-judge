---
title: "Commission: Utility Curves Phase 4: API and Service Layer"
date: 2026-04-10
status: blocked
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 4 of the utility curves plan at `.lore/plans/utility-curves.md`.\n\n**Files**: `packages/daemon/src/routes/axes.ts`, `packages/daemon/src/services/axis-service.ts`, `packages/daemon/tests/` (route tests)\n\nKey changes:\n1. **Axis service**: Update `createAxis` and `updateAxis` to pass through curve fields (preferenceShape, idealValue, tolerance, leanDirection, veto).\n2. **Cross-field validation** at the service level:\n   - sweet-spot requires idealValue within native scale\n   - Updating to sweet-spot without idealValue: check if already stored\n   - Changing away from sweet-spot: clear idealValue, tolerance, leanDirection\n3. **Route changes**: Operation descriptions updated. Routes already accept new fields via Zod schemas from Phase 1.\n\nWrite route-level tests using `app.request()`:\n- Create axis with curve config\n- Update axis to sweet-spot (idealValue required)\n- Update from sweet-spot to higher-is-better (stale config cleared)\n- Create/update axis with veto\n- Existing payloads without curve fields still work\n\nRun `bun run test` and `bun run typecheck` before declaring complete."
dependencies:
  - commission-Dalton-20260409-200833
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T03:08:42.925Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T03:08:42.926Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
current_progress: ""
projectName: shelf-judge
---
