---
title: "Simplification notes: accumulated code cleanup"
date: 2026-10-05
status: in_progress
tags: [simplification, cleanup, similarity, wishlist, privacy]
source: .lore/work/plans/unified-similarity-prediction-redundancy.md
modules: [daemon-services, wishlist, jev-cache]
---

# Simplification notes: accumulated code cleanup

## Scope

Two bounded checkpoints remove disconnected cleanup debt while keeping the live unified scoring and privacy contracts. No synthetic publication replacement was introduced.

## Verified checkpoint: `shelf-judge-iyoj` (`9c385c0`)

Removed the disconnected legacy wishlist scorer and resolver-only capture machinery, their tests, unused dependency injection, and resolver fixtures. Retained the live candidate `C_ONLY` row validator and request type. Net source/test diff: −1,323 lines. Root tests passed (3,924 passed, one existing skip); independent review accepted the checkpoint.

## Current checkpoint: `shelf-judge-zeq6`

Removed the synthetic staged publication module and its fake derived-artifact schema/read/write, ranking, cleanup-failure, and restart subsystem. Simplified proof tests to focus on source capture, prepared evidence, and proof identity. Split caller-input immutability from independent durable-identity comparisons against a pristine baseline. Existing production-boundary tests cover stale publication rejection, durable revocation/cleanup failure, re-enable fencing, and Profile reconstruction after note changes. Added a focused unified-scoring read after durable revocation with injected SQLite cleanup failure: stale `SHARED_CD` evidence is rejected while retained wishlist `C_ONLY` remains readable.

Proof obligations retained/mapped:

- `SHARED_CD` C remains note-dependent when owner-note weight is zero: prepared-similarity proof test.
- Revocation invalidates the old capture; recapture rejects note-dependent evidence and preserves wishlist `C_ONLY`: actual unified-scoring/storage/cache test.
- Proof identity survives a process epoch change, but changes when demanded evidence changes: prepared-similarity proof test.
- With the same pristine capture and exact demand, changing a valid cached row to one with a mismatched source dependency fingerprint yields `invalid-row` and changes `examinedComponentsIdentity`: focused prepared-similarity proof test restored for review blocker ZEQ6-R1.
- Durable proof comparisons use a pristine baseline for each source-field change: dedicated proof identity test.
- Durable cleanup failure, re-enable fencing, stale `publishCurrent`, and persisted Profile reconstruction remain in collection mutation, unified scoring, and Profile service tests.

The affected proof suite passes 9 tests; scoped typecheck, lint, format, and `git diff --check` pass. The earlier combined proof/Profile/collection-mutation/unified-scoring gate passed 74 tests before this test-only correction; that combined command has not been rerun. The synthetic subsystem removal is 138 lines; proof-test changes are net −293 lines; the real-boundary test adds 210 net lines (tracked code/test diff net −221 lines). Independent final branch gates and review remain pending; no final review acceptance is claimed.
