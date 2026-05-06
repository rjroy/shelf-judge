---
title: "Implementation plan: tournament axis source"
date: 2026-05-05
status: approved
tags: [plan, fitness, tournament, axis, elo]
modules: [shared, daemon, web, cli]
related:
  - .lore/specs/tournament/elo-axis-source.md
  - .lore/specs/tournament/tournament-ranking.md
  - .lore/specs/fitness/prediction-engine.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/designs/mvp-data-model.md
  - .lore/plans/tournament/tournament-ranking.md
  - .lore/plans/fitness/prediction-engine.md
---

# Plan: Tournament Axis Source

## Spec Reference

**Spec**: `.lore/specs/tournament/elo-axis-source.md`
**Related plans (templates and prior surface)**:

- `.lore/plans/tournament/tournament-ranking.md` — divergence flag code paths to delete
- `.lore/plans/fitness/prediction-engine.md` — tension panel and tournament stability touch points

Requirements addressed:

- REQ-TAXIS-1 (`Axis.source` enum) → Step 1
- REQ-TAXIS-2 (`FitnessBreakdownEntry.source` enum) → Step 1
- REQ-TAXIS-3 (singleton enforcement) → Step 1
- REQ-TAXIS-4 (auto-create + load-time migration) → Step 2
- REQ-TAXIS-5 (fixed defaults: name, description, weight) → Step 2
- REQ-TAXIS-6 (value = normalized ELO display score) → Step 3
- REQ-TAXIS-7 (null when no comparisons OR < 5-game cohort) → Step 3
- REQ-TAXIS-8 (prediction engine integration) → Step 4
- REQ-TAXIS-9 (load-time migration + cache invalidation) → Step 2
- REQ-TAXIS-10 (no modification of existing axes) → Step 2 (constraint)
- REQ-TAXIS-11 (display in web + CLI breakdown) → Step 7
- REQ-TAXIS-12 (standalone tournament rank surface preserved) → Step 7 (verification only)
- REQ-TAXIS-13 (sorting by tournament rank and fitness independently) → Step 7 (verification only)
- REQ-TAXIS-14 (supersede REQ-TOURN-18 divergence flag) → Step 5
- REQ-TAXIS-15 (supersede tournament-ranking.md "Peers" decision) → Step 8 (docs)
- REQ-TAXIS-16 (supersede REQ-PRED-16/17/28 tension surface) → Step 6
- REQ-TAXIS-17 (supersede prediction-engine.md line 234 constraint) → Step 4 + Step 8 (docs)

## Codebase Context

**Type system** lives in `packages/shared/`:

- `packages/shared/src/types.ts` — `AxisSource` (line 67), `Axis` (lines 69-83), `FitnessBreakdownSource` (line 96), `FitnessBreakdownEntry` (lines 98-112), `RevealedPreferenceTension` (lines 398-402)
- `packages/shared/src/validation.ts` — `CreateAxisSchema` (lines 16-30) with refinements that currently require `bggField` for `source: "bgg"` and forbid it for `source: "personal"`. A third-arm refinement is needed for `tournament`.

**Daemon services** (under `packages/daemon/src/services/`):

- `storage-service.ts` — `createDefaultCollection()` (lines 49-80), `loadCollection()` (lines 111-134), tournament data load/save (lines 161-180), profile cache load/save (lines 187-197). The legacy backfill at lines 124-131 is the prior art for load-time migration but does not currently invalidate caches.
- `tournament-migration.ts` — idempotent migration template (`{data, migrated: boolean}` shape, lines 32-80). The collection migration should follow this pattern.
- `elo-engine.ts` — `normalizeElo(elo, halfWidth)` (lines 46-51) and `shouldDisplayRanking(gamesWithComparisons)` (lines 54-59). Both implement REQ-TOURN-9 and REQ-TAXIS-7's cohort floor.
- `tournament-service.ts` — `deriveDisplayStats(gameId, data)` (lines 97-145) already produces `normalizedScore: number | null` exactly matching what the tournament axis needs. Reuse this.
- `fitness-service.ts` — composes per-axis values into `FitnessResult`. Currently reads personal ratings from `game.ratings[axisId]` and BGG values from `game.bggData[bggField]`. A third branch for `source: "tournament"` reads from tournament data (passed in via DI, since fitness-service should not own tournament storage).
- `feature-vector.ts` — `buildVocabulary` and `encodeGame` (lines 18-171). The `personalAxes` component (lines 22-30, 152-171) currently encodes ratings for axes with `source === "personal"` only (line 113-125 has the personal-vs-bgg split). Tournament axis ratings fold into the same component because they are per-game numeric ratings, like personal axes.
- `prediction-engine.ts` — `detectRevealedPreferenceTension()` (lines 541-588), source ordering (line 325), personal-axis filtering (lines 210, 448).
- `prediction-service.ts` — tension detection callsites at lines 194-204 and 278-288; tournament-ranked games construction at lines 139-153.
- `profile-engine.ts` — `computeDivergence()` (lines 237-270) is the _collection-profile_ divergence (consumed by profile-service.ts:62, 71). This is **not** the REQ-TOURN-18 divergence flag and is **not** removed by this plan. See "Open Questions."

**Game detail (REQ-TOURN-18) divergence flag** lives in client code, not in profile-engine. Step 5 includes a discovery substep to locate the exact paths in `packages/web/app/games/[id]/page.tsx` and `packages/cli/src/commands/score.ts` (or wherever the per-game divergence banner currently renders) before deletion.

**Web** (`packages/web/`):

- `components/score-breakdown.tsx` — renders the breakdown table; source label flows through directly. Tournament label needs styling parity with other sources.
- `app/games/[id]/page.tsx` — imports `RevealedPreferenceTension` (line 35); hosts the tension panel and the divergence banner.
- `components/tension-panel.tsx` (or equivalent) — full tension UI to delete.
- `app/search/page.tsx`, `app/readiness/page.tsx`, `components/sidebar.tsx` — additional tension consumers per the prediction-engine plan.

**CLI** (`packages/cli/`):

- `src/output.ts` — `formatBreakdown()` (lines 56-89) renders `entry.source` as-is; tournament needs no special handling beyond appearing in the union.
- `src/commands/predict.ts` — tension display at lines 60-66.
- `src/commands/score.ts` — divergence display, if present.

**On-disk derived state**:

- `{dataDir}/profile.json` (REQ-TAXIS-9 invalidation target). Profile is recomputed when `collection.updatedAt > profile.computedAt`; deleting on migration is the cleanest invalidation.
- Fitness scores: not cached on disk.
- Tournament stats: authoritative in `tournament.json`, not invalidated.

**Project conventions worth following**:

- Migration functions return `{data, migrated: boolean}` and are idempotent. See `tournament-migration.ts:32-80`.
- Daemon owns all migrations. Web/CLI cannot initialize state.
- Tests use `bun test`, dependency injection over `mock.module()`. BGG fixtures live at `packages/daemon/tests/fixtures/`.

## Implementation Steps

### Step 1: Extend type system and validation in `packages/shared` and unblock strict-mode compile

**Files**:

- `packages/shared/src/types.ts`
- `packages/shared/src/validation.ts`
- `packages/shared/src/curve-math.ts` — `getNativeScale` adds a `"tournament"` branch
- `packages/daemon/src/services/fitness-service.ts` — `sourceOrder` `Record<FitnessBreakdownSource, number>` adds a `tournament` entry
- `packages/shared/tests/validation.test.ts` (new test cases)
- `packages/shared/tests/curve-math.test.ts` (new test for the new branch)

**Addresses**: REQ-TAXIS-1, REQ-TAXIS-2, REQ-TAXIS-3 (validation half)
**Expertise**: none

What to do:

1. Extend `AxisSource` to `"personal" | "bgg" | "tournament"`.
2. Extend `FitnessBreakdownSource` to add `"tournament"`. Keep existing values.
3. Update `CreateAxisSchema` Zod refinement to a three-arm shape:
   - `source: "personal"` → no `bggField`
   - `source: "bgg"` → `bggField` required
   - `source: "tournament"` → no `bggField`
4. Add a `"tournament"` branch to `getNativeScale(source, bggField)` in `packages/shared/src/curve-math.ts:37`. Return `{ min: 1, max: 10 }` (same as personal). Without this, `fitness-service.ts:43` throws on every score computation for collections with a tournament axis (the existing function falls through to `default: throw new Error("Unknown BGG field: null")` when `source !== "personal"` and `bggField` is null).
5. Add `tournament` to the `sourceOrder` record in `fitness-service.ts:140`. The record is typed `Record<FitnessBreakdownSource, number>`, so omitting the new key is a TypeScript strict-mode build failure. Suggested ordering: `{ override: 0, bgg: 1, tournament: 2, personal: 3, predicted: 4 }` (tournament between bgg and personal — both system-derived, but tournament is per-game user signal).
6. Add validation tests for each arm, including the new tournament arm rejecting a `bggField`.
7. Add a curve-math unit test covering `getNativeScale("tournament", null)`.
8. Singleton enforcement is **not** in the schema (Zod can't see the collection). It belongs in the create endpoint (Step 2).

The two design docs disagree on the breakdown source enum (`mvp-data-model.md` and `mvp-fitness-model.md`). Code reality (`types.ts`) is canonical. No design-doc edits in this step; doc reconciliation is Step 8.

### Step 2: Collection migration and tournament-axis auto-creation

**Files**:

- `packages/daemon/src/services/collection-migration.ts` (new — mirrors `tournament-migration.ts`)
- `packages/daemon/src/services/storage-service.ts` (wire migration + cache invalidation into `loadCollection`)
- `packages/daemon/src/routes/axes.ts` (singleton enforcement on create)
- `packages/daemon/tests/services/collection-migration.test.ts` (new)
- `packages/daemon/tests/services/storage-service.test.ts` (extended)

**Addresses**: REQ-TAXIS-3 (singleton), REQ-TAXIS-4, REQ-TAXIS-5, REQ-TAXIS-9, REQ-TAXIS-10
**Expertise**: none

What to do:

1. Create `collection-migration.ts` exporting `ensureTournamentAxis(collection): {data: Collection, migrated: boolean}`. If the collection has zero `source: "tournament"` axes, append one with:
   - `id`: new UUID
   - `name`: `"Tournament"`
   - `description`: `"Derived from head-to-head tournament comparisons. Each game's score is its normalized ELO display value."`
   - `weight`: `30` (interim default — see Open Questions; matches the BGG-axis tier)
   - `source`: `"tournament"`
   - `bggField`: `null`
   - `createdAt`/`updatedAt`: now
2. Update `createDefaultCollection()` to include the tournament axis at creation. Existing personal/BGG defaults are untouched (REQ-TAXIS-10).
3. In `loadCollection()`, after parsing the file and after the existing legacy-game backfill, call `ensureTournamentAxis`. If `migrated === true`:
   - Persist the updated collection (atomic write).
   - Invalidate dependent caches:
     - Delete `{dataDir}/profile.json` if it exists.
     - Clear `predictedScore` and `predictedBreakdown` fields on every entry in `{dataDir}/wishlist.json` if it exists (or delete the file entirely — implementer's choice, but the predicted entries reflect a world without the tournament axis and will be wrong for any game where the tournament axis contributes a non-null value). Atomic write the cleared file back.
   - Bump `collection.updatedAt` so any downstream staleness check fires correctly.
4. Migration must run during daemon startup before any client request is served. `loadCollection()` is on the daemon-startup path; verify (and add a startup ordering test) that no route handler can fire before migration has completed.
5. Singleton enforcement on the axes create endpoint: when `source === "tournament"` and a tournament axis already exists, return 400 with a clear error code (e.g., `tournament_axis_already_exists`).
6. Tests:
   - New collection contains exactly one tournament axis
   - Existing collection without tournament axis gains one on load; second load is no-op (`migrated === false`)
   - Migration deletes `profile.json` when present and is silent when absent
   - Migration clears stale `predictedScore`/`predictedBreakdown` fields in `wishlist.json` when present
   - Existing axes (personal + BGG defaults) are unchanged after migration
   - Create endpoint rejects a second tournament-source axis

### Step 3: Wire tournament axis values into fitness composition

**Files**:

- `packages/daemon/src/services/fitness-service.ts`
- `packages/daemon/src/services/fitness-service.test.ts`
- Wherever fitness-service is instantiated (likely the routes/composition layer): inject the loaded tournament data so fitness-service can read per-game normalized ELO without owning storage.

**Addresses**: REQ-TAXIS-6, REQ-TAXIS-7
**Expertise**: none

What to do:

1. Extend the public `calculateScore` signature to accept tournament data per call: `calculateScore(game, axes, tournamentData: TournamentData | null)`. Per-call (not constructor) because tournament data changes between requests as new comparisons are submitted, and `fitness-service.ts` is a stateless `createFitnessService()` factory today. Update every callsite (routes, prediction-service, profile-service, score endpoints — grep for `calculateScore(`) to pass the loaded tournament data through. Routes load `tournament.json` once per request via `storage-service` and forward it.
2. In the breakdown construction path, add a third branch alongside personal/BGG:
   - For `axis.source === "tournament"`: compute the per-game value by calling `deriveDisplayStats(gameId, tournamentData).normalizedScore` (reusing existing logic — this already returns `null` when the game has no comparisons or when `< 5` games have comparisons).
   - When the value is `null`, the axis is excluded from numerator and denominator, the same way unrated personal axes already are. The breakdown entry shows "not rated" treatment.
   - When non-null, the breakdown entry uses `source: "tournament"` and `rating: <normalizedScore>`.
3. Tests:
   - Game with comparisons in a 5+ cohort: tournament entry has `rating === normalizedScore`, contributes to weighted average
   - Game with comparisons in a < 5 cohort: tournament entry is `null`, excluded from average
   - Game with zero comparisons: tournament entry is `null`, excluded from average
   - Provisional games (per REQ-TOURN-10) contribute their normalized score normally
   - Existing fitness tests pass with the tournament axis present in the test collection (REQ-TAXIS spec success criterion)

### Step 4: Prediction engine — predict tournament axis values, drop the no-predict constraint

**Files**:

- `packages/daemon/src/services/feature-vector.ts`
- `packages/daemon/src/services/prediction-engine.ts`
- `packages/daemon/src/services/prediction-service.ts` (wiring; tension removal is Step 6)
- `packages/daemon/tests/services/feature-vector.test.ts`
- `packages/daemon/tests/services/prediction-engine.test.ts`

**Addresses**: REQ-TAXIS-8, REQ-TAXIS-17 (prediction-target half)
**Expertise**: code review by fresh-context sub-agent (feature-vector dimension change is subtle)

What to do:

1. In `feature-vector.ts`, the `personalAxes` component currently filters to `axis.source === "personal"`. Update to include `axis.source === "personal" || axis.source === "tournament"`. The encoding logic (rating / 10, null when unrated) is identical because tournament values are already on a 1-10 scale.
   - Vocabulary derivation must include the tournament axis ID as a column.
   - This changes vector shape for all games. Predictions are computed on demand (REQ-PRED-36), so there's no cache to invalidate — but a test must lock down the new dimension count.
   - **Side effect to acknowledge**: `compositeDistance` (used by `profile-engine.ts` for outlier detection) consumes `personalAxes` too. After this change, missing tournament values for games not yet ranked will be filled with the same 0.5 default `encodeGame` already uses for missing personal ratings. This shifts outlier distance calculations slightly. Acceptable (consistent with existing behavior for unrated personal axes), but a profile-engine test must confirm no regressions.
2. **Critical (called out by review)**: `prediction-service.ts` `loadPredictionContext` currently filters tournament-axis ratings out before they reach `feature-vector.ts`. Fix in two places:
   - Lines 81-84 (`gameRatings` build loop): the loop reads `game.ratings?.[axis.id]` only for `axis.source === "personal"`. Extend the source check to include `"tournament"`, AND change the value source: tournament values are not in `game.ratings`, they come from `deriveDisplayStats(game.id, tournamentData).normalizedScore`. The function needs `tournamentData` injected (already available in this layer; thread through if not).
   - Lines 317-323 (`getReadiness()`): the same source filter excludes tournament from reference-game counting. Apply the same fix.
   - Without these two changes, `feature-vector.ts` dimension grows but the tournament column is always 0/null at runtime, so REQ-TAXIS-8 and REQ-TAXIS-17 will compile-pass but be silently non-functional.
3. Also confirm `resolveAxisValues` in `packages/shared/src/axis-utils.ts` does not need a tournament branch. It's used by callers that already have `game.ratings` + `bggData` in hand; tournament values flow through `prediction-service.ts` directly via the fix above, not through `resolveAxisValues`. If any other caller invokes `resolveAxisValues` and expects tournament values back, add a `tournamentValue` parameter and a third branch. Verify with a grep on `resolveAxisValues(` before declaring done.
4. In `prediction-engine.ts`, ensure k-NN estimation iterates over all non-BGG axes (personal + tournament):
   - Source ordering at line 325 already uses `sourceOrder[a.source]`; rely on the order set in Step 1.
   - Personal-axis filtering at lines 210 and 448: extend to include `tournament`.
   - Reference filtering by axis rating works for tournament axis: a game contributes to predicting another game's tournament value only if the source game has a non-null tournament value (which means it has comparisons in a 5+ cohort).
   - Confidence levels apply unchanged.
   - Predicted tournament-axis entries appear in the breakdown with `source: "predicted"` (and `predictionConfidence` set), exactly like predicted personal axes.
5. The constraint at `prediction-engine.md` line 234 is being lifted in code (the doc edit is Step 8). Add a unit test that predicts a tournament axis value for a game with no comparisons and verifies the breakdown entry has `source: "predicted"` and a sensible value.
6. Tests:
   - Feature vector dimension grows by exactly 1 when a tournament axis is present
   - Cosine similarity returns sensible values across mixed (personal + tournament) personalAxes components
   - End-to-end: a game with comparisons in a 5+ cohort actually appears as a reference game with its tournament value contributing to k-NN (regression test for the `loadPredictionContext` filter fix above)
   - k-NN over a 5-game collection produces a predicted tournament value for a 6th, with the weighted-average matching hand calculation
   - `getReadiness()` counts tournament-axis ratings toward `weakAxes` thresholds when applicable
   - Prediction unavailable / Stage 0 paths still gate correctly
   - Profile-engine outlier detection produces stable results before/after the dimension change on a fixture collection

### Step 5: Remove REQ-TOURN-18 divergence flag from game detail

**Files** (resolved before any deletion):

- `packages/web/app/games/[id]/page.tsx` (confirmed: imports `RevealedPreferenceTension` at line 35, hosts the divergence banner per Codebase Context)
- `packages/web/components/` (any divergence banner component — name once located)
- `packages/cli/src/commands/score.ts` (probable CLI surface — verify by grep)
- Any daemon-side delta computation (search for `axis-fitness` or `tournament-rank` delta patterns)

**Addresses**: REQ-TAXIS-14
**Expertise**: none, but be ruthless about matching the success criterion ("function/code paths computing that delta are deleted")

What to do:

1. Substep — discovery (must complete and be recorded in implementation notes before any deletion): ripgrep for the REQ-TOURN-18 surface. Use these queries:
   - `rg "tournament[-_]rank" --type ts --type tsx`
   - `rg "divergen" --type ts --type tsx`
   - `rg "higher fit|lower fit|axis ratings suggest"` (the REQ-TOURN-18 copy strings)
     Inventory every hit by file:line. Confirm none of them are the _collection-profile_ divergence in `profile-engine.ts:237-270` — that path stays. Record the inventory in the implementation notes file before making the first deletion. If discovery turns up a file the plan does not anticipate (e.g., a hook, a util, a CSS class), pause and update this step before proceeding.
2. Delete the daemon-side delta function (if any) that powers the flag.
3. Delete the web banner component and remove its callsite from the game detail page.
4. Delete the CLI display branch.
5. Strike the manual-verification line "Trigger divergence flag by rating a game highly on axes but consistently losing in comparisons" from `tournament-ranking.md` (this is Step 8's territory — note it as a doc edit, not a code edit, but record the strike here as a checklist item).
6. Tests:
   - Snapshot or behavior test on the game detail page asserts the divergence banner does not render even with constructed inputs that _would_ have triggered it
   - Daemon tests for the deleted function are removed

### Step 6: Remove revealed preference tension surface

**Files**:

- `packages/daemon/src/services/prediction-engine.ts` — delete `detectRevealedPreferenceTension` (lines 541-588) and remove its callers
- `packages/daemon/src/services/prediction-service.ts` — remove the internal `PredictedGameResult.tension` field at lines 28-33, the `RevealedPreferenceTension` import (line 7), and tension detection callsites at lines 194-204 and 278-288
- `packages/shared/src/types.ts` — remove `RevealedPreferenceTension` type and the `tension` field from `PredictedGameResponse`
- `packages/web/app/games/[id]/page.tsx` — remove tension panel rendering and its import
- `packages/web/components/tension-panel.tsx` (if exists) — delete component and its CSS
- `packages/cli/src/commands/predict.ts` — remove tension display at lines 60-66
- `packages/daemon/tests/services/prediction-engine.test.ts` — remove tension tests

**Addresses**: REQ-TAXIS-16
**Expertise**: code review by fresh-context sub-agent (the API shape change touches every prediction consumer)

What to do:

1. Remove the `tension` field from `PredictedGameResponse`. This is a breaking response-shape change — grep every client helper in web and CLI before declaring the work done (per CLAUDE.md "Critical Lesson" on response-shape changes). Targeted greps:
   - `rg "RevealedPreferenceTension"` — every type reference
   - `rg "\.tension"` filtered to prediction response shapes
   - `rg "tension-panel|tensionPanel"` — any CSS or class hooks
2. Remove the shared type, the engine function, the service-internal `PredictedGameResult.tension` field, the service callsites, the UI panel, the CLI block, and any orphaned imports. The compile error after removing the shared type is the surest tripwire — fix every TypeScript error rather than silencing.
3. Strike the manual-verification items in `prediction-engine.md` that test the tension flag (recorded as Step 8 doc edit).
4. Tests verify:
   - `PredictedGameResponse` shape no longer includes `tension`
   - Predict endpoint behavior is unchanged for the predicted score itself
   - No regressions in the readiness widget, score breakdown, or sort order
   - No file in web/cli still references `RevealedPreferenceTension` (lock-down test or a CI grep)

### Step 7: Display polish (web + CLI) and sort-mode preservation

**Files**:

- `packages/web/components/score-breakdown.tsx`
- `packages/cli/src/output.ts`
- `packages/web/app/collection/page.tsx` (verify sort modes still work)
- Any tests that pin breakdown rendering

**Addresses**: REQ-TAXIS-11, REQ-TAXIS-12, REQ-TAXIS-13
**Expertise**: frontend accessibility (verify the new source label has parity styling)

What to do:

1. Web: ensure the source column renders `tournament` with the same visual treatment as `personal` and `bgg`. Add styling/labeling alongside existing entries; do not introduce a third visual category beyond what's needed.
2. Web: verify the breakdown row for a `null`-valued tournament axis renders as "not rated" using the same UI treatment as any other unrated axis.
3. CLI: `formatBreakdown` already prints `entry.source` raw. Confirm output reads correctly with the new value. Adjust column width if needed.
4. Verify (no code change expected) that:
   - Standalone tournament rank display (REQ-TOURN-10) still renders — REQ-TAXIS-12.
   - Collection list still supports sorting by tournament rank and by fitness independently — REQ-TAXIS-13. With tournament folded into fitness, the two sorts will diverge whenever non-tournament axes carry weight; both orderings remain informative. Add an explicit test of this divergence.

### Step 8: Documentation supersessions

**Files**:

- `.lore/specs/tournament/tournament-ranking.md`
- `.lore/specs/fitness/prediction-engine.md`
- `.lore/designs/mvp-data-model.md` (reconcile source enum)
- `.lore/designs/mvp-fitness-model.md` (reconcile source enum)
- `.lore/specs/fitness/utility-curves.md` (note tournament native scale, if applicable)

**Addresses**: REQ-TAXIS-15, REQ-TAXIS-17 (doc half), and the strike items from Steps 5/6
**Expertise**: none

What to do:

1. `tournament-ranking.md`:
   - Add a supersession note at the top of "Key Decision: ELO and Axis Fitness Are Peers, Not Parent-Child" pointing to `.lore/specs/tournament/elo-axis-source.md`. Keep the section visible but mark it superseded.
   - Mark REQ-TOURN-18 superseded with a pointer to REQ-TAXIS-14.
   - Strike the manual-verification item "Trigger divergence flag by rating a game highly on axes but consistently losing in comparisons."
2. `prediction-engine.md`:
   - Mark REQ-PRED-16, REQ-PRED-17, REQ-PRED-28 superseded with a pointer to REQ-TAXIS-16.
   - Replace the line-234 constraint ("does not predict tournament ELO scores") with a note that tournament axis is now a prediction target per REQ-TAXIS-17, while REQ-PRED-15 (stability factor) and REQ-PRED-18 (silent inactivity) are unaffected.
   - Strike the manual-verification items that test the tension flag.
3. `mvp-data-model.md`:
   - Update the `Axis.source` union to `"personal" | "bgg" | "tournament"`.
   - Add a row to the default-axis table for "Tournament" with `source: "tournament"`, `bggField: null`, value derivation note.
4. `mvp-fitness-model.md`:
   - Update `FitnessBreakdownEntry.source` union to match code (`"personal" | "bgg" | "override" | "predicted" | "tournament"`).
5. `utility-curves.md`:
   - If the native-scale table is per-source, add an entry for `tournament` (1-10, identical to personal). If utility curves don't apply to tournament axes, state that explicitly.

### Step 9: Validate against spec

**Files**: none (verification step)

**Addresses**: AI Validation default ("Code review by fresh-context sub-agent") and the implicit requirement-coverage check
**Expertise**: fresh-context sub-agent (no other context loaded)

Launch a sub-agent that:

1. Reads `.lore/specs/tournament/elo-axis-source.md`.
2. Reviews the implementation across `packages/shared`, `packages/daemon`, `packages/web`, `packages/cli`.
3. Walks the Success Criteria checklist and verifies each item is met or explains why not.
4. Specifically confirms:
   - Singleton enforcement is enforced (Zod + endpoint).
   - Migration is idempotent.
   - Profile cache is invalidated on migration.
   - Divergence flag and tension surface are gone — no orphaned types, components, CSS, or callsites.
   - Existing fitness tests still pass with the new axis present.
   - Sorting by tournament rank and by fitness produce divergent orderings on a constructed test collection.

This step is not optional. Spec validation catches requirement compliance but misses integration gaps; the validator must also exercise the runtime, not only read the diff.

## Delegation Guide

Steps requiring specialized expertise:

- **Step 4 (prediction engine)**: code review by fresh-context sub-agent. Feature-vector dimension changes are subtle; predicted-tournament-axis adds a new code path through k-NN that needs an outside read.
- **Step 6 (tension surface removal)**: code review by fresh-context sub-agent. Response-shape change touches every client helper; the CLAUDE.md lesson on response-shape changes applies directly.
- **Step 7 (display)**: light frontend review for accessibility/parity (label clarity, column width, "not rated" treatment).
- **Step 9 (spec validation)**: fresh-context sub-agent that reads only the spec and the diff.

Consult `.lore/lore-agents.md` (if it exists) for available domain-specific agents. As of this plan, the project has no agent registry; default Claude Code sub-agents apply.

## Open Questions

These do not block starting. Resolve during implementation or in a follow-up.

1. **Default tournament axis weight (REQ-TAXIS-5, [STUB: axis-weight-defaults])**. Plan ships with 30. Reasoning: parity with the BGG-axis tier (Community Rating: 10, Complexity: 20, BGG averages around that range), neither dominant nor invisible. If the user has a stronger prior, override before merge. The stub remains open for a system-axis-wide default-weight policy.

2. **Profile-engine `computeDivergence` survival**. The collection-profiling spec consumes an "ELO vs axis-score gap" signal that becomes structurally different once tournament is an axis (because the axis fitness now _includes_ tournament, so the gap collapses toward zero by construction). REQ-TAXIS-14 only supersedes the _game-detail_ divergence flag (REQ-TOURN-18); the profile-engine path is left in place. A separate follow-up should reframe collection-profiling's divergence consumer; flag this for a `/specify` cycle after this plan lands.

3. **Editable non-personal axes ([STUB: editable-non-personal-axes])**. The user cannot delete or re-weight the auto-created tournament axis through this spec. Acknowledged and stubbed. Track as a follow-up issue.

4. **utility-curves and tournament axis**. Whether utility curves can be applied to tournament axes (the same way they map BGG raw values into 1-10) is not addressed by the spec. Default behavior: no curve, identity passthrough on the already-normalized 1-10 ELO. If a user-defined curve over tournament values is desired later, that's a separate spec.
