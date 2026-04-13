---
title: "Commission: Shelf Capacity: Review Algorithm (C14)"
date: 2026-04-13
status: pending
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the standalone bin-packing algorithm (Phase 8).\n\n**Context:**\n- `.lore/designs/similarity-weighted-bin-packing.md` (the algorithm design, read FULLY)\n- `.lore/plans/shelf-capacity.md` (Phase 8)\n\n**Review focus:**\n1. **Standalone constraint**: Verify NO imports from `@shelf-judge/shared`. The module must be domain-agnostic.\n2. **Rotation correctness**: Verify the rotation algorithm matches the design doc exactly. Test edge cases: fits only when rotated, exactly shelf-sized, axis locking.\n3. **Merge strategies**: Verify all six produce correct results. Especially geomax: `(cap * product)^(1/(n+1))`.\n4. **Fitness functions**: Verify space, similarity, and neighbor scoring match the design doc formulas.\n5. **Four-phase loop**: Verify Phase 3 re-sorts bins after every placement. Verify Phase 2 handles multiple unambiguous items targeting the same bin.\n6. **Post-placement**: Only axis-0 subtracted, not axes 1/2.\n7. **Grading**: Normalization ceiling, grade boundaries, edge cases (fewer than 5 bins).\n8. **Test coverage**: All edge cases from the plan's Phase 8 test list are covered.\n\n**Files:** `packages/daemon/src/services/bin-packing.ts`, `packages/daemon/tests/bin-packing.test.ts`\n\nThis is the most complex single module. Take time to verify the math. Record all findings."
dependencies:
  - commission-Dalton-20260413-150240
linked_artifacts: []

resource_overrides:
  model: opus

activity_timeline:
  - timestamp: 2026-04-13T22:02:52.226Z
    event: created
    reason: "Commission created"
current_progress: ""
projectName: shelf-judge
---
