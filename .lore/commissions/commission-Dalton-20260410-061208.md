---
title: "Commission: Fix: Clear Axis Value and Revert to BGG"
date: 2026-04-10
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Two bugs to fix from `.lore/issues/clear-value.md`:\n\n1. **Clearing an axis value on a game doesn't save.** When a user clears the value (sets it to empty/null), the cleared state should persist. Right now it seems like clearing in the UX doesn't actually get saved, so the old value reappears.\n\n2. **\"Revert to BGG\" button for BGG-derived axes doesn't work.** These buttons should reset the axis value back to the BGG-derived value.\n\n## Investigation approach\n\nStart by reading the relevant code to understand the data flow:\n- Web UI: how axis values are edited and submitted (look in the game detail page or wherever ratings are edited)\n- Daemon API: how axis value updates are received and persisted (look at the rating/scoring routes and services)\n- Shared types: what the schema says about nullable/optional axis values\n\nThe root cause is likely one of:\n- The UI doesn't send a null/undefined value when clearing (it might skip the field or send empty string)\n- The API/service layer treats null/undefined as \"no change\" instead of \"clear this value\"\n- The Zod schema rejects null values\n- The \"Revert to BGG\" button's click handler isn't wired up or sends the wrong payload\n\n## Requirements\n- Clearing an axis value must persist (the value should be removed/set to null)\n- \"Revert to BGG\" must reset to the BGG-derived value\n- Write tests covering both scenarios\n- Run full test suite, typecheck, and lint before declaring done\n- Update `.lore/issues/clear-value.md` status to `resolved` when complete"
dependencies: []
linked_artifacts:
  - packages/daemon/src/routes/games.ts

  - packages/daemon/src/services/game-service.ts
  - packages/web/components/rating-form.tsx
  - packages/daemon/tests/services/game-service.test.ts
  - packages/daemon/tests/routes/games.test.ts
  - .lore/issues/clear-value.md
  - packages/daemon/src/services/game-service.ts
  - packages/web/components/rating-form.tsx
  - packages/daemon/tests/services/game-service.test.ts
  - packages/daemon/tests/routes/games.test.ts
  - .lore/issues/clear-value.md
activity_timeline:
  - timestamp: 2026-04-10T13:12:08.617Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T13:12:08.620Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T13:12:08.644Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T13:12:15.879Z
    event: progress_report
    reason: "Starting investigation: reading the issue file and relevant source code to understand the axis value clearing and \"Revert to BGG\" bugs."
  - timestamp: 2026-04-10T13:14:34.965Z
    event: progress_report
    reason: "Root cause identified. Both bugs share the same fix: the `rateGame` API only accepts numbers (no null), so there's no way to clear a rating. The UI correctly removes keys from local state on clear/revert, but the daemon ignores absent keys. Now implementing the fix across 4 files: validation schema, route schema, service logic, and UI form."
  - timestamp: 2026-04-10T13:16:20.084Z
    event: result_submitted
    reason: "Fixed both bugs. Root cause was shared: the `rateGame` API only accepted numeric values, so there was no way to express \"clear this rating.\"\n\n**Changes:**\n\n1. **`packages/daemon/src/routes/games.ts`** - `RatingsBodySchema` now accepts `null` alongside `number` for rating values\n2. **`packages/daemon/src/services/game-service.ts`** - `rateGame` signature accepts `Record<string, number | null>`. When a rating is `null`, it deletes the key from `game.ratings` instead of setting it\n3. **`packages/web/components/rating-form.tsx`** - `handleSubmit` now sends `null` for any axis that had a rating in `currentRatings` but no longer has one in the form state. This covers both clearing a personal axis value (emptying the input) and clicking \"Revert to BGG\" (which deletes the key from local state)\n4. **`.lore/issues/clear-value.md`** - Status updated to `resolved`\n\n**Tests added (4 new tests):**\n- Service: null rating clears an existing rating\n- Service: null rating for axis without existing rating is a no-op\n- Service: can set some ratings and clear others in one call\n- Route: null rating clears an existing rating via PUT endpoint\n\n**Verification:** 600 tests pass, typecheck clean, lint clean."
  - timestamp: 2026-04-10T13:16:26.790Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Root cause identified. Both bugs share the same fix: the `rateGame` API only accepts numbers (no null), so there's no way to clear a rating. The UI correctly removes keys from local state on clear/revert, but the daemon ignores absent keys. Now implementing the fix across 4 files: validation schema, route schema, service logic, and UI form."
projectName: shelf-judge
---
Fixed both bugs. Root cause was shared: the `rateGame` API only accepted numeric values, so there was no way to express "clear this rating."

**Changes:**

1. **`packages/daemon/src/routes/games.ts`** - `RatingsBodySchema` now accepts `null` alongside `number` for rating values
2. **`packages/daemon/src/services/game-service.ts`** - `rateGame` signature accepts `Record<string, number | null>`. When a rating is `null`, it deletes the key from `game.ratings` instead of setting it
3. **`packages/web/components/rating-form.tsx`** - `handleSubmit` now sends `null` for any axis that had a rating in `currentRatings` but no longer has one in the form state. This covers both clearing a personal axis value (emptying the input) and clicking "Revert to BGG" (which deletes the key from local state)
4. **`.lore/issues/clear-value.md`** - Status updated to `resolved`

**Tests added (4 new tests):**
- Service: null rating clears an existing rating
- Service: null rating for axis without existing rating is a no-op
- Service: can set some ratings and clear others in one call
- Route: null rating clears an existing rating via PUT endpoint

**Verification:** 600 tests pass, typecheck clean, lint clean.
