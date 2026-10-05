---
title: "Simplification notes: accumulated code cleanup"
date: 2026-10-05
status: complete
tags: [simplification, cleanup, similarity, wishlist, privacy]
source: .lore/work/plans/unified-similarity-prediction-redundancy.md
modules: [daemon-services, wishlist, jev-cache]
---

# Simplification notes: accumulated code cleanup

## Scope

Completed the previously identified cleanup of disconnected wishlist scoring, synthetic publication tests, duplicated test and production logic, and superseded JEV execution/preparation paths. Retained live unified scoring, privacy, hydration, authority, cancellation, budget, and publication contracts. No agent workflow or skill changes were made; newly discovered cleanup is not part of this completed scope.

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

## Verified checkpoint: `shelf-judge-x7z7.1`

Prerequisite `27d0034` completed the x7z7.3 fixture migration; independent R1–R5 review is closed and the root suite passed (3,933 tests, one existing skip). This checkpoint makes `UnifiedScoringService` mandatory in the controller and its composition, removes the non-unified collection/wishlist preview and start branches, and keeps wishlist preparation only as the optional source hydrator. The superseded worker execution remains for the dependent x7z7.2 checkpoint.

Targeted controller, unified-production, composition, phase-7 wishlist, wishlist service, and HTTP suites passed (99 tests). Independent pinned Bun 1.4.0 validation passed: 3,933 tests, one existing skip, no failures; all final quality gates passed. Independent review accepted the retirement with no material findings. Net source change: −361 lines; the composition test adds one line.

## Verified checkpoint: `shelf-judge-x7z7.2.1`

At verified HEAD `6179096`, this bounded fixture checkpoint migrated the initial lookup, 200-game capacity, provider-attempt, token-threshold, and selected-deadline cases to actual shared storage/cache/unified scoring and exact `PreparedUnifiedRun` reservations. The 200-game case uses an empty cache and one-attempt budget; it verifies all 19,900 prepared pairs, one provider dispatch/checkpoint, then application-attempt-limit termination. The lookup case spies on the existing collection-index builder only during execution, restoring before final coverage capture and in `finally`, and verifies one build over three dispatches/checkpoints. The full worker file passed (48 tests), with scoped lint, format, typecheck, and diff checks. Independent root validation passed (3,933 tests, one existing skip), and review closed R1/R2. This checkpoint is fixture migration only; worker retirement remains required.

## Verified checkpoint: `shelf-judge-x7z7.2.2`

At verified HEAD `18fe283`, the 14 cancellation, lifecycle-logger, deadline, queued-cancel, provider-failure, and retry-barrier cases before the real-SQLite section use real unified preparations and validated reservations, with barriers armed after preparation and fresh preparations for replacement runs. The blocked-read deadline retains the selected 60-second boundary and therefore runs with a 70-second test timeout. Independent review accepted this bounded migration. No worker retirement is claimed.

Final validation passed on pinned Bun 1.4.0 with the required environment exclusions: 3,933 tests, one existing skip, no failures, and all applicable quality gates. Independent review accepted all 14 migrated lifecycle and retry cases with no material findings. Acceptance covers this partial fixture migration only; full worker retirement remains required.

## Verified checkpoint: `shelf-judge-x7z7.2.3`

The real-SQLite completion/activation, weight-only signal reuse, post-run cache purge, missing-description coverage, newly eligible game, final-coverage cancellation, final-read cancellation, policy-change fencing, and active-run startup reconciliation cases are migrated to actual shared storage/cache/source captures with fresh unified preparations and validated reservations. R1/R2 corrections arm the purge boundary only after the actual final capture, enqueue purge on the same coordinator before publication, record terminal activation publication, and drain the actual late capture/worker continuation before checking cancellation durability with SQLite still open. The pinned Bun 1.4.0 full worker file passes (48 tests); root typecheck, scoped ESLint/Prettier, and diff checks pass. Independent review is pending. The worker file currently retains 9 legacy `startRun` references and 9 `planJevRunScope` references; retirement remains required.

Final independent validation passed: 3,933 tests, one existing skip, no failures, and all applicable quality gates. Independent review accepted this checkpoint and closed both publication-race and late-capture-drain findings. Remaining legacy worker callers are the next migration scope.

## Current checkpoints: `shelf-judge-x7z7.2.4` and `.2.5`

The remaining worker scenarios now use real unified preparations and exact reservations. Tests for superseded selective continuation now require frozen-source rejection; privacy, no-required-signal, opaque authority, persistence failures, pending-result fencing, and SQLite restart obligations remain pending independent review. Fabricated worker capture/planner helpers and worker-test `startRun` references were removed. The last four legacy wishlist worker reservations now receive actual unified contexts backed by matching hydrated storage, cache, and source adapters; optional-method and owner-note discriminant errors were corrected without casts.

The full worker and wishlist files passed (48 and 42 tests), with root typecheck and scoped gates. Combined independent validation and review are pending. Production worker retirement remains required after these caller migrations; no retirement completion is claimed.

Review required two corrections: preserve linked `additionalBggIds` overlap exclusion in the wishlist fixture and prove validation's isolation from a caller-held coordinator. Unified wishlist preparation now collects primary and additional owned identities at both filtering boundaries. The original primary-901/additional-503 fixture relationship is restored. The worker case observes real snapshot validation remaining queued until the owner releases its coordinator, followed by successful validation and synchronous no-I/O reservation. Targeted suites and typecheck pass; independent combined correction validation and follow-up review remain pending.

Final independent validation and review accepted `.2.4` and `.2.5`, closing linked-ID and validation-isolation findings R1 and R2. Pinned Bun 1.4.0 validation passed: 3,933 tests, one existing skip, no failures, and all quality gates including a fresh build. All checked-in worker reservation callers now pass unified preparation. The obsolete worker entry point and fallback implementation are the next required deletion scope.

## Verified checkpoint: `shelf-judge-x7z7.2`

Removed unprepared worker startup, optional local planning, execution recapture/replanning, and selective continuation. Both execution domains require exact unified preparation and one-use validated reservations. Final advisory coverage still recaptures with source, policy, cancellation, and cache-revision publication fences. Execution attempts, tokens, and duration now come exclusively from the frozen authorization budget; the separate worker override/default path and redundant caller arguments are gone.

Independent pinned Bun 1.4.0 validation passed with the required environment exclusions: 3,933 tests, one existing skip, no failures, and all quality gates including a fresh build. Independent review accepted the worker retirement and closed budget-authority finding X7Z7-2-SOURCE-R1. Net worker source reduction: 217 lines. The already-identified `.4` obsolete wishlist builder/planner cleanup remains the next scope; new cleanup candidates are deferred, not started.

## Verified checkpoint: `shelf-judge-x7z7.4`

The test-only `WishlistRunPreparationService.prepare` builder and its private currentness/cache/source-adapter machinery are removed. Production hydration remains on `hydrateSources`; wishlist fixtures that need hydration call that live API, and the six following scoring/currentness assertions continue through actual unified preparations. The legacy selection/currentness-only cases were retired. Hydration assertions still verify selected-source fetching, persisted-field preservation, and that a late fetch cannot recreate a removed entry.

Removed `planJevRunScope` and its planner-only tests. Retained exact-pair scope construction, pair source-comparison, collection indexing/refresh, and captured source immutability tests now exercise `createJevRunScopeFromExactPairs` directly. Review restored the live hydration selection-validation case: empty, duplicate, unknown-ID, and malformed selections reject before BGG calls, without persisting a source. Independent pinned Bun 1.4.0 validation passed: 3,927 tests, one existing skip, no failures; all quality gates passed. Independent review accepted `.4` and closed X7Z7-4-R1.

All implementation beads identified for this cleanup are verified. No additional cleanup or investigation was started after the user's scope limit. This records completion of the identified work, not a claim that the repository contains no other cleanup opportunities.
