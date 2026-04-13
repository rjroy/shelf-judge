---
title: "Commission: Plan: Shelf Capacity"
date: 2026-04-13
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write an implementation plan at `.lore/plans/shelf-capacity.md` for the Shelf Capacity feature.\n\n**Inputs to read:**\n- `.lore/specs/shelf-capacity.md` (the spec, read fully, this is the source of truth for all requirements)\n- `.lore/designs/similarity-weighted-bin-packing.md` (the algorithm design, read fully, Layer 3 adapts this)\n- `.lore/mockups/mockup-shelf-game-dimensions.html` (game dimensions display + edit form)\n- `.lore/mockups/mockup-shelf-configuration.html` (shelf config settings page)\n- `.lore/mockups/mockup-shelf-capacity-indicator.html` (collection page capacity indicator)\n- `.lore/mockups/mockup-shelf-capacity-detail.html` (capacity detail view with assignments, grades)\n- `.lore/mockups/mockup-shelf-capacity-detail-empty.html` (empty/unconfigured states)\n\n**Code to read for current state:**\n- `packages/shared/src/types.ts` (Game type, shared types)\n- `packages/shared/src/schemas.ts` (Zod schemas)\n- `packages/daemon/src/services/` (game-service, fitness-service, storage patterns)\n- `packages/daemon/src/routes/` (route patterns, operation definitions)\n- `packages/daemon/src/services/feature-vector.ts` (composite distance, this feeds the algorithm's similarity function)\n- `packages/web/app/collection/page.tsx` (collection page)\n- `packages/web/app/games/[id]/page.tsx` (game detail page)\n- `packages/web/app/redundancy/page.tsx` (settings page pattern for shelf config page)\n- `packages/web/lib/api.ts` (web client helpers)\n- `packages/cli/src/commands/` (CLI command patterns)\n\n**Plan structure:** Break the work into ordered, right-sized phases that can each be a commission. Each phase should be a coherent chunk that fits comfortably in one context window. Include:\n- What each phase builds\n- Which files each phase touches\n- Dependencies between phases\n- What tests each phase needs\n- Review gates (every implementation phase gets a review)\n\n**The spec defines three implementation layers:**\n- Layer 1: Box Dimensions (types, manual entry UI/CLI, game detail display)\n- Layer 2: Shelf Configuration (data model, storage, CRUD API, web UI, CLI)\n- Layer 3: Capacity and Assignment (bin-packing algorithm implementation, capacity endpoint, web capacity indicator + detail view, CLI capacity commands)\n\nLayers 1 and 2 can be built in parallel. Layer 3 depends on both.\n\n**Critical architectural points to address in the plan:**\n- The bin-packing algorithm should be implemented as a standalone service with NO Shelf Judge domain knowledge (per the spec's constraints section). Layer 3 builds an adapter between Shelf Judge's data model and the algorithm's generic item/bin interface.\n- The algorithm's similarity function uses composite distance from `feature-vector.ts`. The plan must specify how this is wired through the adapter.\n- The algorithm is complex (4 phases, rotation logic, fitness functions, grading). Size the algorithm implementation phase appropriately. It may need its own commission or two, not lumped with the daemon routes.\n\n**Worker breakout section:** At the end of the plan, include a \"Commission Structure\" section that maps phases to the commission chain: which phases go to Dalton, which get Thorne reviews, where the review+fix gates are, and where parallel streams can fan out. Be explicit about dependencies between commissions. Follow these rules:\n- Every implementation commission gets a downstream Thorne review\n- Foundation phases get a review+fix gate before downstream phases fan out\n- Never fan out parallel commissions that touch the same files\n- Right-size commissions (2-3 phases each, not monoliths)\n- The algorithm implementation is its own stream (standalone, no domain coupling)\n\nFollow the project's existing plan conventions. Look at `.lore/plans/wishlist.md` and `.lore/plans/previously-owned.md` for format."
dependencies: []
linked_artifacts:
  - .lore/plans/shelf-capacity.md

activity_timeline:
  - timestamp: 2026-04-13T07:52:13.165Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T07:52:13.167Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-13T07:52:13.194Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-13T07:52:19.406Z
    event: progress_report
    reason: "Reading spec, algorithm design, existing plans, and mockups to gather context for the shelf capacity implementation plan."
  - timestamp: 2026-04-13T07:52:58.692Z
    event: progress_report
    reason: "Read spec, algorithm design, two existing plans (wishlist, previously-owned), and key code files (types, storage, routes, services, web client, collection page, game detail page). Now reading mockups and remaining code to finalize the plan."
  - timestamp: 2026-04-13T07:54:05.492Z
    event: progress_report
    reason: "All context gathered. Read spec (36 requirements), algorithm design (4-phase packing + grading), two reference plans for format, all relevant code files, mockups, and compendium guidance. Now writing the plan."
  - timestamp: 2026-04-13T07:58:44.306Z
    event: progress_report
    reason: "Plan written at .lore/plans/shelf-capacity.md. 12 phases across 3 layers + standalone algorithm. 20-commission chain with foundation gate, parallel fan-out (3 streams), and convergence for capacity integration. Reviewing for completeness against spec."
  - timestamp: 2026-04-13T07:59:37.772Z
    event: result_submitted
    reason: "Implementation plan written at `.lore/plans/shelf-capacity.md`.\n\n**Structure:** 12 phases across 3 layers plus a standalone bin-packing algorithm, mapped to a 20-commission chain.\n\n**Phase breakdown:**\n- Phase 1: Shared types (BoxDimensions + Shelf types + Game field)\n- Phases 2, 5: Layer 1 (box dimensions daemon, web display/edit, CLI)\n- Phases 3, 4, 6, 7: Layer 2 (shelf config storage, service, routes, web UI, CLI)\n- Phase 8: Standalone bin-packing algorithm (rotation, fitness, 4-phase packing, grading)\n- Phase 9: Adapter + capacity endpoint (bridges Shelf Judge data model to algorithm)\n- Phases 10, 11: Capacity web UI (collection indicator + detail page) + CLI\n- Phase 12: Full validation\n\n**Commission chain:** Foundation types get a review+fix gate (C1-C3), then three parallel streams fan out: Stream A (box dimensions, C4-C6), Stream B (shelf config, C7-C12), Stream C (algorithm, C13-C15). After all three converge, Stream D (capacity integration, C16-C19) and final validation (C20).\n\n**Key architectural decisions:**\n- Unconstrained-height shelves map to bins with height=10000, not dimensionless bins (preserves width/depth checking)\n- Algorithm module has zero imports from @shelf-judge/shared (standalone constraint)\n- Similarity function: adapter inverts compositeDistance (1 - distance.composite) via closure pattern\n- Separate PUT /games/:id/dimensions endpoint instead of extending ratings endpoint\n- Capacity computation uses gameService.listGames() for scored games (no duplicate fitness computation)"
  - timestamp: 2026-04-13T07:59:43.238Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Plan written at .lore/plans/shelf-capacity.md. 12 phases across 3 layers + standalone algorithm. 20-commission chain with foundation gate, parallel fan-out (3 streams), and convergence for capacity integration. Reviewing for completeness against spec."
projectName: shelf-judge
---
Implementation plan written at `.lore/plans/shelf-capacity.md`.

**Structure:** 12 phases across 3 layers plus a standalone bin-packing algorithm, mapped to a 20-commission chain.

**Phase breakdown:**
- Phase 1: Shared types (BoxDimensions + Shelf types + Game field)
- Phases 2, 5: Layer 1 (box dimensions daemon, web display/edit, CLI)
- Phases 3, 4, 6, 7: Layer 2 (shelf config storage, service, routes, web UI, CLI)
- Phase 8: Standalone bin-packing algorithm (rotation, fitness, 4-phase packing, grading)
- Phase 9: Adapter + capacity endpoint (bridges Shelf Judge data model to algorithm)
- Phases 10, 11: Capacity web UI (collection indicator + detail page) + CLI
- Phase 12: Full validation

**Commission chain:** Foundation types get a review+fix gate (C1-C3), then three parallel streams fan out: Stream A (box dimensions, C4-C6), Stream B (shelf config, C7-C12), Stream C (algorithm, C13-C15). After all three converge, Stream D (capacity integration, C16-C19) and final validation (C20).

**Key architectural decisions:**
- Unconstrained-height shelves map to bins with height=10000, not dimensionless bins (preserves width/depth checking)
- Algorithm module has zero imports from @shelf-judge/shared (standalone constraint)
- Similarity function: adapter inverts compositeDistance (1 - distance.composite) via closure pattern
- Separate PUT /games/:id/dimensions endpoint instead of extending ratings endpoint
- Capacity computation uses gameService.listGames() for scored games (no duplicate fitness computation)
