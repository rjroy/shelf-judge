---
title: "Shelf Layout Designer"
date: 2026-04-12
status: open
tags: [brainstorm, shelf-layout, physical, spatial, optimization]
related:
  - .lore/issues/shelf-layout-designer.md
  - .lore/vision.md
  - .lore/designs/mvp-data-model.md
  - .lore/research/bgg-api.md
  - .lore/brainstorms/redundancy-scoring.md
---

# Brainstorm: Shelf Layout Designer

## Header

**Vision status:** Active. Four-step alignment analysis applied to each proposal.

**Context scanned:**

- `.lore/vision.md` (principles, anti-goals, tension table)
- `.lore/designs/mvp-data-model.md` (Game, Collection, Axis types)
- `.lore/research/bgg-api.md` (Thing endpoint fields, `versions=1` parameter)
- `packages/shared/src/types.ts` (Game, BggGameData, NicheEntry, ComponentDistances)
- `packages/daemon/src/services/feature-vector.ts` (compositeDistance, cosineSimilarity)
- `.lore/brainstorms/redundancy-scoring.md` (niche display, similarity infrastructure)
- `.lore/issues/shelf-layout-designer.md` (original idea)

**Recent brainstorm check:** Five prior brainstorms exist. None address physical shelf layout. The `redundancy-scoring.md` brainstorm is the closest neighbor: it proposed niche champion display (Proposal 5, now implemented) and pairwise similarity scoring, both of which produce the "game similarity" data that the shelf layout idea would consume for its "group similar games together" constraint. No duplication.

---

## The Shape of the Problem

The issue asks for something that sounds simple: store box sizes, model shelves, pack games onto shelves, group similar games nearby. But this idea sits at a crossroads. One direction leads deeper into Shelf Judge's existing identity as a curation decision tool. The other direction leads toward a separate concern entirely: spatial logistics.

The question isn't whether shelf layout optimization is interesting (it is) or feasible (it is, with constraints). The question is whether it serves the vision. Shelf Judge helps owners "understand what their shelf actually says about them and make informed decisions about what stays, what goes, and what comes next." Physical layout is about where things go after the decision is made.

That said, there's an observation hiding inside this idea that does serve the vision. The physical shelf is the last place where the abstract becomes concrete. A user who has rated 80 games, run tournaments, computed fitness scores, and identified niche champions still has to put the boxes somewhere. If the system could show them that their top-ranked games in each niche would cluster naturally on the same shelf, or that their bottom five games are the ones that don't fit anywhere, the physical constraint becomes another lens on the curation question.

The proposals below explore both directions and name which one they serve.

---

## Proposal 1: Box Dimensions as Game Metadata (Data Foundation)

### Evidence

The BGG Thing endpoint supports a `versions=1` parameter that returns physical edition data for each game. Version entries include width, length, depth, and weight (physical weight, not complexity). These are community-contributed values on BGG, attached to specific game editions (e.g., "Gloomhaven - English first edition" vs. "Gloomhaven - Revised Edition").

The current BGG parser (`packages/daemon/src/services/bgg-xml-parser.ts`) does not request or extract version data. The `Game` type (`types.ts:47-61`) has no fields for physical dimensions.

Manual measurement is the alternative. Board game boxes come in a modest number of standard sizes (roughly 8-10 common form factors), but there's enough variation that "standard small box" doesn't capture the difference between a 7 Wonders Duel box and a Jaipur box.

### Proposal

Add optional physical dimension fields to the `Game` type:

```typescript
interface BoxDimensions {
  width: number; // cm
  height: number; // cm
  depth: number; // cm
  source: "bgg" | "manual";
}
```

Add `boxDimensions: BoxDimensions | null` to `Game`. Populate from BGG when `versions=1` data is available (take the first version entry with dimensions, or the version matching the user's edition if edition tracking is ever added). Allow manual entry/override through the game edit form and CLI.

This proposal is deliberately just the data layer. It doesn't assume anything about what the dimensions are used for. Box dimensions are useful metadata independent of shelf optimization: the user might want to sort their collection by box size, or filter for "games that fit in a carry-on."

### Vision alignment

1. **Anti-goal check.** Storing metadata is not a recommendation. Passes.
2. **Principle alignment.** Principle 1 (games have physical properties that are part of what the owner knows about them). Principle 4 (BGG provides the data; it's context, not judgment).
3. **Tension resolution.** No tensions raised. This is pure data enrichment.
4. **Constraint check.** Requires extending the BGG parser to handle `versions=1` responses. The `versions` data is a different XML structure than the fields currently parsed, so it's new parsing code, not a modification of existing parsing. Coverage will be inconsistent: many BGG entries have no version data, or have versions without dimensions. The type is nullable for this reason.

### Scope: Small

New nullable field on Game type, BGG parser extension for versions endpoint, manual entry in game edit form, CLI `edit` command support.

---

## Proposal 2: Shelf Configuration Data Model

### Evidence

A physical shelf unit is a hierarchical structure: a piece of furniture contains shelves, each shelf has interior dimensions, and shelf units can be adjacent to each other ("neighbors"). The issue's description asks to model this: "w x h x l per shelf and its neighbors."

The existing data model stores everything in `collection.json`. A shelf configuration is a different kind of data: it describes the user's physical environment, not their game collection. It changes when the user buys a new bookcase, not when they add a game.

### Proposal

A new top-level data entity, stored in `~/.shelf-judge/data/shelf-config.json`:

```typescript
interface Shelf {
  id: string; // UUID
  name: string; // "Top shelf", "Kallax row 2"
  width: number; // interior cm
  height: number; // interior cm
  depth: number; // interior cm
}

interface ShelfUnit {
  id: string; // UUID
  name: string; // "Living room Kallax", "Office bookcase"
  shelves: Shelf[]; // ordered top-to-bottom
}

interface ShelfNeighbor {
  unitA: string; // ShelfUnit ID
  unitB: string; // ShelfUnit ID
  relationship: "adjacent" | "same-room" | "different-room";
}

interface ShelfConfiguration {
  units: ShelfUnit[];
  neighbors: ShelfNeighbor[];
  createdAt: string;
  updatedAt: string;
}
```

The adjacency model is flat: pairs of shelf units with a relationship tag. "Adjacent" means physically next to each other (games can be grabbed without moving). "Same room" means visible together. "Different room" means separate. This is coarser than a full spatial graph but captures what matters for the similarity-grouping constraint: how "near" two shelves are in the user's physical space.

### Why not embed shelves in the collection?

The collection describes what the user owns. The shelf configuration describes where they put things. These have different lifecycles and different reasons to change. Keeping them separate means the shelf layout feature can be developed, tested, and even removed without touching the collection data model.

### Vision alignment

1. **Anti-goal check.** Modeling physical furniture is not a game recommendation. Passes, but this is where the idea starts drifting from core vision territory.
2. **Principle alignment.** Principle 1 (the shelf is personal). The model is simple enough to be transparent (Principle 2). But no principle directly calls for physical space modeling.
3. **Tension resolution.** No explicit tension in the table. The implicit tension is "curation tool vs. organization tool." The vision doesn't address this because it didn't anticipate it.
4. **Constraint check.** New data model, new storage file, new CRUD API surface, new UI for shelf configuration. This is real scope even before any optimization logic.

### Scope: Medium

Data model, storage, API endpoints (CRUD for shelf units, shelves, neighbors), UI for shelf configuration, CLI commands.

---

## Proposal 3: Similarity-Aware Shelf Assignment (The Curation Lens)

### Evidence

The niche engine (`packages/daemon/src/services/niche-engine.ts`) already computes which games share niches via mechanic/category/family tags. The feature vector module (`feature-vector.ts`) computes pairwise composite distances. The niche champion display (shipped, `NicheEntry` in `types.ts:430-447`) shows each game's neighbors within its niches.

The issue's most interesting sentence is the last one: "Use similarity to prioritize games that share a shelf or are in a neighboring shelf." This isn't a bin-packing problem. It's a clustering problem with a physical constraint. The question is: can you arrange games so that browsing any single shelf feels like browsing a coherent sub-collection?

### Proposal

Given a shelf configuration (Proposal 2) and box dimensions (Proposal 1), compute a shelf assignment that:

1. **Fits.** Every assigned game's box fits on its assigned shelf (width and depth within shelf dimensions, height accommodates the box in its storage orientation).
2. **Groups similar games.** Games with high composite similarity (from `feature-vector.ts`) land on the same shelf or adjacent shelves when possible. The similarity-grouping objective is weighted by the `ShelfNeighbor` relationship: same-shelf is best, adjacent-unit is good, same-room is acceptable, different-room gets no similarity bonus.
3. **Respects fitness ranking.** Within a niche that spans multiple shelves, the higher-fitness game gets the more accessible shelf position (if the user has expressed a shelf preference ordering, e.g., "eye level is best").

The algorithm is a constrained assignment problem. Each game needs a shelf. Each shelf has a capacity (volume and footprint). The objective function balances space utilization with similarity clustering. This is NP-hard in the general case (it reduces to bin-packing), but for realistic collection sizes (50-200 games, 10-30 shelves) a greedy heuristic works:

1. Sort games by niche membership, breaking ties by fitness score.
2. For each niche cluster, assign games to the emptiest shelf that fits, preferring shelves that already contain games from the same niche.
3. When a niche cluster overflows a shelf, spill to the nearest neighbor shelf.

This isn't optimal. It's good enough. The user can drag games between shelves in the UI to fix what the algorithm got wrong, which leads to Proposal 5.

### Why similarity matters more than space efficiency

Pure bin-packing (minimize wasted space) is a solved problem but the wrong problem. A perfectly packed shelf where Gloomhaven sits between Love Letter and Codenames because they happened to fit is useless. The user wants to walk up to a shelf and see their euro collection, not a Tetris solution.

The similarity constraint turns this from a logistics problem into a curation display. "Your deck-building games are on shelf 3, your heavy euros are on shelf 4" is a statement about collection identity (Principle 3) expressed physically.

### Vision alignment

1. **Anti-goal check.** Does not recommend purchases. Recommends shelf positions. This is a judgment call: is "put Agricola on shelf 2" a recommendation the vision prohibits? The anti-goal says "automated purchase decisions." Shelf placement is a different class of action, closer to "display" than "decide." Passes with a note.
2. **Principle alignment.** Principle 3 ("your collection has an identity") is the strongest connection. The physical shelf is the identity made tangible. Principle 1 (the arrangement is personal). Principle 2 (the algorithm's choices are explainable: "these games share Deck Building and Worker Placement mechanics").
3. **Tension resolution.** "Collection-aware fitness vs simplicity": the similarity grouping uses collection-aware data (feature vectors, niche membership) but doesn't modify fitness scores. It's a read-only consumer of the existing intelligence.
4. **Constraint check.** Depends on Proposals 1 and 2. The algorithm itself is pure computation (no external dependencies). But the total feature surface (shelf config UI + dimension entry + assignment algorithm + assignment display) is substantial.

### Scope: Large

Algorithm module, assignment storage, integration with niche engine and feature vectors, UI for viewing and adjusting assignments.

---

## Proposal 4: "What Doesn't Fit" as a Curation Signal

### Evidence

The issue frames this as an optimization problem: fill shelves optimally. But there's a simpler, more vision-aligned question hiding underneath: what happens when a game doesn't fit?

If the user defines their shelf capacity (Proposal 2) and the system knows box sizes (Proposal 1), the system can compute total shelf volume vs. total collection volume. When the collection exceeds shelf capacity, some games literally don't fit. Which ones?

The fitness score already answers this. The games that don't fit are the ones at the bottom of the fitness ranking. The physical constraint becomes a forcing function for the curation decision that Shelf Judge is designed to support.

### Proposal

A lightweight "shelf capacity" view that shows:

- **Total shelf space:** Sum of all shelf volumes from the shelf configuration.
- **Total collection footprint:** Sum of all game box volumes (from Proposal 1 dimensions, estimated for games without measurements).
- **Headroom or overflow:** How much space remains, or how many games need to go.
- **The overflow list:** If the collection exceeds capacity, show the N lowest-fitness games that would need to be removed to fit. Sorted by fitness, ascending. Each entry shows the game, its fitness score, and how much space it would free.

No algorithm. No optimization. Just arithmetic and a sorted list. "You have 200 liters of games and 180 liters of shelf. These 8 games are your lowest-fitness and would free 25 liters."

This is the version of the shelf layout idea that most directly serves the vision. It takes a physical reality (finite shelf space) and connects it to the curation question (what stays, what goes). The user doesn't need an optimal packing algorithm. They need to see that their shelf is full and know which games the system would suggest removing based on the ratings they've already provided.

### Vision alignment

1. **Anti-goal check.** "Shelf-judge does not tell you what to buy." It also doesn't tell you what to remove, and this proposal doesn't either. It shows the user which games are at the bottom of their own fitness rankings when physical space is the constraint. The user decides. Passes.
2. **Principle alignment.** Principle 5 ("the shelf has a carrying capacity") is literally about carrying capacity, and this proposal makes it physical. Principle 2 (the overflow calculation is trivially transparent). Principle 4 (the data is volume math; the judgment is the user's).
3. **Tension resolution.** This is the "simplicity" side of every tension. No optimization, no assignment algorithm, no complex UI.
4. **Constraint check.** Depends on Proposals 1 and 2 for data. The computation itself is addition and sorting.

### Scope: Small

Volume calculation, overflow list sorted by fitness, one new view in the web UI, one new CLI command.

---

## Proposal 5: Interactive Shelf Visualizer

### Evidence

The web UI (`packages/web/`) uses Next.js with React components. The existing collection page renders game cards in a grid or list view. A shelf visualization would render game boxes as sized rectangles on a shelf cross-section, which is a different rendering paradigm (spatial layout vs. content list).

The issue asks "is this a one-shot compute or an interactive designer?" This proposal answers: interactive, but not a general-purpose designer. The system suggests; the user adjusts.

### Proposal

A dedicated "Shelf View" page in the web UI that renders the user's shelf configuration as a front-facing view of their shelves. Each shelf is a horizontal bar with its physical dimensions. Games are rendered as colored rectangles (width = box width, height = box height, scaled to fit the visualization). Colors indicate niche membership (matching the existing niche tag colors from the collection page).

Interaction model:

- **Drag and drop.** The user can drag a game from one shelf to another. The system validates the fit (does the box physically fit on the destination shelf?) and snaps it into position.
- **Auto-arrange.** A button that runs the Proposal 3 algorithm and populates the shelves. The user can then manually adjust.
- **Unassigned pile.** Games that don't fit any shelf (or haven't been assigned yet) appear in a sidebar. This is the overflow list from Proposal 4, visually.
- **Shelf tooltips.** Hovering a shelf shows its utilization (% full by volume), the dominant niche(es) on that shelf, and the average fitness of its games.

The visualizer doesn't need to be pixel-accurate. Shelf depth is ignored in the front-facing view (it only matters for "does the box fit," which is validated mathematically, not visually). The view shows width and height, which is what the user sees when looking at their actual shelf.

### Why front-facing, not top-down

A top-down view (looking at the shelf from above) would show depth, which matters for boxes that are too deep for a shelf. But when a person looks at their shelf, they see the front face. The visualization should match the mental model. Depth is a constraint checked by the system, not something the user needs to visually manage.

### Vision alignment

1. **Anti-goal check.** An interactive layout tool is not a purchase recommendation or a social feature. It is, however, a significant departure from the existing UI paradigm. Shelf Judge has been a data exploration tool (lists, breakdowns, charts). A spatial drag-and-drop interface is a different kind of product. Passes the anti-goal check but raises a scope question.
2. **Principle alignment.** Principle 3 (the shelf arrangement IS the collection identity made physical). Principle 1 (the user decides where games go). But no principle calls for a spatial visualization tool. This is additive, not required by the vision.
3. **Tension resolution.** "Collection-aware fitness vs simplicity" strongly favors simplicity here. The interactive visualizer is the most complex proposal in this brainstorm by a wide margin.
4. **Constraint check.** Requires a 2D rendering framework or careful CSS-grid-based layout. Drag-and-drop with physics constraints (collision detection, snap-to-shelf) is non-trivial frontend work. This is a full feature, not an extension of existing UI.

### Scope: Large

New page, 2D shelf renderer, drag-and-drop interaction, integration with assignment algorithm, shelf configuration panel, responsive design for different shelf sizes.

---

## Proposal 6: Shelf-Aware Similarity in the Niche Display

### Evidence

The niche champion display (shipped) already shows "Niche: Deck Building (5 games), Rank: #3 of 5, Champion: Dominion (8.4)." The niche engine computes this from mechanic/category/family tags and fitness scores.

The redundancy brainstorm's Proposal 5 (niche display without score modification) was implemented because it provides information without asserting conclusions. The same principle applies here: instead of building a full shelf layout optimizer, surface shelf-relevant information alongside existing game data.

### Proposal

Extend the niche display with a "shelf note" when box dimensions and shelf configuration are available:

```
Niche: Deck Building (5 games)
  Rank: #2 of 5  |  Champion: Dominion (8.4)
  Shelf: All 5 on Shelf 3 (Kallax, Row 2) - 68% similar
```

Or, when games in the same niche are physically separated:

```
Niche: Heavy Euro (7 games)
  Rank: #1 of 7 (Champion)
  Shelf: 4 on Living Room shelf, 3 on Office shelf
  Note: 3 close neighbors are on a different shelf unit
```

This doesn't compute optimal layouts. It annotates the current reality. If the user has manually arranged their shelves and entered the configuration, the system can tell them: "Your deck-building games are all together (good for browsing) but your heavy euros are split across two rooms (you might not realize Agricola and Brass are in the same niche because they're not physically near each other)."

This is the lightest-touch version of the similarity-shelf connection. It adds one line to an existing display. It requires shelf assignments to be entered manually (the user tells the system which game is on which shelf, rather than the system computing it). And it feeds directly into the curation question: "I didn't realize these were in the same niche because I never see them together."

### Vision alignment

1. **Anti-goal check.** Annotation, not recommendation. Passes cleanly.
2. **Principle alignment.** Principle 3 (makes collection identity legible by connecting the abstract niche to the physical shelf). Principle 2 (the annotation is simple and transparent). Principle 5 (carrying capacity includes physical proximity, not just attribute overlap).
3. **Tension resolution.** Maximum simplicity. One annotation line. No algorithms, no optimization, no new pages.
4. **Constraint check.** Requires Proposals 1 and 2 for data, plus a manual "assign game to shelf" interface. The annotation itself is trivial once assignments exist.

### Scope: Small

Manual shelf assignment (dropdown in game edit form), one annotation line in niche display, no new algorithms.

---

## The Vision Question

This brainstorm originally framed Proposals 2, 3, and 5 as a potential scope expansion beyond Shelf Judge's curation identity. Discussion with the user resolved this:

**"Where does this go?" is a curation question.** Organizing the shelf is part of judging what goes on it. "Do I have space for this?" is a keep/cull decision, not a logistics decision. "What do I have to get rid of to make space?" is the curation question that Shelf Judge exists to answer, expressed through a physical constraint. All six proposals belong inside the vision's scope.

The altitude difference between the proposal groups still matters for prioritization, but it's a sequencing concern, not a scope boundary. The curation-lens proposals (1, 4, 6) deliver value sooner with less risk. The spatial proposals (2, 3, 5) build on top and can follow.

**Box dimensions are load-bearing, not optional enrichment.** The user's collection includes wallet games where 100 fit in the space of one standard box. Volume-based overflow math without actual box dimensions would treat every game equally, which badly misrepresents reality. Proposal 1 is a prerequisite for Proposal 4 to produce honest results, not a nice-to-have data layer.

**The user has more games than shelves, distributed across the house.** The overflow scenario is the default state, not an edge case. The neighbor relationships in Proposal 2 ("adjacent," "same-room," "different-room") matter because shelves aren't co-located. The "what doesn't fit" view (Proposal 4) is immediately valuable, not hypothetically useful.

**Box dimensions have standalone utility beyond shelf layout** (e.g., "what fits in my board game backpack?"), but those use cases are stretch goals and possibly belong in a separate plugin or app. The primary justification for Proposal 1 is accurate capacity math for the shelf features.

---

## Implementation Sequence

The dependency chain, confirmed by discussion:

1. **Proposal 1 (Box Dimensions)** first. Prerequisite for accurate capacity math. Without real dimensions, overflow calculations are fiction (wallet games vs. Gloomhaven boxes make volume-blind math misleading).
2. **Proposal 4 (What Doesn't Fit)** second. Requires Proposal 1 plus basic shelf capacity data (could be a single "total shelf volume" number, no full shelf model needed). Delivers the strongest curation value for the least scope. This is the first thing that answers "do I have space, and if not, what goes?"
3. **Proposal 2 (Shelf Configuration)** third. Infrastructure for spatial features. The distributed-shelves-across-the-house reality makes the neighbor model meaningful.
4. **Proposal 6 (Shelf-Aware Niche Display)** after Proposal 2. Lightweight, curation-aligned, validates that shelf assignments are useful before investing in optimization.
5. **Proposals 3 and 5 (Assignment Algorithm + Visualizer)** last. Largest scope, builds on everything above.

---

## Open Questions (Resolved)

_Discussed 2026-04-12. Answers below._

1. **Is "where do I put my games?" a question Shelf Judge should answer, or just "which games should I keep?"**
   Yes, both. Organizing the shelf is part of curation. "Do I have space?" and "what do I get rid of to make space?" are curation questions expressed through physical constraints. All six proposals are in scope.

2. **How many games do you own, and how many shelves?**
   More games than shelves. Shelves are distributed throughout the house. The overflow scenario is the default state.

3. **Would you use box dimensions for anything besides shelf layout?**
   Yes. "What fits in my board game backpack?" is a real use case, but it's a stretch goal and possibly a separate plugin/app. The primary value is accurate shelf capacity math. Box dimensions are essential, not optional, because wallet games and standard boxes have wildly different volumes.

4. **Would a simple "your shelf is full, here are the weakest games" view (Proposal 4) satisfy the itch that prompted this idea?**
   Proposal 4 is the right starting point and delivers immediate value. The full spatial features (Proposals 2, 3, 5, 6) belong in the roadmap and build on top. Start with 1 and 4, then layer the rest.
