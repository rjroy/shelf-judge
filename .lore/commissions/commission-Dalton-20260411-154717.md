---
title: "Commission: Fix empty community stats per plan"
date: 2026-04-11
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Fix the empty community stats bug following the plan at `.lore/plans/fix-community-stats.md`. Read the full plan before starting. The plan has 7 steps; execute all of them.\n\nKey references:\n- Plan: `.lore/plans/fix-community-stats.md`\n- Issue: `.lore/issues/the-community-stats-are-empty.md` (resolved status, but the code fix is this commission)\n- Spec: `.lore/specs/collection-profiling.md`\n\nSummary of work:\n\n1. **Extract BGG value resolution** — Create `packages/shared/src/axis-utils.ts` with `resolveBggRawValue()` and `resolveAxisValues()`. Move the private function from `fitness-service.ts` to shared. Export from `packages/shared/src/index.ts`. Update fitness-service to import from shared.\n\n2. **Fix `computeAxisDistributions`** — Update `profile-engine.ts` to use `resolveAxisValues()` instead of reading `game.ratings` directly.\n\n3. **Fix `encodeGame`** — Update `feature-vector.ts` to accept resolved axis values and normalize using native scales. Update callers in `profile-engine.ts` and `prediction-service.ts`.\n\n4. **Fix collection sorting** — Update `packages/web/lib/collection-utils.ts` to use `resolveAxisValues` for BGG-sourced axis sort fields. Thread `axes` through to `getSortValue`/`sortGames`.\n\n5. **Delete stale profile cache** — Document that `~/.shelf-judge/profile.json` needs deletion after deploy.\n\n6. **Tests** — `packages/shared/tests/axis-utils.test.ts` (new), updates to profile engine tests, collection-utils tests. Cover all cases listed in the plan.\n\n7. **Validation** — Sub-agent verifies all goals are met, including no fitness score regression.\n\n## Verification\n- `bun run typecheck` must pass\n- `bun run lint` must pass\n- `bun run test` must pass"
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-11T22:47:17.882Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T22:47:17.884Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
