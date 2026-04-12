---
title: "Commission: Review: Niche champion display full implementation"
date: 2026-04-12
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the complete niche champion display implementation against the spec at `.lore/specs/niche-champion-display.md`.\n\nVerify every REQ-NICHE requirement (1-33) is addressed. Specifically check:\n1. Web and CLI client helpers both updated (client/daemon divergence check)\n2. Niche computation does not call external APIs or trigger profile recomputation\n3. Type exports consistent between shared, daemon, web, CLI\n4. Group by Niche view correctly intersects filters client-side\n5. Niche impact in search preview works for new niches (currentSize 0)\n6. Game links on neighbor names work (REQ-NICHE-21)\n7. No architectural violations (niche position doesn't feed prediction engine or modify profiling, REQ-NICHE-31/32)\n\nReport all findings."
dependencies:
  - commission-Dalton-20260411-174516
  - commission-Dalton-20260411-174522
linked_artifacts:
  - packages/daemon/src/services/niche-engine.ts

  - packages/daemon/src/routes/games.ts
  - packages/daemon/src/routes/prediction.ts
  - packages/shared/src/types.ts
  - packages/web/lib/api.ts
  - packages/web/app/games/[id]/page.tsx
  - packages/web/app/collection/page.tsx
  - packages/web/components/collection-table.tsx
  - packages/web/app/search/page.tsx
  - packages/cli/src/commands/score.ts
  - packages/cli/src/commands/predict.ts
  - packages/daemon/tests/niche-engine.test.ts
  - packages/daemon/src/routes/games.ts
  - packages/daemon/src/routes/prediction.ts
  - packages/shared/src/types.ts
  - packages/web/lib/api.ts
  - packages/web/app/games/[id]/page.tsx
  - packages/web/app/collection/page.tsx
  - packages/web/components/collection-table.tsx
  - packages/web/app/search/page.tsx
  - packages/cli/src/commands/score.ts
  - packages/cli/src/commands/predict.ts
  - packages/daemon/tests/niche-engine.test.ts
activity_timeline:
  - timestamp: 2026-04-12T00:45:32.859Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T00:45:32.861Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T01:09:31.786Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T01:09:31.789Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T01:09:31.812Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T01:09:38.086Z
    event: progress_report
    reason: "Starting review. Reading the niche champion display spec and identifying all REQ-NICHE requirements."
  - timestamp: 2026-04-12T01:10:55.521Z
    event: progress_report
    reason: "File inventory complete. Now reading core implementation files: shared types, niche-engine, daemon routes, web components, CLI commands, and tests."
  - timestamp: 2026-04-12T01:11:39.756Z
    event: progress_report
    reason: "Core files read. Checking remaining collection-table niche rendering, collection page server component, and GameWithScore type on shared. Now examining niche view rendering and CLI index for --show-niches flag."
  - timestamp: 2026-04-12T01:12:03.429Z
    event: progress_report
    reason: "All implementation files read. Now checking specific concerns: (1) type consistency between shared/daemon/web/cli, (2) niche engine purity and no external API calls, (3) architectural boundaries (REQ-NICHE-31/32), (4) search preview niche type imports. Recording findings as I go."
  - timestamp: 2026-04-12T01:15:26.490Z
    event: progress_report
    reason: "All 33 requirements verified. Two defects found, two design observations noted. Compiling final review now."
  - timestamp: 2026-04-12T01:16:06.274Z
    event: result_submitted
    reason: "## Niche Champion Display Review: 33 Requirements Verified\n\n### Defects\n\n**DEFECT-1: CLI `score get --json` omits niche position data (REQ-NICHE-28 violation)**\n\nFile: `packages/cli/src/commands/score.ts:116-125`\n\nREQ-NICHE-28 says: \"In `--json` mode, the response includes the full `NichePosition` object.\" The implementation fetches the score from `/api/games/:id/score` (a `ScoreGetResponse` which has no `nichePosition` field) and returns it at line 125 for JSON mode. The niche data fetch at line 175 only executes in text mode, after the JSON early return. JSON consumers get no niche data.\n\nFix: Either fetch `/api/games/:id` (which includes `nichePosition`) before the JSON early return and merge it, or switch the primary endpoint to `/api/games/:id` for both modes.\n\n---\n\n**DEFECT-2: `computeNicheImpact` double-counts games already in the collection**\n\nFile: `packages/daemon/src/routes/prediction.ts:66-72`, `packages/daemon/src/services/niche-engine.ts:262-268`\n\nWhen `predictBggGame` returns a game that already exists in the collection (delegating to `predictGame` internally), the prediction route passes `allGames` (which includes the existing game) and the same game as the candidate to `computeNicheImpact`. The function adds the candidate to each niche group via `sortAndRank([...group.games, { gws: candidateGws }])` without filtering the duplicate. The game appears twice, inflating niche sizes and producing incorrect projected ranks.\n\nFix: Either filter the candidate's game ID from `existingGamesWithScores` inside `computeNicheImpact`, or skip niche impact computation in the route when the game is already in the collection (since niche position data is already available through `/api/games/:id`).\n\n---\n\n### Requirement Coverage\n\nAll 33 REQ-NICHE requirements are addressed:\n\n| Req | Status | Notes |\n|-----|--------|-------|\n| 1-3 | Satisfied | Niche definition: mechanics, categories, families. Min 2 games. BggData required. |\n| 4-8 | Satisfied | Ranking: fitness descending, tie-sharing with skip, actual-over-predicted tiebreak, vetoed excluded, predicted flagged. |\n| 9-11 | Satisfied | Data model matches spec exactly. Above/below capped at 2. |\n| 12-13 | Satisfied | `/games/:id` returns nichePosition. `/games?includeNiches=true` computes in single pass. |\n| 14 | Satisfied with defect | `/predictions/bgg/:bggId` returns nicheImpact. New niches (currentSize 0) handled. Double-count bug for existing games (DEFECT-2). |\n| 15-17 | Satisfied | Pure-function module, correct signatures. No I/O, no service deps. |\n| 18-21 | Satisfied | Game detail panel, niche entries, sort by size, neighbor links, predicted indicators. |\n| 22-25 | Satisfied | Show Niches toggle, compact summary, Group by Niche view mode, client-side filter intersection. |\n| 26-27 | Satisfied | Search preview niche impact section with ordinal display and champion highlighting. |\n| 28 | Satisfied with defect | CLI text mode works. JSON mode omits niche data (DEFECT-1). |\n| 29-30 | Satisfied | `--show-niches` flag works. Predict bgg includes niche impact in text and JSON. |\n| 31-32 | Satisfied | Niche data doesn't participate in prediction engine or modify profiling. One-way dependency verified. |\n| 33 | Satisfied | Computed on demand, not cached. |\n\n### Design Observations\n\n**OBS-1: Collection page eagerly fetches niche data**\n\nFile: `packages/web/app/collection/page.tsx:30-34`\n\nThe server component calls `listGames({ includeNiches: true })` on every page load, even if the user never enables the niche toggle. This adds an API round-trip with full niche computation. Defensible for server component architecture (can't conditionally fetch based on client state), but worth noting if collection sizes grow large enough for niche computation to become measurable.\n\n**OBS-2: Niche positions unavailable when prediction service is down**\n\nFile: `packages/daemon/src/routes/games.ts:135-141`\n\nThe GET /games/:id route guards niche computation behind `if (predictionService)`. When the prediction service is unavailable, nichePosition is always null, even though niche ranking could work using actual-scored games from `gameService.listGames()`. REQ-NICHE-4 says predicted scores should be used when available, but doesn't say niche data should be entirely absent without them.\n\n### Implementation Quality Notes\n\n- Test coverage is solid: 18 test cases in `niche-engine.test.ts` covering grouping, ranking, tie-breaking, filtering, impact, determinism, and edge cases with a hand-constructed 9-game fixture.\n- The niche engine is well-structured as a pure-function module. No service layer coupling, easy to test.\n- The CLI's decision to use `score get` instead of a nonexistent `game <id>` command is a reasonable deviation, documented in the commission.\n- Type safety is strong across all packages. No `any` types in niche-related code."
  - timestamp: 2026-04-12T01:16:19.152Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All 33 requirements verified. Two defects found, two design observations noted. Compiling final review now."
projectName: shelf-judge
---
## Niche Champion Display Review: 33 Requirements Verified

### Defects

**DEFECT-1: CLI `score get --json` omits niche position data (REQ-NICHE-28 violation)**

File: `packages/cli/src/commands/score.ts:116-125`

REQ-NICHE-28 says: "In `--json` mode, the response includes the full `NichePosition` object." The implementation fetches the score from `/api/games/:id/score` (a `ScoreGetResponse` which has no `nichePosition` field) and returns it at line 125 for JSON mode. The niche data fetch at line 175 only executes in text mode, after the JSON early return. JSON consumers get no niche data.

Fix: Either fetch `/api/games/:id` (which includes `nichePosition`) before the JSON early return and merge it, or switch the primary endpoint to `/api/games/:id` for both modes.

---

**DEFECT-2: `computeNicheImpact` double-counts games already in the collection**

File: `packages/daemon/src/routes/prediction.ts:66-72`, `packages/daemon/src/services/niche-engine.ts:262-268`

When `predictBggGame` returns a game that already exists in the collection (delegating to `predictGame` internally), the prediction route passes `allGames` (which includes the existing game) and the same game as the candidate to `computeNicheImpact`. The function adds the candidate to each niche group via `sortAndRank([...group.games, { gws: candidateGws }])` without filtering the duplicate. The game appears twice, inflating niche sizes and producing incorrect projected ranks.

Fix: Either filter the candidate's game ID from `existingGamesWithScores` inside `computeNicheImpact`, or skip niche impact computation in the route when the game is already in the collection (since niche position data is already available through `/api/games/:id`).

---

### Requirement Coverage

All 33 REQ-NICHE requirements are addressed:

| Req | Status | Notes |
|-----|--------|-------|
| 1-3 | Satisfied | Niche definition: mechanics, categories, families. Min 2 games. BggData required. |
| 4-8 | Satisfied | Ranking: fitness descending, tie-sharing with skip, actual-over-predicted tiebreak, vetoed excluded, predicted flagged. |
| 9-11 | Satisfied | Data model matches spec exactly. Above/below capped at 2. |
| 12-13 | Satisfied | `/games/:id` returns nichePosition. `/games?includeNiches=true` computes in single pass. |
| 14 | Satisfied with defect | `/predictions/bgg/:bggId` returns nicheImpact. New niches (currentSize 0) handled. Double-count bug for existing games (DEFECT-2). |
| 15-17 | Satisfied | Pure-function module, correct signatures. No I/O, no service deps. |
| 18-21 | Satisfied | Game detail panel, niche entries, sort by size, neighbor links, predicted indicators. |
| 22-25 | Satisfied | Show Niches toggle, compact summary, Group by Niche view mode, client-side filter intersection. |
| 26-27 | Satisfied | Search preview niche impact section with ordinal display and champion highlighting. |
| 28 | Satisfied with defect | CLI text mode works. JSON mode omits niche data (DEFECT-1). |
| 29-30 | Satisfied | `--show-niches` flag works. Predict bgg includes niche impact in text and JSON. |
| 31-32 | Satisfied | Niche data doesn't participate in prediction engine or modify profiling. One-way dependency verified. |
| 33 | Satisfied | Computed on demand, not cached. |

### Design Observations

**OBS-1: Collection page eagerly fetches niche data**

File: `packages/web/app/collection/page.tsx:30-34`

The server component calls `listGames({ includeNiches: true })` on every page load, even if the user never enables the niche toggle. This adds an API round-trip with full niche computation. Defensible for server component architecture (can't conditionally fetch based on client state), but worth noting if collection sizes grow large enough for niche computation to become measurable.

**OBS-2: Niche positions unavailable when prediction service is down**

File: `packages/daemon/src/routes/games.ts:135-141`

The GET /games/:id route guards niche computation behind `if (predictionService)`. When the prediction service is unavailable, nichePosition is always null, even though niche ranking could work using actual-scored games from `gameService.listGames()`. REQ-NICHE-4 says predicted scores should be used when available, but doesn't say niche data should be entirely absent without them.

### Implementation Quality Notes

- Test coverage is solid: 18 test cases in `niche-engine.test.ts` covering grouping, ranking, tie-breaking, filtering, impact, determinism, and edge cases with a hand-constructed 9-game fixture.
- The niche engine is well-structured as a pure-function module. No service layer coupling, easy to test.
- The CLI's decision to use `score get` instead of a nonexistent `game <id>` command is a reasonable deviation, documented in the commission.
- Type safety is strong across all packages. No `any` types in niche-related code.

## Decisions

**Does computeNicheImpact double-count when the candidate game already exists in the collection?**
Yes. This is a defect. When `predictBggGame` returns an existing collection game, the prediction route passes `allGames` (which includes the game) AND the same game as `candidateGame` to `computeNicheImpact`. The game gets added twice to each niche group, producing inflated sizes and incorrect projected ranks.
*Reasoning: Traced through prediction.ts:66-72. When bggId matches an existing game, `predictBggGame` delegates to `predictGame(existingGame.id)`, returning the existing game. `allGames` from `listGamesWithPredictions()` also contains this game. In `computeNicheImpact`, `buildAttributeIndex(eligible)` includes the game, then `sortAndRank([...group.games, { gws: candidateGws }])` adds it again. The candidate is never filtered from the existing games array.*

**Are all 5 niche types consistently exported across shared, daemon, web, and CLI?**
Yes. NichePosition, NicheEntry, NicheNeighbor, NicheImpact, NicheImpactEntry all defined in shared/types.ts (lines 422-467), imported in daemon routes, web api.ts (re-exported), web page components, and CLI commands.
*Reasoning: Verified imports: daemon/niche-engine.ts:4-13, web/lib/api.ts:18-22 (import) and 257-261 (re-export), web/games/[id]/page.tsx:10-12, web/search/page.tsx:9, cli/score.ts:5, cli/predict.ts:5.*

**Does the collection page eagerly fetch niche data before the user requests it?**
Yes. collection/page.tsx:31 calls `listGames({ includeNiches: true })` unconditionally on every page load, even though the user may never toggle niches on. This adds an extra API round-trip with full niche computation on every visit.
*Reasoning: The server component at collection/page.tsx:30-34 fetches `nicheGames` inside a try-catch alongside predictions and tournament stats. Since this is a server component, it can't conditionally fetch based on client state. The design trades an extra request for simpler data flow (no client-side refetch). This is defensible but worth noting as a performance consideration for large collections.*

**Does the niche view correctly intersect with filters client-side (REQ-NICHE-25)?**
Yes, correctly implemented. The nicheGroups memo at collection-table.tsx:202-237 iterates over the `filtered` array (already filtered by matchesFilters), builds groups from their nichePosition entries, discards groups with <2 filtered members, and sorts by size descending.
*Reasoning: The filter flow is: activeGames (with merged niche data) → filtered (via matchesFilters) → nicheGroups (built from filtered only). Groups respect the active filter set. A niche with 5 total games but only 1 passing the filter is discarded.*

**Does the niche engine call external APIs or trigger profile recomputation?**
No. The niche engine is a pure-function module. No imports of bgg-client, storage-service, profile-engine, or any HTTP/IO modules. It takes GameWithScore[] in and returns Map or NicheImpact out.
*Reasoning: Inspected niche-engine.ts imports: only shared types. No service dependencies, no async functions, no side effects.*

**Does the GET /games/:id route return null nichePosition when predictionService is unavailable?**
Yes. games.ts:139-141: when predictionService is undefined, nichePosition is set to null. However, this means niche positions are unavailable entirely when the prediction service is down, even though niche computation only needs fitness scores from non-predicted games.
*Reasoning: The route guards niche computation behind `if (predictionService)` because it calls `predictionService.listGamesWithPredictions()` to get the full game list including predicted scores. But REQ-NICHE-4 says "For games with predicted scores, the predicted fitness score is used for ranking." Without predicted scores, niche ranking could still work for actual-scored games using `gameService.listGames()`. This is a minor gap: niche positions are unnecessarily unavailable when predictions are down.*

**Does the CLI scoreGet --json mode include niche position data?**
No. The JSON output for `score get <id>` returns the ScoreGetResponse from `/api/games/:id/score`, not the full GameWithScore from `/api/games/:id`. The score endpoint doesn't include nichePosition. The niche data is only fetched in text mode (score.ts:175) and appended to the text output. In JSON mode, the function returns at line 125 before niche data is fetched.
*Reasoning: REQ-NICHE-28 says "In --json mode, the response includes the full NichePosition object." But the JSON response comes from the score endpoint (ScoreGetResponse type, line 93-104) which has no nichePosition field. The nicheRes fetch at line 175 only happens in text mode (after the JSON early return at line 125). To fix: either fetch nichePosition before the JSON early return and merge it into the response, or change the endpoint to `/api/games/:id` which includes nichePosition.*
