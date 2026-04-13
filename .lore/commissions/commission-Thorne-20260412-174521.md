---
title: "Commission: Previously Owned: Final Review (Phase 7)"
date: 2026-04-13
status: blocked
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Final review of the complete previously-owned feature implementation.\n\n**Read these for context:**\n- `.lore/specs/previously-owned.md` (all requirements REQ-PREV-1 through REQ-PREV-32)\n- `.lore/plans/previously-owned.md` (full plan, Phase 7 validation checklist)\n\n**Validation checklist from the plan:**\n1. Verify the PATCH endpoint is implemented and tested\n2. Verify both web client helpers AND CLI commands cover the new endpoint (check for client/daemon divergence)\n3. Verify ownership filtering happens at call sites in `games.ts`, NOT inside `computeRedundancyAdjustments` or `computeNichePositions` (REQ-PREV-8, REQ-PREV-9)\n4. Verify GET /games default returns only owned games (backward compatibility, REQ-PREV-17)\n5. Verify the owned-only computation universe is independent of the response filter (REQ-PREV-19)\n6. Verify reacquisition round-trip is tested: owned -> previously-owned -> owned, data intact\n7. Verify the wishlist add route's collection membership check queries all ownership statuses (REQ-PREV-31)\n8. Verify collection page and game detail page handle both owned and previously-owned states\n9. Verify CLI `set-status` command and `--ownership` flag on `list`\n10. Run `bun run test`, `bun run typecheck`, `bun run lint`\n\n**Files to review across all packages:**\n- `packages/shared/src/types.ts`\n- `packages/daemon/src/routes/games.ts`\n- `packages/daemon/src/services/game-service.ts`\n- `packages/daemon/tests/` (ownership tests)\n- `packages/web/lib/api.ts`\n- `packages/web/app/collection/page.tsx`\n- `packages/web/app/games/[id]/page.tsx`\n- `packages/web/app/globals.css`\n- `packages/cli/src/commands/game.ts`\n\nRecord all findings. This is the final gate before the feature ships."
dependencies:
  - commission-Dalton-20260412-174440
  - commission-Dalton-20260412-174450
  - commission-Dalton-20260412-174506
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-13T00:45:21.021Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T01:01:48.762Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
current_progress: ""
projectName: shelf-judge
---
