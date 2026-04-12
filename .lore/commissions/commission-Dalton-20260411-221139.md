---
title: "Commission: Niche tag filtering: Phase 7 (CLI)"
date: 2026-04-12
status: blocked
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 7 of the niche tag filtering plan at `.lore/plans/niche-tag-filtering.md`.\n\nRead the full plan first. You are implementing:\n\n- `shelf-judge niche ignored` — lists currently ignored tags (text table or JSON with `--json`)\n- `shelf-judge niche ignore <type> <name>` — adds a tag to the ignore list (POST /niches/settings/ignore)\n- `shelf-judge niche unignore <type> <name>` — removes a tag (DELETE /niches/settings/ignore)\n\nCreate `packages/cli/src/commands/niche.ts` and register the `niche` command group in the CLI's command registry.\n\nValidation: `type` must be one of `mechanic`, `category`, `family`. Provide a helpful error message on invalid type.\n\nCheck how existing CLI commands are structured (e.g., `packages/cli/src/commands/`) for the registration and output patterns.\n\nRun `bun run test`, `bun run typecheck`, and `bun run lint` before declaring complete."
dependencies:
  - commission-Dalton-20260411-221125
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T05:11:39.796Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T05:19:25.235Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
current_progress: ""
projectName: shelf-judge
---
