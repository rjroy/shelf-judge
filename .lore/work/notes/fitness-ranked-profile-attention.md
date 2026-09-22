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
- [x] Phase 4: atomic disposition commands and source mutations (accepted)
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

Captured after Phase 4 acceptance finalization and Beads export regeneration,
before this notes file’s final self-reference. Each entry records exact
porcelain status, index blob identity or `ABSENT`, and working-tree SHA-256 or
deletion marker. This notes file is intentionally recorded with
`SELF-REFERENCE: omitted`; no self-hash is claimed.

| Status | Path | Index | Working tree |
| --- | --- | --- | --- |
| ` M` | `.beads/interactions.jsonl` | `47b8f4621ff51070b1fe00f930a70c2a51d6d6fd` | `192de11e06fc48b886a16ec4a6909da4a2cae1517b9babf34b9808b266f1860b` |
| ` M` | `.beads/issues.jsonl` | `9b81573becf48f19dd70b7b0f6dbe8fca998ba96` | `ff9dcf26c3f181a3f8b3fe178a5521692b9c971708240ad2ba6ae533db3eef28` |
| ` M` | `.lore/work/notes/fitness-ranked-profile-attention.md` | `87cd0e26d894f01fa231bf353369974bb5d3a143` | `SELF-REFERENCE: omitted` |
| ` M` | `packages/daemon/src/app.ts` | `05d593d69ed0be5105cc5fa5762f670dcc995c62` | `94ea365f474c1fc647e5fc4b086dff88610b4fbd2302a76aafe2bc17548be14d` |
| ` M` | `packages/daemon/src/index.ts` | `d8fc5da250f817e3e87111aa3bcf12378e13b871` | `ff8024ecf7737096260aa3befb439eddfd83b6c627f74706472240a6a86c1b28` |
| ` M` | `packages/daemon/src/services/attention-candidate-engine.ts` | `3d92eabb4917e0ca58e5f9e3536a01d2ad0e01e3` | `9680ba95093d64f080948d22b0447db7d80b194b4091ea5af003d25f795bd9b8` |
| ` M` | `packages/daemon/src/services/attention-candidate-service.ts` | `db304c3fe7bb5b86185b82b375b7cf6b14fb54e6` | `293f78b4b7865e30d2449b1d71287f71209b4a4a331dbeef957592d87c9cdc08` |
| ` M` | `packages/daemon/src/services/collection-mutation-service.ts` | `fab148013549fe1e68b5fe90e8f298924cf4e73c` | `e740397dfb8916f37d994a88475d68b8cffd9dc1f35610266d11a49ad2eb05f3` |
| ` M` | `packages/daemon/src/services/game-service.ts` | `e8f40046d7b38b9b5e673009f77dacd9676f05ce` | `b6411494ef0422aeb9406e0a1f11847e4df764efe166129455344b1780501de3` |
| ` M` | `packages/daemon/src/services/profile-service.ts` | `e26d9c1ac32688892894537d97bc7f6ecf5d9615` | `ec8c0354e867995a78844a066af3e46335f6701002f358af6d917d9c4ea807ef` |
| ` M` | `packages/daemon/tests/helpers/test-app.ts` | `a640ff44c4c261db1221f51e161a300f7a120f0e` | `770efd6b2ff78a65e1f2408df2ba9ec906514e6cbf68a2774f482648b0efcfe3` |
| ` M` | `packages/daemon/tests/phase3-direct-integration.test.ts` | `39c12de7dc21b53d907f4dd9b93e195e114dbec3` | `2a331d4c54f4ec06d4292befe394d0f4d4bbde73439235fe855fa2a814aa0e28` |
| ` M` | `packages/daemon/tests/services/attention-candidate-service.test.ts` | `d54fb631a927f98d5558d8d3e8a49497eaac8a22` | `435cac349056b976311c46ced3032f3ece89c8d2e5619928cfbc56b98a196372` |
| ` M` | `packages/shared/src/collection-profile-validation.ts` | `8fc99c96a7bae93fb5a801c4d80082b441dcc9fb` | `c3c7908a6540e014123d5bc306a3f1ed53dc44821b7376cbabae28ae2e2ebbb6` |
| ` M` | `packages/shared/src/index.ts` | `5b8cdde65553eeb26e8a8e9e42797eae22be6b40` | `7ca40859f98a274fe3cd186b216fea6cb2eed598fba1ac2cc60bf71a67b20e8c` |
| ` M` | `packages/shared/src/types.ts` | `71efd0324869d16935aa51722ea12165970231e1` | `2247e669c44977b78800cccdb4e9d6196f3d39b6e9a4dc133dafc7e887381934` |
| ` M` | `packages/shared/src/validation.ts` | `1bf8e65955105e62ec0dba70e81742407d2a9aa9` | `09ffb2bc89ad01e1be7b9ca0e63770bd0516640b9e8979c6f697b66f2b796ee1` |
| ` M` | `packages/shared/tests/current-axis-validation.test.ts` | `8023f8dc2564aff353427f78d1e4baf023d2cfe9` | `19d04b5871fd78348035022cfd91c4990ecfef8888df54fd575101de4d6fb743` |
| `??` | `packages/daemon/src/routes/profile-attention.ts` | `ABSENT` | `9e630581d0b0e3228f489e9aa1a6742a92e6ec456562d5916c3c0c4f24d94981` |
| `??` | `packages/daemon/src/services/attention-disposition-compatibility.ts` | `ABSENT` | `112759a43f8a49236763319d9a51245cd097646433e099e01a4c0f816c8ac067` |
| `??` | `packages/daemon/src/services/attention-disposition-maintenance.ts` | `ABSENT` | `82e06be07b9911d912a04285bddc4a667f29655d439bc9062f6238ad43b4dbe3` |
| `??` | `packages/daemon/src/services/attention-disposition-service.ts` | `ABSENT` | `ed8f4384bae56bb58f9879acfea5dbacb5283be84bbd83c3a9e6642a97a83958` |
| `??` | `packages/daemon/tests/routes/profile-attention.test.ts` | `ABSENT` | `7958563fc1a1d9a7a6819c7f6609dd4254a2a7735271e31419c86946587b7a65` |
| `??` | `packages/daemon/tests/services/attention-disposition-service.test.ts` | `ABSENT` | `27ee87add8b2b389666a991e0461616517288160cd9ac8f849b1d8ff21f6fa69` |
| `??` | `packages/shared/src/attention-disposition-command.ts` | `ABSENT` | `594ad4aac391047fa49a7c794b16ce2a3aa5e5668ea87548dc96dabd78b5679a` |
| `??` | `packages/shared/tests/attention-disposition-command.test.ts` | `ABSENT` | `8b718a20abfdaeedf094b1246dc720e55289b9e9741f3a1f1cd0a83d5849024c` |

<!-- CURRENT-WORKTREE-MANIFEST -->

## Phase 3 / Phase 4 boundary (authorized 2026-09-21)

## Phase 4 Gate A implementation (pending independent validation)

- Added strict shared `not-now` and `intentional` command schemas and exported
  types in `packages/shared/src/attention-disposition-command.ts`; commands
  bind UUID command ID, game, rule ID/version, selected non-clock fingerprint,
  and expected disposition version.
- Added `packages/daemon/src/services/attention-disposition-service.ts`. It
  performs serialized collection mutation, durable validated receipts,
  canonical replay/reuse behavior, current-owner/current-selection/version
  checks, exact 720-hour UTC snoozes, and post-commit maintenance reporting.
- Attention disposition mutations identify an exact game candidate impact after
  their durable collection commit. No route or public Profile contract wiring
  was added, preserving the Gate A boundary.
- Initial `bun run typecheck` passed after these edits. Focused tests, lint,
  formatting, diff validation, and independent review remain required; this
  gate intentionally remains pending.

### Gate A completion validation (2026-09-21)

- Shared command, error, and result schemas are strict and exported.
  `AttentionDispositionService` accepts only strict, canonicalized owner
  commands. Its receipt's `requestFingerprint` is a canonical SHA-256 of the
  entire payload excluding the idempotency UUID, while the durable disposition
  retains the selected winner's non-clock fingerprint. Replays validate and
  return that receipt without scoring, saving, or maintenance; changed UUID
  reuse is rejected.
- Both commands run through the collection mutation boundary and validate game
  existence/ownership, expected disposition version, and the exact current
  selected candidate. Source persistence failure leaves the prior collection
  intact. After a source commit, exact-game candidate maintenance runs; an
  unavailable or throwing disposable maintenance result is reported as accepted
  with `attentionUnavailable`, never as a source rejection.
- `not-now` stores whole-game snooze state with response and expiry instants
  exactly 720 hours apart. `intentional` stores only winner rule/version and
  non-clock fingerprint. The existing candidate suite covers the resulting
  hidden-row/no-alternate and source-identity-race maintenance semantics.

### Gate A exact validation evidence

- Focused command: `bun test packages/shared/tests/current-axis-validation.test.ts packages/daemon/tests/services/attention-disposition-service.test.ts packages/daemon/tests/services/attention-candidate-service.test.ts packages/daemon/tests/services/collection-mutation-service.test.ts` — **70 passed, 0 failed, 401 expectations**.
- `bun run typecheck` — passed.
- `bun run lint` — passed.
- Changed supported files formatted with `bunx prettier --write`.
- `git diff --check` — passed.

### Gate A changed-file manifest

| Path | Working tree SHA-256 |
| --- | --- |
| `packages/shared/src/types.ts` | `28a8a3291fa2e2c72f2f1a389667cf13424cdc7573d9aa8ca2d2143ff55c151c` |
| `packages/shared/src/index.ts` | `a1c8c32f49e2add86f49e1573857ed08193a04083cd573bd0a94eec750fea497` |
| `packages/shared/src/collection-profile-validation.ts` | `4150bbdcc1cc58897bbea5b6787a6628e86d93aaf3795068a4ff74be8f57e9d2` |
| `packages/shared/src/attention-disposition-command.ts` | `fc49994f95619f43f3fac5e23ab4c82431acc05a3bb786514ab4bcd56a237a41` |
| `packages/shared/tests/current-axis-validation.test.ts` | `b870dfce375705e6dcde42a86f1d3065cdc145bea2c8659033dad6ac20c222c1` |
| `packages/daemon/src/services/collection-mutation-service.ts` | `1091b16940da944be9d969c1744c9132d7b14bc423baa22011a546e765ac6848` |
| `packages/daemon/src/services/attention-disposition-service.ts` | `185383b7094d7c1c6bee36032ee7866585031c9ffa039cca055748cd9d1addb9` |
| `packages/daemon/tests/services/attention-disposition-service.test.ts` | `f14b83c25999c50826cf165473916a252b08fa8990f38b1430f97e3bacf33aa0` |

Gate A remains **awaiting independent verification**. Gates B and C were not
implemented.

### Phase 4 Gate B progress (2026-09-21)

- Gate A is accepted locally and remains awaiting independent verification.
- Gate B is in progress. The collection mutation boundary now accepts one
  authoritative post-mutation winner resolver and clears only checked,
  incompatible intentional dispositions in the same validated Collection save.
  Ownership transitions away from owned clear either durable disposition. The
  compatibility helper deliberately receives pure-oracle winners rather than a
  candidate artifact, and typed mutation impacts bound local checks so clock and
  unrelated identity-only changes cannot clear durable state.
- Current implementation evidence: `attention-disposition-compatibility.ts`,
  `collection-mutation-service.ts`, daemon composition in `index.ts`, and
  focused disposition tests. Global writer/coordinator maintenance and the
  complete dependency-family matrix remain required before Gate B can advance.

### Gate B coordinator integration (2026-09-21)

- The collection boundary now obtains unsuppressed post-mutation winners from
  the production pure candidate oracle over the authoritative post-mutation
  Collection and current global sources. It never uses a candidate artifact as
  durable authority. Typed local impacts constrain intentional checks; snoozes
  remain untouched except for ownership loss.
- Global tournament, prediction, and redundancy maintenance now first runs a
  coordinator-serialized Collection compatibility mutation. If it clears an
  intentional disposition, that Collection revision is persisted before its one
  post-commit global candidate maintenance attempt. If nothing clears, normal
  global candidate maintenance runs once. Candidate failure remains fail-closed
  and does not replay either source save.
- Focused disposition/mutation tests: **24 passed, 95 expectations**. Focused
  mutation-impact/candidate/Profile integration tests: **37 passed, 255
  expectations**. `bun run typecheck`, `bun run lint`, Prettier on changed
  files, and `git diff --check` passed.

Gate B remains **awaiting independent verification**. The next reviewer should
exercise the global coordinator path and expanded dependency-family matrix with
production fixtures before accepting this gate.

### GB correction work in progress (2026-09-21)

- **GB-1:** compatibility now has a stored-rule oracle path. It evaluates the
  disposition's own catalog rule and its canonical non-clock fingerprint rather
  than comparing the disposition to the newly selected winner.
- **GB-2:** daemon composition creates the durable global compatibility
  coordinator before tournament reconciliation and runs a startup global pass
  before candidate recovery; the former no-op maintenance callback is removed.
- **GB-3:** a global compatibility/oracle failure after a source save is
  fail-closed for disposable attention publication and does not propagate back
  to reject or replay the durable source operation.

Partial validation only: `bun run typecheck` passed and
`bun test packages/daemon/tests/services/attention-disposition-service.test.ts packages/daemon/tests/attention-candidate-engine.test.ts packages/daemon/tests/phase3-direct-integration.test.ts`
passed (**45 tests, 292 expectations**). Required production-boundary family,
startup/catalog-mismatch, post-commit source-count tests, lint, formatting, and
the complete Gate B suite remain outstanding. Gate B remains **awaiting targeted
verification**.

### GB-1 / GB-3 targeted correction evidence (2026-09-21)

- Stored-rule matching is now a first-class production-oracle operation:
  `evaluateStoredRules()` projects the authoritative source with the same
  catalog, displayed-fitness service, and purchase-utilization projection as
  candidate evaluation, then calls the shared stored-rule evaluator. It does
  not compare a durable intention with the selected winner.
- Global maintenance records a failed compatibility attempt as recovery work,
  invalidates disposable candidates, and returns to the committed source
  writer. Startup recovery invokes that reconciliation before `ensureFresh()`;
  a successful source-maintenance pass is not repeated by startup.
- The focused Gate B command ran **117 tests, 501 expectations**, including
  disposition, oracle, collection-mutation, startup/persistence, tournament,
  and config integrations. `bun run typecheck`, `bun run lint`, scoped
  Prettier for changed Phase 4 files, and `git diff --check` passed.

Gate B remains **awaiting targeted verification**. The working tree does not
modify `packages/web/app/globals.css`; it was deliberately excluded from the
scoped Phase 4 formatter run.

### Phase 4 Gate C progress (2026-09-21)

- Gate B is accepted. Gate C is in progress and adds the canonical Profile
  owner-command route surface for `not-now` and `intentional`, with strict
  shared request schemas, idempotent result envelopes, and coherent validation,
  conflict, ownership, and persistence status mappings.
- Daemon and test composition now construct one disposition service from the
  authoritative source loader and production candidate oracle under the shared
  collection/coordinator boundary. Command-owned maintenance reports post-commit
  candidate unavailability without reclassifying the durable command, while the
  general observer deliberately skips that operation to prevent a duplicate
  rebuild.
- Initial focused route test and `bun run typecheck` pass. Broader Gate C route,
  Profile-read-only, persistence, recovery, and independent verification remain
  required. Gate C remains **awaiting independent verification**.

### Gate C implementation validation (2026-09-21)

- Production and test-app composition each build a single disposition service
  from the shared mutation service, candidate oracle/source loader, clock, and
  candidate recovery boundary. The post-commit observer skips attention-owned
  trigger contexts, leaving the command service as the sole maintenance caller.
- `POST /api/profile/attention/not-now` and `POST
  /api/profile/attention/intentional` are listed daemon operations. Both
  preserve strict payload operation identity and return the shared accepted,
  replayed, or rejected envelope. Validation is 400, missing games 404,
  ownership 422, reuse/stale/candidate conflicts 409, and source persistence
  failure 503.
- Production-equivalent route fixtures accept both commands against a real
  underused-purchase winner, assert one maintenance attempt, exact 720-hour
  snooze expiry, intentional winner fingerprint, and durable receipt/state.
  Direct command and Profile integration suites retain replay, conflict,
  committed-response-loss, recovery, and read-only Profile coverage.
- Validation: focused route/Profile/disposition/direct/collection command:
  **84 passed, 0 failed, 395 expectations**. `bun run typecheck`, `bun run
  lint`, scoped Prettier, and `git diff --check` passed. No web files changed,
  so a web build was not applicable.

Gate C remains **awaiting independent verification**.

### Gate C corrections GC-1 / GC-2 (2026-09-21)

- **GC-1:** Production and test current-selection resolvers now score the
  actual serialized Collection, including active dispositions. Identical
  receipts still replay before selection. Fresh commands cannot extend a
  snooze, convert a snooze to intentional, or replace intentional state: the
  oracle exposes no selected candidate, so they reject without source or
  candidate maintenance. At exact snooze expiry, the oracle naturally exposes
  the candidate again and a monotonic next-version command is accepted.
- **GC-2:** A successful later serialized global reconciliation now retires a
  previous recovery marker before candidate publication. Candidate publication
  remains independently fail-closed under Phase 3. Production-style coverage
  exercises failed reconciliation, read-only unavailable Profile responses, a
  later committed writer clearing the marker and republishing candidates, and
  the explicit recovery control.
- Route integration now deep-compares the full Collection around an accepted
  command, proving only disposition/receipt/revision/timestamp fields change,
  and covers active replacement rejection with one maintenance attempt.

### GC-1 / GC-2 validation (2026-09-21)

- Focused Gate C route, Profile, disposition, candidate, collection, direct,
  and shared command suite: **156 passed, 0 failed, 913 expectations**.
- `bun run typecheck`, `bun run lint`, `bun run build`, scoped Prettier, and
  `git diff --check` passed.

Gate C remains **awaiting independent verification**.

### GB-3 / GB-V1 production-evidence closure (2026-09-21)

- `runtime recovery reconciles a committed tournament write before publishing
  candidates` now seeds a UUID-addressable real `underused-purchase` winner
  through the canonical disposition command, delegates recovery matching to
  the real production oracle/source loader after a first controlled fault, and
  verifies the repeated exact `{ gameId, ruleId: "underused-purchase" }`
  target, one tournament save, one compatibility-clear revision, receipt
  retention, and publication only after recovery.
- `GB-V1 refreshBggData clears only the incompatible stored play rule via
  production oracle wiring` now supplies the concrete BGG plays response and
  asserts the resulting `bggPlaySessions` field plus one Collection rename.
  Snooze writer controls assert retained receipt equality and one Collection
  save. `GB-V1 acquisition route atomically clears a real underused-purchase
  intention` and both `GB-V1 setOwnership clears … disposition` cases assert
  atomic clear, receipt retention, one revision/save, and one maintenance
  attempt through production APIs.
- Gate B focused suite: `bun test packages/shared/tests/current-axis-validation.test.ts
  packages/daemon/tests/services/attention-disposition-service.test.ts
  packages/daemon/tests/services/attention-candidate-service.test.ts
  packages/daemon/tests/services/collection-mutation-service.test.ts
  packages/daemon/tests/attention-candidate-engine.test.ts
  packages/daemon/tests/phase3-direct-integration.test.ts` — **121 passed,
  0 failed, 765 expectations**. `bun run typecheck`, `bun run lint`, and
  `git diff --check` passed.

| Path | Working tree SHA-256 |
| --- | --- |
| `packages/daemon/src/index.ts` | `9e0d149ed6cca3601998e5c8d399b04df6d1e895dd697de634ecccfd0dd587d1` |
| `packages/daemon/src/services/attention-candidate-engine.ts` | `9680ba95093d64f080948d22b0447db7d80b194b4091ea5af003d25f795bd9b8` |
| `packages/daemon/src/services/attention-candidate-service.ts` | `1ba7a6b430ee1fd0df451f350d897c45d640f0556b4f7498b3f3905eedd8962b` |
| `packages/daemon/src/services/attention-disposition-compatibility.ts` | `112759a43f8a49236763319d9a51245cd097646433e099e01a4c0f816c8ac067` |
| `packages/daemon/src/services/attention-disposition-maintenance.ts` | `249350df61b3038e298bf163fca75ada346e82f3243ce5a34ce211b608c0275f` |
| `packages/daemon/tests/helpers/test-app.ts` | `c7c32a8b96ee98edb936eff1a7b8d33fb6baa07db6e49a72e1e52c9c73a9c150` |
| `packages/daemon/tests/phase3-direct-integration.test.ts` | `096c19902e3007c5556542236c34a822d9442951f31ad7140b17bf4b70139b56` |
| `packages/daemon/tests/services/attention-disposition-service.test.ts` | `06b3235fa00dfa51187e650bc647867f0b715dc72e3964abe80672a7f0f58ce7` |

### GB-V1-1 final evidence closure (2026-09-21)

- `GB-V1 refreshBggData clears only the incompatible stored play rule via production oracle wiring` now creates both intentional dispositions through the Gate A command service from production candidates, retains both durable receipts, and verifies concrete BGG play sessions with one source save, revision, and maintenance attempt.
- `GB-V1 intention complete atomically clears only its real explicit-intention disposition` and `GB-V1 intention retire atomically clears only its real explicit-intention disposition` create intentions through the production intention service, then resolve them with their durable IDs and versions. Both retain receipts, preserve an unrelated disposition, and assert one revision/save/maintenance attempt. Matching `preserves a real snooze receipt` controls cover complete and retire.
- `GB-V1 acquisition route atomically clears a real underused-purchase intention` now includes a command-created unrelated disposition and receipt, proving target-only invalidation preserves unrelated durable state.
- Validation: direct integration **21 passed, 0 failed, 136 expectations**; disposition/intention/BGG/acquisition services **139 passed, 0 failed, 905 expectations**; full Gate B focused suite **125 passed, 0 failed, 789 expectations**. `bun run typecheck`, `bun run lint`, changed-file Prettier (excluding unchanged `globals.css`), and `git diff --check` passed.

### Gate B boundary matrix expansion (2026-09-21)

- Added collection-boundary table cases for the play evidence, BGG session,
  purchase acquisition, and intention local dependency families. Each proves
  one save/revision and one post-commit observer when an authoritative winner
  fingerprint changes. Unrelated identity-only and no-op paths preserve the
  intentional disposition without extra save/maintenance.
- Added both snoozed and intentional ownership-removal cases through the
  mutation service. Both clear in the initiating revision with exactly one
  collection save; the existing command suite retains receipt monotonicity,
  response-loss classification, candidate-unavailable handling, and replay
  evidence.
- Focused Gate B matrix: **58 passed, 299 expectations** across disposition,
  collection-mutation, mutation-impact, candidate-service, and Profile service
  tests. `bun run typecheck`, `bun run lint`, changed-file Prettier, and `git
  diff --check` passed.

### Gate B global coordinator boundary (2026-09-21)

- Extracted the global disposition-maintenance entrypoint and wired production
  tournament/prediction callbacks through it after candidate/oracle composition.
  It clears incompatible intentional state in a coordinator-owned Collection
  revision before the collection observer rebuilds candidates; unchanged global
  state skips the Collection save and invokes one normal global rebuild.
- Direct executable cases cover a changed rule version and matching snooze
  control, including source revision/save and observer versus fallback-rebuild
  counts. Focused disposition service: **17 passed, 84 expectations**.
- `bun run typecheck`, `bun run lint`, changed-file Prettier, and `git diff
  --check` passed. Gate B remains awaiting independent verification.

### Gate A review corrections (GA-1 through GA-5)

- **GA-1:** disposition version lookup now takes the maximum of active state
  and attention receipt history, preventing a post-clear version reset.
- **GA-2:** owner commands opt into collection persistence-outcome
  classification, so a save response lost after an exact durable reread is an
  accepted command rather than a false persistence rejection.
- **GA-3:** receipts retain their strict canonical request payload and a
  SHA-256 binding. Collection validation recomputes the hash and proves every
  payload field, including selected non-clock fingerprint, equals its receipt
  and accepted disposition. Schema tests reject independently corrupted hashes
  and accepted fingerprints.
- **GA-4:** command maintenance moved into the mutation boundary's
  post-persistence callback. It runs once before the accepted response; its
  unavailable result is reported without rolling back source state. The normal
  collection observer remains for non-command writers.
- **GA-5:** command UUIDs normalize to lowercase at parsing and strict command
  schemas retain the durable rule identifier grammar.

Correction validation: focused shared/disposition/candidate/collection mutation
command passed **70 tests, 403 expectations**; `bun run typecheck`, `bun run
lint`, changed-file Prettier, and `git diff --check` passed. Gate A remains
awaiting targeted independent verification.

### Targeted correction evidence update

- GA-1 now has a direct command-service test: v1 is accepted, an authorized
  setup clear retains its receipt, a changed winner accepts at v2, both durable
  receipts replay, and stale v0 rejects.
- GA-2 directly covers persist-then-reject recovery and reject-before-persist,
  including exactly-once maintenance only for the verified durable commit.
- GA-4 directly covers one integrated maintenance call with both available and
  unavailable outcomes, preserving the committed collection revision when
  attention is unavailable.
- `bun test packages/daemon/tests/services/attention-disposition-service.test.ts`
  passed: **9 tests, 40 expectations**. The full focused matrix must be rerun
  after this notes update before independent verification.

### Final correction-round validation (2026-09-21)

- Focused shared/disposition/candidate/storage/impact/collection matrix:
  **96 passed, 0 failed, 594 expectations**.
- `bun run typecheck`, `bun run lint`, changed-file Prettier, and `git diff
  --check`: passed.

| Path | Working tree SHA-256 |
| --- | --- |
| `packages/shared/src/types.ts` | `2247e669c44977b78800cccdb4e9d6196f3d39b6e9a4dc133dafc7e887381934` |
| `packages/shared/src/validation.ts` | `09ffb2bc89ad01e1be7b9ca0e63770bd0516640b9e8979c6f697b66f2b796ee1` |
| `packages/shared/src/collection-profile-validation.ts` | `de3ba9940f3ed36365a5defd7f6b9d478fcb765fec3c852dea434947857951a8` |
| `packages/shared/src/attention-disposition-command.ts` | `10a6efec3805e1709d54662bdf37443e10fbaf57838e8be341b3d941a4e08807` |
| `packages/shared/src/index.ts` | `7ca40859f98a274fe3cd186b216fea6cb2eed598fba1ac2cc60bf71a67b20e8c` |
| `packages/shared/tests/current-axis-validation.test.ts` | `19d04b5871fd78348035022cfd91c4990ecfef8888df54fd575101de4d6fb743` |
| `packages/daemon/src/services/attention-disposition-service.ts` | `9fc9a476067e43e918a3813a07f5be456cb0fe305e2b1f76ae059522968f3e6c` |
| `packages/daemon/src/services/collection-mutation-service.ts` | `0b1f4be059a111b906b1a6edb6cbe1b723a38917e9b39b685354bb92e4b38188` |
| `packages/daemon/tests/services/attention-disposition-service.test.ts` | `c8a3f447fc3a676c93d07c803c0ded5341030a2de1691e57567d18f9b91be402` |

Gate A remains awaiting independent targeted verification.

### Final GA-4 / GA-5 closure

- Maintenance is now a required disposition-service dependency. Every new
  committed command invokes it exactly once from the serialized
  post-persistence callback; replay, rejection, and pre-persistence failure do
  not invoke it. Production app/route composition remains Gate C work.
- Commands reuse the exported durable `StableRuleIdSchema`; direct schema tests
  prove matching acceptance and rejection grammar, strict unknown-key and UUID
  validation, and lowercase UUID normalization. A service test proves
  uppercase/lowercase UUID replay produces one durable receipt.
- Final focused matrix: **99 passed, 0 failed, 615 expectations**. `bun run
  typecheck`, `bun run lint`, changed-file Prettier, and `git diff --check`
  passed.

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

## Phase 4 execution initialization (2026-09-21)

**Baseline:** `HEAD 8f32a1ddf601eef166843ac866c6fb61d5a5b9f8`
(`8f32a1d`). **Claimed bead:** `shelf-judge-cq1.4`.

Phases 1, 2, and 3 are accepted. Phase 4 is now in progress; Phases 5, 6,
and 7 remain pending. This initialization preserves the accepted Phase 3
history and its boundary: Phase 3 owns disposable candidate freshness,
inactive stale-disposition representation, and fail-closed publication. Phase
4 owns durable disposition commands and durable clearing of incompatible
dispositions, performed atomically with source mutation or serialized global
maintenance, never during Profile rendering.

### Resumable execution gates

#### Gate A: shared command/result contracts and disposition service/replay

- Finalize strict shared request, result, conflict, and receipt contracts for
  `not-now` and `intentional`: UUID command ID, game ID, stable rule ID, and
  expected disposition/source version.
- Add `attention-disposition-service` with serialized collection retry
  semantics. It must validate current ownership and the addressed current
  selected winner, write the minimal durable record plus receipt, calculate
  snooze expiry as response instant plus exactly 720 hours, and return the
  recorded validated receipt for a byte-equivalent replay.
- Reject changed-payload command-ID reuse and return structured validation,
  stale-version, game-not-found, candidate-mismatch, command-reuse, and
  persistence outcomes without changing source or candidates.

#### Gate B: atomic local/global clearing through the mutation boundary

- Extend the collection mutation boundary and local mutation callers to carry
  exact affected-game contexts and post-commit candidate-maintenance impacts.
- From post-mutation inputs, clear an intentional disposition permanently at
  the first relevant declared non-clock fingerprint or rule-version mismatch;
  clear either disposition on ownership loss. Snoozes ignore dependency and
  rule-version changes until their exact expiry, except for ownership loss.
- Commit source mutation and any derived disposition deletion in one validated
  collection revision. Only after that accepted commit, invoke candidate
  maintenance under the existing coordinator; candidate maintenance failure is
  fail-closed/unavailable and does not replay or roll back the committed source
  mutation. Global version incompatibility is handled by serialized maintenance,
  not GET.

#### Gate C: routes, production/test wiring, and GET-purity/failure integration

- Register daemon-owned Profile action routes and inject the disposition
  service through production app/index and test-app wiring.
- Cover command receipts/replay, structured failures, local and global source
  changes, candidate-maintenance failure, and pure GET behavior through routes
  and production-style integration fixtures.
- Do not cut over the public Profile card contract, card cap/CLI surfaces, or
  web rendering/action relay. Those remain Phase 5 and Phase 6 work; the
  browser continues to perform no scoring, ranking, disposition lifecycle, or
  fallback inference.

### Obligation-to-executable-evidence map

| Obligation / plan commitment | Gate | Affected consumers and boundary | Concrete executable evidence |
| --- | --- | --- | --- |
| REQ 12: existing intention lifecycle remains durable and competes normally | B | `intention-service`, collection mutation boundary, candidate maintenance; legacy intention routes | Extend `packages/daemon/tests/services/intention-service.test.ts` and `packages/daemon/tests/routes/collection.test.ts`; run the Phase 4 focused command below. |
| REQ 14: viewing/GET has no mutation or score turnover | C | `profile-service`, `routes/profile.ts`, coordinator, collection storage | Add GET revision/write/disposition assertions in `packages/daemon/tests/routes/profile.test.ts` and `packages/daemon/tests/profile-service.test.ts`; run `bun test packages/daemon/tests/routes/profile.test.ts packages/daemon/tests/profile-service.test.ts`. |
| REQ 15: Not now suppresses the whole game for exactly 720 hours and ownership loss clears it | A, B, C | shared command/receipt schemas, disposition service, ownership/game mutations, candidate service, Profile action route | Controlled-clock disposition/service and route fixtures prove exact expiry, no alternate winner after dependency/rule changes, ordinary expiry reevaluation, and atomic ownership clearing; run the Phase 4 focused command. |
| REQ 16: intentional persists only while rule version and non-clock fingerprint match, then clears once | A, B, C | rule catalog fingerprint inputs, local/global mutation paths, serialized maintenance, candidate service | Fixtures cover match, unrelated input/clock passage, first local and global mismatch, ownership loss, and reversion non-revival; extend collection-mutation, purchase-utilization, and Profile route tests; run the Phase 4 focused command. |
| REQ 17: dispositions are local, minimal, durable, owner-scoped, and separate from source domains | A, B | Collection v8 root schemas, receipt schemas, disposition service, storage mutation transaction | Schema/receipt assertions plus service tests prove only root disposition/receipt records change and existing intentions/evidence/purchase/history do not; run `bun test packages/daemon/tests/services/collection-mutation-service.test.ts packages/daemon/tests/routes/collection.test.ts`. |
| REQ 18: local dependency updates are targeted; global/recovery updates may rebuild | B | `collection-mutation-service`, affected game mutation callers, `attention-candidate-service`, coordinator | Instrument exact game impact and global impact fixtures, including post-commit maintenance; compare incremental result with the candidate oracle in collection-mutation and integration tests. |
| REQ 19: controlled UTC due maintenance avoids repeated read evaluation | B, C | candidate due index/service, injected clock, Profile service/route | Controlled-clock fixture proves the 720-hour disposition boundary is maintained once through candidate maintenance and repeated pre-due GETs do no source write; run focused Phase 4 command plus `packages/daemon/tests/profile-service.test.ts`. |
| REQ 20: daemon-owned, validated, atomic candidate/Profile publication; no read-side source mutation | A, B, C | shared validators, disposition service, mutation coordinator, candidate service, Profile routes/app wiring | Acceptance/replay and persistence-failure fixtures assert one source commit, post-commit maintenance only, no partial publication, structured failure, and pure GET; run focused Phase 4 command and `bun run typecheck`. |
| REQ 24: no authored rules, free text, exposure decay, notifications, providers/AI, or accepted-source conflicts | A, C | shared public contracts, daemon route surface, app wiring | Contract and route fixtures accept only enumerated command/disposition fields and assert no GET lifecycle side effect; review changed-file manifest against Phase 4 boundary; run `bun run typecheck`. |
| Plan: commands require UUID IDs, expected version, owned/current selected winner validation | A, C | shared validation/types, disposition service, `routes/profile.ts` | Request-validation, stale-version, game-not-found, and candidate-mismatch route/service cases in `packages/daemon/tests/routes/profile.test.ts`. |
| Plan: canonical identical replay returns receipt; changed payload reuse conflicts | A, C | root command receipts, disposition service, Profile action routes | Service and route replay/reuse matrix in `packages/daemon/tests/routes/profile.test.ts` and collection route tests. |
| Plan: source commit precedes candidate maintenance under coordinator; failures do not replay source commit | B, C | collection mutation observer, coordinator, candidate service, app/test wiring | Persistence-failure integration fixture asserts committed collection state once, discarded/unavailable candidate state, and later recovery; extend `packages/daemon/tests/services/collection-mutation-service.test.ts`. |
| Plan: old intention actions remain lifecycle-compatible and only update competitive candidate context | B, C | intention service/routes, collection mutation impact, candidate service | Existing intention route/service regressions plus candidate-impact assertions in `packages/daemon/tests/services/intention-service.test.ts` and `packages/daemon/tests/routes/collection.test.ts`. |
| Plan Phase 4 executable command and local acceptance gate | A, B, C | all Phase 4 daemon/shared consumers | `bun test packages/daemon/tests/services/collection-mutation-service.test.ts packages/daemon/tests/routes/profile.test.ts packages/daemon/tests/routes/collection.test.ts packages/daemon/tests/services/purchase-utilization-service.test.ts && bun run typecheck`; then `bunx prettier --write .lore/work/notes/fitness-ranked-profile-attention.md` and `git diff --check`. |

### Current pending manifest summary

At initialization, the worktree is at the baseline above with one pending
tracked change: `M .beads/issues.jsonl`. No production code, tests, Beads
state, or accepted Phase 3 manifest entries were altered by this initialization;
the notes file becomes the only implementation-workflow artifact changed here.

### Authority reconciliation

No concrete planning gap or source contradiction was found. The approved spec
requires derived clearing to occur in the atomic source-update or
candidate-maintenance transaction, and the approved Phase 3/4 boundary assigns
only that durable clearing and command causality to Phase 4. Implementation can
proceed within Gates A through C.
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

### Phase 4 Gate B global completion (2026-09-21)

- Added production-boundary global-maintenance cases through
  `createAttentionDispositionGlobalMaintenance` and the injected pure winner
  path. Dependency rule-version and scoring fingerprint changes clear active
  intentional dispositions before candidate publication, while matching
  intentional dispositions and snoozes make no source save. Ownership-loss
  clearing remains covered by the collection mutation boundary.
- The failure/recovery case proves a committed global clear remains durable when
  candidate publication is unavailable, recovery publishes without replaying
  the source clear, and durable command receipts advance the next disposition
  version monotonically.
- Focused Gate B plus disposition/candidate/Profile integration suite:
  **108 passed, 0 failed, 626 expectations**. The single disposition service
  suite additionally passed **21 tests, 120 expectations**.
- `bun run typecheck` and `bun run lint` passed. Changed-file Prettier passed.

| Status | Path | Index | Working tree SHA-256 |
| --- | --- | --- | --- |
| `??` | `packages/daemon/tests/services/attention-disposition-service.test.ts` | `ABSENT` | `f0e2def082c1a7cb9877c27186c38ddcb9c75c6378e22fcd405cef6e6f0de73f` |
| ` M` | `.lore/work/notes/fitness-ranked-profile-attention.md` | unchanged | `SELF-REFERENCE: omitted` |

### Gate B correction validation (2026-09-21)

- **GB-V1 BGG production writer:** `Phase 3 direct integration evidence >
  GB-V1 refreshBggData clears only the incompatible stored play rule via
  production oracle wiring` builds the known-valid `refreshedBggResult` with
  `createCompleteEntityMetadata`, invokes `gameService.refreshBggData`, and
  proves the production stored-rule oracle clears only the affected
  `never-played` intentional disposition in the writer's same revision while
  retaining an unrelated disposition and making one candidate-maintenance
  attempt.
- **GB-V1 acquisition and lifecycle writers:** `Phase 3 direct integration
  evidence > GB-V1 acquisition and intention writers reconcile their stored
  rules without touching another game` uses the acquisition HTTP route and
  `intentionService.execute(create/complete)`. It proves the local
  underused-purchase disposition clears only for the acquired game, the
  companion remains, an explicit-intention snooze survives completion, its
  expiry is exactly 720 hours, and `gameService.setOwnership(...,
  "previously-owned")` is the concrete early-clear path.

- **GB-3 recovery correction:** the daemon startup and Profile paths now share
  `createAttentionCandidateRecovery`, which runs durable global disposition
  reconciliation before candidate freshness. The test-app production harness
  mirrors this wiring. Direct integration proves a tournament write commits
  once, an unavailable first stored-rule evaluation invalidates candidates,
  recovery clears the incompatible intentional disposition in one later
  Collection revision while retaining its receipt, then publishes candidates
  once without replaying the tournament write.

- **GB-1:** stored-rule compatibility coverage is green through the disposition
  service suite, including the underused stored-rule/current-winner mismatch
  control.
- **GB-2:** daemon global-coordinator integration is green through the direct
  integration suite, including post-commit source-save ordering.
- **GB-3:** committed-source recovery remains green when global compatibility
  resolution or candidate publication fails, without replaying the source save.
- Complete focused Gate B correction suite: **95 passed, 0 failed, 549
  expectations** across disposition, candidate service/storage/engine,
  collection-mutation, mutation-impact, Profile, and direct-integration tests.
  `bun run typecheck`, `bun run lint`, changed-file Prettier, and `git diff
  --check` passed.

| Status | Path | Working tree SHA-256 |
| --- | --- | --- |
| ` M` | `packages/daemon/tests/phase3-direct-integration.test.ts` | `096c19902e3007c5556542236c34a822d9442951f31ad7140b17bf4b70139b56` |
| ` M` | `.lore/work/notes/fitness-ranked-profile-attention.md` | `SELF-REFERENCE: omitted` |

### Gate B GB-V1 durable-snooze controls (2026-09-21)

- Replaced the ad hoc acquisition/intention seed with one fresh-app helper that
  uses the production source loader and oracle to select a real current
  candidate, then persists its `not-now` disposition through the Gate A command
  service. The helper snapshots the durable receipt-backed snooze at the
  already-covered exact `720h` expiry.
- Table-tested fresh instances for `intentionService.setPlayCount`,
  `gameService.refreshBggData`, the acquisition route, and
  `intentionService.execute(create)`. Each concrete writer commits one
  Collection revision, invokes production candidate maintenance once, and
  leaves the snapshot byte-for-byte equal as the sole disposition.
- The exact-expiry authority remains `AttentionDispositionService > writes an
  exact 720-hour whole-game snooze and canonical durable receipt`; no duplicate
  expiry calculation was added. The existing ownership-loss early-clear control
  remains in the direct integration file.
- Validation: direct integration passed (**14 tests**); the disposition and
  oracle suites passed (**40 tests**). `bun run typecheck`, `bun run lint`,
  touched-file Prettier, and `git diff --check` passed.

### Gate B GB-V1-2 Profile recovery purity correction (2026-09-21)

- Candidate construction now propagates the durable-recovery gate into the candidate service. Profile reads use only the side-effect-free freshness API; while global compatibility recovery is pending they fail closed before source, artifact, or oracle work.
- The direct regression verifies repeated Profile GETs remain unavailable with one stored-rule attempt and unchanged Collection/candidate state. The explicit daemon maintenance recovery performs the second compatibility attempt, then publishes candidates and permits a read-only Profile GET.

## P4-DEL-1 correction and nested coordinator evidence

Permanent `game.remove` now atomically removes the deleted game's active attention disposition and only its typed `attention-disposition` command receipts, alongside its owner-note receipts. Production-composed regression coverage exercises both snoozed and intentional commands, verifies one deletion revision/save, rejects reuse of the removed command ID as `game-not-found`, and preserves an unrelated game's complete durable record.

The direct global-writer regression enters `profileSourceCoordinatorFor(storage).runExclusive`, invokes tournament `afterSourceSave`, then invokes global disposition maintenance and a collection mutation through that same coordinator. It completes with the source saved once and ordered `source-saved`, `durable-clear`, then `candidate-publication`, proving reentrant serialization without duplicate maintenance or deadlock.

## Accepted Phase 4 (2026-09-22)

The seven-phase feature remains **in progress**. Phases 1, 2, 3, and 4 are
accepted and complete. Phases 5, 6, and 7 remain pending; Phase 5 is ready and
was not claimed or otherwise mutated during this closure.

Gates A through C are accepted. The authorized Phase 3/4 boundary was honored:
Phase 3 provides disposable candidate freshness, inactive stale-disposition
output, and fail-closed Profile publication; Phase 4 provides the durable
owner-response lifecycle and atomic clearing of incompatible dispositions.

Phase 4 delivers validated `not-now` and `intentional` disposition command
routes with canonical receipt replay and structured failures. Local owner/source
mutations atomically clear incompatible records in the collection revision;
serialized global maintenance performs global clearing before candidate
publication. Runtime and startup recovery reconcile durable compatibility
without blocking unrelated daemon availability. Profile GET remains pure and
fails closed while recovery is pending. Game deletion atomically removes the
deleted game's disposition and typed command receipts while preserving unrelated
records.

Accepted findings: GA-1 through GA-5, GB-1 through GB-3, GB-V1, GB-V1-2,
GC-1 through GC-2, and P4-DEL-1 are closed. This includes exact 720-hour
whole-game snoozes, intentional compatibility/reversion behavior, ownership-loss
clearing, reentrant coordinator ordering, recovery without source replay, and
the deletion lifecycle closure.

### Final accepted evidence

- Focused correction: **78 pass**.
- Full suite: **3,122 pass, 1 skip, 0 fail across 187 files**.
- `bun run typecheck`, `bun run lint`, `bun run build`, changed-file Prettier,
  and `git diff --check`: **pass**.
- Terminal reviewer accepted Phase 4.

### Accepted Phase 4 current-worktree manifest

Captured after closing `shelf-judge-cq1.4`. Every pending path records exact
porcelain status, index blob identity or `ABSENT`, and working-tree SHA-256 (or
a deletion marker). Passive Beads exports are included and were regenerated only
by normal `bd` operation. This notes file follows the established
self-reference convention: `SELF-REFERENCE: omitted`.

| Status | Path | Index | Working tree SHA-256 |
| --- | --- | --- | --- |
| ` M` | `.beads/interactions.jsonl` | `47b8f4621ff51070b1fe00f930a70c2a51d6d6fd` | `192de11e06fc48b886a16ec4a6909da4a2cae1517b9babf34b9808b266f1860b` |
| ` M` | `.beads/issues.jsonl` | `9b81573becf48f19dd70b7b0f6dbe8fca998ba96` | `f8a6db4fe60436df4dbec62e821ce6e28a62038ec6f973f0421e4089a453966a` |
| ` M` | `.lore/work/notes/fitness-ranked-profile-attention.md` | `87cd0e26d894f01fa231bf353369974bb5d3a143` | `SELF-REFERENCE: omitted` |
| ` M` | `packages/daemon/src/app.ts` | `05d593d69ed0be5105cc5fa5762f670dcc995c62` | `94ea365f474c1fc647e5fc4b086dff88610b4fbd2302a76aafe2bc17548be14d` |
| ` M` | `packages/daemon/src/index.ts` | `d8fc5da250f817e3e87111aa3bcf12378e13b871` | `ff8024ecf7737096260aa3befb439eddfd83b6c627f74706472240a6a86c1b28` |
| ` M` | `packages/daemon/src/services/attention-candidate-engine.ts` | `3d92eabb4917e0ca58e5f9e3536a01d2ad0e01e3` | `9680ba95093d64f080948d22b0447db7d80b194b4091ea5af003d25f795bd9b8` |
| ` M` | `packages/daemon/src/services/attention-candidate-service.ts` | `db304c3fe7bb5b86185b82b375b7cf6b14fb54e6` | `293f78b4b7865e30d2449b1d71287f71209b4a4a331dbeef957592d87c9cdc08` |
| ` M` | `packages/daemon/src/services/collection-mutation-service.ts` | `fab148013549fe1e68b5fe90e8f298924cf4e73c` | `e740397dfb8916f37d994a88475d68b8cffd9dc1f35610266d11a49ad2eb05f3` |
| ` M` | `packages/daemon/src/services/game-service.ts` | `e8f40046d7b38b9b5e673009f77dacd9676f05ce` | `b6411494ef0422aeb9406e0a1f11847e4df764efe166129455344b1780501de3` |
| ` M` | `packages/daemon/src/services/profile-service.ts` | `e26d9c1ac32688892894537d97bc7f6ecf5d9615` | `ec8c0354e867995a78844a066af3e46335f6701002f358af6d917d9c4ea807ef` |
| ` M` | `packages/daemon/tests/helpers/test-app.ts` | `a640ff44c4c261db1221f51e161a300f7a120f0e` | `770efd6b2ff78a65e1f2408df2ba9ec906514e6cbf68a2774f482648b0efcfe3` |
| ` M` | `packages/daemon/tests/phase3-direct-integration.test.ts` | `39c12de7dc21b53d907f4dd9b93e195e114dbec3` | `2a331d4c54f4ec06d4292befe394d0f4d4bbde73439235fe855fa2a814aa0e28` |
| ` M` | `packages/daemon/tests/services/attention-candidate-service.test.ts` | `d54fb631a927f98d5558d8d3e8a49497eaac8a22` | `435cac349056b976311c46ced3032f3ece89c8d2e5619928cfbc56b98a196372` |
| ` M` | `packages/shared/src/collection-profile-validation.ts` | `8fc99c96a7bae93fb5a801c4d80082b441dcc9fb` | `c3c7908a6540e014123d5bc306a3f1ed53dc44821b7376cbabae28ae2e2ebbb6` |
| ` M` | `packages/shared/src/index.ts` | `5b8cdde65553eeb26e8a8e9e42797eae22be6b40` | `7ca40859f98a274fe3cd186b216fea6cb2eed598fba1ac2cc60bf71a67b20e8c` |
| ` M` | `packages/shared/src/types.ts` | `71efd0324869d16935aa51722ea12165970231e1` | `2247e669c44977b78800cccdb4e9d6196f3d39b6e9a4dc133dafc7e887381934` |
| ` M` | `packages/shared/src/validation.ts` | `1bf8e65955105e62ec0dba70e81742407d2a9aa9` | `09ffb2bc89ad01e1be7b9ca0e63770bd0516640b9e8979c6f697b66f2b796ee1` |
| ` M` | `packages/shared/tests/current-axis-validation.test.ts` | `8023f8dc2564aff353427f78d1e4baf023d2cfe9` | `19d04b5871fd78348035022cfd91c4990ecfef8888df54fd575101de4d6fb743` |
| `??` | `packages/daemon/src/routes/profile-attention.ts` | `ABSENT` | `9e630581d0b0e3228f489e9aa1a6742a92e6ec456562d5916c3c0c4f24d94981` |
| `??` | `packages/daemon/src/services/attention-disposition-compatibility.ts` | `ABSENT` | `112759a43f8a49236763319d9a51245cd097646433e099e01a4c0f816c8ac067` |
| `??` | `packages/daemon/src/services/attention-disposition-maintenance.ts` | `ABSENT` | `82e06be07b9911d912a04285bddc4a667f29655d439bc9062f6238ad43b4dbe3` |
| `??` | `packages/daemon/src/services/attention-disposition-service.ts` | `ABSENT` | `ed8f4384bae56bb58f9879acfea5dbacb5283be84bbd83c3a9e6642a97a83958` |
| `??` | `packages/daemon/tests/routes/profile-attention.test.ts` | `ABSENT` | `7958563fc1a1d9a7a6819c7f6609dd4254a2a7735271e31419c86946587b7a65` |
| `??` | `packages/daemon/tests/services/attention-disposition-service.test.ts` | `ABSENT` | `27ee87add8b2b389666a991e0461616517288160cd9ac8f849b1d8ff21f6fa69` |
| `??` | `packages/shared/src/attention-disposition-command.ts` | `ABSENT` | `594ad4aac391047fa49a7c794b16ce2a3aa5e5668ea87548dc96dabd78b5679a` |
| `??` | `packages/shared/tests/attention-disposition-command.test.ts` | `ABSENT` | `8b718a20abfdaeedf094b1246dc720e55289b9e9741f3a1f1cd0a83d5849024c` |
