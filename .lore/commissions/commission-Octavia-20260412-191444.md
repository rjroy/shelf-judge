---
title: "Commission: Rectify Shelf Capacity Spec Against Bin Packing Algorithm"
date: 2026-04-13
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Reconcile `.lore/specs/shelf-capacity.md` against the algorithm design at `.lore/designs/similarity-weighted-bin-packing.md`.\n\n**Read both documents fully first.**\n\nThe shelf-capacity spec has a \"Known Flaws\" section (Flaws 1-7) that identifies structural problems. The bin-packing algorithm design addresses several of these problems directly. Your job is to update the spec so it's consistent with the algorithm design, resolving known flaws where the algorithm provides the answer.\n\n**Key reconciliation points:**\n\n1. **Flaw 1 (volume pooling):** The spec defines `overflowing` as `totalCollectionCm3 > totalCapacityCm3`, which pools volume across mismatched shelves. The algorithm doesn't pool volume; it assigns items to specific bins with per-bin spatial tracking. The overflow computation should be driven by the algorithm's placement results, not aggregate volume math.\n\n2. **Flaw 2 (no assignment):** The spec explicitly defers game-to-shelf assignment. The algorithm IS an assignment algorithm. The spec's overflow list becomes a byproduct of running the packing algorithm: items in Phase 4 overflow are the ones that don't fit anywhere.\n\n3. **Flaw 3 (perShelfUtilization):** The algorithm produces per-bin results with actual contents. Utilization becomes concrete: which games are on which shelf, how full each shelf is.\n\n4. **Flaw 4 (unconstrained-height shelves):** The algorithm handles dimensionless bins. These map to unconstrained-height shelves.\n\n5. **Flaw 7 (overcomplicated):** The algorithm may simplify the spec by replacing the hand-built overflow logic with \"run the packer, report results.\"\n\n**What to produce:**\n\nUpdate `.lore/specs/shelf-capacity.md` in place. Specifically:\n- Revise the overflow computation requirements (REQ-SHELF-22 through REQ-SHELF-31) to be driven by the bin-packing algorithm's output rather than independent volume math\n- Update the `ShelfOverflow` response shape to reflect what the algorithm actually produces (per-bin assignments, overflow items from Phase 4, unfittable items)\n- Resolve each Known Flaw with a note about how the algorithm addresses it, or flag it as still unresolved if it is\n- Update the \"Scope Exclusions\" section since game-to-shelf assignment is no longer deferred (the algorithm provides it)\n- Keep Layers 1 (box dimensions) and 2 (shelf config) intact; they're clean. The changes are in Layer 3 (overflow computation) and how it consumes the algorithm\n- Reference `.lore/designs/similarity-weighted-bin-packing.md` as a related document\n\n**Also read for context:**\n- `.lore/brainstorms/shelf-layout-designer.md` (original proposals)\n- `.lore/vision.md` (principles, especially Principle 5 about shelf carrying capacity)\n\n**Do not** rewrite the algorithm design. That document stands on its own. The spec should reference it and define what the daemon API exposes from the algorithm's output."
dependencies: []
linked_artifacts:
  - .lore/specs/shelf-capacity.md

activity_timeline:
  - timestamp: 2026-04-13T02:14:44.005Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T02:14:44.009Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-13T02:14:44.035Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-13T02:15:55.907Z
    event: progress_report
    reason: "Read all four documents. Analyzing reconciliation points between the shelf-capacity spec and the bin-packing algorithm design. The algorithm resolves Flaws 1, 2, 3, 4, and 7 directly. Flaws 5 and 6 remain unresolved (they're about BGG data, not overflow computation). Drafting revisions to Layer 3 requirements and response shape."
  - timestamp: 2026-04-13T02:21:45.589Z
    event: result_submitted
    reason: "Reconciled `.lore/specs/shelf-capacity.md` against `.lore/designs/similarity-weighted-bin-packing.md`. Changes made:\n\n**Frontmatter and Overview:** Added algorithm design as related document. Removed FLAWED status marker. Rewrote overview to describe the algorithm-driven computation model.\n\n**Layer 3 Requirements (REQ-SHELF-22 through REQ-SHELF-31):** Replaced the hand-built overflow logic with algorithm-driven computation:\n- REQ-SHELF-22: Fit-checking now references algorithm's rotation logic with `force_axis_0_width: true`\n- REQ-SHELF-23: Unfittable games identified by pre-pass geometric check before algorithm runs\n- REQ-SHELF-24: Endpoint renamed from `shelf.overflow` to `shelf.capacity` (path: `/api/shelf/capacity`)\n- REQ-SHELF-25: Response type completely rewritten. `ShelfOverflow` replaced by `ShelfCapacityResult` with three key structures: `ShelfAssignment` (per-shelf contents, utilization, grade), `UnfittableEntry` (geometric failures), `OverflowEntry` (Phase 4 displaced games). Removed `totalCapacityCm3`, `totalCollectionCm3`, `perShelfUtilization`, and `overflowList`. No more aggregate volume math.\n- REQ-SHELF-27: Overflow is now Phase 4 output (displaced games), not a volume-based list with `cumulativeFreedCm3`/`wouldResolveOverflow`\n- REQ-SHELF-28: Unconstrained shelves map to dimensionless bins, participate fully in algorithm\n- REQ-SHELF-31: Added note that similarity function uses composite distance from `feature-vector.ts`\n\n**UI Requirements updated:** REQ-SHELF-36 now reports placement counts instead of volume percentages. REQ-SHELF-37 shows shelf assignments with grades, unfittable, and displaced sections. REQ-SHELF-40/41 CLI output matches new response shape. CLI command renamed from `overflow` to `capacity`.\n\n**Scope Exclusions:** Removed \"Game-to-shelf assignment\" and \"Optimal packing\" (algorithm provides both). Added \"Manual assignment overrides\" and \"Algorithm tuning UI\" as deferred items.\n\n**Exit Points:** Removed `shelf-assignment` stub. Added `manual-assignment`, `algorithm-tuning`, and `niche-annotations` stubs.\n\n**Known Flaws resolved:**\n- Flaw 1 (volume pooling): **Resolved.** Algorithm assigns per-bin, no pooling.\n- Flaw 2 (no assignment): **Resolved.** Algorithm IS assignment.\n- Flaw 3 (fictional utilization): **Resolved.** Concrete per-shelf data with actual contents.\n- Flaw 4 (display gap): **Resolved.** No aggregate volume percentages; placement counts instead.\n- Flaw 5 (BGG unverified): **Unresolved.** Unrelated to overflow computation.\n- Flaw 6 (refresh override): **Unresolved.** Unrelated to overflow computation. Recommended resolution added.\n- Flaw 7 (overcomplicated): **Partially resolved.** Simpler output model, but algorithm itself is substantial.\n\n**Constraints updated:** Added algorithm module isolation requirement (standalone service, no domain knowledge). Noted fitness score and feature vector dependencies."
  - timestamp: 2026-04-13T02:21:51.078Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Read all four documents. Analyzing reconciliation points between the shelf-capacity spec and the bin-packing algorithm design. The algorithm resolves Flaws 1, 2, 3, 4, and 7 directly. Flaws 5 and 6 remain unresolved (they're about BGG data, not overflow computation). Drafting revisions to Layer 3 requirements and response shape."
projectName: shelf-judge
---
Reconciled `.lore/specs/shelf-capacity.md` against `.lore/designs/similarity-weighted-bin-packing.md`. Changes made:

**Frontmatter and Overview:** Added algorithm design as related document. Removed FLAWED status marker. Rewrote overview to describe the algorithm-driven computation model.

**Layer 3 Requirements (REQ-SHELF-22 through REQ-SHELF-31):** Replaced the hand-built overflow logic with algorithm-driven computation:
- REQ-SHELF-22: Fit-checking now references algorithm's rotation logic with `force_axis_0_width: true`
- REQ-SHELF-23: Unfittable games identified by pre-pass geometric check before algorithm runs
- REQ-SHELF-24: Endpoint renamed from `shelf.overflow` to `shelf.capacity` (path: `/api/shelf/capacity`)
- REQ-SHELF-25: Response type completely rewritten. `ShelfOverflow` replaced by `ShelfCapacityResult` with three key structures: `ShelfAssignment` (per-shelf contents, utilization, grade), `UnfittableEntry` (geometric failures), `OverflowEntry` (Phase 4 displaced games). Removed `totalCapacityCm3`, `totalCollectionCm3`, `perShelfUtilization`, and `overflowList`. No more aggregate volume math.
- REQ-SHELF-27: Overflow is now Phase 4 output (displaced games), not a volume-based list with `cumulativeFreedCm3`/`wouldResolveOverflow`
- REQ-SHELF-28: Unconstrained shelves map to dimensionless bins, participate fully in algorithm
- REQ-SHELF-31: Added note that similarity function uses composite distance from `feature-vector.ts`

**UI Requirements updated:** REQ-SHELF-36 now reports placement counts instead of volume percentages. REQ-SHELF-37 shows shelf assignments with grades, unfittable, and displaced sections. REQ-SHELF-40/41 CLI output matches new response shape. CLI command renamed from `overflow` to `capacity`.

**Scope Exclusions:** Removed "Game-to-shelf assignment" and "Optimal packing" (algorithm provides both). Added "Manual assignment overrides" and "Algorithm tuning UI" as deferred items.

**Exit Points:** Removed `shelf-assignment` stub. Added `manual-assignment`, `algorithm-tuning`, and `niche-annotations` stubs.

**Known Flaws resolved:**
- Flaw 1 (volume pooling): **Resolved.** Algorithm assigns per-bin, no pooling.
- Flaw 2 (no assignment): **Resolved.** Algorithm IS assignment.
- Flaw 3 (fictional utilization): **Resolved.** Concrete per-shelf data with actual contents.
- Flaw 4 (display gap): **Resolved.** No aggregate volume percentages; placement counts instead.
- Flaw 5 (BGG unverified): **Unresolved.** Unrelated to overflow computation.
- Flaw 6 (refresh override): **Unresolved.** Unrelated to overflow computation. Recommended resolution added.
- Flaw 7 (overcomplicated): **Partially resolved.** Simpler output model, but algorithm itself is substantial.

**Constraints updated:** Added algorithm module isolation requirement (standalone service, no domain knowledge). Noted fitness score and feature vector dependencies.
