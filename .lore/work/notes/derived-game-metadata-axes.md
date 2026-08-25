---
title: "Implementation notes: derived game-metadata axes"
date: 2026-08-24
status: completed
tags: [implementation, notes, derived-axes, regression]
source: .lore/work/plans/derived-game-metadata-axes.md
modules: [shared, daemon, web, cli]
related: [.lore/work/specs/derived-bgg-axes.md]
---

# Implementation notes: derived game-metadata axes

## Progress

### Plan phase checklist

- [x] Step 1: shared axis union, registry, and curve contract previously completed
- [x] Step 2: registry-derived validation and stable API errors previously completed
- [x] Step 3: collection migration and cache invalidation previously completed
- [x] Step 4: axis services and registry discovery previously completed
- [x] Step 5: fitness resolution and breakdown integration previously completed
- [x] Step 6: canonical feature-vector invariants previously completed
- [x] Step 7: discovery-driven web workflows previously completed
- [x] Step 8: discovery-driven CLI workflows previously completed
- [x] Step 9: implementation complete
- [x] Step 9: testing complete
- [x] Step 9: code review complete
- [x] Step 9: holistic acceptance validation complete
- [x] Step 10: final validation and artifact completion

- [x] Phase 1: additive registry, current-axis contracts, helpers, and numeric curve width
- [x] Phase 2: additive replacement validation schemas and stable validation errors
- [x] Independent test, review, and holistic specification validation

### Runtime cutover

- [x] Phase 1: versioned collection migration, current persisted validation, and recoverable artifact invalidation
- [x] Phase 2: axis services, repair, and registry discovery routes
- [x] Phase 3: derived actual and predicted scoring integration
- [x] Phase 4: canonical feature vectors and runtime consumer cutover
- [x] Phase 5: runtime-wide validation and public alias swap
- [x] Holistic runtime validation: complete with no findings

## Log

- 2026-08-24: Kept `Axis`, `AxisSource`, current schemas, wire breakdowns, and legacy helpers unchanged so daemon consumers remain on their existing contract.
- 2026-08-24: Named the additive union `CurrentAxis`, with `PersonalAxis`, `TournamentAxis`, `DerivedAxis`, and `DisabledLegacyAxis` variants.
- 2026-08-24: Centralized the four supported derived fields, configuration schemas, resolution, scales, templates, summaries, and discovery metadata in `derived-axis-registry.ts`.
- 2026-08-24: Numeric `toleranceWidth` uses independently calibrated left/right exponents, then applies the existing lean multipliers. Categorical tolerance remains unchanged when width is absent.
- 2026-08-24: Focused shared tests passed (155 tests), focused lint and formatting passed, and the root shared/daemon/CLI typecheck passed. Phase 2 validation schemas and stable error codes remain pending by scope.
- 2026-08-24: Phase 1 review found that discovery did not describe dynamic scale binding, the persisted current collection lacked an additive contract, curve math accepted conflicting tolerance forms, and direct registry methods erased field-specific configuration types.
- 2026-08-24: Added machine-readable fixed/configuration-bound scale discovery, `CurrentCollection`, conflict rejection, exact typed direct registry methods with schema-validating generic adapters, and expanded discovery/configuration/player-bound regression coverage.
- 2026-08-24: Review fixes passed all 158 shared tests, root shared/daemon/CLI typechecking, focused lint, formatting, and diff checks.
- 2026-08-24: Added `CurrentCreateAxisSchema`, `CurrentUpdateAxisSchema`, and `LegacyAxisRepairSchema` without changing the existing schemas or input aliases. Tournament creation remains service-managed and is absent from the additive create union.
- 2026-08-24: Kept field/configuration correlation in the registry through `DerivedAxisPayloadSchema`; parse helpers convert Zod failures to `CodedAxisValidationError` with stable codes and field paths rather than requiring message parsing.
- 2026-08-24: Added merged-state update validation against registry native scales. Ordinary updates cannot change source/field, derived cap edits reject incompatible existing ideals, widths, and vetoes, and disabled legacy axes remain disabled unless passed through explicit repair.
- 2026-08-24: Legacy repair accepts field/configuration and replacement common/curve/veto values atomically. A nullable replacement `tolerance` clears categorical tolerance so numeric native-unit width can replace it without an intermediate invalid state.
- 2026-08-24: Phase 2 focused tests passed (16 tests), all shared tests passed (174 tests after Phase 2), root shared/daemon/CLI typechecking passed, and focused lint and formatting passed. Notes remain in progress pending independent test/review and holistic validation.
- 2026-08-24: Phase 2 review found that the stateless update schema prematurely selected an uncorrelated configuration union, configuration error classification duplicated field names in `validation.ts`, numeric tolerance remained usable on non-sweet curves, and additive veto objects were not strict.
- 2026-08-24: Moved configuration validation codes and detail-field metadata onto registry definitions. `validateDerivedAxisPayload` now owns unknown, missing, unsupported, and field-specific invalid results, while `CurrentUpdateAxisSchema` retains opaque configuration until merge with the stored axis establishes field context.
- 2026-08-24: Replacement create/update/repair validation now rejects categorical or numeric tolerance on non-sweet curves and rejects extra veto properties. Legacy create/update schemas retain their permissive nested veto parsing and their existing exported input aliases.
- 2026-08-24: Review corrections passed all 187 shared tests, root shared/daemon/CLI typechecking, focused lint, formatting, and diff checks. Notes remain in progress pending holistic specification validation.
- 2026-08-24: Phase 2 re-review found that categorical tolerance compatibility was over-constrained on non-sweet axes and strict top-level derived-payload keys were misclassified as configuration failures.
- 2026-08-24: Restored persisted categorical tolerance compatibility while retaining numeric-width shape/conflict checks. Registry payload validation now expands strict-schema issue paths first, maps only `configuration` descendants to field-specific codes, and reports extra top-level keys as `invalid_axis_payload` with their exact path.
- 2026-08-24: Re-review corrections passed all 188 shared tests, root shared/daemon/CLI typechecking, focused lint, formatting, and diff checks.
- 2026-08-24: Final holistic validation completed with 188 shared tests passing; the full suite passing 1,380 tests with 1 skipped; typecheck, lint, build, and `git diff --check` passing; and changed-file Prettier checks passing. Root `format:check` still fails on 45 pre-existing unrelated files, with no changed file among the failures.
- 2026-08-24: Final bead-scoped review found no remaining findings. Runtime cutover still owns collection migration, daemon/API adoption of the additive contracts, scoring integration, canonical feature-vector filtering, and downstream web/CLI integration under the subsequent plan steps.
- 2026-08-24: Runtime Phase 1 added strict additive persisted schemas and schema version 1 without replacing the public `Axis` or `Collection` aliases. The pure version-0-to-1 migration preserves known BGG scoring fields and rating IDs, snapshots unknown or malformed axes as disabled legacy data, backfills all three historical game fields, and inserts Tournament idempotently.
- 2026-08-24: Collection-schema artifacts now use one ordered descriptor manifest. Profile deletion and wishlist prediction clearing run before collection persistence; wishlist corruption is quarantined copy-first with deterministic injectable collision naming, core-entry salvage, atomic active-file replacement, and retry-safe invalid JSON removal.
- 2026-08-24: Phase 1 review fixes separated persisted structural curve validation from mutation semantics, preserved unknown wishlist user fields, removed legacy collection saves, added no-clobber quarantine claims, made atomic temp writes unique and self-cleaning, refactored migration into ordered version descriptors, and added read/parse/migrate/validate/quarantine failure logs.
- 2026-08-24: Final Runtime Phase 1 focused validation passed 75 tests with 394 assertions across persisted schemas, ordered migration, atomic file operations, artifacts/recovery, storage, and historical backfills. Shared typechecking and changed-file lint/format/diff checks passed. Daemon-wide typechecking remains intentionally blocked at the additive `CurrentCollection` storage boundary until the later axis/scoring/vector runtime phases consume `CurrentAxis`; no compatibility cast or premature public alias swap was added.
- 2026-08-24: Runtime Phase 2 moved axis create/list/update/delete to `CurrentCollection` and `CurrentAxis`, registry-backed parsing, immutable persistence attempts, duplicate-permitted derived fields, merged cap/curve validation, and service-managed Tournament protections. Disabled legacy axes remain listable/deletable, ordinary updates reject them, and explicit repair preserves IDs, common values, timestamps, and every stored rating atomically.
- 2026-08-24: Added versioned registry-only derived-field discovery at `GET /api/axes/derived-fields`, explicit `POST /api/axes/:id/repair`, help metadata for both operations, structured coded validation responses, and stable Tournament/disabled-axis codes. Axis mutation logs now cover attempts, targets, outcomes, validation codes/details, configuration keys, and persistence failures with source/field context.
- 2026-08-24: Runtime Phase 2 focused validation passed 29 axis service/route/help/disabled-rating tests and 66 shared registry/current-validation/migration regression tests. Changed-file lint, formatting, and diff checks passed, as did shared typechecking. Daemon typechecking remains blocked only at later runtime-cutover boundaries where scoring, prediction, profile, capacity, and their legacy collection fixtures still consume `Axis[]`/`Collection`; Phase 2 added no compatibility casts or fitness/vector/profile behavior.
- 2026-08-24: Phase 2 coverage follow-up converted the focused game-service axis fixtures to explicit current personal axes, added route success for all four derived templates and disabled-axis DELETE, asserted repair preservation for every common curve/veto property and two games' complete rating maps, checked help descriptions/request schemas, and strengthened mutation log context assertions. All 40 axis/route/help tests, four focused disabled/invalid-rating tests, and all 66 migration regressions pass. The full 27-test game-service file now has 20 passing tests and exactly seven expected Step 5 failures: the score-returning `getGame` pair, `listGames`, and four successful rating/clearing cases all reach legacy fitness, which throws `Unknown BGG field: undefined` on current derived defaults. No stale create payload or unrelated shelf assertion remains among those failures.
- 2026-08-24: Phase 2 review fixes marked repair non-idempotent in operation/help metadata and pinned the repeated-repair rejection, made every discovery call clone template configuration, configuration descriptors, native-scale discovery, and native-scale values, and added terminal `reason=not_found` logs for update/repair/delete misses. Focused validation passed 17 shared registry tests and 41 axis service/route/help tests; shared typechecking, changed-file lint/format, and diff checks passed.
- 2026-08-24: Runtime Phase 3 moved fitness to `Game` plus `CurrentAxis[]`, filters enabled scoring axes once, resolves all derived values through the registry, applies dynamic native scales, numeric tolerance widths, curves, and vetoes to scoring values, and emits generalized factual/effective breakdown metadata. Overrides retain available facts, invent none when metadata is absent, use the personal 1-10 scale, and bypass derived vetoes while preserving configured curve behavior.
- 2026-08-24: Prediction now treats derived values as deterministic actual inputs, predicts only personal and Tournament axes, excludes disabled legacy axes from rows/counts/weights/coverage/confidence/early completion/readiness, and gives missing derived fallbacks the same registry metadata as actual rows. Prediction vector calls use the existing vector-eligible seam so derived and disabled axes cannot enter the legacy encoder before Phase 4 replaces its contract.
- 2026-08-24: Added additive `CurrentFitnessResult`, `CurrentGameWithScore`, and `CurrentPredictedGameResponse` without swapping the public aliases. Game service score/get/list/rating flows, prediction service/routes, score routes, BGG refresh overrides, and wishlist snapshot extraction now consume current effective breakdown values. Focused Phase 3 and Phase 1-2 regression validation passes; remaining daemon type errors are isolated to Phase 4 feature-vector and niche/profile/redundancy/capacity consumers plus their stale fixtures.
- 2026-08-24: Corrected the Phase 3 test-coverage regression instead of accepting reduced replacement suites. Restored the deleted root fitness regression file with 43 current-contract declarations, expanded prediction-engine coverage from 11 to 55 declarations, retained the Phase 3 derived/disabled cases, added independent legacy-before/current-after result equality across ordinary, override, and veto paths, and asserted the complete derived breakdown contract through the prediction HTTP route.
- 2026-08-24: Phase 3 review fixes made personal overrides of derived axes authoritative effective 1-10 ratings: they retain available factual source/scoring values but bypass derived curves and vetoes, contribute the override directly, and never report curve impact. Fully-actual prediction early returns now label every actual row, including deterministic derived rows, with `predictionConfidence: "actual"`. Migration regression coverage now pins expected community-rating/weight outputs, contributions, override behavior, veto hypothetical scores, and migrated field/configuration mappings instead of comparing two calls through the current scorer.
- 2026-08-24: User-approved Phase 3 divergence preserves legacy override curves only when their configuration is valid on the personal 1-10 scale. A shared curve-applicability validator now drives both mutation validation and scoring classification. Valid community/weight curves transform personal overrides and report curve impact as before; native-unit settings that cannot apply to 1-10, such as Play Time ideal 90 with width 30, use the override directly without clamping or reinterpreting minutes. Both branches continue to bypass derived vetoes and retain factual native values when available. This supersedes the prior review note's blanket direct-override rule.
- 2026-08-24: Runtime Phase 4 made the collection-ordered personal/Tournament schema mandatory at every feature-vector encoding call. Derived and disabled axes allocate no slots; missing eligible values use midpoint; available Tournament normalization is projected consistently in prediction, profile/outlier, redundancy, and capacity; and factual dimensions remain exactly weight, community rating, minPlayers, maxPlayers, and uncapped published playingTime.
- 2026-08-24: Feature-vector boundaries now sanitize non-finite facts and axis values, assert exact dimensions and finite output, and reject cosine dimension mismatches. Prediction, game/prediction previews, profile, redundancy, capacity, niche, narration, wishlist, and Tournament seams consume current collection/axis/result containers without performing the deferred shared alias or broad web/CLI cutover.
- 2026-08-24: Profile computation now excludes disabled axes from distributions, weights, curves, and coverage; derives distributions exclusively from fitness-breakdown effective ratings; uses registry IDs for duplicate-safe derived coverage; and declares derived field, native scale, unit, provenance, configuration summary, and numeric tolerance width on utility curves.
- 2026-08-24: Runtime Phase 4 validation passed root shared/daemon/CLI typechecking, repository lint, and the complete 1,431-test suite with 1,430 passing and 1 skipped. The daemon has no remaining typecheck exception; the final public shared alias/export swap and broad web/CLI fixture cutover remain intentionally deferred to Phase 5 and later client steps.
- 2026-08-24: Independent Phase 4 testing fixes made every distance primitive reject NaN and positive/negative infinity with deterministic vector/index/value errors after dimension validation; added prediction-service integration with `playerCountFit` and capped `playingTime` together to pin deterministic actual metadata, unchanged vector shape and personal prediction behavior, finite numeric output, repeatability, and lossless JSON serialization; and restored all four legacy rounding boundaries plus independent cohort-floor and null/omitted Tournament-data behavior after auditing both fitness suites against `HEAD`. Focused vector/prediction/fitness validation passed 230 tests, and the full suite passed 1,447 tests with 1 skipped. Typecheck, lint, changed-file formatting, and diff checks pass; root `format:check` remains blocked only by 44 pre-existing unrelated files.
- 2026-08-24: Follow-up Phase 4 review restored `CollectionProfile.ratedGameCount` to count each game once only when it has a stored user rating on an enabled personal axis or an enabled derived-axis override; automatic derived/Tournament values and disabled legacy ratings do not count. High-variance suggestions now consume registry-owned candidate metadata and value projections through one helper plus duplicate-safe enabled-derived coverage, with an exhaustiveness test tying every current registry field to exactly one projection. Focused profile/vector/prediction regressions passed 229 tests, and the full suite passed 1,452 tests with 1 skipped. Public alias replacement remains deferred to Phase 5.
- 2026-08-24: Final Phase 4 review moved fresh-collection derived-axis inclusion into required registry metadata: Community Rating and Complexity are included, while Player Count Fit and Play Time remain opt-in. A shared registry projection now materializes IDs, template names/descriptions/weights, curve settings, and validated configurations in registry order; storage supplies only IDs/timestamps and appends Tournament, with no derived field or template literals. The inclusion policy remains server-internal and does not alter client discovery. Focused shared registry/storage/profile regressions passed 100 tests, and the full suite passed 1,454 tests with 1 skipped.
- 2026-08-24: Runtime Phase 5 completed the atomic public cutover. `Axis`, `AxisSource`, `Collection`, fitness breakdown/result types, response containers, axis schemas, and persisted collection schema now name the canonical registry-backed contracts; production daemon consumers and fixtures use those names directly. Former persisted axis/collection input shapes exist only as unknown-safe daemon migration schemas, with no competing shared legacy fitness or response graph.
- 2026-08-24: Removed production BGG axis resolution and native-scale exports. `resolveAxisValues` is game-aware, registry-driven, override-first, and disabled-safe; curve math has no field switch. Existing web and CLI surfaces compile against generalized derived metadata and effective breakdown fields while discovery-driven creation, configuration, and repair workflows remain scoped to beads `.7` and `.8`.
- 2026-08-24: Final Phase 5 validation passed root typecheck, repository lint, 1,456 tests with 1 skipped, the production web build, changed-file Prettier checks, and `git diff --check`. Source audits found no transitional `Current*` runtime contracts, BGG-specific resolver/native-scale calls, client `bggField`/`bggOriginal`/`source: "bgg"` assumptions, or production derived-ID switches outside the shared registry and daemon migration parser. Root `format:check` remains blocked by 42 pre-existing unrelated files; every changed file passes. Notes stay `in_progress` pending the requested holistic validation and review, and the plan/spec statuses remain unchanged.
- 2026-08-24: Independent Phase 5 review found three residual cutover issues: shared still exported the old persisted `LegacyAxisSource`, `LegacyAxis`, and `LegacyCollection` shapes; the axes page included disabled legacy weight in its total and percentages; and daemon startup documentation still named the removed `ensureTournamentAxis` entry point.
- 2026-08-24: Review fixes removed persisted legacy model declarations and exports from shared, leaving unknown-safe legacy source/field parsing local to `collection-migration.ts`; added compile-time and source-level shared export audits; made web totals and percentages enabled-only while retaining disabled cards and deletion; added focused enabled-plus-disabled rendering coverage; and updated startup documentation to describe versioned migration and artifact invalidation.
- 2026-08-24: Phase 5 review corrections passed 56 shared audit/validation tests, 36 daemon migration/storage tests, 74 focused web tests, root typecheck and lint, the full 1,460-test suite with 1 skipped, the production web build, changed-file formatting, and `git diff --check`. Final searches found no shared persisted-legacy model declarations/exports and no stale `ensureTournamentAxis` references.
- 2026-08-24: Final Phase 5 review found three remaining presentation and ownership issues: the existing web editor discarded numeric `toleranceWidth` during unrelated edits, payload validation and axis creation independently enumerated every derived field outside the registry, and stage-zero CLI output mislabeled all available-data scoring as BGG-derived.
- 2026-08-24: Final review fixes added lossless numeric-width editor state/serialization plus a minimal native-unit input, made registry definitions generate correlated payload validation and creation dispatch with no second field list or switch, added automatic-participation and source audits, and renamed stage-zero output to `Available-data score`. Discovery-driven Play Time creation/configuration remains deferred to `.7` and `.8`.
- 2026-08-24: Final review validation passed 126 focused shared registry/validation tests, four focused web axis tests, 16 CLI prediction tests, root typecheck and lint, the full 1,465-test suite with 1 skipped, the production web build, changed-file formatting, and `git diff --check`. Final audits found no independent payload discriminated union or creation switch and no production `BGG-derived score` label.
- 2026-08-24: A final web wording follow-up found the stage-zero search preview still rendered `BGG-derived score` after the CLI had moved to generic terminology. The preview now renders `Available-data score`, with focused page coverage and a production-wide source audit preventing the obsolete score wording from returning.
- 2026-08-24: The web wording follow-up passed its two focused tests with 119 assertions across 117 production TypeScript files, root typecheck and lint, the full 1,468-test suite with 1 skipped, the production web build, changed-file formatting, and `git diff --check`.
- 2026-08-24: Final holistic validation for `shelf-judge-2bb.6` found no remaining issues. Root typecheck, lint, and production build passed; full tests completed with 1,467 passing and 1 skipped; test declarations increased to 1,433 from 1,381 at `HEAD`; all changed files passed Prettier and `git diff --check`; and root `format:check` fails only for the unchanged 42-file baseline. The approved override divergence remains: valid community/weight curves apply to personal overrides, while native-unit configurations incompatible with the personal 1-10 scale use the override directly; both paths bypass derived vetoes and retain available factual values. Discovery-driven client creation, configuration, and repair workflows remain in the residual scope of `.7` and `.8`. All runtime phases and holistic validation are complete.

## Step 7 web progress

- [x] Discovery-driven personal and derived template creation
- [x] Generic derived configuration and native-unit curve editing
- [x] Disabled legacy repair and deletion workflows
- [x] Derived override, breakdown, and profile presentation
- [x] Focused web tests, lint, formatting, and diff checks
- [x] Step 8 CLI workflows
- [x] Step 9 cross-package regression implementation
- [x] Step 9 testing and review
- [x] Step 10 final broad validation

## Step 7 implementation log

- 2026-08-24: Added a typed web adapter for discovery template drafts, configuration-bound native scales, derived create payloads, and structured validation errors.
- 2026-08-24: Axis management now fetches `/api/daemon/axes/derived-fields`, renders personal creation plus every discovered derived template, keeps duplicate creation unrestricted, and has no production derived-field ID list.
- 2026-08-24: Generic integer configuration controls use discovered requirements, defaults, and bounds. Derived updates and repairs submit configuration, curve, numeric tolerance, and veto atomically, with minute-aware controls and live configuration-bound scales.
- 2026-08-24: Disabled legacy cards show reason, preserved identifier/payload, retained override count and warning, discovery-driven repair controls, and deletion.
- 2026-08-24: Rating cards resolve factual and effective display values from score breakdowns while `game.ratings` remains the editable 1-10 override store. Clears use `null`; stored override and effective rating are labeled separately to preserve the approved curve-compatible override semantics.
- 2026-08-24: Breakdown rows distinguish published facts, capped scoring inputs, effective ratings, overrides, units, provenance, and configuration. Essential details stay in the first table column on mobile.
- 2026-08-24: Profile histograms explicitly identify effective 1-10 ratings. Utility declarations show native scale, unit, provenance, configuration, and numeric tolerance width. Disabled legacy axes no longer appear in collection sort choices.
- 2026-08-24: Focused web validation passed 96 tests with 194 assertions. Changed-file ESLint, Prettier, and `git diff --check` passed. The web TypeScript project still reports pre-existing Bun-global configuration and stale fixture errors; no changed production web errors remained. Broad final validation was intentionally not run.
- 2026-08-24: Step 7 validation exposed a legacy breakdown regression in `game-links.test.tsx`: omitted derived metadata passed null-only presence checks, causing `formatValue` to call `toFixed` on `undefined`. Corrected factual and scoring-input checks to treat both `null` and omission as absent while preserving zero-valued facts, and added focused legacy/zero-value regression coverage. The formerly failing test and all 15 score-breakdown tests pass; changed-file ESLint, Prettier, and diff checks pass.
- 2026-08-24: Step 7 review corrections restrict rating drafts, validation, submission, and null-clearing to enabled personal and derived axes, so preserved disabled legacy ratings never re-enter mutation payloads. Derived Override now rounds fractional effective ratings to the nearest integer, with half values rounding upward and the result clamped to 1-10; existing stored overrides remain displayed unchanged.
- 2026-08-24: Structured `idealValue`, `toleranceWidth`, and veto-threshold errors now render beside their controls in create, derived-update, and legacy-repair forms while the summary banner remains. Veto labels and hints use the discovered native unit, including minutes for Play Time, without field-ID branching.
- 2026-08-24: Replaced rating and management source-inspection acceptance tests with rendered production-component and interaction coverage for disabled legacy exclusion, fractional override submission, supported null clearing, derived update and legacy repair controls/actions, structured errors, and discovery-provided units. Focused validation passed 28 tests with 86 assertions; changed-file ESLint, Prettier, production web build, and `git diff --check` passed. The standalone web TypeScript command remains blocked by its documented Bun-global and stale-fixture baseline; the production build TypeScript check passes.
- 2026-08-24: Step 7 re-review corrections route create, newly enabled update, and every veto-bearing legacy repair through one explicit confirmation with the selected discovery field's native unit. Confirmed repairs proceed and cancelled repairs cannot invoke the repair request callback. Persisted ideal/veto summaries now include the discovery unit without derived-field branching.
- 2026-08-24: Rating-form derived facts now render the breakdown-owned configuration summary alongside provenance, exposing Player Count Fit targets and Play Time scoring caps. Rendered tests pin both configurations/provenances, unit-bearing persisted summaries and confirmations, and confirmed/cancelled repair interactions.
- 2026-08-24: Re-review validation passed 32 focused web tests with 97 assertions, changed-file ESLint and Prettier checks, the production web build including TypeScript, and `git diff --check`. A final source audit confirmed create, update, and repair all use the shared unit-aware veto confirmation and no bare confirmation wording remains.
- 2026-08-24: The user explicitly authorized one additional full correction cycle for `shelf-judge-2bb.7` and required every final review finding to be resolved without closing the bead, committing, pushing, or modifying unrelated `.beads` changes.
- 2026-08-24: Veto banners and profile curve declarations now qualify native source, threshold, and ideal values through generic unit-aware formatting while preserving unitless output. Derived Override and Clear override controls are native buttons with the existing visual treatment.
- 2026-08-24: Axis management now exposes template selection with `aria-pressed` and gives create, edit, and repair controls context-stable IDs. Structured configuration, ideal, tolerance-width, and veto errors set `aria-invalid` and point to their rendered messages with `aria-describedby`.
- 2026-08-24: Added stateful tests around the production `AxesPage` discovery and request workflows. Coverage creates Player Count Fit twice at both target boundaries, creates Play Time at its cap boundary, updates both fields, repairs and deletes legacy data, checks structured server errors, and asserts request bodies rather than source text.
- 2026-08-24: Expanded rendered `RatingForm` interaction coverage for Player Count Fit and Play Time through override entry, mutation, persisted display, and null clearing. The Player Count Fit case submits successfully with missing factual metadata, and both semantic button actions are exercised through their rendered click handlers.
- 2026-08-24: Added browser-free responsive smoke coverage that renders the production game-detail shell and verifies its responsive structure plus the existing game-detail and axes media-query contracts. The repository has no DOM viewport or browser runner, so pixel layout, overflow, focus traversal, and actual mobile/desktop viewport behavior remain an explicit environmental residual rather than a claimed browser verification.
- 2026-08-24: Final correction validation passed 39 focused web tests with 143 assertions, root typecheck and lint, the full suite with 1,491 passing and 1 skipped, the production Next.js build including TypeScript, changed-file Prettier checks, and `git diff --check`. The bead remains open and no commit, push, Beads sync, or unrelated `.beads` edit was performed, as explicitly required.
- 2026-08-24: Final review follow-up clears shared structured form errors at every create, edit, and repair start, cancel, selection, and submission boundary. A rendered interaction regression now rejects a create request, opens the derived editor with the same configuration field, and verifies that neither the summary nor field-level accessibility error state leaks into the edit workflow.
- 2026-08-24: The final review follow-up passed all 5 rendered axis workflow tests with 21 assertions, changed-file ESLint and Prettier checks, the production Next.js build including TypeScript, and `git diff --check`.
- 2026-08-24: Replaced the shared axis-management error fields and mutation banner with form errors keyed by `create`, `update:<axisId>`, and `repair:<axisId>`. Every create, personal/derived/Tournament update, and legacy repair form now receives only its own summary and structured field map, so concurrent forms cannot consume another request's response while server and network fallback summaries remain local and visible.
- 2026-08-24: Each form scope now has a monotonic request generation. Submission, cancellation, template/repair-field selection, axis switching, and success invalidate the relevant generation; late responses check their captured generation before setting errors, closing a form, or reloading data. This prevents a cancelled request from repopulating the same scope after reopening, rather than relying on transition resets.
- 2026-08-24: Added deferred-response regressions for late create-to-edit isolation, cancelled update reopening, and out-of-order update/repair failures with distinct structured fields and summaries. Focused axis validation passed 18 tests with 73 assertions; repository lint and shared/daemon/CLI typechecking passed; changed-file Prettier passed; and the production Next.js build passed its TypeScript gate.

## Step 9 implementation log

- 2026-08-24: Added `packages/daemon/tests/fixtures/persisted-derived-axis-migration.json` and a persisted HTTP integration flow covering known Community Rating/Complexity migration, unknown and malformed disabled axes, retained ratings and override behavior, profile deletion, wishlist prediction clearing, discovery, repair, and write-free idempotent reload.
- 2026-08-24: Pinned the migrated score at 6.4: Community Rating uses the retained override of 7 at weight 60, while Complexity retains lower-is-better behavior and maps raw weight 3 to 5.5 at weight 40.
- 2026-08-24: Extended the existing Wingspan parser fixture coverage for both metadata parser APIs. Player bounds and singular `playingTime` remain, while exact returned metadata keys exclude minimum and maximum duration fields present in the XML.
- 2026-08-24: Added a production-source ownership audit for derived-field dispatch and template lists. It permits the shared registry, migration boundary, closed field-ID type declaration, and only the exact canonical factual-vector declaration.
- 2026-08-24: Inspected remaining legacy-shape matches. Production legacy parsing remains confined to `collection-migration.ts`; other matches are explicit migration tests or disabled-legacy presentation fixtures, so no runtime fixtures were converted.
- 2026-08-24: Per implementation-agent scope, tests, lint, typecheck, build, and code review were not run. Step 9 validation and independent review remain pending, and Step 10 remains unstarted.

## Step 9 testing log

- 2026-08-24: PASS, 21 tests across three files with 220 assertions:

  ```text
  bun test packages/daemon/tests/integration/end-to-end.test.ts packages/daemon/tests/services/bgg-xml-parser.test.ts packages/shared/tests/derived-field-source-audit.test.ts
  ```

- 2026-08-24: PASS, 404 tests across 20 existing tournament, prediction, profile, redundancy, wishlist, and capacity regression files with 1,132 assertions:

  ```text
  bun test packages/daemon/tests/tournament-service.test.ts packages/daemon/tests/tournament-migration.test.ts packages/daemon/tests/services/prediction-engine-tournament.test.ts packages/daemon/tests/routes/tournament.test.ts packages/cli/tests/commands/tournament.test.ts packages/daemon/tests/services/prediction-service.test.ts packages/daemon/tests/services/prediction-engine.test.ts packages/daemon/tests/routes/prediction.test.ts packages/daemon/tests/profile-stale-detection.test.ts packages/daemon/tests/profile-service.test.ts packages/daemon/tests/profile-engine.test.ts packages/daemon/tests/routes/profile.test.ts packages/daemon/tests/routes/profile-narrate.test.ts packages/cli/tests/commands/profile.test.ts packages/daemon/tests/redundancy-settings-routes.test.ts packages/daemon/tests/redundancy-integration.test.ts packages/daemon/tests/redundancy-engine.test.ts packages/daemon/tests/wishlist-service.test.ts packages/daemon/tests/wishlist-routes.test.ts packages/daemon/tests/capacity-service.test.ts
  ```

- 2026-08-24: PASS, root shared/daemon/CLI TypeScript check: `bun run typecheck`.
- 2026-08-24: PASS, repository ESLint: `bun run lint`.
- 2026-08-24: PASS, whitespace/error-marker check: `git diff --check`.
- 2026-08-24: FAIL, changed-file formatting:

  ```text
  bunx prettier --check .beads/issues.jsonl .lore/work/notes/derived-game-metadata-axes.md packages/daemon/tests/integration/end-to-end.test.ts packages/daemon/tests/services/bgg-xml-parser.test.ts packages/daemon/tests/fixtures/persisted-derived-axis-migration.json packages/shared/tests/derived-field-source-audit.test.ts
  ```

  Prettier cannot infer a parser for `.beads/issues.jsonl`. Re-running the supported changed files without that JSONL file also fails only for `packages/daemon/tests/integration/end-to-end.test.ts` and `packages/shared/tests/derived-field-source-audit.test.ts`:

  ```text
  bunx prettier --check .lore/work/notes/derived-game-metadata-axes.md packages/daemon/tests/integration/end-to-end.test.ts packages/daemon/tests/services/bgg-xml-parser.test.ts packages/daemon/tests/fixtures/persisted-derived-axis-migration.json packages/shared/tests/derived-field-source-audit.test.ts
  ```

  Actionable formatting differences begin at `packages/daemon/tests/integration/end-to-end.test.ts:677` and `packages/daemon/tests/integration/end-to-end.test.ts:718`, where Prettier compacts two `jsonRequest` calls, and at `packages/shared/tests/derived-field-source-audit.test.ts:38` and `packages/shared/tests/derived-field-source-audit.test.ts:45`, where Prettier reflows the assertion and conditional. No implementation or test files were edited by the testing agent. Step 9 remains `in_progress`, with review pending.

- 2026-08-24: Applied only the reported Prettier layout corrections in the persisted integration and production-source audit tests. Behavior was unchanged, and the correction awaited re-verification.

- 2026-08-24: PASS on formatting rerun for all parser-supported changed Markdown, JSON, and TypeScript files. Passing tests, typecheck, and lint were not rerun:

  ```text
  bunx prettier --check .lore/work/notes/derived-game-metadata-axes.md packages/daemon/tests/integration/end-to-end.test.ts packages/daemon/tests/services/bgg-xml-parser.test.ts packages/daemon/tests/fixtures/persisted-derived-axis-migration.json packages/shared/tests/derived-field-source-audit.test.ts
  ```

  Output: `All matched files use Prettier code style!` This recheck verified the preceding formatting correction. Step 9 remains `in_progress`.

## Step 9 review correction log

- 2026-08-24: Addressed all five review findings: replaced the source grep with AST-based concrete-ID and callable-dispatch auditing plus narrow type/vector boundary assertions; strengthened repaired-axis durability and idempotence assertions; made the profile cache a valid stale `ProfileData`; made parser scope assertions property-specific; and corrected this log's chronology. Testing and re-review of these corrections remain pending.

- 2026-08-24: FAIL, review-correction verification. Step 9 remains `in_progress`, with re-review pending. No implementation or test files were edited by the testing agent.

  Focused command:

  ```text
  bun test packages/daemon/tests/integration/end-to-end.test.ts packages/daemon/tests/services/bgg-xml-parser.test.ts packages/shared/tests/derived-field-source-audit.test.ts
  ```

  Result: 21 passed and 1 failed across three files with 244 assertions. `packages/shared/tests/derived-field-source-audit.test.ts:199` expected no violations but received `packages/cli/src/index.ts:286 unquoted derived-field dispatch`. The flagged node is the ordinary shorthand `weight` return property at `packages/cli/src/index.ts:286`, so the audit's identifier classification must distinguish that non-derived-field property from actual derived-field dispatch.

  Root typecheck command: `bun run typecheck`.

  Result: FAIL with `TS2769` at `packages/shared/tests/derived-field-source-audit.test.ts:129` and `packages/shared/tests/derived-field-source-audit.test.ts:141`. Both assertions pass the readonly `derivedFieldIds` tuple to an expectation inferred as a mutable `(string | null)[]`; align the compared array types without weakening the audit.

  Root lint command: `bun run lint`.

  Result: PASS with no diagnostics.

  Whitespace command: `git diff --check`.

  Result: PASS with no diagnostics.

  Changed-file formatting command, excluding `.beads/issues.jsonl`:

  ```text
  bunx prettier --check .lore/work/notes/derived-game-metadata-axes.md packages/daemon/tests/integration/end-to-end.test.ts packages/daemon/tests/services/bgg-xml-parser.test.ts packages/daemon/tests/fixtures/persisted-derived-axis-migration.json packages/shared/tests/derived-field-source-audit.test.ts
  ```

  Result: FAIL only for `packages/shared/tests/derived-field-source-audit.test.ts`. Prettier differences begin at lines 30, 71, 76, and 179, reflowing the `AuditDeclaration` union, two long conditionals, and the concrete-ID diagnostic push. Apply Prettier formatting to that file, then rerun these affected gates. Unaffected broad regression suites were not rerun.

- 2026-08-24: Corrected the verification diagnostics without weakening ownership checks: ordinary domain `weight` properties now require derived/template/dispatch AST context before classification, readonly expected field IDs are compared as mutable copies, and the reported Prettier layout was applied manually. Verification of this correction was pending at this point.

- 2026-08-24: PASS, rerun of only the three previously failed gates, superseding the preceding pending-verification statement. Step 9 remains `in_progress`, with re-review pending. No implementation or test files were edited by the testing agent.

  ```text
  bun test packages/shared/tests/derived-field-source-audit.test.ts
  ```

  Result: 2 passed, 0 failed, with 6 assertions across one file.

  ```text
  bun run typecheck
  ```

  Result: PASS for the root shared, daemon, and CLI TypeScript projects.

  ```text
  bunx prettier --check .lore/work/notes/derived-game-metadata-axes.md packages/daemon/tests/integration/end-to-end.test.ts packages/daemon/tests/services/bgg-xml-parser.test.ts packages/daemon/tests/fixtures/persisted-derived-axis-migration.json packages/shared/tests/derived-field-source-audit.test.ts
  ```

  Result: PASS, `All matched files use Prettier code style!` Previously passing daemon focused tests, lint, and `git diff --check` were not rerun. Implementation and testing corrections were therefore verified.

- 2026-08-24: Addressed the final re-review findings. Callable resolver/handler factory entries are now classified as behavior dispatch; repaired axes receive the injected mutation timestamp while retaining `createdAt` and common settings; service and persisted-flow assertions pin the new timestamp semantics. This final production/audit correction awaits focused verification and re-review.

- 2026-08-24: Final focused verification and holistic acceptance validation passed, and the final re-review reported no findings. Step 9 implementation, testing, and code review are complete. Residual risk remains that the persisted migration flow uses the in-memory mocked filesystem, so real filesystem permissions, durability, and platform-specific atomic rename behavior remain for Step 10 validation. This notes document remains `in_progress`; Step 10 is pending, and the plan/spec statuses are unchanged.

- 2026-08-24: PASS, focused verification of the final corrections. Step 9 remains `in_progress`, with re-review pending. No implementation or test files were edited by the testing agent, and unaffected broad suites were not rerun.

  ```text
  bun test packages/shared/tests/derived-field-source-audit.test.ts packages/daemon/tests/services/axis-service.test.ts packages/daemon/tests/integration/end-to-end.test.ts
  ```

  Result: 23 passed, 0 failed, with 198 assertions across three files. The expected injected `disk full` failure-path log from `axis-service.test.ts:309` was emitted while its rollback test passed.

  ```text
  bun run typecheck
  ```

  Result: PASS for the root shared, daemon, and CLI TypeScript projects.

  ```text
  bun run lint
  ```

  Result: PASS with no diagnostics.

  ```text
  git diff --check
  ```

  Result: PASS with no diagnostics.

  Changed-file formatting command, excluding `.beads/issues.jsonl`:

  ```text
  bunx prettier --check .lore/work/notes/derived-game-metadata-axes.md packages/daemon/src/services/axis-service.ts packages/daemon/tests/integration/end-to-end.test.ts packages/daemon/tests/services/axis-service.test.ts packages/daemon/tests/services/bgg-xml-parser.test.ts packages/daemon/tests/fixtures/persisted-derived-axis-migration.json packages/shared/tests/derived-field-source-audit.test.ts
  ```

  Result: PASS, `All matched files use Prettier code style!`

## Step 10 final validation record

- Quality gates: `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run test`, and `bun run build` pass. The final full suite has 1,531 passing tests and 1 skipped test, including the real-filesystem migration case.
- AI Validation 1: the five repository quality gates above provide the required broad evidence.
- AI Validation 2: `packages/shared/tests/current-axis-validation.test.ts` and `packages/shared/tests/derived-axis-registry.test.ts` cover all four IDs, unknown IDs, required configuration, integer and adjacent target/cap boundaries, and merged curve validation.
- AI Validation 3: `packages/daemon/tests/services/fitness-service.test.ts`, `packages/daemon/tests/services/collection-migration.test.ts`, and `packages/daemon/tests/integration/end-to-end.test.ts` pin Community Rating and Complexity migration equivalence, curves, weights, vetoes, and overrides.
- AI Validation 4: `packages/shared/tests/derived-axis-registry.test.ts` and `packages/daemon/tests/services/fitness-service.test.ts` cover exact, inclusive, centered, off-center, out-of-range, clamped, malformed, and missing player ranges.
- AI Validation 5: shared resolver, daemon fitness, feature-vector, prediction-service, web breakdown, and CLI output tests cover normal/missing/capped play time, dynamic caps, denominator behavior, published uncapped vector input, and published-versus-capped display.
- AI Validation 6: daemon axis routes/storage defaults, web axis workflows/rating forms, and CLI axis command/help tests cover discovery, duplicate creation, editing, actionable errors, overrides, and absence of the optional templates from fresh collections. Final validation corrected CLI Play Time creation to apply the discovered 240-minute default.
- AI Validation 7: `packages/daemon/tests/integration/end-to-end.test.ts` covers the complete persisted legacy fixture. `packages/daemon/tests/services/storage-collection-migration.test.ts` additionally performs migration, profile deletion, wishlist clearing, atomic persistence, current-schema reload, and byte-stable idempotent reload through the host filesystem with isolated temporary data.
- AI Validation 8: `packages/daemon/tests/feature-vector.test.ts` pins exact factual names, ordering, dimensions, eligible axis slots, uncapped time, and finite values. Prediction-service, profile-engine, redundancy-integration, and capacity-service tests execute their consumer paths with materially different Player Count Fit and Play Time facts and prove unchanged results with derived axes removed.
- REQ-DERIVED-1 through REQ-DERIVED-22 were reviewed against the plan's requirement-coverage table and implementation. Final corrections preserve the numeric personal override separately from its curved effective rating, expose complete CLI help, apply discovery defaults, and strengthen consumer-specific vector regressions.
- Daemon help coverage is in `packages/daemon/tests/routes/help.test.ts`; CLI templates/create/update/repair help coverage is in `packages/cli/tests/commands/help.test.ts`.
- Final independent diff review reported no semantic regressions or accidental destructive formatting changes. The plan is `executed` and the source specification is `implemented` only after this evidence and all gates passed.
