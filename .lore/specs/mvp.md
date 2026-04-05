---
title: "MVP Specification: Shelf Judge"
date: 2026-04-04
status: draft
tags: [spec, mvp, fitness, scoring]
---

# MVP Specification: Shelf Judge

## Overview

The MVP delivers the core value proposition: a user creates personal rating axes, rates owned games on those axes, and gets a transparent fitness score for each game. BGG provides community data (rating, weight, mechanics, categories, player counts) that feeds into the score alongside personal ratings. The user can see exactly which axes drove the number and how much each contributed.

This is the smallest thing that proves the idea works. One user, their shelf, their axes, their scores, fully transparent.

## What's In

- User-defined rating axes with weights
- Per-game ratings on those axes (1-10 scale)
- BGG data import for individual games and bulk collection import
- Fitness score computed as weighted average with full breakdown
- BGG-derived axes (community rating, complexity) auto-populated from API data
- Daemon API (Hono on Unix socket), web UI (Next.js), CLI (discovery pattern)
- Local persistence (YAML/JSON files, no database)

## What's Deferred

These are real features from the vision, explicitly not in MVP:

- **DEF-1: Redundancy / collection-awareness.** Fitness is calculated per game in isolation. No mechanic overlap penalty, no "you already own three worker-placement games" adjustment. The vision's Principle 5 ("the shelf has a carrying capacity") is deferred until the core scoring loop is proven.
- **DEF-2: Prediction for unowned games.** MVP scores only games in the user's collection with personal ratings. Estimating fitness for games you haven't rated requires a similarity engine that depends on having enough rated data to be meaningful.
- **DEF-3: Collection identity / profiling.** No "your taste profile says..." inference. Principle 3 ("your collection has an identity") is a post-MVP feature that builds on a populated rating dataset.
- **DEF-4: Pairwise tournament ranking.** The brainstorm's hybrid conclusion (tournament for overall fitness + direct ratings for axes) is the long-term direction. MVP uses direct ratings only. The tournament layer adds significant UX and implementation complexity for a feature that requires 20+ games to converge. Ship the scorecard first; validate that users find multi-axis rating useful before adding the comparison layer.
- **DEF-5: Utility curves / veto axes.** All axes use linear scoring in MVP. Plateau curves, S-curves, and hard vetoes (Approach 4 from the brainstorm) are powerful but increase configuration burden. Linear is the right default; curves are a refinement.
- **DEF-6: LLM-mediated scoring.** No AI in the fitness calculation. The score is deterministic math. LLM features (natural language score explanation, conversational axis creation) are future enhancements.
- **DEF-7: BGG user authentication.** MVP uses only public BGG data (application token, no user login). Private collection data (acquisition price, private notes) requires BGG user auth, which adds complexity for marginal MVP value.
- **DEF-8: Play history import.** BGG play logs are available but not used in MVP scoring.

---

## Data Model

### Game

A game the user has added to their shelf-judge collection.

```typescript
interface Game {
  id: string;                    // UUID, generated locally
  bggId: number | null;          // BGG thing ID, null if manually added
  name: string;                  // Primary name (from BGG or user-entered)
  yearPublished: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playingTime: number | null;    // Minutes (BGG "playingtime" field)
  imageUrl: string | null;       // BGG thumbnail URL
  bggData: BggGameData | null;   // Cached BGG API data
  ratings: Record<string, number>;  // axisId → rating (1-10)
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
}
```

### BggGameData

Cached data from the BGG Thing endpoint. Stored alongside the game to avoid repeated API calls.

```typescript
interface BggGameData {
  communityRating: number;       // BGG average (1-10)
  bayesAverage: number;          // BGG Geek Rating (Bayesian)
  weight: number | null;         // 1-5 scale, null if BGG returns 0 (known bug)
  numWeightVotes: number;        // Confidence signal for weight
  mechanics: BggTag[];           // { id: number, name: string }
  categories: BggTag[];          // { id: number, name: string }
  subdomains: string[];          // "Strategy Games", "Family Games", etc.
  suggestedPlayerCounts: SuggestedPlayerCount[];  // Community poll data
  fetchedAt: string;             // ISO 8601, for cache invalidation
}

interface BggTag {
  id: number;
  name: string;
}

interface SuggestedPlayerCount {
  playerCount: string;           // "1", "2", ..., "4+"
  best: number;                  // Vote count
  recommended: number;
  notRecommended: number;
}
```

### Axis

A user-defined rating dimension.

```typescript
interface Axis {
  id: string;                    // UUID
  name: string;                  // "Wife will play it", "Visual design", etc.
  description: string | null;    // Optional clarification
  weight: number;                // 1-100, user-assigned importance
  source: "personal" | "bgg";   // Personal = user rates manually. BGG = auto-populated.
  bggField: string | null;       // For source="bgg": which BGG field maps here
  createdAt: string;
  updatedAt: string;
}
```

BGG-derived axes (`source: "bgg"`) are auto-populated when a game has BGG data. The `bggField` identifies which field maps to this axis. Two BGG-derived axes are created by default (the user can delete or re-weight them):

| Default axis | `bggField` | Mapping |
|---|---|---|
| Community Rating | `communityRating` | Pass-through (already 1-10) |
| Complexity | `weight` | BGG weight 1-5 normalized to 1-10: `score = weight * 2` |

The user can create additional BGG-derived axes later (player count fit, for example), but MVP ships with these two.

### Collection

The user's set of games. MVP supports a single collection (one user, one shelf).

```typescript
interface Collection {
  id: string;                    // UUID
  name: string;                  // Default: "My Collection"
  axes: Axis[];
  games: Game[];
  createdAt: string;
  updatedAt: string;
}
```

### Storage Format

All state persists as JSON files in a configurable data directory (default: `~/.shelf-judge/data/`).

```
~/.shelf-judge/
  data/
    collection.json              # Single collection with embedded axes and games
  config.json                    # App config (BGG token, data dir, socket path)
```

MVP uses a single `collection.json` file. This is deliberately simple. If the file grows unwieldy with hundreds of games, splitting into per-game files is a straightforward migration, but not one we need to design for now.

---

## Fitness Score Model

### Decision: Axis Scorecard (Approach 1, weighted average)

The MVP uses Approach 1 from the brainstorm: direct axis ratings with weighted average aggregation. This is the right starting point for three reasons:

1. **Transparency is the non-negotiable principle.** The vision's tension table says transparency beats precision, always. Weighted average produces a breakdown where every point is traceable to a specific axis, weight, and rating. No other approach is this legible.

2. **Works from game one.** No cold-start problem. Rate one game on one axis, get a fitness score. The pairwise tournament (deferred as DEF-4) needs 20+ games to converge. The profile similarity approach (Approach 3) needs a meaningful collection to build a centroid. The scorecard delivers value immediately.

3. **Foundation for the hybrid.** The brainstorm's conclusion envisions tournament ranking + axis ratings as a combined vector. The axis scorecard is the axis half of that hybrid. Building it first means the tournament layer, when added, slots in alongside it rather than replacing it.

### The Math

**Fitness score** for a game is the weighted average of all rated axes:

```
fitness = Σ(axis_score_i × axis_weight_i) / Σ(axis_weight_i)
```

Where the sum runs over all axes that have a rating for this game (personal or BGG-derived).

**Result range:** 1.0 to 10.0 (inherits the axis rating range).

**Missing ratings:** If a game has no rating for an axis, that axis is excluded from both numerator and denominator. The breakdown shows the excluded axis as "not rated" so the user knows it didn't contribute.

**BGG-derived axis scores:** Auto-populated from cached BGG data using the mapping defined in the Axis section above. The user can override any BGG-derived score with a personal rating. When overridden, the breakdown shows "[your rating, BGG: X.X]" so the original value is visible.

### Score Breakdown

Every fitness score is accompanied by a breakdown. This is not optional. A score without a breakdown violates Principle 2.

```typescript
interface FitnessResult {
  score: number;                          // 1.0 - 10.0
  ratedAxisCount: number;                 // How many axes contributed
  totalAxisCount: number;                 // How many axes exist
  breakdown: FitnessBreakdownEntry[];
}

interface FitnessBreakdownEntry {
  axisId: string;
  axisName: string;
  rating: number | null;                  // null if not rated
  weight: number;
  contribution: number | null;            // Points contributed to score, null if not rated
  source: "personal" | "bgg" | "override"; // "override" = user replaced BGG value
  bggOriginal: number | null;             // Original BGG value when source is "override"
}
```

### Example

A user has three axes: "Wife will play it" (weight 40), "Visual design" (weight 30), "Complexity" (weight 20, BGG-derived), and "Community Rating" (weight 10, BGG-derived).

For Wingspan:

```
Fitness: 7.65

  Wife will play it:    8   × 40  → 320    [your rating]
  Visual design:        9   × 30  → 270    [your rating]
  Complexity:           5.8 × 20  → 116    [BGG weight 2.9 → 5.8]
  Community Rating:     8.1 × 10  →  81    [BGG]

  Sum of contributions: 787
  Sum of weights:       100
  Score: 787 / 100 = 7.87

  Rounded: 7.9
```

Scores are stored and displayed to one decimal place.

---

## BGG Integration

### Application Token

All BGG API requests require an `Authorization: Bearer TOKEN` header. The token is registered at `https://boardgamegeek.com/using_the_xml_api` and stored in `~/.shelf-judge/config.json`.

The daemon validates the token is present on startup. If missing, API-dependent operations return a clear error: "BGG application token not configured. Register at [URL] and run `shelf-judge config set bgg-token YOUR_TOKEN`."

### Endpoints Used

**Thing endpoint** (`/xmlapi2/thing`):
- Used when adding a game by BGG ID or after search
- Parameters: `id={bggId}&stats=1&type=boardgame`
- Supports comma-delimited IDs for batch fetch (up to 250 per request)
- Provides: name, player count, play time, year, mechanics, categories, community rating, weight, suggested player counts

**Search endpoint** (`/xmlapi2/search`):
- Used when the user searches for a game by name
- Parameters: `query={name}&type=boardgame`
- Returns: ID, name, year only. A follow-up Thing request is needed for full data.

**Collection endpoint** (`/xmlapi2/collection`):
- Used for bulk import from a BGG user's public collection
- Parameters: `username={bggUsername}&own=1&subtype=boardgame&stats=1`
- Returns: all owned games with basic stats
- **202 handling required:** This endpoint returns HTTP 202 when queued. The daemon retries with exponential backoff: 5s, 10s, 20s, up to 3 retries. If still 202 after retries, return an error to the client.

### Rate Limiting

No officially published limits. The daemon enforces a conservative request throttle:

- **Default:** 1 request per 5 seconds
- **Batch thing requests:** Up to 250 IDs per call, reducing total request count
- **429 response:** Back off 30 seconds, then resume at 1 req/10s, gradually returning to normal
- **502/503 response:** Retry after 30 seconds, up to 2 retries

Rate limiting is handled in the BGG client service, not in individual route handlers.

### Caching

BGG data is cached in the `bggData` field of each Game record. Cache invalidation:

- **Default TTL:** 7 days. BGG data (ratings, weight) changes slowly.
- **Manual refresh:** User can trigger a refresh for a single game or the entire collection.
- **Stale data is fine.** Community rating shifting from 7.8 to 7.9 doesn't materially change a fitness score. Prefer fewer API calls over fresher data.

### XML Parsing

The BGG API returns XML only. The daemon uses an XML parsing library (e.g., `fast-xml-parser`) to convert responses to typed objects. Known quirks to handle:

- `averageweight` of 0 is treated as null (known BGG bug)
- Primary name is the `<name>` element with `type="primary"`
- `<median>` is always 0; ignored

### Library Decision

Deferred to implementation. The research identifies several viable TypeScript libraries (`bgg-xml-api-client`, `bgg-sdk`, `bgg`). The implementer should verify that the chosen library handles the 2025 auth token requirement before committing. If no library handles it cleanly, a thin custom client over `fast-xml-parser` is acceptable; the API surface we use is small (three endpoints).

---

## API Surface

Following the architecture pattern: Hono daemon on Unix socket, route/service split with DI factories, operations registry.

### Operations

Each operation follows the `OperationDefinition` structure from the architecture doc. The hierarchy uses `shelf` as the root.

#### Game Operations

| Operation ID | Method | Path | Description |
|---|---|---|---|
| `shelf.game.search` | GET | `/api/games/search?q={query}` | Search BGG for games by name |
| `shelf.game.add` | POST | `/api/games` | Add a game (by BGG ID or manually) |
| `shelf.game.get` | GET | `/api/games/:id` | Get a game with current fitness score |
| `shelf.game.list` | GET | `/api/games` | List all games with fitness scores |
| `shelf.game.rate` | PUT | `/api/games/:id/ratings` | Set ratings for a game on one or more axes |
| `shelf.game.remove` | DELETE | `/api/games/:id` | Remove a game from the collection |
| `shelf.game.refresh-bgg` | POST | `/api/games/:id/refresh` | Re-fetch BGG data for a game |

#### Axis Operations

| Operation ID | Method | Path | Description |
|---|---|---|---|
| `shelf.axis.create` | POST | `/api/axes` | Create a new rating axis |
| `shelf.axis.list` | GET | `/api/axes` | List all axes with weights |
| `shelf.axis.update` | PUT | `/api/axes/:id` | Update axis name, description, or weight |
| `shelf.axis.delete` | DELETE | `/api/axes/:id` | Delete an axis (removes all ratings on it) |

#### Import Operations

| Operation ID | Method | Path | Description |
|---|---|---|---|
| `shelf.import.bgg-collection` | POST | `/api/import/bgg?username={bggUsername}` | Import owned games from a BGG user's collection |

#### Score Operations

| Operation ID | Method | Path | Description |
|---|---|---|---|
| `shelf.score.get` | GET | `/api/games/:id/score` | Get fitness score with full breakdown for a game |
| `shelf.score.list` | GET | `/api/scores` | Get all games ranked by fitness score |

#### System Operations

| Operation ID | Method | Path | Description |
|---|---|---|---|
| `shelf.help` | GET | `/api/help` | Operations registry (CLI discovery root) |
| `shelf.help.feature` | GET | `/api/help/:feature` | Operations for a feature subtree |
| `shelf.config.get` | GET | `/api/config` | Current configuration |
| `shelf.config.set` | PUT | `/api/config` | Update configuration |

### Request/Response Shapes

**POST `/api/games`** (add game):
```typescript
// Request
{ bggId: number } | { name: string, yearPublished?: number }

// Response
{ game: Game, bggImported: boolean }
```

**PUT `/api/games/:id/ratings`** (rate game):
```typescript
// Request
{ ratings: Record<string, number> }  // axisId → rating (1-10)

// Response
{ game: Game, score: FitnessResult }
```

**POST `/api/import/bgg`** (import collection):
```typescript
// Request
{ username: string }

// Response (SSE stream for progress)
event: progress
data: { imported: number, total: number, current: string }

event: complete
data: { imported: number, skipped: number, errors: string[] }
```

The BGG collection import streams progress via SSE because it involves multiple API calls with rate limiting. The client sees games appearing as they're imported rather than waiting for a bulk response.

### Service Layer

Route factories receive injected services:

- **GameService:** CRUD for games, delegates to BggClient for API calls, computes fitness scores
- **AxisService:** CRUD for axes, handles cascade deletion of ratings
- **BggClient:** Wraps BGG API calls, handles rate limiting, 202 retries, XML parsing, caching
- **StorageService:** Reads/writes collection.json, handles file locking for concurrent access

Each service is a DI factory: `createGameService(deps) → GameService`. Tests inject mock storage and BGG client.

---

## Web UI

MVP web interface. Minimal, functional, not polished. Next.js App Router, server components where possible, client components for interactive elements.

### Screens

**1. Collection View** (home page)
- Table/grid of all games, sorted by fitness score (descending)
- Each row shows: game name, thumbnail, fitness score, last rated date
- Click a game to see its detail view
- "Add Game" button (opens search)
- "Import from BGG" button

**2. Game Detail View**
- Game info: name, year, player count, play time, thumbnail
- Fitness score with full breakdown (the transparency display from the score model section)
- Rating form: one slider or number input per axis, pre-filled with existing ratings
- BGG-derived axes show auto-populated value with option to override
- "Refresh BGG Data" button

**3. Game Search / Add**
- Text search field that queries BGG
- Results list with name, year, and thumbnail
- Click to add a game (fetches full BGG data on add)
- Manual add option for games not on BGG

**4. Axes Management**
- List of all axes with name, weight, source
- Create new axis (name, description, weight, source type)
- Edit axis weight and description
- Delete axis (with confirmation noting that ratings on this axis will be removed)

**5. Import Status**
- Shown during BGG collection import
- Progress indicator: "Importing 12 of 47..."
- List of imported games as they arrive
- Error summary at completion

### Navigation

Persistent sidebar or top nav with: Collection, Axes, Add Game. The collection view is the landing page.

---

## CLI Surface

The CLI discovers operations from the daemon at runtime. No hardcoded command catalog.

### Binary

`shelf-judge` (or `sj` alias). Connects to the daemon's Unix socket.

### Core Commands

```
shelf-judge help                        # Full operation tree
shelf-judge game search "wingspan"      # Search BGG
shelf-judge game add --bgg-id 266192    # Add by BGG ID
shelf-judge game add --name "Custom"    # Add manually
shelf-judge game list                   # All games with fitness scores
shelf-judge game rate <id> --axis "Wife will play it" 8 --axis "Visual design" 9
shelf-judge axis list                   # All axes
shelf-judge axis create "Wife will play it" --weight 40
shelf-judge axis update <id> --weight 50
shelf-judge import bgg-collection <username>
shelf-judge score list                  # Games ranked by fitness
shelf-judge score get <id>              # Full breakdown for one game
shelf-judge config set bgg-token <token>
```

### Output

Default output is human-readable tables. The `--json` flag on any command returns raw JSON for scripting and agent consumption.

### Daemon Management

The CLI checks whether the daemon is running on the expected socket. If not:
- `shelf-judge start` starts the daemon in the background
- `shelf-judge stop` stops it
- Commands that need the daemon prompt the user to start it if it's not running

---

## Constraints

- **CON-1:** All BGG API calls are server-side (CORS disabled on BGG API).
- **CON-2:** No database. All state in JSON files.
- **CON-3:** Single-user. No auth, no multi-tenancy. The daemon serves one person's collection.
- **CON-4:** No AI/LLM in MVP. Fitness is deterministic math.
- **CON-5:** BGG application token is required for any BGG functionality. The app must function (with manual game entry and personal-only axes) without a token configured.
- **CON-6:** All fitness scores must include a breakdown. No score is ever displayed without its derivation.

---

## Open Questions

These are genuine unknowns that don't block MVP implementation but should be resolved through use:

1. **Axis weight UX:** Should weight be a raw number (1-100) or a relative slider where all weights auto-normalize to 100%? Raw numbers are simpler to implement; normalized sliders are more intuitive. The implementer should start with raw numbers and the API normalizes them in the score calculation (divides by sum of weights). The UI can present this as percentages without changing the storage model.

2. **BGG library choice:** Several viable TypeScript libraries exist. The implementer should verify auth token support and pick one. This is an implementation decision, not a spec decision.

3. **Collection import conflict resolution:** When importing from BGG, what happens if a game already exists in the collection? Options: skip, update BGG data only, or prompt. MVP should skip duplicates (match on bggId) and report them in the import summary.

---

## Success Criteria

### Automated Tests (bun test)

- **SC-1:** Creating an axis and rating a game on it produces a correct fitness score (weighted average math verified)
- **SC-2:** Multiple axes with different weights produce the correct weighted average
- **SC-3:** Missing ratings on some axes correctly exclude those axes from the calculation
- **SC-4:** BGG-derived axes auto-populate from cached BGG data
- **SC-5:** Score breakdown entries sum to the total fitness score
- **SC-6:** BGG client handles 202 retry, 429 backoff, and malformed XML gracefully
- **SC-7:** Import from BGG collection creates games with cached BGG data

### Manual Verification (demonstration)

- **SC-8:** Add a game by searching BGG, rate it on 2+ axes, see the fitness score with breakdown
- **SC-9:** Create a custom axis, re-rate games, observe score changes
- **SC-10:** Import a BGG collection (10+ games), verify games appear with BGG data populated
- **SC-11:** CLI `shelf-judge score list` shows all games ranked by fitness with breakdown available
- **SC-12:** Web UI displays score breakdown that matches the math (manually verify one game's arithmetic)
