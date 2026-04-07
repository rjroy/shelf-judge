---
title: "Commission: Tournament Phase 3 Review"
date: 2026-04-06
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the tournament service implementation (Phase 3 from `.lore/plans/tournament-ranking.md`).\n\nThis is the most complex phase. Check carefully:\n1. All TournamentService interface methods are implemented per the plan\n2. Session filter logic: each filter type works correctly, AND-combination, < 4 rejection\n3. Adaptive pairing: low comparison count priority, ELO similarity preference, no repeat pairs, random tiebreak\n4. Game deletion: comparisons retained (REQ-TOURN-8), cached ELO removed, active session exclusion (REQ-TOURN-15a), auto-complete below 4\n5. Single active session enforcement (REQ-TOURN-15)\n6. Storage: atomic writes, correct default data\n7. onGameDeleted wired into GameServiceDeps correctly\n8. Test coverage on all behaviors listed in the plan\n9. No circular dependencies between services\n\nFiles: `packages/daemon/src/services/tournament-service.ts`, `packages/daemon/src/services/storage-service.ts`, `packages/daemon/src/services/game-service.ts`, `packages/daemon/tests/tournament-service.test.ts`"
dependencies:
  - commission-Dalton-20260406-153834
linked_artifacts:
  - packages/daemon/src/services/tournament-service.ts

  - packages/daemon/src/services/storage-service.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/tests/tournament-service.test.ts
  - packages/daemon/src/services/storage-service.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/tests/tournament-service.test.ts
activity_timeline:
  - timestamp: 2026-04-06T22:38:43.066Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T22:38:43.068Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-06T23:03:05.411Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-06T23:03:05.413Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-06T23:03:05.431Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-06T23:03:11.586Z
    event: progress_report
    reason: "Starting review of tournament service implementation (Phase 3). Reading plan and implementation files."
  - timestamp: 2026-04-06T23:03:37.174Z
    event: progress_report
    reason: "Read all four target files. Now analyzing against plan requirements. Key areas: interface completeness, filter logic, adaptive pairing, game deletion, single active session, storage, onGameDeleted wiring, test coverage."
  - timestamp: 2026-04-06T23:06:18.427Z
    event: progress_report
    reason: "All findings recorded. 2 defects, 2 test gaps, 1 design concern, 5 passes. Preparing final submission."
  - timestamp: 2026-04-06T23:06:42.604Z
    event: result_submitted
    reason: "## Tournament Service Review (Phase 3)\n\n### Defects\n\n**1. submitComparison accepts invalid winnerId — data integrity bug**\nFile: `packages/daemon/src/services/tournament-service.ts:347`\n\n`winnerId` is never validated against `gameAId` or `gameBId`. If an invalid value is passed, three things break simultaneously:\n- The comparison record stores the bogus winnerId (corrupted persistent data)\n- ELO updates as if gameB won (line 347: `winnerId === gameAId ? \"a\" : \"b\"` defaults to \"b\")\n- `deriveDisplayStats` checks `comp.winnerId === gameId` for win/loss tallies, which won't match either game, so both games record a loss\n\nFix: Add validation before line 324:\n```typescript\nif (winnerId !== gameAId && winnerId !== gameBId) {\n  throw new Error(\"winnerId must be one of the compared games\");\n}\n```\n\n**2. Staleness filter silently ignores value=\"0\"**\nFile: `packages/daemon/src/services/tournament-service.ts:79`\n\n`parseInt(filter.value, 10) || data.settings.provisionalThreshold` — `parseInt(\"0\")` returns `0`, which is falsy, so it falls through to `provisionalThreshold`. The user's explicit threshold is discarded. Low practical impact (threshold=0 matches everything), but the pattern is incorrect.\n\nFix: Use nullish coalescing with explicit NaN handling:\n```typescript\nconst parsed = parseInt(filter.value, 10);\nconst threshold = Number.isNaN(parsed) ? data.settings.provisionalThreshold : parsed;\n```\n\n### Test Gaps\n\n**3. No test for invalid winnerId in submitComparison**\nFile: `packages/daemon/tests/tournament-service.test.ts`\n\nPaired with defect #1. Once the validation is added, a test should verify that `submitComparison(sessionId, \"g1\", \"g2\", \"g999\")` throws.\n\n**4. No test for getNextPair with non-existent session**\nFile: `packages/daemon/tests/tournament-service.test.ts`\n\nThe code throws at line 221-223 for unknown sessionId, but no test exercises this path. `endSession` has the equivalent test (line 279-286); `getNextPair` should match.\n\n### Design Concern\n\n**5. Cross-file atomicity gap in game deletion**\nFiles: `packages/daemon/src/services/game-service.ts:230-233`, `packages/daemon/src/services/tournament-service.ts:393-413`\n\n`removeGame` saves the collection (game removed) before calling `onGameDeleted` (tournament update). If the tournament save fails, the game is gone from the collection but still referenced in the active session's `gameIds`. No automated recovery path exists. This is inherent to dual-file storage without a transaction coordinator. Low probability (file I/O failure), but the consequence is silent data inconsistency.\n\n### Passes\n\n- **Interface completeness**: All 11 methods from the plan are implemented with matching signatures.\n- **Session filter logic**: All four filter types (name, minFitness, bggTag, staleness) work correctly. AND-combination via sequential filtering. < 4 rejection enforced with clear error message.\n- **Single active session (REQ-TOURN-15)**: `startSession` auto-completes any existing active session before creating a new one.\n- **Game deletion (REQ-TOURN-8, REQ-TOURN-15a)**: Comparisons retained, cached ELO deleted, active session gameIds pruned, auto-complete when < 4 remain.\n- **Adaptive pairing (REQ-TOURN-14)**: Comparison count priority, ELO similarity preference (200 threshold), no-repeat pairs via seenPairs set, random tiebreak among ties.\n- **Storage**: loadTournament/saveTournament follow the atomic write pattern (temp+rename). Default TournamentData matches the plan exactly.\n- **onGameDeleted wiring**: GameServiceDeps has the optional callback, removeGame calls it. Actual construction wiring is Phase 4 scope, correctly deferred.\n- **No circular dependencies**: tournament-service imports types from storage-service and functions from elo-engine. game-service uses a callback, not a module import of tournament-service.\n- **Test coverage**: 20 tests covering all plan-specified behaviors. Filter types individually and combined, session lifecycle, pairing, game deletion, stats derivation, recalculation, settings, and atomic writes."
  - timestamp: 2026-04-06T23:06:47.954Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All findings recorded. 2 defects, 2 test gaps, 1 design concern, 5 passes. Preparing final submission."
projectName: shelf-judge
---
## Tournament Service Review (Phase 3)

### Defects

**1. submitComparison accepts invalid winnerId — data integrity bug**
File: `packages/daemon/src/services/tournament-service.ts:347`

`winnerId` is never validated against `gameAId` or `gameBId`. If an invalid value is passed, three things break simultaneously:
- The comparison record stores the bogus winnerId (corrupted persistent data)
- ELO updates as if gameB won (line 347: `winnerId === gameAId ? "a" : "b"` defaults to "b")
- `deriveDisplayStats` checks `comp.winnerId === gameId` for win/loss tallies, which won't match either game, so both games record a loss

Fix: Add validation before line 324:
```typescript
if (winnerId !== gameAId && winnerId !== gameBId) {
  throw new Error("winnerId must be one of the compared games");
}
```

**2. Staleness filter silently ignores value="0"**
File: `packages/daemon/src/services/tournament-service.ts:79`

`parseInt(filter.value, 10) || data.settings.provisionalThreshold` — `parseInt("0")` returns `0`, which is falsy, so it falls through to `provisionalThreshold`. The user's explicit threshold is discarded. Low practical impact (threshold=0 matches everything), but the pattern is incorrect.

Fix: Use nullish coalescing with explicit NaN handling:
```typescript
const parsed = parseInt(filter.value, 10);
const threshold = Number.isNaN(parsed) ? data.settings.provisionalThreshold : parsed;
```

### Test Gaps

**3. No test for invalid winnerId in submitComparison**
File: `packages/daemon/tests/tournament-service.test.ts`

Paired with defect #1. Once the validation is added, a test should verify that `submitComparison(sessionId, "g1", "g2", "g999")` throws.

**4. No test for getNextPair with non-existent session**
File: `packages/daemon/tests/tournament-service.test.ts`

The code throws at line 221-223 for unknown sessionId, but no test exercises this path. `endSession` has the equivalent test (line 279-286); `getNextPair` should match.

### Design Concern

**5. Cross-file atomicity gap in game deletion**
Files: `packages/daemon/src/services/game-service.ts:230-233`, `packages/daemon/src/services/tournament-service.ts:393-413`

`removeGame` saves the collection (game removed) before calling `onGameDeleted` (tournament update). If the tournament save fails, the game is gone from the collection but still referenced in the active session's `gameIds`. No automated recovery path exists. This is inherent to dual-file storage without a transaction coordinator. Low probability (file I/O failure), but the consequence is silent data inconsistency.

### Passes

- **Interface completeness**: All 11 methods from the plan are implemented with matching signatures.
- **Session filter logic**: All four filter types (name, minFitness, bggTag, staleness) work correctly. AND-combination via sequential filtering. < 4 rejection enforced with clear error message.
- **Single active session (REQ-TOURN-15)**: `startSession` auto-completes any existing active session before creating a new one.
- **Game deletion (REQ-TOURN-8, REQ-TOURN-15a)**: Comparisons retained, cached ELO deleted, active session gameIds pruned, auto-complete when < 4 remain.
- **Adaptive pairing (REQ-TOURN-14)**: Comparison count priority, ELO similarity preference (200 threshold), no-repeat pairs via seenPairs set, random tiebreak among ties.
- **Storage**: loadTournament/saveTournament follow the atomic write pattern (temp+rename). Default TournamentData matches the plan exactly.
- **onGameDeleted wiring**: GameServiceDeps has the optional callback, removeGame calls it. Actual construction wiring is Phase 4 scope, correctly deferred.
- **No circular dependencies**: tournament-service imports types from storage-service and functions from elo-engine. game-service uses a callback, not a module import of tournament-service.
- **Test coverage**: 20 tests covering all plan-specified behaviors. Filter types individually and combined, session lifecycle, pairing, game deletion, stats derivation, recalculation, settings, and atomic writes.

## Decisions

**Does submitComparison validate that winnerId is one of gameAId or gameBId?**
DEFECT: No validation. winnerId is accepted as-is and persisted. An invalid winnerId corrupts the comparison record and causes ELO/stats divergence.
*Reasoning: tournament-service.ts:347 — `const winner: "a" | "b" = winnerId === gameAId ? "a" : "b"`. If winnerId doesn't match either game, it defaults to "b" silently. The comparison record stores the bogus winnerId. deriveDisplayStats then checks `comp.winnerId === gameId` for wins/losses, which won't match either game — both games record a loss while ELO was updated as if B won. This creates three-way inconsistency: (1) corrupted comparison record, (2) ELO drift, (3) win/loss counts wrong for both games. The route layer (Phase 4) should also validate, but the service is the data integrity boundary.*

**Does the staleness filter handle value="0" correctly?**
DEFECT (minor): parseInt("0") returns 0, which is falsy, causing fallback to provisionalThreshold. A staleness threshold of 0 cannot be expressed.
*Reasoning: tournament-service.ts:79 — `const threshold = parseInt(filter.value, 10) || data.settings.provisionalThreshold`. The `||` operator treats 0 as falsy. While threshold=0 would match all games (every game has comparisonCount >= 0), this is a correctness issue: the user's explicit value is silently replaced. Should use `??` with an explicit NaN check, or default only when parseInt returns NaN.*

**Is there a test for submitComparison with invalid winnerId?**
TEST GAP: No test validates that winnerId must be gameAId or gameBId. This is directly related to the missing validation defect.
*Reasoning: The test file covers: valid comparison, completed session rejection, games-not-in-session rejection. But no test asserts that winnerId = "bogus" is rejected. Since the validation is also missing from the service, the test gap and the code defect are paired.*

**Is getNextPair tested for a non-existent session?**
TEST GAP (minor): No test for getNextPair with a non-existent sessionId. Code throws at line 221-223, but no test exercises this path.
*Reasoning: endSession has a "throws for unknown session" test (line 279-286), but getNextPair does not have an equivalent. The error path exists in the code, but is untested. Low severity since the pattern is identical to endSession's handling.*

**Does cross-file atomicity pose a risk in game deletion flow?**
CONCERN (design): game-service.ts saves collection before calling onGameDeleted. If tournament save fails, the game is removed from the collection but tournament data still references it.
*Reasoning: game-service.ts:230-233 — collection is saved at line 232, then onGameDeleted is called at line 233. If saveTournament fails inside onGameDeleted, the game is gone from the collection but still appears in the active session's gameIds. On next getNextPair, the route layer would try to resolve the game ID and fail. Recovery requires manual intervention or a recalculate call. This is an inherent limitation of dual-file storage with no transaction coordinator. The plan doesn't address it. Severity is low because file I/O failure is unlikely in normal operation, but the consequence is data inconsistency with no automated recovery path.*

**Are all TournamentService interface methods implemented per the plan?**
PASS: All 11 methods specified in the plan's interface are present and implemented. Return types match.
*Reasoning: Plan specifies: startSession, getActiveSession, endSession, getNextPair, submitComparison, getGameStats, getAllGameStats, listSessions, recalculate, onGameDeleted, getSettings, updateSettings. All present in the implementation at tournament-service.ts:20-37. Signatures match the plan's TypeScript interface exactly.*

**Does the storage layer follow the correct pattern with atomic writes and defaults?**
PASS: loadTournament/saveTournament follow the same atomic write pattern as loadCollection/saveCollection. Default TournamentData matches the plan exactly.
*Reasoning: storage-service.ts:55-62 — createDefaultTournament returns the exact shape from the plan (settings with kFactorThreshold:15, normalizationHalfWidth:400, provisionalThreshold:6, empty arrays/objects). Lines 122-138 use the same exists-check, atomic-write pattern as loadCollection. saveTournament uses atomicWrite (temp+rename) at line 137.*

**Does onGameDeleted wiring in game-service.ts match the plan?**
PASS: GameServiceDeps has optional onGameDeleted callback. removeGame calls it after saving the collection. This matches the plan's specification.
*Reasoning: game-service.ts:68 — `onGameDeleted?: (gameId: string) => Promise<void>` in GameServiceDeps. Line 233 — `await deps.onGameDeleted?.(id)` called after collection save. The actual wiring in index.ts (passing tournamentService.onGameDeleted to gameService) is Phase 4 scope, which is correct.*

**Are there circular dependencies between services?**
PASS: No circular dependencies. tournament-service imports from storage-service and elo-engine. game-service imports from storage-service. The onGameDeleted callback uses a function reference, not a module import, avoiding any cycle.
*Reasoning: tournament-service.ts imports: StorageService (type), GameWithScore (type), elo-engine functions. game-service.ts imports: StorageService (type), FitnessService (type). The cross-service notification is a callback in deps, not a direct import of tournament-service from game-service. This is the pattern the plan specified to avoid circular deps.*

**Does the adaptive pairing algorithm match the plan specification?**
PASS with OBSERVATION: The algorithm correctly implements comparison count priority, ELO similarity preference (200 threshold), no-repeat pairs, and random tiebreak. The ELO similarity filtering approach differs slightly from a pure secondary sort but achieves the same intent.
*Reasoning: Plan says: "primary key = sum of comparison counts (lower is better); secondary key = absolute ELO difference (lower is better, within 200 points preferred)." Implementation at lines 283-298: sorts by score (comparison count sum) ascending, then eloDiff ascending. Then among ties on best score, prefers pairs within 200 ELO diff. The two-stage filter (sort then filter closeElo from tied set) is equivalent to the plan's intent. Random tiebreak at line 298 is correct. No-repeat pairs enforced by seenPairs set at lines 242-246. Auto-complete on exhaustion at lines 275-281.*
