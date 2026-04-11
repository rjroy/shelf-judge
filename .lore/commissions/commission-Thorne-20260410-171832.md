---
title: "Commission: Review: Prediction Engine Phase 4-6"
date: 2026-04-11
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review Phases 4-6 of the prediction engine implementation.\n\n**Spec**: `.lore/specs/prediction-engine.md`\n**Plan**: `.lore/plans/prediction-engine.md`\n**Mockup**: `.lore/mockups/prediction-engine.html`\n\nFocus areas:\n1. **Service layer**: predictGame flow correct? Tournament stability populated properly? Stage 0 strips personal axis predictions (REQ-PRED-22)?\n2. **API routes**: Correct endpoints, response shapes, `?includePredicted=true` on games endpoint\n3. **Backward compatibility**: Existing consumers of FitnessResult/FitnessBreakdownEntry handle new nullable fields?\n4. **Web UI mockup fidelity**: Teal color language, tilde prefix, PREDICTED badges, confidence panels, tension display, readiness widget in sidebar, readiness page\n5. **Collection table integration**: ratedStatus filter handles predicted-only games, profile page excludes predicted scores from averages\n6. **CLI**: predict command, readiness command, scores --include-predicted, [P] marker, --json support\n7. **Client/daemon divergence**: Both web and CLI clients updated for all new endpoints?\n\nWalk all 37 REQ-PRED requirements against the implementation."
dependencies:
  - commission-Dalton-20260410-171813
  - commission-Dalton-20260410-171822
linked_artifacts:
  - packages/daemon/src/services/prediction-engine.ts

  - packages/daemon/src/services/prediction-service.ts
  - packages/daemon/src/routes/prediction.ts
  - packages/shared/src/types.ts
  - packages/web/lib/api.ts
  - packages/web/app/games/[id]/page.tsx
  - packages/web/components/score-breakdown.tsx
  - packages/web/components/collection-table.tsx
  - packages/web/components/sidebar.tsx
  - packages/web/app/readiness/page.tsx
  - packages/web/lib/collection-utils.ts
  - packages/web/app/collection/page.tsx
  - packages/cli/src/commands/predict.ts
  - packages/cli/src/commands/score.ts
  - packages/cli/src/index.ts
  - packages/daemon/tests/routes/prediction.test.ts
  - packages/daemon/tests/services/prediction-engine.test.ts
  - packages/daemon/tests/services/prediction-engine-tournament.test.ts
  - packages/daemon/src/services/prediction-service.ts
  - packages/daemon/src/routes/prediction.ts
  - packages/shared/src/types.ts
  - packages/web/lib/api.ts
  - packages/web/app/games/[id]/page.tsx
  - packages/web/components/score-breakdown.tsx
  - packages/web/components/collection-table.tsx
  - packages/web/components/sidebar.tsx
  - packages/web/app/readiness/page.tsx
  - packages/web/lib/collection-utils.ts
  - packages/web/app/collection/page.tsx
  - packages/cli/src/commands/predict.ts
  - packages/cli/src/commands/score.ts
  - packages/cli/src/index.ts
  - packages/daemon/tests/routes/prediction.test.ts
  - packages/daemon/tests/services/prediction-engine.test.ts
  - packages/daemon/tests/services/prediction-engine-tournament.test.ts
activity_timeline:
  - timestamp: 2026-04-11T00:18:32.825Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T00:20:46.078Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-11T04:22:14.803Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-11T04:22:14.806Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-11T04:22:14.830Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-11T04:22:26.373Z
    event: progress_report
    reason: "Starting review of Phases 4-6 prediction engine implementation. Loading spec, plan, and commission artifacts."
  - timestamp: 2026-04-11T04:22:50.163Z
    event: progress_report
    reason: "Spec and commission artifacts loaded. Now reading implementation files: prediction-engine.ts, prediction-service.ts, prediction routes, shared types, web UI, and CLI."
  - timestamp: 2026-04-11T04:24:52.341Z
    event: progress_report
    reason: "Core daemon files read. Now reading web UI and remaining files, plus checking for the games endpoint includePredicted param and fitness-service predictionMeta backfill."
  - timestamp: 2026-04-11T04:28:44.097Z
    event: progress_report
    reason: "All implementation files reviewed. Now recording findings against 37 requirements. Key defect found: tension data never reaches the web UI due to type mismatch in web API function."
  - timestamp: 2026-04-11T04:31:37.386Z
    event: progress_report
    reason: "All findings recorded. Compiling final review with requirement-by-requirement walkthrough and prioritized findings."
  - timestamp: 2026-04-11T04:32:46.131Z
    event: result_submitted
    reason: "# Prediction Engine Phases 4-6 Review\n\n## Requirement Coverage: 37/37 addressed, 35 satisfied, 1 defect, 1 partial\n\n### Findings (Priority Order)\n\n---\n\n**F1: Revealed preference tension never renders in web UI** (REQ-PRED-28 violated)\n\nTwo linked failures in the data pipeline:\n\n1. `packages/web/lib/api.ts:216` — `predictGame()` returns `Promise<GameWithScore>` which has `{ game, score }`. The daemon returns `PredictedGameResult` with `{ game, score, tension }`. The `tension` field is present in the runtime JSON but invisible to TypeScript.\n\n2. `packages/web/app/games/[id]/page.tsx:58-64` — Both branches of the ternary set `tension: undefined`:\n```typescript\nprediction = {\n  score: predicted.score,\n  tension: predicted.score.predictionMeta\n    ? undefined // tension comes from the prediction response\n    : undefined,\n};\n```\n\nThe comment acknowledges tension should come from the response but the code never extracts it. The tension panel JSX at lines 394-432 checks `prediction.tension`, which is always `undefined`. The panel never renders.\n\nThe daemon computes tension correctly. The CLI renders tension correctly (`predict.ts:94-99`). Only the web UI is broken.\n\n**Fix**: (1) Create a response type that includes `tension` (or reuse `PredictedGameResult` from shared types), (2) extract `tension` from the predict response in page.tsx.\n\n---\n\n**F2: Stage 0 predict-game response doesn't indicate prediction unavailability** (REQ-PRED-22 partial)\n\nREQ-PRED-22 says the response should \"clearly indicate that personal-axis prediction is not yet available and how many more rated games are needed.\"\n\nAt Stage 0, `prediction-engine.ts:210` gates personal predictions behind `readinessStage > 0`. The resulting response has `predictionMeta: null` (because `predictedAxisCount === 0`). Personal axes appear with `rating: null, source: \"personal\"` — indistinguishable from \"no similar games found\" or \"axis has no reference data.\"\n\nNo field in the predict-game response communicates \"prediction not available because Stage 0\" or \"rate N more games.\" The readiness endpoint provides this, but the spec says the predict-game response itself should carry this.\n\n**Impact**: The CLI `predictGame` output at Stage 0 would show the game name, a score from BGG-derived axes, and the breakdown — but no guidance about why personal axes lack predictions. The web sidebar readiness widget provides global context, which partially compensates.\n\n---\n\n**F3: Daemon route tests don't verify a successful prediction** (test gap)\n\n`packages/daemon/tests/routes/prediction.test.ts` has 8 tests. The `GET /predictions/:gameId` tests only cover error cases (404, 422). The test at line 89-97 (\"returns prediction result for game with BGG data\") adds a game without BGG data and gets 422. No test exercises a successful 200 response through the route with actual prediction data.\n\nThe unit tests for `prediction-engine.ts` are comprehensive (~50 tests). But the route → service → engine integration for the success path is untested at the route level. A wiring bug (e.g., incorrect parameter passing between service and engine) would not be caught.\n\n**Impact**: The math is well-tested. The risk is in the integration seams: service method signatures, response mapping, error handling for edge cases that pass through.\n\n---\n\n**F4: CLI and web duplicate shared types locally** (maintenance risk)\n\n`packages/cli/src/commands/predict.ts` defines local `PredictionMeta`, `PredictGameResponse`, `ReadinessResponse`. `packages/cli/src/commands/score.ts` defines `PredictedGameEntry` with a subset of `PredictionMeta` (missing `readinessStage`, `confidence`, `referenceGameCount`, `coveragePercent`). These duplicate `@shelf-judge/shared` types.\n\nThis is a known pattern (`.lore/issues/axes-page-local-type.md`) extended to prediction types. Not a functional bug — the CLI only accesses fields it defines. But if shared types evolve, the CLI types won't track the changes.\n\n---\n\n**F5: Dead code in contribution calculation** (minor)\n\n`prediction-engine.ts:224` sets `contribution = roundToOneDecimal(effectiveRating * axis.weight)`. Lines 312-315 unconditionally overwrite all non-null contributions with `roundToOneDecimal((entry.rating! * entry.weight) / weightSum)`. The first assignment is dead code. The renormalization is the correct formula.\n\n---\n\n**F6: Redundant Math.min in tournament stability** (minor)\n\n`prediction-service.ts:108-111`: The `if (comparisonCount >= provisionalThreshold)` guard ensures `comparisonCount / provisionalThreshold >= 1.0`, making `Math.min(x, 1.0)` always return 1.0. The formula always evaluates to `1.0 + boost`. The `Math.min` is a remnant of the plan formula which was designed to work without the guard. Functionally correct, just unnecessary.\n\n---\n\n### Requirement Walkthrough\n\n| Req | Status | Notes |\n|-----|--------|-------|\n| REQ-PRED-1 | ✓ | Feature vector encoding in feature-vector.ts |\n| REQ-PRED-2 | ✓ | Families excluded |\n| REQ-PRED-3 | ✓ | prediction-service.ts:170-171 throws \"no BGG data\" |\n| REQ-PRED-4 | ✓ | prediction-engine.ts is pure-function, no I/O |\n| REQ-PRED-5 | ✓ | cosineSimilarity on flattened vectors |\n| REQ-PRED-6 | ✓ | prediction-service.ts:96-101 filters for rated games with BGG data |\n| REQ-PRED-7 | ✓ | findKNearestForAxis filters by axis first, then top-k |\n| REQ-PRED-8 | ✓ | calculateActualScore produces actual entries for BGG axes |\n| REQ-PRED-9 | ✓ | Same sum(rating*weight)/sum(weights) formula |\n| REQ-PRED-10 | ✓ | Vetoes only from actualResult, predicted values excluded |\n| REQ-PRED-11 | ✓ | Confidence levels assigned correctly with threshold checks |\n| REQ-PRED-12 | ✓ | refGames array built per predicted axis |\n| REQ-PRED-13 | ✓ | PredictionMeta has confidence, counts, referenceGameCount, coveragePercent |\n| REQ-PRED-14 | ✓ | PREDICTED badge, teal color, tilde prefix |\n| REQ-PRED-15 | ✓ | Tournament stability factor applied (F6 is cosmetic) |\n| REQ-PRED-16 | ✓ | detectRevealedPreferenceTension works correctly |\n| REQ-PRED-17 | ✓ | Tension doesn't modify score |\n| REQ-PRED-18 | ✓ | tournamentStability=1.0 and empty tournament list when no data |\n| REQ-PRED-19 | ✓ | assessReadiness computes stages from thresholds |\n| REQ-PRED-20 | ✓ | Weak axes, cluster suggestions, action strings |\n| REQ-PRED-21 | ✓ | Thresholds in PredictionSettings, stored in prediction-settings.json |\n| REQ-PRED-22 | ⚠️ | Stage 0 blocks predictions correctly, but response lacks explicit message (F2) |\n| REQ-PRED-23 | ✓ | GET /predictions/:gameId |\n| REQ-PRED-24 | ✓ | GET /games?includePredicted=true delegates to predictionService |\n| REQ-PRED-25 | ✓ | GET /predictions/readiness |\n| REQ-PRED-26 | ✓ | Game detail shows predicted scores with badges and breakdown |\n| REQ-PRED-27 | ✓ | Collection table predictions toggle, sort by predicted fitness |\n| REQ-PRED-28 | ❌ | Tension never displays (F1) |\n| REQ-PRED-29 | ✓ | Sidebar readiness widget + readiness page |\n| REQ-PRED-30 | ✓ | CLI predict with breakdown, confidence, reference games, --json |\n| REQ-PRED-31 | ✓ | CLI predict readiness with stage, weak axes, actions, --json |\n| REQ-PRED-32 | ✓ | score list --include-predicted with [P] marker |\n| REQ-PRED-33 | ✓ | \"predicted\" added to FitnessBreakdownSource |\n| REQ-PRED-34 | ✓ | predictionConfidence and referenceGames nullable fields added |\n| REQ-PRED-35 | ✓ | predictionMeta nullable field added, backward compat in collection-utils.ts |\n| REQ-PRED-36 | ✓ | No new persistent storage (prediction-settings.json needed for REQ-PRED-21) |\n| REQ-PRED-37 | ✓ | Caching not implemented (deferred) |\n\n### Architecture Assessment\n\nThe separation of concerns is clean: pure math in prediction-engine.ts (588 lines, well-tested), data wiring in prediction-service.ts (315 lines), thin HTTP layer in prediction routes (113 lines). The factory/DI pattern is consistent with the rest of the daemon. The feature vector module is properly shared between prediction and profiling without coupling them.\n\nThe backward compatibility approach (nullable additive fields) is correct. The collection-utils.ts ratedStatus filter correctly classifies predicted-only games as \"unrated.\" The fitness-service.ts has `predictionMeta: null` backfilled on both return paths.\n\nTest coverage for the engine layer is strong (~50 unit tests). Tournament tests are thorough (13 tests). Route-level integration tests have the gap noted in F3."
  - timestamp: 2026-04-11T04:32:54.790Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All findings recorded. Compiling final review with requirement-by-requirement walkthrough and prioritized findings."
projectName: shelf-judge
---
# Prediction Engine Phases 4-6 Review

## Requirement Coverage: 37/37 addressed, 35 satisfied, 1 defect, 1 partial

### Findings (Priority Order)

---

**F1: Revealed preference tension never renders in web UI** (REQ-PRED-28 violated)

Two linked failures in the data pipeline:

1. `packages/web/lib/api.ts:216` — `predictGame()` returns `Promise<GameWithScore>` which has `{ game, score }`. The daemon returns `PredictedGameResult` with `{ game, score, tension }`. The `tension` field is present in the runtime JSON but invisible to TypeScript.

2. `packages/web/app/games/[id]/page.tsx:58-64` — Both branches of the ternary set `tension: undefined`:
```typescript
prediction = {
  score: predicted.score,
  tension: predicted.score.predictionMeta
    ? undefined // tension comes from the prediction response
    : undefined,
};
```

The comment acknowledges tension should come from the response but the code never extracts it. The tension panel JSX at lines 394-432 checks `prediction.tension`, which is always `undefined`. The panel never renders.

The daemon computes tension correctly. The CLI renders tension correctly (`predict.ts:94-99`). Only the web UI is broken.

**Fix**: (1) Create a response type that includes `tension` (or reuse `PredictedGameResult` from shared types), (2) extract `tension` from the predict response in page.tsx.

---

**F2: Stage 0 predict-game response doesn't indicate prediction unavailability** (REQ-PRED-22 partial)

REQ-PRED-22 says the response should "clearly indicate that personal-axis prediction is not yet available and how many more rated games are needed."

At Stage 0, `prediction-engine.ts:210` gates personal predictions behind `readinessStage > 0`. The resulting response has `predictionMeta: null` (because `predictedAxisCount === 0`). Personal axes appear with `rating: null, source: "personal"` — indistinguishable from "no similar games found" or "axis has no reference data."

No field in the predict-game response communicates "prediction not available because Stage 0" or "rate N more games." The readiness endpoint provides this, but the spec says the predict-game response itself should carry this.

**Impact**: The CLI `predictGame` output at Stage 0 would show the game name, a score from BGG-derived axes, and the breakdown — but no guidance about why personal axes lack predictions. The web sidebar readiness widget provides global context, which partially compensates.

---

**F3: Daemon route tests don't verify a successful prediction** (test gap)

`packages/daemon/tests/routes/prediction.test.ts` has 8 tests. The `GET /predictions/:gameId` tests only cover error cases (404, 422). The test at line 89-97 ("returns prediction result for game with BGG data") adds a game without BGG data and gets 422. No test exercises a successful 200 response through the route with actual prediction data.

The unit tests for `prediction-engine.ts` are comprehensive (~50 tests). But the route → service → engine integration for the success path is untested at the route level. A wiring bug (e.g., incorrect parameter passing between service and engine) would not be caught.

**Impact**: The math is well-tested. The risk is in the integration seams: service method signatures, response mapping, error handling for edge cases that pass through.

---

**F4: CLI and web duplicate shared types locally** (maintenance risk)

`packages/cli/src/commands/predict.ts` defines local `PredictionMeta`, `PredictGameResponse`, `ReadinessResponse`. `packages/cli/src/commands/score.ts` defines `PredictedGameEntry` with a subset of `PredictionMeta` (missing `readinessStage`, `confidence`, `referenceGameCount`, `coveragePercent`). These duplicate `@shelf-judge/shared` types.

This is a known pattern (`.lore/issues/axes-page-local-type.md`) extended to prediction types. Not a functional bug — the CLI only accesses fields it defines. But if shared types evolve, the CLI types won't track the changes.

---

**F5: Dead code in contribution calculation** (minor)

`prediction-engine.ts:224` sets `contribution = roundToOneDecimal(effectiveRating * axis.weight)`. Lines 312-315 unconditionally overwrite all non-null contributions with `roundToOneDecimal((entry.rating! * entry.weight) / weightSum)`. The first assignment is dead code. The renormalization is the correct formula.

---

**F6: Redundant Math.min in tournament stability** (minor)

`prediction-service.ts:108-111`: The `if (comparisonCount >= provisionalThreshold)` guard ensures `comparisonCount / provisionalThreshold >= 1.0`, making `Math.min(x, 1.0)` always return 1.0. The formula always evaluates to `1.0 + boost`. The `Math.min` is a remnant of the plan formula which was designed to work without the guard. Functionally correct, just unnecessary.

---

### Requirement Walkthrough

| Req | Status | Notes |
|-----|--------|-------|
| REQ-PRED-1 | ✓ | Feature vector encoding in feature-vector.ts |
| REQ-PRED-2 | ✓ | Families excluded |
| REQ-PRED-3 | ✓ | prediction-service.ts:170-171 throws "no BGG data" |
| REQ-PRED-4 | ✓ | prediction-engine.ts is pure-function, no I/O |
| REQ-PRED-5 | ✓ | cosineSimilarity on flattened vectors |
| REQ-PRED-6 | ✓ | prediction-service.ts:96-101 filters for rated games with BGG data |
| REQ-PRED-7 | ✓ | findKNearestForAxis filters by axis first, then top-k |
| REQ-PRED-8 | ✓ | calculateActualScore produces actual entries for BGG axes |
| REQ-PRED-9 | ✓ | Same sum(rating*weight)/sum(weights) formula |
| REQ-PRED-10 | ✓ | Vetoes only from actualResult, predicted values excluded |
| REQ-PRED-11 | ✓ | Confidence levels assigned correctly with threshold checks |
| REQ-PRED-12 | ✓ | refGames array built per predicted axis |
| REQ-PRED-13 | ✓ | PredictionMeta has confidence, counts, referenceGameCount, coveragePercent |
| REQ-PRED-14 | ✓ | PREDICTED badge, teal color, tilde prefix |
| REQ-PRED-15 | ✓ | Tournament stability factor applied (F6 is cosmetic) |
| REQ-PRED-16 | ✓ | detectRevealedPreferenceTension works correctly |
| REQ-PRED-17 | ✓ | Tension doesn't modify score |
| REQ-PRED-18 | ✓ | tournamentStability=1.0 and empty tournament list when no data |
| REQ-PRED-19 | ✓ | assessReadiness computes stages from thresholds |
| REQ-PRED-20 | ✓ | Weak axes, cluster suggestions, action strings |
| REQ-PRED-21 | ✓ | Thresholds in PredictionSettings, stored in prediction-settings.json |
| REQ-PRED-22 | ⚠️ | Stage 0 blocks predictions correctly, but response lacks explicit message (F2) |
| REQ-PRED-23 | ✓ | GET /predictions/:gameId |
| REQ-PRED-24 | ✓ | GET /games?includePredicted=true delegates to predictionService |
| REQ-PRED-25 | ✓ | GET /predictions/readiness |
| REQ-PRED-26 | ✓ | Game detail shows predicted scores with badges and breakdown |
| REQ-PRED-27 | ✓ | Collection table predictions toggle, sort by predicted fitness |
| REQ-PRED-28 | ❌ | Tension never displays (F1) |
| REQ-PRED-29 | ✓ | Sidebar readiness widget + readiness page |
| REQ-PRED-30 | ✓ | CLI predict with breakdown, confidence, reference games, --json |
| REQ-PRED-31 | ✓ | CLI predict readiness with stage, weak axes, actions, --json |
| REQ-PRED-32 | ✓ | score list --include-predicted with [P] marker |
| REQ-PRED-33 | ✓ | "predicted" added to FitnessBreakdownSource |
| REQ-PRED-34 | ✓ | predictionConfidence and referenceGames nullable fields added |
| REQ-PRED-35 | ✓ | predictionMeta nullable field added, backward compat in collection-utils.ts |
| REQ-PRED-36 | ✓ | No new persistent storage (prediction-settings.json needed for REQ-PRED-21) |
| REQ-PRED-37 | ✓ | Caching not implemented (deferred) |

### Architecture Assessment

The separation of concerns is clean: pure math in prediction-engine.ts (588 lines, well-tested), data wiring in prediction-service.ts (315 lines), thin HTTP layer in prediction routes (113 lines). The factory/DI pattern is consistent with the rest of the daemon. The feature vector module is properly shared between prediction and profiling without coupling them.

The backward compatibility approach (nullable additive fields) is correct. The collection-utils.ts ratedStatus filter correctly classifies predicted-only games as "unrated." The fitness-service.ts has `predictionMeta: null` backfilled on both return paths.

Test coverage for the engine layer is strong (~50 unit tests). Tournament tests are thorough (13 tests). Route-level integration tests have the gap noted in F3.

## Decisions

**Does the web UI display revealed preference tension (REQ-PRED-28)?**
DEFECT: Tension data never reaches the web UI. The tension panel renders a shell but its data source is always undefined.
*Reasoning: Two linked failures in the data pipeline:

1. `packages/web/lib/api.ts:216` types `predictGame()` as returning `Promise<GameWithScore>` (which has `{ game, score }`). The daemon endpoint returns `PredictedGameResult` which has `{ game, score, tension }`. The TypeScript type drops the `tension` field.

2. `packages/web/app/games/[id]/page.tsx:58-64` constructs the `prediction` object with `tension: undefined` in both branches of a ternary:
```
tension: predicted.score.predictionMeta
  ? undefined // tension comes from the prediction response
  : undefined,
```
The comment acknowledges tension should come from the response, but the code sets it to undefined unconditionally. Even though `predicted.tension` exists at runtime (JSON doesn't obey TypeScript types), it's never accessed.

Result: The tension panel JSX (lines 394-432) checks `prediction.tension` which is always undefined, so `tensionNote` is always falsy, and the panel never renders. REQ-PRED-28 is unsatisfied.*

**Does REQ-PRED-22 Stage 0 behavior clearly indicate that personal-axis prediction is not available?**
PARTIAL SATISFACTION: Stage 0 correctly blocks personal axis predictions, but the predict-game response doesn't explicitly communicate unavailability.
*Reasoning: REQ-PRED-22 says: "The response clearly indicates that personal-axis prediction is not yet available and how many more rated games are needed."

At Stage 0, `prediction-engine.ts:210` gates personal axis prediction behind `readinessStage > 0`, so no personal axes get predicted. The resulting `FitnessResult` has `predictionMeta: null` (because `predictedAxisCount === 0`). Personal axes appear in the breakdown with `rating: null, source: "personal"` (not "predicted"), same as unrated axes with no prediction infrastructure at all.

The problem: there's no signal in the predict-game response that distinguishes "we can't predict because Stage 0" from "we can't predict because there aren't enough similar games." A client receiving `predictionMeta: null` doesn't know whether to say "rate 3 more games to unlock predictions" or "no similar games found." The readiness endpoint provides this context, but the spec says the predict-game response itself should "clearly indicate" it.

The CLI `predictGame` output wouldn't show the prediction metadata section at all (since `predictionMeta` is null), which means no stage info, no "how many more games needed" guidance. The web sidebar readiness widget provides this context globally, but the per-game response doesn't.*

**Does the web predictGame API function return the correct type for the daemon response?**
DEFECT: Return type mismatch. web/lib/api.ts:216 uses GameWithScore but the daemon returns PredictedGameResult which includes tension.
*Reasoning: The daemon's `PredictedGameResult` interface (`prediction-service.ts:31-35`) is `{ game: Game; score: FitnessResult; tension: RevealedPreferenceTension | null }`. The web API function `predictGame` types its return as `Promise<GameWithScore>` which is `{ game: Game; score: FitnessResult | null }`. The `tension` field exists in the JSON response at runtime but is invisible to TypeScript consumers. This is the root cause of the tension display bug.

Fix: Either create a dedicated type in shared (e.g., `PredictedGameResponse`) that includes `tension`, or export `PredictedGameResult` from the daemon and import it in the web package. The former is cleaner since it's an API contract.*

**Does the contribution calculation in the prediction engine use the correct formula?**
Correct but wasteful. Contribution is set at line 224 then unconditionally overwritten at line 314.
*Reasoning: prediction-engine.ts:224 sets `contribution = roundToOneDecimal(effectiveRating * axis.weight)`. Then lines 312-315 overwrite all non-null contributions with `roundToOneDecimal((entry.rating! * entry.weight) / weightSum)`. The first assignment is dead code. The renormalization is the correct formula (contributions should be relative to the combined weight sum so they sum to the overall score). Not a functional bug, but the dead assignment is misleading.*

**Is the tournament stability boost formula correct per the plan?**
Functionally correct but contains a redundant Math.min call.
*Reasoning: prediction-service.ts:108-111:
```
if (comparisonCount >= provisionalThreshold) {
  tournamentStability = 1.0 + settings.tournamentStabilityBoost * Math.min(comparisonCount / provisionalThreshold, 1.0);
}
```
The `if` guard ensures `comparisonCount >= provisionalThreshold`, so `comparisonCount / provisionalThreshold >= 1.0`, so `Math.min(x, 1.0)` always returns 1.0. The result is always `1.0 + boost` (1.2 by default). The Math.min is dead code in this context. The plan's formula was designed to work without the guard, but the guard makes it unnecessary. Functionally correct per REQ-PRED-15 (stable games get a measurably higher effective similarity). Minor readability issue.*

**Does the CLI duplicate shared types locally instead of importing from @shelf-judge/shared?**
OBSERVATION: CLI predict.ts and score.ts define local interfaces that duplicate shared types (PredictionMeta, PredictGameResponse, ReadinessResponse, PredictedGameEntry).
*Reasoning: packages/cli/src/commands/predict.ts defines local `PredictionMeta`, `PredictGameResponse`, and `ReadinessResponse` interfaces. packages/cli/src/commands/score.ts defines a local `PredictedGameEntry` with a subset of `PredictionMeta` fields. These duplicate the shared `PredictionMeta`, `PredictionReadiness`, and `PredictedGameResult` types. The CLI's `PredictedGameEntry.score.predictionMeta` only has `predictedAxisCount` and `actualAxisCount`, omitting `readinessStage`, `confidence`, `referenceGameCount`, and `coveragePercent`.

The web package has a known issue with local type duplication (`.lore/issues/axes-page-local-type.md`). The CLI extends this pattern to prediction types. Not a functional bug (the CLI only accesses the fields it defines), but if the shared types change, the CLI types won't track the changes. This is the same class of problem documented in the known issue.*

**Does the predictedCount calculation in collection/page.tsx correctly count prediction-only games?**
Correct but fragile. The count subtracts rated.length from games with predictionMeta, assuming rated games are a strict subset of predicted games.
*Reasoning: collection/page.tsx:46-50:
```
const predictedCount = predictedGames
  ? predictedGames.filter(
      (g) => g.score?.predictionMeta !== null && g.score?.predictionMeta !== undefined,
    ).length - rated.length
  : 0;
```

This counts games where `score.predictionMeta` is not null/undefined, then subtracts the number of rated games from the standard list. The assumption is that `predictedGames` (from `listGamesWithPredictions`) includes all games that have `predictionMeta`, and `rated` (from `listGames`) includes all games with scores. So `predicted - rated = prediction-only games`.

The assumption holds because `listGamesWithPredictions` returns predictions for all eligible games, and rated games in the standard list have `predictionMeta: null`. But this arithmetic coupling between two independent API responses is fragile. If either response shape changes, this count could go negative (line 100 guards with `> 0` clamp). Not a bug today, but a maintenance risk.*

**Are the daemon route tests adequate for prediction functionality?**
OBSERVATION: Route tests are shallow. They verify HTTP status codes and basic response shapes but don't test prediction math through the routes.
*Reasoning: prediction.test.ts has 8 tests total:
- Readiness: 1 test (shape check)
- Settings GET: 1 test (default values)
- Settings PATCH: 3 tests (merge, invalid JSON, non-object)
- Predict game: 3 tests (404, 422, but the third test also returns 422 because the test can't add a game with BGG data through the route alone)
- Games with predictions: 3 tests (flag absent, flag present, unchanged behavior)

Missing coverage:
1. No test verifies a successful prediction response (200 with actual prediction data). The test at line 89-97 tries to test "returns prediction result for game with BGG data" but the game has no BGG data, so it falls back to 422.
2. No test verifies the prediction response includes correct `predictionMeta`, `breakdown` with predicted entries, or `tension`.
3. No test verifies that `?includePredicted=true` actually populates `predictionMeta` on returned games.

The unit tests for the prediction engine (in a separate test file) likely cover the math. But the integration between routes → service → engine is only verified for error cases, not success cases. This means a wiring bug between the service and routes wouldn't be caught.*
