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

The user approved the linked design and seven-phase plan and authorized implementation. The execution branch is `feat/unified-similarity-prediction-redundancy`; Phase 1 is checkpointed at `c32cb3d5e63328177bcec169507f73a070c24627` from the approved-doc base `084936ca29c17c36b0e652e1173bcdc93209d3e3`, Phase 2 at `027ca1fbd88379f63a090375fccd290082fa3051`, Phase 3 at `01b159c308c2d849c6a3b8f3ca7da4ee78ac947d`, Phase 4 at `407dd789`, and Phase 5 is checkpointed with `shelf-judge-bs1y.5`. Phases 1–6 are accepted and checkpointed; Phase 7's independent gates are accepted and its local checkpoint is being recorded.

| Phase | Status | Gate before next phase |
| --- | --- | --- |
| 1 — baseline, shared math, settings assembler | Accepted; checkpointed with `shelf-judge-bs1y.1` | Phase 1 checkpoint `c32cb3d5` verified before Phase 2 began |
| 2 — source capture, cache-only resolver, proof/revocation | Accepted and checkpointed at `027ca1f` | Phase 2 commit reconciled before Phase 3 began |
| 3 — pair scope and frozen run | Accepted and checkpointed with `shelf-judge-bs1y.3` | Phase 3 checkpoint `01b159c3` reconciled before Phase 4 began |
| 4 — staged predictor and real numeric pipeline | Accepted and checkpointed with `shelf-judge-bs1y.4` | Phase 4 checkpoint `407dd789` verified before Phase 5 began |
| 5 — staged wishlist/API/client adapters | Accepted and checkpointed with `shelf-judge-bs1y.5`; staged adapters remain inert | Independent tester/reviewer and designer gates passed |
| 6 — atomic production activation | Accepted; independent tester, reviewer, and designer gates passed; atomic checkpoint recorded with `shelf-judge-bs1y.6` | Phase 6 accepted manifest and checkpoint `b16c0445` reconciled before Phase 7 started |
| 7 — integration, performance, authority reconciliation | Accepted; tester, reviewer and designer gates passed; Phase 7 checkpoint being recorded | Phase 6 verified checkpoint `b16c0445`; after the Phase 7 checkpoint, close the epic in a separate Beads-only checkpoint |

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

The Phase 5 passive Beads export delta is only the exact current `shelf-judge-bs1y.5` record (closed for acceptance); the epic stays in progress and `.6` is claimed/in progress for the bounded Phase 6A WIP. Existing unrelated working-tree records `shelf-judge-0xhp` and `shelf-judge-uf1p` are excluded from the staged export delta and remain untouched. No design/plan files are included. The note's self-hash is the administrative exception.

## Phase 6A bounded composition WIP (2026-10-04)

Phase 6 remains one claimed bead and one eventual atomic checkpoint. This bounded A step adds only an inert shared daemon scoring seam; it does not bind `index.ts`, `app.ts`, active service factories, routes, shared public validation, CLI, or web consumers. The parallel designer owns active web files. No production prediction or redundancy consumer is activated by this work.

`createUnifiedScoringService({ storageService, cache, fitnessService, coordinator? })` now exposes `capture({ includeWishlist?, candidateSources? })`, `calculate(frame, request, { includeRedundancy })`, and `publishCurrent(calculation, publishSync)`. Capture serializes `loadJevSourceSnapshot()` and optional `loadWishlist()` under the existing profile-source coordinator, then binds the captured freshness/external epochs, `sourceVector`, and string wishlist mutation generation. Candidate source subsets must exactly match saved verified compact sources. The capture's synchronous reader checks current source tokens and wishlist generation; `publishCurrent` refreshes the asynchronous source epochs and current facts under the coordinator, checks the complete source identity/cache proof, and invokes acceptance synchronously with no await after the final guard. Snapshot/read failures return unavailable at acceptance; there is no BGG/provider dependency or source write.

Ordinary calculations use a new calculation-only branch of the accepted P/R scope kernel and do not mint frozen-run/one-use execution authorization. Results expose immutable actual/collection/target fitness maps, V2 proof, exact P/R/calculation-dependency pairs, pair similarity/evidence accessors, and currentness; private captured source facts/owner-note text remain in a `WeakMap`-held frame and are not serialized with results. Wishlist read-calculation dependencies remain collection-domain/cache-only and distinct from wishlist-domain authorized P/R pairs. `includeRedundancy` controls only adjustment production; the common semantic S calculation remains independent. A 32-entry request result memo keys source identity, live token, wishlist generation, cache state/revision, canonical request, and penalty selection. Prepared vector/vocabulary/range and member indexes are weakly scoped to a captured immutable source; changed cache rows rebuild derived judgments while reusing source indexes/vectors. Factual ranges/vocabulary use only collection games with BGG facts; candidates are not added to that collection feature population.

Author evidence so far uses real temporary `StorageService` filesystem sources plus the existing temporary SQLite JEV cache and synthetic facts. The new composition suite proves a hand-computed 7.3 current prediction, a valid cached C-row change that changes the score/proof, unchanged-request memo reuse with zero additional pair point reads/index builds, cache/source/wishlist-generation publication rejection, frozen/read-only outputs and no private note/source leakage. A wishlist fixture proves current candidate prediction and that owned collection calculation dependencies are not exposed as wishlist P/R authorization. Final backend-only focused command: **30 passed, 0 failed, 408 expectations across five files**. Root `bun run typecheck`, scoped ESLint, Prettier checks, and `git diff --check` passed on this code. Independent tester/reviewer gates have not run. Phase 6 remains in progress and this is not Phase 6 acceptance or authorization to start Phase 7.

#### Phase 6A author WIP manifest

SHA-256 values below identify the exact author-side Phase 6A source/test state after the focused checks. The five accepted helper files are modified in the working tree only; the new composition module and test are untracked; none of these paths was staged. The note is intentionally self-unhashed.

| File | Working-tree state | SHA-256 |
| --- | --- | --- |
| `packages/daemon/src/services/unified-scoring-service.ts` | New / untracked | `e57323e28e08ca0a2405f04863d9357c121ad8cd20caa09b4aff089feff35e04` |
| `packages/daemon/src/services/prepared-similarity.ts` | Modified / unstaged | `5e33557f4a6037360633eda66ccc09d851c9a65e9eadbbb8713d1a99e911d450` |
| `packages/daemon/src/services/staged-similarity-capture.ts` | Modified / unstaged | `6ae84f977e338357164f241c2804cf232cd6837338d2ad9f93dc86dd69b5a102` |
| `packages/daemon/src/services/staged-similarity-scope.ts` | Modified / unstaged | `5017e24ab2d14b8cb1b51537985bb61e21be7815705af7f60913d0d7f9aef720` |
| `packages/daemon/src/services/unified-collection-pipeline.ts` | Modified / unstaged | `cad377ec12ee896f79de78cc39868013c722e07b4b2776200a93a5dbace59086` |
| `packages/daemon/src/services/unified-wishlist-projection.ts` | Modified / unstaged | `11f61979dfdd7fab79438d1a7dc944f74dce10cf2b4def6e02b61c482be532d0` |
| `packages/daemon/tests/services/unified-scoring-service.test.ts` | New / untracked | `35881a21e8f2d7a9665047fdb0408ca77ee9344b23d9db94fada23df91f5b9c0` |

The parallel web/shared working-tree changes are outside this A manifest and were not edited or validated here. No source/service binding, schema/CLI edit, commit, bead close, or Phase 7 start occurred.

## Phase 6B bounded production-binding WIP (2026-10-04; incomplete)

Phase 6B WIP constructs one `createUnifiedScoringService({ storageService, cache, fitnessService, coordinator })` before the production prediction service and injects it into prediction and displayed-fitness factories. The production prediction service's collection listing, direct local prediction, BGG local match and verified external BGG candidate paths use the common staged scoring calculation; snapshot preparation returns current actual/predicted maps and its V2 proof/currentness guard. Displayed collection/snapshot reads use the same calculator and its current redundancy adjustments. The collection snapshot builder consumes those same paired maps instead of running its old post-hoc cosine adjustment when the unified preparation is present. Test-app construction also creates/injects the same factory. Shared active `SemanticScoringInputProof` and its runtime validator alias now resolve only to the strict V2 digest schema, and attention artifacts use that alias. No wishlist active service/routes or CLI bindings were changed; web files remain designer-owned and untouched.

The initial axis-mutation failure exposed a proposed-source seam. The bounded B2 WIP now adds a separate private proposed-collection capability: it verifies the full persisted prior collection identity, calculates against a cloned proposed collection and retained baseline noncollection inputs using the unified kernel, intersects owner-note permission, and does not register proposal calculations for ordinary publication. Mutation disposition winners are accepted under baseline/cache checks before cleanup; a refreshed source-only fence runs immediately before save, and post-commit maintenance still recalculates from persisted inputs. No proposal proof/result is published or transplanted. `CollectionSchema` normalization is used for full durable identity, and staged source identity JSON-normalizes omitted optionals from in-memory mutation candidates.

Author B2 checks: root `bun run typecheck` passes. `bun test packages/daemon/tests/services/unified-scoring-service.test.ts` passes **3 tests / 47 expectations**, including persisted actual score 5 vs proposed score 3.5 without storage mutation, proposal-publication rejection, and stale-source rejection after prediction-settings change. In `attention-candidate-service.test.ts`, the oracle-call failure was a fixture defect: both mock `getScoringInput` and `evaluate` returned a constant proof despite semantic source changes, so a valid artifact was reused. The fixture now binds proof identity to source semantics; the necessary second evaluation/save contract remains asserted and the suite passes **25 tests / 123 expectations**. The pending-receipt test had invoked ordinary current-source evaluation with a proposed collection, which correctly fails complete-source equality. It now exercises the private proposed evaluator: proposal scoring succeeds with only the future receipt normalized for rule input, the note and receipt remain on the proposal, no private text appears in matches, and an ordinary same-revision changed-weight snapshot remains rejected.

The snapshot mismatch was fixed within the later expanded B2 boundary. `prediction-service.ts` now validates full runtime values with `CollectionSchema`, projects those values using the existing canonical `projectProfileCollectionSource`, and compares both projected/full-compatible inputs plus tournament and prediction settings by canonical hash. It preserves full private source capture for proof/liveness and rejects changed same-revision content/settings. Regression coverage proves full persisted and projected representations are equivalent, while changed content/settings reject. The V2 snapshot cache now accepts only an explicit unified-v2 currentness proof alongside the legacy verified-fence case; it still fails closed without a proof or on stale currentness. The original redun status regression was a literal `enabled => ready` annotation that ignored missing semantic cache evidence; the unified calculation now derives ready/partial/factual from exact demanded pair evidence, consistently for prediction/snapshot/display, while `RedundancySettings.enabled` remains only the adjustment switch.

### Phase 6B current API and handoff state

- `UnifiedScoringService` from `packages/daemon/src/services/unified-scoring-service.ts`: `capture({ includeWishlist?, candidateSources? })`, `calculate(frame, request, { includeRedundancy })`, `publishCurrent(calculation, publishSync)`. `UnifiedCalculation.proof` is `SemanticScoringInputProofV2`; maps and target/reference pairs are calculator outputs, not stored-derived scores.
- Active shared proof exports retain `SemanticScoringInputProof` and `SemanticScoringInputProofSchema`, now V2-only, and additionally export `SemanticScoringInputProofV2Schema` and `SIMILARITY_ALGORITHM_VERSION`. Direct module remains `packages/shared/src/semantic-scoring-input-proof-v2.ts`.
- Known remaining C/D production bindings: wishlist-current public projection/service+route contracts and strict response validators for legacy flat and rich wishlist reads; active wishlist CLI formatter/command; wishlist refresh response current-alias mapping. They are intentionally not bound in this B WIP.
- A-only hashes above must be recomputed after B edits to `staged-similarity-capture.ts`, `unified-scoring-service.ts`, and `unified-collection-pipeline.ts`; no accepted Phase 6 manifest exists yet. This note is a WIP log, not Phase 6 acceptance.

### Phase 6B2 proposed-collection correction (2026-10-04; author WIP)

Changed B2 paths include `packages/daemon/src/services/staged-similarity-capture.ts`, `unified-scoring-service.ts`, `displayed-fitness-service.ts`, `prediction-service.ts`, `collection-snapshot-service.ts`, `collection-snapshot-cache-service.ts`, `attention-candidate-service.ts`, `collection-mutation-service.ts`, `packages/daemon/src/index.ts`, test-app, and relevant daemon tests. The existing integration seam uses `prepareProposedCollection({ prior, proposed })`; empty stored-rule sets skip calculation and retain only the source fence. No web/shared/CLI files were edited by this B2 lane. No commit, close, deployment, or Phase 7 start occurred.

The new real-filesystem/SQLite production-composition test drives a nonempty stored disposition through `CollectionMutationService`: equal weights score 5; the proposed 3:1 axis weights score 3.5 before save while persisted state remains unchanged; postcommit proof/output come from a fresh persisted calculation rather than the draft. It also verifies note-edit invalidation of SHARED_CD C evidence while owner-note weight is 0, baseline-denied note permission cannot be granted by a proposal, source mutation at `beforePersistence` triggers compensation and does not overwrite newer durable state, a queued writer serializes and invalidates the earlier artifact, and failed SQLite cleanup leaves note-derived evidence unavailable after reopen. A prepared-kernel observer proves empty stored-rule mutations build no factual context (zero scoring). Standalone existing coverage still includes ordinary same-revision content/settings rejection and proposal-publication rejection. The semantic-production snapshot/source equivalence regression and explicit V2 proof check pass. B2 remains implementation WIP and unaccepted pending parent independent test/review; no C/D work, close or checkpoint has begun.

Current daemon backend working-tree manifest (SHA-256, all modified/untracked daemon files; not an accepted/reviewed Phase 6 manifest):

| Status | Path | SHA-256 |
|---|---|---|
| modified | `packages/daemon/src/index.ts` | `103a7c2812447ea92565460347374fa2e1d46040e1a57a2a66add819c7a06eb1` |
| modified | `packages/daemon/src/services/attention-candidate-service.ts` | `1de3bdc97c43ca3907ec8f97c88753f4042f25b469734c12d8804400e30c4206` |
| modified | `packages/daemon/src/services/collection-mutation-service.ts` | `aab08db27c43ef029acc6735080909b15a82f56bf40d7f62c42bfe71a0ef4973` |
| modified | `packages/daemon/src/services/collection-snapshot-cache-service.ts` | `d67bdf8fa5d83e6976e59a7abd06544fb2e0b383daff0cd51a657d00a887bf1e` |
| modified | `packages/daemon/src/services/collection-snapshot-service.ts` | `8a567a91c68eef197ed0d68912817b5969237393caaf210c4d367ecc03dc1502` |
| modified | `packages/daemon/src/services/displayed-fitness-service.ts` | `e7432ebfec4cba6248b92d3ba283782e3eeb3e60c228d6e261e763cfe895d452` |
| modified | `packages/daemon/src/services/prediction-service.ts` | `639923b48debe876174544d24eb703b3c82e3374730d032cca5e8b2508cb9c44` |
| modified | `packages/daemon/src/services/prepared-similarity.ts` | `5e33557f4a6037360633eda66ccc09d851c9a65e9eadbbb8713d1a99e911d450` |
| modified | `packages/daemon/src/services/staged-similarity-capture.ts` | `e4368150753c1e3c207361c0accf1321a2ef46e51d613e7b049661503a411bf3` |
| modified | `packages/daemon/src/services/staged-similarity-scope.ts` | `5017e24ab2d14b8cb1b51537985bb61e21be7815705af7f60913d0d7f9aef720` |
| modified | `packages/daemon/src/services/unified-collection-pipeline.ts` | `cad377ec12ee896f79de78cc39868013c722e07b4b2776200a93a5dbace59086` |
| modified | `packages/daemon/src/services/unified-wishlist-projection.ts` | `11f61979dfdd7fab79438d1a7dc944f74dce10cf2b4def6e02b61c482be532d0` |
| untracked | `packages/daemon/src/services/unified-scoring-service.ts` | `d86c5ed2372b64656ca3200b5ff6ffc6818c12afde239492f8049841bbeb680b` |
| modified | `packages/daemon/tests/helpers/test-app.ts` | `28be4ebd77c9af9334e52474db498ff403c64bc255289caf49a879c52e2a479c` |
| modified | `packages/daemon/tests/profile-service.test.ts` | `5a471ae793049531207c885b2f99d19ddf72a5e9b80b9ce6c94e76cfbb80b331` |
| modified | `packages/daemon/tests/semantic-production-wiring.test.ts` | `53599fbe413a1cdf49529d4adff33dd518b682a2d2537b87405d198c188c9044` |
| modified | `packages/daemon/tests/services/attention-candidate-service.test.ts` | `ff0ee0da3ef50348ada0d5c4e3c14c432bf19fac3ec4b286190b9c6dedc017f3` |
| modified | `packages/daemon/tests/services/attention-candidate-storage.test.ts` | `36de4add1d81b0ae7ac63880c42a5d6752fcb9c0d43cb80be239350a44069646` |
| modified | `packages/daemon/tests/services/displayed-fitness-scoring-proof.test.ts` | `91542269ff449e1cd5e6c7cf64cb13007112532fd3692cdbd2578445eb1f3a35` |
| modified | `packages/daemon/tests/services/displayed-fitness-service.test.ts` | `638ff43053c6aee65d4d97f03d4b33b46916da4dcef8bf008e2890f0a9b4e7b6` |
| modified | `packages/daemon/tests/services/profile-persistence.test.ts` | `1d4389c528b3489a7c6d1e26f9e4e390abefc4cf5b91c0a9c39d4b2da1903436` |
| modified | `packages/daemon/tests/services/storage-service.test.ts` | `bfe2274e8ef477aa43447db3ea5b5ebe2d6f7ba5d20a842f5a572dc41c17e3eb` |
| untracked | `packages/daemon/tests/services/unified-scoring-service.test.ts` | `c68d753bf5af07cf7ed01b3cbe6b5d0a63a27d0ba35158f7ec6ee8697614be44` |

Local B2 validation after the final daemon edits: `bun run typecheck` passed; ESLint and Prettier checks passed for the 23 listed daemon files; `git diff --check` passed. The full focused backend command covered semantic production wiring, proposed scoring, mutation/disposition, prediction, display, snapshot/cache, staged proof/scope and route regression suites: **229 pass, 0 fail, 1,968 expectations across 15 files**. The semantic-production fixture compares canonical full and projected representations, rejects changed content/settings, observes actual missing-pair statuses (`ready`→`partial`→`factual`), and keeps current predictions coherent. The real synthetic-filesystem/SQLite stored-disposition test observes proposal score 3.5 vs persisted baseline 5, stale-source compensation, queued-writer invalidation, postcommit fresh proof, note-consent cases and cleanup-failure revocation; empty-rule scoring observer remains at zero contexts. This remains author-local evidence only; independent Phase 6 tester/reviewer and designer terminal gates are pending.

## Phase 6 independent-review correction round 1 (2026-10-04; daemon WIP)

The independent Phase 6 review returned CHANGES REQUIRED. P6-R01/R02/P6-R03 and V01 are recorded here for this correction round. Daemon-owned changes normalize analyst/reflection evidence comparisons to public game projections while keeping private source capture and private-note data out of projected outputs; public displayed-fitness results now return validated projected games while scoring from the full private capture; public same-revision snapshot checks compare canonical content, not only IDs/revision. `bggDataStale` is restored on scored/unscored list/detail mappings. Canonical V2 proof assertions replace the obsolete V1 proof-shape expectation while preserving profile persistence/reuse/invalidation assertions. The unified list's prior descending score ordering is restored using the actual current result scores.

- **P6-R01:** snapshot scoring returned private captured `Game` objects to public callers, causing analyst/reflection evidence consumers to reject the result. Scoring still uses the full private collection, but returned objects now come from the validated projected caller source; tests check projection parity and no owner-note/private canary leakage.
- **P6-R02:** public same-revision snapshot validation compared only revision and IDs. It now compares the full canonical projected content, accepts equivalent projected input, and rejects same-revision changes; separate private/proposed full-source fences are unchanged.
- **P6-R03:** scored/unscored detail and list response mappings omitted authoritative `bggDataStale`; mappings now preserve it.
- **P6-V01:** the reported 27 root failures were followed through the mapped daemon flows: projection/source parity, phase-3 disposition source/proposed authority, purchase score ordering, freshness fields, candidate availability after explicit BGG refresh, persisted wishlist acquisition, and obsolete V1 proof expectations. Shared/browser-only fixture failures remain parallel-lane owned and were not edited here.

Root-cause evidence: purchase-utilization's correct current scores were `[6, 4, 0]`; the unified list branch had omitted the established descending sort, placing score 4 after the genuine vetoed zero. The list ordering is corrected; the 2-file purchase/list focused test passed. Detail startup failures arose because detail capture used a pre-hydration startup source vector; the detail source loader now hydrates it before fencing. Wishlist persisted add received a valid factual candidate with `no-scoring-contribution`; the explicit BGG acquisition path now preserves candidate facts/unavailable prediction as nullable without fabricating score, while direct prediction remains strict. The V2 persistence shape is asserted without dropping proof-reuse or unavailable-cache checks.

Root causes are now resolved in daemon scope. The disposition recovery callback and test-app had attempted ordinary scoring with `attentionDispositions` stripped from a private captured collection; both now use the existing explicit proposed-collection capability, including its baseline/cache acceptance fence. The Phase 3 source-edit fixture now increments the collection revision when persisting changed contents; unchanged-revision content tampering remains rejected. The test that expects a candidate after clearing an existing disposition now exercises the private proposed-collection evaluation rather than weakening normal current-capture equality. For cache-closed/unopenable SQLite, the allowed coherent F-only result is available, but its semantic proof is rederived without the old cached component: the test asserts current proof output changes on close and no old semantic value remains. Prepared similarity now refuses to consider a cache capture current if it attempted a cache point read without a stable revision.

Correction-round local validation is green: the 14-path Phase 3/R01-R03/downstream daemon suite returned **172 passed, 0 failed, 3,393 expectations across 13 files**; the 22-path Phase 6 B/C/D critical suite returned **288 passed, 0 failed, 2,362 expectations across 20 files** (Bun reports only test-bearing files). `bun run typecheck`, targeted ESLint, targeted Prettier `--check`, and `git diff --check` passed. The focused suites included semantic production wiring/full-vs-projected content checks, proposed scoring/recovery and same-revision tamper behavior, game list/detail freshness and score-ordering, wishlist persistence/CRUD/refresh, profile/reflection/analyst evidence flows, V2 proof persistence/revalidation, staged scoring/run scopes, wishlist projection/routes, shared API proof validation, and CLI wishlist behavior. No whole-root suite was run in this author correction lane; the independent parent gate remains required. No commit, bead close, or Phase 6 acceptance is claimed.

## Phase 6C wishlist current projection binding WIP (2026-10-04)

The active daemon composition now injects the existing `UnifiedScoringService` into `WishlistService` from production `index.ts`, test-app and the app fallback factory. Current list/redundancy reads capture the saved wishlist through the common source frame, exclude collection-owned BGG IDs, calculate a wishlist consumer scope through the accepted unified kernel, and publish only through `publishCurrent`. Repeated stale publication retries are bounded; if a coherent source frame cannot be established, the service returns strict V2 `source-unavailable` results from the safe persisted entry metadata rather than any saved score. Missing verified candidate facts produce V2 `missing-source`. The flat `GET /wishlist` remains an array of safe legacy entry aliases, but those score/confidence/breakdown/preview fields are derived from the same current V2 calculation or null. The rich `/wishlist/redundancy` response now includes `{entry,prediction,redundancy}` with V2 current discriminants; no private `bggSource` field is projected. Explicit add/single refresh responses preserve their flat shape but return current score aliases after writing the verified compact source; they do not disclose private source or saved score fallback. Ordinary read paths use no BGG/provider hydration. Refresh progress/count behavior remains unchanged.

The shared barrel exports the V2 wishlist projection schemas/types/validators while retaining the separate browser-safe fitness response schema import. The active CLI `wishlist list` now validates and formats strict V2 results and distinguishes unavailable current predictions; add/single refresh print current aliases, never historic derived output.

Final C + critical B validation command `bun test packages/daemon/tests/wishlist-service.test.ts packages/daemon/tests/wishlist-current-http.test.ts packages/daemon/tests/wishlist-routes.test.ts packages/daemon/tests/wishlist-jev-phase7.integration.test.ts packages/daemon/tests/services/unified-wishlist-projection.test.ts packages/daemon/tests/services/unified-scoring-service.test.ts packages/daemon/tests/semantic-production-wiring.test.ts packages/daemon/tests/services/attention-candidate-service.test.ts packages/daemon/tests/services/collection-mutation-service.test.ts packages/shared/tests/wishlist-current-projection-v2.test.ts packages/shared/tests/semantic-scoring-input-proof-v2.test.ts packages/cli/tests/commands/wishlist.test.ts packages/cli/tests/commands/wishlist-current-projection.test.ts` passed **157 tests / 1,022 expectations across 13 files**. This includes the complete migrated `wishlist-service.test.ts` (**44/365**) preserving CRUD, refresh/BGG-source persistence, timestamps, acquisition transfer/reconciliation, errors, and cancellation while checking no saved score fallback when current sources are absent. The new production HTTP fixture uses temporary filesystem + real SQLite cache + `createTestApp`: seeded wishlist C_ONLY rows immediately change `/api/wishlist/redundancy` current score on an ordinary reread, flat aliases follow that result, and ordinary requests make zero BGG calls. The original factual-only HTTP test still proves Stage-0 score 7, missing-source unavailable/null aliases despite saved score 8.6, and no private source fields. Focused projection tests (`unified-wishlist-projection.test.ts` 288-712) cover actual veto zero, Stage-0 factual scoring, one cache-only P/S/R execution/current aliases, C-missing/F-available vs missing-facts unavailable/no fallback, and cache-judgment changes to current score. Real-storage scoring tests cover memo/repeated-row-read counts, cache mutation, and separation of cache-only owned calculation dependencies from wishlist-authorized pairs; B2 semantic/mutation suites retain revocation/restart/cleanup-failure fences.

`bun run typecheck`, scoped ESLint, scoped Prettier check, and `git diff --check` pass. `bun run build` first exposed a browser resolver incompatibility from the new shared barrel's `.js` suffix on the V2 module export; changed that one re-export to the repository's browser-resolvable extensionless form, preserving the extracted extensionless `fitness-result-response-schema` module import. The build then passed. No browser tests/typecheck were rerun and no web files were edited by this lane. This is still author-local Phase 6C evidence only; independent Phase 6 tester/reviewer and designer terminal gates are pending. Phase 6D run executor/controller remains untouched. No commit or Beads close occurred.

#### Phase 6C author WIP manifest

| File | State | SHA-256 |
|---|---|---|
| `packages/daemon/src/app.ts` | modified | `e860201819c822fda3e017f9a132f99ac6c34e3d6a88be96437a1c84c4d3133a` |
| `packages/daemon/src/index.ts` | modified | `55bf68ccb32d445f71a672f592bdbab59f29f0242d7cabd1382f624e7637f523` |
| `packages/daemon/src/routes/wishlist.ts` | modified | `396c3a06606ef905e5824f264bc38f0e46f18c606f57d05098cf9d428ccb3147` |
| `packages/daemon/src/services/wishlist-service.ts` | modified | `09cb35ec8c493aca81aba51e72ef561674d12c79bd0480f0a42165b6c173d2d4` |
| `packages/daemon/src/services/unified-wishlist-projection.ts` | modified | `6311f7120517ed4887611d5578357d7a9f28e9e9183db625167818012d06a8d9` |
| `packages/daemon/tests/helpers/test-app.ts` | modified | `622852cbef5f1ab85769d23c6996c1c7c4210d6d21d7f46826a36e0c1894aab3` |
| `packages/daemon/tests/wishlist-routes.test.ts` | modified | `d243ef87e99575498531ffdcb6c694a2eb8e59268abc3f07f3e91d6afdc99f92` |
| `packages/daemon/tests/wishlist-jev-phase7.integration.test.ts` | modified | `f891d8a204b7fc439e134a757fb468e703b3a8c327c3d4593f1fb4e866d0ce93` |
| `packages/daemon/tests/wishlist-current-http.test.ts` | new | `c0c7253f3ce486579eb47b9bdf949bda3c2e96979af789603f0fb9eeb1b415d2` |
| `packages/cli/src/commands/wishlist.ts` | modified | `3e43ef244f9738a4184411a5868196a68ea668d33237a22856eb20f72ef70b2e` |
| `packages/cli/tests/commands/wishlist.test.ts` | modified | `40a1bd88d97faf8a95002f86ab1d6323e58bd588312dd6d6df9411fd7c3e327e` |
| `packages/shared/src/index.ts` | modified | `720db862ebd6040281d61d3896a1f6911144835c1e31cd77d50731ccac2280f9` |

This was an earlier author working-tree manifest. C-final author hashes for the current API/service/test paths follow. Existing UI designer changes and unrelated Beads records were not edited. No acceptance, checkpoint, bead close, or D execution changes are represented by this log.
| untracked | `packages/daemon/tests/services/unified-scoring-service.test.ts` | `c68d753bf5af07cf7ed01b3cbe6b5d0a63a27d0ba35158f7ec6ee8697614be44` |

#### Phase 6C final author hash delta

| File | SHA-256 |
|---|---|
| `packages/daemon/src/services/wishlist-service.ts` | `09cb35ec8c493aca81aba51e72ef561674d12c79bd0480f0a42165b6c173d2d4` |
| `packages/daemon/src/routes/wishlist.ts` | `396c3a06606ef905e5824f264bc38f0e46f18c606f57d05098cf9d428ccb3147` |
| `packages/daemon/tests/wishlist-service.test.ts` | `0e013295174a43a34a85d8ae0b56c33cd2e48ea71f41362b31338fae5ffe2131` |
| `packages/daemon/tests/wishlist-current-http.test.ts` | `988a6b862e876b8439720a2d87844ca96c5678e78658211dabb1c3fad6de8ef9` |
| `packages/cli/src/commands/wishlist.ts` | `3e43ef244f9738a4184411a5868196a68ea668d33237a22856eb20f72ef70b2e` |
| `packages/cli/tests/commands/wishlist.test.ts` | `40a1bd88d97faf8a95002f86ab1d6323e58bd588312dd6d6df9411fd7c3e327e` |
| `packages/shared/src/index.ts` | `7d6c20c29f0f12e8d3a2103eac16dcf32f343cd4867d926a3d6c80c0f956a9bd` |
| `packages/shared/src/wishlist-current-projection-v2.ts` | `8524b250eaf3141c1460fb2e617eb87d370772e931a7a85344c6db506fd1f0bf` |
| `packages/shared/src/fitness-result-response-schema.ts` | `047edd5cd2672640df2fe8d864af25177032c983e0a37b132bf422bae7b60b4c` |

## Phase 6D frozen explicit-run binding WIP (2026-10-04)

Production run preview now uses `prepareUnifiedJevRun()` over the injected `UnifiedScoringService`: one captured frame and common P→cache-only S→fitness→R calculation yields frozen exact authorized pairs. The controller stores that same preparation in its process-local authorization record and start consumes it rather than recalculating/planning a new scope. The collection scope adapts exact authorized collection-domain P∪R pairs into indexed membership; wishlist scope uses only authorized wishlist-candidate pairs, while owned collection P dependencies remain calculation-only and never enter wishlist U0. Current source/policy/generation identity is refreshed before start/admission/checkpoint; cache revision changes do not expand or revoke the source-only frozen run authorization. Calculation/cache freshness remains independently fenced. No run preparation path hydrates BGG or calls a provider; wishlist preview only uses the explicit existing verified-source hydration step. Empty/unavailable wishlist pairs are retained as frozen scope entries and do not become provider inputs.

The real temp-filesystem + SQLite production composition regression (`unified-jev-run-production.test.ts`) observes collection U0=4 (including the previously-owned rated prediction reference) and wishlist U0=3, with note transmission denied for wishlist. It inserts a valid collection C-only judgment after preview; start retains pairCount=4, records one cache hit, and sends only the other three pairs. Wishlist sends exactly its own three candidate-domain pairs; the fake BGG client is configured to fail if run prep hydrates. A source edit after a later preview rejects its token before further provider calls. `jev-run-scope.test.ts` now directly verifies exact frozen membership/iteration and that an absent pair in the endpoint Cartesian universe cannot be looked up or iterated.

Local D + critical B/C regression command: `bun test packages/daemon/tests/unified-jev-run-production.test.ts packages/daemon/tests/services/jev-run-scope.test.ts packages/daemon/tests/services/jev-run-controller.test.ts packages/daemon/tests/services/jev-run-service.test.ts packages/daemon/tests/services/jev-run-source-adapter.test.ts packages/daemon/tests/jev-run-composition.test.ts packages/daemon/tests/services/staged-similarity-scope.test.ts packages/daemon/tests/services/unified-scoring-service.test.ts packages/daemon/tests/services/unified-wishlist-projection.test.ts packages/daemon/tests/semantic-production-wiring.test.ts packages/daemon/tests/routes/prediction.test.ts packages/daemon/tests/services/prediction-service.test.ts packages/daemon/tests/services/displayed-fitness-service.test.ts packages/daemon/tests/services/collection-snapshot-service.test.ts packages/daemon/tests/wishlist-jev-phase7.integration.test.ts packages/daemon/tests/wishlist-routes.test.ts packages/daemon/tests/wishlist-service.test.ts packages/daemon/tests/services/wishlist-redundancy-scoring.test.ts packages/daemon/tests/services/wishlist-candidate-read-proof.test.ts packages/shared/tests/wishlist-current-projection-v2.test.ts packages/shared/tests/semantic-scoring-input-proof-v2.test.ts packages/cli/tests/commands/wishlist.test.ts` — **288 pass, 0 fail, 2,358 expectations across 20 files**. Performance/index regression command (`wishlist-candidate-read-proof`, `wishlist-redundancy-scoring`, `jev-pair-read-proof`, staged scope/proof, exact Jev scope and unified-scoring service suites) passed **56 tests / 513 expectations across 7 files**; retains existing indexed candidate/vector and pair-workload evidence, plus the new exact-scope membership regression. `bun run typecheck`, scoped ESLint, scoped Prettier check, and `git diff --check` pass for the D backend paths. One initial scoped check caught formatting and two lint issues (runtime array narrowing in selection normalization; async fake fetch lacking an await); both were corrected and all listed checks now pass.

Author-local D manifest paths: `packages/daemon/src/index.ts`, `packages/daemon/src/services/jev-run-controller.ts`, `packages/daemon/src/services/jev-run-scope.ts`, `packages/daemon/src/services/jev-run-service.ts`, new `packages/daemon/src/services/unified-jev-run-preparation.ts`, `packages/daemon/src/services/wishlist-run-preparation.ts`, `packages/daemon/tests/services/jev-run-scope.test.ts`, new `packages/daemon/tests/unified-jev-run-production.test.ts`, and `packages/shared/src/types.ts` (exact frozen-pair disclosure comment). This is writer-local evidence only; Phase 6 remains unaccepted until parent reconciliation, independent whole-phase test/review, and designer's UI gate. No web edits, commit, bead close, Phase 7 start, or deployment occurred.

#### Phase 6D author WIP hashes

| File | Working-tree status | SHA-256 |
|---|---|---|
| `packages/daemon/src/index.ts` | modified | `ac558028681137bbe91b247e6ce6cdb10f6dfd2b06633acced7b94fdc7a7ff27` |
| `packages/daemon/src/services/jev-run-controller.ts` | modified | `9f5e371f18cbcf35cb676731b293336ebe37eff5216b688b4436c6beeeab2de9` |
| `packages/daemon/src/services/jev-run-scope.ts` | modified | `26e9816e1691dacaadbb6a52cace9c9ce3c325509cb04d6bc02cdc2eca42f454` |
| `packages/daemon/src/services/jev-run-service.ts` | modified | `97e8c7dd60f66bf8d7aee0f682dc0c10a62f78541127f5c8573013095c06a7c6` |
| `packages/daemon/src/services/unified-jev-run-preparation.ts` | new | `49bae5e402472ff81c68c06796fc33483aaf5105ca8960fd7fb556b960bd31a1` |
| `packages/daemon/src/services/wishlist-run-preparation.ts` | modified | `72b3dcbad9e829c4d248a561ad4c389fab22d9bae5262ebdb687edc9ad755ec1` |
| `packages/daemon/tests/services/jev-run-scope.test.ts` | modified | `b1517f453a0b8baaa81b8df6276eba5e216e7436ee255818c348a38bfbd9c862` |
| `packages/daemon/tests/unified-jev-run-production.test.ts` | new | `ce715eb02b4fddbd54764b8a3b8dad894c1c4396f353170496ee00a87822781d` |
| `packages/shared/src/types.ts` | modified | `5a2c47908a8b8f25c3c3ddf7d93003e4953807808a099919f6b755cb6d834c09` |

## Phase 6 correction round 2 — cold reflection source-vector startup (2026-10-04; author WIP)

Confirmed the previously reported cold-start failure using a direct `createReflectionProjectionSnapshotService.capture()` on a plain, not-yet-hydrated `createTestApp()` before any profile/scoring read. The initial source vector reported `available: false` and the `startup` unavailable marker; before this correction capture threw `Displayed fitness snapshot differs from current capture: ` (empty diagnostic suffix), because the preloaded startup vector was captured before displayed-fitness triggered source-vector initialization and changed the token. Diagnostics and tests recorded only availability/marker/token state, not private source contents.

`capture()` now checks source-vector startup markers inside the existing source coordinator before loading collection or dependent inputs. Only a startup/startup-hydration marker invokes the existing `hydrateSourceVector()`; collection (which can migrate storage), settings, and other snapshot inputs are loaded afterward, and the used vector is captured after those reads. Incomplete/unavailable startup hydration and initialization failures propagate instead of producing a successful snapshot. This is conditional startup initialization, not BGG hydration, model inference, or an ordinary-read refresh. A cold-capture regression checks one initialization and equality with the subsequent warm fingerprint; additional tests check failed initialization, same-revision private collection changes still rejected, and passive reflection/profile/note/game reads invoke neither model nor BGG methods.

Exact focused command `bun test packages/daemon/tests/routes/profile-reflections.test.ts packages/daemon/tests/services/reflection-evidence-service.test.ts packages/daemon/tests/semantic-production-wiring.test.ts packages/daemon/tests/services/unified-scoring-service.test.ts`: **45 pass, 0 fail, 2,708 expectations across 4 files**. Full root `bun run test`: **3,904 pass, 1 skip, 0 fail, 23,478 expectations across 246 files**. `bun run typecheck` passed. Scoped `bunx eslint packages/daemon/src/services/reflection-evidence-projections.ts packages/daemon/tests/routes/profile-reflections.test.ts packages/daemon/tests/services/reflection-evidence-service.test.ts`, scoped `bunx prettier --check` on the same three paths, and `git diff --check` passed. The final root test log is `/home/rjroy/.local/share/opencode/shell/943e0ce5bcefd43a9d07e2e2713f433f9948db61/sh_106fd0218001CtSgjPh33U3382.out`.

#### Correction-round source/test manifest (working tree; note is intentionally self-unhashed)

| File | State | SHA-256 |
|---|---|---|
| `packages/daemon/src/services/reflection-evidence-projections.ts` | modified | `76adf60fc5f96835f6eec99a087e2ef163de5b4b44b2fb62d9f370848370b667` |
| `packages/daemon/tests/routes/profile-reflections.test.ts` | modified | `aa28a0cea6a1423178698a86c2f61127cfd6414dc5471f9adeb4648142ba9e63` |
| `packages/daemon/tests/services/reflection-evidence-service.test.ts` | modified in Phase 6 WIP; included in the requested scoped test/review boundary | `59503f3cf735201bb7106d609de555410daa4011389671b56472cf7caed6ed97` |

This is local author evidence only. Phase 6 remains unaccepted pending parent whole-phase independent gates; no commit, bead close, or deployment occurred. No shared/web/CLI files or unrelated Beads records were edited in this correction round.

## Phase 6 independent acceptance and checkpoint record (2026-10-04)

Phase 6 is accepted after whole-phase reconciliation. Final independent tester: `bun run test` **3,904 pass, 1 skip, 0 fail, 23,478 expectations across 246 files**; cold-start focused run **45 pass, 0 fail, 2,708 expectations**. Final typecheck, scoped lint/format, root format check, production build, and diff check passed. Previously reused designer evidence includes the 136-test browser suite across all four projects, 9 UI unit tests / 38 expectations, rendered-link coverage, and successful browser typecheck/build. Independent review closed R01 (public projection returned full private games), R02 (same-revision collection-content equality), R03 (freshness mapping), and V01 (cold startup-vector capture); designer activation gate passed. The final independent evidence applies to the exact accepted source/test manifest below, not a broader claim about Phase 7.

The independently recorded start/end manifests are `/tmp/opencode/phase6-independent/final-start-manifest.txt` and `/tmp/opencode/phase6-independent/final-end-manifest.txt`; both record base HEAD `50ca71387c5875dec15636d42afbcf9e014c3857`, final accepted diff SHA-256 `d9f48b6d0e6058f86a4afb2817574e1c45cd4050dd22e5fb0fedadffe93846e2`, and pre-admin Beads export SHA-256 `096e558c39fea93d3ff61111f927bfa65861061cb22132f5c4f30c85c1451a82`. All 68 accepted source/test file hashes in both manifests were checked against the working tree and matched; the complete diff SHA also matched before these administrative notes/Beads updates. The accepted manifest includes daemon, shared, CLI and designer-owned web source/tests, including all untracked additions and the deleted web test. The notes file is an administrative/self-hash exception. Unrelated `shelf-judge-0xhp`, `shelf-judge-uf1p`, and `shelf-judge-06hh` records remain excluded from the checkpoint.

The bead `shelf-judge-bs1y.6` is closed for this accepted atomic activation. Parent epic remains in progress. Phase 7 was started only after verifying checkpoint `b16c044558923e999c4a36649a9452f7a5617d2c`, branch `feat/unified-similarity-prediction-redundancy`, and claiming `shelf-judge-bs1y.7`. No push, merge, or Dolt remote synchronization is authorized.

## Phase 7 local evidence audit (2026-10-04; author-local, not acceptance)

Phase 7 is in progress. This lane reviewed existing test assertions before adding coverage and did not find a missing daemon assertion that justified duplicating tests. The four approved reference documents are being reconciled by their separately authorized writer; this lane did not edit them. The current working tree includes those other-lane reference edits and pre-existing Beads export dirt; they are not part of this lane's test/notes manifest.

Focused command from the approved Phase 7 plan, including the production composition and indexed wishlist membership proof suites:

```sh
bun test packages/daemon/tests/wishlist-jev-phase7.integration.test.ts packages/daemon/tests/semantic-production-wiring.test.ts packages/daemon/tests/jev-run-composition.test.ts packages/daemon/tests/services/jev-pair-cache-service.test.ts packages/daemon/tests/wishlist-candidate-read-proof.test.ts
```

Result: **58 passed, 0 failed, 554 expectations across 5 files**. The run includes synthetic temporary filesystem/real SQLite integration with fake provider transport; no live provider, host database or private owner data was used. The expanded command below additionally includes the production frozen-scope composition and the existing exact performance-counter suites.

### Phase 7 obligation-to-evidence map

| Obligation | Existing assertion evidence audited | Phase 7 local status |
|---|---|---|
| Synthetic storage, persisted judgments/progress, restart/reopen, all-hit zero gateway | `wishlist-jev-phase7.integration.test.ts` uses temporary storage/SQLite, refreshes and runs via fake client, reopens services, checks offline reads make no BGG observations, then verifies a fully cached rerun has zero additional provider calls. `services/jev-pair-cache-service.test.ts` checks atomic checkpoint reopen and rollback on SQLite failure. | Focused command green |
| Cancellation, stale source/permission fences, bounded serial provider calls | `jev-run-composition.test.ts` checks stale note/consent preview rejection before gateway, cancellation while fake transport is held, canceled run writes no judgment and settles interrupted, maximum concurrent requests is one, and startup recovery interrupts prior progress without inference. `semantic-production-wiring.test.ts` covers source revocation/restart/cleanup failure and private-data boundaries. | Focused command green |
| Frozen production P∪R authorization and wishlist separation | `unified-jev-run-production.test.ts` runs real test-app composition: collection preview has 4 exact authorized pairs (P includes a previously-owned rated reference; R-only universe has 3); wishlist preview has 3 authorized candidate-domain pairs and excludes calculation-only owned dependencies. Execution after cache growth completes only the previewed pair count; source mutation after preview rejects start. | Existing production pair-count/scope assertions retained; focused composition file was also in the baseline run |
| 7 unique encodes / 12 relevant comparisons; 4×3; indexed vector reuse | `wishlist-redundancy-scoring.test.ts` “one capture builds one factual context, memoizes vectors, and visits only candidate-owned pairs” asserts 7 encodings and 12 pairs for 4 candidates × 3 owned refs. `unified-collection-pipeline.test.ts` asserts one index build for 24 targets × 3 references (72 exact indexed pairs). | Existing operation-count assertions; no duplicate test added |
| 124 eligible-owned members, six membership probes, unchanged proof has zero rereads | `wishlist-candidate-read-proof.test.ts` “membership proof probes stay constant as the full eligible set grows” asserts eligible set size 124, 3 candidate + 3 owned probes over 3 rows (six total, not 124 probes). Companion unchanged-proof/currentness tests assert no additional point lookup on unchanged proof and invalidation on authority/revision changes. | Included in focused command; green |
| Pair/signal memoization, no full-cache enumeration, deduplicated P∪R | `staged-similarity-scope.test.ts` checks `authorizedPairs.length = predictionPairs.length + redundancyPairs not already in predictionPairs`, plus three exact authorized wishlist candidate pairs and seven indexed cache lookups for the broader calculation-only/P/R fixture. `unified-jev-run-production.test.ts` confirms the production preview/execution pair counts and wishlist-domain isolation: frozen U0 is 4 rather than the 3-pair R-only subset and still executes 4 after a cache checkpoint. Pair read-proof and cache suites exercise point-lookup/index paths (no list/enumeration API). | Existing exact union cardinality and production scope assertions audited; raw cache-scan is not presented as a numeric counter |
| Strict V2/current output, no private payload, unavailable/current source semantics | `semantic-production-wiring.test.ts`, `wishlist-jev-phase7.integration.test.ts`, and accepted Phase6 coverage in the preceding section exercise current proof/schema validation, unavailable/source-revoked behavior, note revocation including restart/cleanup failure, no saved-score fallback, and public projections without private facts. | Focused regressions green; Phase6 acceptance evidence cited, not rerun as a substitute for parent gates |
| Four named reference reconciliations and all final gates | `.lore/reference/specs/fitness/prediction-engine.md`, `redundancy-scoring.md`, `features/wishlist.md`, and `current/owner-game-notes.md` are owned by the parallel reference lane. Approved plan requires root test/typecheck/browser typecheck/lint/format/build and complete unfiltered browser run, plus independent tester/reviewer/designer gates. | Pending; not claimed by this author-local run |

Phase 7 remains open/in progress, with no code/test changes or checkpoint commit made by this evidence-audit pass. The focused result is local writer evidence only; parent reconciliation and independent gates remain mandatory. No unrelated beads were edited, and no push, merge, deploy, or remote sync occurred.

### Expanded local validation (2026-10-04)

```sh
bun test packages/daemon/tests/wishlist-jev-phase7.integration.test.ts packages/daemon/tests/semantic-production-wiring.test.ts packages/daemon/tests/jev-run-composition.test.ts packages/daemon/tests/services/jev-pair-cache-service.test.ts packages/daemon/tests/wishlist-candidate-read-proof.test.ts packages/daemon/tests/unified-jev-run-production.test.ts packages/daemon/tests/wishlist-redundancy-scoring.test.ts packages/daemon/tests/services/unified-collection-pipeline.test.ts packages/daemon/tests/services/staged-similarity-scope.test.ts packages/daemon/tests/services/jev-pair-read-service.test.ts
```

Result: **93 passed, 0 failed, 939 expectations across 10 files**. Additional audited coverage is `wishlist-redundancy-scoring.test.ts` (7 unique encodes, 12 candidate-owned pairs, one factual context/index for 4×3); `unified-collection-pipeline.test.ts` (one index build, 72 indexed/consumed pairs for 24×3, with each target lookup visiting exactly 3); `staged-similarity-scope.test.ts`'s explicit deduplicated P∪R cardinality equation; and `jev-pair-read-service.test.ts` proof reuse/currentness counters. No new test was warranted by this audit.

Other completed local checks:

- `bun run typecheck` — passed (shared, daemon and CLI TypeScript projects).
- Scoped `bunx eslint` for the eight focused daemon test files — passed.
- Scoped `bunx prettier --check` for this note and the eight focused test files — passed.
- `git diff --check` — passed.
- No production sources or tests were modified in this pass; only this notes file changed in the author lane. At the time of this initial evidence audit, the four reference edits were from the parallel documentation lane; the subsequent authorized documentation-correction round is recorded below. `.beads/issues.jsonl` remains subject to selective Beads administration only. Phase 7 remains IN_PROGRESS and no commit/close occurred.

## Phase 7 documentation correction round 1 (2026-10-04)

The Phase 7 tester/reviewer/designer runs are terminal. Final tester evidence: full root suite **3,904 passed, 1 skipped, 0 failed, 23,478 expectations across 246 files**; complete unfiltered browser suite **432 passed, 60 skipped, 0 failed across four projects**, log `/tmp/opencode/phase7-browser/full-browser.log`; both TypeScript gates, lint, format, diff and production build passed. The independent source inventory found **579 runtime source/test files unchanged** and all matched `/tmp/opencode/phase7-independent/end-source-test-hashes.txt`. Designer gates are terminal. Reviewer findings P7-R01/R02/R03 and prior implementation findings R01/R02/R03/V01 are closed. No runtime/source/test files changed.

| Finding | Correction | Source authority checked |
|---|---|---|
| P7-R01 — wishlist response contract (closed) | Distinguished flat `GET /api/wishlist` legacy-alias array, rich `GET /api/wishlist/redundancy` `{entry,prediction,redundancy}` rows, add/single-refresh `{entry}` responses, refresh-all `{refreshed,errors}`, and the CLI list's use of the rich endpoint. CLI add/single-refresh unwrap their entry for output. Clarified no historical fallback and no private `bggSource` in public entries. | `packages/daemon/src/routes/wishlist.ts:20-47,49-115`; `packages/daemon/src/services/wishlist-service.ts:205-245,248-300,327-383,385-453`; `packages/cli/src/commands/wishlist.ts:9-21,24-50,111-129` |
| P7-R02 — wishlist explicit-run scope (closed) | Marked prior owner-note amendment scope/fallback text as historical and linked current authority. Active scope is exact frozen, deduplicated `U0=Pscope∪Rscope`; P includes eligible actual-rated references including previously-owned, R only current owned positive non-veto members; cache-only owned prediction dependencies do not authorize inference. Replaced the disputed sentence with the reviewer-approved wording: “Cache growth cannot expand the currently authorized U0; newly eligible work requires a fresh preview and authorization.” | `.lore/work/design/unified-similarity-prediction-redundancy.md:70-77`; `.lore/reference/specs/features/wishlist.md` current authority/run clauses; `.lore/reference/specs/fitness/prediction-engine.md:60-68` |
| P7-R03 — redundancy arithmetic (closed) | Added the active raw-penalty denominator and independent rounding contract; explicitly marked legacy neighbor-count-only formula steps superseded. Preserved historical section discoverability. | `packages/daemon/src/services/unified-collection-pipeline.ts:496-520`; `packages/daemon/tests/services/unified-collection-pipeline.test.ts:386-401` (raw 1.125, displayed 1.13, adjusted 3.88) |

The current-source corrections are limited to exactly these four approved references: `.lore/reference/specs/features/wishlist.md`, `.lore/reference/specs/current/owner-game-notes.md`, `.lore/reference/specs/fitness/redundancy-scoring.md`, and `.lore/reference/specs/fitness/prediction-engine.md`. This final wording-only update changed the one authorized sentence in `wishlist.md`; the other three reference files remain byte-identical to their preceding manifest hashes. Approved design/plan statuses were not changed. No code/test, web/shared/CLI or other-reference edits were made. The verification manifest is `/tmp/opencode/phase7-doc-correction/final-manifest.txt`; it records base HEAD and SHA-256 of those four files plus this notes file. The note's hash is an administrative/self-hash exception to its own manifest entry.

The accepted reference manifest supplied for final reconciliation had SHA-256 `2fb9e89b3de0939b8ad21766ff0d1ad61a872328719fec9ebbb6e34bc103a4d2`; its four reference hashes match the accepted values, and the 579-file source/test inventory matched exactly. Scoped note/reference Prettier and `git diff --check` passed after these administrative updates. Phase 7 checkpoint `7f67a2569ca8d72b47a95fabdac109f83d5a2f81` (`docs(shelf-judge-bs1y.7): reconcile accepted authority`) is recorded, and all seven phase children are closed. The epic is closed in Beads with the completed shared F/D/O collection-and-wishlist scoring work and all final gates documented; this separate epic-closure checkpoint records only its Beads row/interaction and these notes. The final notes hash is regenerated in `/tmp/opencode/phase7-doc-correction/final-manifest.txt`, with the note entry treated as an administrative/self-hash exception. No push, merge, or Dolt remote synchronization occurred.
