---
title: "Fitness-ranked Profile attention implementation"
status: in_progress
source_plan: .lore/work/plans/fitness-ranked-profile-attention.md
---

# Fitness-ranked Profile attention implementation

## Seven-phase tracker

- [x] Phase 1: source schema, additive contracts, and compatibility cutover preparation (accepted)
- [x] Phase 2: pure rule catalog and candidate oracle (accepted)
- [x] Phase 3: disposable candidate persistence and freshness coordination (accepted)
- [ ] Phase 4: atomic disposition commands and source mutations (pending)
- [ ] Phase 5: Profile, config, and CLI contract cutover (pending)
- [ ] Phase 6: web rendering and command relay (pending)
- [ ] Phase 7: cross-cutting oracle, performance, and authority reconciliation (pending)

## Accepted Phase 2

## Phase 3 correction history

- **C3-1:** `AttentionCandidateArtifactRowSchema` now requires both
  `evaluation.gameId` and a non-null `evaluation.disposition.gameId` to
  exactly equal its containing `row.gameId`; the disposition must also equal
  the evaluation identity. The row schema owns these invariants, so malformed
  cache rows are rejected before any artifact-level dependency or identity
  index validation can obscure them. A second nested-structure inspection
  confirmed that winner presentations contain only display fields, and that
  dependency/index IDs are row-owned derivations rather than nested candidate
  identities.

### C3-1 validation evidence

- Direct row-schema tests accept matching evaluation, snoozed-disposition, and
  intentional-disposition identities. They reject each mismatched disposition
  at `evaluation.disposition.gameId`, without constructing artifact indexes.
- Focused artifact and core engine/service/storage tests: **30 passed, 186
  assertions**.
- `bun run typecheck`, `bun run lint`, and changed-file Prettier: **passed**.
- `git diff --check`: **passed**.

### C3-1 correction manifest

Captured after C3-1 validation. `ABSENT` indicates the file is untracked in
the current worktree; this correction does not change Phase 3 status beyond
keeping it in progress.

| Status | Path                                                         | Index     | Working tree SHA-256                                               |
| ------ | ------------------------------------------------------------ | --------- | ------------------------------------------------------------------ |
| `??`   | `packages/shared/src/attention-candidate-artifact.ts`        | `ABSENT`  | `fc733cc75a67c6aaa97bd83474d9a2cbb3416edd6a6012f15c2700fb8b334a09` |
| `??`   | `packages/shared/tests/attention-candidate-artifact.test.ts` | `ABSENT`  | `e00313936aa3c9455ed95c1cd3dbb24bf49adf3ec66ba04f5c8dccbea7f4610f` |
| ` M`   | `.lore/work/notes/fitness-ranked-profile-attention.md`       | unchanged | `SELF-REFERENCE: omitted`                                          |

`shelf-judge-cq1.2` is closed as accepted. Phase 2 adds the pure, registry-driven attention candidate oracle, four built-in rules, exact rational score handling, canonical purchase-utilization projection reuse, per-game winner selection, dispositions-before-selection, supersession, and deterministic global ranking. It deliberately does not cut over the public Profile contract or begin Phase 3 persistence work.

### Correction history

- **P2-1:** Prevented canonical projection metadata leaking through established game responses; restored response parity.
- **P2-2 to P2-6:** Aligned stale-play trust with Profile semantics; structured and globally fingerprinted dependencies; consumed canonical utilization projections; retained zero-score applicability; and enforced reduced, canonical exact fractions, including `0/1`.
- **P2-7:** Declared only displayed-fitness global identities actually consumed by underused-purchase and made intentional suppression invalidate on relevant changes only.
- **P2-8:** Derived each declared production dependency from rule metadata and validated valid plus empty, non-hex, uppercase, and wrong-length identities through the production path.
- **P2-9:** Validated dormant fixtures as collections and corrected BGG/current-observation ordering and fingerprint coverage.
- **P2-10:** Exercised production snooze and disposition boundaries, including the unsnoozed no-rule control and schema-valid null-winner expiry case.
- **P2-11:** Compared boundary timestamps as instants while retaining the selected original serialization and rejecting invalid timestamps.
- **P2-12:** Reused normalized Unicode code-point ordering for deterministic equal-instant ties and ranking invariance.

Following review escalations, the user explicitly authorized the third P2-6 correction, the P2-8/P2-9/P2-10 evidence correction, and the remaining P2-8/P2-10 evidence repair. Terminal review accepted all approved Phase 2 obligations and closed P2-1 through P2-12.

## Final accepted validation evidence

- Focused candidate/Profile Phase-2 suite: **101 passed, 905 assertions**.
- Full suite: **3,029 passed, 1 skipped, 0 failed**.
- `bun run typecheck`, `bun run lint`, `bun run build`, changed-file Prettier, and `git diff --check`: **passed**.
- Terminal reviewer: accepted all approved Phase 2 obligations; P2-1 through P2-12 closed.

## Accepted current-worktree manifest

Captured after closing `shelf-judge-cq1.2`, before the notes’ final self-reference. Each entry records exact porcelain status, index blob identity or `ABSENT`, and working-tree SHA-256 or deletion marker. This notes file is intentionally recorded with `SELF-REFERENCE: omitted`; no self-hash is claimed.

| Status | Path                                                              | Index                                      | Working tree                                                       |
| ------ | ----------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| ` M`   | `.beads/interactions.jsonl`                                       | `69b686a799e5b2816e1b245c4f816a4f6ddd432a` | `e149f73e03ebe3752a34285fcb8180da30bd08779013eebbd88df6bea445d902` |
| ` M`   | `.beads/issues.jsonl`                                             | `50e17aa53a27fedf5b69a36daae1d32400da77d4` | `57d8985fd8f5fcfa84eeeef72287b4f7303c6cbf0f27e94e97d5a1b378cdb4e8` |
| ` M`   | `.lore/work/notes/fitness-ranked-profile-attention.md`            | `c27a4c57fc5c38581532efaa03aef2c5a31ae4c8` | `SELF-REFERENCE: omitted`                                          |
| ` M`   | `packages/daemon/src/services/collection-profile-engine.ts`       | `ee77a22d946d02ae93a42aa59bd383d19cf2c264` | `a11bf1201cd8b8b7ed685a21d202affa2ef6205d8cf4eab972fb0d9b83775ca6` |
| ` M`   | `packages/daemon/src/services/purchase-utilization-service.ts`    | `021e22b63f7d7902713b2396dd12939a6661682d` | `a4bd3e07ca7eebf9c4ebb1b6a9a70f32597177e71736d0dce77fffff1b782e72` |
| ` M`   | `packages/daemon/tests/services/game-projection.test.ts`          | `3930e85aaa1cf0cb9e3d4078453c0906ab082117` | `21691334daba328e18eeaf77ce7eae4e4047a1e9f3332e30f4d2d3cda2be7146` |
| ` M`   | `packages/shared/src/index.ts`                                    | `5a6b99da8333f1def70f50f40ea5ad33c4248a43` | `2fcdd9d62cdf1f9f03aeb6c4331d3fb5df7edc5402d25ebd696c5d21a9bb2ddd` |
| ` M`   | `packages/shared/src/validation.ts`                               | `ddbe623dcbf8acc0e9ec105e0f3d7073a0505de5` | `2f5186e13b8a497abc2d49b14c6c900bef042c1d2aafed834f25d9ae3aa928aa` |
| ` M`   | `packages/shared/tests/purchase-utilization.test.ts`              | `b6e9f108405c461711a354ba6fae9fd67ac9b3e2` | `31d5c4d8b18903fa6f043016b9faf27f692faa487287b858db3c36e09b10c880` |
| `??`   | `packages/daemon/src/services/attention-candidate-engine.ts`      | `ABSENT`                                   | `a53c795b01c21a8d78048db3dea4b81eab139cafd5a902770168fd52354bafde` |
| `??`   | `packages/daemon/src/services/attention-rule-catalog.ts`          | `ABSENT`                                   | `27ffaa7db991cdaa739dfb4543344d627590a9cf1bb13ad71a61637cb56073f3` |
| `??`   | `packages/daemon/src/services/purchase-utilization-projection.ts` | `ABSENT`                                   | `d47fb9cc9995bbef977b5061a943efa0787ba708d73a79f341e75cbfe4214d7e` |
| `??`   | `packages/daemon/tests/attention-candidate-engine.test.ts`        | `ABSENT`                                   | `c84d7921625b3e64f16a1995e58ed08a99543ed9e23f7232c6ea613c8fd787d8` |

<!-- CURRENT-WORKTREE-MANIFEST -->

## Phase 3 / Phase 4 boundary (authorized 2026-09-21)

Phase 3 owns writer notification, incremental and global disposable-candidate
freshness, inactive stale dispositions in disposable output, and fail-closed
Profile publication. Phase 4 owns durable deletion of incompatible dispositions
alongside atomic owner response commands. This keeps Phase 3 cache maintenance
non-destructive and avoids coupling it to the command/receipt transaction.

### Integration progress

- Added a closed collection mutation-operation vocabulary and an exhaustive
  impact policy. Collection post-commit observers forward derived candidate
  impacts after durable collection persistence.
- Candidate maintenance can rebase a compatible prior revision for exact game
  impacts and identity-only `games([])` impacts, while global impacts rebuild.
  Candidate failures discard the disposable artifact and return unavailable;
  committed source mutations are not rolled back.
- Profile gates cache hits on candidate freshness and rereads all durable
  Profile sources before publishing a rebuilt profile. Daemon startup attempts
  disposable candidate recovery without preventing daemon startup.
- Tournament, prediction settings, and redundancy source saves expose injected
  post-save candidate-maintenance callbacks. Config writes are coordinator
  serialized; Profile-only config changes discard Profile without candidate work.

### Validation

- `bun run typecheck` passed.
- `bun run lint` passed.
- Changed-file Prettier and `git diff --check` passed.
- `bun test packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts`
  passed: 2 tests, 55 expectations.

Awaiting independent integration tests/review. The required expanded writer,
race, artifact-byte, and failure-path suite remains to be added before acceptance.

### Completion validation update (2026-09-21)

Correction: the candidate row serializer initially copied winner score fields into
the strict presentation object. It now persists only presentation fields. The
identity-only post-commit rebase now avoids an oracle invocation when no row is
due or addressed. The web build also required the shared candidate artifact to
use extensionless local validation import for Turbopack source resolution.

Direct evidence added:

- `attention-mutation-impact.test.ts` exhaustively enumerates the closed
  operation vocabulary and verifies global reasons, exact-ID dedupe,
  identity-only `games([])`, and no-impact read paths.
- `attention-candidate-service.test.ts` verifies valid non-due cache zero work,
  due targeted maintenance, full maintenance, post-commit identity-only zero
  evaluation rebase, source identity retry, and unavailable failure behavior.
- Collection migration manifest ordering was updated for the independently
  disposable attention-candidates artifact.

Commands passed:

- Focused Profile/candidate command: 41 passing tests, 219 expectations.
- `bun test packages/daemon/tests/services/storage-collection-migration.test.ts`:
  13 passing tests, 69 expectations.
- `bun run test`: 3045 passing, 1 skipped, 0 failed, 17,323 expectations.
- `bun run typecheck`, `bun run build`, and `bun run lint` passed.
- Changed-file Prettier and `git diff --check` passed before the final notes
  update; rerun formatting/diff check is required after this note append.

Stable manifest is the existing Phase 3 core manifest plus:
`packages/daemon/src/services/attention-mutation-impact.ts`,
`packages/daemon/src/services/{collection-mutation-service,profile-service,
tournament-service,prediction-service,shelf-service,attention-candidate-service}.ts`,
`packages/daemon/src/routes/{config,redundancy}.ts`,
`packages/daemon/{src/app.ts,src/index.ts,tests/helpers/test-app.ts}`, and
`packages/daemon/tests/services/{attention-mutation-impact,attention-candidate-service,storage-collection-migration}.test.ts`.

Status: awaiting independent review. Durable disposition deletion remains Phase 4.

### Direct integration completion evidence (2026-09-21)

The authorized Phase 3/Phase 4 boundary remains unchanged: Phase 3 owns
disposable candidate freshness, writer notification, inactive stale
dispositions in disposable output, and fail-closed Profile publication. Phase
4 owns durable deletion of incompatible dispositions with atomic owner response
commands.

Direct production-path coverage now verifies that tournament, prediction, and
redundancy writers save before global candidate maintenance under the shared
Profile coordinator, including a barrier proving a Profile read cannot
interleave between save and maintenance. Failed global saves skip maintenance.
Config cap and entity-policy PUTs invalidate Profile, leave candidate artifact
bytes unchanged, and perform no candidate load; unrelated config changes do
the same. Candidate persistence failure after a committed collection mutation
does not replay the mutation and a later freshness check recovers. Candidate
unavailability gates an otherwise valid Profile cache without displayed-fitness
work. Startup recovery failure is logged while app construction and unrelated
routes remain available. Analyst projection receives the daemon's shared
Profile service rather than constructing an ungated one.

Corrections during final validation: the startup helper is exportable and
import-safe (`import.meta.main` gates daemon execution); the analyst projection
accepts the injected Profile service; focused test callbacks were made explicit
Promises to satisfy repository lint rules. Public Profile contract remains 9
and algorithm remains 12.

Commands passed:

- `bun test packages/shared/tests/attention-candidate-artifact.test.ts packages/daemon/tests/services/attention-candidate-service.test.ts packages/daemon/tests/services/attention-candidate-storage.test.ts packages/daemon/tests/services/attention-mutation-impact.test.ts packages/daemon/tests/phase3-direct-integration.test.ts`: **23 passed, 81 expectations**.
- `bun test packages/daemon/tests/phase3-direct-integration.test.ts packages/daemon/tests/profile-service.test.ts packages/daemon/tests/routes/config-routes.test.ts packages/daemon/tests/services/analyst-evidence-projections.test.ts packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts`: passed before the full gate.
- `bun run test`: **3,052 passed, 1 skipped, 0 failed, 17,350 expectations**.
- `bun run typecheck`, `bun run lint`, and `bun run build`: passed.
- Changed supported-file `bunx prettier --write` and `git diff --check`: passed.

### Stable Phase 3 changed-file manifest

`.beads/issues.jsonl`; `.lore/work/notes/fitness-ranked-profile-attention.md`;
`packages/shared/src/{attention-candidate-artifact,index}.ts`;
`packages/shared/tests/attention-candidate-artifact.test.ts`;
`packages/daemon/src/{app,index}.ts`;
`packages/daemon/src/routes/{config,redundancy}.ts`;
`packages/daemon/src/services/{analyst-evidence-projections,attention-candidate-engine,attention-candidate-service,attention-mutation-impact,collection-artifacts,collection-mutation-service,prediction-service,profile-service,shelf-service,storage-service,tournament-service}.ts`;
`packages/daemon/tests/helpers/test-app.ts`;
`packages/daemon/tests/phase3-direct-integration.test.ts`; and
`packages/daemon/tests/services/{attention-candidate-service,attention-candidate-storage,attention-mutation-impact,collection-artifacts,storage-collection-migration}.test.ts`.

Status: Phase 3 implementation is stable and awaiting independent test/review.

### C3-2 correction and evidence (2026-09-21)

- The production storage boundary now owns a process-local monotonic candidate
  source generation. It advances only after durable collection, tournament,
  prediction-setting, and redundancy-setting writes, including their durable
  creation/migration replacements. Profile, candidate-artifact, and config
  writes do not advance it.
- A validated, published artifact is retained in-process with its generation.
  A non-due artifact with a strictly future earliest boundary returns after only
  reading the injected clock and generation; cold cache, missing generation,
  due boundary, and generation mismatch use the normal locked source/artifact
  validation path. Failed maintenance clears the in-memory artifact.
- Targeted maintenance expands requested IDs through the persisted local
  dependency index before one sorted/deduplicated oracle invocation. Oracle
  output must exactly cover the owned targets, with duplicate, missing, or
  non-owned results rejected before publication.

Direct test evidence adds an instrumented warm-cache case proving the second
non-due `ensureFresh()` performs no source or artifact load and no oracle work;
a generation advance forces source/artifact validation. A reverse-index peer
fixture proves fan-out is sorted and an incomplete result cannot save.

Validation after C3-2:

- Focused candidate artifact/service/storage/mutation/Profile integration
  command: **25 passed, 90 expectations**.
- `bun run lint`, `bun run build`, `bun run test`, and `bun run typecheck`
  passed. Full suite: **3,054 passed, 1 skipped, 0 failed, 17,359 expectations**.
- Changed-file Prettier and `git diff --check` passed before this notes append.

Status: awaiting independent verification.

### C3-2 production-index follow-up (2026-09-21)

- Production daemon and test-app candidate construction now supply the shared
  catalog-derived dependency resolver. It records the honest self-only local
  dependency, canonical source identity keys declared by the rule catalog, and
  sorted unique primary/additional BGG identities used by dormant-session
  evaluation.
- Storage generation coverage now directly proves one successful increment per
  collection, tournament, prediction, and redundancy source write, with a
  failed tournament write and config/candidate writes leaving it unchanged.

Validation: focused candidate service/storage tests passed (14 tests, 47
assertions). `bun run lint`, `bun run build`, `bun run test`, `bun run
typecheck`, and `git diff --check` passed. Full suite: 3,056 passed, 1 skipped,
0 failed, 17,370 assertions.

Remaining acceptance evidence is the expanded full-vs-incremental parity and
target-result rejection matrix requested for independent verification.

### C3-3 hidden-row local parity diagnosis (2026-09-21)

- Added a test-only `onMaintenanceError` observer to `AttentionCandidateService`.
  A post-commit source-reread race now proves the swallowed error is exactly
  `Attention candidate source changed after collection commit`.
- The initial hidden-row fixture was invalid for the intended rule because it
  set only `latestPlayCountCheck`; `never-played` also requires current valid
  `playCountEvidence` with value zero. Adding that evidence produces a valid
  intentional hidden row without changing production behavior.
- The production oracle/service regression parses the baseline artifact, then
  records compatible prior artifact, local expansion (`local`), oracle output
  (`local`), durable identity reread, artifact validation, and save. Its local
  post-commit artifact is deeply equal to an isolated global rebuild at the
  same source and clock, including all indexes and the hidden row.
- A companion service regression proves one oracle invocation receives the
  sorted unique union of a requested due ID and two overdue IDs, and that its
  artifact equals the same-clock isolated global rebuild.

### C3-4 targeted oracle rejection matrix (2026-09-21)

- A schema-valid two-owned-row prior artifact plus one non-owned game now
  drives tabled post-commit service cases for missing, duplicate, replacement
  ID, non-owned-extra, and unrequested-owned-extra oracle evaluations.
- Every malformed result returns retryable unavailable, observes exactly
  `Candidate oracle results must exactly cover owned evaluation targets`, makes
  no candidate save or source reread, and preserves the prior storage bytes in
  the no-op-discard storage seam. The exact-target control saves once, rereads
  the durable source once for identity, updates only the requested row, and
  preserves the unrequested row.
- Focused Phase 3 command passed: 31 tests, 145 expectations. Typecheck,
  lint, changed-file Prettier, and `git diff --check` are rerun after this note
  update.

### C3-4 manifest update

| Status | Path                                                                 | Index     | Working tree SHA-256                                               |
| ------ | -------------------------------------------------------------------- | --------- | ------------------------------------------------------------------ |
| `??`   | `packages/daemon/tests/services/attention-candidate-service.test.ts` | `ABSENT`  | `9639efec84f12d23ef3e9c4e3a55035dd2ec087a952b60f2bc25cdf3b3298d21` |
| ` M`   | `.lore/work/notes/fitness-ranked-profile-attention.md`               | unchanged | `SELF-REFERENCE: omitted`                                          |

### C3-3 null-boundary warm-cache correction and evidence (2026-09-21)

- `ensureFresh()` now treats a validated cached artifact with
  `earliestBoundary: null` as non-due. With an unchanged source generation it
  returns the cache after only generation and clock checks, exactly as a
  strictly-future boundary does. A non-null boundary at or before the current
  instant still takes the locked validation/maintenance path; a generation
  mismatch always takes that path too.
- The direct instrumented regression warms a valid null-boundary artifact,
  snapshots row access, and confirms the next `ensureFresh()` performs no
  source or artifact load, row access, oracle/displayed-fitness work, or save.
  It permits only one additional clock read. Incrementing generation then
  proves source and artifact validation resume. The existing strictly-future
  and at-or-before-due boundary regressions remain in the same focused suite.

Validation after C3-3:

- Approved Phase 3 focused suite: **32 passed, 151 expectations**.
- `bun run test`: **3,061 passed, 1 skipped, 0 failed, 17,420 expectations**.
- `bun run typecheck`, `bun run lint`, and `bun run build`: passed.
- Changed supported-file Prettier and `git diff --check`: passed after this
  note update.

### C3-3 manifest update

| Status | Path                                                                 | Index                                      | Working tree SHA-256                                               |
| ------ | -------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `??`   | `packages/daemon/src/services/attention-candidate-service.ts`        | `ABSENT`                                   | `c8bd218be98443c6c4c12208334b176e0543ad8ef832016043b6069f56f1f6aa` |
| `??`   | `packages/daemon/tests/services/attention-candidate-service.test.ts` | `ABSENT`                                   | `d9115b7acb76862f30d96d7bea5400799ef582659979c6f8a6f4b54a71c2e128` |
| ` M`   | `.lore/work/notes/fitness-ranked-profile-attention.md`               | `ee96690d23e33cbe37dda916d9909ae12b82b634` | `SELF-REFERENCE: omitted`                                          |

Status: Phase 3 remains awaiting independent verification.

### C3-5/C3-6 correction and evidence (2026-09-21)

- Displayed-fitness and snapshot options accept optional `targetGameIds`. Target
  IDs are canonicalized as sorted unique IDs; only owned requested games are
  returned. Prediction retains the complete collection context for vocabulary,
  ranges, ratings, references, readiness, and tournament normalization while
  evaluating only the selected output games. Candidate maintenance forwards its
  expanded targets into the production displayed-fitness oracle and builds
  purchase-utilization projections only from the returned entries.
- Target niche and redundancy decoration still derives its peer universe from
  the complete predicted collection, then attaches only target positions and
  adjustments. The normal no-target path remains unchanged.
- Artifact parsing now rejects every evaluation dependency/catalog version that
  differs from the artifact identity, including null-winner rows. A disposition
  paired with a winner must carry that winner's persisted rule ID/version; no
  invalid equality between a per-rule version and the rule-catalog version is
  imposed. Storage uses this schema on load, so mixed artifacts are discarded
  and rebuilt by normal freshness maintenance.

Validation:

- Targeted artifact/candidate/redundancy tests: **34 passed, 168 expectations**.
- Full suite: **3,062 passed, 1 skipped, 0 failed, 17,425 expectations**.
- `bun run typecheck`, `bun run lint`, `bun run build`, changed-file Prettier,
  and `git diff --check`: passed.

### C3-5/C3-6 correction manifest

| Status | Path | Index | Working tree SHA-256 |
| --- | --- | --- | --- |
| ` M` | `packages/daemon/src/services/displayed-fitness-service.ts` | unchanged | `de1390ec80a1f50981ddc1896d5d931d25f41e9571d98a34689ffff7f8ce6e2e` |
| ` M` | `packages/daemon/src/services/prediction-service.ts` | unchanged | `3704f9423710db5be15666fdb00149339c7ee4aa75ef7f86e8219e70c53f6cb7` |
| `??` | `packages/daemon/src/services/attention-candidate-service.ts` | `ABSENT` | `91ead5b7a5b3adbfd9201b4fca28cba858e90edb8ef05dc6c8d51e8ce929711e` |
| `??` | `packages/shared/src/attention-candidate-artifact.ts` | `ABSENT` | `e9e5cd3a7773b79d027a9e3f6f11c486e62e8efb8cdf6c2dbb4095fdd41e84ec` |
| `??` | `packages/shared/tests/attention-candidate-artifact.test.ts` | `ABSENT` | `42a54ba63043c325a5fbab255cba8593288259ab647d9c1c173e8257a5b24fdb` |
| `??` | `packages/daemon/tests/services/attention-candidate-service.test.ts` | `ABSENT` | `8dbe5e0fd9f753722ac1a0181c9da382fb72ccfa64b4e1553e177b93a7538450` |
| ` M` | `.lore/work/notes/fitness-ranked-profile-attention.md` | unchanged | `SELF-REFERENCE: omitted` |

### C3-5/C3-6 closure update (2026-09-21)

- Artifact identity now persists a strict, sorted catalog rule manifest with
  each rule ID, rule version, and scoring version. The production source loader
  derives it from `attentionRuleCatalog`; calculation, catalog, dependency, and
  projection identities use their exported constants rather than literals.
- Artifact rows reject unknown or mismatched winner rule metadata and stale
  active intentional dispositions. Historical snoozes retain their persisted
  rule identity and are intentionally exempt from current-catalog version
  matching. Cold storage loading discards a malformed catalog manifest.
- Direct prediction-path parity tests prove a requested predicted target is
  byte-equivalent to its full-run row while retaining the full reference count,
  and that only target scoring executes. The same test covers fully actual
  target scoring; displayed-fitness tests prove sorted/deduped target forwarding
  and no previously-owned output.

### C3-5/C3-6 closure manifest

| Status | Path | Index | Working tree SHA-256 |
| --- | --- | --- | --- |
| `??` | `packages/shared/src/attention-candidate-artifact.ts` | `ABSENT` | `6c237198ecb8d89e0a17e55b32eac043e8bdfcc6e63a56484d8d07702c8f43e2` |
| ` M` | `packages/daemon/src/services/attention-rule-catalog.ts` | unchanged | `53e3472beb129b79b06faf106860fbefcb61571b5ef3c2840f4077e30a4e9516` |
| `??` | `packages/daemon/src/services/attention-candidate-service.ts` | `ABSENT` | `1a580e09d492f3252223c42db90fecf11a34be804b67e8d7e0a7639deb4a3465` |
| `??` | `packages/shared/tests/attention-candidate-artifact.test.ts` | `ABSENT` | `2ada048104f47c7f4028de79b08642a4b9439604362485b43c2f43d3609f583f` |
| `??` | `packages/daemon/tests/services/attention-candidate-storage.test.ts` | `ABSENT` | `c107bf9433ef39d3bcf7f172b2a2992315b0604bc4e93ec258c0e071d3aa6d97` |
| ` M` | `packages/daemon/tests/services/displayed-fitness-service.test.ts` | unchanged | `f37a66f1c6980ce352e6658c1afa509db133ab0c3873b53ba512b56b17a8d79b` |
| ` M` | `packages/daemon/tests/services/prediction-service.test.ts` | unchanged | `873d4b47a80a136bc1bd383e7ada24d5feb5f36f72e28c4cc347d21bdc0a6fd1` |
| ` M` | `.lore/work/notes/fitness-ranked-profile-attention.md` | unchanged | `SELF-REFERENCE: omitted` |

### C3-5A/C3-6A regression evidence

- Snapshot actual-mode target redundancy now loads the same complete actual
  peer-score universe used by the corresponding full call. The adversarial
  fixture gives peers different predicted scores and proves target/full actual
  equality while the predicted peer universe changes the target result.
- Candidate service cold artifacts with either a changed rule version or changed
  scoring version invoke a full oracle rebuild and save a current catalog
  manifest. A stale-manifest prior revision likewise refuses rebase and runs a
  full rebuild. Existing bounded-cache and matching-rebase controls remain in
  the same focused service suite.

Validation: focused candidate/artifact suite **23 passed, 122 expectations**;
`bun run typecheck`, `bun run lint`, changed-file Prettier, and `git diff --check`
passed.

## Accepted Phase 3 (2026-09-22)

Phase 3 is accepted and this seven-phase note remains **in progress** overall:
Phases 1, 2, and 3 are complete; Phases 4, 5, 6, and 7 remain pending.

The accepted implementation provides the independently versioned disposable
candidate artifact, exact row/due/local/source/BGG indexes, atomic artifact
load/save/discard and collection-artifact registration. Maintenance coordinates
controlled-clock freshness, warm-cache generation checks, targeted dependency
fan-out and global rebuilds, source-identity rereads/retries, failure discard,
and unavailable fail-closed behavior. Collection, tournament, prediction,
redundancy, and relevant config writers are coordinated after durable saves;
Profile publication rereads durable sources and gates stale or unavailable
candidates; daemon startup attempts recovery without blocking unrelated routes.

The authorized Phase 3/4 boundary is unchanged: Phase 3 performs only
disposable cache maintenance and includes inactive stale dispositions in its
output. Phase 4 alone durably clears incompatible dispositions as part of its
atomic owner response commands.

Corrections C3-1 through C3-6A are accepted: row-owned evaluation/disposition
identity validation; monotonic source generation and zero-work non-due warm
cache; production catalog-derived local dependencies and source-write coverage;
hidden-row parity, source-reread-race observability, due-target union, and
exact-target rejection; null-boundary warm-cache behavior; target-scoped
prediction/displayed-fitness parity with complete peer universes; strict
artifact catalog/rule/scoring identity validation; and actual-mode target
redundancy plus stale-manifest full-rebuild regressions.

### Final accepted validation evidence

- Targeted Phase 3 suite: **46 passed**.
- Full suite: **3,068 passed, 1 skipped, 0 failed**.
- `bun run typecheck`, `bun run lint`, `bun run build`, changed-file Prettier,
  and `git diff --check`: **passed**.
- Terminal reviewer accepted every Phase 3 obligation.

### Accepted current-worktree manifest

Captured after closing `shelf-judge-cq1.3`, before this notes section's final
self-reference. Each pending path records exact porcelain status, index blob
identity or `ABSENT`, and working-tree SHA-256. This notes file follows the
established self-reference convention: `SELF-REFERENCE: omitted`.

| Status | Path | Index | Working tree SHA-256 |
| --- | --- | --- | --- |
| ` M` | `.beads/interactions.jsonl` | `49d52c536b2cf3cbaa9d0b3c894c5a9c564c1bc2` | `48985d65bdb087c73c62aa040aee2fedec5c1eb3429113f93d026b998f68cadc` |
| ` M` | `.beads/issues.jsonl` | `e1ba3d8f29400f7b2e5fe67dfb4153c3fb338ab1` | `c8a014bbbe8c80a90d5e30c2ecebe1be371aab4931cac5db206c2e9fc8e26008` |
| ` M` | `.lore/work/notes/fitness-ranked-profile-attention.md` | `ee96690d23e33cbe37dda916d9909ae12d82b634` | `SELF-REFERENCE: omitted` |
| ` M` | `packages/daemon/src/app.ts` | `1ce934cdb0515b7f2884e83b7479af8693496259` | `6a59cce2c65c5d900790cc78af52a64c8468dfa323209d3f657eca149e553932` |
| ` M` | `packages/daemon/src/index.ts` | `f8150476599c745f42e77dc5547b9be121347cc6` | `9f231798deb889f92094120cf5f2b9a1e4b52c31298f24045f8c184ad34960b9` |
| ` M` | `packages/daemon/src/routes/config.ts` | `9e5410175701e7c882971c18f5c38f0965f9f13c` | `c7ad6bc230e03aae314f1f75c7eb49d8ea92c86e818352bcd7a1d0d4e2699f18` |
| ` M` | `packages/daemon/src/routes/redundancy.ts` | `600013153a804d1cb6748637541669feec6265c3` | `143b63f182f42b15ab485d22b3719fc0fdc9f97796aee614462cbe983d0fe8ad` |
| ` M` | `packages/daemon/src/services/analyst-evidence-projections.ts` | `5d102e0f096c4ed16619d1d254b289d030822b74` | `01b25882a6164ccdce37251c83b9924895c852eca6c0e7dc55453f30dcdcfef3` |
| ` M` | `packages/daemon/src/services/attention-candidate-engine.ts` | `c9ee9783fa1cf1e4a5737395c5bca19e0e86af42` | `4853c651b775d63a8d5666286a6b485a2afa4c7829170140c7f536b3fcbb0d27` |
| ` M` | `packages/daemon/src/services/attention-rule-catalog.ts` | `7374d74effb20766ff64dd7d020da71d73762e13` | `53e3472beb129b79b06faf106860fbefcb61571b5ef3c2840f4077e30a4e9516` |
| ` M` | `packages/daemon/src/services/collection-artifacts.ts` | `d07dc4ac3a9166e23c0e1f0afd74ede32a4260ad` | `80232b523fa10a1c528a5de796d7f6794e65efa49ce1377ad8493a19b96ee195` |
| ` M` | `packages/daemon/src/services/collection-mutation-service.ts` | `86b33040d0dbd53b8ba411b1028868b1963437e4` | `d4865d05dde334f478a6a1b92eaa4ff3d9f62a4dc95c4d02a49b0ac08ef537b8` |
| ` M` | `packages/daemon/src/services/displayed-fitness-service.ts` | `e8483dfcb2706a474474255238302d1da6e0cd98` | `8f2b4dcbfc3d1b14441b39a623d2052381df21d73e6dca273e93688901819481` |
| ` M` | `packages/daemon/src/services/prediction-service.ts` | `a7a205a2659b2921b8863d97447eeff97037f809` | `3704f9423710db5be15666fdb00149339c7ee4aa75ef7f86e8219e70c53f6cb7` |
| ` M` | `packages/daemon/src/services/profile-service.ts` | `85acaaf645c731bab58556adf3812f96404fcb4f` | `7f3ca3d32eda23285cb3273c912e76bce68d2e109f334b845999310728b55967` |
| ` M` | `packages/daemon/src/services/shelf-service.ts` | `b407d092b4123f25d6368e158261dff810795e8e` | `ee585a33db2892a39dfdd446bda384fb08e7a5163442ec6d798da54ecab7a82f` |
| ` M` | `packages/daemon/src/services/storage-service.ts` | `79c6c92ca5889b9400b3c8a44e43947ee1323bbb` | `df31555e9659b4bf9747616abd411436251c7b3f002decf5b2f8e7a540b2d621` |
| ` M` | `packages/daemon/src/services/tournament-service.ts` | `80f311d1ae676aa7f8803a30293aab6f9b770c9c` | `e5b5188b65fab27970569bb6fc99c7024ea2f99697503b04290651b1c87b4f52` |
| ` M` | `packages/daemon/tests/helpers/test-app.ts` | `b2775a8e455cc9d6920908378437bcfec8ab7895` | `589b0c3ed1d4d7e601b04651131515c55444430fd013f8cd956ce59e02891d8b` |
| ` M` | `packages/daemon/tests/services/collection-artifacts.test.ts` | `907b43a6a03abfcd4c72592d3269e14a99b0c28a` | `958d52a9483bee4e2e66ffa1b90763ed178892e29e3dc5f46f5ffabfc1e3c891` |
| ` M` | `packages/daemon/tests/services/displayed-fitness-service.test.ts` | `ac0e910f29d67e23a93cb7b8ad6b2538ab2db9e7` | `d0b8436f58247fde5bf1e3abf54a4286e587eece5a3e5c66b2721482d79fa9be` |
| ` M` | `packages/daemon/tests/services/prediction-service.test.ts` | `12b42972211e24ce15a45a2fbaa819b6a3307db1` | `873d4b47a80a136bc1bd383e7ada24d5feb5f36f72e28c4cc347d21bdc0a6fd1` |
| ` M` | `packages/daemon/tests/services/storage-collection-migration.test.ts` | `884b6e5bd1fbf3fa687df4de112fe0783755ff9a` | `557e1efb716d223b6bc294bb0cf2fb478a3ddea115c11436be8bf9aa7b625ad7` |
| ` M` | `packages/shared/src/index.ts` | `0f113a0e5e6abc0b19ed13e52ffd8f71b9ab6bb1` | `941f40047eb7920fe0fc1db24bdb33bef1d5bf557b2076d234189c465ddd12de` |
| `??` | `packages/daemon/src/services/attention-candidate-service.ts` | `ABSENT` | `05b3fa0a75dfe6f41f58f89dbb21cb875034830ba8eb7efa0ebf0780ea0fb4c1` |
| `??` | `packages/daemon/src/services/attention-mutation-impact.ts` | `ABSENT` | `c48cb226374e3352e3d51eb28a4344e472ad7f148b8213fa3ee480f24b3c6c3f` |
| `??` | `packages/daemon/tests/phase3-direct-integration.test.ts` | `ABSENT` | `890bed50ee4164c45a6a52619a8579bd35a583d3e36204b21f8d4cc49fd6dd60` |
| `??` | `packages/daemon/tests/services/attention-candidate-service.test.ts` | `ABSENT` | `ee685ba300bc2454337fb0f2f808208c4de7cef9ecf3dcef3459d79ba1b958ba` |
| `??` | `packages/daemon/tests/services/attention-candidate-storage.test.ts` | `ABSENT` | `c107bf9433ef39d3bcf7f172b2a2992315b0604bc4e93ec258c0e071d3aa6d97` |
| `??` | `packages/daemon/tests/services/attention-mutation-impact.test.ts` | `ABSENT` | `7b5310497af9bb6bc46fab916f308c462fca98ecd24486780fdbf2e46ce4c440` |
| `??` | `packages/shared/src/attention-candidate-artifact.ts` | `ABSENT` | `6c237198ecb8d89e0a17e55b32eac043e8bdfcc6e63a56484d8d07702c8f43e2` |
| `??` | `packages/shared/tests/attention-candidate-artifact.test.ts` | `ABSENT` | `2ada048104f47c7f4028de79b08642a4b9439604362485b43c2f43d3609f583f` |
