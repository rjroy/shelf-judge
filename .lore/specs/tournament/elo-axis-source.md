---
title: "Tournament axis source for fitness composition"
date: 2026-05-05
status: approved
tags: [spec, fitness, tournament, axis, elo, scoring]
modules: [shared, daemon, web, cli]
related:
  - .lore/specs/tournament/tournament-ranking.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/designs/mvp-data-model.md
  - .lore/specs/fitness/prediction-engine.md
req-prefix: TAXIS
---

# Spec: Tournament Axis Source

## Overview

Adds a third axis source type, `tournament`, alongside the existing `personal` and `bgg`. The tournament axis derives its per-game value from the normalized ELO display score produced by the existing tournament-ranking system. With this change, revealed preference (head-to-head outcomes) contributes to a single unified fitness score rather than living as a separate peer signal.

This supersedes the "ELO and axis fitness are independent peer scores" decision in `tournament-ranking.md`. The original rationale (circular dependency) does not hold: the tournament rank does not currently consume any axis output, so feeding it into the axis composition introduces one link, not two. The same spec's divergence flag (REQ-TOURN-18) and the prediction engine's revealed preference tension (REQ-PRED-16/17/28) both rest on the premise that a "gap between axis fitness and tournament rank" is informative. In practice it is not: axis ratings and head-to-head choices measure different things by construction, so the flag fires on most games without producing an actionable signal. Both surfaces are removed by this spec.

## Entry Points

- User has at least one comparison recorded; the tournament axis automatically reflects the latest normalized ELO for each game.
- User views any game's fitness breakdown and sees the tournament contribution alongside personal and BGG entries.
- User installs the change against an existing collection; the tournament axis is migrated in.

## Requirements

### Type System

- REQ-TAXIS-1: The `Axis.source` enum MUST be extended to include `"tournament"`. Existing `"personal"` and `"bgg"` values are unchanged.

- REQ-TAXIS-2: The `FitnessBreakdownEntry.source` enum MUST be extended to include `"tournament"`. The current enum is `"personal" | "bgg" | "override" | "predicted"` (the prediction engine added `"predicted"` per REQ-PRED-33). After this change the union becomes `"personal" | "bgg" | "override" | "predicted" | "tournament"`. The breakdown entry for a tournament axis records the normalized ELO value as the rating and contributes to the weighted average using the axis weight.

### Singleton Axis

- REQ-TAXIS-3: A collection MUST contain at most one axis with `source: "tournament"`. Creation logic MUST reject attempts to add a second tournament-source axis.

- REQ-TAXIS-4: The tournament axis MUST be auto-created on collection initialization. New collections ship with it. Existing collections without it MUST have it added on first load after this change deploys (load-time migration).

- REQ-TAXIS-5: The auto-created tournament axis has fixed defaults: `name: "Tournament"`, `description` describing its derivation from head-to-head comparisons, and a default weight (see [STUB: axis-weight-defaults] for the open question on default-weight policy across system axes).

### Value Derivation

- REQ-TAXIS-6: For each game, the tournament axis value MUST be the normalized ELO display score defined by REQ-TOURN-9: `clamp(1 + 9 * (elo - min_ref) / (max_ref - min_ref), 1.0, 10.0)`. The bounds `min_ref` and `max_ref` are derived from the configurable `half_width` per REQ-TOURN-9 (`min_ref = 1500 - half_width`, `max_ref = 1500 + half_width`); they are not hardcoded constants. Provisional games (fewer than the provisional threshold of comparisons) contribute their normalized score normally; provisional status is a display qualifier, not an exclusion criterion for fitness composition.

- REQ-TAXIS-7: The tournament axis value for a game is `null` in two cases: (a) the game has no comparisons, or (b) fewer than 5 games in the collection have any comparisons. Both cases produce `null` for the same documented reason: the normalization formula in REQ-TOURN-9 is unreliable below the 5-game cohort floor. A `null` value is excluded from both numerator and denominator of the fitness weighted average, identical to the existing handling of unrated personal axes.

- REQ-TAXIS-8: The tournament axis MUST integrate with the prediction engine on the same terms as any other axis. When the prediction engine fills missing values for unrated games, it MUST also fill missing tournament axis values where it can. No tournament-specific prediction logic is required by this spec; the prediction engine treats tournament like any other axis source. This explicitly relaxes the prediction engine constraint at `prediction-engine.md` line 234 ("The prediction engine does not predict tournament ELO scores"); see REQ-TAXIS-16.

### Migration and Compatibility

- REQ-TAXIS-9: On daemon startup, if the loaded collection has no tournament-source axis, one MUST be added before any client request is served, and any cached fitness scores or breakdowns derived from the pre-migration axis set MUST be invalidated in the same step. CLAUDE.md documents this pattern: schema-shape changes require a load-time guard or cache reset for `~/.shelf-judge/data/`. Inserting the axis without invalidating dependent caches leaves stale breakdowns visible to clients. The migration is idempotent: subsequent starts find the axis present and skip both the insertion and the cache reset.

- REQ-TAXIS-10: The migration MUST NOT modify or remove any existing axis. Personal and BGG axes are untouched. Game ratings on existing axes are untouched.

### Display

- REQ-TAXIS-11: The fitness breakdown view (web UI and CLI) MUST render the tournament axis entry the same way as other axes, with the source label distinguishing it ("[tournament]" or equivalent). When the tournament value is `null` (not yet ranked), the breakdown shows the entry as "not rated" using the same UI treatment as any other unrated axis.

- REQ-TAXIS-12: The standalone tournament rank display defined in REQ-TOURN-10 MUST remain. The tournament rank is still useful as an isolated lens; it is now also one input to the unified fitness score.

### Sorting

- REQ-TAXIS-13: The collection list MUST continue to support sorting by tournament rank (REQ-TOURN-17) and by fitness score independently. With tournament folded into fitness, the two sorts will diverge whenever non-tournament axes carry weight, so both orderings remain informative.

### Supersessions

- REQ-TAXIS-14: REQ-TOURN-18 (axis fitness vs tournament rank divergence flag) is SUPERSEDED. The flag MUST be removed from game detail views, and any code paths that compute the axis-fitness vs tournament-rank delta described in REQ-TOURN-18 MUST be deleted. The conceptual ground for the flag (axis fitness and tournament rank as independent signals) no longer holds once tournament is an axis source. The Manual Verification item in `tournament-ranking.md` that reads "Trigger divergence flag by rating a game highly on axes but consistently losing in comparisons" MUST also be struck from that spec; leaving it in place creates a regression test for a removed feature. (Comparison recording, ELO updates, and the `Comparison` entity are unaffected; only the score-delta logic is being removed.)

- REQ-TAXIS-15: The "Key Decision: ELO and Axis Fitness Are Peers, Not Parent-Child" section of `tournament-ranking.md` is SUPERSEDED. The implementing change to that spec is documentation-only: a note pointing at this spec. Behaviour changes are captured here.

- REQ-TAXIS-16: REQ-PRED-16, REQ-PRED-17, and REQ-PRED-28 (the "revealed preference tension" feature in the prediction engine) are SUPERSEDED. The tension surface is removed. The reasoning is the same as for REQ-TOURN-18: axis fitness and tournament rank measure different things by construction, so a flag that fires when they differ does not surface a useful signal. The Manual Verification items in `prediction-engine.md` that test the tension flag MUST also be struck. REQ-PRED-15 (tournament stability factor in similarity weighting) and REQ-PRED-18 (silent inactivity when no tournament data) are unaffected; they describe how tournament data participates in prediction confidence, which remains valid.

- REQ-TAXIS-17: The constraint at `prediction-engine.md` line 234 ("The prediction engine does not predict tournament ELO scores. Tournament data is an input to prediction weighting, not a prediction target") is SUPERSEDED. With tournament now an axis source, the prediction engine MUST be able to predict tournament axis values for games with no comparisons, on the same code path it uses for personal axes. The "input to prediction weighting" role described by REQ-PRED-15 remains; the "not a prediction target" exclusion is dropped.

## Exit Points

| Exit                                            | Triggers When                                                                   | Target                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------- |
| Editable non-personal axes                      | User wants to re-weight or remove the tournament axis (or any BGG axis)         | [STUB: editable-non-personal-axes]    |
| Sensible default weights for system axes        | User wants the auto-created tournament/BGG axes to ship with calibrated weights | [STUB: axis-weight-defaults]          |
| Removal of divergence flag from existing spec   | This spec lands and `tournament-ranking.md` needs its supersession note         | [Spec: tournament-ranking] (in-place) |
| Removal of tension surface from prediction spec | This spec lands and `prediction-engine.md` needs its supersession note          | [Spec: prediction-engine] (in-place)  |

## Scope Exclusions

- **No changes to ELO math.** The tournament axis consumes the existing normalized display score. K-factor, reference window, provisional threshold, and recalculation rules are unchanged.
- **No new editing affordances.** The user cannot delete or re-weight the tournament axis through this spec. That gap is acknowledged and stubbed for future work.
- **No new sort modes beyond REQ-TAXIS-13.** Existing sorts continue to work; no combined-sort or ranked-divergence sort is added.

## Success Criteria

- [ ] `Axis.source` accepts `"tournament"` and rejects unknown values per existing Zod validation patterns
- [ ] A new collection contains exactly one tournament-source axis on creation
- [ ] An existing collection without a tournament axis gains one on load; a second load is a no-op
- [ ] Attempting to create a second tournament-source axis is rejected
- [ ] For a game with comparisons, the fitness breakdown contains a tournament entry whose rating equals the game's normalized ELO display score
- [ ] For a game with no comparisons (or below the 5-game cohort floor), the tournament axis value is `null` and the entry is excluded from the fitness weighted average
- [ ] Provisional games contribute their normalized score to fitness without distinction from non-provisional games
- [ ] For a game with no comparisons in a collection where prediction is otherwise active, the prediction engine returns a predicted tournament axis value via the same API used for personal axes (verified by behaviour: a `predicted` source label appears on the tournament entry in the breakdown)
- [ ] The standalone tournament rank display (REQ-TOURN-10) still renders correctly
- [ ] The divergence flag from REQ-TOURN-18 (axis-fitness vs tournament-rank score delta) is removed from all client surfaces, and the function/code paths computing that delta are deleted
- [ ] The revealed preference tension surface from REQ-PRED-16/17/28 is removed from all client surfaces, and the function/code paths computing the predicted-fitness vs tournament-cluster-average delta are deleted
- [ ] Existing fitness tests pass with the tournament axis present in the test collection

## AI Validation

**Defaults** (apply unless overridden):

- Unit tests with mocked time/network/filesystem
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

## Constraints

- The tournament axis is an additive change to the type system. Existing data must continue to load without a schema migration beyond axis insertion.
- The daemon owns the migration. Web and CLI MUST NOT inject the tournament axis client-side.
- Cache invariants are folded into REQ-TAXIS-9; this section deliberately does not duplicate them.

## Context

- [Tournament Ranking Spec](.lore/specs/tournament/tournament-ranking.md): Source of REQ-TOURN-9 (normalization), REQ-TOURN-10 (display), REQ-TOURN-17 (sorting), and REQ-TOURN-18 (divergence flag, superseded).
- [MVP Fitness Model](.lore/designs/mvp-fitness-model.md): Defines the weighted-average composition over axes that this spec extends.
- [MVP Data Model](.lore/designs/mvp-data-model.md): Defines the `Axis` and `FitnessBreakdownEntry` types whose source enums are extended here.
- [Prediction Engine Spec](.lore/specs/fitness/prediction-engine.md): Touched here in three ways. (1) REQ-PRED-16/17/28 (revealed preference tension) are superseded. (2) The "no prediction for tournament" constraint at line 234 is superseded so the tournament axis can be predicted like any other axis. (3) REQ-PRED-15 (tournament stability factor in similarity weighting) and REQ-PRED-18 (silent inactivity) are unaffected.
- Lore researcher noted no prior file proposes "tournament as a third axis type." This spec breaks new ground.
