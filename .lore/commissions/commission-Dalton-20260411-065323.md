---
title: "Commission: Fix code quality issues: curve-math duplication, local Axis type, ESLint type-checked tests"
date: 2026-04-11
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Fix three code quality issues in a single pass. All three are documented in `.lore/issues/` and affect overlapping packages.\n\n## 1. Move curve-math.ts to shared package\n**Issue:** `.lore/issues/curve-math-duplication.md`\n\n`curve-math.ts` (~100 lines) is duplicated between web and daemon packages. Move it to `packages/shared/` so both import from a single source. This matches the existing pattern for types and Zod schemas. Delete both copies after the shared version is in place and update all imports.\n\n## 2. Replace local Axis type in axes/page.tsx\n**Issue:** `.lore/issues/axes-page-local-type.md`\n\n`axes/page.tsx` defines its own local `Axis` type instead of importing from `@shelf-judge/shared`. Replace the local type with the shared import. Verify the local type's shape matches the shared one; if there are structural differences, reconcile them (shared type is canonical).\n\n## 3. Fix ESLint disableTypeChecked for web tests\n**Issue:** `.lore/issues/eslint-disable-type-checked-web-tests.md`\n\n`disableTypeChecked` was applied to web test files as a workaround for conflicting tsconfig settings. Fix the root cause: likely needs a separate `tsconfig.test.json` or adjusting the existing tsconfig to include test paths properly. Remove the `disableTypeChecked` workaround once the root cause is resolved.\n\n## Verification\n- Run `bun run typecheck` — must pass\n- Run `bun run lint` — must pass\n- Run `bun run test` — must pass\n- Grep for any remaining duplicates of curve-math logic across packages\n\n## After fixes\nUpdate all three issue files in `.lore/issues/` to `status: resolved`."
dependencies: []
linked_artifacts:
  - packages/shared/src/curve-math.ts

  - packages/shared/src/index.ts
  - packages/daemon/src/services/curve-engine.ts
  - packages/web/app/axes/page.tsx
  - packages/web/tsconfig.test.json
  - eslint.config.js
  - .lore/issues/curve-math-duplication.md
  - .lore/issues/axes-page-local-type.md
  - .lore/issues/eslint-disable-type-checked-web-tests.md
  - packages/shared/src/index.ts
  - packages/daemon/src/services/curve-engine.ts
  - packages/web/app/axes/page.tsx
  - packages/web/tsconfig.test.json
  - eslint.config.js
  - .lore/issues/curve-math-duplication.md
  - .lore/issues/axes-page-local-type.md
  - .lore/issues/eslint-disable-type-checked-web-tests.md
activity_timeline:
  - timestamp: 2026-04-11T13:53:23.961Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T13:53:23.962Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-11T13:53:23.986Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-11T13:53:30.945Z
    event: progress_report
    reason: "Starting three-issue code quality pass. Reading issue files and affected source files."
  - timestamp: 2026-04-11T13:54:54.373Z
    event: progress_report
    reason: "Context gathered. Executing: (1) Move shared curve-math functions to packages/shared/src/curve-math.ts, update daemon's curve-engine.ts to import+re-export from shared, delete web's lib/curve-math.ts. (2) Replace local Axis type in axes/page.tsx with shared import. (3) Fix ESLint disableTypeChecked by adding bun-types to web test tsconfig scope."
  - timestamp: 2026-04-11T13:59:00.902Z
    event: result_submitted
    reason: "Fixed all three code quality issues. Typecheck, lint, and tests (825 pass, 0 fail) all green.\n\n**1. curve-math.ts consolidated into shared package**\n- Created `packages/shared/src/curve-math.ts` with the pure math functions (getNativeScale, applyPreferenceCurve, calibrateTolerance, applyLean, constants)\n- Exported from `packages/shared/src/index.ts`\n- Daemon's `curve-engine.ts` now re-exports from shared, keeping only daemon-specific functions (checkVeto, computeHigherIsBetterEffective). All daemon imports unchanged.\n- Deleted `packages/web/lib/curve-math.ts`. Web imports from `@shelf-judge/shared` directly.\n\n**2. Local Axis type replaced in axes/page.tsx**\n- Removed the 15-line local `Axis` interface (lines 12-26). Verified it was structurally identical to the shared type (uses `AxisSource` vs literal `\"personal\" | \"bgg\"`, but equivalent).\n- Now imports `Axis` from `@shelf-judge/shared` alongside the other types.\n\n**3. ESLint disableTypeChecked removed, root cause fixed**\n- Created `packages/web/tsconfig.test.json` extending the web tsconfig with `\"types\": [\"bun-types\"]` scoped to `tests/`.\n- Updated `eslint.config.js`: replaced `disableTypeChecked` with a per-file override that uses `project` (not `projectService`) pointing to the test tsconfig. Web tests now get full type-aware lint coverage."
  - timestamp: 2026-04-11T13:59:06.121Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Context gathered. Executing: (1) Move shared curve-math functions to packages/shared/src/curve-math.ts, update daemon's curve-engine.ts to import+re-export from shared, delete web's lib/curve-math.ts. (2) Replace local Axis type in axes/page.tsx with shared import. (3) Fix ESLint disableTypeChecked by adding bun-types to web test tsconfig scope."
projectName: shelf-judge
---
Fixed all three code quality issues. Typecheck, lint, and tests (825 pass, 0 fail) all green.

**1. curve-math.ts consolidated into shared package**
- Created `packages/shared/src/curve-math.ts` with the pure math functions (getNativeScale, applyPreferenceCurve, calibrateTolerance, applyLean, constants)
- Exported from `packages/shared/src/index.ts`
- Daemon's `curve-engine.ts` now re-exports from shared, keeping only daemon-specific functions (checkVeto, computeHigherIsBetterEffective). All daemon imports unchanged.
- Deleted `packages/web/lib/curve-math.ts`. Web imports from `@shelf-judge/shared` directly.

**2. Local Axis type replaced in axes/page.tsx**
- Removed the 15-line local `Axis` interface (lines 12-26). Verified it was structurally identical to the shared type (uses `AxisSource` vs literal `"personal" | "bgg"`, but equivalent).
- Now imports `Axis` from `@shelf-judge/shared` alongside the other types.

**3. ESLint disableTypeChecked removed, root cause fixed**
- Created `packages/web/tsconfig.test.json` extending the web tsconfig with `"types": ["bun-types"]` scoped to `tests/`.
- Updated `eslint.config.js`: replaced `disableTypeChecked` with a per-file override that uses `project` (not `projectService`) pointing to the test tsconfig. Web tests now get full type-aware lint coverage.
