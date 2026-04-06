---
title: "MVP API Surface"
date: 2026-04-04
status: implemented
tags: [design, api, daemon, operations, mvp]
modules: [daemon]
related:
  - .lore/specs/mvp.md
  - .lore/reference/architecture-pattern.md
---

# Design: MVP API Surface

Satisfies: REQ-MVP-1, REQ-MVP-2, REQ-MVP-3, REQ-MVP-4, REQ-MVP-6, REQ-MVP-8, REQ-MVP-9, REQ-MVP-10, REQ-MVP-11, REQ-MVP-15, REQ-MVP-17

Following the architecture pattern: Hono daemon on Unix socket, route/service split with DI factories, operations registry.

## Operations

Each operation follows the `OperationDefinition` structure from the architecture doc. The hierarchy uses `shelf` as the root.

### Game Operations

| Operation ID             | Method | Path                          | Description                                |
| ------------------------ | ------ | ----------------------------- | ------------------------------------------ |
| `shelf.game.search`      | GET    | `/api/games/search?q={query}` | Search BGG for games by name               |
| `shelf.game.add`         | POST   | `/api/games`                  | Add a game (by BGG ID or manually)         |
| `shelf.game.get`         | GET    | `/api/games/:id`              | Get a game with current fitness score      |
| `shelf.game.list`        | GET    | `/api/games`                  | List all games with fitness scores         |
| `shelf.game.rate`        | PUT    | `/api/games/:id/ratings`      | Set ratings for a game on one or more axes |
| `shelf.game.remove`      | DELETE | `/api/games/:id`              | Remove a game from the collection          |
| `shelf.game.refresh-bgg` | POST   | `/api/games/:id/refresh`      | Re-fetch BGG data for a game               |

### Axis Operations

| Operation ID        | Method | Path            | Description                                |
| ------------------- | ------ | --------------- | ------------------------------------------ |
| `shelf.axis.create` | POST   | `/api/axes`     | Create a new rating axis                   |
| `shelf.axis.list`   | GET    | `/api/axes`     | List all axes with weights                 |
| `shelf.axis.update` | PUT    | `/api/axes/:id` | Update axis name, description, or weight   |
| `shelf.axis.delete` | DELETE | `/api/axes/:id` | Delete an axis (removes all ratings on it) |

### Import Operations

| Operation ID                  | Method | Path              | Description                                     |
| ----------------------------- | ------ | ----------------- | ----------------------------------------------- |
| `shelf.import.bgg-collection` | POST   | `/api/import/bgg` | Import owned games from a BGG user's collection |

### Score Operations

| Operation ID       | Method | Path                   | Description                                      |
| ------------------ | ------ | ---------------------- | ------------------------------------------------ |
| `shelf.score.get`  | GET    | `/api/games/:id/score` | Get fitness score with full breakdown for a game |
| `shelf.score.list` | GET    | `/api/scores`          | Get all games ranked by fitness score            |

### System Operations

| Operation ID         | Method | Path                 | Description                              |
| -------------------- | ------ | -------------------- | ---------------------------------------- |
| `shelf.help`         | GET    | `/api/help`          | Operations registry (CLI discovery root) |
| `shelf.help.feature` | GET    | `/api/help/:feature` | Operations for a feature subtree         |
| `shelf.config.get`   | GET    | `/api/config`        | Current configuration                    |
| `shelf.config.set`   | PUT    | `/api/config`        | Update configuration                     |

## Request/Response Shapes

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
{ ratings: Record<string, number> }  // axisId -> rating (1-10)

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

## Service Layer

Route factories receive injected services:

- **GameService:** CRUD for games, delegates to BggClient for API calls, computes fitness scores
- **AxisService:** CRUD for axes, handles cascade deletion of ratings
- **BggClient:** Wraps BGG API calls, handles rate limiting, 202 retries, XML parsing, caching
- **StorageService:** Reads/writes collection.json, handles file locking for concurrent access

Each service is a DI factory: `createGameService(deps) -> GameService`. Tests inject mock storage and BGG client.
