---
title: "Implementation notes: manual Play Time and Player Count values"
date: 2026-08-29
status: in_progress
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
- [ ] Resolve the remaining form-state race and repeat final validation.

## Decisions

- Manual values live on `Game.manualValues`, not on derived-axis configuration. They are corrections to source data and can therefore serve every consumer.
- Manual values preserve the imported BGG fields and evidence. Effective-value resolution gives a present manual value precedence without rewriting its source.
- Play Time and Player Count Fit no longer accept personal 1-10 score overrides. This policy is owned by derived-axis registry metadata and shared by daemon validation, scoring, and web editing.
- The v4-to-v5 migration cannot reinterpret historical 1-10 ratings as native minutes or player counts, so it removes ratings for the affected derived axes and initializes both manual values to null.
- Clearing either manual value is independent. A mutation that omits a field leaves that field unchanged.

## Implementation

- Added schema v5 persistence and strict request validation for positive safe-integer minutes and player counts.
- Added shared effective-value resolvers and manual evidence conversion.
- Updated Play Time and Player Count Fit derived resolution and Purchase Utilization modeled-player-count/duration inputs.
- Added coordinator-backed, logged `GameService.setManualValues` persistence and discoverable `PUT /api/games/:id/manual-values` routing.
- Added a game-detail native-unit form with independent clear controls and removed the affected axes from rating editing.
- Updated current-schema fixtures and historical v3/v4 migration fixtures across packages.

## Validation

- `bun run typecheck`: pass.
- `bun run lint`: pass.
- `bun run test`: 2201 pass, 1 skip, 0 fail across 126 files.
- `bun run typecheck:browser`: pass.
- `bun run test:browser`: 82 pass, 18 skipped, 0 fail across mobile, tablet, desktop, and 200-percent desktop projects.
- `bun run build`: pass; Next.js production build completed successfully.
- `git diff --check`: pass.
- Review fix SJ-E05-001: `bun test packages/web/tests/manual-game-values-form.test.tsx` (6 pass), web and browser TypeScript checks pass, focused ESLint and Prettier checks pass, and the focused diff check passes.

## Log

- The first full suite exposed stale future-version assertions, v3 fixtures containing a v5-only field, and concrete derived-field policy duplicated outside the registry. These were corrected at their ownership boundaries.
- The first browser run exceeded the command timeout at test 93 and left its fixture daemon running. The orphaned test-only processes were terminated, and the complete browser suite passed on the retry with a larger timeout.
- Final review made `GameService.setManualValues` required and updated structurally typed test doubles rather than retaining an unnecessary runtime compatibility branch.
- Checkpoint review found one unresolved race: after an in-flight prop refresh, a failed save can replace a newer local edit when that edit equals the old saved baseline. The Beads issue remains in progress until this state transition is corrected and reviewed.
- SJ-E05-001 now reconciles refreshed props into untouched drafts and saved baselines while retaining dirty drafts. It records the exact in-flight mutation and latest server snapshot so concurrent refreshes cannot overwrite submitted or repeated edits, failed saves remain retryable against the newest baseline, and successful independent sets or clears advance only their own baseline.
