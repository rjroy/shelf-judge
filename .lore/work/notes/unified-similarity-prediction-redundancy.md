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

The user approved the linked design and seven-phase plan and authorized implementation. The execution branch is `feat/unified-similarity-prediction-redundancy`; Phase 1 is checkpointed at `c32cb3d5e63328177bcec169507f73a070c24627` from the approved-doc base `084936ca29c17c36b0e652e1173bcdc93209d3e3`. Phases 1 and 2 are accepted; the epic remains in progress. Phase 3 is ready but unclaimed/not started and cannot begin before Phase 2's bead-ID checkpoint is committed and reconciled. No later phase has started.

| Phase | Status | Gate before next phase |
| --- | --- | --- |
| 1 — baseline, shared math, settings assembler | Accepted; checkpointed with `shelf-judge-bs1y.1` | Phase 1 checkpoint `c32cb3d5` verified before Phase 2 began |
| 2 — source capture, cache-only resolver, proof/revocation | Accepted (`shelf-judge-bs1y.2`; checkpointing now) | Phase 2 bead-ID checkpoint committed and reconciled before Phase 3 starts |
| 3 — pair scope and frozen run | Ready, unclaimed; not started | Phase 2 accepted checkpoint committed and terminal handoff verified |
| 4 — staged predictor and real numeric pipeline | Not started | Phase 3 verified checkpoint |
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
| R1 — one factual formula F and common weighted S; missing versus valid-zero semantics | 1 | `unified-similarity.test.ts`: defaults, non-default ratio, partial normalization, valid zero, all unavailable; current phase in progress |
| R2 — existing settings are sole weights; semantic enablement/note permission and penalty-toggle separation | 1 | Staged settings-assembly tests and real storage round-trip/reopen; `stored-source-revision.test.ts` baseline covers zero/zero→4:3 and personal-axis stripping; current phase in progress |
| R3 — prediction and redundancy exact-pair parity; same prediction algorithm | 4, then 6 | Staged shared-predictor numeric parity and activation consumer comparison; not started |
| R4 — factual context from full collection, no personal-axis/rating leakage | 4 | Real staged collection prediction fixture and axis/reference isolation; not started |
| R5 — purpose-specific reference pools and exact prediction eligibility | 3–4 | Exact P/R scope fixture then real pipeline test; not started |
| R6 — deduplicated, previewed, frozen authorized pair universe | 3 | Injected-fitness scope test for P∪R, overlap, self exclusion, frozen authorization; not started |
| R7 — indexed cache-only reads, pair memoization and bounded execution | 2–3, 7 | Phase 2 indexed point reads, candidate indexing/vector dedupe, and stale-cache tests accepted; run-scope and composed production performance gates remain Phase 3/7 |
| R8 — proof identity/currentness and source publication fence | 2, 6 | Staged V2 identity, every examined component, currentness/read/publication boundary accepted; production acceptance remains Phase 6 |
| R9 — transitive note-permission revocation and fail-closed publication | 2, 6–7 | Staged SHARED_CD/O=0, indirect wishlist artifact, cleanup-failure/restart, and whole-recompute fixture accepted; real production lifecycle remains Phase 6/7 |
| R10 — current prediction and redundancy result contracts / wishlist consumers | 5–6 | Staged API/view-model contract, designer-owned view, then atomic client binding; not started |
| R11 — no unsafe saved-derived fallback; unavailable means unavailable | 5–6 | Staged projection tests and live route/client activation tests; not started |
| R12 — explicit-run budgets, cancellation and atomic checkpoints | 2–3, 7 | Source/run contract tests and composed daemon integration tests with fake providers; not started |
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
