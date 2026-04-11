---
title: "Commission: Prediction Preview on Search Results"
date: 2026-04-11
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "## Task\n\nAdd a \"Preview\" button to BGG search results that shows predicted fitness scores before adding a game to the collection.\n\n## Context\n\nThe prediction engine (`packages/daemon/src/services/prediction-engine.ts`, `prediction-service.ts`) works, but only for games already in the collection. The user wants to see predicted fitness from search results before deciding to add a game. The BGG API throttle means this can't be auto-loaded for all results; it needs a click-to-preview interaction.\n\nRead the prediction engine spec at `.lore/specs/prediction-engine.md` for full context on how predictions work.\n\n## What to Build\n\n### 1. Daemon: New endpoint `GET /predictions/bgg/:bggId`\n\nAdd a `predictBggGame(bggId: number)` method to the `PredictionService` interface and implementation in `packages/daemon/src/services/prediction-service.ts`.\n\nThis method should:\n- Use `bggClient.getGame(bggId)` to fetch BGG data for the game (the BggClient is available via the game service deps; you'll need to add it to PredictionServiceDeps or route it through)\n- Check if this bggId already exists in the collection. If so, redirect/delegate to the existing `predictGame(gameId)` path\n- Build a temporary `Game` object from the BGG result (not persisted)\n- Call `loadPredictionContext()` to get the collection's vocabulary, ranges, reference games, etc.\n- Encode the temporary game's feature vector using the collection's vocabulary and ranges\n- Run `computePredictedFitness` against it\n- Run `detectRevealedPreferenceTension` if tournament data exists\n- Return the same `PredictedGameResult` shape, with the temporary game object\n\nAdd the route in `packages/daemon/src/routes/prediction.ts`:\n```\nGET /predictions/bgg/:bggId\n```\n\nThe route should return 422 if BGG data fetch fails, 404 if the bggId doesn't exist on BGG, and the standard prediction result on success.\n\n### 2. Web: Add proxy route\n\nAdd `packages/web/app/api/daemon/predictions/bgg/[bggId]/route.ts` to proxy to the daemon endpoint (follow the pattern of existing proxy routes in `packages/web/app/api/daemon/`).\n\n### 3. Web: Add API helper\n\nIn `packages/web/lib/api.ts`, add a `predictBggGame(bggId: number)` function that calls the new proxy route.\n\n### 4. Web: Preview button on search results\n\nModify `packages/web/app/search/page.tsx`:\n- Add a \"Preview\" button next to each search result's \"Add\" button\n- When clicked, fetch the prediction for that bggId\n- Show the predicted score inline (score with confidence badge, similar to how the collection table shows predictions)\n- Show a loading state while fetching (BGG throttle makes this slow)\n- If prediction is unavailable (Stage 0, no axes configured), show a message explaining why\n- If the game is already in the collection, show \"Already in collection\" with a link to the game detail page\n\nThe preview should expand below the search result row, showing:\n- Predicted fitness score with confidence badge\n- Per-axis breakdown (compact, maybe just axis name + predicted rating + confidence)\n- A note about prediction confidence stage if relevant\n\nKeep the \"Add\" button functional. After previewing, the user can still click \"Add\" to add the game.\n\n### 5. CLI: `shelf-judge predict bgg <bggId>`\n\nIn `packages/cli/src/commands/predict.ts`, add a subcommand or option that accepts a BGG ID instead of a collection game ID. It calls the new daemon endpoint and displays the prediction breakdown the same way the existing `predict` command does.\n\n### 6. Types\n\nAdd the new endpoint to the operation definitions in the prediction routes file.\n\nIf the `PredictedGameResult` type needs a `bggId` field or any extension for the preview case, add it. The temporary Game object should have a synthetic ID (like `preview-{bggId}`) so it's clear it's not persisted.\n\n## Testing\n\n- Unit tests for `predictBggGame` in the prediction service (mock the bggClient)\n- Test the case where bggId already exists in collection (should return existing game's prediction)\n- Test the case where bggId doesn't exist on BGG (404)\n- Test the case where BGG data has no mechanics/categories (should still produce a prediction, possibly with weak/insufficient confidence)\n- Test the route handler\n- Web component tests are optional but the search page preview interaction should work correctly\n\n## Constraints\n\n- Do NOT auto-fetch predictions for all search results. Only fetch on \"Preview\" click.\n- The temporary Game object must NOT be persisted to storage.\n- Follow existing code patterns (dependency injection, error handling via toErrorMessage, etc.)\n- Run `bun run test`, `bun run typecheck`, `bun run lint` before declaring done."
dependencies: []
linked_artifacts:
  - packages/daemon/src/services/prediction-service.ts

  - packages/daemon/src/routes/prediction.ts
  - packages/daemon/src/index.ts
  - packages/web/lib/api.ts
  - packages/web/app/search/page.tsx
  - packages/web/app/globals.css
  - packages/cli/src/commands/predict.ts
  - packages/cli/src/index.ts
  - packages/daemon/tests/services/prediction-service.test.ts
  - packages/daemon/tests/routes/prediction.test.ts
  - packages/daemon/tests/helpers/test-app.ts
  - packages/daemon/src/routes/prediction.ts
  - packages/daemon/src/index.ts
  - packages/web/lib/api.ts
  - packages/web/app/search/page.tsx
  - packages/web/app/globals.css
  - packages/cli/src/commands/predict.ts
  - packages/cli/src/index.ts
  - packages/daemon/tests/services/prediction-service.test.ts
  - packages/daemon/tests/routes/prediction.test.ts
  - packages/daemon/tests/helpers/test-app.ts
activity_timeline:
  - timestamp: 2026-04-11T06:20:57.205Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T06:20:57.209Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-11T06:20:57.233Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-11T06:21:04.508Z
    event: progress_report
    reason: "Starting commission: BGG Preview Predictions. Reading codebase to understand existing patterns before implementation."
  - timestamp: 2026-04-11T06:23:37.739Z
    event: progress_report
    reason: "Context gathered. I have full understanding of the codebase. The prediction service needs bggClient added to its deps. Starting implementation across 6 areas: daemon service, daemon route, web proxy, web API helper, web search page, and CLI predict command."
  - timestamp: 2026-04-11T06:27:10.760Z
    event: progress_report
    reason: "Implementation complete across all 6 areas. Typechecks pass. Writing unit tests for predictBggGame service method."
  - timestamp: 2026-04-11T06:30:28.235Z
    event: progress_report
    reason: "All implementation complete. 825 tests pass, 0 fail. Typecheck clean. Lint clean. Format clean on all modified files. Ready to submit."
  - timestamp: 2026-04-11T06:30:54.945Z
    event: result_submitted
    reason: "BGG Preview Predictions feature implemented across all layers.\n\n## What was built\n\n### 1. Daemon: `predictBggGame(bggId)` service method\n- Added `bggClient` to `PredictionServiceDeps` interface\n- New method fetches BGG data via `bggClient.getGame(bggId)`, builds a temporary `Game` object (ID: `preview-{bggId}`, not persisted), encodes it against the collection's vocabulary/ranges, and runs `computePredictedFitness` + `detectRevealedPreferenceTension`\n- When the bggId already exists in the collection, delegates to `predictGame(existingGameId)`\n- Returns the same `PredictedGameResult` shape as `predictGame`\n\n### 2. Daemon: `GET /predictions/bgg/:bggId` route\n- Added before the `/:gameId` route to avoid parameter conflict\n- Returns 400 for invalid BGG ID, 404 when BGG ID doesn't exist, 503 when BGG not configured, 422 for parse/fetch errors\n- Added operation definition `shelf.prediction.predict-bgg`\n\n### 3. Daemon wiring\n- Updated `packages/daemon/src/index.ts` to pass `bggClient` to `createPredictionService`\n- Updated `packages/daemon/tests/helpers/test-app.ts` to pass `bggClient` to `createPredictionService`\n\n### 4. Web: API helper\n- Added `predictBggGame(bggId: number)` in `packages/web/lib/api.ts`\n- The catch-all proxy route at `packages/web/app/api/daemon/[...path]/route.ts` already handles this path (no new proxy route needed)\n\n### 5. Web: Search page preview\n- Added Preview button next to each search result's Add button\n- Click-to-preview: fetches prediction on demand (not auto-loaded)\n- Toggle behavior: clicking Preview again hides the panel\n- Loading, error, and loaded states\n- Preview panel shows: predicted fitness score with confidence badge, prediction metadata (stage, predicted/actual counts, coverage), per-axis breakdown with confidence badges, revealed preference tension when present\n- Stage 0 message explaining predictions are unavailable\n- \"Already in collection\" link when game exists in collection\n- Added CSS styles for preview panel, confidence badges, breakdown rows\n\n### 6. CLI: `predict bgg <bgg-id>` command\n- Added `predictBggGame` function in `packages/cli/src/commands/predict.ts`\n- Wired as `predict bgg` (2-token command) in CLI index\n- Same output format as `predict`, with \"(already in collection)\" annotation and stage-0 handling\n\n### 7. Tests (12 new tests)\n- **Service tests** (7 new): prediction for new BGG game, delegation for existing collection game, BGG 404, no bggClient configured, empty mechanics/categories, no persistence of temp game, stage-0 behavior\n- **Route tests** (5 new): successful BGG prediction, existing collection game, BGG 404, invalid BGG ID (400), BGG not configured (503)\n\n## Verification\n- 825 tests pass, 0 fail, 1 skip (pre-existing)\n- TypeScript strict typecheck: clean\n- ESLint: clean\n- Prettier: clean on all modified files"
  - timestamp: 2026-04-11T06:31:02.455Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All implementation complete. 825 tests pass, 0 fail. Typecheck clean. Lint clean. Format clean on all modified files. Ready to submit."
projectName: shelf-judge
---
BGG Preview Predictions feature implemented across all layers.

## What was built

### 1. Daemon: `predictBggGame(bggId)` service method
- Added `bggClient` to `PredictionServiceDeps` interface
- New method fetches BGG data via `bggClient.getGame(bggId)`, builds a temporary `Game` object (ID: `preview-{bggId}`, not persisted), encodes it against the collection's vocabulary/ranges, and runs `computePredictedFitness` + `detectRevealedPreferenceTension`
- When the bggId already exists in the collection, delegates to `predictGame(existingGameId)`
- Returns the same `PredictedGameResult` shape as `predictGame`

### 2. Daemon: `GET /predictions/bgg/:bggId` route
- Added before the `/:gameId` route to avoid parameter conflict
- Returns 400 for invalid BGG ID, 404 when BGG ID doesn't exist, 503 when BGG not configured, 422 for parse/fetch errors
- Added operation definition `shelf.prediction.predict-bgg`

### 3. Daemon wiring
- Updated `packages/daemon/src/index.ts` to pass `bggClient` to `createPredictionService`
- Updated `packages/daemon/tests/helpers/test-app.ts` to pass `bggClient` to `createPredictionService`

### 4. Web: API helper
- Added `predictBggGame(bggId: number)` in `packages/web/lib/api.ts`
- The catch-all proxy route at `packages/web/app/api/daemon/[...path]/route.ts` already handles this path (no new proxy route needed)

### 5. Web: Search page preview
- Added Preview button next to each search result's Add button
- Click-to-preview: fetches prediction on demand (not auto-loaded)
- Toggle behavior: clicking Preview again hides the panel
- Loading, error, and loaded states
- Preview panel shows: predicted fitness score with confidence badge, prediction metadata (stage, predicted/actual counts, coverage), per-axis breakdown with confidence badges, revealed preference tension when present
- Stage 0 message explaining predictions are unavailable
- "Already in collection" link when game exists in collection
- Added CSS styles for preview panel, confidence badges, breakdown rows

### 6. CLI: `predict bgg <bgg-id>` command
- Added `predictBggGame` function in `packages/cli/src/commands/predict.ts`
- Wired as `predict bgg` (2-token command) in CLI index
- Same output format as `predict`, with "(already in collection)" annotation and stage-0 handling

### 7. Tests (12 new tests)
- **Service tests** (7 new): prediction for new BGG game, delegation for existing collection game, BGG 404, no bggClient configured, empty mechanics/categories, no persistence of temp game, stage-0 behavior
- **Route tests** (5 new): successful BGG prediction, existing collection game, BGG 404, invalid BGG ID (400), BGG not configured (503)

## Verification
- 825 tests pass, 0 fail, 1 skip (pre-existing)
- TypeScript strict typecheck: clean
- ESLint: clean
- Prettier: clean on all modified files

## Decisions

**What patterns should I follow for adding BGG preview predictions across web, CLI, and daemon?**
Explored web proxy pattern, API helpers, CLI daemon client, and daemon route/service architecture. Ready to implement across all three layers following established patterns.
*Reasoning: Systematic exploration of all three client/server implementations reveals consistent patterns for adding new API features. This foundational understanding ensures implementation aligns with existing conventions.*
