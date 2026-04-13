---
title: "Commission: Shelf Capacity: Bin-Packing Algorithm (C13)"
date: 2026-04-13
status: pending
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 8 of the shelf capacity feature: the standalone bin-packing algorithm.\n\n**Read these first:**\n- `.lore/designs/similarity-weighted-bin-packing.md` (the algorithm design, read FULLY, this is the source of truth)\n- `.lore/plans/shelf-capacity.md` (Phase 8 in detail, types, test list)\n\n**CRITICAL CONSTRAINT:** This module has NO imports from `@shelf-judge/shared`. It is a standalone algorithm module that operates on generic items and bins. No knowledge of games, shelves, fitness scores, or any Shelf Judge domain concept.\n\n**What to build in `packages/daemon/src/services/bin-packing.ts`:**\n\n1. **Types**: `PackItem`, `PackBin`, `PackConfig`, `PackResult`, `PackAssignment` (see plan Phase 8a)\n2. **Merge strategies**: All six (avg, geo, harmonic, max, min, geomax). The geomax formula: `(cap * product)^(1/(n+1))` where cap = max score\n3. **Rotation logic**: `findBestRotation` per the design doc's \"Rotation Algorithm\" section. `forceAxis0Width` locks axis 0.\n4. **Fitness functions**:\n   - `itemInBinFitness`: space + similarity + neighbor, weighted by `itemFitnessWeights`\n   - `binReadiness`: base + unsorted + neighbor, weighted by `binFitnessWeights`\n5. **Four-phase packing loop**:\n   - Phase 1: Place fixed items (location overrides)\n   - Phase 2: Place unambiguous items (fit exactly one bin)\n   - Phase 3: Greedy iterative fill (re-sort bins after every placement)\n   - Phase 4: Overflow (remaining items)\n6. **Post-placement dimension update**: Subtract rotated axis-0 from bin's remaining axis-0. Axes 1 and 2 unchanged.\n7. **Grading**: Per-bin grades (S/A/B/C/D/F) using normalization formula from design doc\n8. **Public API**: `pack(items, bins, config)` returns `PackResult`\n\n**Tests in `packages/daemon/tests/bin-packing.test.ts`:**\nHeavy coverage. See the plan's Phase 8 test list. Key edge cases:\n- Rotation: fits only when rotated, exactly shelf-sized, 0.1 too large\n- `forceAxis0Width` locks axis 0\n- Dimensionless items/bins\n- All six merge strategies with known inputs\n- Phase 2 unambiguous placement\n- Phase 3 re-sort after each placement\n- Phase 4 overflow\n- Grading distribution\n- Empty inputs\n\n**Verification:** `bun run test`, `bun run typecheck`, `bun run lint`."
dependencies:
  - commission-Dalton-20260413-150034
linked_artifacts: []

resource_overrides:
  model: opus

activity_timeline:
  - timestamp: 2026-04-13T22:02:40.790Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T22:10:22.777Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-13T22:16:42.787Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
current_progress: ""
projectName: shelf-judge
---
