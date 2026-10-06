---
title: Stable semantic evidence publication and collection snapshot caching
date: 2026-10-05
status: implemented
tags: [collection-snapshot, semantic-redundancy, jev, cache-invalidation, publication]
modules: [daemon-services, jev-cache, prediction, redundancy, web]
related:
  - .lore/work/design/unified-similarity-prediction-redundancy.md
  - .lore/reference/specs/fitness/redundancy-scoring.md
  - .lore/reference/specs/fitness/prediction-engine.md
  - .lore/reference/specs/current/owner-game-notes.md
  - .lore/work/design/sqlite-jev-pair-cache.md
  - .lore/work/notes/sqlite-jev-pair-cache.md
---

# Stable semantic evidence publication and collection snapshot caching

## Decision

For `shelf-judge-r7np`, separate durable JEV checkpoints from published scoring evidence. Keep the existing judgments table as the published view; add a durable run-owned staging delta. Ordinary prediction and redundancy use only published evidence. Workers may read their own staging overlay. At the terminal boundary, validate and atomically merge eligible staged rows and advance a published-evidence fence once.

This implements the owner's explicit preference: unchanged collection scores stay stable during a run and update once at its end. It is not sufficient to suppress invalidation while ordinary readers still see the changing checkpoint table. Cold readers, restarts and source-triggered rebuilds would expose intermediate results.

Publish evidence, not frozen scores. Collection revisions alone and a last-successful-run timestamp cannot identify the complete state affecting scores.

## Observed seams

The architecture investigation identified these code seams; implementation must verify them against the branch before editing:

- `jev-run-service.ts`: `JevRunHandle.completion`, cancellation, durable progress, terminal paths, startup interruption reconciliation, and `finishWithCurrentCoverage()`. Completion signals exist, but do not separate evidence visibility.
- `jev-run-controller.ts`: completion clears active state and receipt lifetime, not a scoring publication boundary.
- `jev-pair-cache-service.ts`: checkpoints currently write judgments and progress together, advancing mutation revision. Ordinary lookups read those judgments immediately. `finishRun()` writes progress and optional advisory activation; progress is a singleton, not complete evidence identity.
- `prepared-similarity.ts`: V2 proof covers demanded pairs, examined availability and validated row identities, with cache/source currentness checks.
- `unified-scoring-service.ts`: calculations depend on cache revision; `publishCurrent()` additionally refreshes authoritative source files. A retained synchronous callback alone does not detect all external file changes.
- `collection-snapshot-cache-service.ts:175–194,312–333`: semantic mode bypasses cache hits and ETag publication. Built semantic responses already receive currentness checks; retained entries lack equivalent proof capability.
- `collection-snapshot-service.ts`: private semantic metadata carries unified proof/currentness. Production wiring in `index.ts` shares the evidence cache across scoring and runs.
- `collection-snapshot-time-policy.ts`: BGG expiry is fetched time plus seven days plus one millisecond.
- `packages/web/lib/collection-snapshot-client.ts`: IndexedDB stores validated bodies and opaque ETags. No browser generation field is needed.

Service paths above are under `packages/daemon/src/services/` unless otherwise stated.

## Authority amendment

This accepted authority amendment replaces immediate per-checkpoint visibility in the named redundancy and owner-note references with terminal publication. Published partial evidence remains usable: missing components are omitted, valid zero remains available, and full coverage is not required. Activation remains advisory, not a scoring gate.

The unified design's ordinary evidence view is the published view. Do not change its complete prediction/redundancy dependency rules or weaken source/consent checks. Named current references have been amended; superseded immediate-partial-use clauses are retained as history, not as current contract.

### Current accepted implementation contract

Phases 1–5c and terminal CLI integration are accepted; SSC-1 through SSC-4, SSC-P1-01, SSC-P2-01–03, SSC-P4-01–03, SSC-P5B-01–03, and SSC-FINAL-01 are closed. Final holistic gates and terminal project acceptance are recorded in the implementation notes. This status claims neither commit nor deployment.

Run checkpoints persist only to the durable private run-owned stage and progress. Ordinary predictions and redundancy continue to read the indexed published judgments view; only the worker's run-bound overlay may see its stage. At terminal completion, failure, deadline, cancellation, or interruption, seal the first execution outcome and stop reason, validate the still-current eligible subset, then promote that subset once. Execution status and publication status remain distinct; unpersisted seal failure is explicitly process-local, while sealed pending publication remains durable and blocks admission. Recovery/retry is provider-free. Full coverage and advisory activation are not publication or scoring gates. Valid published partial evidence continues to use the established per-pair F/D/O rules.

The existing source, permission, consent, exact provenance, and frozen authorization checks remain authoritative. Source changes and revocation still immediately fence affected calculations; cleanup failure cannot restore permission or permit terminal resurrection. Snapshot reuse additionally requires healthy revisioned published-read evidence, current V2 proof, and asynchronous authority validation for all six snapshot sources. Factual fallback still renders without retention or ETag when that capability is unavailable.

Filesystem authority is a bounded stable observation, not an atomic multi-file snapshot or a lock on independent writers. The implementation reads the six sources twice and applies a final concurrent metadata fence; this detects changes overlapping the observed capture interval under the available content and file-identity signatures. It cannot promise atomicity against arbitrary independent filesystem writers or prevent an edit immediately after the final fence. Do not claim cross-file filesystem transaction semantics.

## Storage and readers

1. Retain the existing indexed judgments table as the default published view for all ordinary unified prediction, redundancy, displayed fitness, wishlist dependencies and legacy semantic readers.
2. Add indexed staged judgments using existing numeric representation, exact dependencies and provenance, plus run ownership. Store no source/note text.
3. Add compact batch metadata: active versus sealed, the durable terminal execution outcome (including its stop reason), and unresolved publication state. Preserve the existing one-run model; unresolved batches block new admission.
4. A checkpoint transaction writes staging plus progress only. It must verify batch ownership and unsealed status at the storage boundary, not just in process-local control.
5. A private run-bound reader looks up its staging first, then published rows, applying existing validation. It has its own currentness fence. Never inject this facade into ordinary scoring.
6. Maintain a durable opaque publication token, updated in the same transaction as changes to published evidence. Purge/reset/transfer also update it. Expose published-only changes through the normal reader's `mutationRevision()`.

Keep three identities distinct: V2 durable content proof, published evidence state, and process/live freshness fences. Do not insert run IDs or process counters into V2 content identity. Same-connection progress/staging writes must not churn ordinary calculation revisions. External SQLite changes may conservatively invalidate, but cannot expose staging.

This design assumes one daemon owns the data directory, as the existing run model does. Distributed multi-daemon execution ownership is out of scope.

## Lifecycle

### Admission and execution

Under the source coordinator, validate explicit authorization and frozen scope, reserve durable batch ownership, initialize progress and bind the worker reader. Reject active/unresolved batch conflicts. Never hold the coordinator or a SQLite transaction during provider calls.

Accept a response only while the run admits results, the exact request sources and permissions remain valid, and the durable batch is owned and unsealed. Late callbacks cannot reopen sealed batches or attach rows to a newer run. Scope never expands because staging changes worker eligibility.

### Terminal publication

Use one idempotent finalizer for success, failure, deadline, cancellation and restart recovery, but distinguish execution termination from publication finalization:

1. Stop admission and durably seal the batch with its intended execution outcome and stop reason. Cancellation acknowledgement remains prompt. Before the durable seal, cancellation/deadline may determine the terminal execution outcome; after the seal commits, that outcome is immutable. Cancellation or deadline while asynchronous validation/commit is in progress may stop further provider work but must not rewrite the sealed outcome or abandon finalization. Finalization is provider-free and retryable.
2. Capture authoritative sources and a stable staging revision; validate staged rows outside the coordinator against sources, permissions, contract versions and domain membership.
3. Reenter the coordinator, refresh source authority, and verify source/batch fences. Retry boundedly on changes.
4. Without an intervening await, transactionally merge eligible rows, leave existing published rows unchanged for rejected candidates, remove finalized staging/batch metadata, advance publication token when content changed, write terminal progress and clear obsolete advisory activation.
5. Settle run completion with execution outcome and publication outcome, then release the process-local execution handle. If publication is pending, retain durable unresolved batch ownership so admission remains blocked until retry succeeds or an authorized reset/purge fences the batch.

On startup, an unsealed batch left active by process loss becomes interrupted and is sealed with that outcome. A batch already sealed before process loss is publication-pending, not interrupted: recovery preserves its sealed completed/failed/canceled outcome and stop reason and retries publication without provider calls. The first durable seal wins; restart recovery must never infer or replace it. Reset/purge and retry/finalization serialize under the source coordinator and verify the batch fence so a stale finalizer cannot resurrect removed data.

Validation includes candidate and collection row rules, previously-owned rated references and prediction-only pairs, not merely positive redundancy pairs. A source change may make execution failed/interrupted while independently valid checkpoints can still publish. Never rewrite execution failure as success.

Stop producing advisory activation through the old final-coverage branch: its ordinary predictions deliberately exclude staging and cannot certify post-promotion coverage. Status may calculate published coverage separately. Preserve terminal source checks when retiring activation-only logic.

### Owner-selected terminal policy

| Outcome | Publication |
| --- | --- |
| Completed | Publish valid committed checkpoints once. |
| Failed/deadline | Publish valid subset once; report failed execution and partial coverage honestly. |
| Canceled | Publish only valid checkpoints durably accepted before cancellation; reject late responses. |
| Process interrupted | During startup publish valid durable subset once; never resume provider transmission. |
| Cannot validate or commit | Keep old published view and sealed batch; report publication pending/unavailable and block new runs. |

The owner selected “Publish valid results” for failed, canceled and interrupted runs on 2026-10-05. This preserves paid work without per-pair visible churn. Execution outcome and publication outcome must be distinguishable. Keep existing progress fields and add only publication state (`published`, `unchanged`, or `pending`) plus the minimal failure/retry information needed to explain pending; do not replace or reinterpret the existing execution state/stop reason.

The internal completion result minimally carries the existing terminal execution progress plus publication state and, when pending, a safe reason. The public status surface adds publication fields while preserving existing fields. Completion settles even when publication is pending, allowing controller cleanup and receipt expiry; that process-local cleanup is not release of durable run ownership. Provide an explicit provider-free retry for the sealed batch. Retry is idempotent and serialized against another retry, reset/purge, and already-committed publication; a committed batch reports its existing outcome rather than publishing twice. Exact route spelling is implementation-plan detail. Do not add a separate job/queue/ownership architecture.

### Failure to persist the seal

Stop dispatch/result admission in process before attempting the durable seal. Retain a run-specific stopped fence until durable resolution or authorized reset; controller handle cleanup must not remove it. Every checkpoint checks this fence under the coordinator alongside durable ownership, so late callbacks cannot write into a stopped but unsealed batch.

If sealing fails after checkpoints committed, retain the durable unsealed reservation and a process-local pending-finalization record with intended outcome/stop reason. Settle completion with publication `pending`, phase `seal`, and execution-outcome persistence `unpersisted`. Status distinguishes this process-local observed outcome from persisted progress. Successful sealing reports persistence `sealed`; promotion reports `finalized`. Do not claim a terminal outcome committed or that execution continues.

The same provider-free retry accepts stopped/unsealed pending finalization as well as sealed pending publication. Under coordinator serialization, verify the stopped fence and batch ownership, retry sealing with the retained intended outcome, then perform normal validation/publication. Bound attempts; retain blocking/pending state on failure. Concurrent retry, reset/purge and already committed promotion remain idempotent; stale retry cannot recreate a removed batch. Release stopped fence/pending record only after durable resolution or authorized reset. Retry never resumes dispatch or admits results.

If the process dies before sealing succeeds, the intended outcome is lost and cannot be claimed as durable. Startup seals the remaining unsealed batch as interrupted before publication. Already sealed outcomes remain unchanged. This is the explicit limit of failed durable storage, not an override of a committed seal.

Validate seal failure after successful checkpoints: late results rejected, completion settles unpersisted/pending, new admission blocks, same-process retry seals and publishes once, reset cannot be undone, and restart before successful seal recovers as interrupted.

## Immediate safety and other mutations

Stability applies to new JEV results, not to invalidated authority:

- Note edits, clears, permission revocation and revoke/re-enable immediately fence old calculations. Purge both published and staged dependent rows, including shared-request C evidence. Cleanup failure cannot authorize scoring or terminal resurrection; consent epochs still apply.
- Collection edits, ratings, ownership, tournament, settings, weights and BGG changes invalidate normally. Rebuild unified prediction and redundancy from current sources plus published evidence, never staging. Do not subtract revoked components from frozen scores.
- Reset/purge remove or fence staging so finalization cannot undo them. Acquisition transfers only validated published candidate rows and removes/fences affected staging. Preserve existing collection-first recovery without claiming cross-file atomicity.
- Audit every cache writer: run acceptance must stage; authorized non-run published mutations must update the published fence immediately.
- Cache loss/unavailability cannot authorize an old semantic snapshot; preserve safe fallback/unavailable and no-store behavior.

## Restart and migration

Before serving requests or admitting runs, recover permission cleanup and load sources. Seal only abandoned unsealed active batches as interrupted; preserve the outcome and stop reason of already sealed batches. Run the same provider-free finalizer for both. Unrecoverable validation/publication keeps staging hidden with explicit pending state.

Promotion, publication token and terminal progress commit atomically. A crash exposes either old view with recoverable staging or new view with terminal state, never mixed metadata. Recovery is idempotent.

Existing pre-upgrade judgments become initial published evidence. Legacy progress cannot retroactively identify already-visible partial rows; reconcile running progress as interrupted without inventing staging history. New process epochs invalidate browser validators.

## Proof-aware snapshot caching

Replace the blanket semantic no-store guard only after reader isolation and lifecycle safety exist.

Retain complete source vector and private V2 proof metadata, published-read health/reusability, synchronous currentness and asynchronous authoritative source validation. Forward the existing unified `publishCurrent(calculation, () => true)` boundary through prediction preparation/snapshot results rather than building a weaker substitute. Validate the full unified proof even when redundancy is disabled, because prediction still depends on semantic evidence. The current `publishCurrent()` authority refresh loads the JEV source snapshot (collection, tournament, prediction settings, redundancy settings) and private wishlist identity; it does not refresh every source represented in a collection snapshot. Snapshot publication and hit acceptance must additionally refresh and compare authoritative identity and availability for all snapshot inputs: collection, tournament, prediction settings, redundancy settings, niche settings, and shelf configuration. In particular, niche settings affect niche positions and shelf configuration affects capacity. Use source content identity as well as revision/vector identity so same-revision external edits are detected; treat disappearance of an established source file as a change/unavailable result, not as unchanged cached data. `loadStoredSource()` may return its in-memory cached value when the vector is available, so this authoritative check must actually detect external file changes/disappearance rather than merely call that cached loader. Compare source availability as part of identity, and reject publication/hits when the authoritative state cannot be established. Reuse the indexed semantic proof/currentness check for semantic evidence; this source refresh must not rebuild the full scoring calculation on a cache hit.

Legacy/custom readers lacking equivalent capabilities remain no-store. Healthy stable partial or missing published evidence can cache; degraded or unavailable/unrevisioned fallback cannot.

For every hit, new publication and individual shared-flight waiter:

1. Perform asynchronous authoritative source validation under existing coordination for the complete snapshot source set above, including source content/availability and established-file disappearance.
2. After all awaits, reread source vector and clock.
3. Check source identity, semantic mode, published proof currentness, reusability and time boundary.
4. Accept the exact candidate and decide 200/304 synchronously with no intervening await.

Bound retries; do not return stale content after exhaustion. A stale flight cannot clear/overwrite a newer entry. Each waiter revalidates independently. Keep one bounded response entry, not a history archive.

### Validator

Use a new opaque namespace such as `cs2`. Hash existing source/time inputs plus V2 proof version/content identity and the already serialized public body once per build. Body identity covers nonsemantic fields and rebuilt same-revision external source edits. No hashing/serialization on hits.

Publication token is a freshness fence, not necessarily ETag input. No-op publication/conservative rebuild may retain the same content validator. Browser body schema stays unchanged.

### Time

Preserve exact BGG expiry, nonfinite/backward clock rejection and post-await clock checks. Run timestamps do not replace freshness. Current row validation has no observed judgment-age TTL; introduce none here. Future semantic TTL must supply policy identity and next-transition expiry. Time-driven rebuilds use published evidence.

## UX boundary

Live progress can advance while collection scores remain unchanged. Displayed scoring coverage describes published evidence; worker checkpoint counts describe execution. Publication pending must not look like updated scores.

Existing browser revalidation obtains new published content on refresh/navigation. This design guarantees request semantics, not immediate repaint in an idle tab. Any later refresh-on-completion wiring must consume successful publication, not just worker termination. Ordinary GETs, recovery and promotion validation never initiate inference or BGG hydration.

## Alternatives

- Suppressing invalidation or retaining only pre-run JSON fails cold readers, restarts, other scoring endpoints and source changes.
- A last successful completion timestamp neither isolates evidence nor covers partial terminal outcomes, purges or time changes.
- Full immutable cache generations add copying/retention/GC unnecessary for one run and one published view.
- Successful/full-coverage-only publication hides paid partial work and restores a superseded all-or-nothing gate.
- Retaining unsuccessful staging for adoption by later runs adds cross-run authorization, retention and recovery states. Terminal partial publication is the recommended smaller policy.

Selected cost: a staging delta, lifecycle metadata and dual-store destructive mutations, but no full-cache copies or frozen-score persistence.

## Implementation outline and validation gates

1. Add SQLite staging, ownership/sealing, published token, worker reader, atomic promotion/recovery and migration. Test no staging escape, transaction rollback, late callback rejection, no-op publication and bounded delta processing.
2. Centralize all terminal paths; update controller/startup/admission/status. Test success, failure, deadline, cancellation, crash before seal and crash-after-seal (including preservation of sealed stop reason), unresolved-publication blocking, provider-free/idempotent retry and honest separate execution/publication outcomes.
3. Audit scoring readers and privacy/mutation writers. Test prediction-only and previously-owned dependencies, redundancy-disabled predictions, fixed authorization scope, source-triggered rebuilds, purge/reset/acquisition, revoke/re-enable and cleanup failure.
4. Retain async authority proof and add semantic cache admission/hits/ETag. Test initial 200 then bodyless 304 without rebuild/scan/serialization, unchanged run checkpoints retaining validator, cold reads hiding staging, terminal publication producing coherent updated 200, and healthy partial-state caching.
5. Test promotion between build/serialization/publication/waiter acceptance, stale-flight protection, bounded retry exhaustion, same-revision edits to every snapshot source, disappearance of each established source file, external SQLite writes, cache closure/corruption, exact expiry, backward clocks and expiry during async validation. Confirm hits do not rebuild scoring merely to obtain this authority proof.
6. Verify browser IndexedDB/opaque ETag fallback unchanged; progress does not rebuild snapshots. Confirm all ordinary read/recovery/publication paths provider-free. Run applicable project tests, typecheck, lint, build and changed-document formatting checks.
7. After acceptance reconcile named authority references and tests formerly requiring immediate checkpoint visibility. Do not enable cache reuse before isolation/recovery/permission gates pass.

## Review status

The owner approved this design and authorized implementation on 2026-10-05. Independent design review findings SSC-1 through SSC-4 and implementation findings SSC-P1-01, SSC-P2-01–03, SSC-P4-01–03, SSC-P5B-01–03, and SSC-FINAL-01 were corrected and closed. Stable end-of-run publication includes valid partial results from unsuccessful runs. Publication state transitions and retry semantics are defined above; exact route spelling remains an implementation detail. Phases 1–5c, CLI integration, and holistic gates are accepted. Accepted root evidence before the CLI-only delta was 3,970 passed / 1 skipped / 23,970 assertions across 251 files, with typechecks, lint, format, build, and diff green; the final CLI delta was 492 passed / 1,296 assertions. The earlier broad browser run had 4 wishlist fixture-argument failures; after correction the full four-viewport wishlist suite passed 96/96 and browser E2E typecheck passed. The evidence and bounded limitations are recorded in `.lore/work/notes/semantic-snapshot-cache.md`, with the machine-readable changed-file manifest at `/tmp/opencode/shelf-judge-r7np-accepted-manifest.json`. No commit, push, or deployment is claimed.
