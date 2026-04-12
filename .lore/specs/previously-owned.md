---
title: "Previously Owned"
date: 2026-04-12
status: draft
tags: [spec, ownership, data-model, redundancy, niche, collection, lifecycle]
modules: [shared, daemon, web, cli]
req-prefix: PREV
related:
  - .lore/brainstorms/previously-owned-state.md
  - .lore/issues/previously-owned-state.md
  - .lore/vision.md
  - .lore/specs/mvp.md
  - .lore/specs/wishlist.md
  - .lore/specs/redundancy-scoring.md
  - .lore/specs/niche-champion-display.md
  - .lore/designs/mvp-data-model.md
---

# Spec: Previously Owned

## Overview

A game that's been sold or traded away still holds real preference data: the user played it, rated it, and formed opinions. Today the system treats this as binary: the game is either in the collection (distorting redundancy and niche standings by claiming a shelf slot it doesn't occupy) or deleted (losing the ratings that calibrate prediction accuracy). This spec adds an ownership status field that lets the user mark a game as previously owned, preserving its ratings while excluding it from shelf-aware computations.

The feature has two parts: a data model change (the `ownership` field, with targeted filtering in redundancy and niche engines) and a UX layer (default collection view shows owned games only, with a toggle, visual distinction, and status change actions).

## Entry Points

- Collection page (web): filter toggle to show previously-owned games
- Game detail page (web): "Mark as Previously Owned" / "Mark as Owned" action
- Game edit form (web): ownership status toggle
- CLI: `shelf-judge game set-status <id> <status>` to change ownership state
- CLI: `shelf-judge collection list --ownership <status>` to filter the list

## Requirements

### Ownership Data Model

- REQ-PREV-1: Add an `ownership` field to the `Game` type with the union type `"owned" | "previously-owned"`. Default value: `"owned"`.

```typescript
type OwnershipStatus = "owned" | "previously-owned";

interface Game {
  // ... existing fields ...
  ownership: OwnershipStatus;
}
```

- REQ-PREV-2: `OwnershipStatus` is a shared type defined in `packages/shared/src/types.ts`. It is consumed by daemon, web, and CLI.

- REQ-PREV-3: All existing games receive `"owned"` via schema default. No explicit migration step is needed: the Zod schema for `Game` provides a `.default("owned")` on the `ownership` field. Games loaded from `collection.json` without an `ownership` field are assigned `"owned"` at parse time.

- REQ-PREV-4: The `ownership` field is persisted in `collection.json` alongside all other game fields. When a game's ownership status changes, `updatedAt` is set to the current timestamp.

### Ownership Status Change

- REQ-PREV-5: Users can change a game's ownership status via a new daemon endpoint. The status change preserves everything: the game, its ratings, its BGG data, its tournament history. Nothing is deleted.

- REQ-PREV-6: The existing "Remove from Collection" action (REQ-MVP-8, permanent delete) remains as a separate, more destructive action. Marking a game as previously owned is not a deletion. Both actions are available and clearly distinguished.

- REQ-PREV-7: When a previously-owned game is marked as owned again (reacquisition), it re-enters redundancy and niche computations as if it had never left. All original ratings, tournament history, and BGG data are intact.

### Subsystem Behavior

- REQ-PREV-8: Previously-owned games are excluded from the `GameWithScore[]` array passed to `computeRedundancyAdjustments`. The filter is applied at the call site in the route handler (`games.ts`), not inside the redundancy engine. The engine remains a pure function unaware of ownership.

- REQ-PREV-9: Previously-owned games are excluded from the `GameWithScore[]` array passed to `computeNichePositions`. Same pattern as REQ-PREV-8: filter at the call site, keep the engine pure.

- REQ-PREV-10: Fitness scoring is unchanged. Previously-owned games receive fitness scores normally. Their ratings are real data and the score remains useful for the user's reference and for prediction calibration.

- REQ-PREV-11: Prediction is unchanged. Previously-owned games remain in the reference pool used by the prediction engine. Their ratings are genuine preference signals that improve prediction accuracy. Excluding them would reduce the reference pool and degrade predictions.

- REQ-PREV-12: Profiling is unchanged. Previously-owned games contribute to the collection profile (axis distributions, clustering, outlier detection). A user who has rated 50 games has a 50-game preference profile regardless of how many are still on the shelf.

- REQ-PREV-13: Tournaments are unchanged by this spec. Previously-owned games keep their existing ELO ratings and match history. Whether they should be excluded from future tournament sessions is a separate concern (see Future Work). Tournament history is preserved regardless of ownership status.

### Daemon API

- REQ-PREV-14: New endpoint for changing ownership status:

| Operation ID            | Method | Path                       | Description                      |
| ----------------------- | ------ | -------------------------- | -------------------------------- |
| `shelf.game.set-status` | PATCH  | `/api/games/:id/ownership` | Change a game's ownership status |

- REQ-PREV-15: Request/response shapes:

**PATCH `/api/games/:id/ownership`** (set ownership status):

```typescript
// Request
{
  ownership: "owned" | "previously-owned";
}

// Response (200)
{
  game: Game;
}

// Error: game not found (404)
{
  error: "Game not found";
}

// Error: invalid status (400)
{
  error: 'Invalid ownership status. Must be "owned" or "previously-owned"';
}
```

- REQ-PREV-16: The ownership change endpoint is a new route in the existing game routes module (`packages/daemon/src/routes/games.ts`). It calls through to the game service, which updates the game's `ownership` and `updatedAt` fields and persists the change.

- REQ-PREV-17: The `GET /games` endpoint accepts an optional `ownership` query parameter to filter by ownership status. Valid values: `"owned"`, `"previously-owned"`, `"all"`. Default: `"owned"`. When `ownership=all`, all games are returned regardless of status. When `ownership=owned` (or omitted), only owned games are returned.

- REQ-PREV-18: The `GET /games/:id` endpoint returns the game regardless of ownership status. The game detail is always accessible. The response includes the `ownership` field so clients can display the appropriate UI.

- REQ-PREV-19: When `GET /games` filters to owned-only (the default), the redundancy and niche computations use the same owned-only set. When `GET /games?ownership=all` returns all games, redundancy and niche are still computed against owned-only games. The computation universe for redundancy and niche is always the owned set, regardless of what the response contains. The route handler fetches all requested games for the response body, then separately applies the owned-only filter before passing to redundancy and niche engines. Previously-owned games in the response carry `nichePosition: null` and `redundancyAdjustment: null` (within their `FitnessResult`). Owned games carry the same niche/redundancy data they would in an `ownership=owned` response.

### Web UI

- REQ-PREV-20: The collection page shows owned games by default. This preserves the current experience for users who haven't used ownership tracking. The `GET /games` call uses the default `ownership=owned` filter.

- REQ-PREV-21: The collection filter bar gains a toggle: "Show previously owned." When enabled, the page fetches `GET /games?ownership=all`. Previously-owned games appear in the same list alongside owned games, visually distinguished per REQ-PREV-22. The toggle triggers a new fetch (not client-side filtering on a cached set). This is a departure from the collection-filter-sort feature's client-side-only approach, but ownership filtering must happen server-side because the redundancy/niche computation universe changes based on which games are included. Client-side sort and filter within the returned set continue to work as before.

- REQ-PREV-22: Previously-owned games in the collection list are visually distinct from owned games. The distinction uses a muted card style (reduced opacity or desaturated colors) and a "Previously Owned" badge. The user can tell at a glance which games are still on the shelf. In the mixed view (REQ-PREV-21), niche and redundancy columns for previously-owned games show no data (consistent with REQ-PREV-23's annotation on the detail page).

- REQ-PREV-23: The game detail page displays all data for a previously-owned game: ratings, fitness score, breakdown, tournament stats. Niche position and redundancy adjustment are absent (because the game is excluded from those computations). The page displays an annotation explaining this: "Niche and redundancy data excluded (game is no longer owned)."

- REQ-PREV-24: The game detail page includes a status toggle action. For an owned game: "Mark as Previously Owned." For a previously-owned game: "Mark as Owned." This calls `PATCH /api/games/:id/ownership`. On success, the page refreshes to reflect the new status.

- REQ-PREV-25: The status toggle action is separate from and less destructive than "Remove from Collection." Both actions appear on the game detail page. The visual hierarchy makes the status toggle the primary option and deletion the secondary (dangerous) option.

- REQ-PREV-26: The web proxy route at `app/api/daemon/[...path]/route.ts` forwards the new `PATCH` method for the ownership endpoint. No new proxy route file is needed as long as the catch-all route handles PATCH.

### CLI

- REQ-PREV-27: New CLI command for ownership status change:

| Command                                             | Description                          |
| --------------------------------------------------- | ------------------------------------ |
| `shelf-judge game set-status <id> previously-owned` | Mark a game as previously owned      |
| `shelf-judge game set-status <id> owned`            | Mark a game as owned (reacquisition) |

- REQ-PREV-28: `shelf-judge game set-status` prints a confirmation on success: `"<game name>" marked as <status>.` In `--json` mode, returns the full updated `Game` object.

- REQ-PREV-29: `shelf-judge collection list` gains an `--ownership` flag. Values: `owned` (default), `previously-owned`, `all`. This maps to the `ownership` query parameter on `GET /games`.

### Interactions

- REQ-PREV-30: When a game's ownership status changes from owned to previously-owned, redundancy scores for its former niche neighbors are recalculated on the next `GET /games` request. This happens automatically because the redundancy engine is a pure function that runs on the current owned-game set. No explicit recalculation trigger is needed.

- REQ-PREV-31: A previously-owned game cannot be wishlisted. It is still in the collection (just with a different status), and REQ-WISH-6 rejects wishlisting a game already in the collection. The user already has real ratings that are better than a prediction snapshot. The REQ-WISH-6 collection membership check must query all ownership statuses (not just owned) when testing for duplicates. This ensures previously-owned games are not accidentally wishlistable after the ownership filter is introduced to `GET /games`.

- REQ-PREV-32: The wishlist lifecycle is unaffected. When a wishlisted game is added to the collection (REQ-WISH-10), it enters as `ownership: "owned"`. There is no path from wishlist directly to previously-owned.

## Scope Exclusions

- **Played-only state.** A `"played-only"` ownership status (for games played at a game night but never owned) is a natural extension of the union type but out of scope. See Future Work.
- **BGG import mapping.** Mapping BGG's `prevowned` flag during collection import is deferred. See Future Work.
- **Archive/soft-delete model.** Moving games to a separate `collection.archive` array was considered and rejected in favor of the status field approach. The status field handles reacquisition naturally and doesn't require a separate restore flow.
- **Tournament exclusion.** Whether previously-owned games should be excluded from future tournament sessions is not addressed here. Current behavior (they participate if selected) is preserved. See Future Work.
- **Shelf layout interaction.** The shelf layout feature (issue only, no spec) will need to filter by ownership. That filtering follows the same pattern as redundancy/niche and will be handled when shelf layout is specified.

## Future Work

| Feature                        | Triggers When                                                              | Target                              |
| ------------------------------ | -------------------------------------------------------------------------- | ----------------------------------- |
| Played-only state              | User wants to rate a game they played but never owned                      | [STUB: played-only-state]           |
| BGG import ownership mapping   | User wants to import previously-owned games from their BGG collection      | [STUB: bgg-import-ownership]        |
| Tournament ownership filtering | User wants previously-owned games excluded from future tournament sessions | [STUB: tournament-ownership-filter] |

## Edge Cases

### Status change during active tournament

If a game is in an active tournament session and the user marks it as previously-owned, the status change is allowed. The game completes its current tournament session. This spec does not change tournament behavior (REQ-PREV-13), so no special handling is needed. The game remains a valid tournament participant regardless of ownership status.

### Reacquisition

A user sells a game, marks it previously-owned, then rebuys it. They toggle the status back to `"owned"` (REQ-PREV-7). All original ratings, tournament history, and BGG data are intact. The game re-enters redundancy and niche computations immediately. This is the primary advantage of the status field over an archive model: reacquisition is a single toggle, not an archive-restore operation.

### Redundancy recalculation on status change

When a game leaves the shelf (owned to previously-owned), its former niche neighbors may see reduced redundancy penalties. The fourth-best deck-building game becomes the third-best. This recalculation is automatic: the redundancy engine runs on the current owned set each time `GET /games` is called (REQ-PREV-30). No cache invalidation or manual trigger is needed.

### Interaction with wishlist lifecycle

A game on the wishlist gets added to the collection (REQ-WISH-10 removes the wishlist entry). Later the user marks the game as previously-owned. The wishlist entry was already deleted during collection add. The previously-owned game cannot be re-wishlisted (REQ-PREV-31) because it still has real ratings, which are more valuable than a prediction snapshot.

### Collection with all games previously-owned

If every game in the collection is marked as previously-owned, the default collection view (`ownership=owned`) shows an empty list. Redundancy and niche computations produce empty results. Fitness scores, prediction, and profiling continue to work normally because they include all games regardless of ownership.

## Success Criteria

### Automated Tests (bun test)

- [ ] A game created without an explicit `ownership` field defaults to `"owned"`
- [ ] Existing collection JSON without `ownership` fields loads correctly (all games get `"owned"`)
- [ ] `PATCH /api/games/:id/ownership` with `"previously-owned"` changes the status and updates `updatedAt`
- [ ] `PATCH /api/games/:id/ownership` with `"owned"` reverses the status (reacquisition)
- [ ] `PATCH /api/games/:id/ownership` with an invalid status returns 400
- [ ] `PATCH /api/games/:id/ownership` for a nonexistent game returns 404
- [ ] `GET /games` (default) returns only owned games
- [ ] `GET /games?ownership=all` returns both owned and previously-owned games
- [ ] `GET /games?ownership=previously-owned` returns only previously-owned games
- [ ] `GET /games/:id` returns the game regardless of ownership status
- [ ] Redundancy adjustments exclude previously-owned games from the computation input
- [ ] Niche positions exclude previously-owned games from the computation input
- [ ] Redundancy and niche use owned-only set even when `GET /games?ownership=all` is requested
- [ ] Fitness scores are computed for previously-owned games (unchanged behavior)
- [ ] Previously-owned games remain in the prediction reference pool
- [ ] Previously-owned games contribute to profile computation
- [ ] A previously-owned game cannot be wishlisted (returns 409 per REQ-WISH-6)
- [ ] Marking a game as previously-owned does not delete any data (ratings, BGG data, tournament history)
- [ ] `PATCH /api/games/:id/ownership` with the game's current status returns 200 and does not change `updatedAt`
- [ ] The redundancy and niche scores for owned games are identical whether fetched via `GET /games` or `GET /games?ownership=all`
- [ ] Previously-owned games in a `GET /games?ownership=all` response have `nichePosition: null` and `redundancyAdjustment: null`

### Manual Verification

- [ ] Collection page shows only owned games by default
- [ ] Toggle "Show previously owned" and verify previously-owned games appear with muted/badged styling
- [ ] Open a previously-owned game's detail page, verify ratings and fitness are shown, niche/redundancy annotation present
- [ ] Click "Mark as Previously Owned" on an owned game, verify it disappears from default collection view
- [ ] Click "Mark as Owned" on a previously-owned game, verify it reappears in default view with niche/redundancy data
- [ ] CLI `shelf-judge game set-status <id> previously-owned` marks the game and prints confirmation
- [ ] CLI `shelf-judge collection list --ownership all` shows both owned and previously-owned games
- [ ] CLI `shelf-judge collection list --ownership previously-owned` shows only previously-owned games
- [ ] After marking a game as previously-owned, verify its niche neighbors' redundancy penalties decrease on next page load

## AI Validation

**Defaults** (apply unless overridden):

- Unit tests with mocked time/network/filesystem
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom:**

- Verify that `GET /games` default behavior (no query param) returns only owned games, confirming backward compatibility for existing clients
- Verify that both web proxy route and CLI client helper are updated for the new PATCH endpoint (per tournament retro lesson). Confirm the catch-all proxy at `app/api/daemon/[...path]/route.ts` handles PATCH method forwarding
- Verify that redundancy/niche filtering happens at the call site in `games.ts`, not inside the engine functions, confirming engines remain pure
- Verify that the `ownership` filter in `GET /games` is independent of the redundancy/niche computation universe (REQ-PREV-19)
- Test reacquisition round-trip: owned -> previously-owned -> owned, verify all data intact and niche/redundancy restored
- Verify that the wishlist add route's collection membership check (REQ-WISH-6) queries all ownership statuses, not just owned, so previously-owned games cannot be wishlisted

## Constraints

- No modification to `computeRedundancyAdjustments` or `computeNichePositions` function signatures or internals. Filtering happens at call sites.
- No modification to `FitnessResult`, `CollectionProfile`, `PredictionMeta`, or any computation-level type. The ownership field is a property of `Game`, not of the computation results.
- The `GET /games` default must remain backward-compatible. Existing clients that don't send an `ownership` query parameter see the same response shape and content they see today (owned games only, which is currently all games).
- The `OwnershipStatus` union type is designed for extension. Adding `"played-only"` or other states later expands the union without migration. Each new state maps to the same binary question per subsystem: "is this game on the shelf?"

## Open Questions

1. **Previously-owned count in sidebar.** Should the sidebar navigation show a count of previously-owned games alongside the collection count? (e.g., "Collection (42) / Previously Owned (8)".) The simplest approach: no count. The "Show previously owned" toggle in the filter bar is the discovery mechanism. A sidebar count adds a second API call on every page load for a number most users won't reference. Defer to user feedback.

## Context

- [Brainstorm: Previously Owned and Game Ownership State](.lore/brainstorms/previously-owned-state.md): The source brainstorm. This spec implements Proposal 3 (Narrow Fix) and Proposal 5 (Collection Views).
- [Vision](.lore/vision.md): Principle 5 ("The shelf has a carrying capacity") is the core motivation. Redundancy and niche should reflect the physical shelf. Principle 2 ("One number, honestly derived") requires that the exclusion be visible and explained.
- [Spec: MVP](.lore/specs/mvp.md): REQ-MVP-8 defines the existing removal behavior (permanent delete). This spec adds a softer alternative that preserves data.
- [Design: MVP Data Model](.lore/designs/mvp-data-model.md): The `Game` interface that gains the `ownership` field.
- [Spec: Wishlist](.lore/specs/wishlist.md): REQ-WISH-6 (no wishlisting collected games) and REQ-WISH-28 (non-owned games don't affect collection computations) establish the principle this spec extends.
- [Spec: Redundancy Scoring](.lore/specs/redundancy-scoring.md): The `computeRedundancyAdjustments` function that needs pre-filtered input.
- [Spec: Niche Champion Display](.lore/specs/niche-champion-display.md): The `computeNichePositions` function that needs pre-filtered input.
