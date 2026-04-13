---
title: "Commission: Rectify Shelf Capacity Spec Against Bin Packing Algorithm"
date: 2026-04-13
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Reconcile `.lore/specs/shelf-capacity.md` against the algorithm design at `.lore/designs/similarity-weighted-bin-packing.md`.\n\n**Read both documents fully first.**\n\nThe shelf-capacity spec has a \"Known Flaws\" section (Flaws 1-7) that identifies structural problems. The bin-packing algorithm design addresses several of these problems directly. Your job is to update the spec so it's consistent with the algorithm design, resolving known flaws where the algorithm provides the answer.\n\n**Key reconciliation points:**\n\n1. **Flaw 1 (volume pooling):** The spec defines `overflowing` as `totalCollectionCm3 > totalCapacityCm3`, which pools volume across mismatched shelves. The algorithm doesn't pool volume; it assigns items to specific bins with per-bin spatial tracking. The overflow computation should be driven by the algorithm's placement results, not aggregate volume math.\n\n2. **Flaw 2 (no assignment):** The spec explicitly defers game-to-shelf assignment. The algorithm IS an assignment algorithm. The spec's overflow list becomes a byproduct of running the packing algorithm: items in Phase 4 overflow are the ones that don't fit anywhere.\n\n3. **Flaw 3 (perShelfUtilization):** The algorithm produces per-bin results with actual contents. Utilization becomes concrete: which games are on which shelf, how full each shelf is.\n\n4. **Flaw 4 (unconstrained-height shelves):** The algorithm handles dimensionless bins. These map to unconstrained-height shelves.\n\n5. **Flaw 7 (overcomplicated):** The algorithm may simplify the spec by replacing the hand-built overflow logic with \"run the packer, report results.\"\n\n**What to produce:**\n\nUpdate `.lore/specs/shelf-capacity.md` in place. Specifically:\n- Revise the overflow computation requirements (REQ-SHELF-22 through REQ-SHELF-31) to be driven by the bin-packing algorithm's output rather than independent volume math\n- Update the `ShelfOverflow` response shape to reflect what the algorithm actually produces (per-bin assignments, overflow items from Phase 4, unfittable items)\n- Resolve each Known Flaw with a note about how the algorithm addresses it, or flag it as still unresolved if it is\n- Update the \"Scope Exclusions\" section since game-to-shelf assignment is no longer deferred (the algorithm provides it)\n- Keep Layers 1 (box dimensions) and 2 (shelf config) intact; they're clean. The changes are in Layer 3 (overflow computation) and how it consumes the algorithm\n- Reference `.lore/designs/similarity-weighted-bin-packing.md` as a related document\n\n**Also read for context:**\n- `.lore/brainstorms/shelf-layout-designer.md` (original proposals)\n- `.lore/vision.md` (principles, especially Principle 5 about shelf carrying capacity)\n\n**Do not** rewrite the algorithm design. That document stands on its own. The spec should reference it and define what the daemon API exposes from the algorithm's output."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-13T02:14:44.005Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T02:14:44.009Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
