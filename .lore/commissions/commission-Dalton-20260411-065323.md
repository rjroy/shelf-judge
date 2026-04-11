---
title: "Commission: Fix code quality issues: curve-math duplication, local Axis type, ESLint type-checked tests"
date: 2026-04-11
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Fix three code quality issues in a single pass. All three are documented in `.lore/issues/` and affect overlapping packages.\n\n## 1. Move curve-math.ts to shared package\n**Issue:** `.lore/issues/curve-math-duplication.md`\n\n`curve-math.ts` (~100 lines) is duplicated between web and daemon packages. Move it to `packages/shared/` so both import from a single source. This matches the existing pattern for types and Zod schemas. Delete both copies after the shared version is in place and update all imports.\n\n## 2. Replace local Axis type in axes/page.tsx\n**Issue:** `.lore/issues/axes-page-local-type.md`\n\n`axes/page.tsx` defines its own local `Axis` type instead of importing from `@shelf-judge/shared`. Replace the local type with the shared import. Verify the local type's shape matches the shared one; if there are structural differences, reconcile them (shared type is canonical).\n\n## 3. Fix ESLint disableTypeChecked for web tests\n**Issue:** `.lore/issues/eslint-disable-type-checked-web-tests.md`\n\n`disableTypeChecked` was applied to web test files as a workaround for conflicting tsconfig settings. Fix the root cause: likely needs a separate `tsconfig.test.json` or adjusting the existing tsconfig to include test paths properly. Remove the `disableTypeChecked` workaround once the root cause is resolved.\n\n## Verification\n- Run `bun run typecheck` — must pass\n- Run `bun run lint` — must pass\n- Run `bun run test` — must pass\n- Grep for any remaining duplicates of curve-math logic across packages\n\n## After fixes\nUpdate all three issue files in `.lore/issues/` to `status: resolved`."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-11T13:53:23.961Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T13:53:23.962Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
