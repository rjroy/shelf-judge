---
title: "Tournament-based ELO ranking"
date: 2026-04-06
status: implemented
tags: [spec, fitness, ranking, tournament, elo, pairwise]
modules: [daemon, web, cli, shared]
related:
  - .lore/vision.md
  - .lore/specs/mvp.md
  - .lore/brainstorms/fitness-model-options.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/designs/mvp-data-model.md
  - .lore/issues/tournament/deferred-tournament-ranking.md
  - .lore/mockups/ (tournament-*.html)
req-prefix: TOURN
---

# Spec: Tournament-Based ELO Ranking

## Overview

Adds pairwise head-to-head comparisons to shelf-judge. The user answers "which of these two games would you keep?" and the system derives a ranking from the accumulated answers using ELO scoring. This creates a second fitness signal alongside the existing axis-based weighted average: one captures revealed preference (tournament), the other captures stated preference (axes). The two are presented together but calculated independently.

This satisfies the hybrid model identified in the fitness brainstorm: "one tournament, multiple scorecards." The tournament answers "does this belong on your shelf?" The scorecards answer "why?"

## Entry Points

- User initiates a tournament session from the web UI or CLI.
- User resumes a tournament session that was previously interrupted.
- User views a game's fitness and sees the ELO rank alongside the axis score.

## Key Decision: ELO and Axis Fitness Are Peers, Not Parent-Child

Three options were considered for where ELO sits relative to the existing axis fitness score:

1. **ELO replaces axis fitness.** Axes become descriptive only; the score comes from tournament results. This discards the primary value of axes: that they produce scores from game one, before enough comparisons exist.

2. **ELO is another axis.** The tournament score feeds into the weighted average alongside "wife will play it" and "complexity." This creates a circular dependency: if the tournament ranking is partly informed by what the user values (which axes capture), then using the tournament as an input to the axes means it's competing with signals it's derived from.

3. **ELO and axis fitness are independent peer scores.** Both are visible. Neither feeds into the other. The user sees two numbers: "Axis fitness: 7.9" and "Tournament rank: 8.3." When they diverge, that divergence is informative ("you rate Gloomhaven highly on your axes but consistently choose other games over it in head-to-head").

**Decision: Option 3.** The two scores are complementary signals. Axis fitness reflects what you think you value. Tournament ranking reflects what you actually choose. Showing both, and letting the user see when they diverge, is more honest than collapsing them into a single number. This aligns with Vision Principle 2 (transparency) and the brainstorm's core insight about stated vs. revealed preference.

Both scores appear in the game detail view. Ranked lists can be sorted by either score. No combined score is computed.

## Key Decision: Tournament Structure

A 200-game collection makes full round-robin impractical (~20,000 pairs). The system uses a session-based approach with adaptive pairing.

**Session initiation.** The user starts a tournament session. They can scope the session to a subset of games by filter: by name search, by axis threshold ("games I rated above 6 on complexity"), by BGG tag (mechanic or category), or by recency ("games I haven't compared in 30+ days"). If no filter is applied, the session draws from the full collection. The minimum collection size for a session is 4 games.

**Pairing strategy.** Within a session, the system selects pairs adaptively. Games with fewer total comparisons are prioritized. Among those, games with similar current ELO ratings are preferred (comparisons between closely matched games are more informative than blowouts). The user does not control which pairs appear.

**Session length.** A session presents pairs until the user stops. There is no fixed bracket or elimination structure. Each comparison is independently valuable. The user can do 3 comparisons or 30. The system tracks how many comparisons have been completed in the session and across all sessions.

**Resumability.** A session can be abandoned and resumed later. Session state (which games are in scope, how many comparisons have been completed this session) persists.

## Key Decision: Comparison History Is First-Class Data

ELO requires knowing the result of each comparison to calculate scores correctly. The system records every comparison as a first-class entity.

**Why recording is necessary.** ELO scores are derived from match history, not stored as standalone values. If the history is lost, the scores can't be recalculated, can't be audited, and can't survive algorithm changes (e.g., adjusting K-factor). Recording also enables the transparency the vision demands: the user can see which comparisons drove a game's rank.

**What is recorded per comparison:**

- The two game IDs
- Which game won
- Timestamp
- Session ID (groups comparisons from the same sitting)

**What is NOT recorded:** reasons, annotations, axis-specific comparisons. These were explored in the brainstorm (Approach 2) but add burden without proportional value. The axes already capture "why." The tournament captures "which."

## Requirements

### Data Model

- REQ-TOURN-1: A `Comparison` entity MUST be added to the data model with fields: `id` (UUID), `gameAId` (string), `gameBId` (string), `winnerId` (string, must equal gameAId or gameBId), `sessionId` (string), and `createdAt` (ISO 8601 timestamp).

- REQ-TOURN-2: A `TournamentSession` entity MUST be added with fields: `id` (UUID), `filter` (the scope criteria used to select games, nullable for unfiltered sessions), `gameIds` (array of game IDs in scope), `comparisonCount` (number of comparisons completed in this session), `status` ("active" or "completed"), `createdAt` and `updatedAt` (ISO 8601). There is no "paused" state. An active session remains active until the user explicitly ends it or starts a new session. "Resuming" means returning to an active session, not restoring a paused one.

- REQ-TOURN-3: Comparisons and tournament sessions MUST be stored in a new `tournament.json` file at `$dataDir/tournament.json` (same configurable directory as `collection.json`). Tournament data is structurally independent from collection data. Writes to `tournament.json` MUST follow the same atomic write pattern as `collection.json` (temp file + rename).

- REQ-TOURN-4: Each game MUST have an `eloRating` field (number, default 1500) and a `comparisonCount` field (number, default 0) stored in the tournament data file, not on the Game entity itself. These are derived from comparison history but cached for performance.

### ELO Calculation

- REQ-TOURN-5: ELO scores MUST be calculated using the standard ELO formula. Expected score: `E = 1 / (1 + 10^((opponent_rating - player_rating) / 400))`. New rating: `R_new = R_old + K * (S - E)` where S is 1 for a win and 0 for a loss. Both games are updated after each comparison.

- REQ-TOURN-6: The K-factor MUST be 32 for games with fewer than N comparisons and 16 for games with N or more comparisons, where N is the K-factor transition threshold. This allows new games to move quickly in the ranking while stabilizing established games. The transition threshold defaults to 15 and is configurable via daemon settings. K-values (32 and 16) are fixed constants derived from ELO theory and are not user-configurable. Changes to the threshold take effect on the next recalculate (REQ-TOURN-7).

- REQ-TOURN-7: [SUPERSEDED by `.lore/specs/tournament/reduce-tournament-overhead.md`] ~~ELO ratings MUST be recalculable from comparison history.~~ Cached ELO scores and win/loss counts are now authoritative. The `recalculate` operation was removed. See REQ-RTO-9.

- REQ-TOURN-8: When a game is deleted from the collection, its comparisons MUST be retained in tournament history (the game ID remains as a historical reference). The deleted game's ELO rating is removed from the cached scores. Comparisons involving deleted games still contribute to surviving games' histories during recalculation.

### Display and Normalization

- REQ-TOURN-9: For display purposes, ELO ratings MUST be normalized to a 1.0-10.0 scale. When fewer than 5 games have at least one comparison, display "not yet ranked" for all games (the sample is too small for normalization to be meaningful). Once 5 or more games have comparisons, normalize using a configurable reference window centered on 1500. The window half-width defaults to 400 (producing a reference range of 1100-1900) and is configurable via daemon settings. Normalization formula: `min_ref = 1500 - half_width`, `max_ref = 1500 + half_width`, `display = clamp(1 + 9 * (elo - min_ref) / (max_ref - min_ref), 1.0, 10.0)`. This avoids the instability of min/max normalization where a single comparison could produce extreme display scores. Games with ELO outside the reference range clamp to 1.0 or 10.0. Changes to the half-width take effect immediately on display.

- REQ-TOURN-10: The game detail view (web UI and CLI) MUST show both the axis fitness score and the tournament rank as independent values. When the game has no comparisons, the tournament rank displays as "not yet ranked." When the game has fewer than P comparisons, where P is the provisional threshold (default 6, configurable via daemon settings), the rank displays with a "(provisional)" qualifier. Changes to the threshold take effect immediately on display.

- REQ-TOURN-11: A tournament rank breakdown MUST be available showing: total comparisons for this game, win/loss record, the 5 most recent comparisons with opponent names and outcomes, and the raw ELO rating alongside the normalized display score. This parallels the axis fitness breakdown (REQ-MVP-5) for the tournament signal.

### Tournament Sessions

- REQ-TOURN-12: Users MUST be able to start a tournament session with an optional filter. Supported filters: by game name substring, by minimum axis fitness score, by BGG mechanic or category tag, or by "stale" (games with fewer than N total comparisons, where N is user-specified and defaults to the provisional threshold from REQ-TOURN-10; this link is intentional so that a staleness-filtered session graduates games out of provisional status). Filters can be combined. The session scope is fixed at creation; adding or removing games from the collection mid-session does not change the session's game list.

- REQ-TOURN-13: The minimum number of games in a session scope is 4. If a filter produces fewer than 4 games, the session is not created and the user is told why.

- REQ-TOURN-14: During an active session, the system MUST present pairs using adaptive selection: prioritize games with fewer total comparisons, then prefer games with similar current ELO ratings (within 200 points). If multiple candidate pairs have equal priority, select randomly. The same pair MUST NOT be presented twice within the same session.

- REQ-TOURN-15: Only one session can be active at a time. An active session persists until the user explicitly ends it or starts a new session (which completes the previous one). The user can leave and return to an active session freely; there is no separate "pause" action. Completed sessions are retained for history.

- REQ-TOURN-15a: During an active session, if a game in the session's `gameIds` is deleted from the collection, that game MUST be silently excluded from future pair selection within the session. Comparisons already recorded involving the deleted game are retained per REQ-TOURN-8. If exclusions reduce the session's available games below 4, the session is automatically completed.

- REQ-TOURN-16: Each comparison within a session presents two game names and their thumbnails (from the game's `imageUrl` field, omitted when null) and accepts a winner selection. No "tie" or "skip" option. Every comparison produces a result. The user can end the session at any time.

### Collection Integration

- REQ-TOURN-17: The collection game list MUST be sortable by tournament rank (normalized ELO) in addition to the existing axis fitness sort. Games with no comparisons sort to the bottom of tournament-ranked lists.

- REQ-TOURN-18: When the axis fitness score and tournament rank for a game differ by more than 2.0 points (on the normalized 1-10 scale), and both scores are non-provisional, the game detail view MUST flag this as a divergence: "Your axis ratings suggest this game is a [higher/lower] fit than your head-to-head choices indicate." This is informational, not prescriptive. The flag is suppressed when either score is provisional or absent.

### API

- REQ-TOURN-19: The daemon MUST expose tournament operations through the existing Hono API: start session, get next pair, submit comparison result, end session, get game tournament stats, list sessions, and recalculate ELO scores. Request/response shapes for these endpoints require a design document (following the pattern of `.lore/designs/mvp-api-surface.md`) before implementation.

- REQ-TOURN-20: The CLI MUST support tournament operations: `sj tournament start [--filter ...]`, `sj tournament next` (show next pair), `sj tournament pick <game-id>` (submit winner), `sj tournament stop`, `sj tournament stats [game-id]`, and `sj tournament recalculate`. All commands support `--json` output.

## Exit Points

| Exit                                      | Triggers When                                                      | Target                        |
| ----------------------------------------- | ------------------------------------------------------------------ | ----------------------------- |
| Axis-specific tournaments                 | User wants head-to-head on a single axis ("which has better art?") | [STUB: axis-tournament]       |
| Convergence detection                     | System should tell user when rankings have stabilized              | [STUB: convergence-detection] |
| Collection profiling from tournament data | Tournament history reveals preference patterns                     | [STUB: collection-profile]    |
| Combined fitness score                    | User wants a single number blending both signals                   | [STUB: combined-fitness]      |

## Scope Exclusions

- **No tie or skip in comparisons.** Every comparison produces a winner. Ties dilute the ELO signal and add complexity for minimal value. If the user genuinely can't choose, they end the session. The cost of a forced choice on a close pair is low (ELO adjustments are small when ratings are similar).
- **No per-axis tournaments.** This spec covers overall "which would you keep?" comparisons only. Per-axis comparisons ("which has better art?") multiply the comparison burden and are stubbed for future consideration.
- **No automated session scheduling.** The system does not prompt the user to run tournament sessions. Sessions are always user-initiated.
- **No undo on comparisons.** Once submitted, a comparison is recorded. The user can make a "corrective" comparison later (the same pair can appear in different sessions), and the ELO system naturally adjusts. Building an undo mechanism adds complexity for a scenario where the ELO math already self-corrects.

## Success Criteria

### Automated Tests (bun test)

- [ ] Submitting a comparison updates both games' ELO ratings according to the standard formula
- [ ] K-factor is 32 for games with < 30 comparisons and 16 for games with >= 30
- [ ] Recalculating from history produces the same ELO scores as incremental updates
- [ ] Deleting a game preserves its comparisons and does not corrupt other games' scores
- [ ] ELO normalization: displays "not yet ranked" when fewer than 5 games have comparisons
- [ ] ELO normalization: uses fixed reference range (1100-1900) and clamps correctly
- [ ] ELO normalization: handles edge case of all games with same ELO
- [ ] Session with filter produces correct game subset
- [ ] Session rejects creation when filter yields fewer than 4 games
- [ ] Adaptive pairing prioritizes low-comparison-count games
- [ ] Same pair is not presented twice within one session
- [ ] Starting a new session completes the previous active session
- [ ] Deleting a game mid-session excludes it from future pair selection
- [ ] Session auto-completes when deletions reduce available games below 4
- [ ] Atomic writes to tournament.json (temp file + rename)

### Manual Verification (demonstration)

- [ ] Start a tournament session, complete 10 comparisons, see ELO rankings update in real time
- [ ] Start a filtered session (e.g., mechanic = "Worker Placement"), verify only matching games appear
- [ ] View a game's detail page showing both axis fitness and tournament rank
- [ ] Trigger divergence flag by rating a game highly on axes but consistently losing in comparisons
- [ ] CLI `sj tournament stats` shows win/loss record and recent comparisons
- [ ] Resume an interrupted session and continue from where it left off
- [ ] Run `sj tournament recalculate`, verify ELO scores match incrementally-computed values

## AI Validation

**Defaults** (apply unless overridden):

- Unit tests with mocked time/network/filesystem
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom:**

- ELO math verified against hand-calculated examples (document a 5-game, 10-comparison worked example in tests)
- Normalization edge cases tested: fewer than 5 compared games ("not yet ranked"), all equal ratings, ELO outside reference range (clamping), ELO within normal spread
- Adaptive pairing verified: after N comparisons, games with 0 comparisons are always selected first
- Tournament data persistence survives simulated crash (write to temp + rename pattern)

## Constraints

- Tournament data is stored separately from collection data (`tournament.json` alongside `collection.json`). This prevents tournament writes from risking collection data corruption.
- No AI/LLM in any computation. ELO is deterministic math.
- Single-user. No multiplayer tournaments or shared rankings.
- The tournament feature MUST NOT change the existing axis fitness calculation. The two systems are independent.
- A minimum of 4 games in the collection is required to start any tournament session.

## Open Questions

These are genuine unknowns that should be resolved through use:

1. **K-factor tuning.** The K-factor transition threshold defaults to 15 and the provisional threshold defaults to 6 (both configurable via daemon settings). These are informed guesses for a recreational board game collection. If rankings feel too volatile or too sticky, the transition threshold can be adjusted and history replayed via recalculate (REQ-TOURN-7). Observe whether 15/6 are the right defaults after real use.

2. **Normalization reference range.** The reference window half-width defaults to 400 (range 1100-1900), configurable via daemon settings. If display scores feel compressed toward the middle of the 1-10 range, narrowing the half-width (e.g., to 200) will spread them out. If scores cluster at the extremes, widen it. Observe after real use.

3. **Session filter UX.** The spec defines four filter types (name, axis fitness, BGG tag, staleness). How these are surfaced (filter builder, search syntax, preset buttons, or something else) is a design decision. The web UI and CLI design documents must resolve this before implementation. Visual mockups for the filter UX are at `.lore/mockups/ (tournament-*.html)`.

## Context

- [Vision](.lore/vision.md): Transparency principle (Principle 2) requires both scores to show their derivation. Principle 4 ("data serves judgment") means the tournament rank informs but doesn't decide.
- [Fitness Brainstorm](.lore/brainstorms/fitness-model-options.md): Explored pairwise tournament as Approach 2. Hybrid conclusion (tournament + axes) is the long-term direction this spec implements.
- [MVP Spec](.lore/specs/mvp.md): Deferred tournament ranking at line 92. Exit point at line 105 (`[STUB: tournament-ranking]`).
- [MVP Fitness Model](.lore/designs/mvp-fitness-model.md): Documents the axis scorecard system this feature sits alongside, not within.
- [MVP Data Model](.lore/designs/mvp-data-model.md): Defines Game, Axis, Collection structures. Tournament data extends but does not modify these.
- [Deferred Issue](.lore/issues/tournament/deferred-tournament-ranking.md): Origin of this work. Issue can be closed when this spec is approved.
