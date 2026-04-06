---
title: "Commission: Tournament Phase 1+2 Review"
date: 2026-04-06
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the tournament types and ELO engine implementation (Phases 1-2 from `.lore/plans/tournament-ranking.md`).\n\nCheck:\n1. All types match the plan's specifications exactly (field names, types, optionality)\n2. Zod schemas validate and reject correctly\n3. ELO math: verify the hand-calculated worked example against independent calculation. Each step must be traceable.\n4. K-factor uses threshold of 15 (per REQ-TOURN-6), NOT 30\n5. Recalculate produces identical results to incremental updates\n6. Normalization: reference window, clamping, \"not yet ranked\" threshold, all-equal edge case\n7. All functions are pure (no I/O, no side effects)\n8. Test coverage on all edge cases listed in the plan\n\nFiles: `packages/shared/src/types.ts`, `packages/shared/src/validation.ts`, `packages/daemon/src/services/elo-engine.ts`, `packages/daemon/tests/elo-engine.test.ts`"
dependencies:
  - commission-Dalton-20260406-153803
linked_artifacts:
  - packages/shared/src/types.ts

  - packages/shared/src/validation.ts
  - packages/shared/src/index.ts
  - packages/daemon/src/services/elo-engine.ts
  - packages/daemon/tests/elo-engine.test.ts
  - packages/shared/tests/validation.test.ts
  - packages/shared/src/validation.ts
  - packages/shared/src/index.ts
  - packages/daemon/src/services/elo-engine.ts
  - packages/daemon/tests/elo-engine.test.ts
  - packages/shared/tests/validation.test.ts
activity_timeline:
  - timestamp: 2026-04-06T22:38:13.216Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T22:38:13.218Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-06T22:42:21.528Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-06T22:42:21.530Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-06T22:42:21.547Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-06T22:42:46.143Z
    event: progress_report
    reason: "Read all files: plan, spec, types, validation schemas, ELO engine, tests, Dalton commission result. Beginning detailed analysis."
  - timestamp: 2026-04-06T22:46:03.704Z
    event: progress_report
    reason: "All findings recorded. Types verified, ELO math independently calculated, test coverage analyzed. Two defects found, one deviation, one observation. Preparing final submission."
  - timestamp: 2026-04-06T22:46:34.889Z
    event: result_submitted
    reason: "## Review: Tournament Phase 1+2 (Types + ELO Engine)\n\n### Findings by Priority\n\n**1. DEFECT — \"Incremental matches recalculate\" test is vacuous**\nFile: `packages/daemon/tests/elo-engine.test.ts:234-256`\n\nThe test claims to verify that adding comparisons one at a time matches batch recalculation. Both paths call `recalculateAllRatings` on the same input. The loop ends with `recalculateAllRatings(comparisons.slice(0, 5), 15)` which is identical to the `batchResult` call. The test passes by construction, not by verification.\n\n**Fix**: Build stats manually using `calculateNewRatings` step by step (start at 1500, apply each comparison, track counts), then compare against `recalculateAllRatings` on the full list. That's the real incremental-vs-batch comparison the plan requires.\n\n**2. GAP — Worked example only asserts steps 1-5 of 10**\nFile: `packages/daemon/tests/elo-engine.test.ts:187-218`\n\nThe step-by-step test loops through all 10 comparisons but only has `if (i === N)` assertion blocks for steps 1-5. Steps 6-10 are documented in comments (lines 129-161) with correct expected values, but those values are never asserted. The interesting calculations (non-0.5 expected scores, asymmetric ratings) happen in steps 6-10.\n\n**Fix**: Add assertion blocks for `if (i === 6)` through `if (i === 10)`. The expected values are already in the comments.\n\n**3. DEVIATION — normalizeElo returns number, plan says number | null**\nFile: `packages/daemon/src/services/elo-engine.ts:94`\n\nPlan specifies `normalizeElo` returns `number | null`. Implementation returns `number` unconditionally. The null case is handled by the separate `shouldDisplayRanking` function. This is a cleaner separation of concerns. Not a defect, but Phase 3 must compose both functions to produce `TournamentGameStatsDisplay.normalizedScore: number | null`.\n\n**Action**: No change needed if Phase 3 is aware. Document the composition pattern.\n\n**4. OBSERVATION — SubmitComparisonSchema doesn't enforce winnerId ∈ {gameAId, gameBId}**\nFile: `packages/shared/src/validation.ts:56-60`\n\nREQ-TOURN-1 says winnerId \"must equal gameAId or gameBId.\" The schema validates presence only. The `AddGameSchema` already uses `.refine()` for cross-field validation, so there's precedent. Enforcement is deferred to the service layer, which is acceptable, but a schema-level `.refine()` would catch the error earlier with a clearer message.\n\n**Action**: Consider adding `.refine((d) => d.winnerId === d.gameAId || d.winnerId === d.gameBId, ...)` for defense in depth. Not blocking.\n\n---\n\n### Confirmed Correct\n\n- **All 11 types match the plan exactly.** Field names, types, optionality verified line-by-line. `types.ts:89-152` matches plan lines 140-203.\n- **ELO math is correct.** All 10 steps of the worked example independently hand-calculated. Conservation verified (total = 7500). Final ranking C > B > A > E > D matches expected outcomes from win/loss records.\n- **K-factor uses threshold 15 per REQ-TOURN-6.** `elo-engine.ts:33` uses `compCountA < kThreshold`. Tests verify transition at counts 14/15. Spec inconsistency (success criteria says 30) documented in test comments.\n- **All functions are pure.** No I/O, no side effects, no service dependencies. `recalculateAllRatings` copies input before sorting.\n- **Normalization formula is correct.** Center (1500) maps to 5.5, boundaries clamp to 1.0/10.0, linear interpolation verified, different halfWidth values tested.\n- **Zod schemas validate and reject correctly.** 15 validation tests cover invalid types, empty values, missing fields, null defaults.\n- **Re-exports are complete.** `index.ts` exports all 11 types, 3 schemas, and 3 input types.\n- **Chronological ordering enforced.** `recalculateAllRatings` sorts by `createdAt` before replay. Test verifies shuffled input produces same result as ordered input.\n\n### Requirements Checklist\n\n| Requirement | Status | Evidence |\n|-------------|--------|----------|\n| REQ-TOURN-1 (Comparison entity) | PASS | types.ts:114-121, all fields present |\n| REQ-TOURN-2 (TournamentSession entity) | PASS | types.ts:104-112, filters as plural array (deliberate plan improvement over spec singular) |\n| REQ-TOURN-3 (tournament.json storage) | N/A Phase 2 | Types defined, storage implementation is Phase 3 |\n| REQ-TOURN-4 (Per-game eloRating/comparisonCount) | PASS | types.ts:123-126, TournamentGameStats |\n| REQ-TOURN-5 (Standard ELO formula) | PASS | elo-engine.ts:10-12, independently verified |\n| REQ-TOURN-6 (K-factor with threshold 15) | PASS | elo-engine.ts:33-34, test documents spec inconsistency |\n| REQ-TOURN-7 (Recalculate from history) | PARTIAL | Function exists and works. Test claiming incremental-vs-batch verification is vacuous (Finding 1). |\n| REQ-TOURN-9 (Normalization to 1.0-10.0) | PASS | elo-engine.ts:94-98, formula verified, clamping correct |"
  - timestamp: 2026-04-06T22:46:44.664Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All findings recorded. Types verified, ELO math independently calculated, test coverage analyzed. Two defects found, one deviation, one observation. Preparing final submission."
projectName: shelf-judge
---
## Review: Tournament Phase 1+2 (Types + ELO Engine)

### Findings by Priority

**1. DEFECT — "Incremental matches recalculate" test is vacuous**
File: `packages/daemon/tests/elo-engine.test.ts:234-256`

The test claims to verify that adding comparisons one at a time matches batch recalculation. Both paths call `recalculateAllRatings` on the same input. The loop ends with `recalculateAllRatings(comparisons.slice(0, 5), 15)` which is identical to the `batchResult` call. The test passes by construction, not by verification.

**Fix**: Build stats manually using `calculateNewRatings` step by step (start at 1500, apply each comparison, track counts), then compare against `recalculateAllRatings` on the full list. That's the real incremental-vs-batch comparison the plan requires.

**2. GAP — Worked example only asserts steps 1-5 of 10**
File: `packages/daemon/tests/elo-engine.test.ts:187-218`

The step-by-step test loops through all 10 comparisons but only has `if (i === N)` assertion blocks for steps 1-5. Steps 6-10 are documented in comments (lines 129-161) with correct expected values, but those values are never asserted. The interesting calculations (non-0.5 expected scores, asymmetric ratings) happen in steps 6-10.

**Fix**: Add assertion blocks for `if (i === 6)` through `if (i === 10)`. The expected values are already in the comments.

**3. DEVIATION — normalizeElo returns number, plan says number | null**
File: `packages/daemon/src/services/elo-engine.ts:94`

Plan specifies `normalizeElo` returns `number | null`. Implementation returns `number` unconditionally. The null case is handled by the separate `shouldDisplayRanking` function. This is a cleaner separation of concerns. Not a defect, but Phase 3 must compose both functions to produce `TournamentGameStatsDisplay.normalizedScore: number | null`.

**Action**: No change needed if Phase 3 is aware. Document the composition pattern.

**4. OBSERVATION — SubmitComparisonSchema doesn't enforce winnerId ∈ {gameAId, gameBId}**
File: `packages/shared/src/validation.ts:56-60`

REQ-TOURN-1 says winnerId "must equal gameAId or gameBId." The schema validates presence only. The `AddGameSchema` already uses `.refine()` for cross-field validation, so there's precedent. Enforcement is deferred to the service layer, which is acceptable, but a schema-level `.refine()` would catch the error earlier with a clearer message.

**Action**: Consider adding `.refine((d) => d.winnerId === d.gameAId || d.winnerId === d.gameBId, ...)` for defense in depth. Not blocking.

---

### Confirmed Correct

- **All 11 types match the plan exactly.** Field names, types, optionality verified line-by-line. `types.ts:89-152` matches plan lines 140-203.
- **ELO math is correct.** All 10 steps of the worked example independently hand-calculated. Conservation verified (total = 7500). Final ranking C > B > A > E > D matches expected outcomes from win/loss records.
- **K-factor uses threshold 15 per REQ-TOURN-6.** `elo-engine.ts:33` uses `compCountA < kThreshold`. Tests verify transition at counts 14/15. Spec inconsistency (success criteria says 30) documented in test comments.
- **All functions are pure.** No I/O, no side effects, no service dependencies. `recalculateAllRatings` copies input before sorting.
- **Normalization formula is correct.** Center (1500) maps to 5.5, boundaries clamp to 1.0/10.0, linear interpolation verified, different halfWidth values tested.
- **Zod schemas validate and reject correctly.** 15 validation tests cover invalid types, empty values, missing fields, null defaults.
- **Re-exports are complete.** `index.ts` exports all 11 types, 3 schemas, and 3 input types.
- **Chronological ordering enforced.** `recalculateAllRatings` sorts by `createdAt` before replay. Test verifies shuffled input produces same result as ordered input.

### Requirements Checklist

| Requirement | Status | Evidence |
|-------------|--------|----------|
| REQ-TOURN-1 (Comparison entity) | PASS | types.ts:114-121, all fields present |
| REQ-TOURN-2 (TournamentSession entity) | PASS | types.ts:104-112, filters as plural array (deliberate plan improvement over spec singular) |
| REQ-TOURN-3 (tournament.json storage) | N/A Phase 2 | Types defined, storage implementation is Phase 3 |
| REQ-TOURN-4 (Per-game eloRating/comparisonCount) | PASS | types.ts:123-126, TournamentGameStats |
| REQ-TOURN-5 (Standard ELO formula) | PASS | elo-engine.ts:10-12, independently verified |
| REQ-TOURN-6 (K-factor with threshold 15) | PASS | elo-engine.ts:33-34, test documents spec inconsistency |
| REQ-TOURN-7 (Recalculate from history) | PARTIAL | Function exists and works. Test claiming incremental-vs-batch verification is vacuous (Finding 1). |
| REQ-TOURN-9 (Normalization to 1.0-10.0) | PASS | elo-engine.ts:94-98, formula verified, clamping correct |

## Decisions

**Do all 11 tournament types in types.ts match the plan's Phase 1 specifications?**
All types match exactly. Field names, types, and optionality are correct for: TournamentSettings, SessionFilterType, SessionFilter, SessionStatus, TournamentSession, Comparison, TournamentGameStats, TournamentData, RecentComparison, TournamentGameStatsDisplay.
*Reasoning: Line-by-line comparison of types.ts:89-152 against plan lines 140-203. Every field name, type annotation, and nullability matches. The comments documenting defaults (kFactorThreshold=15, normalizationHalfWidth=400, provisionalThreshold=6) are consistent with the spec. Re-exports in index.ts cover all 11 types and 3 schemas.*

**Do the Zod schemas validate and reject correctly?**
Schemas are functionally correct. SessionFilterSchema validates enum type and non-empty value. StartSessionSchema defaults filters to null when omitted. SubmitComparisonSchema validates presence of all three fields. Tests cover 15 validation scenarios including rejection of invalid types, empty values, and missing fields.
*Reasoning: Reviewed validation.ts:47-60 and validation.test.ts:164-283. All three schemas parse and reject as expected. One structural note: SubmitComparisonSchema does not enforce winnerId ∈ {gameAId, gameBId} (REQ-TOURN-1 constraint). This is a business rule that could be enforced at the schema level via .refine() for earlier error messages, but is reasonably deferred to the service layer.*

**Is the ELO math implementation correct? Independent hand calculation of the 10-comparison worked example.**
ELO math is correct. All 10 steps independently verified. The standard formula is implemented correctly, K-factor selection is correct, and ELO conservation holds when K-factors are equal.
*Reasoning: Independent calculation of all 10 steps:
Step 1: A=1516, B=1484 (equal ratings, 0.5 expected, K=32). ✓
Step 2: C=1516, D=1484. ✓
Step 3: A=1500, C=1532. ✓
Step 4: B=1500, D=1468. ✓
Step 5: E=1516, A=1484. ✓
Step 6: E≈1500.74, C≈1547.26 (expected(E)≈0.4770). ✓
Step 7: A≈1499.26, D≈1452.74. ✓
Step 8: B≈1516.03, E≈1484.70. ✓
Step 9: C≈1561.83, B≈1501.47. ✓
Step 10: D≈1438.20, E≈1499.23. ✓
Total: 7499.99 ≈ 7500 (conserved). Final ranking: C > B > A > E > D.*

**Does the K-factor use threshold 15 per REQ-TOURN-6?**
Yes. K-factor threshold is correctly parameterized. elo-engine.ts:33 uses strict less-than (compCountA < kThreshold) which means K=32 for counts 0-14 and K=16 for counts 15+. Tests at elo-engine.test.ts:67-76 verify the transition explicitly with counts 14 and 15, and document the spec inconsistency (success criteria says 30, REQ-TOURN-6 says 15).
*Reasoning: Code at elo-engine.ts:33-34. Test at elo-engine.test.ts:64-76 with comment documenting the spec conflict. The plan at line 88 resolves this in favor of REQ-TOURN-6. Implementation follows the plan.*

**Does the "incremental matches recalculate" test actually verify what it claims?**
DEFECT: The test is vacuous. It calls recalculateAllRatings repeatedly with growing slices, and the final call is recalculateAllRatings(comparisons.slice(0, 5), 15) which is identical to recalculateAllRatings(comparisons, 15). Both paths produce the same result by construction because they're the same function with the same input.
*Reasoning: elo-engine.test.ts:234-256. The loop `for (let i = 1; i <= comparisons.length; i++) { incrementalResult = recalculateAllRatings(comparisons.slice(0, i), 15); }` ends with i=5, producing the same call as `batchResult`. A meaningful test would: (1) start with empty stats {eloRating: 1500, comparisonCount: 0}, (2) call calculateNewRatings for each comparison, updating stats manually, (3) call recalculateAllRatings on the full list, (4) compare the two results. This would verify that the replay logic in recalculateAllRatings matches step-by-step application of calculateNewRatings.*

**Does the step-by-step worked example verify all 10 steps?**
GAP: Only steps 1-5 have assertions. Steps 6-10 are documented in comments but the test loop's if-statements stop at i===5. The expected values for steps 6-10 are never asserted individually. The final test ("produces correct final ratings") only checks ordering constraints (C > B > A > D) and rough bounds, not exact values.
*Reasoning: elo-engine.test.ts:187-218. The loop runs i from 1 to 10 and calls recalculateAllRatings for each prefix, but assertions exist only in `if (i === 1)` through `if (i === 5)` blocks. The comments at lines 129-161 document expected values for all 10 steps, but assertions for steps 6-10 are absent. This means the non-trivial calculations (where ratings diverge from 1500 and expected scores are no longer 0.5) go unverified at intermediate points.*

**Does normalizeElo match the plan's signature (number | null)?**
DEVIATION: Plan specifies normalizeElo returns number | null. Implementation returns number. The null case is handled by the separate shouldDisplayRanking function. This is a cleaner separation of concerns, but downstream code (Phase 3 service layer) must compose both functions to produce the TournamentGameStatsDisplay.normalizedScore field which IS number | null.
*Reasoning: Plan line 234: "Returns null when normalization shouldn't be displayed (caller decides based on game count)." Implementation at elo-engine.ts:94 returns number unconditionally. The shouldDisplayRanking function at line 105 handles the "should we display?" decision separately. The plan's wording is ambiguous ("caller decides") which supports this interpretation. Not a defect, but downstream phases must compose both correctly.*

**Are all ELO engine functions pure (no I/O, no side effects)?**
All five functions are pure. No I/O, no service dependencies, no mutations of input data. recalculateAllRatings creates a local stats map and copies the comparisons array before sorting. The only import is the Comparison type from shared.
*Reasoning: elo-engine.ts imports only types (line 5). calculateExpectedScore and normalizeElo are arithmetic. calculateNewRatings derives values from inputs without mutation. recalculateAllRatings creates local state (`stats` object at line 51, spread-copy of comparisons at line 61) and returns a fresh object. shouldDisplayRanking is a comparison. No fetch, no fs, no service calls.*

**Does the SubmitComparisonSchema enforce that winnerId must equal gameAId or gameBId?**
OBSERVATION: The schema does not enforce this constraint. REQ-TOURN-1 says winnerId "must equal gameAId or gameBId." The Zod schema at validation.ts:56-60 validates presence and non-emptiness only. A .refine() could enforce this at the schema level for earlier, clearer error messages. This is a reasonable design choice (service-layer enforcement is fine) but worth noting for Phase 3 implementer awareness.
*Reasoning: The plan's Phase 1 description says "validates { winnerId: string }" suggesting presence-only validation. The constraint is a business rule that belongs at the service boundary. However, Zod .refine() is available and would catch the error before it reaches the service. The AddGameSchema already uses .refine() for the "name or bggId" constraint, establishing precedent for cross-field validation at the schema level.*
