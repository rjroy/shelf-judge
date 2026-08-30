---
title: "Implementation notes: manual Play Time and Player Count values"
date: 2026-08-29
status: complete
tags: [implementation, manual-values, derived-axes, purchase-utilization]
source: beads:shelf-judge-e05
modules: [shared, daemon, web]
---

# Implementation notes: manual Play Time and Player Count values

## Progress

- [x] Add durable manual source values and schema v5 migration.
- [x] Share manual-over-source precedence across derived scoring and Purchase Utilization.
- [x] Replace affected 1-10 score overrides with native-unit daemon and web mutations.
- [x] Add route, migration, scoring, utilization, and UI tests.
- [x] Complete independent review of the mounted form lifecycle correction.

## Decisions

- Manual values live on `Game.manualValues`, not on derived-axis configuration. They are corrections to source data and can therefore serve every consumer.
- Manual values preserve the imported BGG fields and evidence. Effective-value resolution gives a present manual value precedence without rewriting its source.
- Play Time and Player Count Fit no longer accept personal 1-10 score overrides. This policy is owned by derived-axis registry metadata and shared by daemon validation, scoring, and web editing.
- The v4-to-v5 migration cannot reinterpret historical 1-10 ratings as native minutes or player counts, so it removes ratings for the affected derived axes and initializes both manual values to null.
- Clearing either manual value is independent. A mutation that omits a field leaves that field unchanged.
- Play Time and Player Count use independent draft, baseline, status, and error state. A form-level lock serializes single-field mutations through `useTransition` refresh settlement; separate browser sessions retain last-write-wins semantics because stale-write protection belongs at the daemon boundary.

## Implementation

- Added schema v5 persistence and strict request validation for positive safe-integer minutes and player counts.
- Added shared effective-value resolvers and manual evidence conversion.
- Updated Play Time and Player Count Fit derived resolution and Purchase Utilization modeled-player-count/duration inputs.
- Added coordinator-backed, logged `GameService.setManualValues` persistence and discoverable `PUT /api/games/:id/manual-values` routing.
- Added a game-detail native-unit form with independent clear controls and removed the affected axes from rating editing.
- Replaced the combined speculative form reducer and combined save control with independent field reducers and save/clear controls. Pending fields are disabled, the other draft remains editable, and every request body contains exactly one field.
- Added field-associated polite operation status and assertive errors, plus refresh-aware reconciliation that adopts clean props, retains dirty or pending drafts, and advances each field's baseline independently.
- Updated current-schema fixtures and historical v3/v4 migration fixtures across packages.

## Validation

- `bun run typecheck`: pass.
- `bun run lint`: pass.
- `bun run test`: 2203 pass, 1 skip, 0 fail across 126 files.
- `bun run typecheck:browser`: pass.
- `bun run test:browser`: 82 pass, 18 skipped, 0 fail across mobile, tablet, desktop, and 200-percent desktop projects.
- `bun run build`: pass; Next.js production build completed successfully.
- `git diff --check`: pass.
- Review fix SJ-E05-001: `bun test packages/web/tests/manual-game-values-form.test.tsx` (6 pass), web and browser TypeScript checks pass, focused ESLint and Prettier checks pass, and the focused diff check passes.
- Mounted lifecycle correction: `bun test packages/web/tests/manual-game-values-form.test.tsx` passes with 4 tests, 0 failures, and 15 assertions.
- `bun run --cwd packages/web test:browser -- e2e/manual-game-values.pw.ts`: 2 pass in `chromium-desktop`; 6 expected viewport-independent skips.
- `bun run typecheck:browser`: pass with no diagnostics.
- `bunx tsc --noEmit -p packages/web/tsconfig.test.json`: the corrected manual form test has no diagnostics; the project check remains blocked by unrelated existing diagnostics in eight other web test files.
- `bun run lint`: pass with no diagnostics.
- Focused Prettier check and `git diff --check`: pass.
- Review fix SJ-E05-002: `bun test packages/web/tests/manual-game-values-form.test.tsx` passes with 4 tests, 0 failures, and 15 assertions; `bun run --cwd packages/web test:browser -- e2e/manual-game-values.pw.ts` passes all 4 production-mounted desktop scenarios with 12 expected viewport-independent skips; browser TypeScript, focused ESLint and Prettier, and `git diff --check` pass.
- Terminal acceptance review found no material gaps. Final `bun run typecheck`, `bun run lint`, `bun run test`, `bun run typecheck:browser`, focused production-mounted Playwright, and `bun run build` all pass.

## Log

- The first full suite exposed stale future-version assertions, v3 fixtures containing a v5-only field, and concrete derived-field policy duplicated outside the registry. These were corrected at their ownership boundaries.
- The first browser run exceeded the command timeout at test 93 and left its fixture daemon running. The orphaned test-only processes were terminated, and the complete browser suite passed on the retry with a larger timeout.
- Final review made `GameService.setManualValues` required and updated structurally typed test doubles rather than retaining an unnecessary runtime compatibility branch.
- Checkpoint review found one unresolved race: after an in-flight prop refresh, a failed save can replace a newer local edit when that edit equals the old saved baseline. The Beads issue remains in progress until this state transition is corrected and reviewed.
- SJ-E05-001 now reconciles refreshed props into untouched drafts and saved baselines while retaining dirty drafts. It records the exact in-flight mutation and latest server snapshot so concurrent refreshes cannot overwrite submitted or repeated edits, failed saves remain retryable against the newest baseline, and successful independent sets or clears advance only their own baseline.
- The approved manual edit lifecycle supersedes the combined reducer correction. The earlier custom reducer/view harness did not prove React transition or effect behavior and was replaced with production-mounted Playwright coverage of the game-detail form. Focused reducer tests remain only for deterministic field reconciliation and failure semantics.
- SJ-E05-002 extends mounted prop reconciliation from scalar values to the full persisted manual-value identity (`value`, `source`, and `confirmedAt`). A newer same-scalar authoritative write now advances the baseline after successful save or clear without replacing the pending draft or another field's dirty draft; mounted tests also prove one-field request bodies, serialization, and lock release.
