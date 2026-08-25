---
title: "Implementation plan: derived game-metadata axes"
date: 2026-08-24
status: executed
tags: [plan, fitness, derived-axes, bgg, migration, feature-vectors]
modules: [shared, daemon, web, cli]
related:
  - .lore/work/specs/derived-bgg-axes.md
  - .lore/specs/fitness/utility-curves.md
  - .lore/specs/collection/collection-profiling.md
  - .lore/specs/fitness/prediction-engine.md
  - .lore/specs/fitness/redundancy-scoring.md
  - .lore/specs/features/wishlist.md
  - .lore/specs/features/shelf-capacity.md
  - .lore/specs/tournament/elo-axis-source.md
---

# Implementation plan: derived game-metadata axes

## Goal

Implement `.lore/work/specs/derived-bgg-axes.md` (REQ-DERIVED-1 through REQ-DERIVED-22): replace the BGG-specific axis contract with a registry-backed derived-axis model, add optional Player Count Fit and Play Time templates, migrate existing collections safely, expose registry discovery to web and CLI clients, and preserve canonical prediction and similarity vectors.

Implementation ends after code, migration fixtures, client behavior, and all spec validation gates pass. Plan approval and implementation execution remain separate decisions.

## Current system boundaries

- `packages/shared/src/types.ts` defines one broad `Axis` interface with `source: "bgg"` and unconstrained `bggField: string | null`; `Collection` has no schema version.
- `packages/shared/src/axis-utils.ts` and `packages/shared/src/curve-math.ts` independently switch on BGG field names. The resolver only receives `BggGameData`, although player bounds and playing time are top-level `Game` fields.
- `packages/shared/src/validation.ts` accepts any nonempty BGG field on creation and cannot update derived field configuration.
- `packages/daemon/src/services/fitness-service.ts` resolves BGG values, overrides, vetoes, curves, and breakdowns with BGG-specific fields. Its breakdown cannot distinguish a published value from a capped scoring input.
- `packages/daemon/src/services/storage-service.ts` casts `collection.json` without schema validation. Its tournament migration persists the collection before invalidating profile and wishlist caches, so interruption can leave stale caches behind a completed migration marker.
- `packages/daemon/src/services/feature-vector.ts` already has the required five continuous factual dimensions in stable order: weight, community rating, minimum players, maximum players, and uncapped playing time. It also allocates a rating slot for every axis, which incorrectly duplicates current BGG axes and would make duplicate derived axes change vector dimensions.
- `packages/daemon/src/services/profile-engine.ts`, prediction routes/services, redundancy routes, and capacity packing all consume the shared vector encoder or field-specific axis behavior and must agree on the same filtered axis schema.
- `packages/web/app/axes/page.tsx` owns axis creation/editing and curve controls. `score-breakdown.tsx`, `rating-form.tsx`, and collection utilities contain BGG-specific display assumptions.
- `packages/cli/src/commands/axis.ts`, `packages/cli/src/index.ts`, and `packages/cli/src/output.ts` own axis commands and score/prediction presentation.

## Decisions made concrete for implementation

- Replace the broad axis interface with a discriminated `Axis` union containing `PersonalAxis`, `TournamentAxis`, `DerivedAxis`, and `DisabledLegacyAxis`. Valid derived axes use `source: "derived"`, a stable `derivedField` ID, and field-specific `configuration`.
- Keep disabled legacy axes in `Collection.axes` with their original ID and payload, `source: "legacy"`, `enabled: false`, and a machine-readable reason. This preserves `Game.ratings[axisId]` while making invalid axes impossible to score accidentally.
- Add `schemaVersion` to `Collection` and make the collection storage schema accept legacy input only at the migration boundary. Runtime services receive only the current validated union.
- Put the exhaustive field registry in `packages/shared/src/derived-axis-registry.ts`. Registry definitions own display metadata, provenance, units, missing-value policy, configuration validation, native scale, resolver, and template defaults. API, profile, web, and CLI code consume registry projections rather than repeat field switches.
- Represent resolver output as `{ sourceValue, scoringRawValue }`. For uncapped fields these values match. Play Time keeps published minutes as `sourceValue` and caps only `scoringRawValue`.
- Apply Play Time vetoes and curves to `scoringRawValue`, because the configured cap defines the scoring scale. Reject updates that would place an ideal, numeric tolerance width, or veto threshold outside the merged post-update native scale; never silently clamp or reset user settings.
- Extend sweet-spot curves with optional `toleranceWidth` in native units. Existing categorical `tolerance` remains valid for existing axes and behavior. New Play Time templates use `toleranceWidth: 30`; validation permits one tolerance representation at a time. For an unleaned curve, the width is the distance from the ideal where the effective rating is 4.5, matching the existing moderate-tolerance anchor. For each side, derive `k = ln(3.5 / 9) / ln(1 - toleranceWidth / sideRange)` and use the existing `1 + 9 * (1 - t)^k` curve; the ideal remains 10 and the native-scale endpoint remains 1. Existing lean multipliers apply to the derived per-side exponent. Require both side ranges to be strictly positive and `0 < toleranceWidth < min(ideal - scale.min, scale.max - ideal)`. This is the product decision made during planning.
- Give Player Count Fit a native scale of 1 through 10. All existing curve shapes remain available, although its resolver produces only 1 or 10.
- Keep Community Rating and Complexity as automatic defaults for fresh collections. Player Count Fit and Play Time remain optional, duplicate-permitted templates.
- A disabled legacy axis is repairable by choosing a registered derived field and valid configuration. Repair preserves the axis ID, name, weight, curve, veto, timestamps, and personal overrides; the UI must warn that existing overrides will now override the selected derived field. Deletion remains available.
- An enabled, valid derived axis counts as profile coverage regardless of weight. Disabled legacy axes do not. Duplicate configured axes count as one covered field for suggestion suppression.
- Invalidate collection-schema-dependent artifacts before atomically persisting the migrated collection. An interruption therefore leaves an old schema version that retries idempotent invalidation on the next load. A central artifact manifest owns each path and invalidator so future persisted prediction artifacts must register at the same boundary. Delete `profile.json`; clear all prediction snapshot fields in valid wishlist entries; quarantine malformed wishlist content before continuing so collection loading succeeds without silently overwriting the only copy.
- Version discovery at `GET /api/axes/derived-fields` with a top-level `version`. Configuration schemas use a small typed JSON contract of property name, numeric type, required/default/minimum/maximum, rather than exposing Zod or general JSON Schema internals. Stable validation codes are shared string literals.

## Step 1: Define the shared axis union, registry, and curve contract

**Files:**

- `packages/shared/src/types.ts`
- New `packages/shared/src/derived-axis-registry.ts`
- `packages/shared/src/curve-math.ts`
- `packages/shared/src/axis-utils.ts`
- `packages/shared/src/index.ts`
- `packages/shared/tests/axis-utils.test.ts`
- `packages/shared/tests/curve-math.test.ts`
- New registry-focused tests under `packages/shared/tests/`

**Changes:**

1. Define `DerivedFieldId` as the closed union `communityRating | weight | playerCountFit | playingTime` and model each field's configuration as a discriminated union. Fields without settings use an empty object, not `null` or an unconstrained record.
2. Define the current source-specific axis types and their union. Keep common curve, veto, weight, identity, and timestamp fields in a shared base. Define the disabled legacy type so it cannot satisfy enabled-axis helpers. The exported `Axis` alias changes to this union only as part of the coordinated Step 1-through-6 cutover; do not merge the type replacement ahead of its consumers.
3. Add `schemaVersion` to `Collection` and generalized breakdown metadata: derived field ID, `sourceValue`, `scoringRawValue`, unit, provenance, configuration summary, and override state. Remove BGG-only `bggOriginal` from the current contract.
4. Add `toleranceWidth?: number | null` to sweet-spot curve configuration and profile declarations. Preserve categorical tolerance behavior when numeric width is absent; reject payloads that specify both. Implement the per-side exponent equation from the Decisions section, including endpoint, lean, and asymmetric-ideal behavior.
5. Build one exhaustive typed registry. Each entry declares stable ID, labels, description, provenance, unit, missing policy, configuration contract, scale resolver, value resolver, and editable template defaults.
6. Resolve Community Rating and Complexity from `game.bggData`; resolve Player Count Fit from valid positive inclusive `game.minPlayers`/`game.maxPlayers`; resolve Play Time from positive `game.playingTime` and its axis cap. Do not read suggested-player polls or add min/max play-time fields.
7. Replace `resolveBggRawValue()` with game-aware registry resolution. Replace field switches in native-scale lookup with registry delegation.
8. Add shared helpers for enabled/scoring axes, derived discovery serialization, configuration summaries, and vector-eligible axes so downstream packages do not reproduce source filtering.

**Validation gate:**

- Registry tests prove all four IDs are present exactly once and every definition serializes to discovery metadata.
- Resolver tests cover player-count inclusive bounds, outside range, missing/nonpositive/reversed bounds, and a valid imported range above the target cap such as target 100 in `1..500`; cover normal/zero/missing/capped/above-cap play time and existing Community Rating/Complexity behavior.
- Curve tests prove an unleaned Play Time curve centered at 90 scores 10 at 90, 4.5 at 60 and 120, and 1 at native-scale endpoints; cover asymmetric side ranges, both lean directions, invalid widths, unchanged categorical curves, and dynamic caps.
- Independent registry tests pin every REQ-DERIVED-18 template name, description, weight, curve, required configuration behavior, and defaults, including Player Count Fit's higher-is-better shape and Play Time's ideal 90, tolerance width 30, and cap 240. Discovery-equals-registry tests do not substitute for these assertions.
- Shared tests and type checking pass without adding `any`, unsafe assertions, or a second field-name switch.

## Step 2: Add registry-derived validation and stable API errors

**Files:**

- `packages/shared/src/validation.ts`
- `packages/shared/src/errors.ts`
- `packages/shared/src/index.ts`
- `packages/shared/tests/validation.test.ts`

**Changes:**

1. Define source-discriminated personal/derived payloads to replace the BGG create schema during the coordinated cutover. Tournament remains service-managed and cannot be created through the general endpoint; do not export the replacement schema under the current service-facing name before Step 4 consumes it.
2. Validate each derived field and configuration pair through registry-owned schemas. Reject unknown IDs, settings on fields that accept none, missing settings, nonintegers, and boundary violations before service execution.
3. Extend update input to edit derived configuration while preventing source or field changes on a valid axis. Disabled-legacy repair uses an explicit repair payload rather than overloading ordinary update semantics.
4. Validate the merged post-update curve against the registry-derived scale, including ideal, veto, and numeric tolerance width. Reject cap changes that make dependent values invalid. Legacy repair accepts field/configuration and any replacement curve/veto fields atomically so an incompatible old curve can be repaired in one request.
5. Define stable codes including `unknown_derived_field`, `missing_derived_configuration`, `unsupported_derived_configuration`, `invalid_target_player_count`, `invalid_maximum_scoring_time`, `invalid_curve_for_native_scale`, and `invalid_legacy_axis_repair`.
6. Carry structured validation details through a shared error contract so routes and both clients never infer behavior from message text.

**Validation gate:**

- Accept target counts 1 and 100 and caps 60 and 1,440; reject adjacent values, fractions, and missing required configuration.
- Accept all four registered fields with valid configuration and reject unknown identifiers.
- Reject conflicting tolerance forms, widths that reach either scale endpoint, and merged cap updates that invalidate a 90-minute ideal, tolerance width, or veto.
- Error-code tests assert code and field details independently from human-readable wording.

## Step 3: Implement versioned collection migration and recoverable cache invalidation

**Files:**

- `packages/daemon/src/services/collection-migration.ts`
- `packages/daemon/src/services/storage-service.ts`
- New `packages/daemon/src/services/collection-artifacts.ts`
- `packages/daemon/src/services/file-ops.ts` if quarantine needs an added operation
- `packages/shared/src/validation.ts`
- `packages/daemon/tests/services/collection-migration.test.ts`
- `packages/daemon/tests/services/storage-service.test.ts`
- Existing storage backfill fixtures

**Changes:**

1. Replace `ensureTournamentAxis()` as the top-level entry point with a pure, version-stepped `migrateCollection(raw)` pipeline. Retain tournament insertion as one idempotent migration step.
2. Convert valid legacy `source: "bgg"` Community Rating and Complexity axes to enabled derived axes with empty configuration while preserving every common axis property, curve, veto, ID, and corresponding game ratings.
3. Convert unknown fields and malformed source/field combinations to disabled legacy axes. Preserve the complete original payload, including unrecognized properties, in an `unknown`-validated legacy snapshot and retain the original axis ID; equality tests compare the full snapshot rather than selected known fields.
4. Move all existing game backfills into explicit versioned migration steps before current-schema validation, including defaults for missing `ownership`, `boxDimensions`, and `manualShelfId`. Pin each historical game shape with a fixture so replacing the old load loop cannot reject supported collections. Fresh collections start at the current version with Community Rating, Complexity, and Tournament only.
5. Define a central ordered manifest of collection-schema-dependent artifacts. Each descriptor owns artifact identity, path, current dependency version, and idempotent invalidator. Register profile deletion and wishlist prediction clearing there; later persisted prediction artifacts must add a descriptor rather than a new migration-specific branch.
6. On migration, run every manifest invalidator, then atomically write the current collection. Each completed operation is safe to repeat. Test the extensibility boundary with an injected additional artifact descriptor whose invalidation must complete before collection persistence.
7. Add entry-level wishlist storage validation that separates user-owned identity/note fields from disposable prediction fields. Preserve an entry and null its prediction snapshot when only cache fields are malformed. For syntactically valid arrays with invalid core entries, first atomically write the untouched raw content to a collision-safe quarantine path without removing the active file, then atomically replace the active file with salvageable entries whose prediction fields are cleared. For invalid JSON, write the quarantine copy before unlinking the active file. A retry after any interruption therefore sees either the original active content or the completed salvage, never an absent active file with unprocessed valid entries.
8. Treat malformed profile data as disposable. Never let malformed cache-bearing data prevent valid collection loading.
9. Log migration start, source/target versions, converted/disabled axis counts, each artifact invalidation attempt/outcome, salvaged wishlist counts, quarantine paths, final persistence, and failures at these file boundaries.

**Validation gate:**

- Fixture tests prove known axes preserve scores, curves, vetoes, weights, IDs, and overrides after migration.
- Unknown and malformed axes remain visible, disabled, intact, and excluded from scoring.
- Repeated migration is byte-stable apart from intentionally updated migration timestamps.
- Failure injection after profile removal, after wishlist rewrite, after an injected future-artifact invalidator, and before collection rename proves the next load completes safely and no stale registered artifact survives a current collection version.
- Tests cover invalid JSON, mixed valid/invalid wishlist entries, malformed prediction-only fields, quarantine-name collisions, and interruption before/after quarantine copy and active rewrite/unlink. Valid user-owned fields remain active where salvage is possible, and untouched original content remains recoverable in quarantine.

## Step 4: Refactor axis services and expose registry discovery

**Files:**

- `packages/daemon/src/services/axis-service.ts`
- `packages/daemon/src/routes/axes.ts`
- `packages/daemon/src/operations.ts`
- `packages/daemon/tests/services/axis-service.test.ts`
- `packages/daemon/tests/routes/axes.test.ts`
- Affected route test helpers

**Changes:**

1. Create valid derived axes from parsed registry-backed payloads and keep duplicate derived fields legal. Keep tournament singleton and service-managed constraints intact.
2. Update field-specific configuration and curves using merged-state validation from Step 2.
3. Add an explicit disabled-legacy repair operation that atomically accepts a registered field, configuration, and any replacement curve/veto settings; replace the legacy variant with a valid derived variant while preserving the axis ID and common settings. Keep deletion available.
4. Return disabled legacy axes from list/management APIs but reject rating-independent scoring operations against them.
5. Add `GET /api/axes/derived-fields`, generated entirely from the shared registry projection. Include response version, field metadata, scale/unit/provenance, configuration constraints, and template defaults.
6. Return structured validation errors with stable codes from create, update, and repair routes. Register discovery and repair in operation/help metadata.
7. Log create, update, repair, and delete attempts and outcomes with axis ID, source/field, changed configuration keys, and validation code where applicable.

**Validation gate:**

- Service and route tests cover all four templates, duplicate derived axes, configuration editing, invalid merged updates, disabled legacy repair, deletion, and tournament protections.
- Rejected repair and injected persistence-failure tests compare before/after storage and prove the disabled snapshot, axis ID, common settings, and all `Game.ratings[axisId]` values remain unchanged.
- Discovery fixtures match registry output and contain no independently maintained field literals.
- Route tests assert stable status/code/detail responses for every field/configuration failure class.

## Step 5: Integrate derived resolution into fitness and breakdowns

**Files:**

- `packages/daemon/src/services/fitness-service.ts`
- `packages/daemon/src/services/prediction-engine.ts`
- `packages/daemon/src/services/curve-engine.ts`
- `packages/shared/src/axis-utils.ts`
- `packages/daemon/tests/fitness-service.test.ts`
- Prediction scoring fixtures that construct breakdown entries

**Changes:**

1. Pass the complete `Game` to derived resolvers. Stop accepting a separate BGG payload as the source of field resolution.
2. For enabled derived axes, resolve factual and scoring values, apply veto and curve to `scoringRawValue`, and retain both values in the breakdown. Missing values produce a visible null breakdown row and no numerator or denominator contribution.
3. Keep personal overrides on the 1-10 scale, ahead of derived values, and bypass the derived veto. Preserve resolved factual values when present; when metadata is missing, show only the override without inventing source/scoring values.
4. Apply the shared enabled-scoring-axis filter at both actual and predicted fitness entry points. Exclude disabled legacy axes from weights, coverage, confidence, actual/predicted/rated/total counts, early-completion checks, fallback breakdowns, vetoes, and contribution sorting while retaining them in management APIs.
5. Generalize source naming from BGG to derived and include field, unit, provenance, configuration summary, effective rating, and override state in each breakdown.
6. Preserve tournament resolution and prediction confidence semantics.

**Validation gate:**

- Before/after migration fixture tests prove Community Rating and Complexity effective scores, weights, curves, vetoes, overrides, and denominator behavior are unchanged.
- Player Count Fit and Play Time tests cover every resolver boundary from the spec, including a capped duration showing distinct source/scoring values.
- Play Time lower-is-better tests cover the scale minimum, an interior duration, and the configured cap in addition to numeric sweet-spot behavior.
- Changing a cap changes scoring immediately without changing stored game metadata.
- Missing derived values remain in breakdowns but do not alter the weighted denominator; override tests cover both present and absent factual metadata.
- Prediction tests prove a disabled legacy axis cannot change score, coverage, confidence, counts, early-return behavior, or breakdown rows, and generalized missing derived rows carry the same metadata shape as actual scoring.

## Step 6: Preserve canonical feature-vector invariants across every consumer

**Files:**

- `packages/daemon/src/services/feature-vector.ts`
- `packages/daemon/src/services/prediction-service.ts`
- `packages/daemon/src/services/prediction-engine.ts`
- `packages/daemon/src/services/profile-engine.ts`
- `packages/daemon/src/services/redundancy-engine.ts`
- `packages/daemon/src/services/capacity-service.ts`
- `packages/daemon/src/routes/games.ts`
- `packages/daemon/src/routes/prediction.ts`
- Corresponding daemon tests, including feature-vector, profile, prediction, redundancy, and capacity suites

**Changes:**

1. Define one ordered vector-axis helper that includes only personal and tournament axes. Derived and disabled axes never allocate axis-vector slots. Make that ordered schema mandatory to `encodeGame`; remove the per-game rating-key fallback entirely.
2. Keep the five continuous factual dimensions in exact existing order. Player bounds remain separate dimensions and Play Time always uses uncapped published `game.playingTime`.
3. Require every prediction, profile/outlier, redundancy, route preview, and shelf-capacity call site to use the same vocabulary, continuous ranges, and filtered vector-axis list.
4. Retain fixed dimensions when ratings are missing by filling only eligible axis slots with the existing midpoint behavior. Add finite-value and dimension assertions at the vector boundary and make omission of the ordered schema a type error.
5. Refactor profile axis distributions, curve declarations, weights, and suggestion coverage through enabled-axis and registry helpers. Keep distributions on effective 1-10 preference ratings so derived facts and personal overrides are comparable; attach native scale/unit/provenance to utility-curve declarations instead of mixing minute values into rating histograms. Add override-present distribution tests.
6. Preserve deterministic derived values as actual fitness inputs in prediction while keeping them out of similarity axis components.

**Validation gate:**

- Exact name/order/dimension tests prove adding, removing, duplicating, or reconfiguring derived axes does not change vector shape or values; old keyset-fallback tests are removed and compile/runtime tests require an explicit ordered axis schema.
- Tests prove personal and tournament axes retain stable slots and no vector or distance contains `NaN`/infinity.
- Published time above a scoring cap remains uncapped in the continuous vector.
- Prediction, profile/outlier, redundancy, and capacity integration tests each exercise Player Count Fit and Play Time without dimensional drift.

## Step 7: Implement discovery-driven web management and score presentation

**Files:**

- `packages/web/lib/api.ts`
- `packages/web/app/axes/page.tsx`
- `packages/web/components/rating-form.tsx`
- `packages/web/components/score-breakdown.tsx`
- `packages/web/lib/collection-utils.ts`
- `packages/web/app/games/[id]/page.tsx`
- `packages/web/components/profile/axis-distributions.tsx`
- `packages/web/components/profile/utility-curves.tsx`
- `packages/web/app/globals.css`
- Web tests for axis management, rating form, score breakdown, and collection utilities

**Changes:**

1. Fetch typed discovery metadata and build all four derived templates from its defaults. Keep personal-axis creation available and allow duplicate templates.
2. Collect/edit Player Count Fit target and Play Time cap with registry-provided bounds. Render minute-aware ideal, numeric tolerance-width, veto, scale, and preview controls.
3. Show Player Count Fit's target and publisher-range provenance and Play Time's cap/provenance on management cards.
4. Render disabled legacy axes separately with reason, preserved identifier/configuration, repair controls, warning about retained overrides, and delete action.
5. Replace BGG-specific rating display with resolved derived details from the score response. Preserve override/revert behavior.
6. In breakdowns distinguish published `sourceValue`, capped `scoringRawValue`, effective preference rating, personal override, unit, and provenance. Do not apply 1-10 interpretation labels to factual weight, player-count, or duration values.
7. Keep profile distributions explicitly labeled as effective 1-10 ratings and show native scale, units, provenance, and numeric tolerance width in utility-curve declarations.
8. Surface structured error codes as field-level actionable messages while retaining server messages as fallback details.
9. Preserve responsive behavior on axis management and game detail pages at narrow and desktop widths.

**Validation gate:**

- Component/interaction tests create and edit both new templates from mocked discovery without hardcoded field lists.
- Tests cover target/cap boundaries, 30-minute tolerance, duplicate templates, disabled legacy repair/deletion, and structured validation errors.
- Breakdown tests cover uncapped/capped duration, player target/provenance, missing metadata, and overrides with and without factual values.
- Rating-form interaction tests enter, submit, persist, display, and clear 1-10 overrides for Player Count Fit and Play Time, including an override when factual metadata is missing.
- Profile component tests prove axis-distribution histograms remain effective 1-10 ratings rather than factual minutes/player counts and utility-curve declarations render native scale, unit, provenance, and numeric tolerance width.
- Browser smoke checks confirm axis and game-detail flows at mobile and desktop widths.

## Step 8: Implement discovery-driven CLI templates and derived output

**Files:**

- `packages/cli/src/commands/axis.ts`
- `packages/cli/src/index.ts`
- `packages/cli/src/output.ts`
- `packages/cli/src/commands/score.ts`
- `packages/cli/src/commands/predict.ts`
- `packages/cli/tests/commands/axis.test.ts`
- `packages/cli/tests/output.test.ts`
- Score and prediction command tests

**Changes:**

1. Add `axis templates` backed by discovery and support template creation flags for target player count and maximum scoring time.
2. Extend axis update with the same configuration flags and numeric native-unit sweet-spot tolerance. Validate required flag combinations before sending requests while treating daemon validation as authoritative.
3. List derived field, configuration, unit/provenance, and disabled legacy status. Add explicit repair and delete guidance for invalid legacy axes.
4. Generalize score and prediction breakdown output to show source/scoring values, effective rating, override, units, provenance, and capped durations.
5. Surface stable API codes in actionable human output and preserve complete structured JSON output.

**Validation gate:**

- CLI tests cover discovery, all templates, required target/cap flags, configuration updates, duplicate creation, repair, and stable error-code handling.
- Human output distinguishes factual values from effective ratings and displays both published and capped duration.
- JSON output round-trips the daemon's generalized breakdown without dropping metadata.

## Step 9: Complete cross-package migration and behavior regression coverage

**Files:**

- Existing shared, daemon, web, and CLI fixtures containing `source: "bgg"`, `bggField`, or `bggOriginal`
- `packages/daemon/tests/services/bgg-xml-parser.test.ts`
- Focused persisted-flow integration fixtures under `packages/daemon/tests/`

**Changes:**

1. Convert current-runtime fixtures to the new union while retaining explicit legacy fixtures only in migration tests.
2. Add one persisted end-to-end fixture containing valid and invalid legacy axes, overrides, profile cache, and wishlist predictions. Load, migrate, score, discover, and reload it.
3. Add BGG parser regression tests proving existing minimum players, maximum players, and singular playing time remain available while minimum/maximum duration fields are not introduced.
4. Exercise fresh collection creation and prove only Community Rating, Complexity, and Tournament are automatic.
5. Audit field-sensitive switches and client literals. Only the shared registry and migration parser may enumerate derived field IDs.

**Validation gate:**

- The persisted-flow fixture proves migration is durable and idempotent, invalid axes are repairable, caches are invalidated, and known scores are unchanged.
- Search-based audit finds no production BGG-field switches, template field lists, or unconstrained current derived field strings outside the registry/migration boundary.
- Existing tournament, prediction, redundancy, profile, wishlist, and shelf-capacity suites remain green.

## Step 10: Final validation against the approved specification

1. Run `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run test`, and `bun run build`.
2. Execute every scenario in the spec's AI Validation section and record the automated test that covers it.
3. Review every requirement REQ-DERIVED-1 through REQ-DERIVED-22 against the coverage table and implementation diff.
4. Verify daemon help includes discovery/repair operations and CLI help includes templates/configuration/repair commands.
5. Inspect a migrated collection and cache files on disk, then reload to verify current schema validation and idempotence.
6. Exercise web and CLI creation/editing for both new fields and confirm neither is present automatically in a fresh collection.
7. Inspect final vector names, ordering, dimensions, and finite values through prediction, profile, redundancy, and capacity paths.
8. Update this plan to `executed` and the source spec to `implemented` only after all gates pass.

## Dependency order

1. The first implementation bead performs the independently closable, additive portions of Steps 1 and 2: registry/types/helpers/curve math and replacement schemas under temporary explicit names, without changing the exported `Axis`, `CreateAxisSchema`, or `UpdateAxisSchema` contracts consumed by the daemon. Shared tests and root type checking must pass when it closes.
2. One atomic runtime-cutover bead performs Step 3 through Step 6 and the final export swaps from Steps 1 and 2. It owns collection migration/artifacts, axis API/discovery, actual and predicted fitness, profile semantics, vector schema, and every daemon consumer. Do not split this bead into prerequisites that cannot close independently. Root type checking and all shared/daemon tests must pass when it closes.
3. The web bead (Step 7) and CLI bead (Step 8) depend on the runtime-cutover bead and may proceed in parallel.
4. The cross-package regression bead (Step 9) depends on both client beads. Final validation (Step 10) depends on regression completion.

## Requirement coverage

| Requirement    | Implementation steps | Primary validation                                                         |
| -------------- | -------------------- | -------------------------------------------------------------------------- |
| REQ-DERIVED-1  | 1, 3                 | Axis-union type tests and legacy-to-current migration fixtures             |
| REQ-DERIVED-2  | 1                    | Registry exhaustiveness, metadata, resolver, and serialization tests       |
| REQ-DERIVED-3  | 1, 2, 4, 6, 7, 8, 9  | Registry-consumer tests and production switch/literal audit                |
| REQ-DERIVED-4  | 1, 2, 4              | Four-field acceptance and unknown-ID API rejection tests                   |
| REQ-DERIVED-5  | 5                    | Native curve, missing-row, numerator, and denominator tests                |
| REQ-DERIVED-6  | 5, 7, 8              | Override precedence, factual retention, and display tests                  |
| REQ-DERIVED-7  | 1, 2                 | Target bounds/configuration and imported-range validation tests            |
| REQ-DERIVED-8  | 1, 5                 | Inclusive/in-range/out-of-range resolver and scoring tests                 |
| REQ-DERIVED-9  | 1, 5                 | Missing/nonpositive/reversed-bound tests                                   |
| REQ-DERIVED-10 | 1, 7, 8              | Target/provenance management and breakdown presentation tests              |
| REQ-DERIVED-11 | 1, 2, 4              | Dynamic scale, cap bounds/default, and merged-update tests                 |
| REQ-DERIVED-12 | 1, 5                 | Normal/zero/missing/at-cap/above-cap resolver tests                        |
| REQ-DERIVED-13 | 1, 2, 5, 7, 8        | Numeric tolerance equation, lower/sweet curves, and minute UI tests        |
| REQ-DERIVED-14 | 1, 9                 | BGG parser and model regression tests excluding min/max duration           |
| REQ-DERIVED-15 | 3, 5, 9              | Complete score-equivalence and persisted migration fixtures                |
| REQ-DERIVED-16 | 3, 4, 5, 6, 7, 8     | Snapshot preservation, scoring/prediction exclusion, repair/delete tests   |
| REQ-DERIVED-17 | 3, 9                 | Manifest, current/future artifact, salvage, interruption, and reload tests |
| REQ-DERIVED-18 | 1, 4, 7, 8, 9        | Discovery defaults and duplicate web/CLI creation/editing tests            |
| REQ-DERIVED-19 | 1, 2, 4, 7, 8        | Versioned discovery and stable validation-code tests                       |
| REQ-DERIVED-20 | 1, 5, 6, 7, 8        | Actual/predicted breakdown and management presentation tests               |
| REQ-DERIVED-21 | 6, 9                 | Mandatory fixed schema and finite-value tests across every consumer        |
| REQ-DERIVED-22 | 6, 9                 | Exact continuous/axis names, order, dimensions, and uncapped-time tests    |

## Risks and review notes

- **Migration is the compatibility boundary:** current runtime types should not carry optional old fields. Preserve old shapes only in migration input schemas and disabled snapshots.
- **Numeric tolerance expands the curve contract:** retaining categorical tolerance avoids changing existing scores. Tests must prove the new property is additive and mutually exclusive rather than silently reinterpreting old values.
- **Dynamic scale edits are coupled:** a cap can invalidate ideal, tolerance, or veto. Reject the whole update with field details rather than mutate dependent settings.
- **Wishlist combines user data and cache data:** clear only prediction fields in valid entries. Quarantine malformed content before proceeding so migration is recoverable without pretending corrupted user data was safely parsed.
- **Vector duplication already exists:** removing derived/BGG slots can change current similarity results, but that change is required to restore the documented invariant. Lock exact schema order in tests before updating callers.
- **Disabled axes remain manageable but not scorable:** use exhaustive union handling and shared filters in totals, profiles, predictions, and clients to prevent inconsistent inclusion.
- **Profile semantics must remain singular:** distributions use effective 1-10 ratings, including overrides; factual units and native scales belong to curve declarations and breakdowns, not the distribution values.
- **Large fixture surface:** many inline axis literals will fail type checking. Convert them mechanically after core contracts settle and avoid unrelated fixture refactors.

## Fresh-eyes review

The first review found undefined numeric-tolerance math, disabled-axis leakage into prediction, no future-artifact invalidation boundary, a variable-length vector fallback, a non-mergeable dependency sequence, mixed-scale profile distributions, and unsafe partial-wishlist handling. The second found that the cutover boundary omitted Steps 1-2, quarantine ordering could strand valid entries, existing game backfills were not explicitly migrated, and several failure/edge assertions were missing. This revision defines Steps 1-6 as one cutover, uses copy-before-rewrite quarantine, migrates historical game fields, and adds repair rollback, profile component, exact template, unbounded publisher-range, and lower-is-better tests. A final review must verify these corrections before implementation begins.
