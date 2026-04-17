---
title: "Implementation plan: reduce-tournament-overhead"
date: 2026-04-10
status: executed
tags: [plan, tournament, storage, performance, data-model, migration]
modules: [shared, daemon, cli]
related:
  - .lore/specs/tournament/reduce-tournament-overhead.md
  - .lore/specs/tournament/tournament-ranking.md
  - .lore/designs/mvp-data-model.md
  - .lore/retros/incident/tournament-stats-record-shape-mismatch.md
---

# Plan: Reduce Tournament Data Overhead

## Spec Reference

**Spec**: `.lore/specs/tournament/reduce-tournament-overhead.md`
**Parent spec**: `.lore/specs/tournament/tournament-ranking.md`
**Data model**: `.lore/designs/mvp-data-model.md`

Requirements addressed:

- REQ-RTO-1: Expand `TournamentGameStats` with `wins`, `losses` → Phase 1, Phase 3
- REQ-RTO-2: Add capped `recentComparisons` to `TournamentGameStats` → Phase 1, Phase 3
- REQ-RTO-3: Remove top-level `comparisons` array → Phase 1, Phase 3
- REQ-RTO-4: Session-scoped comparisons (active only) → Phase 1, Phase 3
- REQ-RTO-5: `Comparison` type unchanged → Phase 1
- REQ-RTO-6: `submitComparison` updates cached stats → Phase 3
- REQ-RTO-7: `deriveDisplayStats` reads from cache → Phase 3
- REQ-RTO-8: `getNextPair` uses session comparisons → Phase 3
- REQ-RTO-9: Remove `recalculate` → Phase 4
- REQ-RTO-10: Session completion clears comparisons → Phase 3
- REQ-RTO-11: Game deletion leaves `recentComparisons` intact → Phase 3
- REQ-RTO-12: One-time migration on load → Phase 2
- REQ-RTO-13: Migration preserves ELO and comparison counts → Phase 2
- REQ-RTO-14: Zod schema accepts both formats → Phase 1

## Codebase Context

### Architecture

Bun monorepo, four workspace packages. The daemon owns all data via services injected through factory functions. Web talks to daemon via Unix socket (`lib/api.ts`). CLI talks to daemon via Unix socket (Bun `fetch` with `unix` option). Shared types and Zod schemas in `packages/shared/`.

### Existing Tournament Code

**Service layer** (`packages/daemon/src/services/tournament-service.ts`, 484 lines): Closure-based service with `TournamentService` interface at lines 21-40. The `submitComparison` function (lines 331-399) pushes to `data.comparisons` and updates ELO incrementally but does not track wins, losses, or recent comparisons. The `deriveDisplayStats` function (lines 102-178) scans the entire `data.comparisons` array on every call to compute wins, losses, and last-5 comparisons. The `getNextPair` function (lines 243-329) scans `data.comparisons` filtered by sessionId for pair deduplication (lines 304-311). The `recalculate` function (line 420-425) calls `recalculateAllRatings` from elo-engine. The `endSession` function (lines 227-241) marks status as completed but does not touch comparisons.

**ELO engine** (`packages/daemon/src/services/elo-engine.ts`, 109 lines): Pure-function module. `calculateNewRatings` (lines 19-40) handles incremental updates. `recalculateAllRatings` (lines 47-87) replays all comparisons from 1500. The latter is used only by `recalculate()` and is removed in this spec.

**Storage** (`packages/daemon/src/services/storage-service.ts`, 143 lines): `loadTournament()` (lines 124-135) reads `tournament.json` and returns parsed JSON. `saveTournament()` (lines 137-140) writes atomically. No migration logic exists. The `createDefaultTournament()` helper (lines 56-63) includes a `comparisons: []` top-level array.

**Types** (`packages/shared/src/types.ts`): `TournamentGameStats` (lines 159-162) has only `eloRating` and `comparisonCount`. `TournamentData` (lines 164-169) has a top-level `comparisons: Comparison[]`. `TournamentSession` (lines 140-148) has no `comparisons` field. `TournamentGameStatsDisplay` (lines 180-189) has `wins`, `losses`, and `recentComparisons` derived at read time. The comment on line 188 reads "derived from comparison history (never cached)."

**Validation** (`packages/shared/src/validation.ts`, 110 lines): No `TournamentDataSchema` exists for the stored format. The existing schemas (`SubmitComparisonSchema`, `StartSessionSchema`, `TournamentSettingsUpdateSchema`) are request-body validators, not storage validators.

**Routes** (`packages/daemon/src/routes/tournament.ts`, 359 lines): The recalculate endpoint is at lines 209-217. Operation definition `shelf.tournament.recalculate` is at lines 332-338. The `/tournament/games/:id/stats` and `/tournament/stats` routes (lines 169-207) enrich `recentComparisons` with game names from the collection at read time.

**CLI** (`packages/cli/src/commands/tournament.ts`, 326 lines): `tournamentRecalculate` at lines 310-325. Registered in `packages/cli/src/index.ts`.

**Web** (`packages/web/lib/api.ts`): Contains a `recalculateElo()` helper (line 196). No web UI component calls it, but the export must be removed.

### Files That Reference `recalculate` (from grep)

Production code:

- `packages/shared/src/types.ts` (no reference, but types change)
- `packages/daemon/src/services/elo-engine.ts` (exports `recalculateAllRatings`)
- `packages/daemon/src/services/tournament-service.ts` (imports and calls it)
- `packages/daemon/src/routes/tournament.ts` (endpoint + operation def)
- `packages/cli/src/commands/tournament.ts` (command function)
- `packages/cli/src/index.ts` (command registration)
- `packages/web/lib/api.ts` (API helper)

Test code:

- `packages/daemon/tests/tournament-service.test.ts`
- `packages/daemon/tests/routes/tournament.test.ts`
- `packages/daemon/tests/integration/end-to-end.test.ts`
- `packages/daemon/tests/elo-engine.test.ts`
- `packages/cli/tests/commands/tournament.test.ts`

### Cross-Cutting Concerns

**Client/daemon divergence**: The retro at `.lore/retros/incident/tournament-stats-record-shape-mismatch.md` warns that changes to tournament data shape require grepping every client helper. The spec explicitly keeps the API response shape (`TournamentGameStatsDisplay`) unchanged. The only client-facing removal is the `recalculate` endpoint and command. Both web and CLI must be checked.

**No schema versioning**: The project detects format by structure (presence/absence of fields), not by version numbers. The utility curves spec used the same approach for migration.

**Default tournament creation**: `createDefaultTournament()` in `storage-service.ts` creates `comparisons: []`. Post-migration, new tournaments should not have a top-level `comparisons` field. This function must be updated.

## Technical Decisions

### 1. Cached `RecentComparison` type vs display `RecentComparison`

The existing `RecentComparison` type (used in `TournamentGameStatsDisplay`) includes `opponentGameName`. The cached version in `TournamentGameStats.recentComparisons` stores only `opponentGameId`, `won`, and `createdAt` (per REQ-RTO-2). The display type adds `opponentGameName` at read time.

**Decision**: Define a new `CachedRecentComparison` interface in shared types with the three cached fields. The display `RecentComparison` extends it with `opponentGameName`. This keeps the storage lean and the read-time enrichment pattern unchanged (routes already do this at lines 177-180 of `tournament.ts`).

### 2. Migration location

The migration could live in `storage-service.ts` (alongside `loadTournament`) or in `tournament-service.ts` (closer to the domain logic).

**Decision**: Place migration in a new pure function `migrateTournamentData` in `tournament-service.ts`. Call it from `loadTournament` in `storage-service.ts`, with `saveTournament` called when migration occurs. This keeps the storage service thin (it doesn't need to understand tournament semantics) while ensuring the migration runs before any service method sees the data. The migration function is pure: takes `TournamentData` (old or new format), returns `TournamentData` (new format) plus a `migrated: boolean` flag.

Update: the migration function should live in its own file for testability. Create `packages/daemon/src/services/tournament-migration.ts` following the pure-function pattern established by `elo-engine.ts`. Storage service imports and calls it.

### 3. Validation schema for stored format

The spec requires (REQ-RTO-14) a Zod schema that accepts both formats. No `TournamentDataSchema` exists today.

**Decision**: Add a `TournamentDataSchema` to `packages/shared/src/validation.ts` that accepts both formats. The top-level `comparisons` field is optional (defaults to `[]` when absent). The session `comparisons` field is optional (defaults to `[]`). After migration, only the post-migration format is written. The schema is used by `loadTournament` to validate the parsed JSON before returning it.

### 4. `recalculateAllRatings` in elo-engine

The function is only used by `recalculate()`. Removing `recalculate()` makes it dead code.

**Decision**: Remove `recalculateAllRatings` from `elo-engine.ts`. However, the migration needs to compute wins/losses from comparison history. That logic is simpler than `recalculateAllRatings` (just counting wins/losses, not replaying ELO). The migration function handles this internally.

### 5. Phase ordering

The changes touch shared types, daemon service, daemon storage, daemon routes, CLI, and web. The spec keeps the API response shape unchanged, so web and CLI changes are limited to removing `recalculate` references.

**Decision**: Four phases. Phase 1 updates shared types and validation (contract first). Phase 2 writes the migration as a standalone testable module. Phase 3 rewrites the service layer (the core behavioral changes). Phase 4 removes `recalculate` from routes, CLI, web, and elo-engine, then runs the client grep.

This ordering means Phase 3 (service changes) depends on both Phase 1 (new types) and Phase 2 (migration, which validates the data format before the service sees it). Phase 4 is a cleanup pass that can be verified independently.

## Implementation Steps

### Phase 1: Shared Types and Validation

**Files**: `packages/shared/src/types.ts`, `packages/shared/src/validation.ts`, `packages/shared/src/index.ts`
**Addresses**: REQ-RTO-1, REQ-RTO-2, REQ-RTO-3, REQ-RTO-4, REQ-RTO-5, REQ-RTO-14
**Expertise**: None

#### Type changes

Add `CachedRecentComparison` interface to `packages/shared/src/types.ts`:

```typescript
export interface CachedRecentComparison {
  opponentGameId: string;
  won: boolean;
  createdAt: string; // ISO 8601
}
```

Expand `TournamentGameStats`:

```typescript
export interface TournamentGameStats {
  eloRating: number; // Default 1500
  comparisonCount: number; // Default 0
  wins: number; // Default 0 (new)
  losses: number; // Default 0 (new)
  recentComparisons: CachedRecentComparison[]; // Capped at 10, most-recent-first (new)
}
```

Add `comparisons` to `TournamentSession`:

```typescript
export interface TournamentSession {
  id: string;
  filters: SessionFilter[] | null;
  gameIds: string[];
  comparisonCount: number;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  comparisons: Comparison[]; // Active session only; cleared on completion (new)
}
```

Remove `comparisons` from `TournamentData`:

```typescript
export interface TournamentData {
  settings: TournamentSettings;
  sessions: TournamentSession[];
  gameStats: Record<string, TournamentGameStats>;
  // comparisons field removed
}
```

Update `TournamentGameStatsDisplay` comment on line 188: change "derived from comparison history (never cached)" to "read from cached TournamentGameStats.recentComparisons, enriched with game names at read time" (REQ-RTO-7).

Re-export `CachedRecentComparison` from `packages/shared/src/index.ts`.

#### Validation changes

Add `TournamentDataSchema` to `packages/shared/src/validation.ts`. This schema must accept both pre-migration and post-migration formats:

```typescript
const CachedRecentComparisonSchema = z.object({
  opponentGameId: z.string(),
  won: z.boolean(),
  createdAt: z.string(),
});

const ComparisonSchema = z.object({
  id: z.string(),
  gameAId: z.string(),
  gameBId: z.string(),
  winnerId: z.string(),
  sessionId: z.string(),
  createdAt: z.string(),
});

const TournamentGameStatsSchema = z.object({
  eloRating: z.number(),
  comparisonCount: z.number(),
  wins: z.number().optional().default(0),
  losses: z.number().optional().default(0),
  recentComparisons: z.array(CachedRecentComparisonSchema).optional().default([]),
});

const TournamentSessionSchema = z.object({
  id: z.string(),
  filters: z.array(SessionFilterSchema).nullable(),
  gameIds: z.array(z.string()),
  comparisonCount: z.number(),
  status: z.enum(["active", "completed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  comparisons: z.array(ComparisonSchema).optional().default([]),
});

export const TournamentDataSchema = z.object({
  settings: TournamentSettingsSchema,
  sessions: z.array(TournamentSessionSchema),
  comparisons: z.array(ComparisonSchema).optional(), // pre-migration only
  gameStats: z.record(TournamentGameStatsSchema),
});
```

The `comparisons` field on `TournamentData` is optional in the schema (present in pre-migration, absent in post-migration). The session `comparisons` field defaults to `[]` for pre-migration sessions that lack it. The `wins`, `losses`, and `recentComparisons` fields on `TournamentGameStats` default to `0`/`[]` for pre-migration entries.

Note: `TournamentSettingsUpdateSchema` exists with all-optional fields (for PATCH semantics). The stored format needs a separate `TournamentSettingsSchema` with required fields:

```typescript
const TournamentSettingsSchema = z.object({
  kFactorThreshold: z.number(),
  normalizationHalfWidth: z.number(),
  provisionalThreshold: z.number(),
});
```

Define this alongside the other tournament schemas in `validation.ts`. It's used by `TournamentDataSchema` for the `settings` field.

#### Tests

- Zod schema accepts a pre-migration fixture (top-level `comparisons`, sessions without `comparisons` field, gameStats without `wins`/`losses`/`recentComparisons`)
- Zod schema accepts a post-migration fixture (no top-level `comparisons`, sessions with `comparisons`, gameStats with all fields)
- Default values applied correctly for missing optional fields
- Existing validation tests still pass (request schemas unchanged)

**Review gate**: Types define the contract for everything downstream. The `TournamentData` type change (removing `comparisons`) will cause compile errors in Phases 2-4 files until those phases update them. This is intentional. Typecheck should pass within `packages/shared/` but will fail in `packages/daemon/` until Phase 3.

---

### Phase 2: Migration Module

**Files**: `packages/daemon/src/services/tournament-migration.ts` (new), `packages/daemon/tests/tournament-migration.test.ts` (new)
**Addresses**: REQ-RTO-12, REQ-RTO-13
**Expertise**: None

Create `tournament-migration.ts` as a pure-function module (same pattern as `elo-engine.ts`). No service dependencies, no I/O.

#### Migration function

```typescript
export function migrateTournamentData(raw: Record<string, unknown>): {
  data: TournamentData;
  migrated: boolean;
};
```

The function takes the raw parsed JSON (before TypeScript typing) and returns typed `TournamentData` plus a flag indicating whether migration occurred.

**Detection**: If `raw` has a top-level `comparisons` array, the data is pre-migration.

**Migration steps** (REQ-RTO-12):

1. **Compute per-game wins, losses, and recent comparisons** from the top-level `comparisons` array. For each comparison, update both games: increment the winner's `wins` and the loser's `losses`, and push a `CachedRecentComparison` entry to both games' `recentComparisons` lists (with appropriate `won` flag and `opponentGameId`).

2. **Cap `recentComparisons`** at 10 per game. After processing all comparisons (in chronological order, oldest first), each game's list will contain all its comparisons. Sort each list most-recent-first, then truncate to 10.

3. **Move active session comparisons**. For the active session (if any), collect its comparisons from the top-level array (matching by `sessionId`) and attach them to the session object as `session.comparisons`. Initialize all sessions' `comparisons` to `[]` first, then populate the active one.

4. **Clear completed sessions' comparisons**. All completed sessions get `comparisons: []`. (They were initialized to `[]` in step 3 and not populated.)

5. **Preserve existing `gameStats`**. Per REQ-RTO-13, ELO ratings and comparison counts are already correct. The migration only adds `wins`, `losses`, and `recentComparisons` to each existing `gameStats` entry.

6. **Remove top-level `comparisons`**. The returned `TournamentData` object does not include the field.

**Idempotency**: If the top-level `comparisons` array is absent, return the data as-is with `migrated: false`. This handles already-migrated data and freshly-created tournaments.

#### Tests (comprehensive, this is the high-risk module)

Build a pre-migration fixture by hand with known comparisons and expected outcomes:

- 3 games, 6 comparisons with known winners. Verify `wins` and `losses` match hand-counted values for each game.
- Verify `recentComparisons` contains the last 10 (or fewer) per game, ordered most-recent-first.
- Verify `recentComparisons` cap at 10: create a fixture with 15 comparisons for a single game pair, confirm only 10 survive.
- Verify active session comparisons are moved: create a fixture with one active and one completed session, confirm active session gets its comparisons, completed session has `[]`.
- Verify ELO and comparison counts are untouched: compare pre-migration values with post-migration values.
- Verify idempotency: run migration on already-migrated data, confirm output is identical and `migrated` is false.
- Verify fresh tournament (no comparisons, no sessions) passes through unchanged.

**Review gate**: Migration correctness is the highest-risk item in this plan. Incorrect migration silently corrupts tournament data. The test suite for this module must cover all the success criteria in the spec before Phase 3 begins.

---

### Phase 3: Service Layer Changes

**Files**: `packages/daemon/src/services/tournament-service.ts`, `packages/daemon/src/services/storage-service.ts`, `packages/daemon/tests/tournament-service.test.ts`
**Addresses**: REQ-RTO-1, REQ-RTO-2, REQ-RTO-3, REQ-RTO-4, REQ-RTO-6, REQ-RTO-7, REQ-RTO-8, REQ-RTO-10, REQ-RTO-11
**Expertise**: None

This phase rewrites the core tournament service behaviors. Each change is localized to a single function or code path.

#### Storage: Integrate migration into load path

In `packages/daemon/src/services/storage-service.ts`:

1. Update `createDefaultTournament()` to produce the post-migration format: remove `comparisons: []`, add `sessions: []` (unchanged), `gameStats: {}` (unchanged). New tournaments never have a top-level `comparisons` field.

2. Update `loadTournament()` to call `migrateTournamentData(raw)` on the parsed JSON, then validate with `TournamentDataSchema`. If `migrated` is true, call `saveTournament()` immediately to persist the migrated format. Return the typed `TournamentData`.

   This changes the return flow from `JSON.parse(raw) as TournamentData` to `migrateTournamentData(JSON.parse(raw))` with schema validation. The storage service imports `migrateTournamentData` from `tournament-migration.ts` and `TournamentDataSchema` from `@shelf-judge/shared`.

#### Service: `submitComparison` (REQ-RTO-6)

Currently (lines 331-399): pushes comparison to `data.comparisons`, updates ELO, increments `comparisonCount`.

Changes:

1. Push comparison to `session.comparisons` instead of `data.comparisons` (which no longer exists).
2. After ELO update, increment `wins` on the winner's `gameStats` and `losses` on the loser's.
3. Push a `CachedRecentComparison` entry to both games' `recentComparisons` arrays (winner gets `won: true`, loser gets `won: false`). Apply the FIFO cap: if the array exceeds 10 entries, drop the last element (oldest, since the array is most-recent-first).

The incremental ELO update logic (lines 383-395) is unchanged.

#### Service: `deriveDisplayStats` (REQ-RTO-7)

Currently (lines 102-178): scans `data.comparisons` to compute wins, losses, and recentComparisons.

Changes: Read `wins`, `losses`, and `recentComparisons` directly from `data.gameStats[gameId]`. The enrichment step (adding `opponentGameName`) moves to the route layer (it's already there for the API response, at lines 177-180 of `tournament.ts`). Wait: the current `deriveDisplayStats` is called within the service, and the route layer enriches the `recentComparisons` with game names afterward. So `deriveDisplayStats` should return the cached `recentComparisons` with `opponentGameName: null`, and the route continues to enrich. This preserves the existing pattern.

The function shrinks from ~75 lines to ~30 lines. The `for (const comp of data.comparisons)` loop (lines 140-162) and the sort/slice (lines 165-166) are replaced by direct reads from cached fields.

#### Service: `getNextPair` (REQ-RTO-8)

Currently (lines 304-311): scans `data.comparisons` filtered by `sessionId` for pair deduplication.

Changes: Read from `session.comparisons` instead. The session object is already looked up at line 245. Replace:

```typescript
for (const comp of data.comparisons) {
  if (comp.sessionId !== sessionId) continue;
  // ...
}
```

With:

```typescript
for (const comp of session.comparisons) {
  const key = [comp.gameAId, comp.gameBId].sort().join("|");
  seenPairs.add(key);
}
```

This is a behavioral change: completed sessions' comparisons no longer affect deduplication in new sessions. This is correct per the spec (each session's pairing is independent).

#### Service: `endSession` (REQ-RTO-10)

Currently (lines 227-241): marks status as completed.

Changes: After setting `session.status = "completed"`, clear the session's comparisons: `session.comparisons = []`. The session metadata (id, filters, gameIds, comparisonCount, status, dates) is retained.

Also update all four auto-complete paths to clear `session.comparisons` when auto-completing:

1. `startSession` (lines 190-195): when starting a new session auto-completes the active one, add `active.comparisons = []`.
2. `getNextPair` (lines 259-262): auto-complete when fewer than 4 games remain.
3. `getNextPair` (lines 287-290): auto-complete when selectedA is null (defensive).
4. `getNextPair` (lines 325-327): auto-complete when all pairs exhausted.

All four locations set `session.status = "completed"` and must also set `session.comparisons = []`.

#### Service: `startSession`

Currently (lines 184-219): creates a session without a `comparisons` field.

Changes: Initialize `comparisons: []` on the new session object.

#### Service: `onGameDeleted` (REQ-RTO-11)

Currently (lines 448-469): deletes from `gameStats`, filters active session `gameIds`.

Changes: Per REQ-RTO-11, entries referencing the deleted game in other games' `recentComparisons` are left intact. The `opponentGameName` resolves to `null` at display time when the game doesn't exist. No change needed to `onGameDeleted` for `recentComparisons`.

However, the deleted game's `gameStats` entry is already removed (line 452). This is correct per spec.

Additionally, if the deleted game has comparisons in the active session's `comparisons` array, those are left intact (they reference the deleted game but don't affect pairing since the game is removed from `gameIds`). No cleanup needed.

#### Service: Remove `recalculate` from interface

Remove `recalculate(): Promise<{ gamesUpdated: number }>` from the `TournamentService` interface (line 35) and its implementation (lines 420-425). Remove the `recalculateAllRatings` import (line 18). This is a compile-time check: any code still referencing `recalculate()` will fail to compile.

#### Test updates

Update `packages/daemon/tests/tournament-service.test.ts`:

- All test fixtures must use the post-migration format (no top-level `comparisons`, sessions with `comparisons: []`, gameStats with `wins: 0, losses: 0, recentComparisons: []`).
- Add tests for: submitComparison updates cached `wins`, `losses`, `recentComparisons`.
- Add tests for: `recentComparisons` FIFO cap at 10.
- Add tests for: `deriveDisplayStats` reads from cache (no comparisons array to scan).
- Add tests for: completing a session clears its comparisons.
- Add tests for: pair deduplication reads from `session.comparisons` (verified by: complete session, start new session, confirm old session pairs don't affect dedup).
- Add tests for: deleting a game leaves other games' `recentComparisons` intact.
- Remove tests for `recalculate()`.

**Review gate**: After this phase, the daemon compiles and all tournament service tests pass. The route and CLI still reference `recalculate` and will fail typecheck until Phase 4.

---

### Phase 4: Remove Recalculate and Client Grep

**Files**: `packages/daemon/src/routes/tournament.ts`, `packages/daemon/src/services/elo-engine.ts`, `packages/cli/src/commands/tournament.ts`, `packages/cli/src/index.ts`, `packages/web/lib/api.ts`, plus test files
**Addresses**: REQ-RTO-9
**Expertise**: None

#### Route removal

In `packages/daemon/src/routes/tournament.ts`:

1. Remove the `POST /tournament/recalculate` route (lines 209-217).
2. Remove the `shelf.tournament.recalculate` operation definition (lines 332-338).

#### ELO engine cleanup

In `packages/daemon/src/services/elo-engine.ts`:

1. Remove `recalculateAllRatings` (lines 47-87) and its export.
2. Remove related tests in `packages/daemon/tests/elo-engine.test.ts`.

#### CLI removal

In `packages/cli/src/commands/tournament.ts`:

1. Remove `tournamentRecalculate` function (lines 310-325) and its export.

In `packages/cli/src/index.ts`:

1. Remove the command registration for `tournament recalculate`.

Remove related tests in `packages/cli/tests/commands/tournament.test.ts`.

#### Web removal

In `packages/web/lib/api.ts`:

1. Remove the `recalculateElo()` helper function (line 196).

#### Route test updates

In `packages/daemon/tests/routes/tournament.test.ts`:

1. Remove tests for the `/tournament/recalculate` endpoint.
2. Update any test fixtures to use post-migration format.

In `packages/daemon/tests/integration/end-to-end.test.ts`:

1. Remove any recalculate test scenarios.
2. Update fixtures.

#### Client grep (spec AI validation requirement)

After all removals, grep the entire codebase for:

- `recalculate` (should appear only in lore docs, not production code)
- `data.comparisons` (should not appear in daemon service code; only in migration module and tests)
- `TournamentData.*comparisons` or similar patterns referencing the old top-level field

This grep is a spec requirement (AI Validation, Custom section) and must be performed as the final step of this phase.

#### Tests

- Verify `POST /tournament/recalculate` returns 404.
- `bun run test` passes across all packages.
- `bun run typecheck` clean.
- `bun run lint` clean.

**Review gate**: Full suite passes. All recalculate references removed from production code. Client grep confirms no stale references.

---

### Phase 5: Final Validation

**Addresses**: All REQ-RTO requirements (verification pass)

This is not a coding phase. It's the spec validation step.

1. **Launch a review sub-agent** that reads the spec at `.lore/specs/tournament/reduce-tournament-overhead.md`, reviews the implementation across all changed files, and flags any requirements not met.

2. **Run the full test suite**: `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check`.

3. **Walk the success criteria** from the spec:
   - Submitting a comparison updates cached `wins`, `losses`, `recentComparisons` in `gameStats` → verified by Phase 3 tests
   - `recentComparisons` capped at 10 (FIFO) → verified by Phase 3 tests
   - Display stats from cache, not scan → verified by Phase 3 tests
   - Session completion clears comparisons → verified by Phase 3 tests
   - Pair dedup from session, not top-level → verified by Phase 3 tests
   - Migration correctness (format, ELO preserved, wins/losses, recentComparisons, active session, idempotent) → verified by Phase 2 tests
   - Game deletion leaves recentComparisons intact → verified by Phase 3 tests
   - Zod schema accepts both formats → verified by Phase 1 tests
   - Recalculate removed → verified by Phase 4 tests and grep

## Delegation Guide

All five phases are assigned to **Dalton** (implementation). Phases are sequential; each depends on the previous.

After Phase 2, invoke **Thorne** (review) to verify migration correctness before proceeding. The migration is the highest-risk change: it transforms existing user data, and a bug here is the hardest to recover from.

After Phase 4, invoke **Thorne** again to confirm full requirement coverage and the client grep results before Phase 5's final validation.

Phase 5 uses a fresh-context sub-agent for the spec validation pass.

## Risk Notes

1. **Migration on existing data.** The migration runs automatically on `loadTournament()`. If a user's `tournament.json` has unexpected structure (e.g., comparisons referencing games that never appeared in `gameStats`), the migration must handle that gracefully. The migration should skip comparisons where both games lack `gameStats` entries (they were deleted), and should create `gameStats` entries with default ELO for games that appear in comparisons but not in `gameStats` (shouldn't happen, but defensive).

2. **Test fixture updates.** Every test that constructs `TournamentData` inline will break when the type changes. The test update scope is significant: `tournament-service.test.ts` (650 lines), `routes/tournament.test.ts`, `integration/end-to-end.test.ts`. Consider creating a test helper that builds a valid post-migration `TournamentData` with sensible defaults to reduce fixture boilerplate.

3. **Typecheck cascade.** Removing `comparisons` from `TournamentData` in Phase 1 causes compile errors in Phase 3/4 files. During implementation, Phase 1 is validated in isolation (`packages/shared/`). Full typecheck passes only after Phase 4 completes. This is acceptable for a sequential plan but means cross-package typecheck cannot gate each phase independently.

4. **`endSession` auto-complete paths.** There are three locations in `getNextPair` that auto-complete a session (lines 259-262, 287-290, 325-327). All three must clear `session.comparisons`. Missing one creates a data leak where a completed session retains comparisons. Flag these explicitly during implementation.

## Open Questions

None. The spec is precise enough that all implementation decisions follow from it. The technical decisions above fill the gaps between spec requirements and concrete code changes.
