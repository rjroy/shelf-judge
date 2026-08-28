---
title: "Implementation notes: useful collection profile"
date: 2026-08-28
status: in_progress
tags: [implementation, collection, profile, bgg-metadata]
source: .lore/work/plans/useful-collection-profile.md
modules: [shared, daemon]
---

# Implementation notes: useful collection profile

## Progress

- [x] Step 4: Persist complete BGG entity metadata and refresh states (`shelf-judge-1q2.9`), accepted through the local gate
- [x] Step 6: Durable intention lifecycle and linked transitions (`shelf-judge-1q2.5`), accepted through the local gate
- [ ] Overall plan remains in progress; later steps and terminal validation are not complete

## Step 4 Evidence Map

| Obligation                                                                                                                                             | Implementation surface                                                                                                      | Automated evidence                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parse mechanic, designer, and artist links; require positive safe-integer IDs and nonempty names; deduplicate by ID with a deterministic response name | `packages/daemon/src/services/bgg-xml-parser.ts`, `packages/daemon/tests/fixtures/thing-entity-links.xml`                   | `parses complete entity classes with deterministic validation and deduplication` covers zero, one, many, duplicate/renamed, malformed, and partial links, plus the legacy mechanics consumer                                                                                                                               |
| Complete all three classes, including complete-empty, from one successful thing response and observation time                                          | Parser, `BggGameResult`, `applyBggResult`, and shared complete-metadata constructor                                         | Parser common-observation assertion; `fetches BGG data when bggId provided`; `updates bggData and preserves user overrides`; collection schema atomicity refinements                                                                                                                                                       |
| Propagate one atomic metadata result through add, import, single refresh, batch refresh, and prediction preview                                        | `game-service.ts`, `prediction-service.ts`, collection mutation coordinator                                                 | Add assertions in `fetches BGG data when bggId provided`; `persists all entity classes from each imported thing response`; single-refresh assertions in `updates bggData and preserves user overrides`; `refreshes all games with bggIds` revision assertion; prediction `returns prediction for a game not in collection` |
| Preserve successful thing metadata if the secondary BGG collection request fails                                                                       | `bgg-client.ts`                                                                                                             | `returns successful thing metadata when the secondary collection request fails` verifies complete entity metadata and exact collection failure logging                                                                                                                                                                     |
| Preserve last-valid complete metadata on failed refresh and attach exact warning provenance; retain migrated refresh-needed state                      | `game-service.ts` failure mutation through the collection coordinator                                                       | `preserves complete metadata and records exact all-class failure provenance`; `keeps migrated refresh-needed metadata ineligible after refresh failure`; add failure warning assertions                                                                                                                                    |
| Never expire complete entity metadata by age                                                                                                           | Entity readiness has no time-based transition; injected game-service clock remains separate from thing observation time     | `does not expire complete entity metadata when the injected clock advances`                                                                                                                                                                                                                                                |
| Persist no-BGG games as explained unrefreshable records with null correction destination and no false action                                           | Shared `EntityClassMetadata` contract, validation, and `createInitialEntityMetadata`                                        | `persists an explained unrefreshable state for a game without a BGG ID`; manual-game route response assertion; shared contract tests                                                                                                                                                                                       |
| Use one request queue and throttle across concurrent owner requests while retaining retry and attempt/outcome logging                                  | One queue inside the process-wide `BggClient` instance                                                                      | `serializes physical fetches across concurrent owner requests`; existing 202, 429, 5xx, and structured attempt/outcome tests remain active                                                                                                                                                                                 |
| Prevent concurrent collection refreshes from overwriting each other without treating warning provenance as successful freshness                        | Collection mutation coordinator post-commit hook plus explicit accepted-success generations scoped per game and coordinator | Existing stale-success rejection plus deterministic failure-then-success, identical success-then-failure, single-versus-batch, different-game, and gated failed-save concurrency tests                                                                                                                                     |
| Bind singular and batch thing metadata to requested BGG IDs before applying or persisting it                                                           | `bgg-client.ts` exact requested-item selection, per-ID ambiguity/missing failures, and unsolicited-ID filtering             | Client wrong-only, unsolicited-extra, duplicate, and mixed-response tests; persisted refresh/import cases prove valid siblings survive while invalid or unsolicited identities cannot corrupt or add games                                                                                                                 |

## Step 4 Local Gate

- Status: complete and accepted for `shelf-judge-1q2.9`. The overall useful-profile implementation remains `in_progress` because later plan steps remain.
- Focused tests: 289 pass, 1 skip, 0 fail.
- Full tests: 2,032 pass, 1 skip, 0 fail.
- Root shared/daemon/CLI typecheck: pass.
- Root ESLint: pass.
- Web TypeScript check: pass.
- Production web build: pass.
- Changed-file Prettier: pass.
- `git diff --check`: pass.
- Root `format:check`: not treated as a Step 4 failure. It reported only the three generated Beads baseline files `.beads/backup/backup_state.json`, `.beads/export-state.json`, and `.beads/push-state.json`; no accepted Step 4 source, test, fixture, or lore path failed formatting.

### Accepted Findings Closure

- `SJ-STEP4-001` closed: explicit coordinator-scoped, per-game accepted-success generations prevent stale failures from overwriting accepted successes, including byte-identical successes. Generations become visible only after durable commit, and failed saves do not leak or suppress state.
- `SJ-STEP4-002` closed: singular thing responses bind to exactly one requested BGG identity before result construction or secondary collection lookup.
- `SJ-STEP4-003` closed: batch thing and collection responses validate each requested identity, filter unsolicited IDs, isolate duplicates and omissions as per-ID failures, and preserve valid sibling progress.
- `SJ-STEP4-004` closed: the collection mutation coordinator supplies the post-commit boundary required to advance refresh ordering only after persistence succeeds and before the next serialized mutation begins.
- `SJ-VERIFY-001` closed: singular secondary collection responses accept at most one requested-ID match; duplicate requested entries preserve valid thing metadata and existing play evidence while recording exact warning provenance.
- Independent acceptance found no remaining Step 4 blocking findings. The evidence map above is the accepted obligation-to-test traceability record.

### Divergences And Residual Risks

- No accepted behavior diverges from the Step 4 obligations. The shared contract gained `unrefreshable.explanation` because the approved no-BGG requirement could not be represented by the additive Step 1 shape; the existing correction destination remains `null`.
- The accepted-success generation is intentionally process-local and scoped to game-service instances sharing one collection mutation coordinator. This matches the daemon's one long-lived coordinator lifecycle, but multiple independent processes writing the same collection are outside the accepted concurrency model.
- Secondary collection lookup failure now preserves already validated thing/entity metadata and records the collection failure instead of discarding the successful thing result. This is a deliberate partial-success boundary, not fabricated collection evidence.
- Complete entity metadata has no age expiry by design. Freshness depends on explicit refresh outcomes, so upstream BGG corrections are not observed until a refresh occurs.
- Root formatting remains subject to the three generated Beads baseline failures recorded above. They were not edited or normalized as part of Step 4.
- Later useful-profile plan steps, cross-step integration, and final overall-plan acceptance remain outstanding, so this note and its frontmatter remain `in_progress`.

## Step 6 Evidence Map

| Obligation                                                                                                                                                                                     | Implementation surface                                                                            | Automated evidence                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owned-game creation derives first-play/replay from valid non-stale evidence, snapshots daemon-owned baseline, allocates stable ID/version, and rejects mismatches or a second active intention | `packages/daemon/src/services/intention-service.ts`                                               | `creates first-play, remains time-invariant, completes, and later creates a new ID`; `derives first-play and replay eligibility from authoritative current evidence`                                                                    |
| Manual complete and retire require matching game, intention, and expected version and return current state on conflict                                                                         | Intention service command execution and strengthened shared stale validator                       | `complete and retire race has exactly one winner and stale loser sees current state`; shared useful-profile contract suite                                                                                                              |
| Canonical command receipts commit with accepted transitions and replay durably without duplication                                                                                             | Intention service receipt lookup and same coordinator write                                       | `replays the original result across restart and rejects changed command payload`; `a persistence failure leaves no receipt or intention and retry creates exactly one`; route replay coverage                                           |
| Manual play correction accepts only nonnegative safe integers, records daemon time/source, and returns linked auto-completion                                                                  | `IntentionService.setPlayCount`, `shelf.game.plays.set` route                                     | `manual play correction completes only for valid evidence strictly above baseline`; `manual plays route validates safe counts and returns automatic transition`                                                                         |
| Every successful BGG play check persists valid/missing/invalid state; newer non-valid checks retain valid evidence as stale; network failure does not advance a check                          | `applyBggResult`, import construction, BGG state identity                                         | `records a successful missing play check while retaining other omitted field evidence`; `retains prior valid evidence through invalid check and auto-completes only on later valid increase`; existing refresh-failure retention suites |
| Automatic completion occurs only in accepted evidence mutation for valid non-stale evidence strictly above baseline                                                                            | Shared pure transition helper invoked from coordinated manual, singular BGG, and batch BGG writes | Manual lower/equal/increase test; invalid-then-valid BGG test; four-way race test                                                                                                                                                       |
| Owned to previously-owned atomically retires active intention and discloses the transition; re-own preserves history without recreation                                                        | Coordinated `GameService.setOwnership` mutation and ownership route response                      | `ownership transition atomically retires active intent and re-owning creates none`; ownership route suite                                                                                                                               |
| Permanent deletion rejects active or resolved history and preserves the game; no-history deletion remains available                                                                            | `GameHistoryConflictError` inside coordinated delete and route 409 mapping                        | `creates, manually completes, replays, and blocks deletion across app restart`; existing no-history service deletion tests                                                                                                              |
| Exactly four operations expose strict request, response, conflict, and persistence metadata                                                                                                    | `operations.ts`, game route registry/help projection                                              | `registers exactly the four Step 6 operations with request, response, and errors`; help route suite                                                                                                                                     |
| Attempts and outcomes log trigger, IDs, prior state/version, and result without unrelated collection contents                                                                                  | Intention service and linked game mutation seam logs                                              | `logs seam identifiers and state without unrelated collection contents`; coordinator logging suites                                                                                                                                     |
| Complete, retire, play, and ownership concurrency permits one lifecycle winner                                                                                                                 | Shared collection mutation coordinator across intention and game services                         | Two-way command race, play/ownership race, and `complete, retire, play, and ownership race records exactly one lifecycle resolution`                                                                                                    |

## Step 6 Local Gate

- Status: complete and accepted for `shelf-judge-1q2.5`. The overall useful-profile implementation remains `in_progress` because later plan steps and terminal overall-plan validation remain incomplete.
- Added one daemon intention service for shared command validation, canonical durable receipts, owner resolutions, manual play correction, and pure linked transition helpers.
- Integrated ownership retirement, BGG valid/missing/invalid observations, automatic observed-play completion, and history-protected deletion into existing coordinated game writes without changing the accepted Step 4 post-commit generation boundary.
- Added strict HTTP routes and discoverable metadata for `shelf.game.intention.set`, `.complete`, `.retire`, and `shelf.game.plays.set`.
- Strengthened stale-conflict validation so a conflict can return a matching current intention when either its version differs or it is already resolved.
- Updated the prior omitted-play BGG expectation because Step 6 requires a successful missing check to become durable; duration, player-range, and poll omission behavior remains unchanged.
- Final full repository suite: 2,085 pass, 1 existing skip, 0 fail across 120 files.
- Root shared/daemon/CLI typecheck: pass.
- Root ESLint: pass.
- Web TypeScript check: pass.
- Production web build: pass.
- Scoped changed-path Prettier: pass.
- `git diff --check`: pass.
- Root `format:check`: generated baseline only. It reported `.beads/backup/backup_state.json`, `.beads/export-state.json`, and `.beads/push-state.json`; no accepted Step 6 source, test, web, or lore path failed formatting.

### Step 6 Implementation Validation

- Focused shared/intention/route/BGG/game/ownership/help suites: 180 pass, 0 fail.
- Root shared/daemon/CLI typecheck: pass.
- Web TypeScript check: pass.
- Root ESLint: pass after correcting the restart harness's unbound-method lint finding.
- Full repository tests: 2,046 pass, 1 existing skip, 0 fail across 119 files.
- Production web build: pass.
- Changed-file Prettier: pass.
- `git diff --check`: pass.
- Independent Step 6 validation reported `INT-VAL-1` through `INT-VAL-4`; the corrections and evidence below were completed before final acceptance.

### Step 6 Independent-Validation Corrections

- `INT-VAL-1`: Added route and service evidence using real reads and shared persisted bytes. The tests advance the injected clock by 100 years, call game detail/list routes and services, and prove no collection write or intention mutation. They then manually retire, change ownership, delete a disposable profile cache, reconstruct storage/coordinator/services/app over the same files, re-own, correct the authoritative play count, and prove a later explicit replay intention has a new ID and baseline while prior history and command receipts remain durable.
- `INT-VAL-2`: Added the exact older/equal/newer timestamp predicate matrix. A newer successful missing BGG play check now has explicit evidence that the valid prior count becomes stale while the intention remains active. A subsequent BGG network failure proves latest check, play evidence, and intention state remain unchanged. No production evidence-predicate correction was needed.
- `INT-VAL-3`: Added active and resolved deletion conflicts at the game-service/coordinator boundary and at a route boundary after full app/coordinator reconstruction. Every conflict compares the complete collection before and after; no-history route deletion remains allowed. No production deletion correction was needed.
- `INT-VAL-4`: Corrected `shelf.game.plays.set` discovery from idempotent to non-idempotent because it has no durable command ID or replay receipt. Intention commands remain idempotent under their approved command-replay contract. Added exact discovery assertions for request, response, errors, idempotency, and help-tree projection.
- Added shared `PlayEvidenceMutationResult` and `PlayEvidenceMutationResultSchema`. Single BGG refresh now returns and route-validates `{ game, linkedIntentionTransition }`, and the web daemon client preserves that contract. Batch refresh retains its approved aggregate `{ refreshed, errors }` response because neither the source specification nor Step 6 defines per-game public batch results; it now logs each per-game automatic transition so operational outcomes are not lost. A future per-game batch response would be an API contract expansion, not a correction to the approved aggregate.
- Replaced optimistic in-mutation automatic-transition outcomes with paired attempt/outcome logs for manual evidence, single and batch BGG evidence, and ownership changes. Outcomes are emitted after the coordinator reports durable acceptance or failure and include trigger, game/intention IDs, prior state/version, result, resulting version, and persistence status. Successful missing evidence, network failure, superseded work, unchanged evidence, completion, retirement, and mutation failure are distinguishable without game names, metadata, descriptions, or unrelated collection contents.
- Corrected the remaining `INT-VAL-4` batch-logging defect: each coordinated BGG refresh result now carries its own result, accepted intention version, and persistence status. A changed sibling can no longer mark a superseded or removed game as persisted. Mixed deterministic coverage proves exact attempt/outcome fields for completed, unchanged, unavailable, superseded, and removed games, including a superseded intention's newer accepted version, and proves failed batch persistence reports `mutation-failed` with no persisted candidate result.
- Preserved the coordinator-only write boundary and existing Step 4 accepted-success generation semantics. Single and batch BGG refresh still advance generations only in post-commit hooks; the response/logging corrections consume coordinator outcomes without adding another writer or lock.

### Correction Validation

- Focused shared/intention/game/BGG/route suites: 124 pass, 0 fail.
- Full repository tests: 2,057 pass, 1 existing skip, 0 fail across 119 files.
- Root shared/daemon/CLI typecheck: pass.
- Root ESLint: pass.
- Web TypeScript check: pass.
- Production web build: pass.
- Correction-path Prettier and `git diff --check`: pass.
- Remaining `INT-VAL-4` correction validation: focused BGG service suite 48 pass; root typecheck and ESLint pass; full repository suite 2,058 pass, 1 existing skip, 0 fail across 119 files.
- Root `format:check`: reports only the recorded generated Beads baseline files `.beads/backup/backup_state.json`, `.beads/export-state.json`, and `.beads/push-state.json`; no correction path fails formatting.
- At this correction checkpoint, acceptance remained pending. No Beads issue was closed, and no commit or push was performed.

### SJ6 Independent-Review Corrections

- `SJ6-IR-001`: Creation, completion, and retirement routes now parse strict body-owned schemas and construct commands field-by-field with route-owned `type`, `gameId`, and `intentionId`. Invalid JSON, extra fields, and attempted cross-game, cross-intention, or cross-type fields return structured validation without invoking command execution. Route tests verify rejected smuggling leaves no receipt and accepted receipts preserve exact route identity.
- `SJ6-IR-002`: Collection consistency now permits a strictly newer valid manual observation to be current while retaining the factual valid BGG latest check. Manual corrections carry the daemon mutation timestamp, preserve BGG check history semantics, persist through app reconstruction, and can auto-complete only when the later correction is above the intention baseline.
- `SJ6-IR-003`: BGG latest-check and current-evidence replacement are independently monotonic. Only a strictly newer BGG check replaces `latestPlayCountCheck`; only a BGG observation strictly newer than current evidence replaces current evidence; and only an accepted strictly newer valid BGG observation can auto-complete. Completion evidence must also be strictly newer than the baseline observation. The older/equal/newer by valid/missing/invalid matrix verifies no regression, stale transition, or false completion outside those predicates.
- `SJ6-IR-004`: `PlayEvidenceMutationResultSchema` now rejects active, retired, owner-confirmed, wrong-version, cross-game, stale, non-increasing, baseline-time, and mutation-time-incoherent linked transitions. The returned game must also preserve the collection's play-evidence authority invariant: a valid latest BGG check is current unless strictly newer valid evidence supersedes it, non-valid current evidence must match its latest BGG check, and neither current evidence nor the retained check may postdate the mutation/completion. Exact-time BGG evidence and unavailable-check boundaries remain valid, as do newer manual corrections that retain an older factual valid BGG check. Both manual-play and singular-refresh routes validate the runtime response.
- `SJ6-IR-005`: Shared `OwnershipMutationResult` and `OwnershipMutationResultSchema` are exported and used by the daemon ownership route and web API client. The schema permits null on re-ownership and requires a nonnull link to be the same-mutation version-two owner retirement of the returned previously-owned game; route tests reject incoherent service output.
- `SJ6-IR-006`: Single and batch BGG paths now capture target intention ID, prior lifecycle state, and prior version inside the serialized mutation immediately before transition evaluation. Those exact contexts are carried to post-commit and failure logs. Paused-network single and batch tests resolve the old intention and create a new one before commit, proving the new intention is the one logged and completed.
- `SJ6-IR-007`: Intention operation discovery now exposes only command-reachable errors, uses command-specific persistence operation IDs, and provides complete schema-valid examples. Validation examples have nonempty issues, conflict examples have coherent current intentions, play validation metadata is nonempty, and discovery tests parse every intention error example with the shared runtime schema.
- SJ6 correction validation: focused shared/intention/route/BGG/ownership suites passed 123 tests; the full repository suite passed 2,067 tests with one existing skip and zero failures. Root shared/daemon/CLI typecheck, web TypeScript, root ESLint, production web build, correction-path Prettier, and `git diff --check` passed.
- Remaining `SJ6-IR-004` temporal-coherence validation: focused shared/daemon suites passed 103 tests with zero failures; the full repository suite passed 2,068 tests with one existing skip and zero failures across 119 files. Root shared/daemon/CLI typecheck, root ESLint, and correction-path Prettier passed.
- These corrections preserve the accepted Step 4 coordinator post-commit generation boundary, durable command receipts, replay semantics, aggregate batch response, and existing public routes. At this correction checkpoint, acceptance remained pending; no Beads issue was closed and no commit or push was performed.

### SJ6 Acceptance-Review Corrections

- `SJ6-AR-001`: Intention creation now treats valid play-count evidence with no observation time as explicitly ineligible with reason `missing-observation-time`. The service and reconstructed route return `ineligible-game` without throwing, writing collection state, or creating a command receipt. This preserves the migrated source shape while preventing an untruthful baseline timestamp.
- `SJ6-AR-002`: Manual play correction now has a shared `ManualPlayCorrectionResult` discriminated contract. A daemon observation time that is equal to or older than the latest current evidence, latest BGG check, or game mutation time returns `non-monotonic-observation` with the truthful attempted and latest accepted timestamps. The coordinator returns a no-op before changing evidence, intention state, receipts, or collection revision; strictly newer corrections still preserve factual BGG check history and may auto-complete normally. The HTTP route returns this conflict as 409 and discovery describes both accepted and conflict responses.
- `SJ6-AR-003`: Owner-command attempt context is now captured inside the serialized collection mutation from the actual persisted intention immediately before receipt or transition evaluation. Attempt and outcome logs carry actual `none`, `active`, or `resolved` state and actual version through accepted commands, active conflicts, stale resolved losers, durable replay, command reuse, and persistence failure. Replay is logged as `replayed`; outcomes report current conflict versions rather than caller expectations, and no unrelated collection data is included.
- `SJ6-AR-004`: All three intention command routes parse service results with `IntentionMutationResultSchema` before choosing an HTTP response. The web ownership and singular BGG refresh consumers parse `OwnershipMutationResultSchema` and `PlayEvidenceMutationResultSchema` after the existing daemon HTTP error boundary. Injected malformed service results return an internal route error, malformed web daemon payloads reject at the consumer boundary, and daemon request failures remain unchanged.
- These corrections preserve command-receipt atomicity and route-owned identities. The accepted Step 4 BGG ordering and post-commit generation behavior, automatic transition rules, and aggregate batch response are unchanged. At this correction checkpoint, acceptance remained pending; no Beads issue was closed and no commit or push was performed.

### SJ6 Acceptance-Review Validation

- Focused shared, intention, route, ownership, game-service, and web consumer suites: 250 pass, 0 fail.
- Full repository suite: 2,082 pass, 1 existing skip, 0 fail across 120 files.
- Root shared/daemon/CLI typecheck: pass.
- Web TypeScript check: pass.
- Root ESLint: pass.
- Production web build: pass.
- Correction-path Prettier and `git diff --check`: pass.
- Root `format:check` reports only the recorded generated Beads baseline files `.beads/backup/backup_state.json`, `.beads/export-state.json`, and `.beads/push-state.json`; no correction path fails formatting.

### SJ6 Targeted-Acceptance Corrections

- `SJ6-TAR-001`: Non-monotonic manual play corrections now capture the persisted active-intention target inside the serialized coordinator mutation before timestamp evaluation. Rejections emit paired automatic-transition attempt/outcome logs with the owner-correction trigger, actual active intention ID and prior version when present, result `non-monotonic-observation`, unchanged current version, and `persisted: false`.
- Games with only resolved history or no intention history report no active target (`intentionId: null`, `priorState: none`, `priorVersion: null`) and do not copy resolved-history IDs into the correction logs. Rejections remain coordinator no-ops with no collection write, revision change, intention mutation, or command receipt.
- `SJ6-TAR-001` focused intention-service suite: 17 pass, 0 fail. Exact active, resolved-history-only, and no-history log payloads are covered alongside unchanged collection state, zero saves, and zero receipts.
- Full repository suite: 2,085 pass, 1 existing skip, 0 fail across 120 files. Root shared/daemon/CLI typecheck, web TypeScript, root ESLint, production web build, correction-path Prettier, and `git diff --check` pass.
- Root `format:check` continues to report only the recorded generated Beads baseline files `.beads/backup/backup_state.json`, `.beads/export-state.json`, and `.beads/push-state.json`; no correction path fails formatting.
- At this targeted-correction checkpoint, acceptance remained pending; no Beads issue was closed and no commit or push was performed.

### Accepted Findings Closure

- `INT-VAL-1` closed: reconstruction, long-clock-advance, read-only access, ownership, deletion, replay, receipt, history, and new-baseline evidence proves durable lifecycle behavior without read-time mutation.
- `INT-VAL-2` closed: the older/equal/newer BGG timestamp matrix covers valid, missing, invalid, and network-failure boundaries without evidence regression or false completion.
- `INT-VAL-3` closed: active and resolved intention history blocks permanent deletion at service and reconstructed route boundaries, while no-history deletion remains available and conflicts preserve collection bytes.
- `INT-VAL-4` closed: discovery metadata now reports truthful idempotency and complete request, response, error, and help contracts; batch transition outcomes retain per-game persistence truth.
- `SJ6-IR-001` closed: strict route-owned command schemas reject identity and command-type smuggling before execution or receipt creation.
- `SJ6-IR-002` closed: newer manual evidence can become authoritative while preserving factual BGG check history and reconstruction behavior.
- `SJ6-IR-003` closed: latest BGG checks and current evidence advance under independent strict monotonic predicates, and completion requires evidence strictly newer than the baseline.
- `SJ6-IR-004` closed: linked play transitions and returned game evidence are runtime-validated for lifecycle, identity, version, authority, and temporal coherence.
- `SJ6-IR-005` closed: ownership responses use a shared runtime contract that permits re-ownership without a transition and validates same-mutation owner retirement.
- `SJ6-IR-006` closed: single and batch BGG logging captures the actual serialized intention target immediately before transition evaluation.
- `SJ6-IR-007` closed: intention discovery exposes only reachable errors, command-specific persistence IDs, and schema-valid examples.
- `SJ6-AR-001` closed: valid migrated evidence without an observation time is explicitly ineligible and cannot create an invented baseline timestamp.
- `SJ6-AR-002` closed: non-monotonic manual corrections return a truthful typed conflict and leave collection, evidence, lifecycle, receipt, and revision state unchanged.
- `SJ6-AR-003` closed: owner-command logs derive context from persisted state inside the coordinator and distinguish accepted, replayed, conflicting, reused, and failed outcomes.
- `SJ6-AR-004` closed: daemon routes and web consumers validate intention, ownership, and singular-refresh mutation results at their service boundaries.
- `SJ6-TAR-001` closed: rejected manual corrections log the actual active target, or no active target, with an unchanged version and `persisted: false`, without leaking resolved-history identity.
- Final acceptance found no remaining Step 6 blocking findings. The Step 6 evidence map and correction records are the accepted obligation-to-test traceability record.

### Divergences And Residual Risks

- No accepted behavior diverges from the Step 6 obligations. The singular refresh response expanded to include `linkedIntentionTransition`; batch refresh intentionally retains its approved aggregate `{ refreshed, errors }` contract and records per-game linked outcomes in structured logs.
- `shelf.game.plays.set` is intentionally non-idempotent because it has no command ID or durable receipt. The three intention commands remain idempotent under their canonical command-replay contract.
- Valid migrated play evidence without an observation time remains readable but cannot seed an intention. An explicit newer observation is required before creation eligibility can be established truthfully.
- Manual corrections require a daemon observation time strictly newer than accepted evidence, the latest BGG check, and game mutation time. Clock rollback or equal-resolution timestamps produce a typed non-monotonic conflict rather than rewriting history.
- Any active or resolved intention history permanently protects a game from deletion. This preserves receipt and lifecycle referential integrity but means deletion requires a future explicit archival policy if product requirements change.
- Automatic-transition details for batch BGG refresh are operational evidence rather than public per-game response data. A future per-game batch API would be a contract expansion.
- Step 6 continues to rely on the accepted Step 4 process-local coordinator and generation model. Multiple independent processes writing the same collection remain outside the accepted concurrency boundary.
- Later useful-profile plan steps, cross-step integration, and final overall-plan acceptance remain outstanding, so this note and its frontmatter remain `in_progress`.

### Step 6 Changed Paths

- `.lore/work/notes/useful-collection-profile.md`
- `packages/daemon/src/app.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/operations.ts`
- `packages/daemon/src/routes/games.ts`
- `packages/daemon/src/services/game-service.ts`
- `packages/daemon/src/services/intention-service.ts`
- `packages/daemon/tests/helpers/test-app.ts`
- `packages/daemon/tests/ownership-routes.test.ts`
- `packages/daemon/tests/routes/intention-routes.test.ts`
- `packages/daemon/tests/services/game-service-bgg.test.ts`
- `packages/daemon/tests/services/game-service.test.ts`
- `packages/daemon/tests/services/intention-service.test.ts`
- `packages/shared/src/index.ts`
- `packages/shared/src/types.ts`
- `packages/shared/src/validation.ts`
- `packages/shared/src/useful-profile-validation.ts`
- `packages/shared/tests/useful-profile-contract.test.ts`
- `packages/web/lib/api.ts`
- `packages/web/tests/mutation-api.test.ts`

### Accepted Changed-Path Manifest

Snapshot scope: exact output of `git status --porcelain=v1 --untracked-files=all` at `2026-08-28T10:03:49-07:00`, after accepted Step 6 validation and immediately before the final acceptance edits to this note. Status values preserve the exact two-character porcelain code. Index values are the blobs reported by `git ls-files -s`; `absent` means the path had no index entry. Working values are SHA-256 digests of file contents at that snapshot. The note's `30ebe75d9d17d73eb9d2fd8d1125a1a86aeb148d06673f8f7d5ff0445a41787a` digest is explicitly the pre-final-notes hash, so the final note intentionally differs rather than claiming an impossible self-referential hash.

| Status | Path                                                                            | Index blob or absent marker                | Accepted working SHA-256                                           |
| ------ | ------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| ` M`   | `.beads/interactions.jsonl`                                                     | `af8818287797e082c62d2153f9753bf1affd194c` | `3c69a71b6af580a4812cd60e4ea6c147ab04f111251f554902c3989904fdc43c` |
| ` M`   | `.beads/issues.jsonl`                                                           | `00212c24325809ad71807ba22ee67520366b9920` | `f9562a9c37dc6a0df12dc5395329ff810bc83db7a0f36c7c3d4e50b98c74f74e` |
| ` M`   | `packages/daemon/src/app.ts`                                                    | `733dcd0173712da3e95c77dd8e9b704a4f24e2e5` | `b03c31e9ebfdd2c599dc7813d6ac23f1163abfcb3b6f1a4e3dbb5ce2119e0496` |
| ` M`   | `packages/daemon/src/index.ts`                                                  | `2539f7f61d87c642f1723d74670bfa2a6be287cb` | `18707436b604103d4ed59deb2b1f8166f2f7660018ec57f530e078f78df900cf` |
| ` M`   | `packages/daemon/src/operations.ts`                                             | `cdd094aafb711574a22f61b8ecb41e1a17e35e4d` | `bbfe313605e7e4face11d708132416de3022eea98c8ff1c8bf125d3b31404929` |
| ` M`   | `packages/daemon/src/routes/games.ts`                                           | `56953ac08688ec07a1449bbbb3a56375c9f90190` | `27f7ff9260c00b211bd555fe0d0e3421be40e304ab64ac143b05fc7daf6ac238` |
| ` M`   | `packages/daemon/src/services/bgg-client.ts`                                    | `29863965990a0c2fa00e0755fa7f7fe5f5633533` | `5b2714a70e86fc414e398624cc1fcb02a1d28ba846d0a96c461da801877c5550` |
| ` M`   | `packages/daemon/src/services/bgg-xml-parser.ts`                                | `e5d9c8caea99808d46962f841bd99a6358c9cebd` | `2372cdf97b42037d9110c47b823111195674199c4fbeeb6a8a9488f38058e2e0` |
| ` M`   | `packages/daemon/src/services/collection-mutation-service.ts`                   | `82d5533857e8d3468071ba03a156a97b34633a9c` | `65839a840fd2328e6ab3484fd259c74ef5f179ec0f926e405a395cc2e7db4c36` |
| ` M`   | `packages/daemon/src/services/game-service.ts`                                  | `ba3cf62af2f03a0af7d136fb6b99a2dae5865db8` | `ed661f921a5f85d93eaf63fc1bd1f5370ee2da5fda0dcdb3b8352716ec8fa797` |
| ` M`   | `packages/daemon/src/services/prediction-service.ts`                            | `ba3203b49bde4355b7bca46ffb8be2fb629a0de2` | `9a5d8d628a2c59c4128dd5e60a8ee3d8b5600be1fd9dff4c78e4e8b33a1e8556` |
| ` M`   | `packages/daemon/tests/helpers/test-app.ts`                                     | `f80ffc97862edc74ba3f6cbde590c22b4d574d06` | `16a32502c8bb301faa1fe5d06459f0ba786a3a30d1eb349e1916d31b7a4875cf` |
| ` M`   | `packages/daemon/tests/integration/end-to-end.test.ts`                          | `2f59f933ca5d71c27b71319f72928bba1e297919` | `a9c059d3475ed3d1804950aaa6abeccdcd53f83a052d04f90ee125ae8b7d7851` |
| ` M`   | `packages/daemon/tests/integration/purchase-utilization-persisted-flow.test.ts` | `e677d9c6c92e5cc8e48f8f3fba4411267bbb2989` | `700ad52a8a7e5bd0bfb9e90475190a08271dc95f34c4f17d008419acdc403607` |
| ` M`   | `packages/daemon/tests/ownership-routes.test.ts`                                | `09e8f1b47def868af9260d58d1b7d2855f2f4730` | `4dd2679789062e8913602bf5ca090dc27f1d38e4d17a546728e4a88898a96e58` |
| ` M`   | `packages/daemon/tests/routes/games.test.ts`                                    | `ad1e69d1f1bb8f6cdaff03265268cfbb0a460ba1` | `181625d8e909168ca4e64b11db43888301d9819029c45d87439bea2a9063c45b` |
| ` M`   | `packages/daemon/tests/routes/import.test.ts`                                   | `3d111ecb0a229178d94efef6823426aeea8ca03e` | `245b532669a91c547fd130fb90bacf1c2551051bc6a301f124bbc0ca2dc4c4b7` |
| ` M`   | `packages/daemon/tests/routes/prediction.test.ts`                               | `c045236308697f0c66974edbe2141f339d063a36` | `3def34491eb7143c26a1035516df966c105b15ba5bc3dabfabe0734b68765e5b` |
| ` M`   | `packages/daemon/tests/services/bgg-client.test.ts`                             | `1c97320d53fe09bbf1074782b15cb94a5fc0ac3d` | `55e5789fab5190437c592a564804e5cacf8a744d4d36a1dae5469cd4c55fa99c` |
| ` M`   | `packages/daemon/tests/services/bgg-xml-parser.test.ts`                         | `73d51b755fc81824a99cca2395876d7a7078e7af` | `3b36cd4591b97886135acf686264382817a1531375fa71b59da548316ba8dde3` |
| ` M`   | `packages/daemon/tests/services/collection-mutation-service.test.ts`            | `83678d7b2bdbb6801809fe687467022d74dfc92e` | `5d63620c3e65647f460a00af4102cbaf70125e9afbef1203624606c590e83db9` |
| ` M`   | `packages/daemon/tests/services/game-service-bgg.test.ts`                       | `e297f28f82abc5cf90769d5baa65e0866e77604a` | `dabc9208cc7ade5fca1b7fee23698f3e1dce4e512a2b5ba8dadadce3a4888197` |
| ` M`   | `packages/daemon/tests/services/game-service.test.ts`                           | `857a0c0fb12e09091aa5d0d28ea4c4da9b413f6c` | `9e715bc61c5883f4576746d6ff85ab0365c003b825fd6f8a919c2c9973c6428f` |
| ` M`   | `packages/daemon/tests/services/import.test.ts`                                 | `0a2a1f8bbb5e85eded3969c851eb58fb5781664d` | `4fde4b6131b540e1a321fe6c6d79716326fdd8256269976e8bc941fae178b978` |
| ` M`   | `packages/daemon/tests/services/prediction-service.test.ts`                     | `2c61615d7aceccb0c163fbfb489c4f82091496d8` | `44e4caf48f89d6f250274279f0a5970d2a2a9bcebb356e6a5a664ef6a4cd3433` |
| ` M`   | `packages/shared/src/index.ts`                                                  | `46e3aabaa6ea54173fb0c1332181427bfef3620b` | `f31b1843de4c3e67f37d2971e3f955aa009ac7ccdd429a1f2e93aa04e5847413` |
| ` M`   | `packages/shared/src/types.ts`                                                  | `e0e3ec7216f24c8382f08915144fe04bed300968` | `4c985aa9477372dc3e34163f2f4c2f414db9afee796c934386ec3e8e89744a4a` |
| ` M`   | `packages/shared/src/useful-profile-source.ts`                                  | `32b4009ae2e0a374cad724f54c64cf1708683632` | `3d52f2f03b3f259549ff73e4e79494fce0d5e452089d468cc0a9c1664acffa9f` |
| ` M`   | `packages/shared/src/useful-profile-validation.ts`                              | `ec97fac7580dcb72c4f1ad0e72da9197defc2859` | `be114b3e2ad9793cbc8dffd89addc2eed00df6f0aecffc9885e19e8a203fdb0a` |
| ` M`   | `packages/shared/src/validation.ts`                                             | `40971e0d1a957ff1e112002d53380f3a4bccb16b` | `3cde7c786f8e46737fb4cbe100f7aca530ca1c0c1d3406b12a36a0deb174bb0b` |
| ` M`   | `packages/shared/tests/current-axis-validation.test.ts`                         | `5e8617a1e44c28445ecba3ba7f5df3b9bc247988` | `681670a3668be9640f0580ce6753607aa971d25f20820414334133bf7a3e5bff` |
| ` M`   | `packages/shared/tests/useful-profile-contract.test.ts`                         | `9167b0ee3b4a820d344f9373c9e8538504aa6850` | `054625aacc31052d3c51d39db9016efbaeeec968ebac38ab4644bfd74de8ce81` |
| ` M`   | `packages/web/lib/api.ts`                                                       | `5a3877001c86575992c54dcab371964e49679f3b` | `fd8bd4b1d356e186b868c827408c16e365eecde9dfeb13986e4370839bba53dd` |
| `??`   | `.lore/work/notes/useful-collection-profile.md`                                 | `absent`                                   | `30ebe75d9d17d73eb9d2fd8d1125a1a86aeb148d06673f8f7d5ff0445a41787a` |
| `??`   | `packages/daemon/src/services/intention-service.ts`                             | `absent`                                   | `0b1617fc82be3086b9c61094120f989970f2728bbb2e369931db21bea0c5a4d8` |
| `??`   | `packages/daemon/tests/fixtures/thing-entity-links.xml`                         | `absent`                                   | `46be106db1c936acbe2b75d85dad5314c2592c9426327111ae415b6f3fa93938` |
| `??`   | `packages/daemon/tests/routes/intention-routes.test.ts`                         | `absent`                                   | `0c5f4c027fca74f739bacb4cd9bea228528312baae022ef6529040164bb41796` |
| `??`   | `packages/daemon/tests/services/intention-service.test.ts`                      | `absent`                                   | `08147659f6e7b156951d1512397ecc6a6edaaa24f19e0bcc0bacfcd13fd85191` |
| `??`   | `packages/web/tests/mutation-api.test.ts`                                       | `absent`                                   | `7d0bce97135cde296d5d0314702dc154fdbdc517a461d6dc991e3394329b3c4e` |

## Log

### 2026-08-28

- Inspected the approved Step 4 plan, source specification, v4 source schema and refinements, migration behavior, BGG parser/client, game and prediction services, routes, collection mutation coordinator, fixtures, and existing tests before editing.
- Added the required `unrefreshable.explanation` field because the additive Step 1 contract had no field capable of satisfying the approved no-BGG explanation obligation. Existing correction destination behavior remains `null`.
- Added one shared complete-metadata constructor so production parsing and typed test BGG responses use the same exhaustive three-class shape.
- Successful thing parsing now deterministically filters and deduplicates all three entity classes and preserves the same parsed mechanic links in the established `BggGameData.mechanics` consumer.
- A failed secondary collection lookup no longer discards an already successful thing result. The client still logs the collection attempt and failed outcome, and returns no fabricated collection observation.
- Failed single and batch refreshes record one all-class warning mutation while preserving complete entity arrays and observations. Refresh-needed data remains refresh-needed.
- Corrected batch failure propagation after independent review: failed thing batches now carry the exact transport or parser message through the existing batch progress event. Batch refresh persists that raw provenance for every affected BGG ID instead of synthesizing `No BGG data returned`, while successful omitted-ID behavior remains unchanged.
- Added focused transport and parser evidence at the client boundary plus a persisted parser-failure test covering complete last-valid entity metadata, all three readiness classes, exact warning timestamps/messages, and migrated refresh-needed retention.
- Focused implementation tests passed: 243 passed, one existing skipped timeout test, zero failures. Full repository verification then passed with 2,002 tests, the same one skipped timeout test, and zero failures; root TypeScript and repository ESLint also passed.
- Correction verification passed: BGG client tests 45 passed and one existing timeout test skipped; game-service BGG tests 31 passed; repository typecheck and ESLint passed; full repository tests 2,004 passed, one existing timeout test skipped, zero failures.
- Corrected SJ-STEP4-001: `refreshFailure` is normalized out of optimistic BGG state identity because it records warning provenance, not successful freshness. Same-game failure-then-success now accepts the valid success, while success-then-failure remains a non-overwrite and the existing older-success rejection remains active.
- Corrected SJ-STEP4-002: singular thing responses now require exactly one requested-ID match. Wrong-only and duplicate requested-ID responses fail before result construction or collection lookup; a single requested match amid unrelated extras is selected and logged as a partial response. Structured failure logs include requested IDs, all returned IDs, returned fields, observation time, and the exact validation error.
- Correction evidence passed: BGG client tests 48 passed and one existing timeout test skipped; game-service BGG tests 36 passed; repository typecheck and ESLint passed; full repository tests 2,012 passed, one existing timeout test skipped, zero failures. Changed-file Prettier and `git diff --check` passed. Root formatting remains blocked only by three pre-existing/generated Beads state files: `.beads/backup/backup_state.json`, `.beads/export-state.json`, and `.beads/push-state.json`.
- Final SJ-STEP4-001 correction replaced payload-derived success inference with an explicit per-game monotonic accepted-success generation. Each single or batch refresh captures its game generation before asynchronous work; accepted successes advance it inside the serialized collection mutation even when all payload bytes and observation timestamps are unchanged. A failure records provenance only when its captured generation still matches. Payload identity remains as a separate stale-state guard.
- Generation state is shared by game-service instances using the same collection mutation coordinator, so single and batch paths coordinate without a global collection revision suppressing unrelated-game failures. Single and batch generation advancement now runs only after durable persistence succeeds and before the serialized coordinator admits the next mutation. Add and import apply BGG data only while creating previously unaddressable game IDs, and prediction does not persist, so they cannot race an in-flight refresh for an existing game.
- The generation is intentionally process-local. The daemon constructs one long-lived collection coordinator and game service; a process restart terminates all operations whose start generation could still matter. Persisting generations would add schema state without protecting any operation that survives restart.
- Final correction evidence passed: game-service BGG tests 39 passed; repository typecheck and ESLint passed; full repository tests 2,015 passed, one existing timeout test skipped, zero failures; production web build passed. Changed-file Prettier and `git diff --check` passed.
- Authorized third SJ-STEP4-001 correction evidence directly covers both compensation hooks. Single-refresh and batch-refresh tests force `saveCollection` to fail after an optimistic accepted-success generation advance, prove the candidate success and revision were not durably accepted, then prove generation restoration by durably recording a later legitimate fetch failure instead of suppressing it. The focused file passed 41 tests; repository typecheck and ESLint passed; the full suite passed 2,017 tests with one existing skip and zero failures. Both changed files passed Prettier and `git diff --check`; root formatting remains blocked only by the three pre-existing/generated Beads state files listed above. No production-code change was required.
- Corrected SJ-STEP4-003: batch thing responses are validated per requested identity before result construction. Unrequested IDs are filtered, duplicate requested IDs become explicit per-ID ambiguity failures, missing requested IDs retain exact returned-ID provenance, and valid siblings remain available. Batch refresh and collection import consume the per-ID failure map, so mixed responses preserve partial progress without corrupting or adding games. Secondary collection responses use the same returned-ID filtering while retaining valid absent-item semantics.
- Corrected SJ-STEP4-004: `CollectionMutationService` now has an explicit post-commit hook that runs after `saveCollection` succeeds and before the serialized boundary releases. Single and batch accepted-success generations advance only in that hook; persistence failure still runs compensation hooks and never exposes a generation, while post-commit hook failures propagate after the durable save. Deterministic in-memory gated-save tests start a second same-game success or failure while the first save is pending, fail the first save, and prove the second success persists and the second failure records its exact warning.
- SJ-STEP4-003/004 focused evidence passed with 117 tests and one existing skip. Terminal repository validation passed: typecheck, ESLint, 2,029 full-suite tests with one existing skip and zero failures, and the production web build. Final changed-file formatting and `git diff --check` also passed.
- Step 4 is corrected but acceptance remains pending. Independent validation and review remain outstanding, and the overall useful-collection-profile plan is not complete.
- Corrected SJ-VERIFY-001: singular secondary collection responses now require at most one requested-ID match. Duplicate requested entries produce no `collectionData`, preserve valid thing and entity metadata, retain existing persisted play evidence, and emit exact warning provenance with returned IDs and fields. Unrelated extras remain filtered, successful absence remains an absent observation, and the batch path already enforces the same per-ID identity rule.
- SJ-VERIFY-001 focused evidence passed: BGG client tests 54 passed with one existing timeout test skipped, and game-service BGG tests 45 passed. Terminal repository validation passed: typecheck, ESLint, 2,032 full-suite tests with one existing skip and zero failures, and the production web build. Changed-file Prettier and `git diff --check` passed.
- Independent acceptance closed `SJ-VERIFY-001` and the Step 4 local gate. Focused validation passed 289 tests with one existing skip; the full suite passed 2,032 tests with one existing skip and zero failures. Root typecheck, root ESLint, web TypeScript, the production web build, changed-file Prettier, and `git diff --check` passed. Root formatting recorded only the three generated Beads baseline failures. Step 4 is complete; the overall useful-profile implementation remains in progress.
- Independent acceptance closed `INT-VAL-1` through `INT-VAL-4`, `SJ6-IR-001` through `SJ6-IR-007`, `SJ6-AR-001` through `SJ6-AR-004`, and `SJ6-TAR-001`, completing the Step 6 local gate for `shelf-judge-1q2.5`. Final validation passed 2,085 tests with one existing skip and zero failures; root shared/daemon/CLI typecheck, root ESLint, web TypeScript, production web build, scoped formatting, and `git diff --check` passed. Root formatting reported only the three generated Beads baseline files. Step 4 acceptance remains unchanged, and the overall useful-profile status remains `in_progress`.
