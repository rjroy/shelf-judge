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

The user approved the linked design and seven-phase plan and authorized implementation. The execution branch is `feat/unified-similarity-prediction-redundancy`; Phase 1 is checkpointed at `c32cb3d5e63328177bcec169507f73a070c24627` from the approved-doc base `084936ca29c17c36b0e652e1173bcdc93209d3e3`, Phase 2 at `027ca1fbd88379f63a090375fccd290082fa3051`, and Phase 3 at `01b159c308c2d849c6a3b8f3ca7da4ee78ac947d`. Phases 1–3 are accepted; the epic remains in progress. Phase 4 is claimed and in progress. No later phase has started.

| Phase | Status | Gate before next phase |
| --- | --- | --- |
| 1 — baseline, shared math, settings assembler | Accepted; checkpointed with `shelf-judge-bs1y.1` | Phase 1 checkpoint `c32cb3d5` verified before Phase 2 began |
| 2 — source capture, cache-only resolver, proof/revocation | Accepted and checkpointed at `027ca1f` | Phase 2 commit reconciled before Phase 3 began |
| 3 — pair scope and frozen run | Accepted and checkpointed with `shelf-judge-bs1y.3` | Phase 3 checkpoint `01b159c3` reconciled before Phase 4 began |
| 4 — staged predictor and real numeric pipeline | Accepted and checkpointed with `shelf-judge-bs1y.4` | Phase 4 checkpoint verified before Phase 5 may start |
| 5 — staged wishlist/API/client adapters | Not started | Phase 4 verified checkpoint |
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
- The staged Phase 4 modules remain unwired. This acceptance does not claim production prediction/redundancy activation or production lifecycle integration. Phase 5 has not started.

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

The implementation manifest covers only these four accepted new staged files; the progress note is intentionally updated for checkpoint evidence and is not self-hashed. The worktree also retains unrelated pre-existing `.beads/issues.jsonl` modifications. No Phase 5 work has begun.
