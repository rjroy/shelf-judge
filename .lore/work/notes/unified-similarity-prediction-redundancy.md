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

The user approved the linked design and seven-phase plan and authorized implementation through `shelf-judge-bs1y.1`. Work is restricted to Phase 1. The execution branch is `feat/unified-similarity-prediction-redundancy`, based at `084936ca29c17c36b0e652e1173bcdc93209d3e3`. Phase 1 is claimed and in progress; the epic `shelf-judge-bs1y` is in progress. No later phase has started. Do not begin Phase 2 until Phase 1 has passed its independent test/review gates and has its bead-ID checkpoint commit.

| Phase | Status | Gate before next phase |
| --- | --- | --- |
| 1 — baseline, shared math, settings assembler | Accepted; checkpointed with `shelf-judge-bs1y.1` | Acceptance evidence recorded below; do not begin Phase 2 until this checkpoint is verified |
| 2 — source capture, cache-only resolver, proof/revocation | Not started | Phase 1 verified checkpoint |
| 3 — pair scope and frozen run | Not started | Phase 2 verified checkpoint |
| 4 — staged predictor and real numeric pipeline | Not started | Phase 3 verified checkpoint |
| 5 — staged wishlist/API/client adapters | Not started | Phase 4 verified checkpoint |
| 6 — atomic production activation | Not started | Phase 5 verified checkpoint |
| 7 — integration, performance, authority reconciliation | Not started | Phase 6 verified checkpoint |

Every phase is sequential. A validation or commit blocker stops work before the next phase. Each verified future phase gets one local checkpoint commit containing only its bead's files and relevant Beads metadata, with the bead ID in the message. No empty commit, push, merge or remote synchronization is authorized. This record does not claim Phase 1 acceptance or authorize production wiring.

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
| R7 — indexed cache-only reads, pair memoization and bounded execution | 2–3, 7 | Resolver point-read/proof reuse tests; final operation-count evidence against baseline; not started |
| R8 — proof identity/currentness and source publication fence | 2, 6 | V2 proof/validator tests and production acceptance/fence tests; not started |
| R9 — transitive note-permission revocation and fail-closed publication | 2, 6–7 | Staged publication/revocation tests, then real temporary-FS/SQLite composition tests; not started |
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
