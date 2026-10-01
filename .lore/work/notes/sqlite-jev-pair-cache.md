# SQLite Jev pair-cache implementation log

This log tracks implementation of the owner-approved SQLite Jev pair-cache
redesign in `.lore/work/design/sqlite-jev-pair-cache.md`. The overall Phase 2
implementation and feature remain in progress; this checkpoint does not claim
the cache feature is complete.

## Phase 2d7 — strict live V10 cutover

Checkpointed on `design/jev-similarity`, against baseline `f0785bd`.

- The live collection schema is now strict V10, with conservative V9→V10
  migration that discards obsolete legacy pair-cache state rather than
  preserving it in revisioned collection JSON.
- Migration writes a fixed-size, private `legacyCacheMigration` receipt
  atomically with the collection, and the owner-facing notice reports the
  migration. Pair judgments/cache data are not stored in JSON.
- This is a storage/schema cutover only. SQLite cache resolution and mutation
  coordination, owner-triggered Run behavior, and remaining UI work are still
  pending. No live Jev/provider operation was run, and owner data was not
  accessed.

## Validation evidence for this checkpoint

- Full Bun test suite: 3,509 passed, 1 skipped. The skipped test is the
  BggClient timeout test.
- `bun run typecheck` and `bun run browser`: passed.
- Changed-file ESLint: passed; full-project lint was not run.
- Targeted Playwright migration-notice coverage on mobile and desktop: 2
  passed.
- After Prettier correction, focused tests: 31 passed.
- Independent `bun-typescript-reviewer` review: CUTOVER-1 resolved; no other
  blockers reported.

## Phase 2d8 — daemon-owned cache lifecycle

Checkpointed on `design/jev-similarity`, after Phase 2d7 (`501d3dd`). The
overall Phase 2 implementation and feature remain in progress.

- The daemon opens a disposable SQLite pair cache after collection migration.
- If opening the cache fails, the cache remains unavailable and the daemon
  continues without it (fail closed). The cache is closed on API/signal
  shutdown and on startup failure.
- This slice does not inject the cache into services or infer pair results.
  No provider calls were run.

### Validation evidence for this checkpoint

- Bun test suite: 3,512 passed, 1 skipped.
- Typecheck and browser checks: passed.
- Changed-file ESLint and Prettier: passed.
- Independent reviewer: accepted.

## Phase 2d9 — mutation invalidation and owner-note revocation

Checkpointed on `design/jev-similarity`, after Phase 2d8 (`17d4f963`). The
overall Phase 2 implementation and feature remain in progress. Run/read remain
quarantined; no provider calls or owner-data access were performed.

- Added per-source-game exact dependency purging so affected Jev pair rows are
  removed while unrelated rows are preserved. Ordinary collection edits purge
  affected rows before persisting JSON; authority-only edits can persist when
  the cache is unavailable.
- Owner-note revocation for cached-D data commits `permission=false` before
  purge. `cleanupPending` truthfully represents failed cleanup, with startup
  retry and a re-enable purge fence. Only narrowly recognized
  committed-response-loss errors are treated as committed.

### Validation evidence for this checkpoint

- Full Bun test suite: 3,526 passed, 1 skipped.
- Typecheck and browser checks: passed.
- Full-project lint and format checks: passed.
- Independent reviewer accepted P2D9-1, P2D9-2, and P2D9-3.
- No live Jev/provider operation was run; Run/read behavior remains
  quarantined. This checkpoint does not claim the SQLite cache feature is
  complete.

## Phase 2d10a — Jev pair read-proof contracts

Checkpointed on `design/jev-similarity`. The overall Phase 2 implementation
and feature remain in progress.

- Added a judgment contract that binds the model, rubric, question, request,
  score, and policy descriptor to the Jev gateway.
- Added pure row-read proof requiring the exact relevant source and current
  consent, plus complete-coverage proof derived from the full owned prediction
  scope, authoritative collection notes, factual normalization, and semantic
  weights. Activation is bound by a versioned digest.
- This is proof/contract groundwork only: no production SQLite reader or
  service wiring, and no semantic readiness claim. Tests use seeded fake data;
  no provider calls were made.

### Validation evidence for this checkpoint

- Full Bun test suite: 3,538 passed, 1 skipped.
- Typecheck and browser checks passed before lint-only repairs; focused pair
  coverage tests: 5 passed after repairs.
- Full-project lint and `format:check` passed.
- Independent reviewer accepted four proof fixes.

## Phase 2d10b — read-only Jev pair service

Checkpointed on `design/jev-similarity`. The overall Phase 2 implementation
and feature remain in progress.

- Added a read-only SQLite adapter that reports ready only when complete
  read-proof succeeds and the advisory activation matches. It distinguishes
  disabled, factual, not-ready, and stale states, and fails closed on missing
  or errored cache data and absent note permission.
- This slice adds no provider or mutation behavior and is not wired into
  production services. Remaining work includes the artifact gate, production
  wiring, and owner-triggered Run behavior. No live provider calls were made.

### Validation evidence for this checkpoint

- Full Bun test suite: 3,541 passed, 1 skipped.
- Typecheck and browser checks: passed.
- Full-project lint and format checks: passed.
- Independent reviewer accepted P2D10B-1 and P2D10B-2.

## Phase 2d10c — request-local attention and response proof fences

Checkpointed on `design/jev-similarity`, after Phase 2d10b (`2a27604`). The
overall Phase 2 implementation and feature remain in progress.

- Semantic-enabled attention is request-local and is not reused from persisted
  cache state. Profile responses neither reuse nor save cache results and take
  one attention capture per request.
- Snapshot responses do not take a cache hit or emit ETag/304 behavior for
  semantic-enabled requests. `resolveWithProof` and snapshot building enforce
  a same-result fence; response proof is revalidated per caller under the
  coordinator. A legacy ready table without proof is rejected.
- Production scored-read wiring, provider integration, and owner-triggered Run
  are still absent. No provider operation was run; this checkpoint does not
  claim the Jev cache feature is complete.

### Validation evidence for this checkpoint

- Full Bun test suite: 3,551 passed, 1 skipped.
- Typecheck and browser checks passed.
- Full-project lint and format checks passed.
- Independent reviewer accepted P2D10C-1 and P2D10C-2.

## Phase 2d10d — production Jev scored reads

Checkpointed on `design/jev-similarity`, after Phase 2d10c. The overall Phase
2 implementation and feature remain in progress.

- Production snapshot, list, and detail scored reads now share the SQLite read
  proof. Durable capture identity binds `actualAxisCount` exactly, including
  actual-only captures with null metadata.
- Added real prediction-plus-SQLite route coverage for restart, missing-row,
  and revoked-consent behavior.
- Owner-triggered Run and provider execution remain absent. No live provider
  operation was run; this checkpoint does not claim the Jev cache feature is
  complete.

### Validation evidence for this checkpoint

- Full Bun test suite: 3,558 passed, 1 skipped, 0 failed.
- `bun run typecheck`, `bun run typecheck:browser`, `bun run lint`,
  `bun run format:check`, and `git diff --check` passed.
- Independent `bun-typescript-reviewer` accepted the implementation.

## Phase 2d11d — fenced sequential Jev Run worker

Checkpointed on `design/jev-similarity`, after Phase 2d11a–c. The overall
Phase 2 implementation and feature remain in progress.

- Added an inactive, explicit-start-only `JevRunService` with one sequential
  process-local run, bounded work, cancellation, and durable progress that is
  never execution authority after restart. Interrupted progress reconciliation
  does not create a gateway or resume requests.
- The original run scope is the immutable source/consent authorization
  snapshot. Current full captures refresh eligibility only when the source
  vector moves; one pair is prepared at a time. Each request attempt is
  admitted and synchronously started inside the shared profile-source
  coordinator, while provider response waits stay outside it. Pair-local
  fences discard changed/ineligible responses and allow unaffected pairs to
  continue.
- Validated pair rows and progress checkpoint atomically in SQLite. Final
  coverage is computed outside the coordinator and activated only after a
  short serialized check confirms current source/policy authority, cancellation
  state, and unchanged usable cache mutation revision. Incomplete, interrupted,
  or stale runs do not publish a new activation; valid partial rows remain
  available for a later explicit Run.
- Added deterministic fake-gateway barrier coverage for edits, retries,
  unrelated mutations, cancellation, restart progress, storage failures,
  and partial reuse; temporary SQLite tests cover checkpoints, purge/revision
  races, and activation completeness.
- No production route or runtime wiring was added. No live provider was called
  and no owner data was accessed.

### Validation evidence for this checkpoint

- Full Bun suite: 3,607 passed, 1 skipped, 0 failed.
- Focused Jev Run worker suite: 21 tests passed.
- Typecheck, browser typecheck, lint, format check, and `git diff --check` passed.
- Independent source oracle and reviewer accepted the worker.

## Phase 2d11e — Jev Run source adapter

Checkpointed on `design/jev-similarity`, after Phase 2d11d. The overall Phase 2
implementation and feature remain in progress.

- Added the inactive production `JevRunSourceAdapter`: authoritative source
  reads and final verification are short coordinator operations, while a
  complete untargeted prediction capture is computed outside the coordinator.
- Kept full live source-vector identity, global policy identity, and durable
  prediction-capture identity separate. `readCurrent` reflects current durable
  note permission and policy; bounded retries fail closed on source drift.
- No gateway, provider, route, or runtime wiring was added. No live provider
  or owner data was accessed.

### Validation evidence for this checkpoint

- Full Bun suite: 3,612 passed, 1 skipped, 0 failed.
- `bun run typecheck`, `bun run typecheck:browser`, `bun run lint`,
  `bun run format:check`, and `git diff --check` passed.
- Independent `bun-typescript-reviewer` accepted the adapter.

## Phase 2d11c — per-pair Run request and row mapping

Checkpointed on `design/jev-similarity`. The overall Phase 2 implementation
and feature remain in progress.

- Added a pure per-pair C/D hit/miss adapter: it requests only missing signals,
  requires both the current note permission and one-Run transmission
  authorization only when notes will actually be sent, and maps complete
  validated results to numeric rows with exact shared or independent
  dependency provenance. Plaintext is excluded from persisted rows.
- No provider invocation or Run route was added; this is not yet runtime-wired.

### Validation evidence for this checkpoint

- Full Bun test suite: 3,580 passed, 1 skipped.
- Typecheck, browser checks, lint, format check, and `git diff --check` passed.
- Independent reviewer accepted JRP-1 and JRP-2.

## Phase 2d11b — immutable Jev Run pair scope

Checkpointed on `design/jev-similarity`. The overall Phase 2 implementation
and feature remain in progress.

- Added an immutable O(n) per-game fingerprint scope for one Run and lazy,
  stable unordered-pair enumeration. Stale checks are signal-specific, and
  absent owner notes short-circuit before pair enumeration.
- No provider behavior, Run route, or collection lock was added.

### Validation evidence for this checkpoint

- Full Bun test suite: 3,574 passed, 1 skipped.
- Typecheck, browser checks, lint, format check, and `git diff --check` passed.
- Independent reviewer accepted JRS-1 and JRS-2.

## Phase 2d10e — aggregate-only pair status projection

Checkpointed on `design/jev-similarity`, after Phase 2d10d. The overall Phase
2 implementation and feature remain in progress.

- Added a compact aggregate-only Jev pair status projection from validated
  coverage/read proof and SQLite run progress, with truthful readiness and
  progress states. The DTO excludes source text and per-pair details.
- This is status groundwork only: no status API, provider calls, or inference
  behavior were added. Owner-triggered Run remains absent; this checkpoint
  does not claim the Jev cache feature is complete.

### Validation evidence for this checkpoint

- Full Bun test suite: 3,564 passed, 1 skipped.
- Typecheck, browser checks, lint, format check, and `git diff --check` passed.
- Independent reviewer accepted JPS-1 and JPS-2.

## Phase 2d11a — atomic SQLite Jev run writes

Checkpointed on `design/jev-similarity`. The overall Phase 2 implementation
and feature remain in progress.

- Added atomic one-pair numeric C/D row plus progress writes, and atomic
  terminal activation plus progress writes. Shared source coordination remains
  future caller responsibility.
- No provider calls or Run route were added.

### Validation evidence for this checkpoint

- Full Bun test suite: 3,568 passed, 1 skipped.
- Typecheck, browser checks, lint, format check, and `git diff --check` passed.
- Independent `bun-typescript-reviewer` accepted the implementation.
