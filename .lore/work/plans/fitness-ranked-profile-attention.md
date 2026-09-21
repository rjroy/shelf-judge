---
title: "Implementation plan: fitness-ranked Profile attention"
date: 2026-09-20
status: approved
tags: [plan, profile, attention, ranking, collection, fitness]
modules: [shared, daemon, cli, web]
related:
  - .lore/work/specs/fitness-ranked-profile-attention.md
  - .lore/reference/specs/current/useful-collection-profile.md
  - .lore/reference/specs/current/collection-purchase-utilization.md
  - .lore/work/specs/expanded-profile-attention-opportunities.md
  - .lore/work/plans/expanded-profile-attention-opportunities.md
---

# Implementation plan: fitness-ranked Profile attention

## Purpose and boundaries

Implement approved spec `.lore/work/specs/fitness-ranked-profile-attention.md` for epic `shelf-judge-cq1`. This is a coordinated replacement of the current intention-shaped Profile attention contract, not an additive compatibility layer. Active intentions remain durable lifecycle records, but become one candidate rule and are no longer guaranteed cards.

The implementation retains the implicit single local owner scope. It must not add owner IDs, accepted-source provenance, user-authored rules, free-text feedback/history, providers or AI, notifications, or exposure decay.

### Binding architecture decisions

1. **Durable source state:** add minimal game-level attention dispositions at the versioned `Collection` root, keyed by game ID, rather than to `Game`, play evidence, intentions, acquisition, or history. The v7-to-v8 migration initializes an empty list. Collection validation makes IDs unique, records local-owner only, and validates the strict discriminated snooze/intentional shapes. Because the records are source state, ownership loss and local dependency mutations clear them inside the same `collectionMutationService` transaction.
2. **Disposable projection:** persist a separate, independently versioned `attention-candidates` artifact. It contains an evaluation row for every currently owned game, including games with no current winner and games hidden by a disposition. Each row stores dependency fingerprints, nullable winner data, exact signal strength, category weight and product, disposition state, next UTC evaluation boundary, source revision and relevant global versions/hashes. A due index is therefore independent of winner existence. Invalid JSON, validation failure, collection/rule/algorithm version mismatch, or incompatible identity is discarded, then rebuilt from the pure oracle. It never becomes authority for a disposition.
3. **Atomic source versus disposable publication:** collection mutations declare `AttentionMutationImpact` as either exact game IDs or a global invalidation reason. Truly game-local changes reevaluate only those games. A mutation that can alter peer displayed fitness, including ownership, rating, axis, metadata, tournament, prediction, or redundancy-universe changes, must expand the affected set correctly or use a global rebuild. Source mutation plus required disposition clearing validates and commits as one collection transaction. Candidate persistence occurs only after that commit while holding the Profile source coordinator; it is published only if the committed source revision/fingerprints still match. A failure leaves no partial candidate/profile publication and uses discard/rebuild/unavailable semantics. `computeAttentionCandidates` is pure and full recomputation is the recovery oracle.
4. **Clock and maintenance:** inject a UTC clock. The artifact indexes each non-null next boundary. At daemon startup and Profile access, if the earliest boundary is due, run one serialized due-game maintenance pass, reevaluate only due games using the same clock date, persist the new projection, then publish. Downtime is caught up by evaluating each game whose stored boundary is at or before now once, calculating its next future boundary, not by replaying missed periods. Repeated reads before the next boundary only validate bounded source/cache identity and do not scan/evaluate games.
5. **Configuration:** `AppConfig.profileAttentionCardLimit` is a strict integer `0..24`, default `6`. It participates in Profile publication/cache identity and slices already-ranked cards only. It cannot affect candidate evaluation, rule scores, fingerprints, or candidate rebuilds.
6. **Precise reuse:** attention calls canonical displayed-fitness snapshot services and `calculatePurchaseUtilization()` with the same resolved inputs/results as purchase utilization. It never parses display strings or recreates purchase math. Exact `ExactRational` values decide winner/ranking; display percentages are separately rounded half-away-from-zero.
7. **Global publication boundary:** tournament, prediction, redundancy, attention-limit config, collection, candidate, and Profile writers participate in the same coordinator or perform a final durable identity reread before publication. Global fitness changes rebuild affected candidates and clear incompatible intentional dispositions under serialized maintenance. A partial multi-file failure cannot publish stale cards; it leaves attention unavailable until startup or explicit maintenance safely completes.

## Phase 1: Establish source schema, contracts, and compatibility cutover

**Goal:** make the additive v8 source state, attention internals, and config setting landable without cutting over the public Profile card contract early.

**Likely files/modules**

- Change `packages/shared/src/types.ts`: introduce `CollectionV8`, `AttentionDisposition`, attention command/receipt types, additive internal rule/candidate types, `AppConfig.profileAttentionCardLimit`, and v8 Profile source identity. Do not replace the public Profile attention card shape yet.
- Change shared Collection/AppConfig schemas and exports to validate dispositions, receipts, candidate internals, and `profileAttentionCardLimit`; keep the intention-shaped public Profile response valid until Phase 5's coordinated cutover.
- Change `packages/daemon/src/services/storage-service.ts`: update new-collection construction, config defaults/parsing, current-version normalization, and all test constructors so required v8 and config fields exist immediately.
- Change the shared exports that define `CURRENT_COLLECTION_SCHEMA_VERSION`; defer `CURRENT_PROFILE_CONTRACT_VERSION` and `CURRENT_PROFILE_ALGORITHM_VERSION` changes to Phase 5.
- Change `packages/daemon/src/services/collection-migration.ts` and its migration tests to add exactly v7→v8 after the existing v6→v7 step.
- Change `packages/daemon/tests/services/collection-migration.test.ts`, `packages/daemon/tests/services/storage-collection-migration.test.ts`, `packages/daemon/tests/services/storage-service.test.ts`, `packages/daemon/tests/routes/config-routes.test.ts`, all current collection/config constructors, `packages/shared/tests/useful-profile-contract.test.ts`, and fixtures under `packages/shared/tests/fixtures/`.

**Behavioral obligations:** REQ-RANKED-ATTN-2, 7, 17. This phase creates additive shared foundations while preserving the old public Profile response until its consumers change together.

**Implementation detail:** disposition rows are `{ gameId, kind: "snoozed" | "intentional", ... }`; snooze has response instant and exact expiry, intentional has stable winning rule ID, rule version, and non-clock fingerprint. Both carry only their required optimistic/concurrency version and no owner field because the collection is the single local owner scope. Their command receipts are root-level alongside existing receipts, share the validated UUID/idempotence model, and reference existing games. Strict schemas reject duplicate game dispositions, duplicate command IDs, invalid timestamps, malformed fingerprints, invalid rule IDs, unsupported discriminants, and a disposition for a non-existent game. Migration creates `attentionDispositions: []` and any new receipt collection empty without inventing dispositions.

**Migration/compatibility:** sequential migration must parse `CollectionSchemaV7`, create v8 deterministically, advance `CURRENT_COLLECTION_SCHEMA_VERSION` to 8, and continue rejecting future versions. The source-schema identity change invalidates old Profile caches even before the later card-contract bump. Existing intentions and receipts retain their semantics and identities. Every new-collection, config, and fixture producer moves in this phase so the repository remains buildable.

**Executable validation:**

```bash
bun test packages/shared/tests/useful-profile-contract.test.ts packages/daemon/tests/services/collection-migration.test.ts packages/daemon/tests/services/storage-collection-migration.test.ts packages/daemon/tests/services/storage-service.test.ts packages/daemon/tests/routes/config-routes.test.ts
bun run typecheck
```

Expected: v0–v7 fixtures migrate sequentially to valid v8; v7 gets empty disposition/receipt state; malformed v8 root records and future schema versions fail strict validation; legacy intention data remains valid.

**Local acceptance gate:** all durable fields have one authoritative root location, v7 migration and legacy config defaulting are deterministic, every constructor/fixture is current, typecheck passes, and the still-live public Profile contract remains coherent until Phase 5.

## Phase 2: Build the pure rule catalog and candidate oracle

**Goal:** implement one registry-driven, deterministic evaluation path that can fully recompute candidates without I/O.

**Likely files/modules**

- Create `packages/daemon/src/services/attention-rule-catalog.ts` and `packages/daemon/src/services/attention-candidate-engine.ts`.
- Create `packages/daemon/src/services/purchase-utilization-projection.ts` as the pure canonical builder that resolves duration/player count, projects displayed fitness, invokes `calculatePurchaseUtilization()`, and exposes an explicit dependency/calculation version. Refactor `purchase-utilization-service.ts` to consume it before attention does.
- Keep ranked candidate construction separate from `collection-profile-engine.ts` in this phase. The existing intention-shaped public Profile producer remains live until the coordinated Phase 5 contract and consumer cutover.
- Reuse `packages/shared/src/exact-rational.ts`, `packages/shared/src/purchase-utilization.ts`, and canonical fitness inputs exposed by `packages/daemon/src/services/displayed-fitness-service.ts` and `packages/daemon/src/services/purchase-utilization-service.ts`.
- Add `packages/daemon/tests/attention-candidate-engine.test.ts`; extend `packages/daemon/tests/collection-profile-engine.test.ts`, `packages/daemon/tests/integration/purchase-utilization-response-parity.test.ts`, `packages/shared/tests/exact-rational.test.ts`, and `packages/shared/tests/purchase-utilization.test.ts` only for observable integration fixtures.

**Behavioral obligations:** REQ-RANKED-ATTN-1 through 6, 8 through 14, 23, 24.

**Implementation detail:** define a closed `AttentionRuleDefinition` registry where every rule supplies stable ID/version, applicability, exact signal and category weight, reason/question/actions, supersession set, declared local/global dependencies, non-clock fingerprint builder, and optional next-boundary builder. Registry traversal, not consumer switches, evaluates rules. Every owned game produces an evaluation row even when the winner is null or hidden. Validate exact signal strength, category weight, and attention score independently in `[0,1]`, and validate exact multiplication equality. Apply dispositions before supersession/winner selection; select one winner after supersession by exact score then rule ID; sort winners by exact score descending, NFC game name, game ID, rule ID.

Implement the exact initial rules: `never-played` requires current valid exact zero; `dormant` requires owned, prior play, trustworthy dated latest session, date-only UTC elapsed days ≥180, `floor(days/30)/(floor(days/30)+6)`, and next multiple-of-30-day UTC midnight; `underused-purchase` uses only a valid finite `not-met` value-multiplier numerator/denominator from `calculatePurchaseUtilization()` and shortfall `(d-n)/d`; `explicit-intention` requires one unresolved existing intention. Underused display percentage rounds separately, never participates in ranking. Use canonical displayed fitness snapshot output for the utilization input, not `displayScore` text.

**Migration/compatibility:** the pure input carries collection v8, current UTC instant/date, canonical displayed-fitness results, purchase-utilization result/input dependency version, and global dependency versions. It emits serializable exact numerator/denominator plus display-only values, never floating score order. It handles no candidate as a successful empty result, not a failure.

**Executable validation:**

```bash
bun test packages/daemon/tests/attention-candidate-engine.test.ts packages/daemon/tests/collection-profile-engine.test.ts packages/daemon/tests/integration/purchase-utilization-response-parity.test.ts packages/shared/tests/exact-rational.test.ts packages/shared/tests/purchase-utilization.test.ts
bun run typecheck
```

Expected: threshold boundary fixtures reproduce all four rules; stale/missing/invalid/non-finite inputs abstain only where applicable while retaining nullable evaluation rows; overlapping rules produce one winner; synthetic supersession excludes the weaker rule; exact ties and NFC ties are stable; active intentions can be ranked below stronger candidates; purchase detail and attention consume byte-for-byte equivalent exact utilization results.

**Local acceptance gate:** full pure recomputation has no storage, clock, or UI dependency and is the single oracle against which all later incremental behavior is compared.

## Phase 3: Persist disposable candidates and coordinate freshness

**Goal:** make normal local changes targeted, time maintenance bounded, and bad disposable state safely recoverable.

**Likely files/modules**

- Create `packages/daemon/src/services/attention-candidate-service.ts` (artifact read/validate/rebuild, targeted update, due maintenance, and indexes).
- Change `packages/daemon/src/services/collection-artifacts.ts` to register the independently versioned candidate artifact and discard it on incompatible collection-level artifact lifecycle events.
- Change `packages/daemon/src/services/storage-service.ts` and its test doubles to load/save/discard the artifact atomically with existing file operations.
- Change `packages/daemon/src/services/profile-source-coordinator.ts`, `packages/daemon/src/services/profile-service.ts`, and `packages/daemon/src/services/collection-mutation-service.ts` to pass source revision/global identity and `gameIds`, serialize maintenance/publication, and reject stale partial writes.
- Change relevant writers in `packages/daemon/src/services/tournament-service.ts`, `packages/daemon/src/services/prediction-service.ts`, `packages/daemon/src/routes/redundancy.ts`, and `packages/daemon/src/routes/config.ts` to run under the same coordinator and publish only after a final durable global-identity check.
- Change `packages/daemon/src/index.ts`, `packages/daemon/src/app.ts`, and `packages/daemon/tests/helpers/test-app.ts` to construct candidate maintenance and run startup recovery before Profile requests are served.
- Add/extend `packages/daemon/tests/services/collection-artifacts.test.ts`, `packages/daemon/tests/profile-service.test.ts`, `packages/daemon/tests/profile-stale-detection.test.ts`, `packages/daemon/tests/services/profile-persistence.test.ts`, and `packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts`.

**Behavioral obligations:** REQ-RANKED-ATTN-18 through 21, plus REQ-RANKED-ATTN-4 through 6 and 14 as persistence invariants.

**Implementation detail:** artifact identity includes artifact schema/version, rule catalog/scoring algorithm version, collection ID/schema/revision, relevant global hashes/versions, and candidate index version. Every currently owned game has a row retaining game ID/name ordering key, nullable winner, exact signal/weight/product, dependency and non-clock fingerprints, disposition-hidden state, next boundary even when no winner exists, and reverse dependency/index data sufficient to update exact IDs without scanning every game. The artifact records an earliest-boundary due index. Candidate changes are staged and schema-validated; write only if collection and durable global identity rereads after calculation still equal the identities used to calculate it. Otherwise discard the staged result and retry/rebuild while coordinator ownership is held.

Profile reads first load bounded source identity and artifact metadata. They never enumerate games for attention on a valid, not-due artifact. A corrupt/incompatible/missing artifact is discarded and rebuilt using the oracle. Daemon bootstrap invokes recovery and due maintenance before serving Profile requests; candidate recovery failure does not prevent unrelated daemon operations, but marks Profile attention unavailable/retryable until serialized maintenance succeeds. A due pass snapshots due IDs from the boundary index, including abstained 179-day dormant games and disposition-hidden games, evaluates each once at one injected UTC instant, writes the resulting projection, then allows Profile publication. If persistence/rebuild cannot safely complete, return the existing unavailable/retry contract rather than partial cards.

Define `AttentionMutationImpact` as `games(gameIds)` or `global(reason)`. Ordinary play, purchase, and intention changes use exact IDs only when they cannot affect peer displayed fitness. Ownership, rating, axis, metadata, tournament, prediction, redundancy, or feature-vector changes that alter the redundancy universe or shared displayed-fitness inputs use a computed fan-out or global rebuild. Global writers hold the coordinator across source write, disposition-maintenance attempt, candidate invalidation/rebuild, final identity reread, and Profile publication eligibility. If a cross-file step fails, no stale candidate/Profile is published; startup/global maintenance retries from durable source.

**Migration/compatibility:** artifact is disposable and has no migration chain. Old/malformed versions are deleted or quarantined according to the existing artifact policy and rebuilt. Phase 1's collection source-schema change already prevents incompatible old source identities from matching; the explicit public Profile contract/algorithm bump remains deferred to the coordinated Phase 5 cutover.

**Executable validation:**

```bash
bun test packages/daemon/tests/services/collection-artifacts.test.ts packages/daemon/tests/profile-service.test.ts packages/daemon/tests/profile-stale-detection.test.ts packages/daemon/tests/services/profile-persistence.test.ts packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts
bun run typecheck
```

Expected: instrumentation proves cache-hit reads do not enumerate/evaluate candidates; a truly local mutation touches only that game; 179→180 dormant eligibility and 720-hour snooze expiry occur through the persisted due index without source mutation or full scan; redundancy-enabled rating, ownership, axis, and feature-vector changes update peer underused candidates; tournament/prediction/redundancy/config races cannot publish stale output; malformed/version-mismatched artifact is discarded and rebuilt atomically; unavailable is distinct from successful empty; downtime processes each overdue game once.

**Local acceptance gate:** incremental results match a full oracle after every fixture mutation, and no stale candidate/profile can be published from a mismatched source revision or fingerprint.

## Phase 4: Make source mutations and attention responses atomic

**Goal:** add explicit Not now/This is intentional commands and ensure all dependency-driven disposition clearing occurs with source changes, never rendering.

**Likely files/modules**

- Create `packages/daemon/src/services/attention-disposition-service.ts`.
- Change `packages/daemon/src/services/collection-mutation-service.ts` to require/propagate affected `gameIds` for game-local mutation paths and invoke candidate maintenance after source commit.
- Change `packages/daemon/src/services/intention-service.ts`, `packages/daemon/src/services/purchase-utilization-service.ts`, game/play/ownership mutation services discovered from `packages/daemon/src/routes/games.ts`, and their mutation tests to declare exact affected-game dependency contexts.
- Change `packages/daemon/src/routes/profile.ts`, `packages/daemon/src/routes/games.ts`, and shared validation/types for attention commands, conflicts, receipts, and replay behavior.
- Change `packages/daemon/src/app.ts`, `packages/daemon/src/index.ts`, and `packages/daemon/tests/helpers/test-app.ts` to construct/inject the disposition service and register the production routes before route acceptance tests.
- Add/extend `packages/daemon/tests/services/collection-mutation-service.test.ts`, intention/purchase service tests, `packages/daemon/tests/routes/profile.test.ts`, `packages/daemon/tests/routes/collection.test.ts`, and route tests for game mutations.

**Behavioral obligations:** REQ-RANKED-ATTN-12, 14 through 20, 24.

**Implementation detail:** provide daemon routes for `not-now` and `intentional`, each accepting UUID `commandId`, game ID, stable rule ID, and expected disposition/source version required by the finalized shared contract. Commands validate that the addressed game is owned and currently has the stated selected candidate, use existing serialized collection mutation/retry semantics, save a validated receipt, and return accepted/replayed/no-op or structured validation, stale-version, game-not-found, candidate-mismatch, command-reuse, and persistence errors. Replaying an identical command returns the recorded validated receipt; reusing an ID for a different request is rejected.

Within every local source mutation, calculate the affected rule's non-clock fingerprint from the post-mutation candidate input. Clear intentional disposition permanently on its first declared dependency or rule-version mismatch, and clear all dispositions when ownership changes from owned. Snooze remains despite all dependency/rule changes until its exact timestamp, except ownership loss. Ensure clearing and source mutation share the one validated collection revision/commit. Rule/global version incompatibility is addressed by startup/global candidate maintenance that applies source maintenance under the coordinator, never a Profile render write.

**Migration/compatibility:** old intention action routes remain lifecycle-compatible, but their resulting mutation context updates the competitive candidate. No attention response changes an intention, evidence, purchase, or history unless the owner separately invokes that existing action.

**Executable validation:**

```bash
bun test packages/daemon/tests/services/collection-mutation-service.test.ts packages/daemon/tests/routes/profile.test.ts packages/daemon/tests/routes/collection.test.ts packages/daemon/tests/services/purchase-utilization-service.test.ts
bun run typecheck
```

Expected: production-style app wiring exposes both commands; controlled-clock snooze lasts exactly 720 hours and blocks alternate rules; ownership loss clears either disposition atomically; intentional clears once on the first relevant local or global mismatch and never revives on reversion; command replay returns its receipt; conflict/reuse failures leave collection/candidates unchanged; Profile GET causes no collection revision/write.

**Local acceptance gate:** all durable disposition changes, including derived clearing, have explicit command or source-mutation causality, a receipt where owner-authored, and an atomic collection transaction.

## Phase 5: Cut over Profile, config, and CLI surfaces

**Goal:** publish only daemon-ranked, cap-sliced cards across shared, daemon, and CLI contracts.

**Likely files/modules**

- Change `packages/daemon/src/services/profile-service.ts` and `packages/daemon/src/services/collection-profile-engine.ts` to obtain validated candidates, apply `profileAttentionCardLimit` after ranking, and construct the new Profile snapshot.
- Change `packages/daemon/src/routes/config.ts`, `packages/daemon/src/routes/profile.ts`, and `packages/daemon/tests/routes/config-routes.test.ts`.
- Change `packages/cli/src/commands/config.ts`, `packages/cli/src/commands/profile.ts`, and add an attention action surface only if the current CLI command architecture exposes owner Profile actions; otherwise document the explicit daemon route as the sole first-release action interface.
- Extend `packages/cli/tests/commands/config.test.ts`, `packages/cli/tests/commands/profile.test.ts`, and relevant CLI process tests.

**Behavioral obligations:** REQ-RANKED-ATTN-6, 7, 12, 13, 20 through 22.

**Implementation detail:** config parser/default writer from Phase 1 accepts only integer 0–24 and fills missing legacy config with 6. Cap changes run under the publication coordinator, affect Profile source/cache identity and output slicing, including `0`, but do not invalidate/recompute rule candidates or clear dispositions. In this coordinated shared/daemon/CLI cutover, replace the old public attention schema. Every candidate and selected card carries exact serialized signal strength, category weight, and attention score; strict validation bounds all three and proves exact `score = signal × weight`. The response also contains card identity, game/rule, reason, decision, display presentation, actions/destinations, relevant evidence, dependency/rule version, and disposition state. Remove all current contract assumptions that cards are intention-backed, alphabetical, or guaranteed. Bump Profile contract and algorithm versions in one shared/daemon/client deployment, rejecting stored old profile caches.

**Migration/compatibility:** preserve successful-empty versus unavailable response states. Existing profile consumers must compile only after adopting the new shared card shape; do not ship a dual old/new attention adapter. CLI parity is required if CLI presently offers actionable Profile cards, using the same command IDs and receipts; it must not compute candidates itself.

**Executable validation:**

```bash
bun test packages/daemon/tests/routes/config-routes.test.ts packages/daemon/tests/routes/profile.test.ts packages/cli/tests/commands/config.test.ts packages/cli/tests/commands/profile.test.ts
bun run typecheck
```

Expected: config defaults/limits validate; 0 returns no rule cards; 1/6/24 slice already-ranked output; CLI/Profile receive daemon order and action receipts without local scoring; old Profile cache contract is rejected.

**Local acceptance gate:** cap changes cannot alter candidate winner scores or rebuild behavior, and all server/CLI consumers compile against exactly one ranked-attention contract.

## Phase 6: Render and relay in the web client

**Goal:** replace intention-shaped cards with supplied ranked cards and provide a settings control without client inference.

**Likely files/modules**

- Change `packages/web/components/profile/attention-section.tsx` and Profile consumers covered by `packages/web/tests/profile-consumers-integration.test.tsx`.
- Change/add the existing web Profile API client used by `packages/web/tests/profile-api.test.ts` and the existing Settings UI discovered from the config route consumer.
- Extend `packages/web/tests/profile-accessibility-and-removal.test.ts`, `packages/web/tests/profile-unavailable.test.ts`, `packages/web/tests/profile-drilldowns.test.tsx`, `packages/web/e2e/useful-profile.pw.ts`, and add a focused attention action/settings E2E test if no appropriate current file exists.

**Behavioral obligations:** REQ-RANKED-ATTN-13, 14, 20 through 22, 24.

**Implementation detail:** render the daemon list in received order, including reason, decision, score explanation, evidence/correction links, and only supplied actions. Relay response commands with generated command ID and expected version, then refetch/reconcile from the daemon response. Settings exposes the 0–24 integer control and server validation feedback. Use a default three-column grid so default cap six creates two rows; responsive CSS reflows the same ordered list. Render loading, populated, successful-empty, and unavailable states distinctly. Do not calculate score/ranking/cap, infer a fallback intention card, mutate on view, or clear dispositions in the browser.

**Migration/compatibility:** remove UI assumptions that `item.intention` is non-null. Preserve existing intention management controls as separate lifecycle actions where provided by the card.

**Executable validation:**

```bash
bun test packages/web/tests/profile-consumers-integration.test.tsx packages/web/tests/profile-api.test.ts packages/web/tests/profile-accessibility-and-removal.test.ts packages/web/tests/profile-unavailable.test.ts
bunx playwright test packages/web/e2e/useful-profile.pw.ts
bun run typecheck
```

Expected: supplied ordering survives rendering and responsive reflow; default layout has three columns; actions relay command payloads; settings updates the visible slice; no-score/no-fallback fixtures render successful empty rather than a fabricated intention card.

**Local acceptance gate:** browser behavior is presentation and command relay only, with no source or candidate derivation code.

## Phase 7: Cross-cutting oracle, performance, and authority reconciliation

**Goal:** prove complete behavior, then reconcile documentation only after implementation evidence is green.

**Likely files/modules**

- Add integration/property fixtures around `packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts` and candidate service tests.
- Update `.lore/reference/specs/current/useful-collection-profile.md`, `.lore/reference/specs/current/collection-purchase-utilization.md`, `.lore/work/specs/expanded-profile-attention-opportunities.md`, and `.lore/work/plans/expanded-profile-attention-opportunities.md` only after the validated code change. Explicitly supersede purchase utilization's former prohibition on Profile ranking, and mark prior attention scope superseded/executed as status rules require.

**Behavioral obligations:** all REQ-RANKED-ATTN-1 through 24, especially REQ-RANKED-ATTN-18 through 24.

**Validation matrix**

| Requirements | Primary phase | Executable evidence |
|---|---:|---|
| 1, 3, 23, 24 | 2 | `bun test packages/daemon/tests/attention-candidate-engine.test.ts` registry/forbidden-scope fixtures |
| 2, 5, 6 | 2 | candidate ownership, one-winner, exact/NFC sorting fixtures |
| 4, 11 | 2 | exact rational and canonical `calculatePurchaseUtilization()` parity fixtures |
| 7, 22 | 5, 6 | config/profile tests plus `bunx playwright test packages/web/e2e/useful-profile.pw.ts` |
| 8, 9, 10 | 2 | rule threshold, UTC-boundary, abstention fixtures |
| 12 | 2, 4 | intention lifecycle and competitive ranking integration fixtures |
| 13, 14 | 2, 4, 6 | card contract, GET-no-write, and UI action relay tests |
| 15, 16, 17 | 1, 4 | migration/strict-schema plus controlled-clock atomic mutation tests |
| 18, 19, 20, 21 | 3, 4 | cache instrumentation, targeted update, due catch-up, corruption, unavailable/empty tests |

**Executable validation:**

```bash
bun test packages/shared/tests/useful-profile-contract.test.ts packages/shared/tests/purchase-utilization.test.ts packages/daemon/tests/attention-candidate-engine.test.ts packages/daemon/tests/collection-profile-engine.test.ts packages/daemon/tests/profile-service.test.ts packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts packages/web/tests/profile-consumers-integration.test.tsx
bunx playwright test packages/web/e2e/useful-profile.pw.ts
bun run typecheck
bun run lint
bun run test
bun run build
bunx prettier --check .
git diff --check
```

Expected: incremental candidate state equals full pure recomputation after ownership, play, purchase, intention, global settings, integrated-redundancy peer changes, and clock changes; persisted no-winner rows become eligible at their due boundaries; global-writer/Profile races publish no stale output; cache hits do bounded identity work only; source changes remain atomic; corrupt artifacts recover without partial publication; all exact score components remain internally consistent; UI has no scoring fallback; complete repository quality gates pass.

**Local acceptance gate:** update authority documents only once the commands above pass. The current Profile and purchase-utilization references must state canonical fitness/utilization reuse and ranked-candidate ownership correctly; the older expanded-attention spec/plan must be marked superseded/executed as appropriate, without altering their historical discoverability.

**Specialized expertise:** no specialized expertise is required for the core work. Request performance-review support only if instrumentation cannot prove bounded cache-hit work, and accessibility review only if the new card actions materially alter keyboard/focus behavior.
