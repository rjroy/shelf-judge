---
title: "Commission: Shelf Capacity: Adapter+Endpoint+Helpers (C16)"
date: 2026-04-13
status: pending
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 9 and Phase 10a of the shelf capacity feature: the capacity adapter, endpoint, and web client helper.\n\n**Read these first:**\n- `.lore/plans/shelf-capacity.md` (Phase 9 in detail, especially 9b through 9g)\n- `.lore/specs/shelf-capacity.md` (REQ-SHELF-16 through REQ-SHELF-25)\n- `packages/daemon/src/services/bin-packing.ts` (the algorithm you're adapting)\n- `packages/daemon/src/services/feature-vector.ts` (compositeDistance, buildVocabulary, encodeGame)\n- `packages/daemon/src/routes/games.ts` (applyRedundancy helper shows the feature vector pattern)\n- `packages/daemon/src/services/game-service.ts` (listGames returns GameWithScore[])\n\n**What to build:**\n\n1. **Capacity service** (`capacity-service.ts`): adapter between Shelf Judge data and the algorithm\n2. **Pre-pass unfittable check** (REQ-SHELF-17, REQ-SHELF-20): scan dimensioned games against all shelves before the algorithm runs. Unfittable games get a human-readable reason string.\n3. **Item-to-game mapping**: Convert games to PackItems. The compare closure inverts compositeDistance (similarity = 1 - composite). Pre-encode all games into FeatureVectors using buildVocabulary/computeContinuousRanges/encodeGame.\n4. **Bin-to-shelf mapping**: Unconstrained-height shelves map to bins with height 10000 (NOT dimensionless bins). Width/depth still checked.\n5. **Response assembly**: Map PackResult back to ShelfCapacityResult. Per-shelf assignments with utilization, unfittable list, overflow list, grades.\n6. **Edge cases**: no config (configured: false), no dimensioned games, mixed dimensioned/undimensioned\n7. **Route**: Add `GET /shelf/capacity` to shelf routes\n8. **Web client helper**: `getShelfCapacity()` in `api.ts`\n\n**Config defaults** (from plan):\n```\nmergeStrategy: \"geomax\"\nbinFitnessWeights: { base: 0.20, unsorted: 0.70, neighbor: 0.10, topN: 1 }\nitemFitnessWeights: { space: 0.10, game: 0.80, neighbor: 0.10 }\nminRemainder: [0.25, 3, 4]\nforceAxis0Width: true\n```\n\n**Tests** in `capacity-service.test.ts` and `shelf-routes.test.ts` (see plan Phase 9 test list).\n\n**Verification:** `bun run test`, `bun run typecheck`, `bun run lint`."
dependencies:
  - commission-Dalton-20260413-150119
  - commission-Dalton-20260413-150218
  - commission-Dalton-20260413-150257
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-13T22:03:19.777Z
    event: created
    reason: "Commission created"
current_progress: ""
projectName: shelf-judge
---
