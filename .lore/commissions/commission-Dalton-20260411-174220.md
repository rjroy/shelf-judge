---
title: "Commission: Implement niche champion display per plan"
date: 2026-04-12
status: cancelled
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement the niche champion display feature following the plan at `.lore/plans/niche-champion-display.md`. Read the full plan and the spec at `.lore/specs/niche-champion-display.md` before starting. The plan has 7 phases; execute all of them.\n\n## Phase 1: Shared Types\nAdd `NicheNeighbor`, `NicheEntry`, `NichePosition`, `NicheImpactEntry`, `NicheImpact` to `packages/shared/src/types.ts`. Extend `GameWithScore` with optional `nichePosition`. Extend `PredictedGameResponse` with optional `nicheImpact`.\n\n## Phase 2: Niche Engine\nCreate `packages/daemon/src/services/niche-engine.ts` as a pure-function module (no I/O, no service deps). Two functions:\n- `computeNichePositions(gamesWithScores)` — groups by mechanics/categories/families, filters min 2, ranks by fitness, handles ties, excludes vetoed/no-BGG games\n- `computeNicheImpact(existingGames, candidateGame, candidateScore)` — projects where a candidate would rank without mutating input\n\nFollow the algorithm in the plan exactly (rounding, tiebreakers, neighbor limits, sorting).\n\n## Phase 3: Niche Engine Tests\nCreate `packages/daemon/tests/niche-engine.test.ts`. The plan provides a detailed 8-10 game test fixture design and 16 specific test cases. Build all of them.\n\n## Phase 4: Daemon Route Integration\n- GET /games/:id gains `nichePosition` (load full collection via prediction service, compute, attach)\n- GET /games gains `?includeNiches=true` query param\n- GET /predictions/bgg/:bggId gains `nicheImpact`\n- Niche engine called from route handlers, NOT from services (per architectural decision)\n\n## Phase 5: Web UI\n- 5a: Update `lib/api.ts` listGames to support `includeNiches` param\n- 5b: Game detail page gains Niche Position panel (below score breakdown)\n- 5c: Collection page gains Show Niches toggle and Group by Niche view mode. Client-side filter intersection per plan. Discard niche groups with <2 filtered members.\n- 5d: Search preview gains Niche Impact section with \"Would be your Nth...\" display\n\n## Phase 6: CLI\n- 6a: `game <id>` shows niche position after fitness/tournament output\n- 6b: `scores --show-niches` flag adds niche column\n- 6c: `predict bgg <id>` shows niche impact\n\n## Phase 7: Validate Against Spec\nSub-agent validates every REQ-NICHE (1-33) against the implementation.\n\n## Verification\n- `bun run typecheck` must pass\n- `bun run lint` must pass\n- `bun run test` must pass\n- Both web and CLI client helpers updated (watch for client/daemon divergence)"
dependencies: []
linked_artifacts: []

resource_overrides:
  model: opus

activity_timeline:
  - timestamp: 2026-04-12T00:42:20.782Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T00:42:20.785Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T00:43:02.882Z
    event: status_cancelled
    reason: "Commission cancelled by user"
current_progress: ""
projectName: shelf-judge
---
