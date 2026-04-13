---
title: "Commission: Shelf Capacity: Box Dimensions Daemon+Web+CLI (C4)"
date: 2026-04-13
status: pending
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 2 and 5 of the shelf capacity feature: box dimensions across all layers.\n\n**Read these first:**\n- `.lore/plans/shelf-capacity.md` (Phases 2 and 5 in detail)\n- `.lore/specs/shelf-capacity.md` (REQ-SHELF-3 through REQ-SHELF-7, REQ-SHELF-26, REQ-SHELF-36)\n- `.lore/mockups/mockup-shelf-game-dimensions.html` (game detail display + edit form mockup)\n- `packages/daemon/src/routes/games.ts` (existing route patterns)\n- `packages/web/app/games/[id]/page.tsx` (game detail page)\n- `packages/web/lib/api.ts` (web client helpers)\n- `packages/cli/src/commands/game.ts` (CLI command patterns)\n\n**Phase 2: Daemon**\n- Add `PUT /games/:id/dimensions` endpoint\n- Zod validation: all three dimensions required, > 0, <= 40 in; or `{ clear: true }` to set null\n- Operation definition for the new endpoint\n- Tests: valid dimensions, clear, partial rejected, out-of-range rejected, legacy backfill\n\n**Phase 5: Web + CLI**\n- Web client helper: `setGameDimensions`\n- Game detail page: show \"Box: W x H x D in\" or \"Box: not measured\" (match mockup)\n- Box dimensions edit form: three numeric inputs, clear button (match mockup)\n- CLI: `--box-width`, `--box-height`, `--box-depth` flags on game edit, `--clear-box` flag\n\n**Verification:** `bun run test`, `bun run typecheck`, `bun run lint`. Manual verification against mockup."
dependencies:
  - commission-Dalton-20260413-150034
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-13T22:00:49.204Z
    event: created
    reason: "Commission created"
current_progress: ""
projectName: shelf-judge
---
