---
title: "Commission: Niche champion display: Phase 1-3 (types, engine, tests)"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 1-3 of the niche champion display plan at `.lore/plans/niche-champion-display.md`. Read the full plan and spec at `.lore/specs/niche-champion-display.md` before starting. Only implement Phases 1-3.\n\n## Phase 1: Shared Types\nAdd `NicheNeighbor`, `NicheEntry`, `NichePosition`, `NicheImpactEntry`, `NicheImpact` to `packages/shared/src/types.ts`. Extend `GameWithScore` with optional `nichePosition`. Extend `PredictedGameResponse` with optional `nicheImpact`. Export all new types.\n\n## Phase 2: Niche Engine\nCreate `packages/daemon/src/services/niche-engine.ts` as a pure-function module (no I/O, no service deps). Two functions:\n- `computeNichePositions(gamesWithScores)` — groups by mechanics/categories/families, filters min 2, ranks by fitness, handles ties, excludes vetoed/no-BGG games\n- `computeNicheImpact(existingGames, candidateGame, candidateScore)` — projects where a candidate would rank without mutating input\n\nFollow the algorithm in the plan exactly (rounding, tiebreakers, neighbor limits, sorting).\n\n## Phase 3: Niche Engine Tests\nCreate `packages/daemon/tests/niche-engine.test.ts`. The plan provides a detailed 8-10 game test fixture design and 16 specific test cases. Build all of them.\n\n## Verification\n- `bun run typecheck` must pass\n- `bun run lint` must pass\n- `bun run test` must pass\n\nStop after Phase 3. Do not proceed to route integration or UI."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T00:44:35.840Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T00:44:35.842Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
