---
title: "Implementation notes: derived game-metadata axes"
date: 2026-08-24
status: complete
tags: [implementation, notes, derived-axes]
source: .lore/work/plans/derived-game-metadata-axes.md
modules: [shared]
---

# Implementation notes: derived game-metadata axes

## Progress

- [x] Phase 1: additive registry, current-axis contracts, helpers, and numeric curve width
- [x] Phase 2: additive replacement validation schemas and stable validation errors
- [x] Independent test, review, and holistic specification validation

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
