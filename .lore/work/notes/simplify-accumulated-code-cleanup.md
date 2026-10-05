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

## Verified checkpoint: `shelf-judge-zeq6` (`c2df627`)

Removed the synthetic staged publication module and its fake derived-artifact schema/read/write, ranking, cleanup-failure, and restart subsystem. Simplified proof tests to focus on source capture, prepared evidence, and proof identity. Split caller-input immutability from independent durable-identity comparisons against a pristine baseline. Existing production-boundary tests cover stale publication rejection, durable revocation/cleanup failure, re-enable fencing, and Profile reconstruction after note changes. Added a focused unified-scoring read after durable revocation with injected SQLite cleanup failure: stale `SHARED_CD` evidence is rejected while retained wishlist `C_ONLY` remains readable.

Proof obligations retained/mapped:

- `SHARED_CD` C remains note-dependent when owner-note weight is zero: prepared-similarity proof test.
- Revocation invalidates the old capture; recapture rejects note-dependent evidence and preserves wishlist `C_ONLY`: actual unified-scoring/storage/cache test.
- Proof identity survives a process epoch change, but changes when demanded evidence changes: prepared-similarity proof test.
- With the same pristine capture and exact demand, changing a valid cached row to one with a mismatched source dependency fingerprint yields `invalid-row` and changes `examinedComponentsIdentity`: focused prepared-similarity proof test restored for review blocker ZEQ6-R1.
- Durable proof comparisons use a pristine baseline for each source-field change: dedicated proof identity test.
- Durable cleanup failure, re-enable fencing, stale `publishCurrent`, and persisted Profile reconstruction remain in collection mutation, unified scoring, and Profile service tests.

The affected proof suite passes 9 tests; scoped typecheck, lint, format, and `git diff --check` pass. Before `c2df627`, root tests passed (3,926 tests) and all assigned gates passed. Independent final review accepted this checkpoint, including the restored mismatched-source-fingerprint proof case. The synthetic subsystem removal is 138 lines; proof-test changes are net −293 lines; the real-boundary test adds 210 net lines (tracked code/test diff net −221 lines).

## Current checkpoint: `shelf-judge-72p2`

Pending independent final validation and review; no acceptance is claimed. This test-only cleanup removes equivalent checks while retaining the stronger contract coverage:

- Collection mutation: removed the duplicate factual-weight purge case; the retained test asserts the epoch and fingerprint change, both derived artifacts are purged, and wishlist bytes are unchanged.
- Wishlist publication: removed the weaker extra-owned-BGG-ID case; the retained case verifies filtering in both list APIs.
- JEV gateway: replaced repeated malformed-response blocks with named, separately identified cases for malformed score/probability/schema/envelope/answer/model shapes and partial C+D responses, preserving reason/path/error classification and safe-log redaction checks. Retained scalar/distribution disagreement as its own case.
- Run controller: corrected the stale “until executor exists” title; its successful start, currentness, and stale-precondition assertions remain.
- Staged scope: removed only wishlist-domain assertions subsumed by stronger domain-plus-candidate checks. Kept collection calculation dependencies distinct from wishlist authorization, D-only calculation allowance, cache-currentness vs frozen authorization, and later-preview membership. Separated selection behavior from wishlist-pair immutability; collection and wishlist each test callback and returned prediction/authorization pair immutability, stable pair keys, and unchanged authorization identity.

Targeted validation with Bun 1.4.0 and API-key/debug variables unset: five suites passed (153 tests); daemon typecheck, scoped ESLint, scoped Prettier check, and `git diff --check` pass. Independent final branch gates and review remain pending.

Current diff size: test changes net −78 lines; this note adds 14 lines net; total diff net −64 lines. No production files changed.
