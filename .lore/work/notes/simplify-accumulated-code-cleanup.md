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

## Verified checkpoint: `shelf-judge-72p2` (`c2f59ae`)

Review accepted; root tests passed (3,942 tests) and all assigned gates passed before checkpoint `c2f59ae`. This test-only cleanup removed equivalent checks while retaining the stronger contract coverage:

- Collection mutation: removed the duplicate factual-weight purge case; the retained test asserts the epoch and fingerprint change, both derived artifacts are purged, and wishlist bytes are unchanged.
- Wishlist publication: removed the weaker extra-owned-BGG-ID case; the retained case verifies filtering in both list APIs.
- JEV gateway: replaced repeated malformed-response blocks with named, separately identified cases for malformed score/probability/schema/envelope/answer/model shapes and partial C+D responses, preserving reason/path/error classification and safe-log redaction checks. Retained scalar/distribution disagreement as its own case.
- Run controller: corrected the stale “until executor exists” title; its successful start, currentness, and stale-precondition assertions remain.
- Staged scope: removed only wishlist-domain assertions subsumed by stronger domain-plus-candidate checks. Kept collection calculation dependencies distinct from wishlist authorization, D-only calculation allowance, cache-currentness vs frozen authorization, and later-preview membership. Separated selection behavior from wishlist-pair immutability; collection and wishlist each test callback and returned prediction/authorization pair immutability, stable pair keys, and unchanged authorization identity.

Targeted validation with Bun 1.4.0 and API-key/debug variables unset: five suites passed (153 tests); daemon typecheck, scoped ESLint, scoped Prettier check, and `git diff --check` pass. Before checkpoint `c2f59ae`, root tests passed (3,942 tests) and all assigned gates passed. Independent final review accepted this checkpoint.

Current diff size: test changes net −78 lines; this note adds 14 lines net; total diff net −64 lines. No production files changed.

## Verified checkpoint: `shelf-judge-gz1q` (`3514251`)

Independent final review accepted. Root tests passed (3,942 tests) and all final gates passed before checkpoint `3514251`.

- Displayed fitness: unified live-list and snapshot/proposal paths now use the same local score projector. The live list still excludes previously-owned entries; snapshot/proposal projections include them. The output game remains the explicit public projection when using public snapshots, not the captured private source.
- Wishlist identity: one durable wishlist projection/hash fences membership and source rows, excluding saved prediction fields. Removed the redundant candidate baseline map; direct durable edit/removal, unrelated-row memo separation, and overlay original-baseline tests remain.
- Wishlist calculation: the projection producer returns calculation details explicitly alongside results; the prior public projection API is a thin results-only wrapper. The observer remains optional and observational. Calculation-only scope, unavailable results, and authorization separation remain intact.
- Redundancy: collection and candidate adjustment paths share only tie/predicted-neighbor/denominator/penalty-rounding/floor math. Each caller retains its ordering and insufficient-neighbor behavior.

Validation with Bun 1.4.0 and API-key/debug variables unset: seven affected suites passed (90 tests); daemon typecheck, scoped ESLint, scoped Prettier check, and `git diff --check` pass. Independent final branch gates passed and review accepted before checkpoint `3514251`.

Current source diff net: −55 lines, including the 34-line shared arithmetic module; the complete diff including this note is net −42 lines.

## Current checkpoint: `shelf-judge-f5zw`

Independent final validation and review accepted. The bounded scope followed the read-only findings in `shelf-judge-uldx` (`fecae63`). Consolidated the three accepted-run handoffs in `JevRunController` into one synchronous private method. Each branch retains its distinct validation and error boundary before calling the method; reservation still precedes authorization consumption, receipt activation and completion-based TTL, active-handle and receipt identity guards, and rejection-swallowing cleanup remain in the shared handoff.

Validation with Bun 1.4.0 and API-key/debug variables unset: four relevant suites passed (34 tests); root tests passed (3,942 tests), and all final gates passed. No test additions were needed; existing controller lifecycle tests cover duplicate starts, conflicts, cancellation, stale completion, receipt TTL/capacity, replay, and stale cancel. Independent final review accepted.

## Current checkpoint: `shelf-judge-x7z7.3`

The user explicitly approved retiring the superseded JEV execution system. Fixture migration is a prerequisite to removing its controller and worker branches, not a compatibility commitment to retain them.

Three non-overlapping lanes migrated existing controller, wishlist, composition, and phase-7 fixtures onto real unified preparation with matching storage and cache instances. Controller migration also restored required unified admission guards: over-limit starts return 409, unconfigured-provider cache misses fail before reservation, and authorization expiry is checked after the final awaited authority read. Existing lifecycle, privacy, currentness, persisted source mutation, ABA, restart, and transport assertions remain subject to independent review.

Targeted suites passed: controller 10 tests, wishlist service 42 tests, and composition/phase-7 integration 9 tests. Combined root tests passed (3,928 tests), but initial root typecheck found optional-method and nullable-fixture errors. Explicit method narrowing and fixture-data guards resolved those errors; 59 affected tests and root typecheck then passed.

Independent review required four corrections. Provider admission now inspects current executable readiness outside the coordinator and checks cache revision at final admission, rather than relying on preview disclosure counts. Wishlist readiness is shared with execution, retaining frozen cached-hit transmission restrictions. Existing controller cases again exercise selected-budget forwarding and rejection of stale cancellation IDs. The refresh test now pauses inside the actual coordinated storage read while refresh reaches persistence; artificial prediction gating and constant-zero hydration assertions were removed.

After corrections, 66 controller/production/worker/phase-7 tests passed on pinned Bun 1.4.0 with root typecheck and scoped gates. The corrected wishlist suite passed 42 tests on Bun 1.4.2. Independent final combined validation on pinned Bun 1.4.0 and follow-up review are pending; no final acceptance is claimed.

Further combined validation exposed obsolete exact lookup assertions and a remaining legacy-only cache-admission fixture. The latter now uses real unified preparation and an awaited durable policy mutation, with assertions outside callbacks caught by the worker. The refresh fixture also incorrectly inherited the writer's reentrant coordinator token. Its corrected forwarding coordinator starts currentness before the commit lock, records coherent old source/wishlist/generation observations while the writer is queued, and verifies durable mutation and stale admission afterward. Both corrected cases passed targeted tests; independent full-suite validation and review remain pending.

Full independent validation subsequently passed (3,933 tests). Follow-up review resolved R1–R4 but found R5: initial mutable cache readiness incorrectly overrode frozen transmission authorization after an awaited read. The worker now uses the frozen pair state after the final live cache-hit check. The existing unified wishlist fixture covers transient-hit eviction followed by authorized provider work, and separately verifies that evicting a frozen cache hit does not authorize transmission. Affected suites passed (48 worker, one unified-production, and 42 wishlist tests); independent final gates and R5 review are pending.

Final outcome: all R1–R5 findings are closed and independent review accepted the combined migration checkpoint. Final pinned Bun 1.4.0 validation explicitly excluded `TYPESAFE_API_KEY` and `NODE_DEBUG`: 3,933 tests passed, one existing skip, no failures; root/browser typechecks, lint, formatting, build, and diff checks passed. The prerequisite adds 110 net source lines and 293 net test lines, including the shared readiness module. This is not the retirement end state: removal of the superseded controller and worker branches remains approved and required under `shelf-judge-x7z7.1` and `.2`.
