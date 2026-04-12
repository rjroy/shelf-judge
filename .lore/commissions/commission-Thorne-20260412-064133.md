---
title: "Commission: Review: Redundancy scoring Phases 1-4"
date: 2026-04-12
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the redundancy scoring implementation (Phases 1-4) against the plan at `.lore/plans/redundancy-scoring.md` and the spec at `.lore/specs/redundancy-scoring.md`.\n\nCheck:\n1. Shared types match spec definitions (REQ-REDUN-1, REQ-REDUN-2, REQ-REDUN-14, REQ-REDUN-15, REQ-REDUN-16)\n2. `FitnessResult.redundancyAdjustment` added as nullable, all existing constructor sites updated to `null`\n3. Storage follows prediction-settings pattern (default from engine, load/save, atomic write)\n4. Redundancy engine is pure — no I/O, no service imports\n5. `flattenWeighted` handles personalAxes dimension mismatch correctly (omit when either game lacks them)\n6. `computeRedundancyAdjustments` implements the algorithm per REQ-REDUN-8 through REQ-REDUN-13\n7. Tie detection at two decimal places (REQ-REDUN-10)\n8. Predicted game authority (REQ-REDUN-12): predicted neighbors don't penalize actual-scored games\n9. CRUD routes validate all constraints (REQ-REDUN-4)\n10. Route registration in app.ts\n11. Test coverage for all 14 engine test cases and all route validation cases\n\nReport ALL findings."
dependencies:
  - commission-Dalton-20260412-064124
linked_artifacts:
  - packages/daemon/src/services/redundancy-engine.ts

  - packages/daemon/src/routes/redundancy.ts
  - packages/daemon/src/services/storage-service.ts
  - packages/shared/src/types.ts
  - packages/shared/src/index.ts
  - packages/daemon/src/app.ts
  - packages/daemon/tests/redundancy-engine.test.ts
  - packages/daemon/tests/redundancy-settings-routes.test.ts
  - packages/daemon/src/routes/redundancy.ts
  - packages/daemon/src/services/storage-service.ts
  - packages/shared/src/types.ts
  - packages/shared/src/index.ts
  - packages/daemon/src/app.ts
  - packages/daemon/tests/redundancy-engine.test.ts
  - packages/daemon/tests/redundancy-settings-routes.test.ts
activity_timeline:
  - timestamp: 2026-04-12T13:41:33.377Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T13:45:52.838Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T13:55:03.645Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T13:55:03.649Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T13:55:03.675Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T13:55:08.966Z
    event: progress_report
    reason: "Starting review. Reading plan, spec, and dependency commission to establish review criteria."
  - timestamp: 2026-04-12T13:55:29.191Z
    event: progress_report
    reason: "Read all implementation files for Phases 1-4. Now examining types, FitnessResult constructor sites, app.ts registration, and shared index exports."
  - timestamp: 2026-04-12T13:55:43.287Z
    event: progress_report
    reason: "All source files read. Analyzing findings against spec requirements. Recording findings now."
  - timestamp: 2026-04-12T13:59:11.998Z
    event: result_submitted
    reason: "## Review: Redundancy Scoring Phases 1-4\n\nReviewed against `.lore/specs/redundancy-scoring.md` and `.lore/plans/redundancy-scoring.md`.\n\n### Findings (by priority)\n\n**1. DEFECT: Engine callback signature diverges from spec**\nFile: `packages/daemon/src/services/redundancy-engine.ts:88`\n\nThe spec (REQ-REDUN-7) defines `getFeatureVector: (game: Game) => FeatureVector`. The implementation uses `(game: GameWithScore) => FeatureVector`. This changes the contract for all Phase 5 callers. The test helper also uses the wrong signature. The plan at Phase 3c matches the spec, not the implementation.\n\nImpact: Phase 5 route handlers must build callbacks accepting GameWithScore instead of Game. The spec's intent was to keep the engine decoupled from score data in its callback, receiving only the game entity for feature encoding. Passing GameWithScore gives the callback access to scores, which muddies the boundary.\n\nAction: Align the signature with the spec. The engine already has the GameWithScore for score access; it only needs the callback to produce feature vectors from game data.\n\n---\n\n**2. DEFECT: adjustedScore rounding loses precision**\nFile: `packages/daemon/src/services/redundancy-engine.ts:192`\n\n`adjustedScore` is rounded to 1 decimal place (`Math.round(adjustedScore * 10) / 10`), while `penalty` is rounded to 2 decimal places (line 190). The spec (REQ-REDUN-14) defines adjustedScore as `max(1.0, originalScore - penalty)` with no additional rounding. This means `originalScore - penalty !== adjustedScore` in many cases.\n\nExample: originalScore=7.55, penalty=0.33. Actual adjusted=7.22, but the field reports 7.2. In integrated mode (REQ-REDUN-19), `FitnessResult.score` would be set to 7.2, a larger penalty than intended.\n\nAction: Either round adjustedScore to 2 decimal places (matching penalty precision), or don't round at all and let display code handle formatting.\n\n---\n\n**3. CONCERN: NaN risk in flattenWeighted when weights sum to zero**\nFile: `packages/daemon/src/services/redundancy-engine.ts:38-45`\n\nWeight normalization divides by `total`. If total=0, division produces NaN that propagates into the similarity computation and eventually into penalty values. The route validation prevents sum=0 at the API boundary, but the engine function accepts any settings. If called directly (tests, future Phase 5 code), zero weights produce NaN penalties that serialize to `null` through JSON.stringify.\n\nAction: Add a guard at the top of `computeRedundancyAdjustments` or `flattenWeighted` that throws or returns early on zero-sum weights.\n\n---\n\n**4. CONCERN: cosineSimilarity NaN on zero-magnitude vectors**\nFile: `packages/daemon/src/services/redundancy-engine.ts:126`\n\nA game with no BGG data and no ratings produces an all-zero feature vector. `cosineSimilarity(zeros, anything)` computes 0/0 = NaN. The `>=` threshold comparison at line 137 accidentally excludes NaN (NaN >= 0.6 is false), so the behavior is correct but accidental. The NaN persists in the similarity cache.\n\nAction: Guard cosineSimilarity results: `const sim = cosineSimilarity(...); if (isNaN(sim)) return 0;` or equivalent. Makes the behavior explicit.\n\n---\n\n**5. CONCERN: nicheRank does not account for predicted authority**\nFile: `packages/daemon/src/services/redundancy-engine.ts:172-179`\n\nnicheRank counts ALL neighbors with strictly better scores, including fully-predicted neighbors. But penalty computation (lines 151-163) excludes predicted neighbors from betterCount for actual-scored games (REQ-REDUN-12). This creates a disconnect: a game could be \"3rd of 5\" by rank but have a penalty reflecting only 1 better neighbor. The spec (REQ-REDUN-14) defines nicheRank as \"This game's rank among its niche neighbors by fitness (1 = best)\" without addressing predicted authority, making this an ambiguity rather than a clear defect.\n\nAction: Decide whether nicheRank should respect predicted authority. If so, use betterCount for rank. If not, document the intentional difference between rank and penalty semantics.\n\n---\n\n**6. GAP: Missing spec-mandated test cases**\nFile: `packages/daemon/tests/redundancy-engine.test.ts`\n\nThe spec's AI Validation section requires two specific test cases that are missing or incomplete:\n\n- \"3 games with identical fitness scores and high mutual similarity, verifying all receive zero penalty.\" The tied-scores test at line 195 uses only 2 games. The spec asks for 3 to verify the formula handles multi-way ties.\n- \"A game with 5 neighbors where 3 score higher, verifying penalty is (3/5) * maxPenalty.\" No test exercises the fractional ratio formula. The proportional test at line 168 uses 1-of-1 (full penalty), which doesn't verify the fraction.\n\nAction: Add the two missing test configurations.\n\n---\n\n**7. OBSERVATION: flattenWeighted with null personalAxes and includePersonalAxes=true**\nFile: `packages/daemon/src/services/redundancy-engine.ts:37-55`\n\nWhen called with includePersonalAxes=true and a vector whose personalAxes is null, the weight normalization includes personalAxes weight in the denominator but produces no personalAxes dimensions. Binary and continuous components are underweighted. The engine's internal usage prevents this case (line 122 only sets includePA=true when both vectors have non-null axes), but the function is exported and the test at line 104 exercises this path without validating weight correctness.\n\nAction: Either throw when includePersonalAxes=true but vec.personalAxes is null, or treat it as includePersonalAxes=false. The test at line 104 should be updated to reflect the intended contract.\n\n---\n\n**8. OBSERVATION: Pre-merge componentWeights sum check is dead logic for partial patches**\nFile: `packages/daemon/src/routes/redundancy.ts:60-66`\n\nThe pre-merge validation at line 64 only fires when all three weight fields are explicitly provided in the patch. For partial patches (e.g., `{ componentWeights: { binary: 0 } }`), the check is skipped entirely. The post-merge check at line 131 correctly catches all cases. The pre-merge check is redundant dead code for the common partial-patch case.\n\nAction: Remove the pre-merge sum check (lines 60-66) since the post-merge check at line 131 is the actual enforcement. Or keep both, but the pre-merge check adds no value.\n\n---\n\n### Requirements Checklist\n\n| Requirement | Status |\n|---|---|\n| REQ-REDUN-1 (RedundancySettings type) | Satisfied |\n| REQ-REDUN-2 (Default values) | Satisfied |\n| REQ-REDUN-3 (Storage persistence) | Satisfied |\n| REQ-REDUN-4 (CRUD routes + validation) | Satisfied |\n| REQ-REDUN-5 (Disabled short-circuit) | Satisfied (engine short-circuits at line 92) |\n| REQ-REDUN-6 (Pure engine) | Satisfied |\n| REQ-REDUN-7 (Callback signature) | **Divergent** (GameWithScore vs Game) |\n| REQ-REDUN-8 (Algorithm) | Satisfied |\n| REQ-REDUN-9 (Highest-scoring zero penalty) | Satisfied |\n| REQ-REDUN-10 (Tie detection) | Satisfied |\n| REQ-REDUN-11 (Vetoed exclusion) | Satisfied |\n| REQ-REDUN-12 (Predicted authority) | Satisfied |\n| REQ-REDUN-13 (Pairwise, not per-cluster) | Satisfied |\n| REQ-REDUN-14 (RedundancyAdjustment type) | Satisfied |\n| REQ-REDUN-15 (Shared types, sorted neighbors) | Satisfied |\n| REQ-REDUN-16 (FitnessResult field) | Satisfied |\n| REQ-REDUN-30 (Route registration) | Satisfied |\n\n### Summary\n\nThe implementation is structurally sound. Types match the spec, storage follows the established pattern, the engine is pure, route validation is thorough, test coverage is broad. Two defects need attention before Phase 5 builds on this foundation: the callback signature mismatch (Finding 1) and the adjustedScore rounding precision loss (Finding 2). The NaN concerns (Findings 3-4) are low probability but high consequence if triggered. The missing spec-mandated test cases (Finding 6) should be added to close the coverage gap."
  - timestamp: 2026-04-12T13:59:19.697Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All source files read. Analyzing findings against spec requirements. Recording findings now."
projectName: shelf-judge
---
## Review: Redundancy Scoring Phases 1-4

Reviewed against `.lore/specs/redundancy-scoring.md` and `.lore/plans/redundancy-scoring.md`.

### Findings (by priority)

**1. DEFECT: Engine callback signature diverges from spec**
File: `packages/daemon/src/services/redundancy-engine.ts:88`

The spec (REQ-REDUN-7) defines `getFeatureVector: (game: Game) => FeatureVector`. The implementation uses `(game: GameWithScore) => FeatureVector`. This changes the contract for all Phase 5 callers. The test helper also uses the wrong signature. The plan at Phase 3c matches the spec, not the implementation.

Impact: Phase 5 route handlers must build callbacks accepting GameWithScore instead of Game. The spec's intent was to keep the engine decoupled from score data in its callback, receiving only the game entity for feature encoding. Passing GameWithScore gives the callback access to scores, which muddies the boundary.

Action: Align the signature with the spec. The engine already has the GameWithScore for score access; it only needs the callback to produce feature vectors from game data.

---

**2. DEFECT: adjustedScore rounding loses precision**
File: `packages/daemon/src/services/redundancy-engine.ts:192`

`adjustedScore` is rounded to 1 decimal place (`Math.round(adjustedScore * 10) / 10`), while `penalty` is rounded to 2 decimal places (line 190). The spec (REQ-REDUN-14) defines adjustedScore as `max(1.0, originalScore - penalty)` with no additional rounding. This means `originalScore - penalty !== adjustedScore` in many cases.

Example: originalScore=7.55, penalty=0.33. Actual adjusted=7.22, but the field reports 7.2. In integrated mode (REQ-REDUN-19), `FitnessResult.score` would be set to 7.2, a larger penalty than intended.

Action: Either round adjustedScore to 2 decimal places (matching penalty precision), or don't round at all and let display code handle formatting.

---

**3. CONCERN: NaN risk in flattenWeighted when weights sum to zero**
File: `packages/daemon/src/services/redundancy-engine.ts:38-45`

Weight normalization divides by `total`. If total=0, division produces NaN that propagates into the similarity computation and eventually into penalty values. The route validation prevents sum=0 at the API boundary, but the engine function accepts any settings. If called directly (tests, future Phase 5 code), zero weights produce NaN penalties that serialize to `null` through JSON.stringify.

Action: Add a guard at the top of `computeRedundancyAdjustments` or `flattenWeighted` that throws or returns early on zero-sum weights.

---

**4. CONCERN: cosineSimilarity NaN on zero-magnitude vectors**
File: `packages/daemon/src/services/redundancy-engine.ts:126`

A game with no BGG data and no ratings produces an all-zero feature vector. `cosineSimilarity(zeros, anything)` computes 0/0 = NaN. The `>=` threshold comparison at line 137 accidentally excludes NaN (NaN >= 0.6 is false), so the behavior is correct but accidental. The NaN persists in the similarity cache.

Action: Guard cosineSimilarity results: `const sim = cosineSimilarity(...); if (isNaN(sim)) return 0;` or equivalent. Makes the behavior explicit.

---

**5. CONCERN: nicheRank does not account for predicted authority**
File: `packages/daemon/src/services/redundancy-engine.ts:172-179`

nicheRank counts ALL neighbors with strictly better scores, including fully-predicted neighbors. But penalty computation (lines 151-163) excludes predicted neighbors from betterCount for actual-scored games (REQ-REDUN-12). This creates a disconnect: a game could be "3rd of 5" by rank but have a penalty reflecting only 1 better neighbor. The spec (REQ-REDUN-14) defines nicheRank as "This game's rank among its niche neighbors by fitness (1 = best)" without addressing predicted authority, making this an ambiguity rather than a clear defect.

Action: Decide whether nicheRank should respect predicted authority. If so, use betterCount for rank. If not, document the intentional difference between rank and penalty semantics.

---

**6. GAP: Missing spec-mandated test cases**
File: `packages/daemon/tests/redundancy-engine.test.ts`

The spec's AI Validation section requires two specific test cases that are missing or incomplete:

- "3 games with identical fitness scores and high mutual similarity, verifying all receive zero penalty." The tied-scores test at line 195 uses only 2 games. The spec asks for 3 to verify the formula handles multi-way ties.
- "A game with 5 neighbors where 3 score higher, verifying penalty is (3/5) * maxPenalty." No test exercises the fractional ratio formula. The proportional test at line 168 uses 1-of-1 (full penalty), which doesn't verify the fraction.

Action: Add the two missing test configurations.

---

**7. OBSERVATION: flattenWeighted with null personalAxes and includePersonalAxes=true**
File: `packages/daemon/src/services/redundancy-engine.ts:37-55`

When called with includePersonalAxes=true and a vector whose personalAxes is null, the weight normalization includes personalAxes weight in the denominator but produces no personalAxes dimensions. Binary and continuous components are underweighted. The engine's internal usage prevents this case (line 122 only sets includePA=true when both vectors have non-null axes), but the function is exported and the test at line 104 exercises this path without validating weight correctness.

Action: Either throw when includePersonalAxes=true but vec.personalAxes is null, or treat it as includePersonalAxes=false. The test at line 104 should be updated to reflect the intended contract.

---

**8. OBSERVATION: Pre-merge componentWeights sum check is dead logic for partial patches**
File: `packages/daemon/src/routes/redundancy.ts:60-66`

The pre-merge validation at line 64 only fires when all three weight fields are explicitly provided in the patch. For partial patches (e.g., `{ componentWeights: { binary: 0 } }`), the check is skipped entirely. The post-merge check at line 131 correctly catches all cases. The pre-merge check is redundant dead code for the common partial-patch case.

Action: Remove the pre-merge sum check (lines 60-66) since the post-merge check at line 131 is the actual enforcement. Or keep both, but the pre-merge check adds no value.

---

### Requirements Checklist

| Requirement | Status |
|---|---|
| REQ-REDUN-1 (RedundancySettings type) | Satisfied |
| REQ-REDUN-2 (Default values) | Satisfied |
| REQ-REDUN-3 (Storage persistence) | Satisfied |
| REQ-REDUN-4 (CRUD routes + validation) | Satisfied |
| REQ-REDUN-5 (Disabled short-circuit) | Satisfied (engine short-circuits at line 92) |
| REQ-REDUN-6 (Pure engine) | Satisfied |
| REQ-REDUN-7 (Callback signature) | **Divergent** (GameWithScore vs Game) |
| REQ-REDUN-8 (Algorithm) | Satisfied |
| REQ-REDUN-9 (Highest-scoring zero penalty) | Satisfied |
| REQ-REDUN-10 (Tie detection) | Satisfied |
| REQ-REDUN-11 (Vetoed exclusion) | Satisfied |
| REQ-REDUN-12 (Predicted authority) | Satisfied |
| REQ-REDUN-13 (Pairwise, not per-cluster) | Satisfied |
| REQ-REDUN-14 (RedundancyAdjustment type) | Satisfied |
| REQ-REDUN-15 (Shared types, sorted neighbors) | Satisfied |
| REQ-REDUN-16 (FitnessResult field) | Satisfied |
| REQ-REDUN-30 (Route registration) | Satisfied |

### Summary

The implementation is structurally sound. Types match the spec, storage follows the established pattern, the engine is pure, route validation is thorough, test coverage is broad. Two defects need attention before Phase 5 builds on this foundation: the callback signature mismatch (Finding 1) and the adjustedScore rounding precision loss (Finding 2). The NaN concerns (Findings 3-4) are low probability but high consequence if triggered. The missing spec-mandated test cases (Finding 6) should be added to close the coverage gap.

## Decisions

**Does the computeRedundancyAdjustments callback signature match REQ-REDUN-7?**
DEFECT. The spec (REQ-REDUN-7) defines the callback as `getFeatureVector: (game: Game) => FeatureVector`. The implementation at redundancy-engine.ts:88 uses `getFeatureVector: (game: GameWithScore) => FeatureVector`. This changes the contract: callers must provide a callback that accepts GameWithScore instead of Game. The test helper at redundancy-engine.test.ts:76 also uses this GameWithScore signature. This affects Phase 5 integration, since route handlers must build callbacks matching the actual signature, not the spec signature.
*Reasoning: Spec REQ-REDUN-7 explicitly shows `(game: Game) => FeatureVector`. Implementation at line 88 shows `(game: GameWithScore) => FeatureVector`. The plan at Phase 3c also specifies `(game: Game) => FeatureVector`. The implementation diverges from both spec and plan.*

**Does the adjustedScore rounding precision match the spec?**
CONCERN. At redundancy-engine.ts:192, adjustedScore is rounded to 1 decimal place: `Math.round(adjustedScore * 10) / 10`. The spec says the computation precision is "two decimal places" (REQ-REDUN-10), and the penalty is rounded to 2 decimal places (line 190). But the adjustedScore loses a decimal of precision. This means `originalScore - penalty !== adjustedScore` in some cases. Example: originalScore=7.55, penalty=0.33, actual adjusted=7.22, but rounded adjustedScore=7.2. The spec says `adjustedScore = max(1.0, originalScore - penalty)` with no mention of additional rounding. This creates a visible discrepancy between what the user expects (7.55 - 0.33 = 7.22) and what they see (7.2).
*Reasoning: REQ-REDUN-14 defines adjustedScore as "Score after adjustment: max(1.0, originalScore - penalty)." No rounding is specified. The implementation adds `Math.round(adjustedScore * 10) / 10` which truncates to 1 decimal. The penalty field uses 2-decimal rounding. The inconsistency means `originalScore - penalty` won't equal `adjustedScore` in the general case.*

**Does the componentWeights validation correctly enforce sum > 0 for partial patches?**
DEFECT. The pre-merge validation at redundancy.ts:64 only checks sum > 0 when all three weight fields are provided in the patch. If a user sends `{ componentWeights: { binary: 0 } }` and the current settings already have `continuous: 0, personalAxes: 0`, the pre-merge check at line 64 is skipped (b/c/p are not all defined). The post-merge check at line 131 catches this case, so the bug is mitigated. However, the pre-merge check at lines 60-66 is dead logic for partial patches, creating the false impression that sum validation happens before merge. The actual enforcement is entirely at line 131. The pre-merge check only fires when all three keys are explicitly provided, which makes it redundant with the post-merge check.
*Reasoning: Line 64: `if (b !== undefined && c !== undefined && p !== undefined && b + c + p === 0)` requires all three to be provided. Partial componentWeights patches skip this. Line 131 catches it after merge. The logic works correctly but the pre-merge check is misleading dead code for the partial case.*

**Does flattenWeighted handle the case where personalAxes is null but includePersonalAxes is true?**
CONCERN. At redundancy-engine.ts:37-41, when includePersonalAxes=true, the total weight includes personalAxes weight, and pw gets a nonzero sqrt value. But at line 52, if vec.personalAxes is null, the personalAxes dimensions are simply not appended. This means the weight normalization assumed 3 components but the vector only has 2 components' dimensions. The weight distribution is wrong: binary and continuous dimensions carry less weight than they should because the denominator included personalAxes weight that was never applied. In practice, the engine at line 122 sets includePersonalAxes=true only when BOTH vectors have non-null personalAxes, so this path shouldn't be reached during normal computeRedundancyAdjustments execution. But flattenWeighted is exported and tested (test at line 104-110 exercises exactly this case), confirming the mismatch. The test asserts correct LENGTH but doesn't verify the weight distribution is mathematically sound.
*Reasoning: flattenWeighted(vec with null personalAxes, weights, true) normalizes weights as if 3 components exist but only emits 2 components' dimensions. The sqrt(binary/total) where total includes personalAxes means binary dimensions are underweighted. Test at line 104 passes because it only checks length. The engine's internal usage at line 122 prevents this from being triggered in production, but the exported function has a subtle bug.*

**Does nicheRank computation correctly reflect the game's ranking among niche neighbors?**
CONCERN. At redundancy-engine.ts:172-179, nicheRank is computed by counting neighbors with strictly better score (ignoring ties). This rank does NOT apply the predicted-authority filter from REQ-REDUN-12. So a fully-predicted neighbor with a higher score increases nicheRank for an actual-scored game, even though that predicted neighbor doesn't contribute to the penalty. This means a game could show "3rd of 5 similar games" but only have a penalty reflecting 1 better neighbor (the other was predicted). The spec at REQ-REDUN-14 says nicheRank is "This game's rank among its niche neighbors by fitness (1 = best)" without specifying whether predicted authority applies to rank. This is an ambiguity, but the current behavior creates a confusing UX: rank and penalty don't agree.
*Reasoning: The comment at line 172 says "same as betterCount + 1, but without the predicted authority filter." This is a deliberate design choice, but it means rank reflects the raw ordering while penalty reflects the authority-adjusted ordering. The spec doesn't explicitly address this, making it an ambiguity rather than a confirmed defect.*

**Are the spec test cases (from AI Validation section) fully covered?**
GAP. The spec's AI Validation section calls for a specific test case: "3 games with identical fitness scores and high mutual similarity, verifying all receive zero penalty (no game is 'better')." The test at line 195 tests tied scores with only 2 games (A and B), not the 3-game scenario the spec demands. Also, the spec's test case for "a game with 5 neighbors where 3 score higher, verifying penalty is (3/5) * maxPenalty" is not present. The test at line 168 tests a 2-game scenario (1 of 1 = full penalty). The spec asks for the 3-of-5 case specifically to verify the ratio formula.
*Reasoning: Spec AI Validation lists explicit test scenarios. The tied-games test has 2 games instead of the specified 3. The 3-of-5 proportional test is missing entirely. These are specific calibration scenarios the spec calls out, not general categories.*

**Does the ComponentWeights type in types.ts correctly duplicate the feature-vector.ts type?**
SATISFIED. types.ts:481-485 defines ComponentWeights with the same three fields (binary, continuous, personalAxes) as feature-vector.ts:25-29. The redundancy engine imports ComponentWeights from feature-vector.ts (line 11), while shared consumers import from types.ts. The plan's Option A (duplication) is correctly implemented. The types are structurally identical.
*Reasoning: Both definitions have `{ binary: number; continuous: number; personalAxes: number }`. Structural typing in TypeScript makes them interchangeable.*

**Is the redundancy engine pure (no I/O, no service imports)?**
SATISFIED. redundancy-engine.ts imports only types from @shelf-judge/shared (line 5-10), types and cosineSimilarity from feature-vector.ts (lines 11-12). No service imports, no storage, no file system, no network. All data comes through function parameters. The module is a pure computation module per REQ-REDUN-6.
*Reasoning: Inspected all imports. Only type imports from shared, plus one value import (cosineSimilarity) from feature-vector which is itself a pure function. No I/O, no state, no side effects.*

**Does the storage layer follow the prediction-settings pattern correctly?**
SATISFIED. storage-service.ts:214-227 follows the exact same pattern as loadPredictionSettings/savePredictionSettings (lines 184-197) and loadNicheSettings/saveNicheSettings (lines 199-212). Default from engine constant, file path construction, exists check, atomic write. Interface updated with both methods (lines 34-35). Import of DEFAULT_REDUNDANCY_SETTINGS at line 19.
*Reasoning: Line-by-line comparison with the prediction settings implementation shows identical structure: path construction, exists check, spread default, JSON parse/stringify, atomic write.*

**Are all FitnessResult constructor sites updated with redundancyAdjustment: null?**
SATISFIED. Grep shows 4 constructor sites in daemon source: fitness-service.ts:167, fitness-service.ts:180, prediction-engine.ts:365, prediction-engine.ts:376. All set `redundancyAdjustment: null`. The commission report also mentions 8 test files were updated. The FitnessResult type at types.ts:125 includes the field. Typecheck passing confirms no sites were missed.
*Reasoning: All constructor sites found by grep include the null field. TypeScript strict mode would catch any missing sites since redundancyAdjustment is not optional (it's `RedundancyAdjustment | null`, not `RedundancyAdjustment | null | undefined`).*

**Is route registration in app.ts correct?**
SATISFIED. app.ts:17 imports createRedundancyRoutes, line 65 creates the route module with { storageService }, line 77 adds operations, line 102 registers routes under /api. Follows the same pattern as niche routes at lines 16, 64, 76, 101.
*Reasoning: Import, creation, operation collection, and route registration all present and correctly ordered.*

**Does the route validation cover all constraints from REQ-REDUN-4?**
SATISFIED. redundancy.ts validates: enabled is boolean (line 14), stage is annotation/integrated (lines 18-22), similarityThreshold in [0,1] (lines 24-28), maxPenalty in [0.5, 5.0] (lines 30-34), minNeighbors integer >= 1 (lines 36-42), componentWeights values >= 0 and sum > 0 (lines 45-67, with post-merge sum check at 130-133). All constraints from REQ-REDUN-4 are covered. Test coverage includes boundary tests for each constraint.
*Reasoning: Each REQ-REDUN-4 validation rule has corresponding code and test coverage in redundancy-settings-routes.test.ts.*

**Does the engine correctly handle the spec's tie detection at two decimal places?**
SATISFIED. redundancy-engine.ts:62-64 implements `Math.round(a * 100) === Math.round(b * 100)`, which is exactly what REQ-REDUN-10 specifies and what the plan documents. Test at redundancy-engine.test.ts:195-207 verifies this with scores 8.002 and 8.004 (both round to 800).
*Reasoning: Implementation matches spec and plan. Test covers the case.*

**Does the engine correctly implement predicted game authority per REQ-REDUN-12?**
SATISFIED. redundancy-engine.ts:70-72 defines isFullyPredicted by checking `predictionMeta?.actualAxisCount === 0`. Lines 158-159 skip predicted neighbors when counting betterNeighbors for actual-scored games. Lines 233-244 (test) verifies predicted games don't penalize actual games, and lines 233-244 verifies predicted games ARE penalized by actual-scored neighbors. Both directions are tested.
*Reasoning: The isFullyPredicted check uses the correct criterion (actualAxisCount === 0). The filter at line 159 applies correctly: only skipped when the subject game is actual AND the neighbor is fully predicted. The bidirectional test coverage confirms both halves of REQ-REDUN-12.*

**Does the personalAxes dimension mismatch handling work correctly?**
SATISFIED. redundancy-engine.ts:122 checks `vecA.personalAxes !== null && vecB.personalAxes !== null` before setting includePA=true. When either is null, flattenWeighted is called with includePersonalAxes=false (line 123-124), which redistributes weight to binary+continuous at lines 43-46. The plan's decision (intersection of non-null components) is correctly implemented.
*Reasoning: The pairwise comparison at getSimilarity correctly determines per-pair whether to include personalAxes based on both games having non-null personalAxes. The flattenWeighted function with includePersonalAxes=false correctly renormalizes weights over just binary+continuous.*

**Does the test count match the commission report?**
SATISFIED. Commission reports 17 engine tests and 20 route tests. Grep confirms 17 test() calls in redundancy-engine.test.ts and 20 in redundancy-settings-routes.test.ts. The plan specified 14 engine test cases; the implementation has 17 (3 additional tests for flattenWeighted). The plan specified 5 route test categories; the implementation has 20 individual test cases covering boundaries and edge cases more thoroughly than the plan required.
*Reasoning: Test counts verified by grep. Additional tests beyond the plan's minimum are a net positive.*

**Does the similarity rounding in nicheNeighbors create a precision concern?**
OBSERVATION. At redundancy-engine.ts:184, similarity is rounded to 3 decimal places: `Math.round(n.similarity * 1000) / 1000`. This is applied only to the output data (RedundancyNeighbor.similarity), not to the threshold comparison (line 137 uses raw similarity). This means display shows 3 significant decimals, which is reasonable for a 0-1 range. No defect, but worth noting that the rounding is applied post-decision, so the threshold comparison is precise while the reported value is approximate. A game at similarity=0.5999 would be excluded (below 0.6 threshold) even though the rounded display would show 0.600 if it were included. This is correct behavior.
*Reasoning: Rounding is applied to output, not to decision logic. Correct approach.*

**Are there NaN risks in the redundancy engine's division operations?**
CONCERN. At redundancy-engine.ts:38-41 and 43-45, weight normalization divides by `total`. If all weights are zero, total=0 and division produces NaN, which propagates through sqrt into the flat vector, then into cosineSimilarity, and ultimately into penalty. The route validation prevents componentWeights sum=0 via the API, but the engine function itself accepts any RedundancySettings, and nothing in the engine validates sum>0. If the engine is called directly (not through routes, e.g., from Phase 5 route handlers constructing settings internally, or from tests), zero weights would produce NaN penalties that round-trip through JSON as null (per lessons-learned). The engine's contract is "pure function, caller provides valid settings," but defensive validation at the engine boundary would be safer.
*Reasoning: CLAUDE.md lessons-learned: "NaN round-trips through JSON.stringify as null... Distance functions, aggregations, and normalization with divide-by-zero are the high-risk spots." The route layer validates, but the engine layer doesn't. The engine is exported and could be called from test code or future consumers without route validation.*

**Does the engine handle cosineSimilarity returning NaN for zero-magnitude vectors?**
CONCERN. If a game's flattened feature vector is all zeros (possible if the game has no mechanics, no categories, and no ratings), cosineSimilarity computes 0/0 = NaN. The engine at line 137 compares `sim >= settings.similarityThreshold`. NaN >= 0.6 is false, so the game would be excluded from neighbor lists. This is accidentally correct behavior (a zero-vector game has no meaningful similarity to anything), but the NaN is stored in the similarity cache at line 127 and could leak if the cache is ever inspected. A guard like `if (isNaN(sim)) sim = 0` would make the behavior explicit.
*Reasoning: A game added to the collection with no BGG data and no ratings would produce a zero feature vector. cosineSimilarity(zeros, anything) = 0/0 = NaN. The >= comparison filters it out, but the NaN exists in memory.*

**Which spec Success Criteria automated test cases are covered by the Phase 1-4 tests?**
ASSESSMENT. The spec's automated test list has 26 items. Phase 1-4 covers the first 17 (engine tests) plus 3 (route tests) = 20. The remaining 6 test cases require Phase 5+ (game route integration, prediction route integration). This is expected, since the commission only covers Phases 1-4. However, within the Phase 1-4 scope, the spec's AI Validation section explicitly calls for two test cases that are missing or incomplete: (1) the 3-game tied-scores scenario has only 2 games, and (2) the 5-neighbor/3-better proportional penalty test is absent. These are Phase 3 tests that should have been in this commission.
*Reasoning: Cross-referenced spec Success Criteria items against test file. Items 1-17 map to engine behavior (Phases 1-4 scope). Items 18-20 map to route validation (Phase 4 scope). Items 21-26 map to route integration (Phase 5+ scope, out of commission scope).*
