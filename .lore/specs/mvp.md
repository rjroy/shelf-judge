---
title: "Shelf Judge MVP"
date: 2026-04-04
status: implemented
tags: [spec, mvp, fitness, scoring, bgg, board-games]
modules: [daemon, web-ui, cli]
related:
  - .lore/vision.md
  - .lore/brainstorms/fitness-model-options.md
  - .lore/research/bgg-api.md
  - .lore/reference/architecture-pattern.md
  - .lore/designs/mvp-data-model.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/designs/mvp-bgg-integration.md
  - .lore/designs/mvp-api-surface.md
  - .lore/designs/mvp-web-ui.md
  - .lore/designs/mvp-cli.md
req-prefix: MVP
---

# Spec: Shelf Judge MVP

## Overview

The MVP delivers the core value proposition: a user creates personal rating axes, rates owned games on those axes, and gets a transparent fitness score for each game. BGG provides community data (rating, weight, mechanics, categories, player counts) that feeds into the score alongside personal ratings. The user can see exactly which axes drove the number and how much each contributed.

This is the smallest thing that proves the idea works. One user, their shelf, their axes, their scores, fully transparent.

## Entry Points

- Launch the daemon and open the web UI (primary workflow)
- Run `shelf-judge` CLI commands against the daemon's Unix socket
- Import an existing BGG collection to bootstrap the shelf

## Requirements

### Axes and Weights

- REQ-MVP-1: Users can create, edit, and delete personal rating axes. Each axis has a name, optional description, and a weight (0-100) representing its importance in the fitness calculation.
- REQ-MVP-2: Users can rate any game on any personal axis using an integer scale of 1 to 10, inclusive. Ratings outside this range are rejected. A game can have ratings on any subset of axes (partial rating is valid).
- REQ-MVP-3: The system creates two default BGG-derived axes on first run: Community Rating and Complexity. These behave like personal axes (editable weight, deletable) but their ratings are auto-populated from BGG data rather than user input.

### Fitness Scoring

- REQ-MVP-4: The system computes a fitness score for each game as a weighted average of all rated axes. The formula is `sum(rating * weight) / sum(weight)` across only the axes that have a rating for that game. Unrated axes are excluded from both numerator and denominator.
- REQ-MVP-5: Every displayed fitness score must include its full breakdown: each axis's name, rating, weight, contribution to the total, and source (personal, BGG, or user override of BGG). This is a hard requirement from the vision (Principle 2: "One number, honestly derived"). No score is ever shown without its derivation.
- REQ-MVP-6: Scores are displayed to one decimal place (1.0 to 10.0).

### Game Management

- REQ-MVP-7: Users can add games by BGG ID (fetches full data from the BGG API), by name search against BGG (search, select from results, fetch full data), or manually (name only, no BGG data).
- REQ-MVP-8: Users can remove a game from their collection. Removal deletes the game and all its ratings. This is not reversible.
- REQ-MVP-9: Duplicate detection on import: when adding a game that matches an existing game's BGG ID, the system rejects the addition and reports the duplicate. Manual games (no BGG ID) are never considered duplicates of each other.

### BGG Integration

- REQ-MVP-10: Users can import their owned games from a public BGG collection by username. The import fetches game data from BGG and adds each game to the local collection. Games that already exist (matched by BGG ID) are skipped and counted in the import summary. BGG data for existing games is not updated during import (use explicit refresh for that).
- REQ-MVP-11: The system must function without BGG connectivity. When no BGG token is configured or BGG is unreachable, all local features work: manual game entry, personal axis creation, personal ratings, and fitness scoring on personal axes. Only BGG-dependent operations (search, import, BGG-derived axis auto-population, BGG data refresh) are unavailable.
- REQ-MVP-12: When no BGG application token is configured, the system reports this clearly on any BGG-dependent operation: what's missing, where to register, and how to configure it. The daemon starts normally without a token.
- REQ-MVP-13: BGG API failures (timeouts, 5xx errors, malformed responses) must not crash the daemon or corrupt local data. Failures are reported to the user with enough context to understand what happened. Partial import failures report which games succeeded and which failed.

### Score Behavior and Edge Cases

- REQ-MVP-14: A game with zero rated axes has no fitness score. The system displays this as "not yet rated" rather than zero or null. The game still appears in the collection but is excluded from ranked lists.
- REQ-MVP-15: When a user deletes an axis, all ratings on that axis across all games are also deleted. Every affected game's fitness score is recalculated. The deletion confirmation communicates how many games have ratings on the axis that will be removed.
- REQ-MVP-16: When all axis weights sum to zero (e.g., the user sets every weight to zero), the system treats this as "no weighted axes" and behaves like REQ-MVP-14 (no score, "not yet rated"). Division by zero never occurs.
- REQ-MVP-17: BGG-derived axis ratings are auto-populated from cached BGG data. Users can override any BGG-derived rating with a personal value. Overrides are preserved across BGG data refreshes. The breakdown shows the original BGG value alongside the override so the user can compare.

### Data Freshness

- REQ-MVP-18: BGG data is cached locally per game. Cached data older than 7 days is considered stale but is still used (stale data is acceptable; missing data is not).
- REQ-MVP-19: Users can manually trigger a BGG data refresh for a single game or for all games in the collection. A refresh fetches current data from BGG, updates the cache, and re-derives any BGG axis ratings that have not been overridden by the user. User overrides are preserved. A game's fitness score may change after refresh if its non-overridden BGG-derived axis ratings change.

### Persistence

- REQ-MVP-20: All state (games, axes, ratings, BGG cache) persists locally as JSON files. No external database. The system reads state on startup and writes on mutation.
- REQ-MVP-21: The storage format must survive unclean shutdown. Writes are atomic (write to temp file, rename into place). A crash mid-write must not corrupt existing data.

### Interface

- REQ-MVP-22: The system exposes three interfaces: a daemon API (Hono on Unix socket), a web UI (Next.js), and a CLI. All three are views over the same data. The daemon is the single source of truth; the web UI and CLI are clients.
- REQ-MVP-23: The CLI provides a `--json` flag on all commands, outputting raw JSON for scripting and agent consumption.
- REQ-MVP-24: The web UI and CLI both display the full score breakdown (per REQ-MVP-5) in their respective formats. The breakdown is not a web-only feature.

### Deferred

These are real features from the vision, explicitly not in MVP:

- **Redundancy / collection-awareness.** Fitness is calculated per game in isolation. No mechanic overlap penalty, no "you already own three worker-placement games" adjustment. The vision's Principle 5 ("the shelf has a carrying capacity") is deferred until the core scoring loop is proven.
- **Prediction for unowned games.** MVP scores only games in the user's collection with personal ratings. Estimating fitness for games you haven't rated requires a similarity engine that depends on having enough rated data to be meaningful.
- **Collection identity / profiling.** No "your taste profile says..." inference. Principle 3 ("your collection has an identity") is a post-MVP feature that builds on a populated rating dataset.
- **Pairwise tournament ranking.** The brainstorm's hybrid conclusion (tournament for overall fitness + direct ratings for axes) is the long-term direction. MVP uses direct ratings only. The tournament layer adds significant UX and implementation complexity for a feature that requires 20+ games to converge. Ship the scorecard first; validate that users find multi-axis rating useful before adding the comparison layer.
- **Utility curves / veto axes.** All axes use linear scoring in MVP. Plateau curves, S-curves, and hard vetoes (Approach 4 from the brainstorm) are powerful but increase configuration burden. Linear is the right default; curves are a refinement.
- **LLM-mediated scoring.** No AI in the fitness calculation. The score is deterministic math. LLM features (natural language score explanation, conversational axis creation) are future enhancements.
- **BGG user authentication.** MVP uses only public BGG data (application token, no user login). Private collection data (acquisition price, private notes) requires BGG user auth, which adds complexity for marginal MVP value.
- **Play history import.** BGG play logs are available but not used in MVP scoring.

## Exit Points

| Exit                 | Triggers When                            | Target                     |
| -------------------- | ---------------------------------------- | -------------------------- |
| Redundancy scoring   | User wants overlap-aware fitness         | [STUB: redundancy-scoring] |
| Prediction engine    | User wants scores for unowned games      | [STUB: prediction-engine]  |
| Collection profiling | User wants taste profile inference       | [STUB: collection-profile] |
| Tournament ranking   | User wants pairwise comparison layer     | [STUB: tournament-ranking] |
| Utility curves       | User needs non-linear axis scoring       | [STUB: utility-curves]     |
| LLM features         | User wants natural language explanations | [STUB: llm-integration]    |

## Success Criteria

### Automated Tests (bun test)

- [ ] Creating an axis and rating a game on it produces a correct fitness score (weighted average math verified)
- [ ] Multiple axes with different weights produce the correct weighted average
- [ ] Missing ratings on some axes correctly exclude those axes from the calculation
- [ ] BGG-derived axes auto-populate from cached BGG data
- [ ] Score breakdown entries sum to the total fitness score
- [ ] BGG client handles 202 retry, 429 backoff, and malformed XML gracefully
- [ ] Import from BGG collection creates games with cached BGG data
- [ ] Duplicate BGG ID import is rejected with a clear message
- [ ] Deleting an axis removes all ratings on that axis and recalculates affected scores
- [ ] Ratings outside 1-10 are rejected
- [ ] A game with zero rated axes returns "not yet rated" (no score)
- [ ] All-zero weights produce "not yet rated" (no division by zero)
- [ ] BGG data refresh preserves user overrides of BGG-derived ratings
- [ ] Storage writes are atomic (temp file + rename)

### Manual Verification (demonstration)

- [ ] Add a game by searching BGG, rate it on 2+ axes, see the fitness score with breakdown
- [ ] Create a custom axis, re-rate games, observe score changes
- [ ] Import a BGG collection (10+ games), verify games appear with BGG data populated
- [ ] CLI `shelf-judge score list` shows all games ranked by fitness; `shelf-judge score get <id>` shows the full breakdown for any game
- [ ] Web UI displays score breakdown that matches the math (manually verify one game's arithmetic)
- [ ] Start daemon without BGG token, verify manual game entry and personal scoring work
- [ ] Disconnect from network, verify local operations continue
- [ ] Override a BGG-derived axis rating on one game, trigger a BGG refresh, confirm the override is preserved and the original BGG value is shown alongside it

## AI Validation

**Defaults** (apply unless overridden):

- Unit tests with mocked time/network/filesystem
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom:**

- Fitness score math verified against hand-calculated examples (the Wingspan example in the fitness model design)
- BGG XML parsing tested against captured real API responses, not synthetic XML
- CLI output for `score list` and `score get` matches the breakdown format shown in the CLI design
- Edge case tests for: zero-weight axes, all-unrated game, deleted-axis cascade, duplicate import rejection

## Constraints

- All BGG API calls are server-side (CORS disabled on BGG API).
- No database. All state in JSON files.
- Single-user. No auth, no multi-tenancy. The daemon serves one person's collection.
- No AI/LLM in MVP. Fitness is deterministic math.
- BGG application token is required for any BGG functionality. The app must function (with manual game entry and personal-only axes) without a token configured.
- All fitness scores must include a breakdown. No score is ever displayed without its derivation.

## Open Questions

These are genuine unknowns that don't block MVP implementation but should be resolved through use:

1. **Axis weight UX:** Should weight be a raw number (1-100) or a relative slider where all weights auto-normalize to 100%? Raw numbers are simpler to implement; normalized sliders are more intuitive. The implementer should start with raw numbers and the API normalizes them in the score calculation (divides by sum of weights). The UI can present this as percentages without changing the storage model.

2. **BGG library choice:** Several viable TypeScript libraries exist. The implementer should verify auth token support and pick one. This is an implementation decision, not a spec decision.

3. **Collection import conflict resolution:** Resolved. See REQ-MVP-10: skip duplicates (match on bggId), report them in the import summary.

## Context

- [Vision](.lore/vision.md): Project direction and guiding principles (transparency, personal agency, deterministic math)
- [Fitness Model Brainstorm](.lore/brainstorms/fitness-model-options.md): Explored 4 scoring approaches; Approach 1 (axis scorecard) selected for MVP with hybrid as long-term direction
- [BGG API Research](.lore/research/bgg-api.md): API endpoints, auth requirements, rate limiting, XML parsing quirks
- [Architecture Pattern](.lore/reference/architecture-pattern.md): Hono daemon on Unix socket, route/service split, DI factories, operations registry
- [Data Model Design](.lore/designs/mvp-data-model.md): Game, Axis, Collection, and Storage structures
- [Fitness Model Design](.lore/designs/mvp-fitness-model.md): Weighted average algorithm, score breakdown interface, worked example
- [BGG Integration Design](.lore/designs/mvp-bgg-integration.md): Endpoints, rate limiting, caching, XML parsing
- [API Surface Design](.lore/designs/mvp-api-surface.md): Operations, request/response shapes, service layer
- [Web UI Design](.lore/designs/mvp-web-ui.md): Screens and navigation
- [CLI Design](.lore/designs/mvp-cli.md): Commands, output format, daemon management
