---
title: "Implementation notes: unified similarity prediction and redundancy"
date: 2026-10-04
status: in_progress
tags: [similarity, prediction, redundancy, implementation, checkpoints]
source: .lore/work/plans/unified-similarity-prediction-redundancy.md
modules: [daemon, shared, web, cli]
related: [.lore/work/design/unified-similarity-prediction-redundancy.md]
---

# Implementation notes: unified similarity prediction and redundancy

## Authorization and execution status

The user approved the linked design and seven-phase plan and authorized implementation. The execution branch is `feat/unified-similarity-prediction-redundancy`; Phase 1 is checkpointed at `c32cb3d5e63328177bcec169507f73a070c24627` from the approved-doc base `084936ca29c17c36b0e652e1173bcdc93209d3e3`, Phase 2 at `027ca1fbd88379f63a090375fccd290082fa3051`, Phase 3 at `01b159c308c2d849c6a3b8f3ca7da4ee78ac947d`, Phase 4 at `407dd789`, and Phase 5 is checkpointed with `shelf-judge-bs1y.5`. Phases 1–5 are accepted; the epic remains in progress. Phase 6 has not started.

| Phase | Status | Gate before next phase |
| --- | --- | --- |
| 1 — baseline, shared math, settings assembler | Accepted; checkpointed with `shelf-judge-bs1y.1` | Phase 1 checkpoint `c32cb3d5` verified before Phase 2 began |
| 2 — source capture, cache-only resolver, proof/revocation | Accepted and checkpointed at `027ca1f` | Phase 2 commit reconciled before Phase 3 began |
| 3 — pair scope and frozen run | Accepted and checkpointed with `shelf-judge-bs1y.3` | Phase 3 checkpoint `01b159c3` reconciled before Phase 4 began |
| 4 — staged predictor and real numeric pipeline | Accepted and checkpointed with `shelf-judge-bs1y.4` | Phase 4 checkpoint `407dd789` verified before Phase 5 began |
| 5 — staged wishlist/API/client adapters | Accepted and checkpointed with `shelf-judge-bs1y.5`; staged adapters remain inert | Independent tester/reviewer and designer gates passed; Phase 6 remains open, ready, and unclaimed |
| 6 — atomic production activation | Not started | Phase 5 verified checkpoint |
| 7 — integration, performance, authority reconciliation | Not started | Phase 6 verified checkpoint |

Every phase is sequential. A validation or commit blocker stops work before the next phase. Each verified future phase gets one local checkpoint commit containing only its bead's files and relevant Beads metadata, with the bead ID in the message. No empty commit, push, merge or remote synchronization is authorized. Neither Phase 1 nor Phase 2 acceptance authorizes production wiring.

## Initial baseline before Phase 1 changes

Branch and base commit were verified before code edits. Before adding the staged helper/test, the focused existing baseline passed:

```text
Command: bun test packages/daemon/tests/feature-vector.test.ts packages/daemon/tests/redundancy-engine.test.ts packages/daemon/tests/redundancy-integration.test.ts packages/daemon/tests/services/stored-source-revision.test.ts
Result: 123 pass, 0 fail, 519 expect() calls; 4 files.
```

Relevant existing operation-count checks also passed before edits:

- `wishlist-redundancy-scoring.test.ts`, test “one capture builds one factual context, memoizes vectors, and visits only candidate-owned pairs”: 1 pass, 9 expectations; fixture asserts one owned index, one vocabulary/range build, 7 distinct game encodes and 12 distinct candidate-owned pairs (4 candidates × 3 owners).
- `wishlist-candidate-read-proof.test.ts`, test “uses only typed candidate-domain point lookups and reuses an unchanged proof without queries”: 1 pass, 10 expectations; three initial indexed point lookups, unchanged proof checks/reuse add zero lookups, and a changed two-pair request adds exactly two.
- `wishlist-candidate-read-proof.test.ts`, test “membership proof probes stay constant as the full eligible set grows”: 1 pass, 5 expectations; 124 eligible owned members, 3 validated rows, exactly 3 candidate + 3 owned membership probes (6 total, constant per row—not 124 probes).

These are existing behavioral baselines, not claims that the staged helper is already integrated. Phase 1 must leave existing production paths and these counts unchanged.

## Phase obligations and evidence

The R1–R13 labels below are the operational obligation map for the approved design/plan; phase mapping does not imply later-phase completion.

| Obligation | Plan phase | Evidence / status |
| --- | --- | --- |
| R1 — one factual formula F and common weighted S; missing versus valid-zero semantics | 1 | Phase 1 accepted: `unified-similarity.test.ts` covers default/non-default ratios, partial normalization, valid zero and all unavailable |
| R2 — existing settings are sole weights; semantic enablement/note permission and penalty-toggle separation | 1 | Phase 1 accepted: staged settings assembly and storage round-trip/reopen; baseline covers zero/zero→4:3 and personal-axis stripping |
| R3 — prediction and redundancy exact-pair parity; same prediction algorithm | 4, then 6 | Phase 4 staged shared predictor/P-R numeric pipeline accepted; production consumer comparison remains Phase 6 |
| R4 — factual context from full collection, no personal-axis/rating leakage | 4 | Phase 4 staged collection pipeline accepted; production activation remains Phase 6 |
| R5 — purpose-specific reference pools and exact prediction eligibility | 3–4 | Phase 3 scope and Phase 4 real numeric adapter accepted; production activation remains Phase 6 |
| R6 — deduplicated, previewed, frozen authorized pair universe | 3 | Phase 3 injected-fitness P∪R/overlap/frozen-scope tests accepted; real predictor pipeline is separately in Phase 4 |
| R7 — indexed cache-only reads, pair memoization and bounded execution | 2–3, 7 | Phase 2 indexed point reads and vector dedupe plus Phase 3 frozen-scope indexing accepted; composed production performance gates remain Phase 7 |
| R8 — proof identity/currentness and source publication fence | 2, 6 | Staged V2 identity, every examined component, currentness/read/publication boundary accepted; production acceptance remains Phase 6 |
| R9 — transitive note-permission revocation and fail-closed publication | 2, 6–7 | Staged SHARED_CD/O=0, indirect wishlist artifact, cleanup-failure/restart, and whole-recompute fixture accepted; real production lifecycle remains Phase 6/7 |
| R10 — current prediction and redundancy result contracts / wishlist consumers | 5–6 | Staged API/view-model contract, designer-owned view, then atomic client binding; not started |
| R11 — no unsafe saved-derived fallback; unavailable means unavailable | 5–6 | Staged projection tests and live route/client activation tests; not started |
| R12 — explicit-run budgets, cancellation and atomic checkpoints | 2–3, 7 | Phase 3 frozen budget/source-auth contract in progress; composed daemon integration tests remain Phase 7 |
| R13 — deterministic performance, integration and named-reference reconciliation | 7 | Counter assertions, complete isolated final gates, four named authority references; not started |

## Phase 1 change boundary

Phase 1 adds only `packages/daemon/src/services/unified-similarity.ts`, its direct unit test, and this progress note. The staged module reuses `jaccardDistance` and `normalizedManhattanDistance`, receives factual binary/continuous weights from existing `RedundancySettings`, captures existing semantic weights in memory, and distinguishes unavailable values from valid numeric zero. It does not read a cache, authorize note evidence, persist settings, or change an active consumer. `RedundancySettings.enabled` remains a penalty toggle, not a generic similarity input. `semanticRedundancy.settings.enabled` and `cachedOwnerNoteUse` govern D/O inclusion; callers remain responsible for supplying only authorized, available component values. F uses the currently captured ratio (default 4:3), with no personal axes.

The production baseline is intentionally unchanged. Phase 1 acceptance requires the focused command, daemon-scoped checks, independent tester, and separate reviewer; their completed evidence is recorded below. This does not mark any future phase complete.

### Phase 1 author verification (2026-10-04)

- Focused command from the approved plan, including the new direct-import test: 130 passed, 0 failed, 537 expectations across 5 files. The same four existing files passed 123 tests / 519 expectations before Phase 1 edits; their test sources were not changed.
- The staged test covers default 4:3, persisted 1:3 after creating a fresh storage service on the same temporary directory, binary/continuous-only factual scoring despite supplied extra `personalAxes`, semantic disablement, cached owner-note permission, penalty toggle independence, available zero, partial normalization, all unavailable/all-zero weights, invalid inputs and large finite-weight normalization without overflow.
- `bunx tsc --noEmit -p packages/daemon`: passed.
- `bunx eslint packages/daemon/src/services/unified-similarity.ts packages/daemon/tests/services/unified-similarity.test.ts`: passed.
- `bunx prettier --check` on the note and two new TypeScript files: passed after formatting the new test file.
- `git diff --check`: passed. An independent tester verified the focused result (130 tests / 537 expectations) and performance evidence (17 tests / 118 expectations, including 7 encodes / 12 pairs, 124-member set with 3+3 probes, unchanged-proof 0 rereads). The separate Bun/TypeScript reviewer (`ses_efb1e3fa5ffea2mByl6YDP8AEa`) accepted Phase 1 with no findings. Phase 1 is accepted and checkpointed here; later phases remain not started.

### Checkpoint source manifest

Verified accepted implementation blobs before checkpoint staging:

| File | SHA-1 blob |
| --- | --- |
| `packages/daemon/src/services/unified-similarity.ts` | `6276c3115a7fefd52da75caf397d52ad92630661` |
| `packages/daemon/tests/services/unified-similarity.test.ts` | `a239db0434132a8aa32fa63d1f800ba41690146e` |

The implementation working-tree status at handoff had these two accepted files and this note untracked, with no staged changes. Pre-existing Beads working-tree changes are handled separately for the checkpoint; no source or test edits are included in this administrative step. This note is intentionally updated for acceptance/checkpoint status and is not covered by its own blob hash.

## Phase 2 change boundary and initial baseline

Phase 2 is limited to separately named staged capture/resolver/proof/publication modules and direct-import tests. Existing JEV cache-row validators are reused for exact current source, provenance, permission and typed pair-domain checks; the complete-coverage kernel is not reused because it derives eligibility from current prediction fitness. The capture contains raw factual/tournament/actual-label/settings and private notes in an immutable private snapshot, but it has no prediction results or fitness-derived eligibility. Proof v2 contains only opaque digests; volatile process/change/cache tokens fence currentness separately and are excluded from durable identity. All modules remain unwired; the live v1 proof contract, production service factories, current outputs and revocation path are untouched.

Before Phase 2 edits, the approved existing focused source/proof/lifecycle command passed 154 tests / 831 expectations across nine files:

```text
bun test packages/daemon/tests/jev-pair-read-proof.test.ts packages/daemon/tests/jev-pair-coverage.test.ts packages/daemon/tests/services/jev-pair-read-service.test.ts packages/daemon/tests/services/jev-pair-cache-service.test.ts packages/daemon/tests/services/displayed-fitness-scoring-proof.test.ts packages/daemon/tests/services/collection-mutation-service.test.ts packages/daemon/tests/services/semantic-display-artifact-lifecycle.test.ts packages/daemon/tests/services/prediction-service.test.ts packages/daemon/tests/services/displayed-fitness-service.test.ts
```

This baseline validates that the current v1 acceptance/publication behavior stays available while staged v2 modules are added. New Phase 2 tests use temporary directories with the existing real SQLite cache and synthetic source/provider-free fixtures.

### Phase 2 acceptance and checkpoint evidence (2026-10-04)

- After the first correction round, the independent tester reported P2-R01/R02. The author-side fixes below were followed by the approved nine-file focused command plus two direct-import staged v2 test files: **164 tests, 0 failures, 933 expectations across 11 files**. The nine existing files contributed the 154/831 baseline; the new staged capture/resolver/publication and proof-schema tests add ten tests / 102 expectations. Existing v1 acceptance and production output tests remain unchanged.
- P2-T01: added a narrow staged derived-display artifact reader bound to the complete current sealed proof and source/cache guard. A synthetic JSON artifact on temporary disk carries neighbors, prediction score/confidence/breakdown, redundancy adjustment and ordering. Tests verify unavailable read and rejected publication immediately after permission revocation, while cleanup is simulated as pending/failing; a restarted, penalty-disabled capture rejects the old artifact and accepts only a fully recomputed current artifact from remaining authorized inputs. A held staged result is checked at synchronous publication adjacency. Shared C/D C evidence remains note-dependent at O=0 in the same proof as direct wishlist C_ONLY evidence; the artifact represents a downstream owned-neighbor-to-wishlist-order dependency. This is direct staged-boundary evidence, not live production artifact integration or a real prediction pipeline.
- P2-T02: tests mutate the caller's captured collection/BGG/note/rating/axis/tournament/prediction data after capture and verify the frozen capture is unchanged; actual-axis labels, prediction settings, common weights and note permission each alter durable source identity. Examined missing, valid-zero, stale-row and changed-row states produce distinct proof identities. A C_ONLY row remains reusable with the same row identity across note-permission change while its source-bound proof identity changes.
- P2-T03: unrelated cache growth leaves deterministic content identity unchanged but invalidates the old live resolver; both old publication and artifact read are rejected. A fresh sealed resolver recaptures/recomputes the complete staged artifact, and its read succeeds with unchanged exact evidence. The assertion confirms the stale check/read path caused no additional pair/signal point reads; no inference/provider interface exists in these staged helpers.
- Fixtures use the existing real SQLite cache and temporary filesystem with synthetic facts only; no provider/network access. No production lifecycle, consumer, route, prediction result, active export, or v1 acceptance behavior is claimed or changed. The artifact projection/recompute fixture is deliberately synthetic and does not substitute for Phase 4's real prediction pipeline or Phase 6 production integration.
- P2-R01: replaced per-pair linear candidate search with one captured BGG-ID map and constant-time lookups. Domain-specific cache member identities remain unchanged; factual-vector keys now identify source members by collection/local ID or collection/wishlist-BGG ID, so a local game's factual vector is reused across collection and wishlist pair domains without sharing cache judgments. A 48-candidate × 3-local-reference staged fixture records exactly one 48-entry index build, 144 candidate map lookups, 51 distinct encodes (48 candidates + 3 local sources), and one collection pair sharing its local encodes.
- P2-R02: freeze copied component evidence and its containing evidence record before retaining it in pair results/proof examination; freeze scoring components and return readonly evidence types. Sealing rejects further pair expansion and returns a frozen proof snapshot. The shared valid-zero SHARED_CD evidence test attempts runtime mutation of value/note-dependency before and after sealing and attempts proof identity mutation; evidence, similarity and proof identity remain unchanged.
- The full approved focused suite passed with synthetic fixtures and temporary SQLite/filesystem only; no network or real provider. No production lifecycle, consumer, prediction engine, route, active export or v1 proof behavior was changed. The artifact projection remains staged evidence only and does not claim production prediction integration.
- `bunx tsc --noEmit -p packages/daemon && bunx tsc --noEmit -p packages/shared`: passed. Scoped ESLint on the six new TypeScript files: passed. Prettier check on those files and this note: passed. `git diff --check`: passed.
- Independent tester verified all P2-T01–T03 and P2-R01/R02 closed on this six-file manifest; the Bun/TypeScript reviewer accepted Phase 2 with no findings. Both gates confirmed the focused 164/933 result and R01 counters (48 indexed candidates, 144 map lookups, 51 distinct encodes across mixed domains), plus runtime-frozen evidence/proof mutation checks. This acceptance is for the staged proof/artifact boundary only; it is not production API/artifact integration, real prediction-pipeline validation, or authorization to start Phase 3 before checkpoint reconciliation.

#### Phase 2 source manifest

SHA-1 Git blob IDs for the six staged implementation/test files at the author-verification handoff:

| File | SHA-1 blob |
| --- | --- |
| `packages/daemon/src/services/staged-similarity-capture.ts` | `b55eb5fa51802d1b1133190acfe00a2d96d142fc` |
| `packages/daemon/src/services/prepared-similarity.ts` | `724c99e9338fa81aece56a85299c2ad974b7a270` |
| `packages/daemon/src/services/staged-similarity-publication.ts` | `97cf252e6c13c9a2ce8ad0584ccfbfb8f95f540a` |
| `packages/daemon/tests/services/staged-similarity-proof.test.ts` | `72e5760fd00268f96372c38250d6b2fbe1989327` |
| `packages/shared/src/semantic-scoring-input-proof-v2.ts` | `d0f7c3763d87e76aea330fbb1d50dbde49ba4829` |
| `packages/shared/tests/semantic-scoring-input-proof-v2.test.ts` | `62a5d997941f33fbf7fe1c1a84f8c34897b58572` |

The Phase 2 checkpoint consists of these six source/test blobs plus this note. No production files or active exports changed. The passive Beads export checkpoint includes only the Phase 2 record; unrelated `.beads/issues.jsonl` changes for `shelf-judge-0xhp` and `shelf-judge-uf1p` are deliberately excluded and remain in the working tree. The note's own blob is an administrative self-hash exception.

## Phase 3 staged scope and author verification (in progress)

Phase 3 adds only `staged-similarity-scope.ts` and its direct-import test. The module is not imported by production callers. It derives actual personal labels from captured game ratings and tournament labels from the existing Elo normalization/display-floor functions; readiness counts only actual rated games. It builds per-axis reference indexes, derives exact collection/wishlist P membership, resolves P cache-only through Phase 2's prepared resolver, then uses an explicitly injected deterministic fitness fixture to derive R. Collection R is limited to currently owned positive non-veto fixture scores. Wishlist pairs remain typed wishlist-candidate pairs with C-only signals; eligibility scores do not authorize local collection-domain inference. The frozen input publishes the phase-4 predictor target/reference/readiness contract, immutable U0/disclosure and a one-use internal execution authorization, but has no provider/gateway or run-controller integration.

Cache calculation freshness remains separate from source/policy/selection authorization: cache-revision growth may make the prepared proof stale, but cannot add pairs to the already frozen U0. Source capture identity, exact request selection, current policy identity, mutation generation, budget and demanded pairs are bound to the in-memory authorization identity; the live mutation generation is not persisted as durable proof identity. Missing selected targets are disclosed as unavailable instead of silently expanding scope. Token budget field is consistently a positive-safe-integer reported-token stop threshold, not a hard ceiling.

- New direct-import suite after P3-R01: `bun test packages/daemon/tests/services/staged-similarity-scope.test.ts` — **8 tests, 0 failures, 101 expectations**. Fixtures cover actual personal/tournament per-axis labels and readiness, one indexed reference-membership build, self-exclusion, previously-owned actual references, vetoed/unscored actual references in P but not R, exact collection and wishlist scopes, missing selected candidates, C-only wishlist pairs, overlap/dedup, source/cache authority separation, sealed resolver, one-use authorization, and deeply frozen pair identities during and after fitness evaluation.
- Approved focused command after P3-R01, with the Phase 7 integration test at its verified actual path `packages/daemon/tests/wishlist-jev-phase7.integration.test.ts` — **44 tests, 0 failures, 416 expectations across 7 files**. The approved plan's `services/wishlist-jev-phase7.integration.test.ts` path is incorrect; the root-level path above was run instead.
- `bunx tsc --noEmit -p packages/daemon`: passed. Scoped ESLint and Prettier checks for the two new files: passed. `git diff --check`: passed.
- Phase 3 remains strictly pure scope evidence: the injected fitness fixture does not establish real similarity-to-fitness-to-redundancy behavior; Phase 4 owns that numeric integration. No active production imports, controllers, routes, shared public schemas or predictor functions changed; tests use synthetic facts and no live provider/network.

#### P3-R01 correction record

The reviewer found that a frozen `StagedAxisPairInput` still exposed a mutable nested similarity pair to injected fitness and returned scope consumers. The scope module now uses a readonly nested pair type and creates a cloned, runtime-frozen pair at every P/R/U0 projection boundary; axis-reference records point only to that frozen object. Regression tests attempt mutation inside injected fitness and after preparation for both collection and wishlist pair identities, then confirm pair members, canonical key/resolver association, authorization identity/status, and the all-unavailable `null` similarity remain unchanged. The independent tester accepted the corrected manifest with **44 tests / 416 expectations across 7 files** (including 8 / 101 for the new scope suite); the Bun/TypeScript reviewer accepted Phase 3 and closed P3-R01 with no other findings. Daemon typecheck, scoped ESLint/Prettier, and diff checks passed. This acceptance is for pure scope with injected fitness only, not the real numeric prediction pipeline. Phase 3 was checkpointed and reconciled before Phase 4 began.

#### Phase 3 author source manifest

| File | SHA-1 Git blob |
| --- | --- |
| `packages/daemon/src/services/staged-similarity-scope.ts` | `d987312397a2b310261314aa142ef6013be10a3c` |
| `packages/daemon/tests/services/staged-similarity-scope.test.ts` | `6bcd88fbacece2007118928955c2d1754aab3d6f` |

## Phase 4 staged predictor and collection pipeline (in progress)

Phase 4 adds only the inert `unified-prediction.ts` and `unified-collection-pipeline.ts` modules and their two direct-import test files. Production prediction/redundancy engines, service factories, routes, snapshots, shared exports/proofs, and clients remain untouched. The shared predictor consumes actual per-axis labels plus the staged resolver's one S value per pair, sorts by S, honors the existing minimum-similarity and k settings, and reuses the established weighted estimate/confidence rules. The collection adapter uses Phase 3's exact P request and cache-only PreparedSimilarity, computes current pre-redundancy fitness, passes those real results to the P→R scope evaluator, then derives R and applies a staged penalty calculation only when the separate redundancy toggle is enabled. It retains the exact common S table when prediction and redundancy overlap. No caller activates these modules before Phase 6.

Phase 4 author evidence (not acceptance), with the bounded correction record:

- **P4-T01:** Redundancy eligibility now comes from typed collection pair endpoints in the frozen R pairs, not `targetIds` disclosure strings (which can be joined and can legally contain commas). The enabled-settings SQLite test covers three current owned endpoints: target 7.2 receives a 1.0 penalty (adjusted 6.2), the lower actual member 4 receives 1.0 (adjusted 3), and the higher actual member 8 receives zero. A separate threshold-with-no-neighbors case preserves the current 7.2 score with zero penalty. This catches the prior test gap where default redundancy settings were disabled.
- **P4-T02:** With actual labels and factual inputs fixed and semantic factual weight set to zero, valid cached C_ONLY zeros produce S=0, no target prediction, and only the one actual-eligible R pair. Updating those SQLite rows to valid C_ONLY ones, then doing a fresh complete run, produces target score 6.0 and three R pairs. The old prepared calculation becomes stale after cache mutation; it is not partially reused. These are actual staged numeric outputs, with no injected fitness seam or provider call.
- **P4-T03:** The same synthetic capture (factual binary:continuous settings 1:3) is exercised through `collection-targets`, `collection-all`, and `predict-game`; target score, breakdown, and prediction metadata match. The actual-rated previously-owned member appears in P/reference disclosure but not current-owned R eligibility. A collection-domain target and a BGG wishlist candidate with identical factual source and actual reference labels are also resolved through their correctly typed SQLite cache domains and fed to the same `computeUnifiedPrediction`; selected labels, S-driven result and score match. This is staged common-engine evidence only, not Phase 5 wishlist projection/API behavior or production route activation.
- `unified-prediction.test.ts` additionally covers actual per-axis labels, nullable S, k/minimum filtering, changed S ordering changing the chosen neighbor/score, weak-confidence/current coverage, and the domain-agnostic shared estimator contract. The collection fixture uses the full collection factual source context, with no personal-axis feature contribution or candidate insertion into that context.
- Initial Phase 4 author pass before the bounded P4-R01–R03 corrections: the approved production/staged regression command passed **213 tests / 1,430 expectations across 9 files** and the two new files passed **6 tests / 46 expectations**. Final post-correction counts are recorded below.
- Before the bounded P4-R01–R03 corrections, Phase 4 was awaiting independent review. It remains unwired; production proof/publication lifecycle remains a Phase 6 obligation.

### Phase 4 bounded review corrections P4-R01–R03 (author verification; independent gates pending)

- **P4-R01 — fully predicted classification:** The staged collection adapter now follows the established rule exactly: an output is fully predicted only when `predictionMeta?.actualAxisCount === 0`. In the enabled-redundancy pipeline fixture, an actual target at **5** accepts a higher mixed neighbor (`actualAxisCount: 1`) as actual-strength evidence; the mixed neighbor is not labeled fully predicted. In the inverse fixture, a mixed target at **1.5** excludes a higher fully predicted neighbor at **5.8**; that neighbor is marked fully predicted and does not contribute to its penalty. These checks exercise the adapter's real output metadata and penalty path.
- **P4-R02 — score rounding:** For a target score of **5**, one better neighbor among two, and `maxPenalty: 2.25`, the raw penalty is **1.125**, the separately displayed penalty is **1.13**, and the adjusted score is **3.88** (subtract raw, then round adjusted score), not 3.87.
- **P4-R03 — indexed axis-pair workload:** The staged adapter indexes demanded pairs once by target, then visits only each target's slice. The deterministic 24-target × 3-reference fixture reports one index build, **72** indexed pairs, **24** target lookups, **72** related pairs total, and **72** consumed pairs. It does not rescan 72 demands for each of the 24 targets. Counters are an optional local test observer, not persisted telemetry.
- Final Phase 4 author regression command (the nine approved production/staged files) passed **216 tests / 1,475 expectations across 9 files**. The two direct staged suites passed **9 tests / 91 expectations across 2 files**. `bun run typecheck`, scoped ESLint on the four staged TypeScript files, Prettier check on those files and this note, and `git diff --check` passed after the final author edits. No production bindings or old expected outputs were changed.
- Independent verification accepted the four-file Phase 4 manifest: **216 tests / 1,475 expectations across 9 files**, including **18 tests / 203 expectations** from upstream pure-scope and real-cache suites; the new staged suites contributed **9 tests / 91 expectations**. The reviewer explicitly accepted Phase 4 and closed P4-R01–R03 with no material issues; root TypeScript, scoped lint, formatting, and diff checks passed. Acceptance is for the real staged numeric P→cache-only S→shared predictor/current fitness→R pipeline, not live production wiring or lifecycle integration.
- The accepted criterion includes the mixed-authority rule (`predictionMeta.actualAxisCount === 0` means fully predicted), raw penalty subtraction before rounding (score 5, raw 1.125 → adjusted 3.88; displayed penalty 1.13), and indexed workload (24 targets, 72 indexed and consumed pairs, 24 target lookups). Earlier T01–T03 evidence remains accepted: cached semantic evidence changed target fitness from unavailable to 6 and eligible R from 1 to 3; 1:3 settings produced parity across candidate/full/requested/predict-game staged paths.
- The staged Phase 4 modules remain unwired. This acceptance does not claim production prediction/redundancy activation or production lifecycle integration.

#### Phase 4 author source manifest (in-progress handoff)

| File | SHA-1 Git blob |
| --- | --- |
| `packages/daemon/src/services/unified-prediction.ts` | `a18f41a05685d3d6417c5a7deb6a3be53a704381` |
| `packages/daemon/src/services/unified-collection-pipeline.ts` | `a9a81d39ee960fe60d29c083075fc01a04077eb2` |
| `packages/daemon/tests/services/unified-prediction.test.ts` | `552ab7bc4172e158cc6aff782739b135352a2d48` |
| `packages/daemon/tests/services/unified-collection-pipeline.test.ts` | `9c989252682d949e89b636d45a48e9f9e58c3e0e` |

SHA-256 and pre-staging working-tree/index record for the four accepted new source/test files:

| File | SHA-256 | Porcelain before staging | Index entry before staging |
| --- | --- | --- | --- |
| `packages/daemon/src/services/unified-prediction.ts` | `779a448b9aa311cc4820f6dd5f8edc9a9a71ac30000e39f7802b7dcad1a2004d` | `??` | absent |
| `packages/daemon/src/services/unified-collection-pipeline.ts` | `51d7e7188c0a236b3982732ddb7d362e220d034d18da222ec960be267e83989e` | `??` | absent |
| `packages/daemon/tests/services/unified-prediction.test.ts` | `5897b5975968bf101da70139cf16fdee8ee529490123c2d13823099b575d751e` | `??` | absent |
| `packages/daemon/tests/services/unified-collection-pipeline.test.ts` | `0d9863e289f7abbd282fb5e3a55df25396639e597a17f911f21db6e45ef63740` | `??` | absent |

The implementation manifest covers only these four accepted new staged files; the progress note is intentionally updated for checkpoint evidence and is not self-hashed. The worktree also retains unrelated pre-existing `.beads/issues.jsonl` modifications.

## Phase 5 staged wishlist projection and shared/CLI contracts (in progress)

Phase 5 author implementation remains unbound. The designer owns all `packages/web` work; this author lane adds only daemon projection, a separately named shared V2 contract, and an unbound CLI formatter. Existing wishlist services, current shared exports/validators, routes, loaded pages, and active CLI command behavior remain unchanged. The daemon adapter reads verified saved facts and cache-only JEV judgments, uses the single Phase 4 predictor, never falls back to saved-derived scores, and does not persist on read. V2 response projections exclude private BGG source and owner-note evidence; current aliases are projected from the current result or are null. No BGG/provider read is part of the ordinary projection path.

The shared handoff module is `packages/shared/src/wishlist-current-projection-v2.ts`, with direct-import exports `CurrentPredictionProjectionV2`, `WishlistRedundancyProjectionV2`, `WishlistEntryReadResultV2` and strict runtime schemas. It does not alter V1 exports or acceptance. Wishlist current owned fitness requires collection-domain P cache evidence, but that evidence is a calculation dependency—not an authorized wishlist-run pair. The staged scope now resolves it into the same sealed source/cache proof while keeping `predictionPairs`, `redundancyPairs`, `authorizedPairs`, disclosure counts/signals, and run targets limited to the selected wishlist candidate domain. A new typed `calculationDependencyPairs` input is passed only to the internal fitness evaluator; it is not returned in the frozen run or provider authorization. The Phase 3 option is explicitly named `includeOwnedPredictionDependenciesForWishlist` and defaults false, so the accepted Phase 3 collection behavior and original scope behavior remain unchanged. Cache/source freshness still fences the complete prepared proof; changes invalidate calculation currentness without expanding the frozen authorization. The Phase 4 batch extraction lets collection and wishlist use the same per-target indexed calculation and `computeUnifiedPrediction`, rather than duplicating estimator or confidence logic; the collection entry point continues to use that same helper and retains its accepted per-target index counters. Neither dependency change modifies a production module or binding. The CLI addition is an unbound current-projection formatter only. Parallel designer-owned web files are outside this author lane and are not included in its manifest or validation.

### Phase 5 author verification (initial author evidence; later acceptance recorded below)

- New daemon/shared projection, Phase 3 scope, and Phase 4 predictor/pipeline suites: **24 tests, 0 failures, 230 expectations across 5 files**. The Phase 4 regression command (seven existing production regression files plus the two staged predictor/pipeline files) passed **216 tests, 0 failures, 1,475 expectations across 9 files** after the reusable batch extraction.
- Existing wishlist regression suites plus the new staged tests passed together: **95 tests / 605 expectations across 8 files** (daemon services/routes, shared V2 contract, and CLI). The constituent baseline suites were daemon **82 / 546 across 4 files** and existing+new CLI **7 / 27 across 2 files**; new direct shared/daemon/CLI coverage contributes the remaining tests.
- Projection fixtures use temporary real SQLite and synthetic source/cache rows. They cover cache-only current aliases and redundancy, no saved-derived fallback when current evidence is missing, missing C with sufficient F, source privacy, unchanged persisted facts, and cache-row changes altering current score and redundancy. Shared schema tests accept valid zero and reject private/legacy-derived/unknown fields. CLI tests check unavailable is explicit and saved values are not presented as current.
- The cache-change fixture holds saved facts and actual ratings fixed, then changes valid SQLite C_ONLY judgments and recomputes: the staged current predicted score changes, the current redundancy calculation is based on that new pre-redundancy score, and ordering score comes from the current adjustment. The first projection asserts the confidence alias is sourced from current prediction metadata; the cache-change fixture does **not** claim confidence itself changed. The insufficient-evidence case is explicitly unavailable/null rather than a fabricated zero, while a factual-only scoring result remains available when C is absent. Genuine valid zero is retained by the V2 schemas.
- **P5-T01 correction:** Replaced the prior incorrect test that put owned collection P into frozen wishlist P/U0. The corrected fixture has one selected BGG candidate and three authorized wishlist-domain pairs (two candidate P pairs, one additional R pair); run targets, prediction pairs, redundancy pairs, authorized pairs, requested IDs, cache hit/miss counts, and authorized signals remain wishlist-scoped. Separately, the evaluator receives four typed collection-domain owned-prediction calculation dependencies for two missing-axis owned targets. The sealed proof records those demands/evidence; the fixture has permission-enabled D requirements but no note source, so D evidence is unavailable and D remains absent from authorized wishlist signals. One PreparedSimilarity context resolves seven unique pairs once (three authorized wishlist pairs, four internal owned dependencies); no per-consumer resolver or provider call is added. After cache revision advances, run authorization remains the same three pairs while calculation currentness becomes false. A separately prepared scope with a changed injected current-fitness result then admits the newly eligible local game only in that new preview, expanding authorized wishlist pairs to four; the old run remains at three. This is pure Phase 3 scope-seam evidence, not a claim of a provider run. Staged wishlist projection tests separately verify real SQLite cache-derived candidate prediction and redundancy/order without saved-score fallback or storage mutation.
- Exact focused test commands already run for this lane:

  ```sh
  bun test packages/shared/tests/wishlist-current-projection-v2.test.ts packages/daemon/tests/services/unified-wishlist-projection.test.ts packages/daemon/tests/services/staged-similarity-scope.test.ts packages/daemon/tests/services/unified-prediction.test.ts packages/daemon/tests/services/unified-collection-pipeline.test.ts
  bun test packages/daemon/tests/services/prediction-engine.test.ts packages/daemon/tests/services/prediction-service.test.ts packages/daemon/tests/redundancy-engine.test.ts packages/daemon/tests/redundancy-integration.test.ts packages/daemon/tests/services/displayed-fitness-service.test.ts packages/daemon/tests/services/collection-snapshot-service.test.ts packages/daemon/tests/routes/prediction.test.ts packages/daemon/tests/services/unified-prediction.test.ts packages/daemon/tests/services/unified-collection-pipeline.test.ts
  bun test packages/daemon/tests/wishlist-redundancy-scoring.test.ts packages/daemon/tests/wishlist-service.test.ts packages/daemon/tests/wishlist-candidate-read-proof.test.ts packages/daemon/tests/wishlist-routes.test.ts packages/daemon/tests/services/unified-wishlist-projection.test.ts packages/cli/tests/commands/wishlist.test.ts packages/cli/tests/commands/wishlist-current-projection.test.ts packages/shared/tests/wishlist-current-projection-v2.test.ts
  ```
   Results after P5-T01: scope/composition/budget/cache integration **45 tests / 456 expectations across 7 files**; Phase 4 production+staged regression **216 / 1,475 across 9 files**; wishlist/shared/CLI regression+staged suites **95 / 605 across 8 files**. The direct scope+projection pair passed **12 tests / 167 expectations across 2 files**. At this earlier author handoff, independent tester and Phase 5 reviewer verification were pending; final gate results are recorded below.
- Exact daemon/shared/CLI checks: `bun run typecheck`; scoped `bunx eslint` over the nine author-owned TypeScript source/test files listed in the manifest; `bunx prettier --check` over those nine files plus this note; and `git diff --check`. These are backend-only checks; no root/global lint or browser checks ran while the designer-owned web files were moving.
- `bun run typecheck`, scoped ESLint, scoped Prettier `--check`, and `git diff --check` passed. No active service, route, shared V1 validator/export, loaded web page, or live CLI command has been changed by this author lane. This was the pre-acceptance author handoff; final gates and acceptance are recorded below. Phase 6 has not started.

#### Phase 5 author source manifest (in-progress handoff)

The author-owned manifest includes the new shared contract/test, staged daemon projection/test, staged CLI formatter/test, and bounded changes to the Phase 3 scope helper/test and Phase 4 batch helper. The index is empty; new files were absent from the index, and changed files are working-tree-only. SHA-256 hashes at author handoff:

| File | SHA-256 |
| --- | --- |
| `packages/shared/src/wishlist-current-projection-v2.ts` | `b8a0c428fd05dbf7fcfc854f203f1359c20a85876ba030fa1c7454000cc9bdbf` |
| `packages/shared/tests/wishlist-current-projection-v2.test.ts` | `f7f316a920b59b0efca23847f65c223c75ba352626fe1b2a54ac7690f666aea9` |
| `packages/daemon/src/services/staged-similarity-scope.ts` | `ed4d0e42116de3b97698a2c120c9fc2b30d5da12d1a3cd785d8192893f99631b` |
| `packages/daemon/src/services/unified-collection-pipeline.ts` | `07d60c3601d3475fef94152f880d25c1ec934187959d7e15419127e8b2ad6722` |
| `packages/daemon/src/services/unified-wishlist-projection.ts` | `75c082a0bf8fb3d14649a7c08aeffc1f257c8b5217a8443521253c059bbd09b2` |
| `packages/daemon/tests/services/staged-similarity-scope.test.ts` | `94f2e273acc1fce81ad733294ff24219299705190e23dfd1858871cd4629d2c5` |
| `packages/daemon/tests/services/unified-wishlist-projection.test.ts` | `854bf558d2c6ee0e8d3690e66c71c2232f0b11a846688a975bfb5de2ae38412d` |
| `packages/cli/src/commands/wishlist-current-projection.ts` | `f261db8caeee8ea59082daead209d984a006f94f3e0f2bf2d357485189b3fdff` |
| `packages/cli/tests/commands/wishlist-current-projection.test.ts` | `8fcbed2b9492d43fb937df498e82d334b8d4af83d839e4f6cc7552bdaafc1d4d` |

The progress note is intentionally not self-hashed. The parallel designer-owned web files are excluded from this author's changes and tests. Unrelated pre-existing `.beads/issues.jsonl` changes remain unstaged and untouched by this implementation lane; no checkpoint or Phase 6 work has started.

### Phase 5 bounded review corrections P5-R01/R02 (author verification; independent gates pending)

- **P5-R01 — candidate factual fitness:** The wishlist target path now constructs only the score-readable fields from the capture-validated compact BGG snapshot and runs the existing `createFitnessService().calculateScore` before the shared prediction assembler. It supplies no saved wishlist score/breakdown, personal ratings, tournament labels, owner note, collection membership, or manual overrides; the candidate is not inserted into the captured factual universe. The actual derived result is combined by the same phase-4 assembler and estimator. Temporary SQLite fixtures show: a community-rating-only candidate with no prediction references is available at score **7** at Stage 0; a mixed actual-derived/personal-predicted candidate reports one actual and one predicted axis; a playing-time veto remains an available factual result with **score 0**, `vetoed: true`, and ordering score 0; and a verified candidate source with no usable scoring facts and no predictions returns explicit `no-scoring-contribution` with null aliases, not a fabricated zero. A missing-source failure carries the same captured stage-0 readiness metadata as the available factual-only result.
- **P5-R02 — actual-label readiness:** Exported the one pure `deriveStagedActualAxisContext` calculation from the accepted Phase 3 scope helper. Normal P scope and wishlist failure projection now consume this same actual axes/reference/readiness derivation instead of separately approximating tournament and personal counts. With three tournament games having comparisons (below the existing five-game display floor) and a stage-0 threshold of two, it produces zero actual references, `ratedGameCount: 0`, `stage: 0`, and `gamesNeeded: 2`. The result is used for both unavailable and successful stage-0 projection metadata; the existing above-floor/actual-label rules are retained by the shared helper and regression suites.
- The shared helper addition was necessary so failure metadata and normal P planning use exactly the same actual-label eligibility; it changes no production prediction/readiness function and remains an inert staged-module dependency. The Phase 4 batch adapter change supplies the compact candidate facts to the existing scorer; neither production factories/routes nor saved-output behavior were modified. Existing staged wishlist result schemas, privacy filtering, current-only aliases, redundancy classification/rounding, P5-T01 read-dependency versus authorization separation, and selected-scope freezing remain intact.
- **Final targeted validation after these corrections:** `bun test packages/daemon/tests/services/unified-wishlist-projection.test.ts packages/daemon/tests/services/staged-similarity-scope.test.ts` — **14 tests, 0 failures, 183 expectations across 2 files**. The broader approved Phase 3 scope/composition/budget/cache command passed **46 / 463 across 7 files**; the Phase 4 nine-file regression passed **216 / 1,475**; the wishlist/shared/CLI regression command passed **96 / 612 across 8 files**. These broader suites were run after implementation and before final test-only assertion additions; the final targeted command above reran both modified suites afterward.
- `bun run typecheck` (shared, daemon and CLI), scoped `bunx eslint` on the nine author-owned source/test files, scoped `bunx prettier --check` on those files plus this note, and `git diff --check`: passed after the final author edits. No browser checks ran in the backend lane. Fixtures use synthetic source and temporary SQLite only; no provider/network access or persistent write is made by the projection.
- Phase 5 remains in progress and unaccepted; independent tester and reviewer gates are pending. Projection remains an inert adapter, not an activated API/route/UI/CLI behavior. Phase 6 has not started.

#### Phase 5 correction author manifest (working-tree state)

The nine backend/shared/CLI source and test paths in the manifest above are the author-owned files. After P5-R01/R02, their SHA-256 values are:

| File | SHA-256 |
| --- | --- |
| `packages/shared/src/wishlist-current-projection-v2.ts` | `b8a0c428fd05dbf7fcfc854f203f1359c20a85876ba030fa1c7454000cc9bdbf` |
| `packages/shared/tests/wishlist-current-projection-v2.test.ts` | `f7f316a920b59b0efca23847f65c223c75ba352626fe1b2a54ac7690f666aea9` |
| `packages/daemon/src/services/staged-similarity-scope.ts` | `64c477a1e11131dd8f384765781837a33b43d57372133409f0233bedaea14df5` |
| `packages/daemon/src/services/unified-collection-pipeline.ts` | `31289bfb3756ff57286d21f421afcd9f5473952e79830a0f28476e268253aed8` |
| `packages/daemon/src/services/unified-wishlist-projection.ts` | `efaadb0e42da90c34983223c6c15aa097b384cba6091e6be319fa863ba541360` |
| `packages/daemon/tests/services/staged-similarity-scope.test.ts` | `4d267f88fb7461c7ca534d7d4f191b7d55ec34fdedf62c38dc56772fb59e7900` |
| `packages/daemon/tests/services/unified-wishlist-projection.test.ts` | `bd4b6ec4cf996ff13c3c381f2dce98cf4b90a7c2f2354a5b0a20e954fefc1e31` |
| `packages/cli/src/commands/wishlist-current-projection.ts` | `f261db8caeee8ea59082daead209d984a006f94f3e0f2bf2d357485189b3fdff` |
| `packages/cli/tests/commands/wishlist-current-projection.test.ts` | `8fcbed2b9492d43fb937df498e82d334b8d4af83d839e4f6cc7552bdaafc1d4d` |

At this verification the index is empty; the three previously tracked Phase 3/4 author-owned source/test paths are working-tree modifications, and the six new author-owned source/test paths are untracked. The parallel designer-owned web files and pre-existing unrelated Beads changes are outside this manifest. The note is intentionally not self-hashed. No commit, issue close, or Phase 6 work has occurred.

### User-authorized bounded Phase 5 P5-R01 veto-ordering correction (2026-10-04)

After the Phase 5 review escalation, the user explicitly authorized one bounded additional correction round for the remaining P5-R01 veto-ordering defect. P5-R02 readiness remains closed and was not reopened. The projection now bypasses redundancy adjustment when the current shared prediction result has `vetoed: true`, preserving its available score 0 and ordering score 0 instead of allowing the redundancy helper's minimum-score floor to raise it to 1. This uses the existing factual `FitnessResult.vetoed` authority; non-vetoed candidate adjustment math, collection behavior, and the redundancy helper/minimum floor are unchanged.

The new synthetic SQLite regression gives the vetoed candidate a playing-time fact of 60 (veto threshold 30), while owned games have playing time 20 and positive non-vetoed factual fitness. Cached candidate-to-owned semantic similarities resolve to 1, exceeding the configured threshold; therefore eligible neighbors exist and the prior path would exercise the helper's floor. The projection now remains available with `result.score: 0`, `vetoed: true`, `orderingScore: 0`, and no adjustment. The existing no-neighbor factual-veto case remains covered as a separate regression. This test uses no provider/network or persistent source writes.

- Final targeted command: `bun test packages/daemon/tests/services/unified-wishlist-projection.test.ts packages/daemon/tests/services/staged-similarity-scope.test.ts` — **15 passed, 0 failed, 191 expectations across 2 files**. The regression directly verifies positive eligible owned fitness, cached similarity **1**, and preservation of candidate score/order **0**.
- `bun run typecheck`; scoped ESLint and Prettier checks for the two changed projection files and the unchanged shared readiness helper/tests; `git diff --check`: passed. No full backend suite was repeated; prior full focused Phase 5, Phase 3, and Phase 4 evidence remains recorded above.
- This is the explicitly user-authorized third bounded correction round, not a new design approval or phase acceptance. P5-R01 awaits independent tester and reviewer targeted verification; P5-R02 stays closed. Phase 5 remains in progress, no commit/Beads close occurred, and Phase 6 has not started. No canonical review-finding artifact hash was supplied; source hashes below identify this exact implementation/test state.

#### P5-R01 correction source manifest

| File | SHA-256 |
| --- | --- |
| `packages/daemon/src/services/unified-wishlist-projection.ts` | `06bb14a58afa0549ba3059e1bb43278a4558f622bb5552f9970fbc8e64a9370f` |
| `packages/daemon/tests/services/unified-wishlist-projection.test.ts` | `1f078d2c82dd2364de9007e6badad1dbf25d7cd0b4a9ff0b20bd2c627c6ccd91` |

The index remains empty; these two files are working-tree-only. Other Phase 5 files, designer-owned web files, and unrelated Beads changes were not modified in this correction. The note remains intentionally unhashed.

## Phase 5 acceptance and checkpoint record (2026-10-04)

Independent tester, Bun/TypeScript reviewer, and designer gates accepted Phase 5. The independent full run passed **3,899 tests, 1 skipped, 0 failed, and 23,337 expectations across 244 files**; the final P5-R01 focused run passed **15 tests / 191 expectations**, and the accepted Phase 4 regression remains **216 / 1,475**. Root TypeScript, scoped lint/format/diff checks passed. Browser coverage (**120 tests**), browser TypeScript, and build had passed earlier and the three designer-owned web files were unchanged from those verified hashes. The reviewer explicitly closed P5-R01 and P5-R02, including the authorized veto-zero correction; P5-T01's wishlist calculation dependencies remain separate from the three wishlist-authorized pairs. Phase 5 is accepted and `shelf-judge-bs1y.5` is closed. The epic remains `in_progress`; `.6` is open, ready, and unclaimed.

Acceptance is strictly for the staged-only backend/shared/CLI adapters and isolated web view. There are still no active wishlist routes/service bindings, live shared V1 validator changes, loaded-page/CLI activation, or production inference behavior. The approved one-commit activation is Phase 6 only; this checkpoint does not start or claim it.

### Accepted twelve-file source/test manifest

SHA-256 values below were recomputed at checkpoint preparation and match the independently reviewed Phase 5 state. Existing tracked helper/test files are modified only in the working tree; new files remain untracked until this selective checkpoint. The staged index was empty when captured.

| File | WT | HEAD blob | Index blob | SHA-256 |
| --- | --- | --- | --- | --- |
| `packages/daemon/src/services/staged-similarity-scope.ts` | ` M` | `d987312397a2b310261314aa142ef6013be10a3c` | `d987312397a2b310261314aa142ef6013be10a3c` | `64c477a1e11131dd8f384765781837a33b43d57372133409f0233bedaea14df5` |
| `packages/daemon/src/services/unified-collection-pipeline.ts` | ` M` | `a9a81d39ee960fe60d29c083075fc01a04077eb2` | `a9a81d39ee960fe60d29c083075fc01a04077eb2` | `31289bfb3756ff57286d21f421afcd9f5473952e79830a0f28476e268253aed8` |
| `packages/daemon/src/services/unified-wishlist-projection.ts` | `??` | absent | absent | `06bb14a58afa0549ba3059e1bb43278a4558f622bb5552f9970fbc8e64a9370f` |
| `packages/daemon/tests/services/staged-similarity-scope.test.ts` | ` M` | `6bcd88fbacece2007118928955c2d1754aab3d6f` | `6bcd88fbacece2007118928955c2d1754aab3d6f` | `4d267f88fb7461c7ca534d7d4f191b7d55ec34fdedf62c38dc56772fb59e7900` |
| `packages/daemon/tests/services/unified-wishlist-projection.test.ts` | `??` | absent | absent | `1f078d2c82dd2364de9007e6badad1dbf25d7cd0b4a9ff0b20bd2c627c6ccd91` |
| `packages/shared/src/wishlist-current-projection-v2.ts` | `??` | absent | absent | `b8a0c428fd05dbf7fcfc854f203f1359c20a85876ba030fa1c7454000cc9bdbf` |
| `packages/shared/tests/wishlist-current-projection-v2.test.ts` | `??` | absent | absent | `f7f316a920b59b0efca23847f65c223c75ba352626fe1b2a54ac7690f666aea9` |
| `packages/cli/src/commands/wishlist-current-projection.ts` | `??` | absent | absent | `f261db8caeee8ea59082daead209d984a006f94f3e0f2bf2d357485189b3fdff` |
| `packages/cli/tests/commands/wishlist-current-projection.test.ts` | `??` | absent | absent | `8fcbed2b9492d43fb937df498e82d334b8d4af83d839e4f6cc7552bdaafc1d4d` |
| `packages/web/components/wishlist-current-projection.tsx` | `??` | absent | absent | `634cdea424291b496f1a7b80d0662538716d28dfd7af2505ac0f64e027f391ce` |
| `packages/web/lib/wishlist-current-projection-view-model.ts` | `??` | absent | absent | `d32648acdc782927f9ca5d985839524daeb9a53d7bfcc47421d6fffe4508e907` |
| `packages/web/tests/wishlist-current-projection.test.tsx` | `??` | absent | absent | `7d2f86529cc6a9e27d9b9a0e9e0554d19a4fbcfa0dbf10eb861936902522b99f` |

The Phase 5 passive Beads export delta is only the exact current `shelf-judge-bs1y.5` record (closed for acceptance); the epic stays in progress and `.6` remains open/ready/unclaimed. Existing unrelated working-tree records `shelf-judge-0xhp` and `shelf-judge-uf1p` are excluded from the staged export delta and remain untouched. No design/plan files are included. The note's self-hash is the administrative exception.
