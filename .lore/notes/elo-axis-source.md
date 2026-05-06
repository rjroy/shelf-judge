---
title: "Implementation notes: tournament axis source"
date: 2026-05-05
status: complete
tags: [implementation, notes, tournament, axis, fitness, elo]
source: .lore/plans/tournament/elo-axis-source.md
modules: [shared, daemon, web, cli]
---

# Implementation Notes: Tournament Axis Source

## Summary

Tournament becomes a third axis source alongside `personal` and `bgg`. Each collection auto-creates exactly one tournament axis on first load (idempotent migration, profile + wishlist caches invalidated). Per-game value derives from the existing `deriveDisplayStats(...).normalizedScore`, which already encodes the < 5-game cohort floor. Fitness composition picks it up automatically; the prediction engine treats it as both a target and an input. The REQ-TOURN-18 game-detail divergence flag and the revealed-preference tension surface (REQ-PRED-16/17/28) are removed because their motivating contradictions collapse once tournament is folded into fitness. Standalone tournament rank surface (REQ-TOURN-10) and the independent tournament/fitness sort modes are preserved.

Nine phases. Two non-trivial divergences from the literal plan, both recorded below. Final test result: 1234 pass / 1 pre-existing skip / 0 fail. Typecheck clean. Spec validation: every REQ-TAXIS-1..17 met with file:line evidence.

## Progress

- [x] Phase 1: Extend type system and validation in `packages/shared`
- [x] Phase 2: Collection migration and tournament-axis auto-creation
- [x] Phase 3: Wire tournament axis values into fitness composition
- [x] Phase 4: Prediction engine — predict tournament axis values
- [x] Phase 5: Remove REQ-TOURN-18 divergence flag from game detail
- [x] Phase 6: Remove revealed preference tension surface
- [x] Phase 7: Display polish (web + CLI) and sort-mode preservation
- [x] Phase 8: Documentation supersessions
- [x] Phase 9: Validate against spec

## Log

### Phase 1: Type system and validation

- Touched: `types.ts`, `validation.ts`, `curve-math.ts`, `fitness-service.ts` (sourceOrder Record only), and added `validation.test.ts` / `curve-math.test.ts` test cases.
- TypeScript strict compiles clean: no other call site forced an exhaustiveness branch. Sites that match `source === "personal"` or `source === "bgg"` silently drop tournament — Phases 3 and 4 will handle them.
- Identified now (route to later phases): `prediction-engine.ts:292` and `fitness-service.ts:49` both coerce `axis.source === "bgg" ? "bgg" : "personal"`, so a tournament axis would land in the `personal` breakdown bucket without Phase 3/4 wiring.
- Tests: shared 110/110, fitness/axes 76/76 pass. Review pass: clean.

### Phase 2: Collection migration and auto-create

- New: `collection-migration.ts` with `ensureTournamentAxis`. New: `collection-migration.test.ts`.
- Edited: `storage-service.ts` (createDefault routes through migration helper, loadCollection runs migration after legacy backfill, atomic-writes the migrated file, deletes profile.json, clears wishlist prediction fields). `axis-service.ts` (singleton enforcement). `file-ops.ts` (added `unlink`, swallowing ENOENT). `index.ts` (boot-time await on `loadCollection()` at `packages/daemon/src/index.ts:33`).
- Singleton enforcement landed in `axisService.createAxis`, not the route handler. The route already maps `ValidationError` → 400 `{ error: err.message }`, so wire format unchanged. Departure from plan literal text but matches existing project pattern.
- Wishlist invalidation extended beyond the plan's listed fields: also clears `predictionConfidence` and `nicheImpact`. They are stale-correlated with the predicted score and breakdown — recorded as a pre-emptive divergence.
- Tests: 1211 pass / 1 pre-existing skip / 0 fail. Typecheck clean. Lint has one pre-existing error in `.lore/.design-input/...` (gitignored area, unrelated).

### Phase 3: Fitness composition

- `fitness-service.ts` `calculateScore` accepts `tournamentData?: TournamentData | null`; tournament branch calls `deriveDisplayStats` (now exported from `tournament-service.ts`). Null normalizedScore follows the same path as an unrated personal axis. 5 callsites updated (game-service ×1, prediction-service ×4).
- 7 new tests in `fitness-service.test.ts` cover 5+ cohort, < 5 cohort, zero comparisons, provisional games, null/missing tournamentData, and weighted-average composition.
- Surfaced a real first-time-load race: `loadTournament` and `loadCollection` use a single fixed temp path per file (`atomicWrite`); two concurrent first-time callers can both write to the same `.tmp` and race on `rename`. Adding `loadTournament` into game-service made it surface. Fixed by adding an in-flight load lock in `storage-service.ts` (per-file, errors propagate). Confirmed regression: removing the lock makes the new concurrency tests fail with 2 writes / divergent IDs; restoring it passes.
- Cleaned up two now-redundant in-caller workarounds: `prediction-service.ts` `loadPredictionContext` triple-loaded `tournament.json` (settings + stats + raw); now a single `Promise.all` with inline projection of stats via `deriveDisplayStats`. `game-service.ts` `getGame` and `listGames` now use `Promise.all([loadCollection, loadTournament])`. `rateGame` left sequential because the second load is after a `saveCollection`.
- Tests: 876 pass / 1 pre-existing skip / 0 fail. Typecheck clean.

### Phase 4: Prediction engine

- `prediction-service.ts`: filter fix in `gameRatings` build loop and in `getReadiness` (extends `personal` to also include `tournament` source, value pulled from `allGameStats[id]?.normalizedScore`). Vector augmentation after `resolveAxisValues` keeps the shared helper pure.
- `prediction-engine.ts`: `computePredictedFitness` per-axis branch and `assessReadiness` weak-axes filter widened to `personal || tournament`; sort `sourceOrder` includes `tournament: 2` matching fitness-service.
- `feature-vector.ts` `personalAxes` filter widened. Vector dimension grows by 1 when a tournament axis is present; missing tournament data falls back to the same 0.5 midpoint as unrated personal axes.
- Filter-fix regression test in `prediction-service.test.ts` is the load-bearing one: with the fix reverted the test fails (rating null because no reference game contributes a tournament value); with the fix it passes. Confirmed both ways.
- Profile-engine stability test: identical outlier IDs and finite composite distances before/after adding tournament axis on a 6-game fixture — guards against the `outlier-composite-null-crash` bug class.
- Tests: 886 pass / 1 skip / 0 fail. Typecheck clean.
- Low-confidence observations from review (not actioned in Phase 4): tournament-only collections can advance `ratedGameCount` past Stage thresholds (intentional per REQ-TAXIS-8 "on the same terms"); `tournamentService` dep is now dead in `createPredictionService` after Phase 3 cleanup but kept for caller stability — could be removed as a follow-up.

### Phase 5: Remove REQ-TOURN-18 divergence flag

- Discovery: surprisingly small. The REQ-TOURN-18 web banner was already removed in earlier work, leaving only the CLI display block (`packages/cli/src/commands/score.ts`) and an orphaned `.divergence-banner` CSS class (`packages/web/app/globals.css`, zero callers).
- Deleted: the CLI `[divergence]` block and the orphaned CSS. Added regression test in `score.test.ts` with a constructed (gap > 2.0, non-provisional) input that asserts `[divergence]` does not appear.
- Preserved: `profile-engine.ts:237-270` `computeDivergence` (collection-profile divergence, separate concept). The `Profile Divergence` block on `games/[id]/page.tsx:291-321` reads from this preserved path and was correctly left alone.
- Plan-anticipated daemon delta function: did not exist. Plan-cited copy strings ("higher fit"/"lower fit"/"axis ratings suggest"): did not exist.
- Phase 8 doc-strike checklist: strike "Trigger divergence flag by rating a game highly on axes but consistently losing in comparisons" from `.lore/specs/tournament/tournament-ranking.md`.
- Manual verification not performed (CLI live run, browser eyeball). Tests cover the regression target.
- Tests: 1231 pass / 1 skip / 0 fail. Typecheck clean.

### Phase 6: Remove revealed preference tension surface

- Removed: `RevealedPreferenceTension` type + re-export, `detectRevealedPreferenceTension` engine function, `TournamentRankedGame` interface (single consumer was the deleted function), the `tension` field on `PredictedGameResponse` and internal `PredictedGameResult`, the tension panel JSX in `games/[id]/page.tsx`, the `.preview-tension` block in `search/page.tsx`, all `.tension-*` and `.preview-tension` CSS selectors, the CLI `[tension]` output blocks in `predictGame`/`predictBggGame`, all related tests.
- New regression: `packages/shared/tests/no-tension-surface.test.ts` — imports the real shared module and asserts `RevealedPreferenceTension` and `detectRevealedPreferenceTension` are not exported, and that `PredictedGameResponse` instances do not have a `tension` field. Exercises the actual exports, not string literals.
- Caught two stale fixture mocks (`niche-settings-integration.test.ts`, `redundancy-integration.test.ts`) carrying `tension: null` that compiled silently because they returned via `Promise.resolve` without explicit typing — the kind of hole CLAUDE.md flags.
- Preserved: `tournamentStability` on `ReferenceGameCandidate` (Phase 4 surface), `tensions: string[]` on `ProfileNarration` (narration-service, different concept).
- Phase 8 doc-strike checklist for `.lore/specs/fitness/prediction-engine.md`: lines 27, 29, 93 (REQ-PRED-16), 95 (REQ-PRED-17), 117, 133 (REQ-PRED-28), 163, 193, 205, 225, 263, 266, 267 — all reference the removed tension surface.
- Tests: 1224 pass / 1 skip / 0 fail. Typecheck clean. Lock-down test passes.

### Phase 7: Display polish + sort-mode preservation

- `score-breakdown.tsx` `SourceBadge`: added `tournament` case reusing `source-personal` styling and a "Tournament" label. No third visual category.
- CLI `formatBreakdown` / `formatTable` already auto-pad the source column from per-row max length. No code change needed; new tests confirm `tournament` and null-rated rows render with parity.
- Sort-mode divergence test in `collection-table.test.ts`: constructed three games where fitness desc and tournament desc differ (`[a,c,b]` vs `[b,c,a]`); the `not.toEqual` assertion would fail if tournament sort were accidentally routed through fitness.
- Standalone tournament rank surface preserved (REQ-TAXIS-12): `getScoreDisplay` `case "tournament"` and CLI `Tournament Rank:` line both unchanged.
- Tests: 1234 pass / 1 skip / 0 fail. Typecheck clean.
- Manual verification deferred to a real environment: the seven scenarios captured in the Phase 7 implementer report (game-detail breakdown, predicted tournament row, collection sort menu, etc.).

### Phase 8: Documentation supersessions

- `tournament-ranking.md`: blockquote supersession on "ELO and Axis Fitness Are Peers" section (→ REQ-TAXIS-15); REQ-TOURN-18 marked superseded with the `[SUPERSEDED by ...] ~~strike~~` idiom that matches REQ-TOURN-7's existing pattern; divergence-flag manual-verification line struck.
- `prediction-engine.md`: Approach prose rewritten (axis-source framing, no tension table); REQ-PRED-16/17/28 marked superseded → REQ-TAXIS-16; REQ-PRED-23 and REQ-PRED-35c type signatures updated to remove `tension`; tension-related test/verification/AI-validation lines struck; line-234 "does not predict tournament ELO scores" constraint replaced with note that tournament IS now a prediction target per REQ-TAXIS-17 while REQ-PRED-15 and REQ-PRED-18 remain valid; Implementation Notes pruned.
- `mvp-data-model.md`: `Axis.source` union extended; Tournament row added to default-axis table.
- `mvp-fitness-model.md`: `FitnessBreakdownEntry.source` union updated to match code. Caught prior drift: `predicted` was in code (REQ-PRED-33) but missing from this design doc.
- `utility-curves.md`: added REQ-CURVE-3a documenting tournament native scale (1-10) with identity passthrough default per plan's open question 4.
- Confirmed: source spec and plan untouched.

## Divergence

- **Wishlist clearing scope expanded** — Plan named only `predictedScore` and `predictedBreakdown`. Implementation also clears `predictionConfidence` and `nicheImpact` because they are computed from the same prediction pass and against the same axis set; leaving them populated would surface a stale confidence label and stale niche impact next to a now-null score. Approved (matches the review's verification of WishlistEntry shape).
- **In-flight load lock in storage-service** — Plan did not anticipate this. Phase 3 surfaced a pre-existing latent race in `loadTournament` / `loadCollection` first-time-write path (concurrent atomic-write to a single fixed temp path, second `rename` ENOENTs). Added a per-file in-flight load lock in `storage-service.ts`. Approved: pre-existing latent bug surfaced by the new fitness-service callsite; fix is local, errors propagate, and the regression test fails without the lock.

## Phase 9 Validation

Fresh-context reviewer walked all 17 REQ-TAXIS requirements against the implementation. Every requirement met with file:line evidence. One nuance flagged but not a gap: REQ-TAXIS-3 singleton enforcement lives at the service layer (`axisService.createAxis`), not as a Zod refinement, because uniqueness depends on collection state Zod cannot see. The route maps `ValidationError` → 400 `{ error: "tournament_axis_already_exists" }` and is route-tested.

Final tests: 1234 pass / 1 pre-existing skip / 0 fail. Typecheck clean.

## Follow-ups (not blocking; record only)

- `tournamentService` dep is now dead in `createPredictionService` after Phase 3's redundant-load cleanup; kept for caller stability. Could be removed.
- Profile-engine `computeDivergence` (the collection-level "ELO vs axis-score gap") survives this plan but its semantics shift now that tournament is part of axis fitness. Plan's open question 2 calls for a separate `/specify` cycle to reframe it.
- Default tournament axis weight (30) is the plan's interim default; can be revisited when the user has stronger priors.
- Editable non-personal axes ([STUB: editable-non-personal-axes]) — user cannot delete or re-weight the auto-created tournament axis through this spec. Tracked as a follow-up.
- Manual verification deferred (browser, real CLI run): seven scenarios captured in the Phase 7 report worth eyeballing in a real environment.
