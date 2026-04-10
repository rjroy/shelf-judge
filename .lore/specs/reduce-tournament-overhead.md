---
title: "Reduce tournament data overhead"
date: 2026-04-10
status: implemented
tags: [spec, tournament, storage, performance, data-model, migration]
modules: [shared, daemon]
related:
  - .lore/issues/reduce-tournament-overhead.md
  - .lore/specs/tournament-ranking.md
  - .lore/designs/mvp-data-model.md
  - .lore/brainstorms/collection-profiling.md
  - .lore/retros/tournament-stats-record-shape-mismatch.md
req-prefix: RTO
---

# Spec: Reduce Tournament Data Overhead

## Overview

The tournament system stores every comparison as a flat array in `tournament.json`. This has two costs: storage grows without bound, and every stats request scans the full array to derive wins, losses, and recent comparisons. At 400 games with active tournament use, the comparisons array can reach tens of thousands of entries, all parsed and scanned on every page load that shows tournament stats.

This spec promotes derived stats (wins, losses, recent opponents) from computed-on-read to cached-on-write, caps the per-game comparison history to a rolling window, and drops unbounded comparison storage. The active session's comparisons remain in memory for pair deduplication; completed session comparisons are pruned. Cached ELO scores become authoritative rather than derived from history.

## Entry Points

- Tournament data file grows large enough to slow reads (existing `tournament.json`).
- `deriveDisplayStats` performance degrades as comparisons array scales.
- User views game stats and system must scan the full history to compute wins/losses.

## Key Decision: Full History Recalculability Is Not Worth the Cost

The tournament spec (REQ-TOURN-7) requires ELO ratings to be recalculable from comparison history. The rationale was that if the algorithm changes (K-factor adjustment, formula change), scores could be replayed from scratch.

Three things weaken that rationale:

1. **The algorithm hasn't changed.** K-factor tuning was flagged as an open question, but the spec also made K-factor configurable via settings. Changing K-factor already works going forward without replay.

2. **Replay fidelity degrades anyway.** If the user deletes games, their comparisons are retained (REQ-TOURN-8) but the deleted game's stats are removed. Replaying those comparisons adjusts the surviving games' ratings, but the deleted game's rating is lost, making the replay subtly different from what happened live. Full recalculability is already approximate.

3. **The cost is paid on every read.** `deriveDisplayStats` scans every comparison to compute wins, losses, and recent opponents. This is O(n) per game, per request. The recalculability guarantee is a write-time benefit paid for at read-time, every time.

**Decision:** Make cached ELO scores and win/loss counts authoritative. Keep a rolling window of recent comparisons per game for the display requirement (REQ-TOURN-11). Drop the unbounded comparisons array. Supersede REQ-TOURN-7.

The tradeoff: changing the ELO formula retroactively becomes impossible. Changing K-factor still works going forward via the existing settings mechanism.

## Key Decision: Keep Completed Session Metadata, Drop Their Comparisons

Sessions serve two purposes: grouping comparisons during active play (pair dedup), and providing session history (how many sessions, when, what filters). The metadata is cheap (a few fields per session). The comparisons are what grows.

**Decision:** Completed sessions retain their metadata (id, filter, gameIds, comparisonCount, status, dates). Active session comparisons are stored for pair deduplication. When a session completes, its comparisons are pruned: per-game stats are already updated incrementally, and the rolling recent-comparisons window captures display needs.

## Requirements

### Data Model Changes

- REQ-RTO-1: `TournamentGameStats` MUST be expanded to include `wins` (number) and `losses` (number) alongside the existing `eloRating` and `comparisonCount`. These fields are updated incrementally on each comparison submission, not derived from scanning comparison history.

- REQ-RTO-2: `TournamentGameStats` MUST include a `recentComparisons` field: an array of the last 10 comparisons involving this game, ordered most-recent-first. Each entry records `opponentGameId` (string), `won` (boolean), and `createdAt` (ISO 8601 timestamp). This array is maintained as a capped FIFO: when a new comparison is added, the oldest entry is dropped if the array exceeds 10. The cap of 10 provides headroom above the 5 displayed (REQ-TOURN-11) to absorb deletions of opponent games without the visible list shrinking.

- REQ-RTO-3: The top-level `comparisons` array in `TournamentData` MUST be removed. Comparisons are no longer stored as a flat, unbounded collection.

- REQ-RTO-4: `TournamentSession` MUST include a `comparisons` field (array of `Comparison`) that is populated only while the session status is `"active"`. When a session is completed (status changes to `"completed"`), its `comparisons` array MUST be set to an empty array. The session's metadata (id, filter, gameIds, comparisonCount, status, dates) is retained.

- REQ-RTO-5: The `Comparison` type is unchanged: `id`, `gameAId`, `gameBId`, `winnerId`, `sessionId`, `createdAt`. It continues to exist as the unit of record within active sessions and within the `recentComparisons` rolling window (which uses a subset of these fields).

### Behavioral Changes

- REQ-RTO-6: `submitComparison` MUST update `TournamentGameStats` (the stored type) for both games in a single write: increment `comparisonCount`, update `eloRating`, increment `wins`/`losses`, and push to `recentComparisons` (with FIFO cap). The comparison MUST also be appended to the active session's `comparisons` array. This is the same incremental ELO update that exists today, plus the new cached fields.

- REQ-RTO-7: `deriveDisplayStats` (or its replacement) MUST read directly from the cached `gameStats` fields, not scan a comparisons array. The `opponentGameName` field in the display type (REQ-TOURN-11) is resolved at read time from the collection, not stored in the cache. Note: the existing comment on `TournamentGameStatsDisplay.recentComparisons` in `types.ts` reads "derived from comparison history (never cached)." This comment becomes incorrect and MUST be updated to reflect that the field is now read from the cached `TournamentGameStats.recentComparisons`.

- REQ-RTO-8: `getNextPair` MUST use the active session's `comparisons` array for same-session pair deduplication, not a top-level comparisons array. Behavior is otherwise unchanged from REQ-TOURN-14.

- REQ-RTO-9: `recalculate` (REQ-TOURN-7) MUST be removed as an operation. The API endpoint, CLI command, and any references to it are dropped. Cached stats are authoritative.

### Session Lifecycle

- REQ-RTO-10: When a session transitions from `"active"` to `"completed"` (by user action or by starting a new session), the session's `comparisons` array MUST be cleared to an empty array before the write to `tournament.json`. The session object itself is retained for history.

- REQ-RTO-11: When a game is deleted (REQ-TOURN-8, REQ-TOURN-15a), its `gameStats` entry is removed as before. Entries referencing the deleted game in other games' `recentComparisons` arrays are left intact. The `opponentGameName` field resolves to `null` at display time when the opponent game no longer exists in the collection (existing behavior from `RecentComparison`).

### Migration

- REQ-RTO-12: On first load of a `tournament.json` that contains a top-level `comparisons` array (pre-migration format), the daemon MUST perform a one-time migration: compute `wins`, `losses`, and `recentComparisons` for each game from the existing comparisons, populate those fields in `gameStats`, move any active session's comparisons into the session object (initializing the session's `comparisons` field to `[]` before populating it, since pre-migration sessions lack the field), clear completed sessions' comparisons, remove the top-level `comparisons` array, and save. The migration is idempotent: loading an already-migrated file is a no-op.

- REQ-RTO-13: The migration MUST NOT change ELO ratings or comparison counts. These are already cached in `gameStats` and are correct. The migration only adds the new fields (`wins`, `losses`, `recentComparisons`) and restructures where comparisons are stored. Note: the `wins` and `losses` computation during migration uses the raw comparison history (winner field), not ELO math, so the K-factor threshold does not affect the migration.

- REQ-RTO-14: The Zod validation schema for `TournamentData` MUST accept both the pre-migration format (top-level `comparisons` array present, sessions without `comparisons` field) and the post-migration format. The session `comparisons` field MUST be optional in the schema (defaulting to `[]` when absent) to handle pre-migration sessions that lack the field. After migration runs, only the post-migration format is written. This prevents validation errors during the migration window.

## Exit Points

| Exit                        | Triggers When                                            | Target                         |
| --------------------------- | -------------------------------------------------------- | ------------------------------ |
| Per-game comparison archive | User wants full historical record for a specific game    | [STUB: comparison-export]      |
| Algorithm change tooling    | K-factor or formula change needs retroactive application | [STUB: elo-replay-from-export] |

## Scope Exclusions

- **No export-before-prune.** The migration does not create a backup of the full comparisons array. The data is derivable from the cached stats (ELO, wins, losses) and the rolling window covers display needs. If export is wanted, it's a separate feature (stubbed above).
- **No schema versioning.** The migration is format-detected (presence/absence of top-level `comparisons`), not version-numbered. This matches the project's existing approach (utility curves spec applied transforms at calculation time).
- **No changes to session creation, filters, or pairing.** The adaptive pairing algorithm (REQ-TOURN-14) is unchanged. Session scoping (REQ-TOURN-12, REQ-TOURN-13) is unchanged.
- **No changes to display or API response shapes.** `TournamentGameStatsDisplay` is unchanged. The `RecentComparison` type is unchanged. Clients that consume the stats API see the same response shape. The implementation of `deriveDisplayStats` changes (reads from cache instead of scanning), but the output shape is identical.
- **`normalizeFitness` is unchanged.** The existing `normalizeFitness` operation reads from `gameStats` (not from comparisons) and is unaffected by this spec.

## Success Criteria

### Automated Tests (bun test)

- [ ] Submitting a comparison updates cached `wins`, `losses`, and `recentComparisons` in `gameStats`
- [ ] `recentComparisons` is capped at 10 entries (FIFO: oldest dropped)
- [ ] Display stats are derived from cached fields, not from scanning a comparisons array
- [ ] Completing a session clears its comparisons array while retaining metadata
- [ ] Pair deduplication reads from `session.comparisons`, not from a top-level `data.comparisons` field (verified by completing a session, starting a new one, and confirming old session's comparisons do not affect dedup)
- [ ] Migration: pre-migration format is correctly transformed on load
- [ ] Migration: ELO ratings and comparison counts are unchanged after migration
- [ ] Migration: for a constructed pre-migration fixture with known comparisons, `wins` and `losses` match hand-calculated values
- [ ] Migration: `recentComparisons` contains last 10 per game from old history, ordered most-recent-first
- [ ] Migration: active session comparisons are correctly moved to the session object (not lost, not duplicated)
- [ ] Migration: idempotent (running on already-migrated data is a no-op)
- [ ] Deleting a game leaves `recentComparisons` entries in other games' stats intact
- [ ] Zod schema accepts both pre-migration and post-migration formats
- [ ] `recalculate` endpoint/command is removed (returns 404 or equivalent)

### Manual Verification (demonstration)

- [ ] Submit 15 comparisons in a session, end the session, verify `tournament.json` has no comparisons in the completed session
- [ ] View game stats: wins, losses, and recent comparisons display correctly from cached data
- [ ] Load the daemon with a pre-migration `tournament.json`, verify no error is shown, stats display wins/losses/recent comparisons correctly, and the file on disk has no top-level `comparisons` field after load
- [ ] CLI `sj tournament stats` output is unchanged from user's perspective

## AI Validation

**Defaults** (apply unless overridden):

- Unit tests with mocked time/network/filesystem
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom:**

- Migration correctness: construct a pre-migration `tournament.json` with known comparisons, run migration, verify every field in `gameStats` matches hand-calculated values
- Regression: existing tournament test suite must pass with only the expected changes (recalculate removal, storage shape)
- Client grep: after implementation, grep all web and CLI files for references to the removed `recalculate` endpoint and the old top-level `comparisons` path

## Constraints

- Tournament data remains in `tournament.json`. No new files.
- No changes to `collection.json` or the collection data model.
- The `TournamentGameStatsDisplay` response shape is unchanged. Clients must not need updates beyond removing references to `recalculate`.
- The migration runs automatically on load. There is no manual migration step or CLI command.
- Single-user, local-only. No concurrent access concerns during migration.

## Superseded Requirements

This spec supersedes the following requirements from `.lore/specs/tournament-ranking.md`:

| Requirement                                     | Status               | Reason                                                                                                 |
| ----------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| REQ-TOURN-7 (recalculate from history)          | Superseded           | Cached stats are authoritative. Recalculate operation removed.                                         |
| REQ-TOURN-8 (deleted game comparisons retained) | Narrowed             | Deleted game comparisons are retained only in the rolling window and active session, not indefinitely. |
| REQ-TOURN-20 (`sj tournament recalculate`)      | Partially superseded | The `recalculate` subcommand is removed. All other CLI commands are unchanged.                         |

REQ-TOURN-1 (Comparison entity) and REQ-TOURN-3 (tournament.json structure) are modified by this spec but not superseded; the types still exist, their storage location changes.

## Context

- [Vision](.lore/vision.md): Transparency principle (Principle 2) is preserved. The display still shows wins, losses, recent opponents, and raw ELO alongside the normalized score. What changes is the source: cached fields instead of full-history derivation.
- [Tournament Spec](.lore/specs/tournament-ranking.md): The parent spec. This spec modifies its data model and removes the recalculate guarantee.
- [Collection Profiling Brainstorm](.lore/brainstorms/collection-profiling.md): Proposal 3 (Tournament/Fitness Divergence) reads comparison history for divergence analysis. This spec's rolling window preserves recent comparison patterns. Aggregate divergence (ELO vs axis score gap) is computed from cached stats, not raw history, which already works today via REQ-TOURN-18.
- [Tournament Stats Shape Mismatch Retro](.lore/retros/tournament-stats-record-shape-mismatch.md): Warns that changes to tournament data shape require grepping every client helper. This spec keeps the API response shape unchanged, but the removal of `recalculate` must be caught in both web and CLI.
- [MVP Data Model Design](.lore/designs/mvp-data-model.md): No migration framework exists. The migration approach here (format-detection on load, idempotent) follows the project's established pattern.
