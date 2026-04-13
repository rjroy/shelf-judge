---
title: "Commission: Previously Owned: CLI Commands (Phase 6)"
date: 2026-04-13
status: pending
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 6 of the previously-owned feature: CLI commands.\n\n**Read these first:**\n- `.lore/plans/previously-owned.md` (Phase 6 in detail)\n- `.lore/specs/previously-owned.md` (REQ-PREV-27, REQ-PREV-28, REQ-PREV-29)\n- `packages/cli/src/commands/game.ts` (existing game commands)\n- `packages/cli/src/commands/` (command registry, existing patterns)\n- `packages/cli/src/` (daemon client, check if `patch` method exists)\n\n**What to build:**\n- `gameSetStatus` command: `shelf-judge game set-status <id> <owned|previously-owned>`\n  - Text output: `\"<game name>\" marked as <status>.`\n  - JSON output: full updated Game object\n- `--ownership` flag on `gameList`: appends `?ownership=<value>` to GET /games. Values: `owned` (default), `previously-owned`, `all`. Previously-owned games in table output get a visual marker (e.g., `[prev]` prefix/suffix).\n- Register `set-status` in the game command group\n- If the CLI client lacks a `patch` method, add one following the existing `post`/`put`/`delete` pattern\n\n**Verification:** `bun run typecheck`, `bun run lint`. Test against running daemon."
dependencies:
  - commission-Dalton-20260412-174425
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-13T00:45:06.877Z
    event: created
    reason: "Commission created"
current_progress: ""
projectName: shelf-judge
---
