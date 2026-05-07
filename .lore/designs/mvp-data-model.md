---
title: "MVP Data Model"
date: 2026-04-04
status: implemented
tags: [design, data-model, storage, mvp]
modules: [daemon]
related:
  - .lore/specs/mvp.md
  - .lore/reference/architecture-pattern.md
---

# Design: MVP Data Model

Satisfies: REQ-MVP-1, REQ-MVP-2, REQ-MVP-3, REQ-MVP-9, REQ-MVP-15, REQ-MVP-16, REQ-MVP-20, REQ-MVP-21

## Game

A game the user has added to their shelf-judge collection.

```typescript
interface Game {
  id: string; // UUID, generated locally
  bggId: number | null; // BGG thing ID, null if manually added
  name: string; // Primary name (from BGG or user-entered)
  yearPublished: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playingTime: number | null; // Minutes (BGG "playingtime" field)
  imageUrl: string | null; // BGG thumbnail URL
  bggData: BggGameData | null; // Cached BGG API data
  ratings: Record<string, number>; // axisId -> rating (1-10)
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

## BggGameData

Cached data from the BGG Thing endpoint. Stored alongside the game to avoid repeated API calls.

```typescript
interface BggGameData {
  communityRating: number; // BGG average (1-10)
  bayesAverage: number; // BGG Geek Rating (Bayesian)
  weight: number | null; // 1-5 scale, null if BGG returns 0 (known bug)
  numWeightVotes: number; // Confidence signal for weight
  mechanics: BggTag[]; // { id: number, name: string }
  categories: BggTag[]; // { id: number, name: string }
  subdomains: string[]; // "Strategy Games", "Family Games", etc.
  suggestedPlayerCounts: SuggestedPlayerCount[]; // Community poll data
  fetchedAt: string; // ISO 8601, for cache invalidation
}

interface BggTag {
  id: number;
  name: string;
}

interface SuggestedPlayerCount {
  playerCount: string; // "1", "2", ..., "4+"
  best: number; // Vote count
  recommended: number;
  notRecommended: number;
}
```

## Axis

A user-defined rating dimension.

```typescript
interface Axis {
  id: string; // UUID
  name: string; // "Wife will play it", "Visual design", etc.
  description: string | null; // Optional clarification
  weight: number; // 1-100, user-assigned importance
  source: "personal" | "bgg" | "tournament"; // Personal = user rates manually. BGG = auto-populated. Tournament = derived from ELO comparisons.
  bggField: string | null; // For source="bgg": which BGG field maps here
  createdAt: string;
  updatedAt: string;
}
```

BGG-derived axes (`source: "bgg"`) are auto-populated when a game has BGG data. The `bggField` identifies which field maps to this axis. Two BGG-derived axes are created by default (the user can delete or re-weight them):

| Default axis     | `source`     | `bggField`        | Weight | Mapping                                                                                                      |
| ---------------- | ------------ | ----------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| Community Rating | `bgg`        | `communityRating` | (user) | Pass-through (already 1-10)                                                                                  |
| Complexity       | `bgg`        | `weight`          | (user) | BGG weight 1-5 normalized to 1-10: `score = weight * 2`                                                      |
| Tournament       | `tournament` | `null`            | 30     | Value is the normalized ELO display score per REQ-TAXIS-6 (see `.lore/specs/tournament/elo-axis-source.md`). |

The user can create additional BGG-derived axes later (player count fit, for example), but MVP ships with the two BGG-derived axes above. The Tournament axis is a singleton system axis auto-created on collection initialization (REQ-TAXIS-3, REQ-TAXIS-4).

## Collection

The user's set of games. MVP supports a single collection (one user, one shelf).

```typescript
interface Collection {
  id: string; // UUID
  name: string; // Default: "My Collection"
  axes: Axis[];
  games: Game[];
  createdAt: string;
  updatedAt: string;
}
```

## Storage Format

All state persists as JSON files in a configurable data directory (default: `~/.shelf-judge/data/`).

```
~/.shelf-judge/
  data/
    collection.json              # Single collection with embedded axes and games
  config.json                    # App config (BGG token, data dir, socket path)
```

MVP uses a single `collection.json` file. This is deliberately simple. If the file grows unwieldy with hundreds of games, splitting into per-game files is a straightforward migration, but not one we need to design for now.
