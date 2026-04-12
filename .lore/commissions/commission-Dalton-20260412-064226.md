---
title: "Commission: Redundancy scoring: Phase 11 (CLI)"
date: 2026-04-12
status: pending
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 11 of the redundancy scoring plan at `.lore/plans/redundancy-scoring.md`.\n\nRead the full plan first. You are implementing:\n\n- **11a**: New file `packages/cli/src/commands/redundancy.ts` with commands:\n  - `shelf-judge redundancy settings` — display current settings\n  - `shelf-judge redundancy enable` / `disable` — toggle\n  - `shelf-judge redundancy stage <annotation|integrated>` — set stage\n  - `shelf-judge redundancy set <key> <value>` — set individual settings (parse numeric values, JSON for componentWeights)\n\n- **11b**: Modify `packages/cli/src/commands/score.ts`:\n  - `scoreGet()`: append redundancy data when `redundancyAdjustment` is non-null (penalty, adjusted score, niche rank, top neighbors)\n  - `scoreList()`: add `--show-redundancy` flag for annotation mode adjusted scores column\n\n- **11c**: Modify `packages/cli/src/commands/predict.ts`:\n  - `predictBggGame()`: show redundancy preview when non-null (penalty, top 3 similar games)\n\nRegister the `redundancy` command group in the CLI's command registry. Follow the niche command pattern at `packages/cli/src/commands/niche.ts`.\n\nRun `bun run test`, `bun run typecheck`, and `bun run lint` before declaring complete."
dependencies:
  - commission-Dalton-20260412-064203
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T13:42:26.133Z
    event: created
    reason: "Commission created"
current_progress: ""
projectName: shelf-judge
---
