---
title: "Commission: Reduce Tournament Overhead Phase 1+2: Types, Validation, Migration"
date: 2026-04-10
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 1 and 2 of `.lore/plans/reduce-tournament-overhead.md`.\n\n**Phase 1: Shared Types and Validation**\n- Add `CachedRecentComparison` interface to shared types\n- Expand `TournamentGameStats` with `wins`, `losses`, `recentComparisons`\n- Add `comparisons` to `TournamentSession`\n- Remove `comparisons` from `TournamentData`\n- Update `TournamentGameStatsDisplay` comment\n- Re-export new types from index\n- Add `TournamentDataSchema` to validation.ts that accepts both pre-migration and post-migration formats\n- Add `TournamentSettingsSchema` for the stored format\n- Tests for schema accepting both formats, defaults applied correctly\n\n**Phase 2: Migration Module**\n- Create `packages/daemon/src/services/tournament-migration.ts` as a pure-function module\n- `migrateTournamentData(raw)` computes wins/losses/recentComparisons from comparison history, moves active session comparisons, caps recentComparisons at 10, removes top-level comparisons\n- Idempotent: already-migrated data passes through unchanged\n- Comprehensive tests in `packages/daemon/tests/tournament-migration.test.ts` covering all cases listed in the plan\n\nRead the full plan for detailed type definitions, schema shapes, migration steps, and test requirements. The plan is thorough; follow it closely.\n\nNote: Removing `comparisons` from `TournamentData` will cause typecheck failures in daemon code (tournament-service.ts, storage-service.ts, routes). That's expected. Typecheck should pass within `packages/shared/` and for the new migration module's own tests. Run `bun test` for shared and the new migration tests specifically.\n\nRun `bun run typecheck` on packages/shared to verify. Run the new tests. Existing daemon tests will fail due to type changes; that's Phase 3's concern."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T14:08:20.133Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T14:09:20.075Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
