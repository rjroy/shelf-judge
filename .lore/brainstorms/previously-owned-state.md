---
title: "Previously Owned and Game Ownership State"
date: 2026-04-12
status: resolved
tags: [brainstorm, data-model, ownership, lifecycle, redundancy, prediction, profiling]
related:
  - .lore/issues/features/previously-owned-state.md
  - .lore/vision.md
  - .lore/specs/mvp.md
  - .lore/designs/mvp-data-model.md
  - .lore/specs/features/wishlist.md
  - .lore/brainstorms/redundancy-scoring.md
  - .lore/brainstorms/shelf-layout-designer.md
  - .lore/issues/features/shelf-layout-designer.md
---

# Brainstorm: Previously Owned and Game Ownership State

## Header

**Vision status:** Active. Four-step alignment analysis applied to each proposal.

**Context scanned:**

- `.lore/vision.md` (principles, anti-goals, tension table)
- `.lore/designs/mvp-data-model.md` (Game, Collection, Axis types)
- `.lore/specs/mvp.md` (REQ-MVP-8: removal deletes game and all ratings, not reversible)
- `.lore/specs/features/wishlist.md` (WishlistEntry as a separate lightweight entity, not part of collection)
- `.lore/brainstorms/redundancy-scoring.md` (pairwise similarity on `collection.games`, niche display)
- `.lore/brainstorms/shelf-layout-designer.md` (box dimensions, physical metadata, "what doesn't fit")
- `.lore/issues/features/previously-owned-state.md` (original issue)
- `.lore/issues/features/shelf-layout-designer.md` (physical metadata scoped to owned games)
- `packages/shared/src/types.ts` (Game interface, no status field)
- `packages/daemon/src/services/redundancy-engine.ts` (operates on `GameWithScore[]` from `collection.games`)
- `packages/daemon/src/services/prediction-engine.ts` (k-NN from `collection.games` with BGG data)
- `packages/daemon/src/services/profile-engine.ts` (clustering, outlier detection, all from `collection.games`)
- `packages/daemon/src/services/niche-engine.ts` (`computeNichePositions` on `GameWithScore[]`)
- `packages/daemon/src/services/game-service.ts` (`listGames` maps `collection.games` without filtering)
- `packages/daemon/src/services/fitness-service.ts` (per-game score, no collection awareness)

**Recent brainstorm check:** Six prior brainstorms exist. The redundancy brainstorm addresses niche display and pairwise similarity but assumes all games in `collection.games` are currently owned. The shelf layout brainstorm proposes box dimensions and physical metadata, noting these "only matter for owned games." Neither brainstorm addresses the concept of ownership state or what happens when a game leaves the shelf. The wishlist spec defines a separate entity (`WishlistEntry`) that is explicitly not part of the collection. No prior brainstorm or spec addresses the middle ground: a game that was in the collection, has ratings, but is no longer on the shelf.

---

## The Shape of the Problem

Today, a game exists in one of three states, but the system only models two of them:

1. **Not known to the system.** The game has never been added.
2. **In the collection.** The game is in `collection.games`. It has ratings, participates in fitness scoring, redundancy, profiling, niche computation, and prediction as a reference point.
3. **Removed.** Per REQ-MVP-8, removal deletes the game and all its ratings. Irreversible.

The issue identifies a fourth state that the system doesn't represent: a game that was owned, rated, and then sold or traded away. The ratings still encode real preference data (the user played this game enough to form opinions), but the game is no longer on the physical shelf. Under the current model, the user has two bad options: leave the game in the collection (where it distorts redundancy scoring and shelf capacity calculations by claiming a physical slot it doesn't occupy) or delete it (losing the ratings that calibrate prediction accuracy).

There's also a fifth state the issue hints at: a game played but never owned, like something encountered at a game night. The user has opinions about it, but it was never on their shelf.

The wishlist (`WishlistEntry`) represents a sixth state: a game the user is considering, with a predicted fitness snapshot but no personal ratings. It lives in a separate file (`wishlist.json`) and has no effect on any collection-level computation.

What emerges is a lifecycle that the data model has been quietly assuming is binary (exists or doesn't) while the user's relationship with games is richer than that. The question is whether formalizing this lifecycle serves the vision, and how much complexity it warrants.

---

## Proposal 1: Ownership Status Field on Game

### Evidence

The `Game` interface (`types.ts:47-61`) has no status or ownership field. Every subsystem that consumes games gets them from `collection.games` and either processes them all (`game-service.ts:161`, `listGames` maps the full array) or filters by `bggData !== null` for BGG-dependent features.

The redundancy engine (`redundancy-engine.ts:106-108`) filters to non-vetoed games with score > 0. The niche engine (`niche-engine.ts:160`) takes `GameWithScore[]`. The profile engine (`profile-engine.ts:64`) counts games with ratings. The prediction engine's reference game builder (`prediction-service.ts:69`) filters to games with BGG data. None of these filter by ownership state, because the concept doesn't exist in the type system.

The wishlist spec (REQ-WISH-28) established the principle that non-owned games don't affect collection-level computations. A previously-owned game should follow the same principle for the same reason: it's not on the shelf.

### Proposal

Add an `ownership` field to the `Game` type:

```typescript
type OwnershipStatus = "owned" | "previously-owned";

interface Game {
  // ... existing fields ...
  ownership: OwnershipStatus;
}
```

Default: `"owned"`. All existing games receive `"owned"` via a migration or schema default. The user changes a game's status to `"previously-owned"` through the game edit form or CLI.

The status change preserves everything: the game, its ratings, its BGG data, its tournament history. Nothing is deleted. The game is marked as no longer on the shelf.

### Per-subsystem behavior

Each subsystem then decides what to do with previously-owned games:

| Subsystem                     | Owned games               | Previously-owned games                                             |
| ----------------------------- | ------------------------- | ------------------------------------------------------------------ |
| **Fitness scoring**           | Scored normally           | Scored normally (ratings are real data)                            |
| **Prediction**                | Reference games for k-NN  | Reference games for k-NN (their ratings calibrate predictions)     |
| **Redundancy**                | Penalized for overlap     | **Excluded.** Not on the shelf, doesn't compete for space.         |
| **Niche display**             | Shown in niche membership | **Excluded.** Niches describe the current shelf.                   |
| **Profiling**                 | Included in profile       | Included in profile (preferences are still real)                   |
| **Collection list (default)** | Shown                     | **Hidden by default**, shown with a filter toggle                  |
| **Tournaments**               | Participates              | **Excluded from future tournaments**, historical results preserved |
| **Shelf layout**              | Occupies physical space   | **Excluded.** Not on the shelf.                                    |

The key insight: redundancy, niche display, tournaments, and shelf layout are about the physical shelf. Prediction and profiling are about the user's preferences. Fitness scoring is about the game's quality along the user's axes. The status field lets each subsystem answer the right question.

### Why two values, not more

The issue asks whether a simple binary is sufficient. For the subsystem behavior table above, yes. Every subsystem's behavior falls into one of two buckets: "this is about the shelf" (exclude previously-owned) or "this is about preferences" (include all). Adding more states (played-only, lent-out, on-order) wouldn't change the subsystem routing. The states would all map to the same two behaviors.

A richer lifecycle model (Proposal 4) could extend this later without breaking the binary distinction. The field is a union type, so adding `"played-only"` or `"lent-out"` later just expands the union.

### Vision alignment

1. **Anti-goal check.** Status tracking is personal metadata management, not purchase automation or social features. Passes.
2. **Principle alignment.** Principle 1 (ownership is personal: the user knows which games they still own). Principle 2 (the status is visible and its effects on scoring are transparent). Principle 5 (a previously-owned game no longer competes for shelf carrying capacity). Principle 3 (the collection identity should reflect what's actually on the shelf).
3. **Tension resolution.** "Collection-aware fitness vs simplicity" defaults to simplicity. This proposal adds one field and propagates a filter. The subsystem routing is straightforward because the binary cleanly separates "shelf questions" from "preference questions."
4. **Constraint check.** Requires type change, migration for existing data, filter propagation in redundancy engine, niche engine, tournament service, and collection list. The filter points are already identified in the evidence.

### Scope: Medium

Type change, migration, filter propagation across 4-5 subsystems, UI for status change (game edit form, CLI command), collection list filter toggle.

---

## Proposal 2: Soft Delete with Rating Preservation

### Evidence

REQ-MVP-8 says removal "deletes the game and all its ratings. This is not reversible." The deletion path in the game service removes the game from `collection.games` entirely. There is no archive or history.

The prediction engine (`prediction-service.ts:69`) builds its reference game pool from `collection.games` filtered to those with BGG data. When a game is deleted, its ratings vanish from the reference pool. If the user had rated 40 games and sold 10, the prediction engine loses 25% of its reference data. For a k-NN system where accuracy depends on reference pool size (the prediction spec defines stage thresholds at 5, 15, and 30 games), this is a meaningful loss.

### Proposal

Instead of adding a status field to `Game`, change the "remove from collection" action to perform a soft delete. The game moves from `collection.games` to a new `collection.archive` array. Archived games retain all fields and ratings. They are invisible to the default collection view, redundancy, niche display, and tournaments. They remain visible to the prediction engine as reference games.

```typescript
interface Collection {
  // ... existing fields ...
  games: Game[];
  archive: Game[];
}
```

The user sees "Remove from Collection" as the action. Behind the scenes, the game moves to archive. A separate "Permanently Delete" action (accessible from an archive view) performs the irreversible deletion that REQ-MVP-8 currently implements.

### Why archive instead of status

The archive approach has one advantage over the status field: it doesn't require every subsystem to learn about ownership filtering. Subsystems that read `collection.games` automatically exclude archived games. Subsystems that need archived data (prediction) explicitly read `collection.archive`. The filtering is structural, not conditional.

### What it sacrifices

An archived game can't be "un-archived" back to the collection without a separate restoration flow. The status field (Proposal 1) makes the transition bidirectional: flip the status, the game reappears. Archive makes it a two-step migration. Also, the archive doesn't distinguish why a game was removed (sold it vs. never want to see it again). A game sold to a friend (might rebuy someday) and a game you hated (good riddance) end up in the same pile.

The structural separation also means `collection.json` grows indefinitely as games cycle through. Over years of collecting, the archive could exceed the active collection. The file is still small (each game is ~2KB), but it's a change in the storage model's lifecycle assumptions.

### Vision alignment

1. **Anti-goal check.** Archiving is a personal data management feature. Passes.
2. **Principle alignment.** Principle 2 (the archive is visible and the user can see what's there). Principle 4 (archived ratings serve prediction accuracy, which serves judgment).
3. **Tension resolution.** "Collection-aware fitness vs simplicity" is served well: the structural separation is simpler to implement than per-subsystem filtering. But the user experience is more complex: two lists instead of one list with a filter.
4. **Constraint check.** Requires schema migration (new `archive` array), UI for archive view, restore flow, permanent delete flow. Prediction service needs to read both arrays.

### Scope: Medium

Schema migration, archive/restore flows, prediction service modification, archive view UI, permanent delete action.

---

## Proposal 3: Prediction-Aware Reference Pool (Narrow Fix)

### Evidence

The issue's core problem statement is: "Their ratings can still help with prediction, but do not help with redundancy." If the only subsystem that should treat previously-owned games differently is redundancy (and by extension, niche display), the fix might be narrower than a full ownership model.

The redundancy engine (`redundancy-engine.ts:91-206`) already has filtering: it excludes vetoed games (`score.vetoed`) and games with score <= 0. Adding another filter (exclude previously-owned) follows the same pattern. The niche engine (`niche-engine.ts:160`) receives `GameWithScore[]`, which could be pre-filtered before the call.

The prediction engine builds reference games from `collection.games` with BGG data. It doesn't need to change, because previously-owned games should remain as reference data.

### Proposal

Add the `ownership` field from Proposal 1, but scope the implementation to only the subsystems that need it:

1. Add `ownership: OwnershipStatus` to `Game` (same as Proposal 1).
2. Filter previously-owned games out of the `GameWithScore[]` passed to `computeRedundancyAdjustments`.
3. Filter previously-owned games out of the `GameWithScore[]` passed to `computeNichePositions`.
4. Add a `status` filter option to the collection list API.
5. Leave profiling, prediction, fitness scoring, and tournaments unchanged. They already behave correctly for previously-owned games (or don't need to change yet).

This is Proposal 1 with a smaller blast radius. The subsystem behavior table from Proposal 1 is the target state, but this proposal only implements the rows that are clearly wrong today (redundancy and niche claiming physical shelf slots for games that aren't there). The other rows can be addressed when the need arises.

### Why start narrow

The issue was prompted by a specific problem: ratings from sold games distorting redundancy. Fixing that doesn't require solving every subsystem's relationship to ownership state. Tournaments, for instance, might benefit from excluding previously-owned games, but the user hasn't reported that as a problem. Shipping the minimum fix and observing whether other subsystems need the filter is less risky than speculative propagation.

### Vision alignment

1. **Anti-goal check.** Passes.
2. **Principle alignment.** Principle 5 (redundancy reflects the actual shelf). Principle 2 (the filter is transparent: the user sees which games are previously-owned and can toggle the view).
3. **Tension resolution.** Maximum simplicity. Smallest change that fixes the reported problem.
4. **Constraint check.** Two filter additions, one type change, one migration. The filter points are in pure functions that already accept arrays, so the filtering happens at the call site, not inside the engines.

### Scope: Small

Type change, migration, two filter additions at call sites in game-service.ts (before passing to redundancy and niche engines), collection list filter, game edit form status toggle.

---

## Proposal 4: Game Lifecycle States (Richer Model)

### Evidence

The issue names three states beyond "owned": previously-owned, played-only, and (implicitly via the wishlist spec) considering. The shelf layout brainstorm's Proposal 1 (box dimensions) notes that physical metadata "only matters for owned games." The shelf layout brainstorm's Proposal 4 ("what doesn't fit") computes overflow based on total collection volume, which should only count owned games.

BGG itself models a rich ownership vocabulary. The BGG collection API returns `own`, `prevowned`, `want`, `wanttoplay`, `wanttobuy`, `wishlist`, `preordered`, `fortrade`. Users who import from BGG bring this metadata with them. The system currently ignores it (REQ-MVP-10 imports only "owned" games).

### Proposal

Extend ownership to a richer set of states:

```typescript
type OwnershipStatus =
  | "owned" // On the shelf. Full participation in all subsystems.
  | "previously-owned" // Was owned, now sold/traded. Ratings preserved.
  | "played-only"; // Played at a game night, never owned. Can be rated.
```

The `"played-only"` state acknowledges a real pattern: the user went to a game night, played something, has opinions about it, and wants to rate it without claiming they own it. This game calibrates prediction (the user's rating data is real) but has no shelf presence.

The subsystem routing table from Proposal 1 applies to all non-owned states identically:

| Concern                      | "owned" | "previously-owned" or "played-only" |
| ---------------------------- | ------- | ----------------------------------- |
| On the physical shelf        | Yes     | No                                  |
| Ratings calibrate prediction | Yes     | Yes                                 |
| Counts toward redundancy     | Yes     | No                                  |
| Appears in niche display     | Yes     | No                                  |
| Included in profile          | Yes     | Yes                                 |
| Default collection view      | Shown   | Hidden (filterable)                 |

The `"played-only"` state has one additional nuance: these games probably lack BGG import data unless the user manually added them. They might be manual-entry games with only personal axis ratings and no BGG data. This is fine. The prediction engine already handles games without BGG data (they just can't serve as reference games for BGG-based prediction).

### The wishlist question

The wishlist (`WishlistEntry`) is a separate entity by design (REQ-WISH-13, REQ-WISH-28). It stores a prediction snapshot, not personal ratings. A game's lifecycle might be: wishlist (considering, no ratings) -> owned (on the shelf, rated) -> previously-owned (sold, ratings preserved). The wishlist-to-collection transition already exists (REQ-WISH-10 auto-removes the wishlist entry when the game is added). No change needed there.

Should a previously-owned game be wishlistable again? (The user sold it, regrets it, wants to re-evaluate.) The current wishlist spec (REQ-WISH-6) rejects wishlisting a game already in the collection. A previously-owned game IS in the collection (just with a different status). This is a minor edge case that could go either way. The simplest answer: previously-owned games can't be wishlisted because they already have real ratings that are better than a prediction snapshot.

### Why not more states

The BGG vocabulary has 8+ states. Most of them don't change subsystem behavior. "Want to buy" and "want to play" map to the wishlist, which is already a separate entity. "For trade" is a sub-state of "owned" (still on the shelf, just flagged for disposal). "Pre-ordered" is "not yet owned" which is either wishlist or nothing. Adding states that don't change any subsystem's behavior is modeling for modeling's sake.

If "for trade" becomes useful later (e.g., a "trade pile" view), it can be added to the union type without migration. The important thing is that the union type is extensible by design.

### Vision alignment

1. **Anti-goal check.** Ownership states are personal metadata. "Played-only" expands what the user can express about their relationship with a game. Passes.
2. **Principle alignment.** Principle 1 (ownership is personal and specific: the user's relationship with each game is unique). Principle 3 (the collection identity reflects actual ownership, not a mix of owned and formerly-owned).
3. **Tension resolution.** "Collection-aware fitness vs simplicity": three states is barely more complex than two. The subsystem routing doesn't change between the two non-owned states. The complexity is in the data model, not the computation.
4. **Constraint check.** Same as Proposal 1 plus one additional state. The "played-only" state requires an entry flow: the user adds a game, marks it as played-only (or imports it as such), and rates it. This is a minor variation on the existing add-game flow.

### Scope: Medium

Everything in Proposal 1, plus played-only entry flow, plus collection import enrichment (BGG `prevowned` mapping), plus UI for three-state selector.

---

## Proposal 5: Ownership-Aware Collection Views

### Evidence

The web collection page (`packages/web/app/collection/page.tsx`) renders all games from the `GET /games` endpoint. The collection table (`packages/web/lib/collection-utils.ts`) supports filtering by niche tag, fitness range, and sort order. There is no filter for ownership state because the concept doesn't exist.

The CLI `shelf-judge collection list` command shows all games. The `--json` flag returns the full `GameWithScore[]` array.

### Proposal

Regardless of which ownership model is chosen (Proposals 1, 2, 3, or 4), the collection view needs to handle non-owned games gracefully. This proposal defines the UX layer that sits on top of any of the data model proposals.

**Default view: owned games only.** The collection page shows games with `ownership === "owned"` by default. This preserves the current experience for users who don't use ownership tracking.

**Filter toggle: "Show previously owned."** A toggle in the filter bar (alongside existing niche tag filters) adds previously-owned games to the view. Previously-owned games are visually distinct: a muted card style, a "Previously Owned" badge, or a subtle border change. The user can tell at a glance which games are still on the shelf.

**Separate tab or section: "History."** An alternative to the filter toggle. A dedicated "History" tab that shows all non-owned games (previously-owned, played-only). This is cleaner when the non-owned list is long, but adds navigation overhead.

**Game detail page:** A previously-owned game's detail page shows all its ratings, fitness score, and breakdown, just like an owned game. The niche display and redundancy adjustment are either absent (because the game is excluded from those computations) or annotated: "Not included in niche/redundancy calculations (game is no longer owned)."

**Transition action:** The game detail page or game edit form has a "Mark as Previously Owned" action (or "Mark as Owned" to reverse it). This is a status toggle, not a destructive action. The existing "Remove from Collection" action (REQ-MVP-8's permanent delete) remains available as a separate, more drastic option.

### Vision alignment

1. **Anti-goal check.** UI for managing personal ownership state. Passes.
2. **Principle alignment.** Principle 2 (the effect of ownership status on scoring is visible and explained). Principle 1 (the user controls which games are "on the shelf").
3. **Tension resolution.** "Collection-aware fitness vs simplicity": the default view stays simple (owned games only). Complexity is opt-in (toggle the filter).
4. **Constraint check.** Requires a data model that supports ownership status (any of Proposals 1-4). The UI work is mostly styling and filter logic, not new computation.

### Scope: Small-Medium

Collection list filter, game detail page annotations, status toggle action in game edit form and CLI.

---

## Proposal 6: BGG Import with Ownership Mapping

### Evidence

The BGG collection API (`packages/daemon/src/services/bgg-collection-client.ts`) fetches a user's collection. BGG collections include ownership metadata: `own`, `prevowned`, `wanttoplay`, etc. The current import (REQ-MVP-10) imports only "owned" games and ignores the rest.

A user who has maintained their BGG collection (marking games as previously owned when they sell them) has exactly the data this feature needs. Instead of requiring the user to manually mark each game's status after import, the system could import the status directly from BGG.

### Proposal

During BGG collection import, read the ownership flags and map them:

| BGG flag                    | Shelf Judge status   |
| --------------------------- | -------------------- |
| `own=1`                     | `"owned"`            |
| `prevowned=1` (and `own=0`) | `"previously-owned"` |
| `own=0` and `prevowned=0`   | Skip (not imported)  |

The import flow gains an option: "Include previously owned games." Default: off (preserving current behavior). When enabled, previously-owned games are imported with their BGG data and `ownership: "previously-owned"`. They receive auto-populated BGG axis ratings (community rating, complexity) but no personal ratings (the user can add those later).

The import summary reports: "Imported 45 owned games, 12 previously-owned games, 3 skipped (already in collection)."

### Why opt-in

A user's BGG "previously owned" list can be very large (years of collecting and selling). Importing all of them as reference data is valuable for prediction, but the user should choose. Some users maintain their BGG collection carefully; others haven't updated it in years. The opt-in respects this variation.

### Vision alignment

1. **Anti-goal check.** Importing existing user data from BGG. This is data migration, not a recommendation. Passes.
2. **Principle alignment.** Principle 4 (BGG provides context). Principle 1 (the user's BGG collection reflects their personal history).
3. **Tension resolution.** No new tensions. This is import enrichment.
4. **Constraint check.** Requires Proposal 1 or 4 (ownership field). The BGG collection API already returns the flags; the parser just needs to read them. The import endpoint needs the opt-in parameter.

### Scope: Small

BGG collection parser extension (read `prevowned` flag), import endpoint parameter, import summary enrichment.

---

## Edge Cases

### Marking an owned game as previously-owned while it's a tournament candidate

If the game is in an active tournament session, the status change should be allowed but the game completes its current tournament round. Future tournament sessions exclude it. Tournament history (ELO, match results) is preserved regardless.

### Previously-owned game that the user reacquires

The user sold a game and marked it previously-owned. Later they rebuy it. The status flips back to "owned." All original ratings, tournament history, and BGG data are still there. The game re-enters redundancy, niche display, and tournaments as if it had never left. This is the strongest argument for Proposal 1's status field over Proposal 2's archive: reacquisition is a status toggle, not an archive-restore operation.

### Played-only game with no BGG data

A manual-entry played-only game (no BGG ID) has personal ratings but can't serve as a prediction reference (prediction uses feature vectors built from BGG data). It still contributes to profiling (personal axis distributions) and still has a fitness score. It just doesn't help the prediction engine. This is fine. The user added it because they have opinions about it, not because it helps the system's algorithms.

### Interaction with "What Doesn't Fit" (shelf layout brainstorm Proposal 4)

The shelf layout brainstorm's "overflow list" computes total collection footprint vs. total shelf space. Previously-owned games must be excluded from this calculation. If ownership status exists, the filter is trivial: sum volumes only for games where `ownership === "owned"`. Without ownership status, the overflow calculation would incorrectly count games that aren't on the shelf.

### Redundancy recalculation on status change

When a game is marked as previously-owned, redundancy scores for its former niche neighbors should be recalculated. If the 3rd-best deck-building game leaves the shelf, the 4th-best game's redundancy penalty decreases (one fewer competitor). The redundancy engine is already a pure function that runs on the current game list. The recalculation happens automatically on the next fitness computation as long as the previously-owned game is excluded from the input.

---

## Interaction Map

**Wishlist.** The wishlist is a separate entity (not in `collection.games`) with different semantics (prediction snapshot, no ratings). A game's lifecycle can be: wishlist -> owned -> previously-owned. The transitions are: wishlist entry is auto-removed when game is added to collection (REQ-WISH-10); ownership status is changed manually when game leaves the shelf. These are independent mechanisms that don't need coordination.

**Redundancy.** The redundancy engine's `computeRedundancyAdjustments` (`redundancy-engine.ts:91`) takes `GameWithScore[]`. The filter for ownership state should be applied before this call, in `game-service.ts` where the `GameWithScore[]` is assembled. The engine itself stays pure and unaware of ownership.

**Niche.** Same pattern as redundancy. `computeNichePositions` (`niche-engine.ts:160`) takes `GameWithScore[]`. Filter before the call.

**Prediction.** The prediction service (`prediction-service.ts:69`) builds reference games from `collection.games`. Previously-owned games should remain in this pool. No filter needed. Their ratings are real preference signals.

**Profiling.** The profile engine (`profile-engine.ts:64`) counts rated games and computes distributions. Previously-owned games should remain included. A user who has rated 50 games (40 owned, 10 previously-owned) has a 50-game preference profile, not a 40-game one. Excluding previously-owned games from profiling would make the profile less accurate.

**LLM Narrative.** The deferred LLM narration layer would benefit from knowing about previously-owned games. "You sold three deck-building games last year. The two you kept are your highest-rated in that niche" is a meaningful insight about curation intent.

**Shelf Layout.** The shelf layout brainstorm's proposals (box dimensions, "what doesn't fit," shelf assignment) all deal with the physical shelf. Previously-owned games have no physical presence. The ownership filter ensures they're excluded from spatial calculations. This is also why the shelf layout brainstorm's Proposal 1 (box dimensions) should store dimensions even for previously-owned games: if the user reacquires the game, the dimensions are still valid.

---

## Implementation Sequence

1. **Proposal 3 (Narrow Fix)** first. This is the smallest change that solves the reported problem. Add `ownership` field, filter two call sites, add collection filter. Validates the approach with minimum risk.
2. **Proposal 5 (Collection Views)** alongside or immediately after Proposal 3. The field is useless without a way to see and change it.
3. **Proposal 6 (BGG Import Mapping)** third. Once the field exists, enriching the import is low-effort and high-value for users with maintained BGG collections.
4. **Proposal 4 (Richer States)** when a user reports "I played this at a game night and want to rate it." The union type is extensible without migration; adding `"played-only"` is a backward-compatible expansion.
5. **Proposal 1 or 2** is the target state for full subsystem propagation. Proposal 1 (status field with per-subsystem filtering) is recommended over Proposal 2 (archive) because it handles reacquisition naturally and doesn't require a separate restoration flow.

Proposal 2 (archive) is the alternative if the team prefers structural separation over conditional filtering. The two approaches are mutually exclusive. My recommendation is Proposal 1's status field because the collection is a single list of games the user has a relationship with, and the nature of that relationship (owned, previously-owned, played-only) is a property of the game record, not a reason to split the storage structure.
