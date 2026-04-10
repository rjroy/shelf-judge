---
title: "Commission: Utility Curves Phase 3: Fitness Service Integration"
date: 2026-04-10
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 3 of the utility curves plan at `.lore/plans/utility-curves.md`.\n\n**Files**: `packages/daemon/src/services/fitness-service.ts`, `packages/daemon/tests/fitness-service.test.ts`\n\nThis is the critical integration phase. The fitness service is the only consumer of the curve engine.\n\nKey changes:\n1. **Replace `resolveBggRating`**: Split into `resolveBggRawValue` (returns raw native-scale BGG value, no `* 2` normalization) and let the curve engine handle normalization.\n2. **Scoring loop**: For each axis: determine raw value → get native scale → check veto → apply preference curve → compute higher-is-better baseline for highlighting → build expanded breakdown entry → accumulate weighted sum.\n3. **Veto handling**: When veto triggers, continue processing all axes for full breakdown. Compute hypothetical score. Set actual score to 0. Record which axis triggered the veto.\n4. **`bggOriginal` semantics change**: Now stores raw BGG value in native-scale terms (e.g., 2.9 for weight, not 5.8).\n5. **Backward compatibility**: Existing personal axis scores must be identical. BGG communityRating scores identical. BGG complexity scores shift as documented in the plan.\n\nWrite comprehensive tests per the plan's Phase 3 Tests section:\n- Full scoring with each preference shape\n- Veto triggers (score=0, hypothetical correct, breakdown complete)\n- Curve-affected highlighting\n- Missing curve config (default behavior)\n- Removing a curve (back to higher-is-better)\n- Multiple vetoes\n- Backward compatibility test comparing old vs new scoring\n- curveAffected threshold boundary test\n\nRun `bun run test` and `bun run typecheck` before declaring complete."
dependencies:
  - commission-Dalton-20260409-200801
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T03:08:18.736Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T03:08:18.738Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-10T03:24:26.116Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-10T03:24:26.118Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
