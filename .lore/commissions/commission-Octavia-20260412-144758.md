---
title: "Commission: Plan: Previously Owned State"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write an implementation plan at `.lore/plans/previously-owned.md` for the Previously Owned State feature.\n\n**Inputs to read:**\n- `.lore/specs/previously-owned.md` (the spec — read fully, this is the source of truth for requirements)\n- `.lore/mockups/mockup-previously-owned-collection.html` (Sienna's collection page mockup — read for visual direction and component structure)\n- `.lore/mockups/mockup-previously-owned-game-detail.html` (Sienna's game detail page mockup — read for visual direction and component structure)\n- `.lore/brainstorms/previously-owned-state.md` (original brainstorm for additional context)\n\n**Code to read for current state:**\n- `packages/shared/src/types.ts` (Game type, shared types)\n- `packages/shared/src/schemas.ts` (Zod validation schemas)\n- `packages/daemon/src/services/game-service.ts` (game CRUD, listGames)\n- `packages/daemon/src/services/fitness-service.ts` (fitness scoring pipeline)\n- `packages/daemon/src/services/redundancy-engine.ts` (redundancy computation)\n- `packages/daemon/src/services/niche-engine.ts` (niche computation)\n- `packages/daemon/src/routes/games.ts` (game API routes)\n- `packages/web/app/collection/page.tsx` (collection page)\n- `packages/web/app/game/[id]/page.tsx` (game detail page)\n- `packages/cli/src/commands/` (CLI command structure)\n\n**Plan structure:** Break the work into ordered, right-sized phases that can each be a commission. Each phase should be a coherent chunk that fits in one context window. Include:\n- What each phase builds\n- Which files each phase touches\n- Dependencies between phases\n- What tests each phase needs\n- Review gates (every implementation phase gets a review)\n\n**Key architectural decisions to address:**\n- Where the ownership filter is applied (call sites before engines, not inside engines — per the brainstorm's interaction map)\n- Migration strategy for existing data (schema default vs explicit migration)\n- How the mockup visual patterns translate to actual component changes\n\nFollow the project's existing plan conventions. Look at `.lore/plans/wishlist.md` for format."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T21:47:58.945Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T21:47:58.947Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
