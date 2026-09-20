---
title: "Implementation plan: expanded profile attention opportunities"
date: 2026-09-20
status: draft
tags: [plan, profile, attention, owner-feedback, intention-lifecycle]
modules: [shared, daemon, cli, web]
related:
  - .lore/work/specs/expanded-profile-attention-opportunities.md
  - .lore/reference/specs/current/useful-collection-profile.md
---

# Implementation plan: expanded profile attention opportunities

## Approval and scope gate

This is a review artifact only. **No implementation is authorized until this plan and the approved source spec are reviewed and accepted.** The normative source is [Expanded Profile Attention Opportunities](../specs/expanded-profile-attention-opportunities.md), REQ-PROFILE-ATTN-1 through REQ-PROFILE-ATTN-19. The shipped [Useful Collection Profile](../../reference/specs/current/useful-collection-profile.md) remains authoritative for non-conflicting intention lifecycle, evidence-warning, ownership-transition, completion, history, and no-reopen behavior.

Implement only these now:

- `unplayed-owner-wanted` as a daemon-selected, projection-only presentation of one active, owned, non-replay Want to play intention with valid, fresh, unconflicted exact-zero evidence;
- fallback to the existing `play-intention` projection and its existing evidence warning whenever that predicate is not true; and
- durable, local, owner-visible and owner-deletable Yes/No/Skip feedback, including web and CLI operation parity.

Do not implement or silently prepare feature behavior for `incomplete-rating`, `purchase-utilization-goal`, suppression, AI settings/agent/provider flows, reminder-like behavior, inferred opportunities, a second card, or a durable “unplayed” state. This plan preserves the separate scope and delivery boundary of `shelf-judge-0hr`; do not fold its work, tests, or acceptance claims into this issue.

## Dependency flow

`current-model discovery → approved conflict-representation/policy decision → source/data contract and migration → shared validation → daemon projection and commands → route/CLI transport → web rendering and controls → focused cross-boundary tests`

Each arrow is a gate: clients consume daemon decisions only, and no client may independently qualify, reorder, resolve, suppress, or mutate an intention. In particular, no implementation work for exact-zero selection may proceed past the conflict decision gate below without an approved representation and resolution policy.

## Contract decisions to preserve

- Each active intention produces exactly one card with the existing `intentionId`-derived card identity. A presentation change changes neither durable kind, baseline, version, resolution, history, nor actions.
- Replay wins before exact-zero evaluation. Active replay, legacy first-play, baseline-absent Want to play, unowned/ineligible evidence cases, and all stale/missing/invalid/superseded/conflicting evidence remain `play-intention` with the established warning where applicable.
- The daemon selects the family and neutral order: NFC-normalized game name by Unicode code-point order, then stable game ID, then presentation family ID. It must not encode priority, age, urgency, guilt, reminders, queue size, or statistics-derived inference.
- Keep exactly the two existing Profile questions and retain the successful `Nothing needs attention right now.` state, distinct from profile unavailable.
- Feedback is independent durable owner-local event data. `no` neither hides, suppresses, ranks, resolves, nor changes eligibility. A reason is optional, owner-visible/deletable event data only, never provider/model input or a qualification, ranking, suppression-inference, penalty, age, or urgency input.

## Implementation steps

### 1. Discover and approve the accepted-source conflict contract

**Depends on:** approved plan and source spec; precedes every exact-zero implementation task.

**Likely paths to inspect during implementation:** the current Useful Collection Profile durable collection source, play-count evidence model, evidence refresh/check records, validation schemas, projection cache inputs, and their current fixtures. The discovery must establish whether the shipped model currently records only one `playCountEvidence` plus latest-check state, or already retains accepted-source observations elsewhere.

1. Produce a short, reviewable contract decision from the discovered model. It must name the authoritative persisted representation that can determine whether accepted sources disagree, which sources/checks are accepted, how observations are associated with a game and source, and the deterministic resolution policy for agreement, disagreement, missing/invalid observations, a later refresh/check, and freshness. It must also identify the exact fallback warning authority in Useful Collection Profile.
2. Do not infer a multi-source history, source precedence, merge rule, or conflict shape from this amendment. If the current single-evidence model cannot represent accepted-source disagreement, the decision must explicitly choose and approve the minimal extension, or record that no implementation is authorized until a separate approved contract supplies it. The approved decision, not this plan, defines the representation and policy.
3. The chosen decision must enumerate its required follow-on work before code begins: durable persistence and source-version migration; shared runtime validation; projection inputs; cache key/version inputs and invalidation; the compatibility-card fallback warning; and positive, disagreement, stale, superseded, missing, and invalid fixtures. It must preserve REQ-PROFILE-ATTN-7: every unusable zero witness selects `play-intention` with the current authority's specific warning, while a valid trusted later above-baseline witness retains the existing evidence-update completion path.

**Gate:** a reviewer has approved an authoritative conflict representation and deterministic resolution policy, including the follow-on persistence/validation/migration/projection/cache/fallback/fixture checklist. **Absent that approval, stop: do not implement exact-zero qualification, conflict rejection, or its fixtures.**

### 2. Establish the bounded shared source and public contracts

**Depends on:** step 1's approved conflict representation/policy.  
**Likely paths:** `packages/shared/src/types.ts` (collection source around lines 766-802; profile attention types around 1040-1121), `packages/shared/src/collection-profile-validation.ts` (attention validation around 1031-1133), `packages/shared/src/validation.ts`, `packages/shared/src/index.ts`, `packages/shared/tests/useful-profile-contract.test.ts`, `packages/shared/tests/fixtures/useful-profile.ts`.

1. Apply step 1's approved conflict representation/policy to the versioned durable collection source, including any approved accepted-source observations/conflict state and its atomic, repeatable migration. Do not introduce a different source precedence or conflict rule in a client or projection helper.
2. Extend the versioned durable collection source with a feedback-event collection. Every event has its own immutable durable `feedbackEventId`, in addition to stable card ID, presentation family, game ID, answer (`yes | no | skip`), and recorded-at timestamp. Model an optional reason as fixed category plus bounded optional free text attached to that event. Do not add an intention kind, `unplayed` flag, rating state, goal state, suppression state, provider setting, or AI data field.
3. Extend the public Profile and owner feedback-history contracts so an attention item can expose selected family, existing underlying identity/lifecycle fields and actions, required owner relevance/action/destination/evidence-or-warning data, and applicable feedback identifiers. Define a separate owner-visible feedback history result keyed by durable event identity. History remains queryable even when its source card has resolved, retired, or changed family.
4. Define validated daemon command/result contracts for recording feedback, viewing owner feedback history, and deleting one feedback event (including its reason) by `feedbackEventId`. Recording may require an active current card identity/game/family projection, but viewing and deletion must authorize the owner by durable event identity and must not require the card to remain active or rendered. Commands are idempotent under the project command-ID receipt pattern and feedback writes are not profile reads.
5. Update runtime schemas and exports together. Reject unknown family/answer/reason shape, malformed timestamps/IDs/event IDs, inconsistent event game/card/family associations, unauthorized owner access, and feedback that attempts to carry suppression or provider fields.
6. Decide and document the schema version bumps and repeatable atomic collection migrations required by the approved conflict representation and feedback-event store. Preserve all durable intention fields and resolved history byte-for-byte semantically; interrupted migration must leave the last valid source loadable. Bump the disposable profile contract/algorithm cache version rather than migrating cached projections.

**Requirements traced:** REQ-PROFILE-ATTN-2, 4-6, 8, 12-14, 19; preserves REQ-USEFUL-PROF-33 through 36, 40-45, and 49.  
**Gate:** shared contract tests prove invalid feedback, unauthorized history access, and duplicate-card shapes reject; migration fixtures prove the approved conflict representation and empty feedback initialization, idempotence, atomic retry safety, and unchanged intention kind/baseline/version/resolution/history.

### 3. Implement daemon-owned presentation selection and cache invalidation

**Depends on:** steps 1-2.  
**Likely paths:** `packages/daemon/src/services/collection-profile-engine.ts` (attention projection around lines 321-413), `packages/daemon/src/services/profile-service.ts` (cache/recompute flow around lines 60-150), `packages/daemon/src/services/intention-service.ts` (lifecycle handling around lines 76-126), `packages/daemon/src/services/profile-source-coordinator.ts`, `packages/daemon/tests/collection-profile-engine.test.ts`, `packages/daemon/tests/profile-service.test.ts`, `packages/daemon/tests/profile-stale-detection.test.ts`, `packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts`.

1. Centralize one pure, daemon-owned selection helper used by profile recomputation. Starting from an active intention, select `play-intention` unless all of these are true: non-replay Want to play, currently owned, and a current witness that satisfies step 1's approved accepted-source conflict policy, has a valid non-negative count exactly `0`, and has the source/observation/freshness facts required by Useful Collection Profile. Replay precedence is evaluated first.
2. Reuse the current evidence-warning and observed-play-completion authority rather than recreating it. Evidence loss or a changed zero predicate only changes the rendered family back to `play-intention`; it cannot write durable state. A valid trusted later count above a trustworthy captured baseline continues to complete during the existing evidence update path, never profile read/recompute.
3. Project one item per active intention, retain card ID and intention ID across family changes, and construct family-specific question/why-now wording while retaining the existing actions, authoritative destinations, evidence metadata, and warnings. Do not create rating/goal cards or second cards.
4. Apply the three-key neutral order after family selection using NFC normalization and Unicode code-point comparison, then stable game ID, then family ID. Assert this is the only attention ordering and that it is independent of timestamps, count, feedback, ownership age, cost, fitness, or statistics.
5. Update cache invalidation/versioning for every selection input, including all observations/conflict-resolution inputs required by step 1's approved representation: ownership, intention state/kind/baseline/version, play witness value/validity/source/observation/freshness/conflict/supersession, collection schema, and profile contract/algorithm. Cached old projections are discarded and recomputed; no durable migration is triggered by selection itself.
6. Keep the existing section precedence: unavailable is not empty; otherwise render active intention projections; otherwise successful empty state. Keep the two Profile questions as the only top-level sections.

**Requirements traced:** REQ-PROFILE-ATTN-1-8, 11-12, 14, 18; preserves REQ-USEFUL-PROF-25, 28-32, 34-38, 48-50.  
**Gate:** daemon fixtures, using step 1's approved representation, cover active owned non-replay exact zero, replay exact zero, first-play, general baseline-absent Want to play, nonzero, unowned, missing, invalid, stale, superseded, and accepted-source-conflicting evidence. Each asserts one card only, stable IDs, correct family and current-authority fallback warning, no read-side write, and existing above-baseline evidence-update completion.

### 4. Add durable local feedback operations at the daemon boundary

**Depends on:** steps 2-3.  
**Likely paths:** `packages/daemon/src/services/profile-service.ts`, `packages/daemon/src/services/intention-service.ts` (reuse command receipt/concurrency conventions, but do not make feedback an intention transition), collection persistence/migration service discovered from the existing intention persistence path, `packages/daemon/src/routes/profile.ts`, `packages/daemon/tests/services/profile-persistence.test.ts`, `packages/daemon/tests/routes/profile.test.ts`, `packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts`.

1. Add daemon commands to record Yes/No/Skip, list owner feedback history, and delete a feedback event/reason by durable `feedbackEventId`, using validated command IDs, local durable writes, structured errors, receipts, and the project’s optimistic-concurrency rules where source versioning requires them. Recording validates an active current card as the approved command contract requires; history and deletion authorize against durable owner event identity independently of active-card projection.
2. On `no`, persist the answer first and then permit a single optional reason submission or decline. No prompt loop, follow-up pressure, or suppression action is available. Yes and Skip have no side effect beyond their event. Deletion removes only the selected feedback event/reason, never an attention card, intention, evidence, or history.
3. Ensure recomputation reads feedback only to display owner-visible event state on active cards. The independent history query must retain all owner events until deletion, including events whose cards later resolve, retire, or disappear. Explicitly keep feedback out of qualification, selected family, ordering, resolution, cache staleness decisions other than displaying new event data, source refresh, logging payloads beyond necessary event audit fields, aggregation, sharing, and any provider boundary.
4. Add a boundary test that no rating/goal/suppression/AI command, route, config, migration, or source mutation is introduced by this issue.

**Requirements traced:** REQ-PROFILE-ATTN-4, 12-14, 19; implements the available portion of REQ-PROFILE-ATTN-13.  
**Gate:** restart/persistence tests prove each answer and optional reason survives until deletion; command replay creates no duplicate event; No leaves the same card eligible/visible; deletion is owner-scoped; and feedback recorded on a card remains viewable and deletable after that card resolves or retires. Profile reads and feedback writes never alter underlying intention/evidence/history.

### 5. Expose daemon decisions and feedback commands through route and CLI parity

**Depends on:** step 4.  
**Likely paths:** `packages/daemon/src/routes/profile.ts`, route registration module, `packages/cli/src/commands/profile.ts`, CLI command registration, `packages/daemon/tests/routes/profile.test.ts`, `packages/cli/tests/commands/profile.test.ts`, `packages/cli/tests/process/profile*.test.ts`.

1. Extend the validated profile response without client-side projection so it returns selected family, complete item fields/actions/destinations, evidence/warning state, neutral order, and active-card feedback identifiers allowed for the owner to view. Add a separate owner feedback-history route/result that is not scoped to active cards.
2. Add explicit CLI operations for record-feedback, feedback-history/view, and delete-feedback by `feedbackEventId` (either profile subcommands or the project’s established mutation-command location), with the same required arguments and command-ID semantics as the route. Emit validated JSON on success and structured errors to stderr with nonzero exit on failure.
3. Add matching HTTP operations that relay only validated owner commands to the daemon. History and deletion must use durable event identity and owner authorization, not active-card existence. They must not accept an arbitrary family, reason, ranking, suppression, or qualification override, and must not expose a provider/AI path.

**Requirements traced:** REQ-PROFILE-ATTN-8, 13-14, 19; preserves REQ-USEFUL-PROF-40-43.  
**Gate:** route and CLI contract tests execute Yes, No-with-reason, No-without-reason, Skip, active-card view, owner history view, delete by event ID, validation/authorization failure, and command replay. They must resolve or retire the feedback's card before history view/delete and compare resulting daemon state and response shape across clients.

### 6. Render the attention section and accessible feedback controls in the web client

**Depends on:** step 5.  
**Likely paths:** current Profile page/attention-section component under `packages/web`, `packages/web/tests/profile-consumers-integration.test.tsx`, `packages/web/tests/profile-api.test.ts`, `packages/web/tests/profile-accessibility-and-removal.test.ts`, `packages/web/e2e/useful-profile.pw.ts`; reuse the existing intention controls and browser mutation patterns rather than introducing a parallel state machine.

1. Render daemon-returned family, IDs, question, why-now, owner-state time, evidence source/value/observation time or warning, existing intention actions, and authoritative destinations. For `unplayed-owner-wanted`, vary presentation only; retain the same underlying controls and card identity. Never compute qualification, freshness, conflict, fallback, ordering, or resolution in the browser.
2. Keep the two exact section questions and render `Nothing needs attention right now.` only for the successful empty result, not unavailable/error. Preserve existing unavailable/retry behavior.
3. Put **Was this worth bringing up?** with visible Yes, No, and Skip on every active card. Wire each to the validated route mutation; after No, offer optional fixed category and optional short text with an explicit decline/complete path and no pressure. Add an owner feedback-history surface that renders durable events and delete controls by `feedbackEventId`, independent of active attention cards. Do not show suppression or AI/settings affordances.
4. Reuse existing mutation UX for pending/error/success announcement, field-associated validation, focus retention, keyboard/touch operation, non-color-only status, wrapping, 44px targets, and responsive zoom behavior.

**Requirements traced:** REQ-PROFILE-ATTN-1-3, 5-8, 11, 13-14, 18-19; preserves REQ-USEFUL-PROF-46-48.  
**Gate:** component and browser tests verify exact questions, empty versus unavailable state, all three feedback controls on both presentation families, optional No reason/decline, owner history and deletion by event ID after the originating card resolves or retires, announced mutation errors, keyboard flow, no horizontal overflow at existing Profile viewports/zoom, and absence of suppression/AI/rating/goal UI.

### 7. Reconcile authority documentation and complete focused acceptance

**Depends on:** steps 1-6.  
**Likely paths:** `.lore/reference/specs/current/useful-collection-profile.md` (only its authority/reconciliation notice and implementation evidence, without rewriting lifecycle rules), the tests named in steps 1-5.

1. Update current-authority reconciliation language/evidence only after code and tests demonstrate the bounded projection and feedback behavior. Do not overwrite the existing lifecycle rules, and do not claim the deferred families or AI proposal are implemented.
2. Run the focused shared, daemon, route, CLI, web component, and Profile browser suites added/updated above, followed by TypeScript typecheck/lint/format only for changed packages. Validate the cache/schema migration test independently.
3. Perform a final requirement-to-evidence review using the matrix below. Fail acceptance if any client-side inference, second card, durable unplayed state, feedback influence, unapproved-family/settings/suppression surface, recommendation, reminder, urgency framing, or `shelf-judge-0hr` scope coupling appears.

**Requirements traced:** REQ-PROFILE-ATTN-1-19.  
**Gate:** all focused tests and targeted static checks pass; migration/cache fixtures pass; requirement matrix has evidence or an explicit blocked boundary for every requirement.

## Requirement coverage and blocked-contract matrix

| Requirement | This issue’s disposition | Evidence location |
| --- | --- | --- |
| 1 | Implement two questions and successful empty state | Steps 2, 5 |
| 2 | Implement current-evidence selection/fallback and required rendered facts for active intention cards | Steps 1, 2, 5 |
| 3 | Implement one-card replay-first/fallback selection | Step 2 |
| 4 | Preserve existing lifecycle and prohibit read-side mutation | Steps 1-3 |
| 5 | Implement projection-only exact-zero owned non-replay selection | Step 2 |
| 6 | Preserve durable intention fields; cache-only recomputation | Steps 1-2 |
| 7 | Reject unusable zero evidence; retain existing warning and completion authority | Step 2 |
| 8 | Expose/render required item fields and destinations | Steps 1, 4, 5 |
| 9 | **Blocked:** no rating-workflow contract. Assert no rating family/state/migration/UI. | Steps 3, 5, 6 |
| 10 | **Blocked:** no purchase-utilization-goal contract. Assert no goal family/state/migration/UI. | Steps 3, 5, 6 |
| 11 | Implement neutral deterministic order and prohibit urgency/reminders/guilt | Steps 2, 5 |
| 12 | Preserve Useful Collection Profile lifecycle and evidence-update completion | Step 2 |
| 13 | Implement local feedback; suppression remains unavailable | Steps 1, 3-5 |
| 14 | Daemon owns all decisions; clients only render/relay | Steps 2, 4-5 |
| 15 | **Blocked:** AI settings assistant has no approval or implementation scope. Add no agent/provider/config flow. | Steps 3, 5-6 |
| 16 | **Blocked:** no AI transmission path exists or is introduced. | Steps 3, 6 |
| 17 | **Blocked:** no AI/private-channel transmission path exists or is introduced; feedback reasons remain local. | Steps 3, 6 |
| 18 | Prohibit recommendations and statistics-only inference | Steps 2, 5-6 |
| 19 | Implement durable owner-visible/deletable local feedback and reason privacy | Steps 1, 3-5 |

## Migration, cache, configuration, and separation checks

- **Migration:** atomic, repeatable durable collection migrations only for the step-1-approved accepted-source conflict representation (if one is approved) and the feedback-event store. No migration of intentions, ratings, goals, suppression, provider settings, or cache artifacts. Do not start either conflict migration without the required step-1 approval.
- **Cache:** invalidate/recompute disposable Profile data for every step-1-approved conflict-resolution input, all other presentation-selection inputs, and profile contract/algorithm version; feedback display may require refresh but must not affect eligibility/order/lifecycle. Never serve an old projection as current after an input changes.
- **Configuration:** no new family enablement setting, provider/model setting, AI extension, credential path, timer, reminder, suppression configuration, rating configuration, or goal configuration.
- **`shelf-judge-0hr`:** preserve a clean issue boundary. Do not alter its contract, rename its work, depend on unmerged 0hr implementation, or report its tests as evidence for this plan.
