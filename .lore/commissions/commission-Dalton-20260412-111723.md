---
title: "Commission: Wishlist: CLI Commands (Phase 9)"
date: 2026-04-12
status: pending
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 9 of the wishlist feature plan at `.lore/plans/wishlist.md`. Read that plan thoroughly before starting.\n\nThis covers:\n- **Phase 9**: CLI commands (new file `packages/cli/src/commands/wishlist.ts`) + command registration\n\nCommands to implement following the niche command pattern (`packages/cli/src/commands/niche.ts`):\n- `wishlist list` - GET /api/wishlist, table output (Name, Year, Score, Confidence, Added)\n- `wishlist add <bggId>` - POST /api/wishlist\n- `wishlist remove <id>` - DELETE /api/wishlist/:id\n- `wishlist clear` - DELETE /api/wishlist (with confirmation prompt)\n- `wishlist refresh [id]` - POST /api/wishlist/:id/refresh or POST /api/wishlist/refresh\n\nAll commands must support `--json` output mode. Register the `wishlist` command group in the CLI command registry.\n\nThe spec is at `.lore/specs/wishlist.md` (REQ-WISH-25 through REQ-WISH-27).\n\nRun `bun run typecheck` and `bun run lint` before declaring complete."
dependencies:
  - commission-Dalton-20260412-111701
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T18:17:23.066Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T18:17:23.068Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T18:37:27.437Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
current_progress: ""
projectName: shelf-judge
---
