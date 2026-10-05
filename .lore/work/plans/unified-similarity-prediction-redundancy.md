---
title: "Implementation plan: unify prediction and redundancy similarity"
date: 2026-10-04
status: approved
tags: [plan, prediction, redundancy, jev, similarity, cache, privacy, wishlist]
modules: [daemon-services, prediction, redundancy, jev-cache, wishlist, shared-contracts]
related: [.lore/work/design/unified-similarity-prediction-redundancy.md, .lore/reference/specs/fitness/prediction-engine.md, .lore/reference/specs/fitness/redundancy-scoring.md, .lore/reference/specs/features/wishlist.md, .lore/reference/specs/current/owner-game-notes.md]
---

# Implementation plan: unify prediction and redundancy similarity

## Authorization and implementation impacts

This is the **user-approved implementation plan**, subordinate to `.lore/work/design/unified-similarity-prediction-redundancy.md` and Beads epic `shelf-judge-bs1y`. The user authorized creating all seven bounded phase issues now; that scheduling authorization does not start implementation, claim an issue, or waive its gate. Execute phases strictly in order, 1 → 2 → 3 → 4 → 5 → 6 → 7; each phase is one bead/checkpoint with an independent tester gate. Complete and commit each phase before starting the next. There is no parallel phase work. Phase 6 is one atomic activation checkpoint; do not split its production switch across beads/deployments.

User-approved user-visible and numerical impacts:

- Neighbors, confidence, predicted scores, redundancy and ordering may change under shared factual+cached-JEV similarity; prior fixtures are not guaranteed calibration.
- Current wishlist responses intentionally stop using stale saved-derived scores as current fallback. Historic storage remains, but no-source entries may show `missing-source` until explicit refresh.
- Note-derived/transitively note-dependent results are fenced on revocation, including ranking and wishlist order.

## Shared phase rules

- Treat the linked approved design as normative for R1–R13; do not reopen the accepted formula, settings, scopes, lifecycle, privacy, budget, or performance choices. Stop only for a concrete source/permission/caller contradiction that the design explicitly says is unresolved.
- Before phase 6, implement only new, separately named staged modules/functions/types/schemas and isolated adapters. Do not edit or replace currently loaded prediction/redundancy functions, exported v1 proof validators, active shared response types, live route validators, page bindings, or CLI commands. Tests of staged behavior import the staged module directly. Existing production regression tests after phases 2, 4, and 5 must prove active output/contracts remain unchanged. Phase 6 alone atomically replaces every old production binding, switches public proof/API validation and clients, and removes old divergent helpers. No permanent toggle or runtime dual algorithm is introduced.
- New tests must be called out as new; existing paths below have been checked. Daemon durability tests use synthetic data, temporary filesystem and real SQLite, with fake provider transports. Playwright route tests mock daemon responses and validate client behavior only; they do not prove SQLite or daemon durability.
- Before beginning phase 1 implementation, create or switch to a dedicated non-default working branch; proposed name `feat/unified-similarity-prediction-redundancy`. Before each phase, verify its bead is authorized/ready and claim it. After the phase's validation and independent test gate pass, create one local checkpoint commit containing only that bead's implementation/tests and relevant Beads update, with the bead ID in the commit message, before starting the next phase. If validation or commit is blocked, stop and report it; do not continue to the next phase. If a phase produces no file changes, update its bead status without an empty commit. Do not push, merge, or sync remotely without separate authorization.
- Implementation owner writes code/focused tests; an independent tester runs each phase gate and adversarial cases; a separate Bun/TypeScript reviewer reviews proof/publication after phase 2 and atomic production wiring after phase 6. The designer owns phase 5's isolated current-projection view model/component and interaction/copy preparation, and phase 6 page binding/final copy within existing surfaces. Daemon/shared-contract/CLI mechanical wiring is the implementation owner's lane using designer-approved terminology. Phase 7 designer review confirms integration did not flatten or contradict the agreed existing-surface design; it does not replace designer implementation ownership.

## Phase 1 — Baseline, shared math, and settings assembler

**Goal.** Verify the starting contracts and add the common pair calculation as inert code without changing production output.

**Prerequisites.** This approved plan/design and the authorized phase-1 bead. Before any implementation, create/switch to the dedicated branch `feat/unified-similarity-prediction-redundancy` (or an already-existing compatible dedicated non-default branch for this sequence). Read current references named in `related`, record actual caller/settings/proof paths and focused test/counter baseline. Verify the checkout is not the default branch and the phase bead is claimed.

**Implementation steps.**

1. Add a new `packages/daemon/src/services/unified-similarity.ts` module that calls existing exported factual Jaccard/normalized-Manhattan helpers from `feature-vector.ts` and applies stored `RedundancySettings.componentWeights.binary/continuous` as `F = 1 - (b*jaccardDistance + c*normalizedManhattanDistance)/(b+c)`. Preserve arbitrary ratios (default 4:3) and model the existing `stored-source-revision.ts` zero/zero-to-default and personal-axis stripping behavior; do not edit either active module/helper or hardcode 4/7,3/7 settings.
2. In that new module add separately named inert common pair-component/similarity functions using available F/D/O values, existing semantic weights and exact missing-component normalization. Represent all-unavailable as typed unavailable/null. Tests import this new module directly. Do not change active prediction/redundancy exports or call paths.
3. Assemble one captured in-memory `SimilaritySettings` from existing `redundancy-settings.json` settings and `collection.semanticRedundancy.settings`. Do not add persistence, migration, new prediction weights or per-consumer defaults. Confirm semantic `enabled` and cached-note permission meanings against current source.
4. Baseline-verify phase-7/focused tests and the performance fixtures described under phase 7 before changing assertions.

**Ownership / dependency.** Daemon math and settings helpers; tests can run independently. This shared math contract is a prerequisite for all later phases. No production wiring.

**Deliverable/checkpoint.** Inert new module plus tests; active functions, production output and stored files remain unchanged. Tester compares existing production output before/after as well as exercising staged helpers. After all evidence passes, commit only phase-1 files and relevant phase-1 Beads change; commit message includes the phase-1 bead ID. Do not start phase 2 before that verified commit.

**Focused validation.**

```sh
bun test packages/daemon/tests/feature-vector.test.ts packages/daemon/tests/redundancy-engine.test.ts packages/daemon/tests/redundancy-integration.test.ts packages/daemon/tests/services/stored-source-revision.test.ts packages/daemon/tests/services/unified-similarity.test.ts
```

Extend existing suites or add a clearly identified `packages/daemon/tests/services/unified-similarity.test.ts`; prove default and 1:3 values, settings round-trip/restart, available-zero vs missing, partial normalization, all-unavailable sentinel, and personal/tournament-feature exclusion. Also prove that toggling only `RedundancySettings.enabled` does not change prediction similarity.

## Phase 2 — Source-only capture, cache resolver, proof v2, revocation fence

**Goal.** Build new, directly testable cache/source/proof/privacy components while leaving current proof validators, production publication behavior, and revocation wiring unchanged. Source eligibility must not depend on predicted fitness or redundancy output.

**Prerequisites.** Phase 1 passed its independent gate and has its bead-ID checkpoint commit. Read current `jev-run-scope.ts`, `jev-run-source-adapter.ts`, `jev-run-pair.ts`, `jev-pair-read-service.ts`, `jev-pair-read-proof.ts`, `jev-prediction-capture-identity.ts`, `displayed-fitness-service.ts`, and `jev-owner-note-revocation.ts` before writing separately named staged replacements.

**Implementation steps.**

1. Add `packages/daemon/src/services/staged-similarity-capture.ts` to capture immutable raw collection/BGG facts, actual tournament labels, private note/provenance, prediction/semantic settings, permissions, cache revision and monotonic source/mutation identity. Do not change existing `jev-run-source-adapter.ts` or include prediction results/current scores/redundancy eligibility in source authorization.
2. Add `packages/daemon/src/services/prepared-similarity.ts` with `PreparedSimilarity`: indexed cache-only `resolvePairs`, canonical unordered pair memo/vector reuse, `similarity(pair): number | null`, `sealProof()`, `isCurrent()`, and rejection of post-seal expansion. Keep consumer/axis out of raw judgment identity; key by collection/domain, canonical members and signal/subkey. Reuse existing cache/read-proof APIs without changing their production callers.
3. Validate raw-row source/permission independently from fitness eligibility; use indexed point reads and live source/permission checks, never full-cache enumeration. Preserve raw JEV rubric/version and weight-independent judgments.
4. Define `SemanticScoringInputProofV2Schema`/type and `SIMILARITY_ALGORITHM_VERSION = "unified-jaccard-manhattan-jev-v1"` in a new `packages/shared/src/semantic-scoring-input-proof-v2.ts`. Do not replace or extend the currently exported `SemanticScoringInputProofSchema`, v1 types, validation acceptance, or index exports in this phase. Direct staged tests import the v2 module. Durable identity covers factual context, actual labels/tournament and prediction settings, common settings, permissions, demanded pairs, every examined component availability and validated row identity. Process epoch, live change token and cache mutation revision are fences only, not durable identity.
5. Add `packages/daemon/src/services/staged-similarity-publication.ts` with pure staged publication/revocation predicates and test harnesses. Do not modify active `displayed-fitness-service.ts`, `jev-owner-note-revocation.ts`, or production persistence/publication functions. Model fence-before-cleanup, redundancy-off/pending/restart and shared C/D dependency at O=0, plus transitive neighbor/score/confidence/redundancy/order dependencies. A changed source requires whole recapture/recompute or unavailable; no stale-result subtraction. Keep v1 acceptance behavior and production output unchanged until phase 6.

**Ownership / dependency.** Staged v2 schema/helper is separately named and directly imported by tests; the existing shared exported v1 proof contract and validators remain untouched. Resolver/revocation helpers are not wired into active production. Phase 3 uses this staged interface; no downstream phase may silently alter current output.

**Deliverable/checkpoint.** New cache-only resolver, deterministic v2 proof and isolated fence/revocation tests; existing production proof/output regression tests pass unchanged. Tests for new behavior import staged module functions directly, not changed production service factories. Bun/TypeScript reviewer examines identity completeness/private-data boundary; independent tester covers source mutations, read-proof reuse, unchanged active output and revocation scenarios. Commit only phase-2 files and relevant Beads change after gates pass; stop if validation/commit blocks phase 3.

**Focused validation.**

```sh
bun test packages/daemon/tests/jev-pair-read-proof.test.ts packages/daemon/tests/jev-pair-coverage.test.ts packages/daemon/tests/services/jev-pair-read-service.test.ts packages/daemon/tests/services/jev-pair-cache-service.test.ts packages/daemon/tests/services/displayed-fitness-scoring-proof.test.ts packages/daemon/tests/services/collection-mutation-service.test.ts packages/daemon/tests/services/semantic-display-artifact-lifecycle.test.ts packages/daemon/tests/services/staged-similarity-proof.test.ts packages/daemon/tests/services/prediction-service.test.ts packages/daemon/tests/services/displayed-fitness-service.test.ts
```

Add/extend assertions for deterministic cross-restart identity, relevant source/settings/permission/cache mutation invalidation, unchanged proof 0 rereads, all examined availability binding, sealed no-expansion, source validation independent of fitness, stale publication unavailable/recompute, revoked shared C/D at O=0, and no note leakage in proof/payload.

## Phase 3 — Exact prediction/redundancy demand and frozen run scope

**Goal.** Implement pure P/R/U0 scope plumbing with an injected deterministic fitness fixture. This phase proves membership/authorization only; it does not claim integration with the new predictor or prove real similarity-to-fitness-to-redundancy execution.

**Prerequisites.** Phase 2 passed its independent gate and has its bead-ID checkpoint commit. Verify actual caller target selection in `prediction-service.ts`, `displayed-fitness-service.ts`, `collection-snapshot-service.ts`, `wishlist-run-preparation.ts` and JEV run composition. Do not broaden semantics during this inspection.

**Implementation steps.**

1. Extract actual personal/tournament labels/readiness from captured sources. Define P as each target needing prediction × each reference actually rated on that axis, for each such axis; exclude self, include genuine previously-owned rated refs, never use factual top-K or predicted labels.
2. Collection full-list/snapshot P contains non-previously-owned targets missing at least one actual axis; explicit target-list contains only requested eligible targets; `predictGame` contains one target. Wishlist P contains selected wishlist candidates × actual rated local collection refs (including previously-owned). Local-member tags do not impose an ownership gate; acquisition-controlled bridge stays as is. Owned-local cache-only wishlist prediction never authorizes collection inference.
3. Add pure demand/freeze functions to new `packages/daemon/src/services/staged-similarity-scope.ts`. Resolve P from a supplied cache-only result and accept an injected deterministic fitness/eligibility fixture to derive R. Freeze `U0 = dedup(Pscope ∪ Rscope)`, preview disclosure and authorization. Execute only frozen U0; newly eligible pairs require a later preview/run. Completion means frozen authorized scope is complete, not global coverage. Do not call the currently active factual predictor or claim the new predictor pipeline is integrated here.
4. Keep semantic source proof valid independent of fitness. Bind config/policy/selection/mutation generation into frozen authorization separately from raw judgment identity; cache coverage growth cannot expand authority.
5. Freeze the named phase-4 staged predictor interface (for example `computeUnifiedPrediction` in the new `unified-prediction.ts` module) and typed boundary for phases 4/5: captured collection/tournament/prediction settings, target identity, actual per-axis references, prepared pair resolver, and pre-redundancy current prediction result/unavailable state. Phase 4 will implement the predictor and integrate real P→cache-only pair resolution→fitness→R; phase 5 consumes that single implementation. This is internal, not a public response-schema change. Phase 3 scope tests use only the injected fake fitness fixture.

**Ownership / dependency.** Daemon run-scope/preparation and proof identity. Phase 3 remains internal/unwired, no live inference scope changes.

**Deliverable/checkpoint.** Exact pure scope derivation and immutable preview/run input with tests using explicit synthetic ratings and injected deterministic fitness; no real predictor integration claim. Independent tester verifies request/ownership/axis boundaries and frozen authorization; phase 4 must separately pass the actual numeric pipeline gate. Commit only phase-3 scope/plumbing files and relevant Beads change after gates; do not start phase 4 if blocked.

**Focused validation.**

```sh
bun test packages/daemon/tests/services/jev-run-scope.test.ts packages/daemon/tests/services/staged-similarity-scope.test.ts packages/daemon/tests/services/jev-run-pair.test.ts packages/daemon/tests/jev-run-composition.test.ts packages/daemon/tests/jev-run-budget.test.ts packages/daemon/tests/wishlist-candidate-read-proof.test.ts packages/daemon/tests/wishlist-jev-phase7.integration.test.ts
```

With injected deterministic fitness, prove exact P for each caller, rated-axis-specific references, self-exclusion, previously-owned genuine refs, unscored/vetoed sources included in P but not R, wishlist-specific scope, exact deduplicated P∪R including overlap, cache coverage cannot expand authorized U0, source mutation invalidates preview, and later-needed pairs require a new preview. These tests validate scope only, not prediction results or real P→fitness→R integration.

## Phase 4 — Collection prediction/redundancy adapters (internal)

**Goal.** Prepare collection consumers to use the common resolver without exposing a mixed production path.

**Prerequisites.** Phase 1–3 gates and checkpoint commits pass. The phase-3 target-scope contract, injected-fitness test boundary, and named `computeUnifiedPrediction` interface are frozen. Phase 4 is sequentially before phase 5; do not start phase 5 until phase 4 is tested and checkpointed.

**Implementation steps.**

1. Add new `packages/daemon/src/services/unified-prediction.ts` with the single staged `computeUnifiedPrediction` implementation. Reuse pure vector/readiness helpers where possible, but leave `prediction-engine.ts` exports and `computePredictedFitness` unchanged. Preserve axis-specific k/minimum thresholds, estimator `sum(rating²*S)/sum(rating*S)`, confidence/readiness, self-exclusion, actual-only labels and no feature leakage.
2. Add new `packages/daemon/src/services/unified-collection-pipeline.ts`: capture context, resolve P cache-only, call `computeUnifiedPrediction`, derive current fitness and then derive/resolve R. This phase proves the real numerical P→prepared cache-only resolver→shared predictor→fitness→R pipeline. Phase 3's injected-fitness tests are scope-only evidence and cannot substitute for this gate.
3. Add new `packages/daemon/src/services/unified-redundancy.ts` staged adapter/helper using common F/S, preserving current redundancy candidate/reference eligibility and penalty semantics. Leave active cosine/factual implementations in `redundancy-engine.ts` and `redundancy-factual.ts` unchanged. Matching pair/settings/evidence returns exactly the predictor's S.
4. Exercise the staged collection adapter across all production-equivalent entry-point shapes (full list, target list, snapshot, prepared list, `predictGame`, explicit BGG preview). Keep `prediction-service.ts`, `displayed-fitness-service.ts`, `collection-snapshot-service.ts` and route factories wired to old behavior until phase 6. Ordinary staged reads are cache-only; only explicit BGG preview may network.

**Ownership / dependency.** New staged collection modules and collection tests only. No modification to active service functions or wiring. Phase 5 begins only after this checkpoint and consumes this one predictor; it must not introduce a second predictor.

**Deliverable/checkpoint.** One staged shared predictor plus real staged P→cache-only→prediction→fitness→R collection pipeline; existing production callers and output remain behavior-compatible with the phase-3 baseline. New tests import staged module functions directly; production regression tests prove no active switch. Independent tester proves numeric integration, exact pair parity, no top-K/source leakage and unchanged active output. Commit this phase after its gates before phase 5 starts.

**Focused validation.**

```sh
bun test packages/daemon/tests/services/prediction-engine.test.ts packages/daemon/tests/services/prediction-service.test.ts packages/daemon/tests/redundancy-engine.test.ts packages/daemon/tests/redundancy-integration.test.ts packages/daemon/tests/services/displayed-fitness-service.test.ts packages/daemon/tests/services/collection-snapshot-service.test.ts packages/daemon/tests/routes/prediction.test.ts packages/daemon/tests/services/unified-prediction.test.ts packages/daemon/tests/services/unified-collection-pipeline.test.ts
```

Add clearly new `packages/daemon/tests/services/unified-prediction.test.ts` and `unified-collection-pipeline.test.ts` importing staged functions directly. Prove real numeric P→cached pair S→neighbor/score→fitness eligibility→R; semantic evidence changes neighbors/scores; per-axis refs and previously-owned rated refs; self/label leakage; valid-zero/missing/all-unavailable; semantic enable vs penalty enable; candidate not added to vocabulary context; confidence/readiness unchanged except S inputs. Separately run existing service/route suites and assert their active output remains unchanged from the phase-3 baseline. Do not change active call sites to pass staged tests.

## Phase 5 — Wishlist projection, shared API and client adapters (internal)

**Goal.** Implement the staged current-result projection against phase 4's sole predictor and prepare the shared/web/CLI adapters while keeping current production responses and loaded pages/commands unchanged until phase 6.

**Prerequisites.** Phases 1–4 have passed their independent gates and checkpoint commits. Phase 5 consumes phase 4's single staged predictor/pipeline. These adapters are internal/testable and are not published by production consumers before atomic activation.

**Implementation steps.**

1. Add `packages/daemon/src/services/unified-wishlist-projection.ts` consuming phase 4's `computeUnifiedPrediction` and saved verified factual fields plus current collection/tournament/settings; no BGG fetch on reads. Apply current redundancy once to current base. Keep active `wishlist-service.ts` and `wishlist-redundancy-scoring.ts` output/wiring unchanged until phase 6; keep saved facts and historic derived storage immutable on read.
2. Define staged `CurrentPredictionProjection` and `WishlistRedundancyProjection` types/schemas in new `packages/shared/src/wishlist-current-projection-v2.ts` for direct adapter tests. Available/current contains `FitnessResult` and readiness reason; unavailable/current has null result and one of `missing-source`, `source-unavailable`, `source-changed`, `no-scoring-contribution`. Keep genuine veto-zero valid. Do not yet make the new projection a required field of public `WishlistEntryReadResult`, replace existing exports/validators, or change live route validators; merge that public response contract during phase 6 activation. No historical derived fallback.
3. Implement isolated route-shape/client adapters against the eventual response shape: flat GET array remains; legacy derived fields alias current prediction or null; `/wishlist/redundancy` keeps entry/redundancy and adds prediction; add/refresh responses return the same projection. Keep adapters unconnected to live route publication and current route validators until phase 6. Test the staged projection directly and assert existing route/proxy validation and public responses remain unchanged; ensure staged/public payload shapes exclude private facts/notes.
4. Designer owns implementation of isolated `packages/web/components/wishlist-current-projection.tsx` and its view-model/test, plus interaction/copy preparation within existing visual surfaces. The implementation owner handles daemon/shared-contract/CLI mechanics using designer-approved terminology and can add an unbound CLI adapter beside `packages/cli/src/commands/wishlist.ts`. Do not bind the component to `packages/web/app/wishlist/page.tsx` or change the live CLI command output yet; actual page/command binding and final copy are phase 6. No visual redesign is in scope.

**Ownership / dependency.** Sequential phase after phase 4. Wishlist-only daemon adapters, separately named staged shared projection types/schemas, designer-owned isolated web component/view model, and unbound CLI adapter. Do not modify live response validation, route responses, loaded pages or CLI command bindings. The designer owns view-model/component and copy preparation; daemon/shared/CLI mechanics remain with the implementation owner. Tester remains independent.

**Deliverable/checkpoint.** Internal wishlist projection and staged shared types, isolated designer-owned component/view model and unbound CLI adapter. Existing live API validators/responses, loaded pages and CLI outputs remain unchanged; production regression tests prove this. Independent tester validates staged semantics and unchanged live output. Commit this phase after its gates, before phase 6.

**Focused validation.**

```sh
bun test packages/daemon/tests/wishlist-redundancy-scoring.test.ts packages/daemon/tests/wishlist-service.test.ts packages/daemon/tests/wishlist-candidate-read-proof.test.ts packages/daemon/tests/wishlist-routes.test.ts packages/daemon/tests/services/unified-wishlist-projection.test.ts packages/web/tests/wishlist-sorting.test.ts packages/web/tests/unified-wishlist-projection.test.ts packages/cli/tests/commands/wishlist.test.ts
```

Run focused route-mocked Playwright regression checks for the currently loaded pages (which must remain unchanged before phase 6); test the new isolated component/view model directly with the staged web unit suite in the command above:

```sh
(cd packages/web && env SHELF_JUDGE_E2E_FIXTURE_PORT=32111 SHELF_JUDGE_E2E_WEB_PORT=32110 bun run test:browser -- e2e/redundancy-controls.pw.ts e2e/wishlist-run.pw.ts)
```

The new staged daemon/web unit suites prove current vs unavailable vs saved-history distinction; missing JEV with sufficient F remains available; missing factual source is unavailable until explicit refresh; no BGG fetch on read; redundancy applied once; saved facts untouched; staged shape, current score/breakdown/confidence/order and unavailable-last behavior; no private evidence. The focused browser specs only prove unchanged current page behavior prior to phase 6 and mock daemon routes; they are client regressions, not staged-component or storage tests.

## Phase 6 — Atomic production activation of every consumer

**Goal.** Switch all production consumers and proof compatibility to one coherent algorithm in a single activation checkpoint; eliminate active divergent paths.

**Prerequisites.** Phases 1–5 each passed their independent gates and have bead-ID checkpoint commits. Bun/TypeScript reviewer accepts source capture, proof v2 and privacy fence. Phase-5 designer-owned isolated component/copy preparation is complete. The user-approved impact statement above remains a release constraint.

**Implementation steps.**

1. In `packages/daemon/src/index.ts`, compose source-capture/cache-only `PreparedSimilarity` before `createPredictionService`; inject the same instance/contracts into prediction, displayed fitness, collection snapshots and wishlist. Update `packages/daemon/src/app.ts` fallback/test composition to use equivalent dependencies, never factual-only divergent behavior.
2. Atomically replace active `computePredictedFitness`/similarity call bindings across `prediction-engine.ts`, `prediction-service.ts`, `redundancy-engine.ts`, `redundancy-factual.ts`, `displayed-fitness-service.ts`, and `collection-snapshot-service.ts` with the staged unified implementations. Promote v2 from `semantic-scoring-input-proof-v2.ts` and replace—not parallel-enable—the v1 public proof acceptance path in `packages/shared/src/semantic-scoring-input-proof.ts`, `types.ts`, `validation.ts` and `index.ts`; old derived v1 evidence is not accepted as v2 current proof.
3. Switch direct `routes/prediction.ts`, BGG preview capture and all wishlist routes/service responses to the shared resolver and current projection in the same activation. Add the required public `WishlistEntryReadResult` fields and runtime validation now; preserve flat array shape and redundancy wrapper shape.
4. Bind the designer-owned phase-5 component to `packages/web/app/wishlist/page.tsx` and final copy to actual loaded surfaces; bind the CLI adapter/copy into `packages/cli/src/commands/wishlist.ts` against the same current contracts. No phase-5 client binding may be exposed before this synchronized activation.
5. Ensure final `isCurrent()` check is immediately before publish with no await gap. Remove old divergent cosine/factual helpers and staged compatibility branches that could still be called in production; do not retain dual settings, a rollout toggle or mixed consumer versions.

**Ownership / dependency.** One atomic integration bead/commit boundary with service wiring, routes, shared proof validators/public types and actual web/CLI bindings. Designer owns actual page binding/final user-facing copy; implementation owner owns daemon/shared/CLI mechanical integration. Independent tester and separate reviewer stay distinct from both. No production consumer may ship before all are switched. The phase-6 bead is precreated with the others but must not be claimed/started before phases 1–5 are committed.

**Deliverable/checkpoint.** In one activation commit, every live consumer uses common S, cache-only read path and v2 proof fence; current shared response validator, pages and CLI change at the same boundary. Repeated cross-consumer comparison for same evidence/settings yields exact pair equality. Independent tester exercises full call graph, reviewer checks construction order/privacy/no live legacy path, designer confirms current-surface implementation/copy. Commit only phase-6 changes plus its bead update after all gates; blocked validation/commit stops phase 7.

**Focused validation.**

```sh
bun test packages/daemon/tests/semantic-production-wiring.test.ts packages/daemon/tests/routes/prediction.test.ts packages/daemon/tests/services/prediction-service.test.ts packages/daemon/tests/services/displayed-fitness-service.test.ts packages/daemon/tests/services/collection-snapshot-service.test.ts packages/daemon/tests/wishlist-jev-phase7.integration.test.ts packages/daemon/tests/wishlist-routes.test.ts packages/daemon/tests/wishlist-service.test.ts
```

Prove production composition—not just helpers—uses the resolver for list/target/snapshot/individual prediction, redundancy, wishlist, BGG preview and direct prediction route. Assert ordinary reads cause zero gateway/refresh calls; revoked note-dependent output is unreadable with cleanup pending/failing, after restart and with redundancy disabled; recapture recomputes full top-K; unauthorized/missing source returns unavailable; no response exposes notes.

## Phase 7 — Durability, performance, authority reconciliation, and final gates

**Goal.** Verify real storage/run behavior, preserve established performance guarantees, reconcile current reference authority, and complete independent validation.

**Prerequisites.** Phase 6 atomic activation passes focused gates. No reference changes are part of this plan-writing session; these future edits require approved implementation scope.

**Implementation steps.**

1. Extend `packages/daemon/tests/wishlist-jev-phase7.integration.test.ts`, `semantic-production-wiring.test.ts`, `jev-run-composition.test.ts` and `services/jev-pair-cache-service.test.ts` as needed. These daemon tests use synthetic data, temporary filesystem, real SQLite and injected fake BGG/provider transports; verify atomic judgment+progress, cancellation/source fences, serial max concurrency 1, all-hit zero gateway, revocation and restart/reopen. Browser tests remain route-mocked and do not substitute.
2. Preserve performance evidence exactly: 7 encodes for 12 relevant pairs; 4×3 indexed comparisons; `wishlist-candidate-read-proof.test.ts:241-266` has a 124-member eligible-owned set and 3 candidate + 3 owned membership probes across 3 validated rows (six total, constant per row); unchanged proof has zero rereads; one pair/signal memoized; no full-cache scan; all-hit zero gateway; serial concurrency 1; one atomic checkpoint. The 124 is set size, not probe count. Add deduplicated P∪R operation-count assertions. Do not substitute latency-only thresholds.
3. Reconcile exactly four current refs: `.lore/reference/specs/fitness/prediction-engine.md`, `.lore/reference/specs/fitness/redundancy-scoring.md`, `.lore/reference/specs/features/wishlist.md`, `.lore/reference/specs/current/owner-game-notes.md` against the linked design. Preserve approved historical JEV redundancy, contract amendments, wishlist design and SQLite cache rationale. Where appropriate, add named supersession/authority notices without erasing approved history. Do not broaden to other references.
4. Independent tester reruns focused changed suites and real daemon durability/revocation cases. A separate Bun/TypeScript reviewer reviews phase-6 activation and proof/publication. Designer independently confirms that phase-6 page binding/copy preserves the phase-5 approved view model and existing-surface intent; this is a design review gate, not a substitute for the designer's phase-5/6 implementation ownership.

**Deliverable/checkpoint.** Evidence record covers all phases, full references reconciled, reviewer/tester/designer acceptances and final suite green. Commit the phase-7-only work with its bead ID. Keep these documents approved; implementation does not change their status automatically.

**Focused validation.**

```sh
bun test packages/daemon/tests/wishlist-jev-phase7.integration.test.ts packages/daemon/tests/semantic-production-wiring.test.ts packages/daemon/tests/jev-run-composition.test.ts packages/daemon/tests/services/jev-pair-cache-service.test.ts packages/daemon/tests/wishlist-candidate-read-proof.test.ts
```

Final root gates (from root `package.json`):

```sh
bun run test
bun run typecheck
bun run typecheck:browser
bun run lint
bun run format:check
bun run build
(cd packages/web && env SHELF_JUDGE_E2E_FIXTURE_PORT=32111 SHELF_JUDGE_E2E_WEB_PORT=32110 bun run test:browser)
```

The last command runs the **complete, unfiltered** browser suite and is mandatory in addition to `bun run test`; unit/integration tests do not replace it. Browser suite uses ports 32111/32110 and mocked daemon route fixtures. Daemon integration uses isolated temporary filesystem, real SQLite and fake providers. No live provider, host database, personal note data, or unspecified ports.

## Dependency and ownership map

| Phase | Depends on | Primary ownership lane | Gate before dependent work |
|---|---|---|---|
| 1 | User approval | Dedicated non-default branch; daemon math/settings helpers | Formula, ratios, zero/missing and compatibility; baseline recorded; bead-ID commit |
| 2 | 1 committed | Staged proof + daemon cache/privacy | Proof/source/revocation reviewer, unchanged production regression, bead-ID commit |
| 3 | 2 committed | Pure daemon run scope/authorization with injected fitness | Exact P/R/U0 scope-only gate, bead-ID commit |
| 4 | 3 committed | Staged shared predictor + real collection numeric pipeline | Independent tester proves P→cache-only→shared predictor→fitness→R; active production unchanged; bead-ID commit |
| 5 | 4 committed | Staged wishlist projection; designer-owned isolated web view/component; unbound CLI adapter | Independent tester proves staged contract and unchanged active production; bead-ID commit |
| 6 | 5 committed; approved impacts recorded | Atomic production composition across daemon/shared/routes/loaded clients | Single activation commit; full call graph and independent tester/reviewer/designer gates |
| 7 | 6 committed | Durability evidence and four named reference reconciliations | All final gates, independent authority review and bead-ID commit |

## Structural review findings recorded

- **SR01 — sequence/branch/checkpoints:** phases now run strictly 1→7; create/switch a dedicated non-default branch before phase 1 work; each verified bead is committed with its ID and only its files before the next starts; blockers stop the sequence; no empty commits or remote operations without authorization.
- **SR02 — staged vs live code:** phases 1–5 add only new named inert modules/types/schemas/adapters and directly test them. Existing production functions, v1 proof validators, public route validators, loaded web pages and CLI commands remain unchanged, with regression tests after phases 2, 4 and 5. Phase 6 replaces all live bindings/contracts/clients in one activation commit and removes the old path; no permanent toggle or runtime dual algorithm.
- **SR03 — design ownership:** designer owns phase-5 isolated current-projection view/component and copy preparation, then phase-6 actual page binding/final copy. Daemon/shared/CLI mechanics stay with implementation owner using approved terms; phase-7 design review does not replace design implementation.
- **SR04 — real pipeline evidence:** phase 3 uses injected deterministic fitness only to prove pure P/R/U0 scope and explicitly makes no real-predictor claim. Phase 4 implements the sole staged predictor and proves real P→cache-only resolver→prediction→fitness→R numeric integration. Phase 5 consumes that predictor after phase 4's verified checkpoint; no duplicate predictor or parallel phases.

This is a phase/checkpoint sequence, not a task checklist. The user authorized all seven phase beads and implementation; this administrative action creates the beads but does not claim or begin phase 1. Follow the branch/checkpoint rules above when execution starts.
