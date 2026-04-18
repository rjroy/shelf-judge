---
title: "Implementation plan: tournament-ranking"
date: 2026-04-06
status: executed
tags: [plan, tournament, elo, ranking, pairwise]
modules: [shared, daemon, web, cli]
related:
  - .lore/specs/tournament/tournament-ranking.md
  - .lore/designs/mvp-data-model.md
  - .lore/designs/mvp-api-surface.md
  - .lore/mockups/ (tournament-*.html)
---

# Plan: Tournament-Based ELO Ranking

## Spec Reference

**Spec**: `.lore/specs/tournament/tournament-ranking.md`
**Visual mockups**: `.lore/mockups/ (tournament-*.html)` (4 HTML mockups: session start, filter builder, filter preview, active comparison)

Requirements addressed:

- REQ-TOURN-1: Comparison entity → Phase 1
- REQ-TOURN-2: TournamentSession entity → Phase 1
- REQ-TOURN-3: tournament.json storage → Phase 1
- REQ-TOURN-4: Per-game eloRating and comparisonCount → Phase 1
- REQ-TOURN-5: Standard ELO formula → Phase 2
- REQ-TOURN-6: K-factor with configurable threshold → Phase 2
- REQ-TOURN-7: Recalculate from history → Phase 2
- REQ-TOURN-8: Deleted game comparison retention → Phase 2, Phase 3
- REQ-TOURN-9: ELO normalization to 1.0-10.0 → Phase 2
- REQ-TOURN-10: Dual score display (axis + tournament) → Phase 5, Phase 6
- REQ-TOURN-11: Tournament rank breakdown → Phase 3, Phase 5, Phase 6
- REQ-TOURN-12: Session start with filters → Phase 3
- REQ-TOURN-13: Minimum 4 games → Phase 3
- REQ-TOURN-14: Adaptive pairing → Phase 3
- REQ-TOURN-15: Single active session → Phase 3
- REQ-TOURN-15a: Mid-session game deletion → Phase 3
- REQ-TOURN-16: Comparison presentation (names, thumbnails, winner) → Phase 4, Phase 5
- REQ-TOURN-17: Collection sort by tournament rank → Phase 5, Phase 6
- REQ-TOURN-18: Score divergence flag → Phase 5, Phase 6
- REQ-TOURN-19: API routes → Phase 4
- REQ-TOURN-20: CLI commands → Phase 6

## Codebase Context

### Architecture

Bun monorepo, four workspace packages. The daemon owns all data via services injected through factory functions. Web talks to daemon over Unix socket (Node `http` module in `lib/daemon.ts`). CLI talks to daemon over Unix socket (Bun `fetch` with `unix` option). Shared types and Zod schemas in `packages/shared/`.

### Existing Patterns

**Service layer**: Each domain has a service interface and `create*Service(deps)` factory. Services receive `StorageService` and peer services via dependency injection. No classes, just closures over deps. See `game-service.ts`, `axis-service.ts`, `fitness-service.ts`.

**Storage**: `StorageService` handles `collection.json` with atomic writes (temp file + rename via `file-ops.ts`). Tournament data gets the same pattern in a new `tournament.json` file.

**Routes**: Each route module exports `{ routes: Hono, operations: OperationDefinition[] }` via `createXRoutes(deps)`. Routes parse/validate input, call service, map errors to HTTP status codes. See `routes/games.ts` for the canonical pattern.

**App wiring**: `app.ts` composes all route modules and collects operations. `index.ts` constructs all services and passes them to `createApp()`.

**CLI**: Hand-rolled arg parser in `index.ts` with a `COMMANDS` map. Each command module exports async functions that take `(client, args, opts)`. Output via `formatTable` and `printOutput` helpers.

**Web**: Next.js 16 with App Router. Server components fetch from daemon via `lib/api.ts` (which calls `lib/daemon.ts`). Client components use the `/api/daemon/[...path]` proxy route for mutations. CSS is in a global stylesheet (not modules).

### Key Files That Will Change

- `packages/shared/src/types.ts` — new types: `Comparison`, `TournamentSession`, `TournamentData`, `TournamentGameStats`, `TournamentGameStatsDisplay`, `SessionFilter`
- `packages/shared/src/validation.ts` — new Zod schemas for tournament operations
- `packages/shared/src/index.ts` — re-export new types and schemas
- `packages/daemon/src/services/` — new `tournament-service.ts`
- `packages/daemon/src/services/storage-service.ts` — add `loadTournament`/`saveTournament`
- `packages/daemon/src/routes/` — new `tournament.ts`
- `packages/daemon/src/app.ts` — wire tournament routes and service
- `packages/daemon/src/index.ts` — construct tournament service
- `packages/daemon/src/services/game-service.ts` — game deletion hook for tournament notification
- `packages/web/components/sidebar.tsx` — add Tournament nav item under new "Ranking" group
- `packages/web/app/tournament/` — new pages (session start, active comparison)
- `packages/web/app/games/[id]/page.tsx` — add tournament rank display
- `packages/web/app/page.tsx` — add tournament sort option
- `packages/web/lib/api.ts` — new tournament API functions
- `packages/cli/src/commands/tournament.ts` — new command module
- `packages/cli/src/index.ts` — register tournament commands

### Cross-Cutting Concerns

**Game deletion**: When `gameService.removeGame()` is called, the tournament service must be notified to (a) retain comparisons per REQ-TOURN-8, (b) exclude the game from active sessions per REQ-TOURN-15a, and (c) remove cached ELO per REQ-TOURN-8. The cleanest approach: `gameService` takes `tournamentService` as an optional dependency and calls `tournamentService.onGameDeleted(gameId)` during removal. This keeps the notification explicit without introducing an event bus.

**Spec inconsistency**: REQ-TOURN-6 says K-factor threshold defaults to 15. The success criteria section says "< 30 comparisons." The requirements section is normative. This plan follows REQ-TOURN-6: threshold = 15. Tests must document this conflict explicitly so Phase 7 reviewers don't flag it as a test failure.

**Spec field name divergence**: REQ-TOURN-2 names the session scope field `filter` (singular). This plan uses `filters: SessionFilter[] | null` (plural, array) to support the multi-filter combination behavior described in REQ-TOURN-12. This is a deliberate improvement over the spec's literal text.

**Spec filter type interpretation**: REQ-TOURN-12 says "by axis threshold" with the example "games I rated above 6 on complexity." This plan implements `minFitness` which filters by computed fitness score (the weighted average across all axes), not by individual axis values. Per-axis filtering would require specifying which axis, adding complexity beyond what the filter UX mockups show. The mockup's "Top rated" preset confirms fitness-score-level filtering is the intended behavior.

## Technical Decisions

### 1. Tournament settings storage

**Decision**: Store tournament-specific settings (`kFactorThreshold`, `normalizationHalfWidth`, `provisionalThreshold`) inside `tournament.json` as a `settings` object, not in `config.json`.

**Rationale**: `AppConfig` is for daemon infrastructure. Tournament settings are domain data that naturally co-locates with tournament state. They're read alongside tournament data anyway.

### 2. API surface inline

**Decision**: The tournament API surface is specified inline in Phase 4 of this plan rather than in a separate design document.

**Rationale**: The API pattern is established (Hono routes, service layer, operations registry). The endpoints, request/response shapes, and status codes are fully specified in the phase description. A separate doc would duplicate the plan content.

### 3. TournamentData shape

The `tournament.json` file stores everything:

```typescript
interface TournamentData {
  settings: TournamentSettings;
  sessions: TournamentSession[];
  comparisons: Comparison[];
  gameStats: Record<string, TournamentGameStats>; // gameId -> cached ELO + counts
}
```

`gameStats` is the cache. `comparisons` is the source of truth. `recalculate` rebuilds `gameStats` from `comparisons`.

### 4. Game deletion notification

`GameService` receives an optional `onGameDeleted` callback in its deps. The tournament service provides this callback. This avoids a hard dependency from game-service on tournament-service while keeping the notification explicit.

## Implementation Steps

### Phase 1: Data Model and Shared Types

**Files**: `packages/shared/src/types.ts`, `packages/shared/src/validation.ts`, `packages/shared/src/index.ts`
**Addresses**: REQ-TOURN-1, REQ-TOURN-2, REQ-TOURN-3, REQ-TOURN-4
**Expertise**: None

Add these types to `packages/shared/src/types.ts`:

```typescript
// Tournament types

export interface TournamentSettings {
  kFactorThreshold: number; // Default 15. Games with fewer comparisons use K=32, rest use K=16.
  normalizationHalfWidth: number; // Default 400. Reference range is 1500 ± this value.
  provisionalThreshold: number; // Default 6. Games with fewer comparisons show "(provisional)".
}

export type SessionFilterType = "name" | "minFitness" | "bggTag" | "staleness";

export interface SessionFilter {
  type: SessionFilterType;
  value: string; // Interpretation depends on type
}

export type SessionStatus = "active" | "completed";

export interface TournamentSession {
  id: string;
  filters: SessionFilter[] | null; // null for unfiltered
  gameIds: string[];
  comparisonCount: number;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Comparison {
  id: string;
  gameAId: string;
  gameBId: string;
  winnerId: string;
  sessionId: string;
  createdAt: string;
}

export interface TournamentGameStats {
  eloRating: number; // Default 1500
  comparisonCount: number; // Default 0
}

export interface TournamentData {
  settings: TournamentSettings;
  sessions: TournamentSession[];
  comparisons: Comparison[];
  gameStats: Record<string, TournamentGameStats>;
}

// Display types (derived from TournamentData, used by API responses and clients)

export interface RecentComparison {
  opponentGameId: string;
  won: boolean;
  createdAt: string;
}

export interface TournamentGameStatsDisplay {
  eloRating: number;
  comparisonCount: number;
  normalizedScore: number | null; // null when < 5 games ranked or game has 0 comparisons
  isProvisional: boolean; // comparisonCount < provisionalThreshold
  displayLabel: string; // "not yet ranked" | "8.3 (provisional)" | "8.3"
  wins: number;
  losses: number;
  recentComparisons: RecentComparison[]; // Last 5, derived from comparison history (never cached)
}
```

Add Zod schemas to `packages/shared/src/validation.ts`:

- `SessionFilterSchema` — validates filter type and value
- `StartSessionSchema` — validates `{ filters?: SessionFilter[] }`
- `SubmitComparisonSchema` — validates `{ winnerId: string }`

Re-export all new types and schemas from `packages/shared/src/index.ts`.

**Tests**: Type-level only (Zod schema validation tests). Verify filter schema rejects invalid types, comparison schema requires winnerId, session schema allows null filters.

**Review gate**: Types must be reviewed before proceeding. Incorrect shared types propagate errors to every downstream phase.

---

### Phase 2: ELO Engine (Pure Math, No I/O)

**Files**: `packages/daemon/src/services/elo-engine.ts` (new), `packages/daemon/tests/elo-engine.test.ts` (new)
**Addresses**: REQ-TOURN-5, REQ-TOURN-6, REQ-TOURN-7, REQ-TOURN-9
**Expertise**: None (standard ELO math)

Create a pure-function module `elo-engine.ts` with no service dependencies:

1. **`calculateExpectedScore(ratingA: number, ratingB: number): number`** — Standard ELO expected score: `1 / (1 + 10^((ratingB - ratingA) / 400))`

2. **`calculateNewRatings(ratingA, ratingB, winner, compCountA, compCountB, kThreshold): { newRatingA, newRatingB }`** — Applies the ELO update. K-factor is 32 when a game's comparison count < kThreshold, 16 otherwise. Returns both updated ratings.

3. **`recalculateAllRatings(comparisons: Comparison[], kThreshold: number): Record<string, TournamentGameStats>`** — Replays all comparisons in chronological order from default 1500. Returns fresh gameStats map. This is the authoritative calculation; incremental updates are an optimization that must produce identical results.

4. **`normalizeElo(elo: number, halfWidth: number): number | null`** — Normalizes to 1.0-10.0 using the reference window. Formula: `clamp(1 + 9 * (elo - (1500 - halfWidth)) / (2 * halfWidth), 1.0, 10.0)`. Returns null when normalization shouldn't be displayed (caller decides based on game count).

5. **`shouldDisplayRanking(gamesWithComparisons: number): boolean`** — Returns false when fewer than 5 games have at least one comparison.

**Tests**: This is the most test-heavy phase. Include:

- Hand-calculated 5-game, 10-comparison worked example (spec AI Validation requirement). Document the expected ELO after each comparison step.
- K-factor transition: verify K=32 below threshold, K=16 at/above threshold.
- Recalculate produces identical results to incremental updates for the same comparison sequence.
- Normalization: "not yet ranked" when < 5 games compared. Clamping at boundaries. All-equal-ELO edge case (all games should normalize to 5.5). ELO outside reference range clamps correctly.
- Edge case: comparison where winner is gameA vs gameB (both directions work).

**Review gate**: ELO math must be verified against hand calculations before proceeding.

---

### Phase 3: Tournament Service

**Files**: `packages/daemon/src/services/tournament-service.ts` (new), `packages/daemon/src/services/storage-service.ts` (modified), `packages/daemon/src/services/game-service.ts` (modified), `packages/daemon/tests/tournament-service.test.ts` (new)
**Addresses**: REQ-TOURN-3, REQ-TOURN-7, REQ-TOURN-8, REQ-TOURN-11, REQ-TOURN-12, REQ-TOURN-13, REQ-TOURN-14, REQ-TOURN-15, REQ-TOURN-15a
**Expertise**: None

#### Storage changes

Add to `StorageService` interface:

- `loadTournament(): Promise<TournamentData>`
- `saveTournament(data: TournamentData): Promise<void>`

Implementation follows the same pattern as `loadCollection`/`saveCollection`: file at `$dataDir/tournament.json`, atomic write via temp+rename, create with defaults if missing. Default `TournamentData`:

```typescript
{
  settings: { kFactorThreshold: 15, normalizationHalfWidth: 400, provisionalThreshold: 6 },
  sessions: [],
  comparisons: [],
  gameStats: {}
}
```

#### Tournament service interface

```typescript
interface TournamentService {
  // Session management
  startSession(filters: SessionFilter[] | null, games: GameWithScore[]): Promise<TournamentSession>;
  getActiveSession(): Promise<TournamentSession | null>;
  endSession(sessionId: string): Promise<TournamentSession>;

  // Comparisons
  getNextPair(sessionId: string): Promise<{ gameA: string; gameB: string } | null>;
  submitComparison(
    sessionId: string,
    gameAId: string,
    gameBId: string,
    winnerId: string,
  ): Promise<Comparison>;

  // Stats and display
  getGameStats(gameId: string): Promise<TournamentGameStatsDisplay>;
  getAllGameStats(): Promise<Record<string, TournamentGameStatsDisplay>>;
  listSessions(): Promise<TournamentSession[]>;

  // Maintenance
  recalculate(): Promise<{ gamesUpdated: number }>;
  onGameDeleted(gameId: string): Promise<void>;

  // Settings
  getSettings(): Promise<TournamentSettings>;
  updateSettings(patch: Partial<TournamentSettings>): Promise<TournamentSettings>;
}
```

The service returns `TournamentGameStatsDisplay` (defined in Phase 1 shared types) for all stats queries. The `wins`, `losses`, and `recentComparisons` fields are always derived from the `comparisons` array on each call, never cached in `gameStats`.

#### Session start logic (REQ-TOURN-12, REQ-TOURN-13)

`startSession` receives the full `GameWithScore[]` list and the filters. The route layer calls `gameService.listGames()` and passes the result. The tournament service has no dependency on `gameService` and does not load games internally. The service applies filters to determine which games are in scope:

- **name**: Case-insensitive substring match on `game.name`
- **minFitness**: `game.score?.score >= parseFloat(value)`. Games with no score are excluded.
- **bggTag**: Match against `game.bggData.mechanics[].name` and `game.bggData.categories[].name` (case-insensitive).
- **staleness**: `gameStats[game.id]?.comparisonCount < parseInt(value)` (defaults to provisionalThreshold). Games with no stats (count=0) always match.

Filters are AND-combined. If the resulting set has < 4 games, throw an error (REQ-TOURN-13).

If an active session exists, complete it first (REQ-TOURN-15).

#### Adaptive pairing (REQ-TOURN-14)

`getNextPair` implements:

1. Get the session's `gameIds`. Filter out any deleted games (check against collection, per REQ-TOURN-15a).
2. If available games < 4, auto-complete the session and return null.
3. Get all pairs already presented this session (from comparisons where `sessionId` matches).
4. Score candidate pairs: primary key = sum of both games' comparison counts (lower is better); secondary key = absolute ELO difference (lower is better, within 200 points preferred).
5. Filter out already-presented pairs.
6. Among ties, select randomly.

#### Game deletion hook (REQ-TOURN-8, REQ-TOURN-15a)

`onGameDeleted(gameId)`:

1. Remove `gameId` from `gameStats` cache.
2. Do NOT remove comparisons involving `gameId` (they're historical).
3. For the active session: if `gameId` is in the session's `gameIds`, check remaining available count. If < 4, auto-complete the session.
4. Save tournament data.

Wire this into `GameServiceDeps`:

```typescript
interface GameServiceDeps {
  storageService: StorageService;
  fitnessService: FitnessService;
  bggClient?: BggClient;
  onGameDeleted?: (gameId: string) => Promise<void>; // New
}
```

Call `deps.onGameDeleted?.(id)` inside `removeGame` after splicing from collection.

**Tests**:

- Session start with each filter type individually and combined.
- Session rejects < 4 games.
- Starting a new session completes the previous active session.
- Adaptive pairing: games with 0 comparisons are always selected first.
- Same pair not presented twice in one session.
- Game deletion: comparisons retained, cached ELO removed, active session checks.
- Session auto-completes when deletions reduce available games below 4.
- Atomic writes to tournament.json.

**Review gate**: Session and pairing logic are the most complex pieces. Review before building routes.

---

### Phase 4: API Routes

**Files**: `packages/daemon/src/routes/tournament.ts` (new), `packages/daemon/src/app.ts` (modified), `packages/daemon/src/index.ts` (modified)
**Addresses**: REQ-TOURN-19
**Expertise**: None

#### Endpoint Specification

| Operation ID                         | Method | Path                                   | Description                          |
| ------------------------------------ | ------ | -------------------------------------- | ------------------------------------ |
| `shelf.tournament.start-session`     | POST   | `/api/tournament/sessions`             | Start a new session                  |
| `shelf.tournament.get-active`        | GET    | `/api/tournament/sessions/active`      | Get the active session (404 if none) |
| `shelf.tournament.end-session`       | POST   | `/api/tournament/sessions/:id/end`     | End a session                        |
| `shelf.tournament.list-sessions`     | GET    | `/api/tournament/sessions`             | List all sessions                    |
| `shelf.tournament.next-pair`         | GET    | `/api/tournament/sessions/:id/next`    | Get next pair for comparison         |
| `shelf.tournament.submit-comparison` | POST   | `/api/tournament/sessions/:id/compare` | Submit comparison result             |
| `shelf.tournament.game-stats`        | GET    | `/api/tournament/games/:id/stats`      | Tournament stats for a game          |
| `shelf.tournament.all-stats`         | GET    | `/api/tournament/stats`                | All game tournament stats            |
| `shelf.tournament.recalculate`       | POST   | `/api/tournament/recalculate`          | Recalculate all ELO from history     |
| `shelf.tournament.get-settings`      | GET    | `/api/tournament/settings`             | Get tournament settings              |
| `shelf.tournament.update-settings`   | PUT    | `/api/tournament/settings`             | Update tournament settings           |

#### Request/Response Shapes

**POST `/api/tournament/sessions`**

```
Request:  { filters?: Array<{ type: string, value: string }> }
Response: 201 { session: TournamentSession }
Error:    400 { error: "..." } (< 4 games, invalid filter)
```

**GET `/api/tournament/sessions/active`**

```
Response: 200 { session: TournamentSession } | 404 { error: "No active session" }
```

**POST `/api/tournament/sessions/:id/end`**

```
Response: 200 { session: TournamentSession }  (status: "completed")
Error:    404 { error: "Session not found" }
```

**GET `/api/tournament/sessions`**

```
Response: 200 TournamentSession[]
```

**GET `/api/tournament/sessions/:id/next`**

```
Response: 200 { gameA: Game, gameB: Game, gameAStats: TournamentGameStatsDisplay, gameBStats: TournamentGameStatsDisplay }
          200 { done: true } (no more pairs or session ended)
Error:    404 { error: "Session not found" }
```

Note: Returns full Game objects (with imageUrl for thumbnails) plus tournament stats so the UI can display both scores. The next-pair endpoint must load from both tournament and collection data.

**POST `/api/tournament/sessions/:id/compare`**

```
Request:  { gameAId: string, gameBId: string, winnerId: string }
Response: 200 { comparison: Comparison, updatedStats: { gameA: TournamentGameStatsDisplay, gameB: TournamentGameStatsDisplay } }
Error:    400 { error: "..." } (winnerId not in pair, invalid IDs)
          404 { error: "Session not found" }
```

**GET `/api/tournament/games/:id/stats`**

```
Response: 200 TournamentGameStatsDisplay (with wins, losses, recentComparisons)
```

**GET `/api/tournament/stats`**

```
Response: 200 Record<string, TournamentGameStatsDisplay>
```

**POST `/api/tournament/recalculate`**

```
Response: 200 { gamesUpdated: number }
```

**GET `/api/tournament/settings`**

```
Response: 200 TournamentSettings
```

**PUT `/api/tournament/settings`**

```
Request:  Partial<TournamentSettings>
Response: 200 TournamentSettings
```

#### Wiring

In `app.ts`, add `tournamentService` to `AppDeps`. Create tournament routes via `createTournamentRoutes({ tournamentService, gameService })`. The route module needs `gameService` to resolve game IDs to full Game objects for the next-pair response.

In `index.ts`, construct `tournamentService` before `gameService`. The `onGameDeleted` callback must exist before it can be passed to `gameServiceDeps`. Construction order: storageService, fitnessService, tournamentService, then gameService (with `onGameDeleted: tournamentService.onGameDeleted`).

**Tests**: Route-level tests using `app.request()` (same pattern as existing route tests). Cover happy paths, validation errors, 404s.

**Review gate**: API surface should be reviewed before building clients.

---

### Phase 5: Web UI

**Files**: New pages under `packages/web/app/tournament/`, modified `packages/web/components/sidebar.tsx`, `packages/web/app/page.tsx`, `packages/web/app/games/[id]/page.tsx`, `packages/web/lib/api.ts`
**Addresses**: REQ-TOURN-10, REQ-TOURN-11, REQ-TOURN-16, REQ-TOURN-17, REQ-TOURN-18
**Expertise**: Frontend (reference visual mockups at `.lore/mockups/ (tournament-*.html)`)

#### Navigation

Add "Ranking" group to sidebar `navGroups` in `packages/web/components/sidebar.tsx`:

```typescript
{
  label: "Ranking",
  items: [
    { href: "/tournament", name: "Tournament", icon: /* trophy or bracket SVG */ },
  ],
}
```

#### New pages

**`/tournament` (session start page)**

Reference mockup: `01-session-start.html`

Client component (interactive filter builder, session management). Fetches data via the `/api/daemon/[...path]` proxy.

- If active session exists: show resume banner (green dot, session info, resume/end buttons).
- "New session" panel with:
  - Quick presets: "All games", "Unranked" (staleness < provisionalThreshold), "Top rated" (fitness >= 7.5), "Needs more data" (< 3 comparisons). Each shows count.
  - Custom filter builder (select type, input value, add button). Active filters shown as removable chips.
  - Footer: game count preview, "Start session" button (disabled if < 4).
- Stats row: total comparisons, top tournament rank, provisional games count, past sessions count.

**`/tournament/session` (active comparison page)**

Reference mockup: `04-active-comparison.html`

Client component. Shows the current pair side-by-side (desktop) or stacked (mobile).

- Topbar: session name (filter description or "All games"), game count, "End session" button.
- Comparison area: "Which would you keep?" prompt, two game cards with thumbnails, names, axis fitness, tournament rank, comparison count. "Keep this one" button on each card.
- Session footer: comparison count this session, progress bar (decorative), pairing strategy note.
- Clicking a card or its button: POST comparison result, fetch next pair inline (no page navigation).
- When no more pairs: show "session complete" state.

#### Modified pages

**Game detail (`/games/[id]/page.tsx`)**

Add tournament rank display to the hero score section (REQ-TOURN-10):

- If game has tournament stats: show "Tournament Rank: X.X" alongside "Fitness Score: Y.Y"
- If provisional: append "(provisional)"
- If not yet ranked: show "not yet ranked"
- If divergence > 2.0 between normalized scores and both are non-provisional (REQ-TOURN-18): show divergence banner.

Add tournament breakdown panel (REQ-TOURN-11): total comparisons, win/loss record, last 5 comparisons with opponent names, raw ELO alongside normalized score.

**Collection page (`/page.tsx`)**

Add sort toggle in the collection header: "Fitness" | "Tournament" (REQ-TOURN-17). Default to fitness (existing behavior). When sorted by tournament, games with no comparisons sort to the bottom.

#### API additions

Add to `packages/web/lib/api.ts`:

- `startTournamentSession(filters)`
- `getActiveSession()`
- `endSession(id)`
- `getNextPair(sessionId)`
- `submitComparison(sessionId, gameAId, gameBId, winnerId)`
- `getTournamentGameStats(gameId)`
- `getAllTournamentStats()`
- `recalculateElo()`

#### CSS

New styles for tournament pages. Follow the visual direction from the mockups. The HTML mockups define the color palette (same CSS variables as the existing app), layout, and component styles. Translate mockup CSS to the global stylesheet.

**Tests**: Component-level tests are not required for server-rendered pages. The visual mockup serves as the acceptance criteria. Tournament logic is tested at the service/route level.

**Review gate**: Compare implemented UI against all 4 mockups. Verify responsive behavior (mockup 04 includes a mobile layout).

---

### Phase 6: CLI Commands

**Files**: `packages/cli/src/commands/tournament.ts` (new), `packages/cli/src/index.ts` (modified), `packages/cli/src/commands/game.ts` (modified, add Rank column), `packages/cli/src/commands/score.ts` (modified, add tournament rank + divergence)
**Addresses**: REQ-TOURN-20, REQ-TOURN-10, REQ-TOURN-17, REQ-TOURN-18
**Expertise**: None

#### Commands

Register in `COMMANDS` map and switch statement:

| Command                  | Tokens | Description                                                                                                |
| ------------------------ | ------ | ---------------------------------------------------------------------------------------------------------- |
| `tournament start`       | 2      | Start session. `--filter name:<value>` `--filter fitness:<min>` `--filter tag:<name>` `--filter stale:<n>` |
| `tournament next`        | 2      | Show next pair                                                                                             |
| `tournament pick`        | 2      | Submit winner: `sj tournament pick <game-id>` (positional arg = winner)                                    |
| `tournament stop`        | 2      | End active session                                                                                         |
| `tournament stats`       | 2      | Show game stats: `sj tournament stats [game-id]`. Without ID shows summary.                                |
| `tournament recalculate` | 2      | Recalculate all ELO from history                                                                           |

All commands support `--json`.

#### Arg parsing

Extend `parseArgs` to handle `--filter` flags (collect into `filterFlags: string[]`). Each `--filter` takes a single `type:value` argument.

#### Output formatting

`tournament next`: Show two games side-by-side in a table with name, axis fitness, tournament rank, comparison count. Print "Use `sj tournament pick <id>` to choose."

`tournament stats <id>`: Table with ELO, normalized score, provisional status, win/loss, last 5 comparisons.

`tournament stats` (no id): Table of all games sorted by tournament rank, showing name, normalized score, comparison count.

`game list` output: When tournament data exists, include a "Rank" column showing normalized tournament score.

`score get <id>` output: Include tournament rank alongside axis fitness. Show divergence flag if applicable (REQ-TOURN-18).

**Tests**: Unit tests for arg parsing (`--filter` flags). Integration tests via CLI command execution are not required (tested at route level).

**Review gate**: Verify all 6 commands produce correct output for both human and `--json` modes.

---

### Phase 7: Integration Verification

**Files**: No new files. Run existing + new tests.
**Addresses**: All REQ-TOURN-\* (cross-cutting verification)
**Expertise**: Fresh-context review agent

1. Run `bun run test` across all packages. All tests must pass.
2. Run `bun run typecheck`. Clean output required.
3. Run `bun run lint`. Clean output required.
4. Launch a sub-agent to read the spec at `.lore/specs/tournament/tournament-ranking.md` and verify each of the 20 requirements against the implementation. The agent checks:
   - Each REQ-TOURN-N is implemented in the code.
   - Automated success criteria from the spec are covered by tests.
   - Manual verification scenarios are achievable (describe how to demo each one).
5. Run the full automated success criteria checklist from the spec.

## Delegation Guide

This plan is designed for Dalton (Guild Artificer) as the primary implementer. Phase structure supports commission-per-phase with review gates.

**Phase 1**: Straightforward type definitions. Low risk. Can proceed quickly.
**Phase 2**: Pure math, high test density. Must be reviewed before Phase 3 (incorrect ELO math propagates everywhere).
**Phase 3**: Most complex phase. Session management, filtering, adaptive pairing, game deletion coordination. Warrants careful review.
**Phase 4**: Follows established route patterns. Review API shapes before Phase 5/6 consume them.
**Phase 5**: Frontend work, reference mockups heavily. Review against mockups.
**Phase 6**: CLI follows established patterns. Lowest risk.
**Phase 7**: Thorne (Guild Warden) should run the spec verification. Fresh context catches what the implementer misses.

Suggested commission cadence:

- Phase 1+2 as one commission (types + math are fast, tightly coupled)
- Phase 3 as one commission (complex, needs focused review)
- Phase 4 as one commission (API surface, gateway to clients)
- Phase 5 as one commission (web UI, largest surface area)
- Phase 6 as one commission (CLI, can run parallel with Phase 5)
- Phase 7 as a Thorne review commission

## Open Questions

1. **Tournament page as separate route vs. modal**: The mockups show `/tournament` as a full page. This plan follows that. If the comparison screen should be a modal overlay on the collection page instead, the Phase 5 structure changes. The mockups are authoritative here.

2. **Filter preset definitions**: The mockups show "Top rated" as fitness >= 7.5 and "Needs more data" as < 3 comparisons. These are UX choices not in the spec. The plan uses the mockup values. They can be adjusted during implementation.

3. **Next-pair response enrichment**: The plan specifies that `next-pair` returns full Game objects alongside tournament stats so the UI has everything it needs in one request. This means the tournament route needs access to `gameService` (or at minimum `storageService`). This is specified in the wiring section but worth flagging for the implementer.
