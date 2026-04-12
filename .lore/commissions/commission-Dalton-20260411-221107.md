---
title: "Commission: Niche tag filtering: Phases 1-5 (backend foundation)"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 1-5 of the niche tag filtering plan at `.lore/plans/niche-tag-filtering.md`.\n\nRead the full plan first. You are implementing:\n\n- **Phase 1**: Shared types (`NicheTagFilter`, `NicheSettings`) in `packages/shared/src/types.ts`\n- **Phase 2**: Storage layer (default constant, storage interface, storage implementation) in `niche-engine.ts` and `storage-service.ts`\n- **Phase 3**: Niche engine integration (filter parameter on `buildAttributeIndex`, `computeNichePositions`, `computeNicheImpact`)\n- **Phase 4**: Daemon routes (CRUD endpoints in new `routes/niche.ts`, pass settings to all three niche engine call sites, register routes)\n- **Phase 5**: Tests (niche engine filter tests, route CRUD tests)\n\nThe plan has detailed implementation guidance for each phase including exact file paths, line references, and code sketches. Follow the established patterns described there (prediction-settings pattern for storage, existing test fixtures for tests).\n\nKey constraints:\n- Niche engine must remain pure (no I/O). Settings are loaded in route handlers and passed as parameters.\n- `buildAttributeIndex` ignore set should be O(1) lookup via `Set<string>` keyed by `\"${type}:${name}\"`.\n- `computeNichePositions` and `computeNicheImpact` settings parameter should be optional with `DEFAULT_NICHE_SETTINGS` default for backward compatibility.\n- Route handlers load niche settings once per request and pass to niche engine functions.\n- Add `storageService` to `GameRoutesDeps` and `PredictionRoutesDeps` as described in the plan's Phase 4b decision.\n\nRun `bun run test`, `bun run typecheck`, and `bun run lint` before declaring complete."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T05:11:07.947Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T05:11:07.949Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
