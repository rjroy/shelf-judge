---
title: "Shelf Capacity (Box Dimensions, Shelf Config, Overflow)"
date: 2026-04-12
status: draft # FLAWED - see "Known Flaws" section before implementing
tags: [spec, shelf-layout, box-dimensions, shelf-config, capacity, overflow, curation, bgg-versions]
modules: [shared, daemon, web, cli]
req-prefix: SHELF
related:
  - .lore/brainstorms/shelf-layout-designer.md
  - .lore/issues/shelf-layout-designer.md
  - .lore/vision.md
  - .lore/designs/mvp-data-model.md
  - .lore/research/bgg-api.md
---

# Spec: Shelf Capacity (Box Dimensions, Shelf Config, Overflow)

## Overview

This spec covers three connected layers of the shelf layout designer: storing physical box dimensions per game (brainstorm Proposal 1), modeling the user's shelf configuration (a minimal cut of brainstorm Proposal 2), and computing shelf capacity overflow (brainstorm Proposal 4).

The core curation question is "do I have space, and if not, what goes?" But that question is meaningless without shape. A single total-volume number fails because the constraint isn't cubic centimeters, it's whether a box physically fits on a shelf. A 25-inch vintage game box doesn't fit in a 14-inch Kallax cube regardless of how much total volume remains. The overflow calculation must check each game against individual shelf dimensions.

This requires three things: knowing each game's box size, knowing each shelf's interior dimensions, and comparing the two per-shelf to find games that don't fit anywhere.

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

- REQ-SHELF-22: A game "fits" on a shelf if its box can be oriented so that the box dimensions fit within the shelf dimensions. The system checks all six orientations of the box (three axis-aligned rotations, each with two flips). For each orientation, the three box dimensions are compared against shelf width, height, and depth. If the shelf's height is null (unconstrained), only width and depth are checked. A game fits a shelf if at least one orientation fits.

- REQ-SHELF-23: A game "fits the configuration" if it fits on at least one shelf in any unit. A game that fits no shelf is "unfittable" - it physically cannot be stored in the user's current shelf setup.

- REQ-SHELF-24: The daemon provides an overflow endpoint:

| Operation ID     | Method | Path                  | Description               |
| ---------------- | ------ | --------------------- | ------------------------- |
| `shelf.overflow` | GET    | `/api/shelf/overflow` | Compute capacity overflow |

- REQ-SHELF-25: The overflow response shape:

```typescript
interface ShelfOverflow {
  configured: boolean; // true if at least one shelf exists
  totalShelfCount: number; // total number of shelves across all units
  totalCapacityCm3: number; // sum of all shelf volumes (null-height shelves excluded from volume)
  totalCollectionCm3: number; // sum of known game volumes
  gamesWithDimensions: number; // count of games with boxDimensions
  gamesWithoutDimensions: number; // count of games with boxDimensions: null
  unfittableGames: UnfittableEntry[]; // games that fit NO shelf
  perShelfUtilization: ShelfUtilization[]; // per-shelf capacity summary
  overflowing: boolean; // totalCollectionCm3 > totalCapacityCm3 (volume overflow)
  overflowList: OverflowEntry[] | null; // null when not overflowing (volume)
}

interface UnfittableEntry {
  gameId: string;
  gameName: string;
  fitnessScore: number;
  boxDimensions: BoxDimensions;
  reason: string; // e.g., "Box is 63 x 10 x 10 cm; widest shelf is 36 cm"
}

interface ShelfUtilization {
  shelfId: string;
  shelfName: string;
  unitName: string;
  capacityCm3: number | null; // null for unconstrained-height shelves
  fittableGameCount: number; // how many games COULD fit on this shelf (by shape)
}

interface OverflowEntry {
  gameId: string;
  gameName: string;
  fitnessScore: number; // current fitness score (0 if vetoed)
  volumeCm3: number; // this game's box volume
  cumulativeFreedCm3: number; // running total if this game and all above it were removed
  wouldResolveOverflow: boolean; // true if cumulativeFreedCm3 >= overflow amount
}
```

- REQ-SHELF-26: The `unfittableGames` list contains every game with known dimensions that fits no shelf in the configuration. These are the strongest cull candidates: they literally cannot be stored. The list is sorted by fitness ascending (lowest fitness first). The `reason` field is a human-readable explanation of why the game doesn't fit (e.g., which dimension exceeds all available shelves).

- REQ-SHELF-27: The `overflowList` addresses volume overflow separately from shape overflow. Even after removing unfittable games, the remaining games may exceed total shelf volume. The overflow list is ordered by fitness ascending and includes games with known dimensions that DO fit at least one shelf. It shows which lowest-fitness fittable games would need to be removed to bring volume under capacity. The list includes entries up to and including the first entry where `wouldResolveOverflow` is true, plus up to 3 additional entries. If no combination resolves the overflow, the entire list of fittable dimensioned games is returned.

- REQ-SHELF-28: Shelves with `height: null` (unconstrained) are excluded from the `totalCapacityCm3` sum because their volume is undefined. They still participate in shape-fitting: a game can fit on an unconstrained shelf if its width and depth fit. This means "on top of" spaces contribute to answering "can this game be stored?" without contributing to the volume math.

- REQ-SHELF-29: When no shelf configuration exists (no units), the overflow endpoint returns a valid response with `configured: false` and empty/zero values. No 400 error. The UI uses `configured` to show a "configure your shelves" prompt.

- REQ-SHELF-30: When no games have box dimensions, the overflow endpoint returns a valid response with `gamesWithDimensions: 0`, `overflowing: false`, `unfittableGames: []`, and `overflowList: null`.

- REQ-SHELF-31: The overflow computation uses current fitness scores. It does not cache or snapshot scores. Each call recomputes against the current collection state.

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

### Web UI: Overflow Display

- REQ-SHELF-36: The collection page gains a capacity indicator when shelves are configured and at least one game has dimensions. The indicator shows:
  - When not overflowing and no unfittable games: "Shelf: 72% full (145L of 200L)" using liters (cm3 / 1000) for readability.
  - When overflowing: "Shelf: 112% full (224L of 200L), 24L over capacity" with visual emphasis (warning color).
  - When unfittable games exist: "N games don't fit any shelf" as a separate warning, regardless of volume overflow.
  - When configured but no games have dimensions: "Shelves configured, but no game dimensions available."

- REQ-SHELF-37: When there are unfittable games or volume overflow, the collection page shows a link to an overflow detail view. This view displays:
  - **Unfittable games section** (if any): games that fit no shelf, sorted by fitness ascending, with the reason each doesn't fit.
  - **Volume overflow section** (if overflowing): the overflow list from REQ-SHELF-27, showing game name, fitness score, box volume, cumulative freed volume, and a marker on the row that would resolve volume overflow.
  - **Dimension coverage note**: "N games have no box dimensions and are excluded from this calculation. [Add dimensions]" with a link to filter the collection to games without dimensions.

This can be a dedicated sub-page, a modal, or a section on the collection page.

### CLI

- REQ-SHELF-38: New CLI commands:

| Command                                                                 | Description                                          |
| ----------------------------------------------------------------------- | ---------------------------------------------------- |
| `shelf-judge shelf status`                                              | Show shelf config summary, capacity, overflow        |
| `shelf-judge shelf add-unit <name>`                                     | Add a shelf unit                                     |
| `shelf-judge shelf add-shelf <unit-id> <name> <width> <height> <depth>` | Add a shelf to a unit (height=0 for unconstrained)   |
| `shelf-judge shelf remove-unit <unit-id>`                               | Remove a shelf unit                                  |
| `shelf-judge shelf remove-shelf <shelf-id>`                             | Remove a shelf                                       |
| `shelf-judge shelf list`                                                | List all units and shelves                           |
| `shelf-judge shelf overflow`                                            | Show overflow details (unfittable + volume overflow) |

- REQ-SHELF-39: `shelf-judge shelf add-shelf` accepts height=0 as a convention for "unconstrained height" (stored as `null`). This avoids optional positional arguments.

- REQ-SHELF-40: `shelf-judge shelf status` output:

```
Shelf Configuration: 3 units, 14 shelves (2 unconstrained-height)
Total Capacity: 200.0L (excluding unconstrained shelves)
Collection Volume: 224.3L (87 of 94 games measured)
Volume Status: OVER CAPACITY by 24.3L
Unfittable Games: 3 (don't fit any shelf)
```

Or when not overflowing:

```
Shelf Configuration: 3 units, 14 shelves (2 unconstrained-height)
Total Capacity: 200.0L (excluding unconstrained shelves)
Collection Volume: 145.2L (87 of 94 games measured)
Volume Status: 54.8L remaining (72% full)
Unfittable Games: 0
```

- REQ-SHELF-41: `shelf-judge shelf overflow` prints two sections. First: unfittable games (name, fitness, dimensions, reason). Second: volume overflow list (rank, name, fitness, volume, cumulative freed, resolution marker). In `--json` mode, returns the full `ShelfOverflow` object.

### Game Display Enrichment

- REQ-SHELF-42: The `GameWithScore` API response type (used by `GET /games`) includes box dimensions. Since `GameWithScore` already contains the full `Game` object and `Game` now has `boxDimensions`, no new field is needed on `GameWithScore` itself. Clients read `game.boxDimensions`.

## Implementation Layers

This spec covers significant scope across three connected concerns. The following layering supports clean implementation by independent agents:

**Layer 1: Box Dimensions (REQ-SHELF-1 through REQ-SHELF-13, REQ-SHELF-32, REQ-SHELF-42)**
Types, BGG parser extension, manual entry UI/CLI, game detail display. No dependencies on shelf config or overflow. Can be implemented and shipped independently.

**Layer 2: Shelf Configuration (REQ-SHELF-14 through REQ-SHELF-21, REQ-SHELF-33 through REQ-SHELF-35, REQ-SHELF-38 shelf-config commands)**
Data model, storage, CRUD API, web UI for shelf management, CLI commands for shelf setup. Depends on shared types only. Can be implemented in parallel with Layer 1.

**Layer 3: Overflow Computation (REQ-SHELF-22 through REQ-SHELF-31, REQ-SHELF-36 through REQ-SHELF-37, REQ-SHELF-40 through REQ-SHELF-41)**
Fit-checking algorithm, overflow endpoint, collection page indicator, overflow detail view, CLI overflow commands. Depends on both Layer 1 (box dimensions on games) and Layer 2 (shelf configuration).

## Scope Exclusions

- **Shelf neighbor relationships.** The brainstorm's `ShelfNeighbor` model (adjacent, same-room, different-room) is deferred. It matters for similarity-aware shelf assignment (Proposal 3/6) but not for capacity overflow. Neighbor relationships have no effect on "does this box fit."
- **Game-to-shelf assignment.** No tracking of which game lives on which shelf. Games have dimensions; shelves have dimensions; the system checks fit. Which game goes where is Proposal 3 scope.
- **Spatial visualization.** No shelf rendering, no drag-and-drop. That is Proposal 5 scope.
- **Niche-aware shelf annotations.** No "your deck-building games are scattered" annotations. That is Proposal 6 scope.
- **Box dimension sorting/filtering.** The collection page does not gain sort-by-volume or filter-by-size in this spec.
- **Estimation for missing dimensions.** Games without BGG version data and no manual entry have `null` dimensions. The system does not estimate box sizes.
- **BGG version/edition selection.** The system takes the first version with complete dimensions. No UI for choosing which edition's dimensions to use.
- **Optimal packing.** The overflow calculation checks whether a game CAN fit on a shelf, not whether all games fit simultaneously. True bin-packing (assigning games to specific shelves to maximize utilization) is Proposal 3 scope.
- **Weight limits.** Physical weight of games is not considered. A shelf might hold 5 heavy games by volume but sag under their weight. This is too variable to model usefully.

## Exit Points

| Exit                      | Triggers When                                                 | Target                    |
| ------------------------- | ------------------------------------------------------------- | ------------------------- |
| Shelf neighbors           | User wants to model spatial relationships between shelf units | [STUB: shelf-neighbors]   |
| Shelf assignment          | User wants to assign games to specific shelves                | [STUB: shelf-assignment]  |
| Dimension-based filtering | User wants to sort/filter collection by box size              | [STUB: dimension-filter]  |
| Edition selection         | User wants to pick which BGG edition's dimensions to use      | [STUB: edition-selection] |
| Shelf visualization       | User wants a visual representation of their shelves           | [STUB: shelf-visualizer]  |

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

**Overflow Computation:**

- [ ] A box that fits a shelf in any of the six orientations is reported as fitting
- [ ] A box that exceeds all shelves in every orientation is reported as unfittable with a correct reason
- [ ] Unconstrained-height shelves allow any box height but still check width and depth
- [ ] Unconstrained-height shelves are excluded from `totalCapacityCm3`
- [ ] `unfittableGames` is sorted by fitness ascending
- [ ] Volume overflow list includes only fittable games, sorted by fitness ascending
- [ ] `wouldResolveOverflow` is true on the correct entry
- [ ] `cumulativeFreedCm3` is a running total
- [ ] Games without dimensions are excluded from all overflow calculations
- [ ] Overflow endpoint returns `configured: false` when no shelf units exist
- [ ] Overflow endpoint handles mixed dimensioned and undimensioned games correctly

### Manual Verification

- [ ] Add a game with known BGG dimensions, verify "Box: W x H x D cm" appears on game detail page
- [ ] Manually edit box dimensions in the game edit form, verify they persist
- [ ] Create a shelf configuration with multiple units and shelves of different sizes
- [ ] Add an unconstrained-height shelf ("on top of"), verify it accepts any box height
- [ ] With a large-box game that exceeds all shelf widths, verify it appears in unfittable games with a clear reason
- [ ] With collection exceeding shelf capacity, verify capacity indicator shows overflow on collection page
- [ ] Click through to overflow detail view, verify unfittable games and volume overflow are both shown
- [ ] CLI `shelf-judge shelf list` shows all units and shelves with dimensions
- [ ] CLI `shelf-judge shelf overflow` shows unfittable and overflow sections

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
- Test the six-orientation fit check with edge cases: a box that fits only when rotated, a box that is exactly shelf-sized, a box 1mm too large
- Test overflow calculation with a mix of dimensioned and undimensioned games, unfittable and fittable games, and both volume overflow and no-overflow scenarios
- Verify that shelves with `height: null` participate in fit-checking but not in volume totals

## Constraints

- No modification to `FitnessResult`, `CollectionProfile`, `NichePosition`, or any collection-level computation type. Box dimensions, shelf config, and overflow are orthogonal to fitness scoring.
- The BGG `versions=1` parameter adds data to the API response but does not change the structure of existing fields. Existing parsing must not break.
- Shelf configuration and overflow storage follow the same atomic write pattern as all other storage files.
- The overflow list requires fitness scores, which means it depends on the fitness computation pipeline. If a game has no fitness score (no axes rated), it appears at the bottom of the overflow list (fitness 0) and is a natural cull candidate.
- Dimension display uses centimeters throughout. No unit conversion UI. Users in imperial-unit countries enter centimeters.

## Known Flaws (2026-04-12 review)

This spec has structural problems that need resolution before implementation. They are documented here so the next session can address them with fresh context, potentially informed by the user's prior implementation of this feature.

### Flaw 1: The volume overflow calculation contradicts the spec's own premise

The overview argues that a single total-volume number fails because shape matters: "A 25-inch vintage game box doesn't fit in a 14-inch Kallax cube regardless of how much total volume remains." The spec then introduces per-shelf dimensions and a shape-aware unfittable check to solve this. But `overflowing` (REQ-SHELF-25) is defined as `totalCollectionCm3 > totalCapacityCm3`, which is exactly the pooled-volume comparison the overview just argued against.

Volume from mismatched shelves is pooled. A game that only fits the bookcase gets its volume credited against Kallax capacity. The system can report "not overflowing" when every individual shelf is actually full, because volume from shelves where the game can't fit is counted as available space.

The unfittable check is clean and self-contained. The volume overflow is not. It produces numbers that are misleading in exactly the way the spec says a single-volume number would be.

### Flaw 2: No game-to-shelf assignment makes the overflow list fictional

The overflow list (REQ-SHELF-27) shows "which lowest-fitness fittable games would need to be removed to bring volume under capacity." But without knowing which games are on which shelves, the system treats the entire collection as simultaneously occupying all shelf space. A game sitting in a box in the garage counts against shelf capacity. A game the user hasn't placed yet counts. The overflow list answers "if your entire collection were somehow distributed across your shelves, you'd be over by X liters" which is not the same question as "your shelves are full."

The spec explicitly defers assignment to a stub (shelf-assignment). But the overflow calculation implicitly assumes assignment (all games are assigned to all shelves) without acknowledging it.

### Flaw 3: `perShelfUtilization` cannot be computed without assignment

The `ShelfUtilization` type in REQ-SHELF-25 has `fittableGameCount` (how many games could fit by shape) and `capacityCm3`. Without assignment, there is no way to know how full any individual shelf is. The field name promises utilization but can only deliver capacity and a theoretical shape-fit count. An implementer will have to invent what this field means.

### Flaw 4: Unconstrained-height shelves create a display gap

REQ-SHELF-28 excludes unconstrained-height shelves from `totalCapacityCm3` because their volume is undefined. But REQ-SHELF-36 shows "72% full (145L of 200L)" which uses `totalCapacityCm3` as the denominator. If a significant portion of the user's storage is "on top of" spaces, the capacity number excludes where their oversized games actually live. The percentage is misleading.

### Flaw 5: BGG `versions=1` response structure is unverified

REQ-SHELF-6 describes the expected XML structure (`<width value="..."/>`, `<length value="..."/>`, `<depth value="..."/>`) but the BGG API research doc doesn't document this structure, and the brainstorm's description is sourced from its own investigation, not from verified API responses. The spec is prescribing a parser for a response format that hasn't been confirmed against actual BGG output. Units (inches vs. cm vs. unspecified) are assumed, not verified.

### Flaw 6: Refresh vs. manual override interaction is unspecified

REQ-SHELF-10 says refreshing BGG data "MUST also populate `boxDimensions`." REQ-SHELF-11 says manual values override BGG values. But if a user manually sets dimensions and then refreshes BGG data, does the refresh overwrite the manual entry? The spec implies no (manual overrides BGG) but doesn't state what happens during an active refresh action. A refresh is user-initiated, not passive import. The behavior needs an explicit statement.

### Flaw 7: The spec may be overcomplicated

The user has implemented this feature before and observed that this spec is "either currently over complicating this or not trying hard enough." The three-layer approach (box dimensions + shelf config + overflow) with full CRUD APIs, shape-fitting algorithms, and two overflow categories (unfittable + volume) may be solving a harder problem than the user's prior implementation required. The prior implementation may have found a simpler model that worked. This spec was written without reference to that prior work.

### What works

The unfittable-games check (REQ-SHELF-22 through REQ-SHELF-26) is the one genuinely self-contained overflow output. Given box dimensions and shelf dimensions, "does this game fit anywhere?" has a crisp yes/no answer that doesn't require assignment. The box dimensions layer (REQ-SHELF-1 through REQ-SHELF-13) is clean and independent. The shelf configuration data model (REQ-SHELF-14 through REQ-SHELF-21) is reasonable for what it describes. The problems are in how the overflow calculation uses these inputs.

## Context

- [Brainstorm: Shelf Layout Designer](.lore/brainstorms/shelf-layout-designer.md): Proposals 1, 2, and 4, with resolved open questions. The brainstorm confirms box dimensions are load-bearing for capacity math, that the user's collection exceeds shelf capacity as a default state, and that shape-fitting matters more than volume totals (Kallax cubes vs. long vintage boxes).
- [Issue: Shelf Layout Designer](.lore/issues/shelf-layout-designer.md): Original three-sentence idea.
- [Vision](.lore/vision.md): Principle 5 ("the shelf has a carrying capacity") directly supports this feature. The overflow list connects physical reality to the curation question without making removal decisions for the user.
- [BGG API Research](.lore/research/bgg-api.md): Documents `versions=1` as an optional enrichment parameter. The response structure for version data is not documented in the research; implementation will need to inspect actual BGG responses.
- [Data Model Design](.lore/designs/mvp-data-model.md): Current `Game` type has no dimension fields. The `boxDimensions` addition is an additive change.
