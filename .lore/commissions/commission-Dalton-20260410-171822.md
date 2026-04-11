---
title: "Commission: Prediction Engine Phase 6: CLI"
date: 2026-04-11
status: pending
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 6 of `.lore/plans/prediction-engine.md`: CLI.\n\n**Files created:**\n- `packages/cli/src/commands/predict.ts` — `predict <game-id>` (breakdown with predicted axes, confidence, reference games, tension) and `predict readiness` (stage, weak axes, suggested actions)\n- `packages/cli/tests/commands/predict.test.ts`\n\n**Files modified:**\n- `packages/cli/src/index.ts` — register predict commands\n- `packages/cli/src/commands/score.ts` — add `--include-predicted` flag calling `GET /api/games?includePredicted=true`, predicted scores show `[P]` marker\n- `packages/cli/src/output.ts` — update BreakdownEntry type if needed\n\nAll commands support `--json`. Run `bun run test`, `bun run typecheck`, `bun run lint`."
dependencies:
  - commission-Dalton-20260410-171758
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-11T00:18:22.218Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T00:20:46.078Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-11T00:47:17.230Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
current_progress: ""
projectName: shelf-judge
---
