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
