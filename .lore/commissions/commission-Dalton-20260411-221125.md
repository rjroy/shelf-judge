---
title: "Commission: Fix: Niche tag filtering P1-5 review findings"
date: 2026-04-12
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Read Thorne's review of the niche tag filtering Phases 1-5 implementation. The review commission is `commission-Thorne-20260411-221118`. Check `.lore/commissions/` for the review artifact.\n\nAddress ALL findings before doing anything else. The plan is at `.lore/plans/niche-tag-filtering.md` for reference.\n\nRun `bun run test`, `bun run typecheck`, and `bun run lint` after all fixes."
dependencies:
  - commission-Thorne-20260411-221118
linked_artifacts:
  - packages/daemon/src/routes/niche.ts

  - packages/daemon/src/services/niche-engine.ts
  - packages/daemon/tests/niche-settings-routes.test.ts
  - packages/daemon/tests/niche-settings-integration.test.ts
  - packages/daemon/src/services/niche-engine.ts
  - packages/daemon/tests/niche-settings-routes.test.ts
  - packages/daemon/tests/niche-settings-integration.test.ts
activity_timeline:
  - timestamp: 2026-04-12T05:11:25.485Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T05:19:25.235Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T05:22:15.961Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T05:22:15.965Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T05:22:15.987Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T05:22:28.713Z
    event: progress_report
    reason: "Read Thorne's review. Three findings to address: (1) PATCH endpoint allows arbitrary property injection, (2) Missing integration tests for settings passthrough, (3) Redundant ignoreSet construction. Reading the affected files now."
  - timestamp: 2026-04-12T05:25:10.721Z
    event: progress_report
    reason: "All three findings addressed: (1) PATCH endpoint now strips unknown keys, (2) Added integration tests for GET /games/:id and GET /predictions/bgg/:bggId with niche settings passthrough, (3) Extracted buildIgnoreSet helper to eliminate redundant Set construction. Running tests now."
  - timestamp: 2026-04-12T05:27:19.130Z
    event: result_submitted
    reason: "## Thorne's Review Findings: All Addressed\n\n### Finding 1: PATCH endpoint arbitrary property injection (Defect)\n**Fix**: `packages/daemon/src/routes/niche.ts:70-76`. Replaced `{ ...current, ...patch }` spread with explicit key-picking that only merges `ignoredTags` from the patch body. Unknown keys are now silently dropped instead of persisted.\n\n**Test**: Added \"strips unknown properties from patch\" test to `niche-settings-routes.test.ts` verifying both response and stored state exclude arbitrary keys.\n\n### Finding 2: Missing integration tests for settings passthrough (Coverage gap)\n**Fix**: Created `packages/daemon/tests/niche-settings-integration.test.ts` with two integration tests:\n- GET /games/:id with ignored tags verifies niche positions exclude the filtered mechanic\n- GET /predictions/bgg/:bggId with ignored tags verifies niche impact excludes the filtered mechanic\n\nBoth tests stand up the actual route handlers with mock services that return controlled game data, then compare behavior with and without ignored tags to prove the settings actually flow through to the niche engine.\n\n### Finding 3: Redundant ignoreSet construction (Style)\n**Fix**: `packages/daemon/src/services/niche-engine.ts:100-102`. Extracted `buildIgnoreSet()` helper. Changed `buildAttributeIndex` to accept a `Set<string>` instead of `NicheTagFilter[]`. Both `computeNichePositions` and `computeNicheImpact` now build the set once and pass it to `buildAttributeIndex` and the candidate tag loop, eliminating the duplicate construction.\n\n### Verification\n- `bun run test`: 928 pass, 0 fail, 1 skip (929 total across 53 files)\n- `bun run typecheck`: clean\n- `bun run lint`: clean"
  - timestamp: 2026-04-12T05:27:24.055Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All three findings addressed: (1) PATCH endpoint now strips unknown keys, (2) Added integration tests for GET /games/:id and GET /predictions/bgg/:bggId with niche settings passthrough, (3) Extracted buildIgnoreSet helper to eliminate redundant Set construction. Running tests now."
projectName: shelf-judge
---
## Thorne's Review Findings: All Addressed

### Finding 1: PATCH endpoint arbitrary property injection (Defect)
**Fix**: `packages/daemon/src/routes/niche.ts:70-76`. Replaced `{ ...current, ...patch }` spread with explicit key-picking that only merges `ignoredTags` from the patch body. Unknown keys are now silently dropped instead of persisted.

**Test**: Added "strips unknown properties from patch" test to `niche-settings-routes.test.ts` verifying both response and stored state exclude arbitrary keys.

### Finding 2: Missing integration tests for settings passthrough (Coverage gap)
**Fix**: Created `packages/daemon/tests/niche-settings-integration.test.ts` with two integration tests:
- GET /games/:id with ignored tags verifies niche positions exclude the filtered mechanic
- GET /predictions/bgg/:bggId with ignored tags verifies niche impact excludes the filtered mechanic

Both tests stand up the actual route handlers with mock services that return controlled game data, then compare behavior with and without ignored tags to prove the settings actually flow through to the niche engine.

### Finding 3: Redundant ignoreSet construction (Style)
**Fix**: `packages/daemon/src/services/niche-engine.ts:100-102`. Extracted `buildIgnoreSet()` helper. Changed `buildAttributeIndex` to accept a `Set<string>` instead of `NicheTagFilter[]`. Both `computeNichePositions` and `computeNicheImpact` now build the set once and pass it to `buildAttributeIndex` and the candidate tag loop, eliminating the duplicate construction.

### Verification
- `bun run test`: 928 pass, 0 fail, 1 skip (929 total across 53 files)
- `bun run typecheck`: clean
- `bun run lint`: clean
