---
title: "Commission: Phase 2 Review: Fitness Engine and Services"
date: 2026-04-05
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review Phase 2 implementation of the MVP plan.\n\nRead `.lore/plans/mvp.md` (Phase 2), `.lore/designs/mvp-fitness-model.md`, `.lore/specs/mvp.md` (REQ-MVP-1, 2, 3, 4, 5, 6, 8, 9, 14, 15, 16, 17).\n\nReview criteria:\n1. Fitness calculation matches the weighted average formula exactly: `sum(rating * weight) / sum(weight)`\n2. Wingspan example produces score 7.9 (hand-verify the arithmetic)\n3. Breakdown entries sum to the total fitness score in all test cases\n4. Rounding uses `Math.round(score * 10) / 10`, NOT `toFixed(1)`\n5. Axis cascade deletion removes ratings across ALL games and returns correct count\n6. Duplicate detection: bggId match rejects, manual games (null bggId) never duplicate\n7. Rating validation: 1-10 integer only (rejects 0, 11, 1.5, negatives)\n8. Game list sorts by fitness descending, unscored at end\n9. BGG-derived axis override logic: source is \"override\", bggOriginal contains original value\n10. All tests from the plan exist and pass\n\nRun `bun test` and report results. Verify the Wingspan arithmetic by hand."
dependencies:
  - commission-Dalton-20260405-121539
linked_artifacts:
  - packages/daemon/src/services/fitness-service.ts

  - packages/daemon/src/services/axis-service.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/tests/services/fitness-service.test.ts
  - packages/daemon/tests/services/axis-service.test.ts
  - packages/daemon/tests/services/game-service.test.ts
  - packages/shared/src/validation.ts
  - packages/daemon/src/services/axis-service.ts
  - packages/daemon/src/services/game-service.ts
  - packages/daemon/tests/services/fitness-service.test.ts
  - packages/daemon/tests/services/axis-service.test.ts
  - packages/daemon/tests/services/game-service.test.ts
  - packages/shared/src/validation.ts
activity_timeline:
  - timestamp: 2026-04-05T19:15:48.263Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-05T19:22:19.171Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-05T19:32:27.277Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-05T19:32:27.279Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-05T19:32:27.290Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-05T19:32:34.288Z
    event: progress_report
    reason: "Starting Phase 2 review. Reading plan, design, spec, and dependency commission."
  - timestamp: 2026-04-05T19:33:39.653Z
    event: progress_report
    reason: "All code and specs read. Cannot run tests (read-only posture). Proceeding with manual code review against all 10 criteria. Verifying Wingspan arithmetic by hand now."
  - timestamp: 2026-04-05T19:36:50.356Z
    event: progress_report
    reason: "All 10 criteria reviewed. 2 defects found (both related to breakdown rounding precision), 1 style concern, 1 plan/spec discrepancy noted, 1 limitation (cannot run tests). Preparing final submission."
  - timestamp: 2026-04-05T19:37:19.160Z
    event: result_submitted
    reason: "## Phase 2 Review: Fitness Engine and Axis/Game Services\n\n### Limitation\n\nI cannot run `bun test`. My posture is read-only (no shell execution). Dalton's commission report claims 74 tests pass. I reviewed the test code for correctness but cannot independently confirm execution.\n\n---\n\n### Findings (Priority Order)\n\n#### DEFECT 1: Breakdown numbers are not reproducible from displayed values\n\n**File:** `packages/daemon/src/services/fitness-service.ts:74, 79, 87`\n\n**What:** The breakdown shows a rounded rating and a separately-rounded contribution, but these are computed at different precisions. The displayed rating is `roundToOneDecimal(rating)` (line 79). The displayed contribution is `roundToOneDecimal(rating * weight)` (line 74, using the *raw* rating). The score itself uses raw `rating * weight` (line 87).\n\n**Why it matters:** REQ-MVP-5 requires \"each axis's name, rating, weight, contribution to the total.\" If a reader multiplies the displayed rating by the displayed weight and gets a different number than the displayed contribution, the breakdown fails its transparency purpose. Example: BGG communityRating 7.68, weight 50. Displayed rating: 7.7. Displayed contribution: 384.0. Reader computes: 7.7 × 50 = 385 ≠ 384. The design doc's guiding principle is \"one number, honestly derived.\" A derivation that can't be reproduced from its own displayed inputs is not honest.\n\n**What to do:** Pick one approach: (a) compute contribution from the already-rounded rating so displayed_rating × weight = displayed_contribution, then compute the final score from these rounded contributions; or (b) display the unrounded rating (full precision) so the reader can reproduce the math exactly. Option (a) is simpler and matches what the design doc example shows (all displayed ratings in that example have at most one decimal place).\n\n#### DEFECT 2: No test catches the rounding inconsistency\n\n**File:** `packages/daemon/tests/services/fitness-service.test.ts`\n\n**What:** All test inputs use ratings where rounding doesn't cause divergence (integers, or values with one decimal place). No test constructs a scenario where `roundToOneDecimal(raw_rating) × weight ≠ roundToOneDecimal(raw_rating × weight)`.\n\n**Why it matters:** The Wingspan example passes because its BGG values (8.1, 5.8) are already at one decimal precision. The rounding boundary tests use pass-through communityRating values that also round cleanly. A test with communityRating = 7.666... would expose Defect 1.\n\n**What to do:** Add a test with a BGG-derived rating that has >1 decimal of precision (e.g., communityRating 7.666) and verify that the displayed rating × weight equals the displayed contribution.\n\n#### CONCERN: Source field defaults to \"personal\" for unrated BGG axes\n\n**File:** `packages/daemon/src/services/fitness-service.ts:56`\n\n**What:** When a BGG-derived axis has no BGG data AND no personal rating, the breakdown entry shows `source: \"personal\"` because the default at line 56 is never changed. The axis is configured as `source: \"bgg\"` but the breakdown misrepresents its origin.\n\n**Why it matters:** Cosmetic — the entry has `rating: null` and `contribution: null`, so it doesn't affect the score. But a UI rendering this breakdown might show \"personal\" next to an axis the user knows is BGG-derived, which is confusing.\n\n**What to do:** When rating is null, set source to match the axis's configured source (personal or bgg) rather than defaulting to \"personal.\"\n\n#### STYLE: Redundant null-coalescing after Zod parse\n\n**File:** `packages/daemon/src/services/axis-service.ts:34-37`\n\n**What:** `parsed.description ?? null`, `parsed.source ?? \"personal\"`, `parsed.bggField ?? null` are all applied after `CreateAxisSchema.parse(input)`, which already applies these exact defaults. The ?? operators can never trigger.\n\n**Why it matters:** Dead code that obscures what Zod is doing. A reader might think parse() doesn't apply defaults, leading to similar redundant patterns elsewhere.\n\n**What to do:** Remove the ?? fallbacks and use parsed values directly, or add a comment explaining the defensive coding choice.\n\n---\n\n### Requirement Coverage\n\n| Criterion | Status |\n|-----------|--------|\n| 1. Weighted average formula | PASS |\n| 2. Wingspan produces 7.9 | PASS (hand-verified: 787/100 = 7.87 → 7.9) |\n| 3. Breakdown sums to score | DEFECT (rounding mismatch possible, not caught by tests) |\n| 4. Math.round not toFixed | PASS |\n| 5. Axis cascade deletion | PASS |\n| 6. Duplicate detection | PASS |\n| 7. Rating validation 1-10 int | PASS |\n| 8. List sort fitness desc | PASS |\n| 9. Override logic | PASS |\n| 10. All plan tests exist | PASS (minor: cross-service cascade test is in axis-service not game-service) |\n| Tests pass (bun test) | UNABLE TO VERIFY (read-only posture, no shell) |\n\n### Additional Notes\n\n- The plan says axis weight range is \"1-100\" (Phase 1.2, Technical Decision #1) but the spec (REQ-MVP-1) and implementation both use 0-100. Implementation follows spec, which is correct. Plan text is stale.\n- The `z.infer` → `z.input` change in validation.ts is correct and well-motivated."
  - timestamp: 2026-04-05T19:37:27.859Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All 10 criteria reviewed. 2 defects found (both related to breakdown rounding precision), 1 style concern, 1 plan/spec discrepancy noted, 1 limitation (cannot run tests). Preparing final submission."
projectName: shelf-judge
---
## Phase 2 Review: Fitness Engine and Axis/Game Services

### Limitation

I cannot run `bun test`. My posture is read-only (no shell execution). Dalton's commission report claims 74 tests pass. I reviewed the test code for correctness but cannot independently confirm execution.

---

### Findings (Priority Order)

#### DEFECT 1: Breakdown numbers are not reproducible from displayed values

**File:** `packages/daemon/src/services/fitness-service.ts:74, 79, 87`

**What:** The breakdown shows a rounded rating and a separately-rounded contribution, but these are computed at different precisions. The displayed rating is `roundToOneDecimal(rating)` (line 79). The displayed contribution is `roundToOneDecimal(rating * weight)` (line 74, using the *raw* rating). The score itself uses raw `rating * weight` (line 87).

**Why it matters:** REQ-MVP-5 requires "each axis's name, rating, weight, contribution to the total." If a reader multiplies the displayed rating by the displayed weight and gets a different number than the displayed contribution, the breakdown fails its transparency purpose. Example: BGG communityRating 7.68, weight 50. Displayed rating: 7.7. Displayed contribution: 384.0. Reader computes: 7.7 × 50 = 385 ≠ 384. The design doc's guiding principle is "one number, honestly derived." A derivation that can't be reproduced from its own displayed inputs is not honest.

**What to do:** Pick one approach: (a) compute contribution from the already-rounded rating so displayed_rating × weight = displayed_contribution, then compute the final score from these rounded contributions; or (b) display the unrounded rating (full precision) so the reader can reproduce the math exactly. Option (a) is simpler and matches what the design doc example shows (all displayed ratings in that example have at most one decimal place).

#### DEFECT 2: No test catches the rounding inconsistency

**File:** `packages/daemon/tests/services/fitness-service.test.ts`

**What:** All test inputs use ratings where rounding doesn't cause divergence (integers, or values with one decimal place). No test constructs a scenario where `roundToOneDecimal(raw_rating) × weight ≠ roundToOneDecimal(raw_rating × weight)`.

**Why it matters:** The Wingspan example passes because its BGG values (8.1, 5.8) are already at one decimal precision. The rounding boundary tests use pass-through communityRating values that also round cleanly. A test with communityRating = 7.666... would expose Defect 1.

**What to do:** Add a test with a BGG-derived rating that has >1 decimal of precision (e.g., communityRating 7.666) and verify that the displayed rating × weight equals the displayed contribution.

#### CONCERN: Source field defaults to "personal" for unrated BGG axes

**File:** `packages/daemon/src/services/fitness-service.ts:56`

**What:** When a BGG-derived axis has no BGG data AND no personal rating, the breakdown entry shows `source: "personal"` because the default at line 56 is never changed. The axis is configured as `source: "bgg"` but the breakdown misrepresents its origin.

**Why it matters:** Cosmetic — the entry has `rating: null` and `contribution: null`, so it doesn't affect the score. But a UI rendering this breakdown might show "personal" next to an axis the user knows is BGG-derived, which is confusing.

**What to do:** When rating is null, set source to match the axis's configured source (personal or bgg) rather than defaulting to "personal."

#### STYLE: Redundant null-coalescing after Zod parse

**File:** `packages/daemon/src/services/axis-service.ts:34-37`

**What:** `parsed.description ?? null`, `parsed.source ?? "personal"`, `parsed.bggField ?? null` are all applied after `CreateAxisSchema.parse(input)`, which already applies these exact defaults. The ?? operators can never trigger.

**Why it matters:** Dead code that obscures what Zod is doing. A reader might think parse() doesn't apply defaults, leading to similar redundant patterns elsewhere.

**What to do:** Remove the ?? fallbacks and use parsed values directly, or add a comment explaining the defensive coding choice.

---

### Requirement Coverage

| Criterion | Status |
|-----------|--------|
| 1. Weighted average formula | PASS |
| 2. Wingspan produces 7.9 | PASS (hand-verified: 787/100 = 7.87 → 7.9) |
| 3. Breakdown sums to score | DEFECT (rounding mismatch possible, not caught by tests) |
| 4. Math.round not toFixed | PASS |
| 5. Axis cascade deletion | PASS |
| 6. Duplicate detection | PASS |
| 7. Rating validation 1-10 int | PASS |
| 8. List sort fitness desc | PASS |
| 9. Override logic | PASS |
| 10. All plan tests exist | PASS (minor: cross-service cascade test is in axis-service not game-service) |
| Tests pass (bun test) | UNABLE TO VERIFY (read-only posture, no shell) |

### Additional Notes

- The plan says axis weight range is "1-100" (Phase 1.2, Technical Decision #1) but the spec (REQ-MVP-1) and implementation both use 0-100. Implementation follows spec, which is correct. Plan text is stale.
- The `z.infer` → `z.input` change in validation.ts is correct and well-motivated.

## Decisions

**Criterion 1: Does fitness calculation match the weighted average formula exactly: sum(rating * weight) / sum(weight)?**
PASS. The implementation at fitness-service.ts:86-90 accumulates `weightedSum += rating * axis.weight` and `weightSum += axis.weight` for rated axes only, then computes `weightedSum / weightSum` at line 96. This matches the spec formula exactly.
*Reasoning: Lines 86-90 accumulate numerator (rating * weight) and denominator (weight) only when rating is non-null. Line 93-94 return null when ratedCount is 0 or weightSum is 0. Line 96 divides and rounds. The loop at lines 51-91 iterates all axes and resolves ratings from personal or BGG sources correctly.*

**Criterion 2: Does the Wingspan example produce score 7.9?**
PASS. Hand-verified: (8×40 + 9×30 + 5.8×20 + 8.1×10) / (40+30+20+10) = 787/100 = 7.87. Math.round(7.87*10)/10 = 7.9. The test at fitness-service.test.ts:53-106 constructs these exact inputs and asserts score 7.9 with matching breakdown values.
*Reasoning: Manual arithmetic: 320+270+116+81=787, 787/100=7.87, Math.round(78.7)=79, 79/10=7.9. BGG weight 2.9 maps to 5.8 via resolveBggRating (weight*2 at line 29). communityRating 8.1 passes through at line 26. Test verifies individual breakdown entries (wife:320, visual:270, complexity:116, community:81) and the sum-to-score relationship.*

**Criterion 3: Do breakdown entries sum to the total fitness score in all test cases?**
DEFECT. Breakdown contributions are individually rounded before storage, but the final score is computed from unrounded values. This means the sum of breakdown contributions can differ from the score. For the Wingspan example, the rounded contributions happen to match (320+270+116+81=787, 787/100=7.87→7.9). But consider an axis with rating 7.68 and weight 50: contribution stored as Math.round(7.68*50*10)/10 = Math.round(3840)/10 = 384.0. Meanwhile the weighted sum uses raw 7.68*50=384.0 — matches here. The divergence risk is real but may not manifest with current test data. The fundamental issue: contribution is `roundToOneDecimal(rating * axis.weight)` (line 73-74), but weightedSum uses `rating * axis.weight` (line 87). These can produce different results for non-integer BGG ratings with certain weights.
*Reasoning: fitness-service.ts line 73-74: `const contribution = rating !== null ? roundToOneDecimal(rating * axis.weight) : null;` — rounds each contribution individually. Line 87: `weightedSum += rating * axis.weight;` — uses the raw product. The score at line 96 is `roundToOneDecimal(weightedSum / weightSum)`, which rounds the sum of raw products divided by weight sum. If individual rounding shifts a contribution by 0.05 (the max rounding error per entry), the sum of rounded contributions could diverge from the actual score by up to N*0.05 where N is the number of rated axes. For example: rating 3.33333, weight 30 → raw product 99.9999, rounded contribution 100.0. But with multiple such entries the accumulated difference could shift the total enough that `sum(rounded_contributions) / sum(weights)` ≠ `displayed_score`. The test at lines 99-105 verifies this for the Wingspan example but only for that specific set of inputs.*

**Criterion 4: Does rounding use Math.round(score * 10) / 10, NOT toFixed(1)?**
PASS. fitness-service.ts:35-37 defines `roundToOneDecimal` as `Math.round(value * 10) / 10`. This is used for the final score (line 96), individual ratings (line 79), contributions (line 74), and bggOriginal (line 64). No use of toFixed anywhere in the service.
*Reasoning: Searched the file mentally — the only rounding mechanism is the roundToOneDecimal helper using the specified formula. The plan at mvp.md line 107 explicitly calls for this approach over toFixed(1).*

**Criterion 5: Does axis cascade deletion remove ratings across ALL games and return correct count?**
PASS. axis-service.ts:86-91 iterates all games in the collection and deletes the axis ID from each game's ratings map, counting affected games. The test at axis-service.test.ts:124-191 sets up 3 games (2 with ratings on the target axis, 1 without), deletes the axis, and verifies: deletedRatingsCount is 2, the ratings are gone from both affected games, and other ratings on those games are preserved.
*Reasoning: The loop at axis-service.ts:86-91 uses `id in game.ratings` to check for the axis ID in each game's ratings object, deletes it, and increments the counter. This correctly handles all games in the collection, not just a subset. The test verifies both the count and the actual state of the ratings after deletion.*

**Criterion 6: Does duplicate detection reject bggId matches and allow manual games (null bggId) to never duplicate?**
PASS. game-service.ts:45-53 checks `parsed.bggId !== null && parsed.bggId !== undefined` before searching for duplicates. When bggId is null (manual game), the duplicate check is skipped entirely. Tests at game-service.test.ts:51-64 verify both: duplicate bggId is rejected with a descriptive error, and two manual games with the same name both succeed.
*Reasoning: The guard condition at line 45 ensures null bggId games never trigger duplicate detection. The search at line 46-48 checks all existing games for a matching bggId. The error message at line 50-52 includes the existing game's name for clear identification.*

**Criterion 7: Does rating validation accept 1-10 integer only, rejecting 0, 11, 1.5, negatives?**
PASS. game-service.ts:128-136 validates each rating with `Number.isInteger(rating) || rating < 1 || rating > 10`. Tests at game-service.test.ts:141-195 cover all four rejection cases (0, 11, 1.5, -1) plus unknown axis rejection. The validation schema in validation.ts:18-19 also enforces int/min/max at the Zod level, though the game service performs its own validation loop rather than using the schema for bulk ratings.
*Reasoning: The validation at game-service.ts:128-136 is correct and covers all specified edge cases. The dual validation (Zod schema exists but game service validates directly) is fine — the game service receives a Record<string, number> not individual RateGameInput objects, so it can't use the Zod schema directly. Both paths enforce the same constraint.*

**Criterion 8: Does game list sort by fitness descending with unscored at end?**
PASS. game-service.ts:99-106 sorts with a comparator that puts scored games first (descending by score) and null-scored games last. The test at game-service.test.ts:99-121 creates three games (scored 3, scored 9, unrated), lists them, and verifies order: High Score (9), Low Score (3), Unrated (null).
*Reasoning: The sort comparator handles three cases: both scored (descending comparison), only a scored (a comes first), only b scored (b comes first), neither scored (stable order). This is correct.*

**Criterion 9: Does BGG-derived axis override logic set source to "override" with bggOriginal containing original value?**
PASS. fitness-service.ts:59-67 checks: when a personal rating exists on a BGG-derived axis AND the BGG rating resolves to non-null, source is set to "override" and bggOriginal is set to the rounded BGG value. The test at fitness-service.test.ts:218-234 verifies this: a BGG communityRating axis with a personal rating override shows source "override" and bggOriginal 7.5.
*Reasoning: The logic correctly distinguishes three states for a BGG-derived axis: (1) personal rating exists AND BGG data exists → "override" with bggOriginal; (2) no personal rating, BGG data exists → "bgg" with no bggOriginal; (3) personal rating exists, no BGG data → "personal" with no bggOriginal. This matches the design doc's FitnessBreakdownEntry interface.*

**Criterion 10: Do all tests from the plan exist?**
PASS with one minor gap. The plan specifies a cross-service integration test for axis cascade: "after deletion, calling gameService.getGame() on a previously-rated game returns a different score (this test lives in game-service.test.ts or a cross-service integration test)." This specific test does not exist. The cascade is tested in axis-service.test.ts by directly inspecting storage state, which verifies the same invariant through a different mechanism. This is functionally equivalent but not exactly what the plan described. All other tests from the plan exist: Wingspan example, single axis, equal weights, missing ratings, zero rated axes, all-zero weights, BGG no data, BGG weight null, override, all 4 rounding boundaries, axis CRUD, axis validation (weight 101, -1, non-integer), cascade with count, zero-count cascade, manual game, bggId storage, duplicate rejection, manual non-duplicate, get with score, unrated null, list sorted, rate validation (0, 11, 1.5, -1), unknown axis, remove game.
*Reasoning: Counted tests against plan: fitness-service has 13 tests covering all 10+ plan items. axis-service has 10 tests covering CRUD, validation, cascade. game-service has 14 tests covering all plan items. The missing cross-service integration test is minor since the cascade behavior IS verified, just not through the gameService.getGame() path as the plan suggested.*

**Does the source field on unrated personal axes default correctly?**
CONCERN. fitness-service.ts:56 initializes `source` to "personal" for every axis before checking ratings. For a BGG-derived axis that has no BGG data AND no personal rating (both null), the breakdown entry will show `source: "personal"` even though the axis is configured as source "bgg". This is misleading in the breakdown. The entry will have `rating: null` and `contribution: null`, so the impact is cosmetic — but the design doc's breakdown interface implies the source field should reflect the axis's configuration, not a default fallback.
*Reasoning: At fitness-service.ts:56, source starts as "personal". The code at lines 59-71 only changes source when a rating resolves: "override" when personal+bgg both present, stays "personal" when only personal, "bgg" when only BGG. When neither resolves (null rating), source stays "personal" regardless of the axis's own source field. For a BGG-derived axis with no data, the breakdown entry will say source "personal" when it should arguably say "bgg" (or a distinct unrated state).*

**Does the axis weight validation range match the spec?**
DISCREPANCY. The spec at REQ-MVP-1 says weight is "0-100". The plan at Phase 1.2 says "axis weight 1-100 (integer)." The Zod schema in validation.ts:6 uses `min(0).max(100)`, matching the spec. The axis-service.test.ts:48 comment says "0 is allowed by schema, 101 is not." The plan text has an inconsistency with the spec but the implementation follows the spec (0-100). Not a code bug, but the plan's "1-100" text at line 158 is wrong relative to its own spec reference.
*Reasoning: REQ-MVP-1: "weight (0-100)". Plan Phase 1.2: "axis weight 1-100 (integer)". Plan Phase 2 Technical Decision #1: "Raw integer weights (1-100) in storage." validation.ts: z.number().int().min(0).max(100). The implementation matches the spec, not the plan. This is correct behavior — the spec takes precedence. But the plan should be updated if it's a living document.*

**Is removeGame deleting ratings as REQ-MVP-8 requires?**
PASS. REQ-MVP-8 says "Removal deletes the game and all its ratings." game-service.ts:152-163 removes the game from the collection array via splice, which removes the entire game object including its ratings map. The ratings are stored on the game object itself (Game.ratings), not in a separate table, so removing the game inherently removes all its ratings. No orphaned data.
*Reasoning: The data model stores ratings as `Record<string, number>` directly on the Game object. Removing the game from collection.games removes everything. This is correct given the data model design.*

**Does the fitness service handle the case where a personal axis has source "personal" but the user also provides a personal rating?**
PASS. For a personal axis (source "personal"), resolveBggRating returns null at line 22 (because axis.source !== "bgg"). So bggRating is null. If personalRating exists, line 59-66 sets rating to personalRating and source stays "personal" (bggRating is null, so the override branch doesn't trigger). This is correct.
*Reasoning: The function correctly differentiates between personal axes (never consult BGG data) and BGG-derived axes (consult BGG data, allow override). The source field accurately reflects the origin of the rating used.*

**Does the breakdown support the "one number, honestly derived" principle (REQ-MVP-5)?**
DEFECT. The breakdown entry shows a rounded rating and a separately-rounded contribution, but these are computed from different precision values. The displayed rating is `roundToOneDecimal(rating)` (line 79), the contribution is `roundToOneDecimal(rating * weight)` (line 74), and the score uses raw `rating * weight` (line 87). For BGG-derived ratings with non-round values, a reader multiplying the displayed rating by the displayed weight will NOT get the displayed contribution. Example: BGG communityRating 7.68, weight 50. Displayed rating: 7.7 (rounded). Displayed contribution: 384.0 (roundToOneDecimal(7.68*50)=384.0). Reader computes: 7.7 × 50 = 385, not 384. The derivation is not honestly reproducible from the displayed numbers. The fix: compute contribution from the already-rounded rating, not from the raw value. Or display the unrounded rating.
*Reasoning: fitness-service.ts line 79: `rating: rating !== null ? roundToOneDecimal(rating) : null` — rounds the displayed rating. Line 74: `roundToOneDecimal(rating * axis.weight)` — uses the raw (unrounded) rating to compute contribution. Line 87: `weightedSum += rating * axis.weight` — also uses raw rating. The three values (displayed rating, displayed contribution, actual score computation) use different precision. REQ-MVP-5 requires the breakdown to show "each axis's name, rating, weight, contribution to the total." If the displayed rating × displayed weight ≠ displayed contribution, the breakdown is not a faithful derivation.*

**Is there a test that would catch the rounding inconsistency between displayed rating, contribution, and score?**
NO. The Wingspan test uses values where rounding doesn't cause divergence (8, 9 are integers; 5.8 and 8.1 have one decimal place). The rounding boundary tests use one personal axis (integer rating) and one BGG axis, where the BGG communityRating values (7.68, 7.7, 7.88, 7.9) are either already at one decimal or produce contributions that happen to round consistently. No test constructs a scenario where the displayed rating × weight ≠ displayed contribution.
*Reasoning: Reviewed all test cases in fitness-service.test.ts. All BGG ratings used are either integers or have at most 2 decimal places that happen to round cleanly. A test with communityRating = 7.666... (recurring) would expose the issue: displayed rating 7.7, raw contribution 7.666...*30=229.999..., rounded contribution 230.0, but reader expects 7.7*30=231.*

**Does the validation.ts change from z.infer to z.input break any type contracts?**
PASS. The change from `z.infer` to `z.input` for input types is correct. `z.infer` produces the output type (after defaults are applied), requiring callers to provide values for fields with defaults. `z.input` produces the input type (before defaults), making defaulted fields optional. This allows service callers to omit `description`, `source`, `bggField`, `bggId`, etc. without explicit null/undefined. The service then calls `.parse()` which applies defaults. This is the intended Zod pattern for input validation.
*Reasoning: CreateAxisSchema has defaults on description (null), source ("personal"), and bggField (null). With z.infer, these would be required in the input type. With z.input, they're optional. The service code at axis-service.ts:34-37 uses `parsed.description ?? null` etc. after parsing, which is redundant (parse already applies defaults) but not harmful.*

**Are there redundant null-coalescing operations in axis-service.ts after Zod parsing?**
STYLE CONCERN. axis-service.ts:34-37 uses `parsed.description ?? null`, `parsed.source ?? "personal"`, `parsed.bggField ?? null` after calling CreateAxisSchema.parse(). The parse() call already applies these exact defaults, so the ?? operators are redundant. Not a bug — the values will be the same either way — but it's dead code that obscures what Zod is doing.
*Reasoning: CreateAxisSchema defines: `description: z.string().nullable().optional().default(null)`, `source: z.enum([...]).optional().default("personal")`, `bggField: z.string().nullable().optional().default(null)`. After parse(), these fields will always have values. The ?? fallbacks can never trigger.*

**Can I run tests as required by the commission?**
UNABLE TO VERIFY. My posture is read-only — I have no shell execution tools. The commission asks me to run `bun test` and report results. I cannot fulfill this. The dependency commission (Dalton) reports all 74 tests pass, but I cannot independently verify this claim.
*Reasoning: Thorne's posture explicitly prohibits Write, Edit, and Bash tools. Running tests requires shell execution. The commission's request to run tests conflicts with the review-only posture. I'm reporting this as a limitation rather than silently skipping the requirement.*
