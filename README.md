# Shelf Judge

**Board game collection curation.** Shelf Judge combines personal, multi-axis ratings with Board Game Geek community data to produce a single, transparent fitness score for every game on your shelf — and every game you're considering adding.

> _A game earns its place for reasons unique to the owner. Shelf Judge makes those reasons legible._

## What It Does

- **Define rating axes that matter to you** — "Date night playability," "Hits the table," "Visual design," anything. Each axis gets a weight that reflects how much you care about it.
- **Rate your games** on those axes (1–10). BGG data fills in Community Rating and Complexity automatically.
- **See a fitness score** (1.0–10.0) for every game, with a full breakdown showing exactly which axes drove the number, how each was weighted, and whether the value came from you or BGG.
- **Run a tournament** to rank games head-to-head via an ELO comparison loop — useful when direct ratings feel hard to anchor.
- **Score your wishlist** — predict fitness for games you haven't played yet, based on similarity to games you have rated.
- **Spot redundancy** — games that overlap mechanically with better-rated alternatives on your shelf get a penalty surfaced in the score breakdown.
- **Filter and sort your collection** by score, play count, mechanics, weight, player count, and more.

The fitness score is always honest about how it was derived. No score appears without its breakdown.

## Architecture

Shelf Judge runs locally. There is no server, no cloud sync, no account.

```
packages/
  shared/    TypeScript types and Zod schemas shared across all packages
  daemon/    Hono server on a Unix socket (/tmp/shelf-judge.sock), JSON persistence (~/.shelf-judge/)
  web/       Next.js 16 frontend, proxies to daemon via /api/daemon/[...path]
  cli/       Bun CLI (shelf-judge / sj), communicates with daemon over Unix socket
```

The daemon owns all data. The web UI and CLI are both clients of the daemon API. All state is stored as JSON files under `~/.shelf-judge/` — no database required.

## Requirements

- [Bun](https://bun.sh) ≥ 1.2
- A BGG application token for BGG-dependent features (search, import, community data). The app works without one for manual entry and personal-only scoring.

## Getting Started

```bash
# Install dependencies
bun install

# Start the daemon and web UI together
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

### BGG Application Token

To search BGG, import your collection, or use Community Rating and Complexity axes, register a token at [https://boardgamegeek.com/using_the_xml_api](https://boardgamegeek.com/using_the_xml_api) and configure it:

```bash
shelf-judge config set bgg-token YOUR_TOKEN
```

The app runs fully without a token — manual game entry, personal axes, and fitness scoring on personal ratings all work offline.

## CLI

The `shelf-judge` binary (alias `sj`) connects to the daemon over its Unix socket.

```bash
# Games
shelf-judge game search "wingspan"
shelf-judge game add --bgg-id 266192
shelf-judge game add --name "Custom Game"    # no BGG data
shelf-judge game list

# Rate a game
shelf-judge game rate <id> --axis "Wife will play it" 8 --axis "Visual design" 9

# Axes
shelf-judge axis list
shelf-judge axis create "Wife will play it" --weight 40
shelf-judge axis update <id> --weight 50

# Scores
shelf-judge score list               # All games ranked by fitness
shelf-judge score get <id>           # Full breakdown for one game

# Import
shelf-judge import bgg-collection <bgg-username>

# Wishlist
shelf-judge wishlist add --bgg-id 342942
shelf-judge wishlist list

# Tournament
shelf-judge tournament start
shelf-judge tournament next          # Next matchup
shelf-judge tournament pick <id>    # Choose a winner

# Configuration
shelf-judge config set bgg-token <token>

# Daemon management
shelf-judge start
shelf-judge stop
```

Every command accepts `--json` for raw JSON output — useful for scripting and agent consumption.

## Web UI

The web UI is the primary interface. Navigate from the sidebar:

| Page | What you do there |
|---|---|
| **Collection** | Browse all games sorted by fitness, filter and sort, see the redundancy and prediction overlays |
| **Game detail** | View fitness breakdown, rate axes, refresh BGG data, edit box dimensions |
| **Search / Add** | Find games on BGG or add manually |
| **Wishlist** | Games you want; predicted fitness scores shown alongside |
| **Axes** | Create, edit, and delete personal rating axes and adjust weights |
| **Tournament** | Run head-to-head ELO sessions; configure the bracket filters |
| **Redundancy** | Configure the overlap-penalty settings |
| **Previously Owned** | Games you've culled; keep a record without cluttering the active shelf |

## Fitness Score

```
fitness = Σ(rating × weight) / Σ(weight)
```

Only axes with a rating for that game contribute to the numerator and denominator. Unrated axes are listed in the breakdown as "not rated" — they do not silently drag the score down.

**Example breakdown for Wingspan:**

```
Fitness: 7.9

  Wife will play it    8   × 40  →  320   [your rating]
  Visual design        9   × 30  →  270   [your rating]
  Complexity           5.8 × 20  →  116   [BGG weight 2.9 → 5.8]
  Community Rating     8.1 × 10  →   81   [BGG]
  ────────────────────────────────────────
  Sum of contributions: 787  /  Sum of weights: 100  =  7.87  →  7.9
```

BGG-derived values that you've overridden show both your rating and the original BGG value.

## Development

```bash
bun run dev          # daemon + web UI (hot reload)
bun run test         # Bun test suite across all packages
bun run typecheck    # TypeScript strict checking
bun run lint         # ESLint
bun run format       # Prettier
```

Tests live alongside source files and in `packages/daemon/tests/`. BGG API tests use hand-crafted XML fixtures — no live network calls.

## Data Storage

All data lives under `~/.shelf-judge/`:

```
~/.shelf-judge/
  config.json          BGG token and settings
  data/
    collection.json    Games and ratings
    axes.json          Personal axes and weights
    bgg-cache/         Cached BGG API responses (7-day TTL)
    tournaments/       ELO tournament sessions
    wishlist.json      Wishlist games
```

Writes are atomic (write to temp file, rename into place). A crash mid-write cannot corrupt existing data.

## Project Status

Shelf Judge is pre-1.0. All core features are implemented:

- [x] Multi-axis fitness scoring with full breakdown
- [x] BGG integration (search, import, community rating, complexity)
- [x] Utility curves for non-linear axis scoring (plateau, S-curve, hard veto)
- [x] Tournament-based ELO ranking
- [x] Redundancy penalty (overlap-aware fitness)
- [x] Prediction engine for wishlist / unrated games
- [x] Collection filter and sort
- [x] Collection profiling (taste profile inference)
- [x] Wishlist management
- [x] Previously-owned tracking
- [x] Niche champion display
- [ ] **Shelf capacity** — physical box dimensions, shelf configuration, and bin-packing overflow detection _(in progress → 1.0)_

## Guiding Principles

1. **Ownership is personal and specific.** Axes are user-defined because "good" is never one thing.
2. **One number, honestly derived.** Every fitness score can be cracked open to see exactly what drove it.
3. **Your collection has an identity.** The pattern of what you own and why encodes preferences you may never have articulated.
4. **Data serves judgment, not replaces it.** BGG provides context. The owner decides.
5. **The shelf has a carrying capacity.** Fitness is relative. A fifth worker-placement game isn't as fit as the first, even if it's individually excellent.

## License

[MIT](LICENSE)
