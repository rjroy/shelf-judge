---
title: "Commission: Review: Tournament Overhead Phase 1+2"
date: 2026-04-10
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review Phases 1 and 2 of the tournament overhead reduction.\n\n**Spec**: `.lore/specs/reduce-tournament-overhead.md`\n**Plan**: `.lore/plans/reduce-tournament-overhead.md`\n\nFocus areas:\n1. **Migration correctness** (highest risk). The migration transforms existing user data. Verify: wins/losses computed correctly from comparison history, recentComparisons capped at 10 and ordered most-recent-first, active session comparisons moved correctly, completed sessions get empty comparisons, ELO and comparisonCount preserved, idempotency works.\n2. **Type contract**. Verify the new types match the spec requirements (REQ-RTO-1 through REQ-RTO-5, REQ-RTO-14).\n3. **Schema dual-format acceptance**. The Zod schema must accept both pre-migration and post-migration formats with correct defaults.\n4. **Test coverage**. The migration module is the highest-risk change. Are all edge cases covered? Games referenced in comparisons but missing from gameStats? Cap enforcement? Chronological ordering?\n\nFiles to review:\n- `packages/shared/src/types.ts`\n- `packages/shared/src/validation.ts`\n- `packages/daemon/src/services/tournament-migration.ts`\n- `packages/daemon/tests/tournament-migration.test.ts`\n- Any new test files in packages/shared/"
dependencies:
  - commission-Dalton-20260410-070820
linked_artifacts:
  - packages/shared/src/types.ts

  - packages/shared/src/validation.ts
  - packages/shared/src/index.ts
  - packages/shared/tests/validation.test.ts
  - packages/daemon/src/services/tournament-migration.ts
  - packages/daemon/tests/tournament-migration.test.ts
  - packages/shared/src/validation.ts
  - packages/shared/src/index.ts
  - packages/shared/tests/validation.test.ts
  - packages/daemon/src/services/tournament-migration.ts
  - packages/daemon/tests/tournament-migration.test.ts
activity_timeline:
  - timestamp: 2026-04-10T14:08:29.924Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T14:09:54.550Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-10T14:13:30.414Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-10T14:13:30.416Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T14:13:30.437Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T14:13:46.205Z
    event: progress_report
    reason: "Starting review of Phases 1-2 of tournament overhead reduction. Reading spec, plan, and dependency commission first."
  - timestamp: 2026-04-10T14:14:13.403Z
    event: progress_report
    reason: "All source files read. Starting detailed analysis of types, validation, migration, and tests against spec requirements."
  - timestamp: 2026-04-10T14:16:50.348Z
    event: progress_report
    reason: "Analysis complete. Recording final findings and preparing submission. Found: 0 defects, 1 test coverage gap worth addressing, 2 minor observations for documentation."
  - timestamp: 2026-04-10T14:17:19.774Z
    event: result_submitted
    reason: "## Review: Phases 1-2 of Tournament Overhead Reduction\n\n**Verdict: Approved to proceed to Phase 3.** No defects found. One test gap worth closing before moving on.\n\n---\n\n### Requirement Coverage\n\nAll Phase 1-2 requirements verified:\n\n| Requirement | Status | Evidence |\n|---|---|---|\n| REQ-RTO-1 (wins, losses on TournamentGameStats) | Satisfied | types.ts:169-170 |\n| REQ-RTO-2 (recentComparisons capped at 10, most-recent-first) | Satisfied | types.ts:171, migration.ts:84,91 |\n| REQ-RTO-3 (remove top-level comparisons) | Satisfied | types.ts:174-178 (field absent) |\n| REQ-RTO-4 (session-scoped comparisons) | Satisfied | types.ts:148 |\n| REQ-RTO-5 (Comparison type unchanged) | Satisfied | types.ts:151-158 |\n| REQ-RTO-12 (one-time migration) | Satisfied | tournament-migration.ts:29-114 |\n| REQ-RTO-13 (migration preserves ELO/counts) | Satisfied | tournament-migration.ts:86-88, test line 198 |\n| REQ-RTO-14 (schema accepts both formats) | Satisfied | validation.ts:144-149, tests lines 530-658 |\n\n---\n\n### Findings (priority order)\n\n#### 1. Test gap: no test for out-of-order comparisons in raw data (Medium)\n\n**File**: `packages/daemon/tests/tournament-migration.test.ts`\n**What**: Every test fixture provides comparisons in chronological order. No test supplies comparisons with shuffled `createdAt` timestamps.\n**Why it matters**: The sort at `tournament-migration.ts:47-49` is load-bearing. It ensures `recentComparisons` captures the truly most-recent entries after the cap at 10. If the sort were removed during a future refactor, no test would catch it. The cap test (line 111) would still pass because it generates comparisons in order.\n**Recommendation**: Add one test with 15 comparisons in reverse or random chronological order. Verify the 10 most-recent survive the cap, not the first 10 processed.\n\n#### 2. Migration function's return type is stronger than its guarantee (Low)\n\n**File**: `packages/daemon/src/services/tournament-migration.ts:34`\n**What**: The non-migration path casts `raw as unknown as TournamentData` without validation. The function signature promises `TournamentData` but only delivers it when the Zod schema runs afterward.\n**Why it matters**: The function's contract is safe only because the plan specifies \"migrate then validate.\" If someone calls `migrateTournamentData` without subsequent Zod validation, the return type lies.\n**Recommendation**: Add a JSDoc note: \"Caller must validate the returned data with TournamentDataSchema. The non-migration path returns raw data without structural verification.\"\n\n#### 3. Minor: wasted computation for deleted games (Informational)\n\n**File**: `packages/daemon/src/services/tournament-migration.ts:60-61`\n**What**: When a comparison involves one existing and one deleted game, wins/losses are computed for the deleted game (in winsMap/lossesMap) but never written to migratedStats. The work is discarded at lines 80-93 since only existingStats keys are iterated.\n**Why it matters**: Not a correctness issue. Wasted cycles are trivial given migration runs once. Noting for completeness only.\n\n---\n\n### What's solid\n\n- **Win/loss computation**: Both the winnerId-is-gameAId and winnerId-is-gameBId paths are exercised by tests. The derivation logic at line 53 is correct.\n- **Cap enforcement**: Tested with 15 comparisons, verified only 10 survive. Most-recent-first ordering verified separately.\n- **Session handling**: Active session gets its comparisons, completed sessions get empty arrays. Tested with mixed active/completed fixture.\n- **Defensive handling**: Both-games-deleted comparisons are skipped (line 56-58). One-game-deleted comparisons still count for the surviving game (test line 308).\n- **Idempotency**: Post-migration data returns unchanged with `migrated: false`. Fresh tournament data (no comparisons field) also returns unchanged. Both tested.\n- **Schema design**: Dual-format acceptance is clean. Optional fields with correct defaults. The asymmetry between top-level comparisons (no default, truly optional/legacy) and session comparisons (default to []) is intentional and correct.\n- **Exports**: All new types and schemas re-exported from index.ts.\n\n---\n\n### Recommendation\n\nClose finding #1 (out-of-order test) before starting Phase 3. It's a five-minute addition that protects the migration's most important invariant. Finding #2 is a documentation-only improvement that can be addressed at any time."
  - timestamp: 2026-04-10T14:17:24.034Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Analysis complete. Recording final findings and preparing submission. Found: 0 defects, 1 test coverage gap worth addressing, 2 minor observations for documentation."
projectName: shelf-judge
---
## Review: Phases 1-2 of Tournament Overhead Reduction

**Verdict: Approved to proceed to Phase 3.** No defects found. One test gap worth closing before moving on.

---

### Requirement Coverage

All Phase 1-2 requirements verified:

| Requirement | Status | Evidence |
|---|---|---|
| REQ-RTO-1 (wins, losses on TournamentGameStats) | Satisfied | types.ts:169-170 |
| REQ-RTO-2 (recentComparisons capped at 10, most-recent-first) | Satisfied | types.ts:171, migration.ts:84,91 |
| REQ-RTO-3 (remove top-level comparisons) | Satisfied | types.ts:174-178 (field absent) |
| REQ-RTO-4 (session-scoped comparisons) | Satisfied | types.ts:148 |
| REQ-RTO-5 (Comparison type unchanged) | Satisfied | types.ts:151-158 |
| REQ-RTO-12 (one-time migration) | Satisfied | tournament-migration.ts:29-114 |
| REQ-RTO-13 (migration preserves ELO/counts) | Satisfied | tournament-migration.ts:86-88, test line 198 |
| REQ-RTO-14 (schema accepts both formats) | Satisfied | validation.ts:144-149, tests lines 530-658 |

---

### Findings (priority order)

#### 1. Test gap: no test for out-of-order comparisons in raw data (Medium)

**File**: `packages/daemon/tests/tournament-migration.test.ts`
**What**: Every test fixture provides comparisons in chronological order. No test supplies comparisons with shuffled `createdAt` timestamps.
**Why it matters**: The sort at `tournament-migration.ts:47-49` is load-bearing. It ensures `recentComparisons` captures the truly most-recent entries after the cap at 10. If the sort were removed during a future refactor, no test would catch it. The cap test (line 111) would still pass because it generates comparisons in order.
**Recommendation**: Add one test with 15 comparisons in reverse or random chronological order. Verify the 10 most-recent survive the cap, not the first 10 processed.

#### 2. Migration function's return type is stronger than its guarantee (Low)

**File**: `packages/daemon/src/services/tournament-migration.ts:34`
**What**: The non-migration path casts `raw as unknown as TournamentData` without validation. The function signature promises `TournamentData` but only delivers it when the Zod schema runs afterward.
**Why it matters**: The function's contract is safe only because the plan specifies "migrate then validate." If someone calls `migrateTournamentData` without subsequent Zod validation, the return type lies.
**Recommendation**: Add a JSDoc note: "Caller must validate the returned data with TournamentDataSchema. The non-migration path returns raw data without structural verification."

#### 3. Minor: wasted computation for deleted games (Informational)

**File**: `packages/daemon/src/services/tournament-migration.ts:60-61`
**What**: When a comparison involves one existing and one deleted game, wins/losses are computed for the deleted game (in winsMap/lossesMap) but never written to migratedStats. The work is discarded at lines 80-93 since only existingStats keys are iterated.
**Why it matters**: Not a correctness issue. Wasted cycles are trivial given migration runs once. Noting for completeness only.

---

### What's solid

- **Win/loss computation**: Both the winnerId-is-gameAId and winnerId-is-gameBId paths are exercised by tests. The derivation logic at line 53 is correct.
- **Cap enforcement**: Tested with 15 comparisons, verified only 10 survive. Most-recent-first ordering verified separately.
- **Session handling**: Active session gets its comparisons, completed sessions get empty arrays. Tested with mixed active/completed fixture.
- **Defensive handling**: Both-games-deleted comparisons are skipped (line 56-58). One-game-deleted comparisons still count for the surviving game (test line 308).
- **Idempotency**: Post-migration data returns unchanged with `migrated: false`. Fresh tournament data (no comparisons field) also returns unchanged. Both tested.
- **Schema design**: Dual-format acceptance is clean. Optional fields with correct defaults. The asymmetry between top-level comparisons (no default, truly optional/legacy) and session comparisons (default to []) is intentional and correct.
- **Exports**: All new types and schemas re-exported from index.ts.

---

### Recommendation

Close finding #1 (out-of-order test) before starting Phase 3. It's a five-minute addition that protects the migration's most important invariant. Finding #2 is a documentation-only improvement that can be addressed at any time.

## Decisions

**Do the type changes in types.ts satisfy REQ-RTO-1 through REQ-RTO-5?**
Types are correct. All five requirements satisfied.
*Reasoning: REQ-RTO-1: TournamentGameStats (types.ts:166-172) has wins, losses alongside eloRating and comparisonCount. Correct.
REQ-RTO-2: recentComparisons field present as CachedRecentComparison[] (types.ts:171). CachedRecentComparison (types.ts:160-164) has opponentGameId, won, createdAt. Matches spec exactly.
REQ-RTO-3: TournamentData (types.ts:174-178) has no comparisons field. Correct.
REQ-RTO-4: TournamentSession (types.ts:140-149) has comparisons: Comparison[]. Comment on line 148 documents "Active session only; cleared on completion." Correct.
REQ-RTO-5: Comparison type (types.ts:151-158) is unchanged from original spec. Correct.
REQ-RTO-7 comment update: TournamentGameStatsDisplay.recentComparisons (types.ts:197) comment now reads "Read from cached TournamentGameStats.recentComparisons, enriched with game names at read time." Correct per spec requirement.*

**Does the Zod schema in validation.ts correctly accept both pre-migration and post-migration formats per REQ-RTO-14?**
Schema is correct. Both formats accepted with appropriate defaults.
*Reasoning: TournamentDataSchema (validation.ts:144-149):
- Top-level comparisons: z.array(ComparisonSchema).optional() — accepts pre-migration (present) and post-migration (absent). Correct.
- gameStats uses TournamentGameStatsSchema (validation.ts:125-131) where wins, losses are optional with default(0), recentComparisons optional with default([]). Pre-migration entries without these fields get correct defaults.
- TournamentSessionSchema (validation.ts:133-142) has comparisons: z.array(ComparisonSchema).optional().default([]) — pre-migration sessions without comparisons get empty array. Correct.
- TournamentSettingsSchema (validation.ts:104-108) validates required stored-format fields (distinct from the PATCH-semantics TournamentSettingsUpdateSchema). Correct per plan.

The validation tests (validation.test.ts:523-659) cover: pre-migration format acceptance with defaults, post-migration format acceptance, minimal format with defaults, rejection of missing settings, rejection of invalid session status. Seven tests, all appear sound.*

**Is the migration detection mechanism correct and idempotent?**
Detection is correct but has a subtle edge case worth noting.
*Reasoning: Detection (tournament-migration.ts:33): checks `!Array.isArray(topComparisons)`. If absent (post-migration), returns unchanged. If present as array (pre-migration), migrates.

Idempotency: post-migration data has no top-level comparisons field, so `raw.comparisons` is undefined, `Array.isArray(undefined)` is false, returns `migrated: false`. Correct.

Edge case: an empty comparisons array `[]` IS an array, so `Array.isArray([])` is true, triggering migration. This is tested (test line 360-376) and produces correct output. The migration removes the field and returns `migrated: true`, which means the caller will save. This is fine behavior — it converts legacy format with zero comparisons to new format. Not a defect.*

**Does the migration compute wins and losses correctly from comparison history?**
Win/loss computation is correct.
*Reasoning: tournament-migration.ts:51-77: For each comparison, winnerId is extracted (line 52), loserId is derived (line 53). Both games' wins/losses are incremented. The logic correctly handles the case where gameAId or gameBId is the winner.

The defensive check (lines 56-58) skips comparisons where BOTH games lack gameStats entries. When only one game has stats, the comparison still counts — the surviving game gets its win/loss recorded, and the deleted game's stats are tracked in winsMap/lossesMap but never written to migratedStats (because it has no entry in existingStats). This is correct per REQ-RTO-13.

However: there's a subtlety. Lines 60-61 increment winsMap/lossesMap for both winnerId and loserId, even if loserId has no gameStats entry. Since migratedStats (line 80-93) only iterates existingStats entries, wins/losses for deleted games are computed but discarded. Wasted work, not a bug.*

**Does the migration correctly cap recentComparisons at 10 and order most-recent-first?**
Correct. Chronological processing, then reverse sort, then cap.
*Reasoning: tournament-migration.ts:47-49: Comparisons are sorted oldest-first before processing. This means recentMap accumulates entries in chronological order.

Lines 83-84: After accumulation, each game's recent list is sorted most-recent-first (by descending createdAt). Line 91: sliced to RECENT_COMPARISONS_CAP (10).

This approach is correct. Processing in chronological order then sorting is equivalent to just sorting the result, which is what's done. The cap is applied after sorting, keeping the 10 most recent. Matches REQ-RTO-2.*

**Does the migration correctly handle active session comparisons per REQ-RTO-12?**
Correct. Active session gets its comparisons; completed sessions get empty arrays.
*Reasoning: tournament-migration.ts:96-105:
1. Finds active session by status === "active" (line 96). Takes only the first match via .find(), which is correct since the tournament service only allows one active session.
2. Filters top-level comparisons by activeSessionId (line 98). Uses the original unsorted `comparisons` array, not `sorted`. This preserves the original insertion order for session comparisons.
3. Maps all sessions: active session gets its filtered comparisons, all others get [] (lines 102-105).

This matches REQ-RTO-12 step 3: "move any active session's comparisons into the session object, initializing the session's comparisons field to [] before populating it."*

**Does the migration preserve ELO ratings and comparison counts per REQ-RTO-13?**
Correct. ELO and comparisonCount are copied directly from existing stats.
*Reasoning: tournament-migration.ts:86-88: `eloRating: stats.eloRating` and `comparisonCount: stats.comparisonCount` are copied verbatim from the existing gameStats entries. No recalculation. The test at lines 198-214 verifies this with specific decimal ELO values (1532.7, 1467.3).*

**FINDING: Does the migration handle the case where a comparison references a game that exists in gameStats but has no recentComparisons entry initialized?**
Handled correctly. The recentMap is initialized lazily per game (lines 64, 71), and migratedStats defaults to empty array if no entries exist (line 82: `recentMap.get(gameId) ?? []`).
*Reasoning: A game could exist in gameStats with zero comparisons (e.g., added to tournament but never compared). It would have no entries in recentMap. Line 82 defaults to [], line 89 sets wins to 0, line 90 sets losses to 0. All correct.*

**FINDING: Is there a test for the case where a comparison's winner is gameBId (not gameAId)?**
Covered. Multiple tests exercise this path.
*Reasoning: The recentComparisons test (line 326-358) includes makeComparison("c2", "g2", "g3", "g3", "s1", ...) where winnerId "g3" equals gameBId. The loserId derivation at migration line 53 (`comp.gameAId === winnerId ? comp.gameBId : comp.gameAId`) correctly yields "g2" as the loser. The test at line 349-352 verifies g2 shows two losses with correct opponents, confirming the gameBId-as-winner path works.*

**FINDING: Is there a missing test for multiple active sessions (defensive edge case)?**
Not a gap. The tournament service enforces at most one active session. The migration uses .find() which returns the first match. Multiple active sessions in stored data would be a pre-existing data corruption issue outside migration's scope.
*Reasoning: The plan's risk note #1 mentions handling unexpected structure, but the service layer (tournament-service.ts, per plan lines 184-219) auto-completes the previous active session when starting a new one. Multiple active sessions can't occur through normal operation. The migration's .find() behavior (picking the first) is reasonable for a defensive case that shouldn't exist.*

**FINDING: Migration test coverage gap — no test for comparisons arriving out of chronological order in the raw data.**
This is a test coverage gap, but low severity. The migration sorts comparisons chronologically (line 47-49) before processing, so out-of-order input is handled correctly by the code. However, no test verifies this. If the sort were accidentally removed, no test would catch it until recentComparisons ordering broke.
*Reasoning: All test fixtures provide comparisons in chronological order. A test with deliberately shuffled createdAt values would verify the sort at line 47-49 is load-bearing. The sort exists to ensure recentComparisons captures the truly most-recent entries after the cap. Without the sort, the first 10 comparisons processed would survive rather than the last 10.*

**FINDING: Migration test coverage gap — no test verifies that active session comparisons use the original array order, not the sorted order.**
Minor gap. The migration uses `comparisons` (original) for session comparisons (line 98) and `sorted` for win/loss computation (line 51). If someone refactored to use `sorted` for session comparisons, no test would catch it. The functional impact is nil (session comparisons are used for pair dedup, where order doesn't matter), but it's worth noting as a documentation/intent issue.
*Reasoning: Line 98: `comparisons.filter(c => c.sessionId === activeSessionId)` uses the original unsorted array. This preserves the original insertion order. Since `Comparison` objects have their own `createdAt`, the ordering within the session is deterministic regardless. Not a functional concern, just a code intent concern.*

**FINDING: The migration function's type signature accepts Record&lt;string, unknown&gt; but the non-migration path casts blindly.**
Defect, low severity. Line 34: `return { data: raw as unknown as TournamentData, migrated: false }` bypasses all type safety. If `raw` is already-migrated data that has been validated by the Zod schema, this is safe in practice. But if `migrateTournamentData` is called before schema validation (which is the plan — see plan Phase 3 storage integration), then `raw` could be invalid JSON that happens to lack a `comparisons` field, and the function would return it as TournamentData without validation.
*Reasoning: The plan specifies (Phase 3): "call migrateTournamentData(raw) on the parsed JSON, then validate with TournamentDataSchema." So the call order is: parse → migrate → validate. For already-migrated data, migrate returns the raw cast, then validate catches any structural issues. The cast is therefore safe in the intended call chain. But the function's contract is misleading — it claims to return TournamentData when it hasn't verified that. The Zod validation downstream is the actual safety net. Not a functional bug given the intended usage, but the function's return type is stronger than its guarantee.*

**FINDING: The migration function casts raw.settings and raw.sessions without validation.**
Acceptable given the intended call chain (migrate then validate), but worth documenting. Lines 38-39 cast sessions and existingStats with `as` casts. Line 108 casts settings. If the raw data has malformed settings or sessions, the migration will proceed with garbage data and the Zod validation afterward will catch it. No silent corruption since the Zod step follows.
*Reasoning: The migration is designed as a pure transformation, not a validator. The plan explicitly separates "migrate" from "validate." The casts are the trade-off for keeping the migration function simple. If someone called migrateTournamentData without subsequent Zod validation, the casts would be dangerous. A JSDoc comment noting "caller must validate the returned data" would clarify the contract.*

**FINDING: Index.ts re-exports — is CachedRecentComparison exported?**
Yes. CachedRecentComparison is exported from index.ts (line 19). TournamentSettingsSchema and TournamentDataSchema are exported (lines 45-46). All new types and schemas are properly re-exported.
*Reasoning: Checked index.ts lines 19 (CachedRecentComparison type export), 45 (TournamentSettingsSchema), 46 (TournamentDataSchema). The plan required all three. Confirmed present.*

**Spec success criteria coverage for Phases 1-2 items.**
All Phase 1-2 success criteria are covered by tests.
*Reasoning: Spec success criteria mapped to tests:
- "Migration: pre-migration format correctly transformed" → test line 22 (3 games/6 comparisons), line 152 (active/completed sessions), line 270 (top-level removal)
- "Migration: ELO ratings and comparison counts unchanged" → test line 198
- "Migration: wins and losses match hand-calculated values" → test line 22 (explicit counts verified)
- "Migration: recentComparisons last 10 per game, most-recent-first" → test line 75 (ordering), test line 111 (cap at 10)
- "Migration: active session comparisons correctly moved" → test line 152
- "Migration: idempotent" → test line 216
- "Zod schema accepts both formats" → validation.test.ts lines 530, 571
- "Deleting game leaves recentComparisons intact" → This is a Phase 3 behavioral concern, not tested here. Appropriate.*

**FINDING: Validation schema allows top-level comparisons in post-migration format.**
By design, not a defect. The schema's comparisons field is optional (validation.ts:147), meaning it accepts both presence and absence. After migration, only the post-migration format (without comparisons) is written. The schema is intentionally permissive to handle the migration window. The spec explicitly states this (REQ-RTO-14): "After migration runs, only the post-migration format is written."
*Reasoning: A strict schema would reject top-level comparisons in post-migration data. But since the schema is used before migration runs (to validate the raw JSON on load), it must accept the pre-migration format. Making it reject post-migration data with stale comparisons would require a two-schema approach, which the spec doesn't call for.*

**FINDING: TournamentDataSchema comparisons field has no default, unlike session comparisons.**
Correct behavior. Top-level comparisons is optional with no default (validation.ts:147). This means `.data.comparisons` will be undefined when absent. Session comparisons default to [] (validation.ts:141). The asymmetry is intentional: top-level comparisons is a legacy field that should disappear, while session comparisons is an active field that needs a usable default.
*Reasoning: The test at validation.test.ts:610 verifies `result.data.comparisons` is undefined for post-migration format. This is the correct behavior — the field should not appear in the output type after migration.*
