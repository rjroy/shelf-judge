---
title: "Commission: Tournament Phase 6: CLI Commands"
date: 2026-04-06
status: pending
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 6 from `.lore/plans/tournament-ranking.md`.\n\n**New file:** `packages/cli/src/commands/tournament.ts`\n- 6 commands: tournament start, next, pick, stop, stats, recalculate\n- All support --json output\n- --filter flags: `--filter name:<value>`, `--filter fitness:<min>`, `--filter tag:<name>`, `--filter stale:<n>`\n\n**Modified files:**\n- `packages/cli/src/index.ts`: register tournament commands in COMMANDS map and switch\n- `packages/cli/src/commands/game.ts`: add Rank column to game list output when tournament data exists\n- `packages/cli/src/commands/score.ts`: add tournament rank alongside axis fitness, divergence flag\n\n**Arg parsing:** Extend parseArgs for --filter flag collection (type:value format).\n\n**Output formatting:** Follow plan's Phase 6 section for exact output formats per command.\n\n**Tests:** Unit tests for --filter arg parsing. All commands in both human and --json modes.\n\nRun `bun run test`, `bun run typecheck`, `bun run lint`."
dependencies:
  - commission-Dalton-20260406-153912
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T22:39:40.660Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T22:39:40.661Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-06T23:20:14.871Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
current_progress: ""
projectName: shelf-judge
---
