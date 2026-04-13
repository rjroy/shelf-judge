---
title: "Shelf Capacity (Box Dimensions, Shelf Config, Overflow)"
date: 2026-04-12
status: approved
tags: [spec, shelf-layout, box-dimensions, shelf-config, capacity, overflow, curation, bgg-versions]
modules: [shared, daemon, web, cli]
req-prefix: SHELF
related:
  - .lore/brainstorms/shelf-layout-designer.md
  - .lore/issues/shelf-layout-designer.md
  - .lore/vision.md
  - .lore/designs/mvp-data-model.md
  - .lore/designs/similarity-weighted-bin-packing.md
  - .lore/research/bgg-api.md
---

# Spec: Shelf Capacity (Box Dimensions, Shelf Config, Overflow)

## Overview

This spec covers three connected layers of the shelf layout designer: storing physical box dimensions per game (brainstorm Proposal 1), modeling the user's shelf configuration (a minimal cut of brainstorm Proposal 2), and computing shelf capacity overflow (brainstorm Proposal 4).

The core curation question is "do I have space, and if not, what goes?" But that question is meaningless without shape. A single total-volume number fails because the constraint isn't cubic centimeters, it's whether a box physically fits on a shelf. A 25-inch vintage game box doesn't fit in a 14-inch Kallax cube regardless of how much total volume remains.

This requires three things: knowing each game's box size, knowing each shelf's interior dimensions, and running a bin-packing algorithm that assigns games to specific shelves. The overflow computation is driven by the algorithm's placement results: games the algorithm couldn't place are the overflow. The algorithm is defined in `.lore/designs/similarity-weighted-bin-packing.md` and handles spatial fitting, similarity-based grouping, and overflow detection as a unified process.

## Entry Points

- BGG import flow (daemon): box dimensions are fetched alongside existing game data when `versions=1` data is available
- Game edit form (web): manual entry/override of box dimensions
- CLI `shelf-judge game edit`: manual dimension entry
- Shelf configuration page (web): user defines shelf units and their shelves
- CLI `shelf-judge shelf`: manage shelf configuration, view capacity and overflow
- Collection page (web): overflow indicator when shelves are configured and collection exceeds capacity

## Requirements

### Box Dimensions Data Model

- REQ-SHELF-1: A new type represents physical box dimensions:

```typescript
interface BoxDimensions {
  width: number; // cm
  height: number; // cm
  depth: number; // cm
  source: "bgg" | "manual";
}
```

All three dimensions are in centimeters. The `source` field records where the data came from. Semantics: `width` is the longest face edge (what you see from the front), `height` is the vertical dimension when the box is stored upright, `depth` is front-to-back. For the purpose of shelf fitting, the system checks all orientations (see REQ-SHELF-22), so the labeling convention is informational, not load-bearing.

- REQ-SHELF-2: `BoxDimensions` is a shared type defined in `packages/shared/src/types.ts`.

- REQ-SHELF-3: The `Game` type gains an optional field: `boxDimensions: BoxDimensions | null`. Default is `null` (no dimensions known). This is an additive, non-breaking change to the existing type.

- REQ-SHELF-4: Box volume is computed as `width * height * depth` (cubic centimeters). This is a derived value, not stored. Games with `boxDimensions: null` have unknown volume.

### BGG Version Data Import

- REQ-SHELF-5: The BGG Thing endpoint supports a `versions=1` query parameter that returns physical edition data for each game. When fetching game data, the daemon MUST include `versions=1` alongside the existing `stats=1` parameter. This applies to all Thing endpoint calls: single-game fetch (`getGame`), batch fetch (`getGames`), and search enrichment.

- REQ-SHELF-6: The BGG `versions=1` response includes `<versions>` containing `<item>` elements. Each version item may include `<width value="..."/>`, `<length value="..."/>`, and `<depth value="..."/>` elements with dimensions. The dimension units in BGG data are inches. The parser MUST convert to centimeters (multiply by 2.54) before storing.

- REQ-SHELF-7: When multiple versions exist for a game (e.g., different editions), use the first version entry that has all three dimension fields populated (width, length, depth). If no version has complete dimensions, `boxDimensions` remains `null`. Rationale: edition-specific selection would require tracking which edition the user owns, which is out of scope. The first complete entry is a reasonable default for most games.

- REQ-SHELF-8: BGG dimension data may be zero, negative, or absurdly large (community-contributed data has noise). Reject dimensions where any single value is <= 0 or > 100 (cm). Treat rejected dimensions the same as missing: `boxDimensions` remains `null`. The threshold of 100 cm (~39 inches) accommodates the largest known board game boxes with margin.

- REQ-SHELF-9: The BGG XML parser gains a new function or extends the existing `parseThingItems` to extract version dimension data. The parsed result is returned alongside the existing `BggGameData` so the caller can populate `boxDimensions` on the `Game` object.

- REQ-SHELF-10: Existing games in the collection that were imported before this feature have `boxDimensions: null`. A "Refresh BGG Data" action (already exists for staleness refresh) MUST also populate `boxDimensions` from BGG version data when refreshing a game. No separate "fetch dimensions" action is needed.

### Manual Dimension Entry

- REQ-SHELF-11: Users can manually set or override box dimensions for any game. Manual entry sets `source: "manual"`. Manual values override BGG-sourced values. There is no way to "revert to BGG" other than manually entering the BGG values or deleting dimensions and refreshing.

- REQ-SHELF-12: The game edit form (web) gains three numeric fields for width, height, and depth (cm). These are optional. If any dimension is provided, all three MUST be provided (partial dimensions are rejected). An "auto" or empty state means "no dimensions known."

- REQ-SHELF-13: The CLI `shelf-judge game edit` command accepts `--box-width`, `--box-height`, and `--box-depth` flags (cm). All three must be provided together or none. A `--clear-box` flag removes dimensions (sets `boxDimensions` to `null`).

### Shelf Configuration Data Model

- REQ-SHELF-14: The shelf configuration models the user's physical storage as a hierarchy: shelf units contain shelves. A shelf unit is a piece of furniture (a Kallax, a bookcase). A shelf is one storage space within that unit (one Kallax cube, one bookcase shelf).

```typescript
interface Shelf {
  id: string; // UUID
  name: string; // "Top shelf", "Kallax row 2", "On top"
  width: number; // interior cm
  height: number | null; // interior cm, null = unconstrained (e.g., top of a unit)
  depth: number; // interior cm
}

interface ShelfUnit {
  id: string; // UUID
  name: string; // "Living room Kallax", "Office bookcase"
  shelves: Shelf[]; // ordered top-to-bottom
}

interface ShelfConfiguration {
  units: ShelfUnit[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

- REQ-SHELF-15: A shelf's `height` can be `null`, meaning the vertical dimension is unconstrained. This models "on top of" spaces: the top of a Kallax unit, the top of a bookcase, or any open surface where height is limited only by the ceiling or the user's tolerance. When `height` is null, a game fits the shelf if its box width and depth fit (in some orientation), regardless of box height.

- REQ-SHELF-16: `Shelf`, `ShelfUnit`, and `ShelfConfiguration` are shared types defined in `packages/shared/src/types.ts`.

- REQ-SHELF-17: The shelf configuration is stored in `~/.shelf-judge/data/shelf-config.json`. This is a separate file from `collection.json`. The shelf configuration describes the user's physical environment, not their game collection. These have different lifecycles: the configuration changes when the user buys a new bookcase, not when they add a game. An empty configuration is `{ units: [], createdAt: "...", updatedAt: "..." }`.

- REQ-SHELF-18: Shelf configuration storage follows the same atomic write pattern as all other storage files (write to temp file, rename into place).

### Shelf Configuration API

- REQ-SHELF-19: Daemon API endpoints for shelf configuration:

| Operation ID         | Method | Path                   | Description                            |
| -------------------- | ------ | ---------------------- | -------------------------------------- |
| `shelf.config.get`   | GET    | `/api/shelf/config`    | Get full shelf configuration           |
| `shelf.config.set`   | PUT    | `/api/shelf/config`    | Replace full shelf configuration       |
| `shelf.units.add`    | POST   | `/api/shelf/units`     | Add a shelf unit                       |
| `shelf.units.update` | PUT    | `/api/shelf/units/:id` | Update a shelf unit (name and shelves) |
| `shelf.units.remove` | DELETE | `/api/shelf/units/:id` | Remove a shelf unit                    |

- REQ-SHELF-20: The full-config PUT (`/api/shelf/config`) accepts a complete `ShelfConfiguration` and replaces the stored config. This supports bulk editing in the web UI. The individual unit endpoints (`POST`, `PUT`, `DELETE`) support incremental changes from the CLI.

**PUT `/api/shelf/config`**:

```typescript
// Request
{ units: ShelfUnit[] }

// Response (200)
ShelfConfiguration
```

**POST `/api/shelf/units`**:

```typescript
// Request
{ name: string, shelves: Array<{ name: string, width: number, height: number | null, depth: number }> }

// Response (201)
ShelfUnit // with generated IDs
```

**PUT `/api/shelf/units/:id`**:

```typescript
// Request
{ name?: string, shelves?: Array<{ id?: string, name: string, width: number, height: number | null, depth: number }> }

// Response (200)
ShelfUnit
```

When shelves are provided in a unit update, shelves with an `id` are updated, shelves without an `id` are added, and shelves present in the stored unit but absent from the request are removed.

**DELETE `/api/shelf/units/:id`**:

```typescript
// Response (200)
{
  removed: true;
}
```

- REQ-SHELF-21: Shelf dimensions are validated on write. Width and depth MUST be > 0. Height MUST be > 0 or null. Name MUST be non-empty. Shelf unit name MUST be non-empty. Validation errors return 400 with a descriptive message.

### Overflow Computation

The overflow computation is driven by the similarity-weighted bin-packing algorithm defined in `.lore/designs/similarity-weighted-bin-packing.md`. Shelves map to bins, games map to items. The algorithm assigns games to specific shelves and produces overflow (Phase 4) for games that don't fit. The spec below defines how the daemon maps Shelf Judge's data into the algorithm's inputs and what the API exposes from the algorithm's output.

- REQ-SHELF-22: A game "fits" on a shelf if its box can be oriented so that the box dimensions fit within the shelf dimensions. The algorithm's rotation logic (see design doc, "Item Rotation and Fit") handles this: it checks orientations according to axis priority and minimization flags. For shelves with `height: null` (unconstrained), the height axis is unconstrained and only width and depth are checked. The six-orientation fit check from the original spec maps to the algorithm's rotation with `force_axis_0_width: true` (games face outward on the shelf).

- REQ-SHELF-23: A game "fits the configuration" if it fits on at least one shelf in any unit. A game that fits no shelf is "unfittable," it physically cannot be stored in the user's current shelf setup. These games are identified before the algorithm runs (a pre-pass geometric check) and reported separately from algorithm overflow.

- REQ-SHELF-24: The daemon provides a capacity endpoint:

| Operation ID     | Method | Path                  | Description                                 |
| ---------------- | ------ | --------------------- | ------------------------------------------- |
| `shelf.capacity` | GET    | `/api/shelf/capacity` | Run bin-packing and return capacity results |

- REQ-SHELF-25: The capacity response shape:

```typescript
interface ShelfCapacityResult {
  configured: boolean; // true if at least one shelf exists
  totalShelfCount: number; // total number of shelves across all units
  gamesWithDimensions: number; // count of games with boxDimensions
  gamesWithoutDimensions: number; // count of games with boxDimensions: null
  overflowing: boolean; // true if overflowGames is non-empty
  assignments: ShelfAssignment[]; // per-shelf: which games were assigned, utilization
  unfittableGames: UnfittableEntry[]; // games that fit NO shelf by shape
  overflowGames: OverflowEntry[]; // games that fit somewhere by shape but were displaced
}

interface ShelfAssignment {
  shelfId: string;
  shelfName: string;
  unitId: string;
  unitName: string;
  capacityCm3: number | null; // null for unconstrained-height shelves
  usedCm3: number; // sum of assigned game volumes
  utilization: number | null; // usedCm3 / capacityCm3, null if unconstrained
  games: AssignedGame[]; // games placed on this shelf by the algorithm
  grade: string; // S, A, B, C, D, F from algorithm grading (see design doc)
}

interface AssignedGame {
  gameId: string;
  gameName: string;
  fitnessScore: number;
  volumeCm3: number;
}

interface UnfittableEntry {
  gameId: string;
  gameName: string;
  fitnessScore: number;
  boxDimensions: BoxDimensions;
  reason: string; // e.g., "Box is 63 x 10 x 10 cm; widest shelf is 36 cm"
}

interface OverflowEntry {
  gameId: string;
  gameName: string;
  fitnessScore: number;
  volumeCm3: number;
  fittable: boolean; // true = fits a shelf by shape but displaced; false = dimensionless
}
```

- REQ-SHELF-26: The `unfittableGames` list contains every game with known dimensions that fits no shelf in the configuration. These are the strongest cull candidates: they literally cannot be stored. The list is sorted by fitness ascending (lowest fitness first). The `reason` field is a human-readable explanation of why the game doesn't fit (e.g., which dimension exceeds all available shelves). Unfittable games are excluded from the packing algorithm; they are identified by a pre-pass geometric check.

- REQ-SHELF-27: The `overflowGames` list contains games that the bin-packing algorithm could not place (Phase 4 output). These are games that fit at least one shelf by shape but were displaced because higher-priority games filled the available space first. The list is sorted by fitness ascending (lowest fitness first). The `fittable` flag distinguishes between games that were displaced (fit somewhere by shape but no room) and dimensionless games that bypassed spatial logic. Games without `boxDimensions` are excluded from the algorithm entirely and are counted in `gamesWithoutDimensions`.

- REQ-SHELF-28: Shelves with `height: null` (unconstrained) map to bins with a dimensionless height axis in the algorithm. They participate fully in the packing algorithm: games can be assigned to them and their contents are tracked. Their `capacityCm3` is `null` in the response because their volume is undefined (no height to multiply). Their `utilization` is also `null`. "On top of" spaces accept games and show what's assigned to them, but don't contribute to volume-based summary statistics.

- REQ-SHELF-29: When no shelf configuration exists (no units), the capacity endpoint returns a valid response with `configured: false` and empty/zero values. No 400 error. The UI uses `configured` to show a "configure your shelves" prompt.

- REQ-SHELF-30: When no games have box dimensions, the capacity endpoint returns a valid response with `gamesWithDimensions: 0`, `overflowing: false`, `unfittableGames: []`, `overflowGames: []`, and empty `assignments`.

- REQ-SHELF-31: The capacity computation uses current fitness scores and current collection state. It does not cache or snapshot scores. Each call runs the bin-packing algorithm fresh against the current data. The algorithm's similarity function uses the existing composite distance from `feature-vector.ts`.

### Web UI: Game Dimensions Display

- REQ-SHELF-32: The game detail page shows box dimensions when available: "Box: 29 x 29 x 7 cm" (or "Box: not measured" when null). Displayed alongside existing metadata (player count, playing time, etc.).

### Web UI: Shelf Configuration

- REQ-SHELF-33: A "Shelf Configuration" page is accessible from the settings area. The page shows the user's shelf units, each with its list of shelves. The user can:
  - Add a shelf unit (name, then add shelves to it)
  - Add a shelf to an existing unit (name, width, height, depth; height is optional for "on top of" spaces)
  - Edit shelf names and dimensions
  - Remove shelves and shelf units
  - Reorder shelves within a unit (drag or up/down)

- REQ-SHELF-34: The shelf configuration page shows a live summary: total number of shelves, total capacity (excluding unconstrained-height shelves), and number of unconstrained-height shelves.

- REQ-SHELF-35: Shelf configuration is added to the sidebar navigation under a "Shelves" group or within the existing settings navigation. Exact placement is an implementation decision.

### Web UI: Capacity Display

- REQ-SHELF-36: The collection page gains a capacity indicator when shelves are configured and at least one game has dimensions. The indicator shows:
  - When not overflowing and no unfittable games: "All N games placed" with a summary of shelf utilization (e.g., "14 shelves, avg 68% full").
  - When overflowing: "M games couldn't be placed" with visual emphasis (warning color). The count is `unfittableGames.length + overflowGames.length`.
  - When unfittable games exist: "N games don't fit any shelf" as a separate warning, regardless of displacement overflow.
  - When configured but no games have dimensions: "Shelves configured, but no game dimensions available."

- REQ-SHELF-37: When there are unfittable games or overflow games, the collection page shows a link to a capacity detail view. This view displays:
  - **Shelf assignments section**: each shelf with its assigned games, utilization percentage (for constrained-height shelves), and grade from the algorithm. This is the primary output: a concrete answer to "what goes where."
  - **Unfittable games section** (if any): games that fit no shelf, sorted by fitness ascending, with the reason each doesn't fit. These are the strongest cull candidates.
  - **Displaced games section** (if any): games that fit somewhere by shape but were displaced by higher-priority games. Sorted by fitness ascending. These are the next cull candidates, or the user needs more shelf space.
  - **Dimension coverage note**: "N games have no box dimensions and are excluded from this calculation. [Add dimensions]" with a link to filter the collection to games without dimensions.

This can be a dedicated sub-page, a modal, or a section on the collection page.

### CLI

- REQ-SHELF-38: New CLI commands:

| Command                                                                 | Description                                        |
| ----------------------------------------------------------------------- | -------------------------------------------------- |
| `shelf-judge shelf status`                                              | Show shelf config summary and placement status     |
| `shelf-judge shelf add-unit <name>`                                     | Add a shelf unit                                   |
| `shelf-judge shelf add-shelf <unit-id> <name> <width> <height> <depth>` | Add a shelf to a unit (height=0 for unconstrained) |
| `shelf-judge shelf remove-unit <unit-id>`                               | Remove a shelf unit                                |
| `shelf-judge shelf remove-shelf <shelf-id>`                             | Remove a shelf                                     |
| `shelf-judge shelf list`                                                | List all units and shelves                         |
| `shelf-judge shelf capacity`                                            | Show assignments, unfittable, and displaced games  |

- REQ-SHELF-39: `shelf-judge shelf add-shelf` accepts height=0 as a convention for "unconstrained height" (stored as `null`). This avoids optional positional arguments.

- REQ-SHELF-40: `shelf-judge shelf status` output:

```
Shelf Configuration: 3 units, 14 shelves (2 unconstrained-height)
Games Measured: 87 of 94
Placed: 82 games across 14 shelves
Unfittable: 3 (don't fit any shelf)
Displaced: 2 (fit by shape but no room)
```

Or when everything fits:

```
Shelf Configuration: 3 units, 14 shelves (2 unconstrained-height)
Games Measured: 87 of 94
Placed: 87 games across 14 shelves
All measured games placed successfully.
```

- REQ-SHELF-41: `shelf-judge shelf capacity` prints three sections. First: per-shelf assignments (shelf name, game count, utilization, grade). Second: unfittable games (name, fitness, dimensions, reason). Third: displaced games (name, fitness, volume). In `--json` mode, returns the full `ShelfCapacityResult` object.

### Game Display Enrichment

- REQ-SHELF-42: The `GameWithScore` API response type (used by `GET /games`) includes box dimensions. Since `GameWithScore` already contains the full `Game` object and `Game` now has `boxDimensions`, no new field is needed on `GameWithScore` itself. Clients read `game.boxDimensions`.

## Implementation Layers

This spec covers significant scope across three connected concerns. The following layering supports clean implementation by independent agents:

**Layer 1: Box Dimensions (REQ-SHELF-1 through REQ-SHELF-13, REQ-SHELF-32, REQ-SHELF-42)**
Types, BGG parser extension, manual entry UI/CLI, game detail display. No dependencies on shelf config or overflow. Can be implemented and shipped independently.

**Layer 2: Shelf Configuration (REQ-SHELF-14 through REQ-SHELF-21, REQ-SHELF-33 through REQ-SHELF-35, REQ-SHELF-38 shelf-config commands)**
Data model, storage, CRUD API, web UI for shelf management, CLI commands for shelf setup. Depends on shared types only. Can be implemented in parallel with Layer 1.

**Layer 3: Capacity and Assignment (REQ-SHELF-22 through REQ-SHELF-31, REQ-SHELF-36 through REQ-SHELF-37, REQ-SHELF-40 through REQ-SHELF-41)**
Bin-packing algorithm integration, capacity endpoint, per-shelf assignments, collection page capacity indicator, capacity detail view, CLI capacity commands. Depends on both Layer 1 (box dimensions on games) and Layer 2 (shelf configuration). The bin-packing algorithm itself is defined in `.lore/designs/similarity-weighted-bin-packing.md`; this layer implements the adapter between Shelf Judge's data model and the algorithm's input/output.

## Scope Exclusions

- **Shelf neighbor relationships.** The brainstorm's `ShelfNeighbor` model (adjacent, same-room, different-room) is deferred. The bin-packing algorithm supports neighbor coherence scoring, but the shelf configuration data model in this spec does not include neighbor relationships. Neighbor weights in the algorithm config should be set to 0 until the neighbor model is added.
- **Spatial visualization.** No shelf rendering, no drag-and-drop. That is Proposal 5 scope.
- **Niche-aware shelf annotations.** No "your deck-building games are scattered" annotations. That is Proposal 6 scope. (The algorithm's similarity-based grouping achieves this implicitly through placement, but the annotations are a separate display concern.)
- **Manual assignment overrides.** The algorithm assigns games to shelves automatically. Users cannot manually override assignments in this spec. Manual overrides would map to the algorithm's "soft location override" concept and are a natural follow-up.
- **Box dimension sorting/filtering.** The collection page does not gain sort-by-volume or filter-by-size in this spec.
- **Estimation for missing dimensions.** Games without BGG version data and no manual entry have `null` dimensions. The system does not estimate box sizes. These games are excluded from the packing algorithm.
- **BGG version/edition selection.** The system takes the first version with complete dimensions. No UI for choosing which edition's dimensions to use.
- **Weight limits.** Physical weight of games is not considered. A shelf might hold 5 heavy games by volume but sag under their weight. This is too variable to model usefully.
- **Algorithm tuning UI.** The bin-packing algorithm has configurable weights (space vs. similarity vs. neighbor). This spec uses sensible defaults. A settings UI for tuning these weights is deferred.

## Exit Points

| Exit                      | Triggers When                                                    | Target                    |
| ------------------------- | ---------------------------------------------------------------- | ------------------------- |
| Shelf neighbors           | User wants to model spatial relationships between shelf units    | [STUB: shelf-neighbors]   |
| Manual assignment         | User wants to override the algorithm's game-to-shelf assignments | [STUB: manual-assignment] |
| Algorithm tuning          | User wants to adjust packing weights (space vs. similarity)      | [STUB: algorithm-tuning]  |
| Dimension-based filtering | User wants to sort/filter collection by box size                 | [STUB: dimension-filter]  |
| Edition selection         | User wants to pick which BGG edition's dimensions to use         | [STUB: edition-selection] |
| Shelf visualization       | User wants a visual representation of their shelves              | [STUB: shelf-visualizer]  |
| Niche shelf annotations   | User wants "your deck-building games are on shelf 3" display     | [STUB: niche-annotations] |

## Success Criteria

### Automated Tests (bun test)

**Box Dimensions:**

- [ ] Adding a game via BGG import populates `boxDimensions` when version data includes dimensions
- [ ] Adding a game via BGG import leaves `boxDimensions: null` when no version has complete dimensions
- [ ] BGG dimension values are converted from inches to centimeters
- [ ] BGG dimension values <= 0 or > 100 cm are rejected (treated as null)
- [ ] When multiple versions exist, the first with complete dimensions is used
- [ ] Manual dimension entry sets `source: "manual"` and overrides BGG values
- [ ] Partial manual dimensions (e.g., width without height) are rejected
- [ ] `--clear-box` CLI flag sets `boxDimensions` to `null`
- [ ] Refreshing BGG data for an existing game populates `boxDimensions` if previously null

**Shelf Configuration:**

- [ ] Creating a shelf unit with shelves persists to `shelf-config.json`
- [ ] Updating a shelf unit replaces its shelves correctly (add new, update existing, remove absent)
- [ ] Removing a shelf unit deletes it from the configuration
- [ ] Shelf dimension validation rejects width <= 0, depth <= 0, height <= 0 (but allows height null)
- [ ] Empty name is rejected for both units and shelves
- [ ] Full config PUT replaces the entire configuration

**Capacity (Bin-Packing):**

- [ ] A box that fits a shelf in any valid rotation is reported as fitting
- [ ] A box that exceeds all shelves in every orientation is reported as unfittable with a correct reason
- [ ] Unconstrained-height shelves allow any box height but still check width and depth
- [ ] Unconstrained-height shelves have `capacityCm3: null` and `utilization: null`
- [ ] `unfittableGames` is sorted by fitness ascending
- [ ] `overflowGames` contains only games displaced by the algorithm (not unfittable games)
- [ ] Per-shelf assignments list the games placed by the algorithm with correct utilization
- [ ] Games without dimensions are excluded from the packing algorithm and counted in `gamesWithoutDimensions`
- [ ] Capacity endpoint returns `configured: false` when no shelf units exist
- [ ] Capacity endpoint handles mixed dimensioned and undimensioned games correctly
- [ ] Algorithm similarity function uses composite distance from `feature-vector.ts`
- [ ] Shelf grades (S through F) are computed and included in per-shelf assignments

### Manual Verification

- [ ] Add a game with known BGG dimensions, verify "Box: W x H x D cm" appears on game detail page
- [ ] Manually edit box dimensions in the game edit form, verify they persist
- [ ] Create a shelf configuration with multiple units and shelves of different sizes
- [ ] Add an unconstrained-height shelf ("on top of"), verify it accepts any box height
- [ ] With a large-box game that exceeds all shelf widths, verify it appears in unfittable games with a clear reason
- [ ] With collection exceeding shelf capacity, verify capacity indicator shows overflow count on collection page
- [ ] Click through to capacity detail view, verify per-shelf assignments, unfittable games, and displaced games are shown
- [ ] Verify shelf grades (S through F) appear on each shelf in the capacity detail view
- [ ] CLI `shelf-judge shelf list` shows all units and shelves with dimensions
- [ ] CLI `shelf-judge shelf capacity` shows assignments, unfittable, and displaced sections

## AI Validation

**Defaults** (apply unless overridden):

- Unit tests with mocked time/network/filesystem
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom:**

- Verify BGG XML parser correctly handles the `<versions>` XML block structure (new parsing code, not a modification of existing item parsing)
- Verify all three Thing endpoint call sites in `bgg-client.ts` include `versions=1`
- Verify both web proxy route and CLI client helper are updated for all new endpoints (shelf config CRUD, overflow)
- Verify `Game` type change does not break existing serialization/deserialization (null default for new field)
- Test the rotation/fit check with edge cases: a box that fits only when rotated, a box that is exactly shelf-sized, a box 1mm too large
- Test capacity computation with a mix of dimensioned and undimensioned games, unfittable and fittable games, and both overflowing and non-overflowing scenarios
- Verify that shelves with `height: null` participate in the packing algorithm but report `null` for capacity and utilization
- Verify the algorithm's similarity function correctly uses composite distance and that games with similar niches cluster on the same shelf
- Verify displaced games (fittable by shape but crowded out) are correctly distinguished from unfittable games

## Constraints

- No modification to `FitnessResult`, `CollectionProfile`, `NichePosition`, or any collection-level computation type. Box dimensions, shelf config, and overflow are orthogonal to fitness scoring.
- The BGG `versions=1` parameter adds data to the API response but does not change the structure of existing fields. Existing parsing must not break.
- Shelf configuration storage follows the same atomic write pattern as all other storage files. The capacity endpoint computes results on demand (no cached capacity state).
- The capacity computation requires fitness scores for overflow ordering and the algorithm's similarity function requires feature vectors from the niche engine. If a game has no fitness score (no axes rated), it receives fitness 0 and is a natural cull candidate. If a game has no feature vector, its similarity to other games is 0 and it will be placed based on spatial fit alone.
- The bin-packing algorithm is defined in `.lore/designs/similarity-weighted-bin-packing.md`. Layer 3 implements an adapter between Shelf Judge's data model and the algorithm's generic item/bin interface. The algorithm module itself should be implemented as a standalone service with no Shelf Judge domain knowledge, accepting items and bins as inputs.
- Dimension display uses centimeters throughout. No unit conversion UI. Users in imperial-unit countries enter centimeters.

## Known Flaws (2026-04-12 review, reconciled 2026-04-12)

The original spec had structural problems in Layer 3 (overflow computation). Most were resolved by adopting the similarity-weighted bin-packing algorithm (`.lore/designs/similarity-weighted-bin-packing.md`) as the computation engine. Resolution status for each flaw:

### Flaw 1: Volume pooling. **Resolved.**

The original spec defined `overflowing` as `totalCollectionCm3 > totalCapacityCm3`, which pooled volume across mismatched shelves. The algorithm doesn't pool volume. It assigns games to specific shelves with per-bin spatial tracking. Overflow is now determined by algorithm output: games that the packing algorithm couldn't place. No aggregate volume comparison exists in the revised spec.

### Flaw 2: No game-to-shelf assignment. **Resolved.**

The original spec deferred assignment. The bin-packing algorithm IS an assignment algorithm. The revised `ShelfCapacityResult` includes per-shelf `assignments` showing which games the algorithm placed where. The overflow list is Phase 4 output: games that fit somewhere by shape but were displaced by higher-priority games.

### Flaw 3: `perShelfUtilization` was fictional. **Resolved.**

The original `ShelfUtilization` type promised utilization but could only deliver theoretical fit counts. The revised `ShelfAssignment` type has concrete data: actual assigned games, real `usedCm3`, and computed `utilization` ratios. The algorithm also provides per-shelf `grade` ratings.

### Flaw 4: Unconstrained-height shelves created a display gap. **Resolved.**

The original spec excluded unconstrained-height shelves from volume totals, making the "72% full" display misleading. The revised spec avoids aggregate volume percentages entirely. Unconstrained-height shelves participate in the packing algorithm (games are assigned to them) and report their contents, but show `null` for capacity and utilization. The collection page indicator reports placement counts ("All N games placed" or "M games couldn't be placed"), not volume percentages.

### Flaw 5: BGG `versions=1` response structure is unverified. **Unresolved.**

This flaw is unrelated to the overflow computation. REQ-SHELF-6 still prescribes a parser for a response format that hasn't been confirmed against actual BGG output. Implementation must inspect real BGG responses before committing to the parser. The risk is low (the format is plausible) but the spec should not claim certainty about an unverified structure.

### Flaw 6: Refresh vs. manual override interaction is unspecified. **Unresolved.**

This flaw is unrelated to the overflow computation. The interaction between REQ-SHELF-10 (refresh populates dimensions) and REQ-SHELF-11 (manual overrides BGG) still needs an explicit statement. Recommended resolution: refresh should NOT overwrite `source: "manual"` dimensions. If the user manually measured a box, that measurement should survive a BGG refresh. The refresh should only populate dimensions when `boxDimensions` is `null` or `source` is `"bgg"`.

### Flaw 7: Spec may be overcomplicated. **Partially resolved.**

The bin-packing algorithm simplifies the spec by replacing the hand-built overflow logic (volume pooling, cumulative freed volume, `wouldResolveOverflow` markers) with "run the packer, report results." The three-category output (assigned, unfittable, displaced) is cleaner than the original two-category model (unfittable + volume overflow). However, the algorithm itself is substantial machinery. Whether this is overcomplication or appropriate complexity depends on whether the similarity-based grouping adds value for the user. The algorithm can be configured to weight space heavily and similarity lightly for a simpler initial experience.

## Context

- [Brainstorm: Shelf Layout Designer](.lore/brainstorms/shelf-layout-designer.md): Proposals 1, 2, and 4, with resolved open questions. The brainstorm confirms box dimensions are load-bearing for capacity math, that the user's collection exceeds shelf capacity as a default state, and that shape-fitting matters more than volume totals (Kallax cubes vs. long vintage boxes).
- [Design: Similarity-Weighted 3D Bin Packing](.lore/designs/similarity-weighted-bin-packing.md): The algorithm that drives Layer 3. Defines item rotation, fitness functions, the four-phase packing algorithm, and post-packing grading. The spec adapts this algorithm's input/output to Shelf Judge's data model. The algorithm design stands on its own and should not be modified as part of this spec's implementation.
- [Issue: Shelf Layout Designer](.lore/issues/shelf-layout-designer.md): Original three-sentence idea.
- [Vision](.lore/vision.md): Principle 5 ("the shelf has a carrying capacity") directly supports this feature. The capacity result connects physical reality to the curation question without making removal decisions for the user.
- [BGG API Research](.lore/research/bgg-api.md): Documents `versions=1` as an optional enrichment parameter. The response structure for version data is not documented in the research; implementation will need to inspect actual BGG responses.
- [Data Model Design](.lore/designs/mvp-data-model.md): Current `Game` type has no dimension fields. The `boxDimensions` addition is an additive change.
