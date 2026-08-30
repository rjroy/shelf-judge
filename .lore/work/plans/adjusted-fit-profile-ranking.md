---
title: "Implementation plan: adjusted-fit profile ranking"
date: 2026-08-29
status: executed
tags: [plan, collection-profile, adjusted-fit, ranking, exact-arithmetic]
modules: [shared, daemon, cli, web]
related:
  - .lore/work/research/profile-appreciation-scoring.md
  - .lore/work/specs/useful-collection-profile.md
  - .lore/work/design/profile-evidence-explorer.md
  - .lore/work/plans/useful-collection-profile.md
---

# Implementation plan: adjusted-fit profile ranking

## Goal

Replace raw entity-mean ranking with the approved comparator-adjusted fitness ranking from `.lore/work/research/profile-appreciation-scoring.md`. Mechanics, designers, and artists continue to describe associations between entities and games that fit the owner's current preferences. The change must not turn frequency, collection share, or representation into a second appreciation or identity ranking.

The implementation adds an adjusted value to every drilldown entity, uses that value for the authoritative `bestFit` ordering and supported-only overview selection, and keeps count as evidence, shrinkage strength, support eligibility, an exact-tie breaker, and a diagnostic count-first ordering. It preserves the existing eligibility, exclusion, canonical-name, deduplication, comparator, evidence, readiness, warning, attention, and class-isolation behavior.

This plan is the review artifact for Beads issue `shelf-judge-d4v`. The scoring decision was approved through completed research issue `shelf-judge-5gq`; implementation issue `shelf-judge-g0r` executed the accepted plan through all eight phases.

## Approved amendment to the current specification

The implemented `.lore/work/specs/useful-collection-profile.md` remains the baseline except where its raw-mean ranking language conflicts with the approved research. Implementation must reconcile the active specification before declaring the feature complete:

- Extend REQ-USEFUL-PROF-6 with `adjustedMeanCurrentFitness` while retaining all raw aggregates and evidence.
- Amend REQ-USEFUL-PROF-8 so support requires the class's serialized `minimumSupportedGames`, currently three by default; preserve limited-drilldown behavior below that configured threshold.
- Amend REQ-USEFUL-PROF-9 so overview selection uses exact adjusted fit, then count, normalized name, and entity ID, capped at the configured class limit after excluding limited entities.
- Amend REQ-USEFUL-PROF-10 so drilldown orderings are `bestFit`, `support`, and `name`; `support` is explicitly diagnostic.
- Extend REQ-USEFUL-PROF-11 to prohibit presenting count or representation as appreciation, preference, identity, confidence, or causal responsibility.
- Extend REQ-USEFUL-PROF-19 so shared validation independently reproduces adjusted values, exact ordering, and overview IDs.
- Preserve REQ-USEFUL-PROF-20 through REQ-USEFUL-PROF-24 for complete pass-through, accessibility, responsive behavior, cache invalidation, and metadata handling.
- Replace the raw-mean ordering statement in the Entity Identity And Arithmetic technical contract and AI Validation item 5. Do not alter the attention requirements or any unrelated useful-profile behavior.

## Current boundaries

- `packages/shared/src/types.ts` defines `CollectionProfileEntityEvidence`, `CollectionProfileEntityOrderings`, class results, and profile data literals. The current profile contract is 8 and algorithm is 10.
- `packages/shared/src/collection-profile-entity-policy.ts` already exposes `minimumSupportedGames` independently for every entity class through `CollectionProfile.entityPolicy`. This is the snapshot's explicit prior weight; no duplicate field or ambient default is needed.
- `packages/shared/src/exact-rational.ts` already supplies exact decimal conversion, addition, multiplication, division, comparison, and numeric serialization.
- `packages/shared/src/collection-profile-validation.ts` independently rebuilds entity and comparator evidence and verifies all supplied order arrays and overview IDs.
- `packages/daemon/src/services/collection-profile-engine.ts` is the pure authoritative producer. It currently ranks `rating` by exact raw mean and builds the overview from supported IDs in that order.
- `packages/daemon/src/services/profile-service.ts` computes against a serialized source snapshot and validates before publishing. `storage-service.ts` validates persisted `profile.json` against the configured policy and current versions; malformed or old caches are disposable.
- `packages/daemon/src/services/profile-service.ts` validates the computed snapshot before the route returns it. `packages/cli/src/client.ts` and `packages/web/lib/api.ts` independently validate daemon responses, while `packages/daemon/src/routes/profile.ts` currently trusts its injected service result and needs an explicit policy-aware response check at the HTTP boundary.
- `packages/web/components/profile/entity-card.tsx` and `identity-section.tsx` render daemon-supplied overview IDs. `packages/web/app/profile/entities/page.tsx` traverses supplied drilldown order arrays and does not sort entities locally.
- The durable collection schema is 5 and does not change. Profile source identity and cache-publication coordination do not change.

## Arithmetic and ordering contract

For one entity class, let:

- `n` be an entity's unique eligible associated-game count;
- `E` be the exact sum of that entity's eligible current-fitness values;
- `k` be the class comparator's eligible-game count;
- `C` be the exact sum of the comparator's current-fitness values; and
- `m` be `entityPolicy[class].minimumSupportedGames`.

The raw entity mean is `E / n`, the class comparator mean is `C / k`, and the adjusted mean is:

```text
adjustedMean = ((n * (E / n)) + (m * (C / k))) / (n + m)
             = (E * k + m * C) / (k * (n + m))
```

The daemon and shared validator each implement this derivation locally with `ExactRational`; they must not share an adjusted-score helper. The daemon serializes `adjustedMeanCurrentFitness` with `ExactRational.toNumber()` only after retaining the exact rational for comparisons. The shared validator independently derives the exact rational from game evidence and class policy, verifies the serialized finite number with the existing exact numeric-match policy, and derives orderings from its own rational values. Display rounding remains a web-only presentation concern and never feeds an ordering.

An entity cannot exist when `k` is zero because every entity game belongs to the class comparator cohort. Empty comparators therefore produce no entities and empty order arrays; shared validation rejects any payload that combines a zero-game comparator with entity evidence.

Authoritative orderings are:

1. `bestFit`: adjusted mean descending, associated-game count descending only when adjusted values are exactly equal, NFC-normalized name by Unicode code point ascending, entity ID ascending.
2. `support`: associated-game count descending, exact raw mean descending, normalized name ascending, entity ID ascending. This preserves the existing diagnostic secondary rules and does not control overview membership or order.
3. `name`: normalized name ascending, entity ID ascending.

Every ordering contains every entity ID exactly once. `overviewEntityIds` is the first `overviewLimit` supported IDs encountered in `bestFit`; a limited entity can lead `bestFit` but cannot enter the overview.

## Product and compatibility decisions

- The contract key becomes `bestFit`; no `rating` field remains in current API, CLI, persisted profile, or fixtures.
- Existing web URLs with `order=rating`, explicit `order=bestFit`, and an empty `order` are accepted as inputs for `bestFit` and redirected server-side to the equivalent canonical URL without `order`. Generated links omit the default. The native GET order control may submit `order=bestFit`; the redirect preserves every other query field and lets no-JavaScript navigation converge on the canonical URL.
- User-facing score and ordering language is “Adjusted fit.” “Best fit” remains only the contract key where necessary.
- Overview cards and compact entity rows lead with adjusted fit. Raw mean, comparator, and associated-game count remain visible secondary evidence; full detail retains difference, dispersion, range, supporting games, and veto state.
- Count ordering is labeled as diagnostic. No heading, accessible name, help text, or documentation calls it appreciation, preference, identity strength, confidence, or quality.
- Adjusted values are never compared across mechanics, designers, and artists.
- No representation overview, hybrid fit-plus-count score, fractional game allocation, external prevalence correction, new network data, new collection field, or collection migration is introduced.

## Step 1: Reconcile the target contract and discriminating fixtures

**Files:**

- `.lore/work/specs/useful-collection-profile.md`
- `.lore/work/design/profile-evidence-explorer.md`

**Changes:**

1. Apply only the approved specification amendments listed above. Update the explorer design's default order, query semantics, compact score hierarchy, and diagnostic count language; do not rewrite historical executed plans or notes.
2. Define the canonical target fixture on paper in the specification examples and this plan's scenario matrix: `adjustedMeanCurrentFitness`, `{ bestFit, support, name }`, and overview IDs selected from supported `bestFit` entries. Do not edit the currently typed fixture before the contract cutover.
3. Define hand-calculated cases that make raw mean, adjusted mean, and count produce different candidate orders. Avoid cases where the new and old algorithms happen to agree.
4. Record formula inputs and expected exact fractions so Step 2 tests are reviewable without trusting implementation output.

**Validation gate:**

- A requirements review confirms only REQ-USEFUL-PROF-6, 8, 9, 10, 11, 19 and their arithmetic/validation text changed semantically; unrelated identity and attention requirements remain intact.
- Scenario review confirms every expected adjusted value can be calculated from entity games, comparator games, and the class's serialized `minimumSupportedGames`.
- Scenario expectations cover all cases in the Hand-calculated scenario matrix below before producer code is changed.
- No production TypeScript is modified in this step.

## Step 2: Perform one workspace-wide contract and producer cutover

**Files:**

- `packages/shared/src/types.ts`
- `packages/shared/src/collection-profile-validation.ts`
- `packages/shared/src/validation.ts`
- `packages/shared/src/exact-rational.ts` only if an existing primitive is insufficient
- `packages/shared/src/index.ts` only if an existing export must change
- `packages/shared/tests/fixtures/useful-profile.ts`
- `packages/shared/tests/useful-profile-contract.test.ts`
- `packages/shared/tests/validation.test.ts` if version-literal coverage lives there
- `packages/daemon/src/services/collection-profile-engine.ts`
- `packages/daemon/tests/collection-profile-engine.test.ts`
- `packages/daemon/tests/routes/profile.test.ts`
- `packages/daemon/tests/services/profile-persistence.test.ts`
- `packages/daemon/tests/services/storage-service.test.ts`
- `packages/daemon/tests/profile-service.test.ts`
- `packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts`
- `packages/cli/tests/client.test.ts`
- `packages/cli/tests/commands/profile.test.ts`
- `packages/web/app/profile/entities/page.tsx`
- `packages/web/components/profile/entity-card.tsx`
- `packages/web/components/profile/entity-evidence.tsx`
- `packages/web/tests/profile-api.test.ts`
- `packages/web/tests/profile-consumers-integration.test.tsx`
- `packages/web/tests/profile-drilldowns.test.tsx`
- `packages/web/e2e/fixture-daemon.ts`

**Changes:**

1. Add finite `adjustedMeanCurrentFitness` to `CollectionProfileEntityEvidence`. Rename `CollectionProfileEntityOrderings.rating` to `bestFit`; retain `support`, `name`, and one `overviewEntityIds` list.
2. Advance `CURRENT_PROFILE_CONTRACT_VERSION` from 8 to 9 and `CURRENT_PROFILE_ALGORITHM_VERSION` from 10 to 11. Keep collection schema 5.
3. In shared validation, independently reconstruct exact entity sums, comparator sums, and adjusted means using the supplied class policy. Reject missing, extra, non-finite, rounded, or forged adjusted values.
4. Replace `expectedEntityOrders` rating logic with the exact ordering contract above. Verify complete ID permutations and derive expected overview IDs by filtering supported IDs from `bestFit` before applying `overviewLimit`.
5. In the daemon engine, calculate the exact comparator once per nonempty class, compute an exact adjusted rational for every entity including limited entities, serialize its numeric value, and retain exact rationals for ordering.
6. Emit `bestFit`, preserve diagnostic `support` and `name`, and build overview IDs only from supported `bestFit` entries. Keep the engine pure, synchronous, deterministic, and class-local.
7. Keep canonical displayed fitness, predicted-contribution exclusion, vetoed zero, complete class metadata, duplicate-link deduplication, canonical names, comparator membership, standard deviation, range, and signed raw difference unchanged.
8. Cut over the shared type, strict runtime schema, canonical fixture, producer, every typed daemon/CLI/web/browser fixture, every direct `rating` consumer, and version literals together. Make the minimum compile-safe web substitution to consume `bestFit` and display the added field; Steps 5 and 6 refine final hierarchy, copy, accessibility, and URL behavior.
9. Do not publish an intermediate contract containing both `rating` and `bestFit`, do not add a runtime payload translation layer, and do not merge this step while any workspace package or browser fixture still targets the old shape.

**Validation gate:**

- `bun test packages/shared/tests/useful-profile-contract.test.ts packages/daemon/tests/collection-profile-engine.test.ts`
- `bunx tsc --noEmit -p packages/shared/tsconfig.json`
- `bunx tsc --noEmit -p packages/daemon/tsconfig.json`
- `bun run typecheck`
- `bun run typecheck:browser`
- `bun run build`
- Shared tests reject a correct raw mean presented as adjusted, a rounded adjusted value, correct values in the wrong order, duplicate/missing/extra ordering IDs, a limited overview ID, and overview IDs taken from `support`.
- Engine tests pass every hand-calculated scenario for mechanics, designers, and artists, including class-specific prior weights.
- Reordered source games and links produce identical entity records when compared by entity ID and byte-equivalent authoritative order arrays and overview IDs. Physical `entities` array order is not a contract ordering.
- A source review confirms shared validation does not import or call a daemon adjusted-score implementation.

## Step 3: Prove cache invalidation and persistence behavior

**Files:**

- `packages/daemon/src/services/profile-service.ts` only if version propagation requires a change
- `packages/daemon/src/services/storage-service.ts` only if strict current-schema handling requires a change
- `packages/daemon/src/services/collection-artifacts.ts` only if an existing assertion requires a change
- `packages/daemon/tests/services/profile-persistence.test.ts`
- `packages/daemon/tests/services/storage-service.test.ts`
- `packages/daemon/tests/profile-service.test.ts`
- `packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts`
- `packages/daemon/tests/integration/end-to-end.test.ts` only for current-version expectations

**Changes:**

1. Continue validating `profile.json` against current contract and algorithm literals plus the configured entity policy. Do not migrate or translate old snapshots.
2. Add explicit fixtures for contract 8/algorithm 10, contract 8/current algorithm, current contract/algorithm 10, and an old shape containing `rating` without adjusted values. Each must be deleted or bypassed and recomputed.
3. Prove a current adjusted profile round-trips exactly and remains valid after daemon restart.
4. Prove a changed `minimumSupportedGames` invalidates the prior snapshot through existing policy validation and recomputes adjusted values, support states, orderings, and overview IDs.
5. Preserve the composite source identity and profile-source coordinator. Do not add entity policy to the durable collection or collection source identity when current persisted policy validation already supplies the invalidation boundary.

**Validation gate:**

- `bun test packages/daemon/tests/services/profile-persistence.test.ts packages/daemon/tests/services/storage-service.test.ts packages/daemon/tests/profile-service.test.ts packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts`
- Real-filesystem tests show old and malformed caches are never served, current caches reload exactly, and regeneration publishes only a profile accepted by the independent schema.
- A version audit confirms profile contract 9, algorithm 11, collection schema 5, and no cache migration function.
- Existing collection/Tournament/redundancy/prediction source-race tests remain green.

## Step 4: Update daemon API and CLI boundaries

**Files:**

- `packages/daemon/src/routes/profile.ts`
- `packages/daemon/tests/routes/profile.test.ts`
- `packages/cli/src/client.ts` only if typing requires a production change
- `packages/cli/src/commands/profile.ts` only if typing requires a production change
- `packages/cli/tests/client.test.ts`
- `packages/cli/tests/commands/profile.test.ts`

**Changes:**

1. Keep `GET /api/profile` and operation `shelf.profile.get` as complete pass-through boundaries. Before serialization, validate an available result's embedded `entityPolicy` with `CollectionProfileEntityPolicySchema`, then parse the complete result with `createCollectionProfileResultSchema(validatedEmbeddedPolicy)`; parse unavailable results with the default-policy union branch. This checks structural and arithmetic self-consistency without a second config load that could race the policy snapshot already used and validated inside `ProfileService`. Do not project, recalculate, or reorder the result.
2. Keep `shelf-judge profile` JSON exactly equal to the validated daemon result. Do not add CLI display-specific arithmetic.
3. Update route and client fixtures to contract 9/algorithm 11, `adjustedMeanCurrentFitness`, and `bestFit`.
4. Add route tests with a malformed mocked service result and client tests with malformed HTTP responses. Old `rating` payloads, missing or forged adjusted values, wrong order arrays, and unsupported overview IDs must not be returned by the route with HTTP 200 or reach a CLI consumer. Preserve the existing HTTP 500 error envelope for route-side validation failure.

**Validation gate:**

- `bun test packages/daemon/tests/routes/profile.test.ts packages/cli/tests/client.test.ts packages/cli/tests/commands/profile.test.ts`
- Canonical available, limited, empty, mixed-readiness, and unavailable responses deep-equal across daemon response and CLI JSON.
- Source inspection confirms route and CLI code contain no adjusted-mean formula, entity sort, or profile projection.

## Step 5: Update the web validation boundary and overview

**Files:**

- `packages/web/lib/api.ts` only if typing requires a production change
- `packages/web/app/page.tsx` if policy data must be passed for explanation
- `packages/web/components/profile/identity-section.tsx`
- `packages/web/components/profile/entity-card.tsx`
- `packages/web/tests/profile-api.test.ts`
- `packages/web/tests/profile-consumers-integration.test.tsx`

**Changes:**

1. Keep `parseCollectionProfileResponse` policy-aware and strict. It must reject old or forged results through shared validation rather than repairing them.
2. Continue resolving overview cards only from daemon-supplied `overviewEntityIds`; do not sort, filter by a locally inferred threshold, or calculate adjusted values in web code.
3. Lead each card with “Adjusted fit” and its one-decimal display value. Show the raw mean, class comparator, and associated-game count as secondary evidence using associative collection-specific wording.
4. Explain that the configured class minimum is both the support threshold and the adjustment's comparator weight where needed for comprehension. Do not describe it as learned probability, confidence, significance, or creator responsibility.
5. Preserve separate mechanics, designers, and artists; supported-only overview limits; semantic headings; linked evidence; readiness and exclusion states; non-color-only status; and the existing score-neutral color treatment.

**Validation gate:**

- `bun test packages/web/tests/profile-api.test.ts packages/web/tests/profile-consumers-integration.test.tsx`
- API tests reject forged adjusted values and legacy ordering shapes.
- Rendered tests show adjusted fit, raw mean, comparator, and count for each overview entity and prove overview membership/order follows supplied IDs even when local raw mean or count suggests another order.
- Wording assertions reject “favorite,” “preferred,” “responsible,” “confidence,” and any statement that count or share is appreciation.
- A source audit finds no `.sort`, `localeCompare`, aggregate reduction, adjusted formula, or support-derived overview logic in web profile production code.

## Step 6: Update the entity explorer, URL compatibility, and full evidence

**Files:**

- `packages/web/app/profile/entities/page.tsx`
- `packages/web/components/profile/entity-evidence.tsx`
- `packages/web/components/profile/entity-explorer-focus.tsx` only if labels or focus targets change
- `packages/web/app/globals.css`
- `packages/web/tests/profile-drilldowns.test.tsx`
- `packages/web/tests/profile-accessibility-and-removal.test.ts`

**Changes:**

1. Make `bestFit` the `EntityOrdering` default. Before rendering, redirect requests whose `order` is `rating`, `bestFit`, or empty to the same URL with only `order` removed, preserving class, entity, support, query, and any unrelated query fields. Canonical generated links omit the default. The native GET select may use `value="bestFit"`; its no-JavaScript submission reaches the redirect and then the canonical URL. `support` and `name` remain explicit values and do not redirect.
2. Label the primary ordering “Adjusted fit.” Label `support` “Associated game count (diagnostic)” and retain `name`.
3. Traverse only `result.orderings[state.ordering]`. Search and support filters may select from that sequence but must preserve relative order and must not recompute score or support.
4. Change compact index headings and screen-reader text so adjusted fit is primary. Keep raw mean, comparator relationship, count, support state, and matched-game context visible as secondary evidence without making every row too dense at narrow widths.
5. Add adjusted fit to the selected entity dossier while retaining raw mean, comparator, signed difference, population standard deviation, range, supporting games, and veto labels.
6. Explain limited entities as adjusted evidence that remains drilldown-only until it reaches the configured support count. If rounded adjusted values appear equal, do not claim a tie; detail/help text may state that ordering uses the exact unrounded value.
7. Update grid and mobile CSS only as required. Preserve visible focus, native controls, 44px targets, wrapping, tabular numbers, 200% zoom behavior, and distinct intrinsic-empty versus filtered-empty states.

**Validation gate:**

- `bun test packages/web/tests/profile-drilldowns.test.tsx packages/web/tests/profile-accessibility-and-removal.test.ts`
- URL tests cover omitted default, explicit `bestFit`, legacy `rating` alias, empty `order`, `support`, `name`, links, no-JavaScript GET form submissions, reload, and entity selection. Every explicit default input redirects to the same state without `order`, does not loop, and preserves all other query parameters; `support` and `name` render directly.
- Supplied-order tests prove search and support filtering preserve daemon order and that diagnostic count order cannot alter overview IDs.
- Rendered and accessibility tests distinguish adjusted fit from raw mean and comparator, expose diagnostic wording in visible and accessible names, preserve heading order and focus behavior, and retain all evidence at mobile widths.
- Source audit confirms no web-side sort, adjusted arithmetic, rounded-value comparison, or support inference.

## Step 7: Update shared browser fixtures and end-to-end behavior

**Files:**

- `packages/web/e2e/fixture-daemon.ts`
- `packages/web/e2e/useful-profile.pw.ts`
- Shared canonical fixtures consumed by daemon, CLI, web, and browser tests
- `docs/screenshots/profile.png` if repository screenshots document current UI

**Changes:**

1. Generate browser entities with valid adjusted values and exact-consistent `bestFit`, `support`, and `name` arrays. Do not assign convenient arbitrary IDs that strict shared validation would reject.
2. Reuse canonical discriminating scenarios across daemon route, CLI, web API, rendered components, and browser flows so every boundary exercises the same contract.
3. Verify overview cards and entity drilldown show adjusted-primary/raw-secondary evidence, the order control defaults to Adjusted fit, count ordering is diagnostic, and old `order=rating` links resolve to the canonical behavior.
4. Preserve no-JavaScript GET forms, keyboard navigation, detail focus restoration, direct links, mobile result/detail transitions, class evidence, empty states, dark theme, contrast, and touch behavior.
5. Regenerate the profile screenshot only after the final UI and wording pass browser validation.

**Validation gate:**

- `bun run typecheck:browser`
- `bun run test:browser`
- Chromium passes at `375x812`, `768x1024`, and `1440x900`, plus the established literal 200% browser-zoom profile.
- There is no horizontal page overflow, clipped evidence, hover-only content, inaccessible control, focus loss, target below 44px, contrast regression, or mobile input zoom regression.
- Browser assertions demonstrate a limited entity may lead the full adjusted-fit drilldown while remaining absent from overview, and diagnostic count sorting never changes overview cards.

## Step 8: Update user documentation and complete terminal validation

**Status:** Complete

**Files:**

- `docs/usage.md`
- `.lore/work/specs/useful-collection-profile.md`
- `.lore/work/design/profile-evidence-explorer.md`
- All changed implementation and test files from prior steps

**Changes:**

1. Explain adjusted fit in owner language and include the formula, raw mean, class comparator, and `minimumSupportedGames` prior weight. State that the prior is policy, not learned truth.
2. Explain that count affects shrinkage, support, exact ties, and diagnostic ordering but is not an appreciation bonus or representation overview.
3. Document `bestFit`, diagnostic `support`, `name`, limited evidence, class isolation, exact-before-rounding order, old URL alias behavior, and the absence of external prevalence correction.
4. Correct profile version documentation to contract 9 and algorithm 11 while retaining collection schema 5.
5. Audit active docs, UI text, accessible names, snapshots, examples, and help for causal, universal-quality, confidence, “favorite,” “preferred,” and representation-as-appreciation claims.

**Validation gate:**

- Run focused suites from Steps 2 through 7, then `bun run typecheck`, `bun run lint`, `bun run test`, `bun run typecheck:browser`, `bun run test:browser`, and `bun run build`.
- Run Prettier checks on every changed file and `git diff --check`. Capture the root `bun run format:check` baseline immediately before implementation, then report those pre-existing failures separately and prove the implementation adds none.
- Search production code, active tests, and current documentation for stale `.rating`, `order=rating` generation, and raw-mean ranking claims. The only allowed `order=rating` occurrence is explicit compatibility input coverage and its documentation.
- Confirm profile contract 9 and algorithm 11 invalidate prior caches while collection schema remains 5.
- A fresh reviewer traces every approved research requirement through implementation and passing evidence and explains the formula, exact ordering, count semantics, limited evidence, cache regeneration, class isolation, and why representation is not appreciation.
- Mark this plan `executed` only after all gates pass. Do not mark the source specification `implemented` again until its amended requirements and validation text match the shipped behavior.

## Hand-calculated scenario matrix

Unless a row says otherwise, the class comparator mean is exactly 7 and `minimumSupportedGames` is 3.

| Scenario                             | Exact setup                                                                                     | Required evidence                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Three excellent versus many average  | A: `n=3`, raw 9, adjusted 8. B: `n=20`, raw 7, adjusted 7.                                      | A leads `bestFit`; B may lead `support`; count provides no appreciation bonus.                   |
| Tiny raw edge with stronger evidence | A: `n=3`, raw 9, adjusted 8. B: `n=20`, raw 8.9, adjusted `199/23` (about 8.652).               | B leads because adjustment preserves its strongly supported near-equal raw result.               |
| Quantity is not affinity             | A: `n=3`, raw 9, adjusted 8. B: `n=20`, raw 5, adjusted `121/23` (about 5.261).                 | A leads; volume cannot conceal low fit.                                                          |
| Limited outlier                      | A: `n=1`, raw 10, adjusted `31/4` (7.75). B: `n=3`, raw 8, adjusted `15/2` (7.5).               | A leads full `bestFit` but B is the overview entry because A is limited.                         |
| Exact adjusted tie                   | A: `n=3`, raw 8, adjusted 7.5. B: `n=6`, raw 7.75, adjusted 7.5.                                | B wins the exact adjusted tie by count.                                                          |
| Vetoed zero evidence                 | A scores `[0,9,9]`; B scores `[6,6,6]`; both raw 6 and adjusted 6.5.                            | Veto remains zero; count also ties, so normalized name then ID decide.                           |
| Beyond display precision             | Choose exact adjusted fractions that both render to the same one-decimal value but are unequal. | Exact rational order wins; web may display equal rounded values without reordering.              |
| Different class priors               | Use identical evidence with class `m` values 2, 3, and 5.                                       | Each class has its independently recomputed value; no cross-class ordering occurs.               |
| Empty comparator                     | `k=0`, no eligible class games.                                                                 | No entities, empty arrays, existing intrinsic result state; payloads with entities are rejected. |
| Reordered input and Unicode ties     | Shuffle games/links; include NFC-equivalent, non-ASCII, and supplementary-code-point names.     | Output is deterministic by normalized code points then numeric entity ID.                        |

The 20-game, raw-8.9 scenario must be calculated from its actual exact fixture values. If 8.9 is repeated 20 times, the entity sum is 178 and the exact adjusted result is `199/23`, approximately `8.652174`, not a rounded estimate used as test input.

## Malformed and regression matrix

Shared and service-boundary tests must reject or preserve behavior for:

- missing, non-finite, or forged `adjustedMeanCurrentFitness`;
- an adjusted number rounded before serialization;
- a formula using a global default instead of the supplied class prior;
- a formula using entity count as an additive bonus;
- a formula that fractionally divides one game among linked entities;
- `bestFit` sorted by raw mean, count, or displayed rounding;
- incorrect exact-tie count, normalized-name, or ID ordering;
- duplicate, missing, extra, or unknown IDs in any ordering;
- a limited entity in `overviewEntityIds`;
- overview IDs copied from `support` or not equal to the supported `bestFit` prefix;
- entities attached to an empty comparator;
- duplicate links from one game, conflicting canonical names, predicted evidence, veto substitution, incomplete metadata, prior ownership, and all existing exclusion reasons;
- old contract 8/algorithm 10 caches, mixed old/current versions, and old `rating` shapes;
- daemon, CLI, or web payloads that disagree with the canonical fixture;
- generated web URLs that retain `order=rating` rather than merely accepting it as input.

## Dependency order

1. Step 1 settles the amended requirements, presentation choices, and target scenarios without changing typed fixtures or production code.
2. Step 2 is one coordinated breaking cutover across shared contract, independent validator, daemon producer, canonical and boundary fixtures, every direct typed consumer, browser fixture, and profile version literals. These pieces must not be merged separately, and the entire workspace must compile and build at the gate.
3. Step 3 depends on the current contract and proves old cache rejection and current cache durability before consumers rely on it.
4. Step 4 updates service-boundary tests after the daemon result is authoritative.
5. Steps 5 and 6 depend on the validated API contract. They may be developed in parallel after Step 4, but both must land before browser fixtures.
6. Step 7 depends on final overview and explorer semantics and validates the real rendered behavior.
7. Step 8 reconciles final user documentation and runs cross-cutting terminal acceptance.

## Research requirement coverage

| Research requirement                                                                     | Implementation steps | Primary evidence                                           |
| ---------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------- |
| Adjusted formula uses entity mean, class comparator, and configured class minimum        | 1, 2                 | Exact shared and daemon scenario tests                     |
| Every drilldown entity receives adjusted fit                                             | 2, 6                 | Complete entity fixture and dossier tests                  |
| `bestFit` exact ordering and deterministic ties                                          | 2                    | Independent order reconstruction and Unicode/tie tests     |
| Count is evidence, shrinkage, support, exact tie, and diagnostic sort only               | 1, 2, 5, 6, 8        | Divergent-order fixtures and language audit                |
| Limited entities remain drilldown-only                                                   | 2, 5, 6, 7           | Limited-outlier overview and explorer tests                |
| Overview is supported `bestFit` prefix capped by class policy                            | 2, 5                 | Shared rejection and rendered membership tests             |
| Mechanics, designers, and artists remain independent                                     | 2, 5, 7              | Different-comparator/prior three-class fixtures            |
| Preserve eligibility, exclusions, veto zero, deduplication, names, and raw evidence      | 2                    | Existing regression suite plus malformed matrix            |
| Prior weight is exposed without ambient defaults                                         | 1, 2, 5, 8           | `entityPolicy` validation and explanatory rendering        |
| Daemon and shared validator recompute independently with exact rationals                 | 2                    | Source review and adversarial payload rejection            |
| Display rounding never controls ordering                                                 | 2, 6, 7              | Beyond-display-precision fixture                           |
| Profile contract and algorithm advance; old snapshots regenerate                         | 2, 3                 | Version and real-filesystem persistence tests              |
| Collection schema and source identity remain unchanged                                   | 3, 8                 | Version/source audit and race regressions                  |
| API and CLI preserve the complete validated result                                       | 4                    | Cross-boundary deep equality and malformed payload tests   |
| Web overview explains adjusted, raw, comparator, and count                               | 5, 7                 | Rendered and browser assertions                            |
| Drilldown count ordering is diagnostic and cannot control overview                       | 6, 7                 | URL/control, supplied-order, and overview invariance tests |
| Accessibility and responsive behavior remain release gates                               | 5, 6, 7              | Component accessibility and Chromium matrix                |
| No representation ranking, hybrid score, fractional allocation, or prevalence correction | 1, 2, 8              | Contract/source/documentation scope audit                  |
| Language remains associative and non-causal                                              | 5, 6, 8              | Visible, accessible, documentation, and snapshot audit     |

## Completion boundary

Implementation is complete only when contract 9/algorithm 11 profiles are produced, independently validated, persisted, passed through, rendered, documented, and exercised in Chromium; every old profile version is regenerated; every scenario and malformed case has discriminating evidence; and no production consumer recomputes ranking.

All eight phases are complete. Terminal acceptance passed 229 focused tests with 902 assertions across 13 files, 2,274 full-suite tests with 1 skip and 9,062 assertions across 127 files, and 86 browser tests with 30 intentional skips and 0 failures across 116 configured tests. Typecheck, browser typecheck, build, changed-file Prettier, and `git diff --check` passed. Strict lint initially found `STEP8-LINT-1` in two route-test assertions; the typed exact-envelope correction then passed repository lint, the 17-test route suite with 43 assertions, typecheck, focused Prettier, and `git diff --check`.

The root format check retains only the accepted baseline exception in `.beads/backup/backup_state.json`, `.beads/export-state.json`, and `.beads/push-state.json`; no feature path or additional path failed. Final review accepted the implementation with no material findings.

Acceptance records two explicit residual risks as non-blocking:

- Validation used Bun 1.3.11 while `package.json` declares Bun 1.4.0, so exact declared-toolchain reproduction remains unproven.
- Profile browser coverage uses a 720x450 CSS viewport at DPR 2 as the 200% zoom equivalent, while the literal Chromium 200% probe directly exercises collection detail rather than the profile page. Equivalent profile reflow and browser assertions made this non-material for acceptance.
