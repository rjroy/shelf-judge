---
title: "Implementation plan: shelf capacity"
date: 2026-04-13
status: draft
tags: [plan, shelf-layout, box-dimensions, shelf-config, capacity, overflow, bin-packing, algorithm]
modules: [shared, daemon, web, cli]
related:
  - .lore/specs/shelf-capacity.md
  - .lore/designs/similarity-weighted-bin-packing.md
  - .lore/mockups/mockup-shelf-game-dimensions.html
  - .lore/mockups/mockup-shelf-configuration.html
  - .lore/mockups/mockup-shelf-capacity-indicator.html
  - .lore/mockups/mockup-shelf-capacity-detail.html
  - .lore/mockups/mockup-shelf-capacity-detail-empty.html
---

# Plan: Shelf Capacity

## Goal

Implement the shelf capacity feature specified in `.lore/specs/shelf-capacity.md` (REQ-SHELF-1 through REQ-SHELF-36). Three connected layers: box dimensions on games, shelf configuration as a separate storage entity, and a bin-packing-driven capacity computation that tells users what fits, what doesn't, and where to cull.

The bin-packing algorithm (`.lore/designs/similarity-weighted-bin-packing.md`) is implemented as a standalone module with no Shelf Judge domain knowledge. Layer 3 builds an adapter between the project's data model and the algorithm's generic item/bin interface.

## Codebase Context

### Game Type and Game Service

`Game` is defined at `types.ts:49-64`. It has no `boxDimensions` field. `GameService` at `game-service.ts:41-54` defines the interface; `addGame` builds games at lines 98-144, setting every field explicitly. The `setOwnership` method at line 50 shows the pattern for adding a field-mutation method that loads the collection, finds the game, updates it, and saves.

Game edit in the web UI happens through `RatingForm` on the game detail page at `app/games/[id]/page.tsx`. The current form handles only ratings. Box dimensions need a separate form section or component on the same page.

### Storage Pattern

`StorageService` at `storage-service.ts:22-39` defines load/save pairs for each data file. Settings files (`prediction-settings.json`, `niche-settings.json`, `redundancy-settings.json`, `wishlist.json`) each follow the same pattern: file path in data dir, return defaults when missing, `atomicWrite` on save. Shelf configuration (`shelf-config.json`) follows this pattern with `ShelfConfiguration` as the type.

### Route Patterns

`routes/games.ts:107` creates routes via `createGameRoutes`. Each route module exports a `RouteModule` with `routes` (Hono instance) and `operations` (OperationDefinition[]). The app wires them at `app.ts:60-76`. The redundancy routes at `routes/redundancy.ts` show the settings-CRUD pattern closest to what shelf config needs.

### Feature Vector (Similarity Function)

`feature-vector.ts` exports `compositeDistance(a, b, weights)` returning `ComponentDistances` with a `composite` field in [0,1] where 0 is identical. The algorithm's similarity function needs `compare(a, b) -> [0,1]` where 1 is identical. The adapter inverts: `similarity = 1 - compositeDistance.composite`.

The adapter must pre-encode all games into `FeatureVector` objects before passing to the algorithm. This requires `buildVocabulary`, `computeContinuousRanges`, and `encodeGame` from the same module. The existing `applyRedundancy` helper at `routes/games.ts:61-96` shows this exact pattern: build vocabulary and ranges from the collection, then encode games per-request.

### Web UI Patterns

Settings pages: `app/redundancy/page.tsx` is a client component that fetches settings on mount, tracks dirty state, and saves via PATCH. The shelf configuration page follows this pattern but with a more complex form (multiple shelf units, each with multiple shelves).

Collection page: `app/collection/page.tsx` is a server component. The capacity indicator will be a section within this page, fetched server-side alongside the game list. The capacity detail view is a new page at `/capacity` or `/shelves/capacity`.

Sidebar navigation: `components/sidebar.tsx` defines `navGroups` as a static array. The shelf config page goes in the "Settings" group or a new "Shelves" group.

### CLI Command Pattern

`packages/cli/src/commands/redundancy.ts` shows the settings-command pattern: export async functions taking `(client, args, opts)`, returning formatted strings. The `shelf` command group follows this pattern with subcommands for config CRUD and capacity display.

## Implementation Steps

### Phase 1: Shared Types (Box Dimensions + Shelf Config)

**Files**: `packages/shared/src/types.ts`
**Depends on**: nothing
**Covers**: REQ-SHELF-1, REQ-SHELF-2, REQ-SHELF-3, REQ-SHELF-8, REQ-SHELF-9, REQ-SHELF-10

Add after the wishlist types (line 537):

```typescript
// Shelf capacity types (shelf-capacity spec)

export interface BoxDimensions {
  width: number; // in
  height: number; // in
  depth: number; // in
}

export interface Shelf {
  id: string;
  name: string;
  width: number; // interior in
  height: number | null; // interior in, null = unconstrained
  depth: number; // interior in
}

export interface ShelfUnit {
  id: string;
  name: string;
  shelves: Shelf[]; // ordered top-to-bottom
}

export interface ShelfConfiguration {
  units: ShelfUnit[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

Add `boxDimensions` to the `Game` interface (after `ownership` at line 60):

```typescript
boxDimensions: BoxDimensions | null;
```

This is an additive, non-breaking change. Default is `null` (no dimensions known).

**Verification**: `bun run typecheck` passes. Every `Game` construction site needs the new field. `addGame` in `game-service.ts` sets it to `null`. The backfill in `storage-service.ts:123-127` (the ownership backfill pattern) needs a parallel backfill for `boxDimensions`.

### Phase 2: Box Dimensions Daemon (Storage + API)

**Files**: `packages/daemon/src/services/game-service.ts`, `packages/daemon/src/services/storage-service.ts`, `packages/daemon/src/routes/games.ts`
**Depends on**: Phase 1
**Covers**: REQ-SHELF-3, REQ-SHELF-4, REQ-SHELF-5, REQ-SHELF-6, REQ-SHELF-7, REQ-SHELF-36

**2a: Storage backfill.** In `storage-service.ts:loadCollection()`, add a backfill for `boxDimensions` alongside the ownership backfill at line 123:

```typescript
if (game.boxDimensions === undefined) {
  game.boxDimensions = null;
}
```

**2b: Game service.** The existing `rateGame` route handler at `routes/games.ts` (PUT `/games/:id/ratings`) is the closest pattern. Box dimensions update uses the same approach: load collection, find game, validate, update, save. Add box dimension handling to the existing game update flow. Two options:

Option A: Extend the existing PUT `/games/:id/ratings` to accept an optional `boxDimensions` field alongside `ratings`. This keeps one update endpoint.

Option B: Add a new PUT `/games/:id/dimensions` endpoint. This is cleaner separation.

Decision: Option B. Dimensions and ratings are different concerns with different validation rules. A dedicated endpoint is clearer for both web and CLI clients.

**2c: Dimension validation.** Zod schema for the request body:

```typescript
const BoxDimensionsSchema = z.object({
  width: z.number().gt(0).lte(40),
  height: z.number().gt(0).lte(40),
  depth: z.number().gt(0).lte(40),
});

const SetDimensionsBodySchema = z.union([
  BoxDimensionsSchema,
  z.object({ clear: z.literal(true) }),
]);
```

When `clear: true`, set `boxDimensions` to `null`. Otherwise, all three dimensions are required and must be > 0 and <= 40 (spec says "values <= 0 or > 40 in" are rejected).

**2d: Route.** Add `PUT /games/:id/dimensions` to `routes/games.ts`:

```typescript
// PUT /games/:id/dimensions
routes.put("/games/:id/dimensions", async (c) => {
  // Parse body, validate, update game.boxDimensions, save
});
```

Return `{ game }` on success (200), `{ error }` on 400/404.

**2e: Operation definition.** Add to the operations array:

```typescript
{
  operationId: "shelf.game.dimensions",
  name: "set-dimensions",
  description: "Set or clear box dimensions for a game",
  invocation: { method: "PUT", path: "/api/games/:id/dimensions" },
  hierarchy: { root: "shelf", feature: "game" },
  parameters: [{ name: "id", in: "path", description: "Game ID", required: true }],
  idempotent: true,
}
```

**Verification**: Tests in new or existing game route test file:

- PUT with valid dimensions persists all three values
- PUT with `clear: true` sets `boxDimensions` to `null`
- PUT with partial dimensions (width only) returns 400
- PUT with dimensions <= 0 returns 400
- PUT with dimensions > 40 returns 400
- GET /games/:id includes `boxDimensions` in response
- Legacy games without `boxDimensions` load as `null`

### Phase 3: Shelf Configuration Storage + Service

**Files**: `packages/daemon/src/services/storage-service.ts`, new file `packages/daemon/src/services/shelf-service.ts`
**Depends on**: Phase 1
**Covers**: REQ-SHELF-11, REQ-SHELF-12, REQ-SHELF-14, REQ-SHELF-15

**3a: Storage interface.** Add to `StorageService` interface (after `saveWishlist` at line 38):

```typescript
loadShelfConfig(): Promise<ShelfConfiguration>;
saveShelfConfig(config: ShelfConfiguration): Promise<void>;
```

**3b: Storage implementation.** In `createStorageService`, add methods:

- File: `shelf-config.json` in the data directory
- Load returns empty config `{ units: [], createdAt: now, updatedAt: now }` when file doesn't exist
- Save writes via `atomicWrite`

**3c: Shelf service.** Create `packages/daemon/src/services/shelf-service.ts`:

```typescript
export interface ShelfService {
  getConfig(): Promise<ShelfConfiguration>;
  setConfig(units: ShelfUnit[]): Promise<ShelfConfiguration>;
  addUnit(input: { name: string; shelves: ShelfInput[] }): Promise<ShelfUnit>;
  updateUnit(id: string, input: { name?: string; shelves?: ShelfInput[] }): Promise<ShelfUnit>;
  removeUnit(id: string): Promise<void>;
}
```

`ShelfInput` is `Omit<Shelf, "id"> & { id?: string }` (shelves with optional id for the update-or-create semantics in REQ-SHELF-14).

The service handles:

- UUID generation for new units and shelves
- Validation (name non-empty, width > 0, depth > 0, height > 0 or null)
- The update semantics: shelves with `id` are updated, without `id` are added, absent shelves are removed
- Timestamp management (`createdAt` on first write, `updatedAt` on every write)

**Verification**: Unit tests in `packages/daemon/tests/shelf-service.test.ts`:

- Creating a shelf unit persists to storage
- Updating a unit's shelves: add new, update existing, remove absent
- Removing a unit deletes it
- Shelf validation: width <= 0 rejected, depth <= 0 rejected, height <= 0 rejected, height null accepted
- Empty name rejected for units and shelves
- Full config PUT replaces entire configuration
- Empty config has zero units

### Phase 4: Shelf Configuration Daemon Routes

**Files**: new file `packages/daemon/src/routes/shelf.ts`, `packages/daemon/src/app.ts`
**Depends on**: Phase 3
**Covers**: REQ-SHELF-13, REQ-SHELF-14, REQ-SHELF-15

**4a: Route module.** Create `packages/daemon/src/routes/shelf.ts` with five endpoints per REQ-SHELF-13:

| Method | Path               | Handler                              |
| ------ | ------------------ | ------------------------------------ |
| GET    | `/shelf/config`    | `shelfService.getConfig()`           |
| PUT    | `/shelf/config`    | `shelfService.setConfig(body.units)` |
| POST   | `/shelf/units`     | `shelfService.addUnit(body)`         |
| PUT    | `/shelf/units/:id` | `shelfService.updateUnit(id, body)`  |
| DELETE | `/shelf/units/:id` | `shelfService.removeUnit(id)`        |

Response shapes match REQ-SHELF-14 exactly.

**4b: App wiring.** In `app.ts`:

```typescript
import { createShelfRoutes } from "./routes/shelf.js";
import { createShelfService } from "./services/shelf-service.js";

const shelfService = createShelfService({ storageService });
const shelfRouteModule = createShelfRoutes({ shelfService });
```

Wire: `app.route("/api", shelfRouteModule.routes)`.

**4c: Operation definitions.** Five entries with `hierarchy: { root: "shelf", feature: "config" }`.

**Verification**: Route tests in `packages/daemon/tests/shelf-routes.test.ts`:

- GET returns empty config when no file exists
- PUT replaces entire config, returns updated config
- POST adds unit with generated IDs, returns 201
- PUT /units/:id updates name and shelves
- PUT /units/:id with new shelves (no id) adds them
- PUT /units/:id without existing shelves removes them
- DELETE /units/:id removes unit
- DELETE /units/:id with nonexistent ID returns 404
- Validation errors return 400 with descriptive messages

### Phase 5: Box Dimensions Web UI + CLI

**Files**: `packages/web/app/games/[id]/page.tsx`, `packages/web/lib/api.ts`, `packages/web/app/globals.css`, `packages/cli/src/commands/game.ts`
**Depends on**: Phase 2
**Covers**: REQ-SHELF-5, REQ-SHELF-6, REQ-SHELF-7, REQ-SHELF-26

**5a: Web client helper.** Add to `packages/web/lib/api.ts`:

```typescript
export async function setGameDimensions(
  id: string,
  dimensions: BoxDimensions | { clear: true },
): Promise<{ game: Game }> {
  return daemonJson(`/api/games/${id}/dimensions`, {
    method: "PUT",
    body: dimensions,
  });
}
```

Export `BoxDimensions` from the type re-exports.

**5b: Game detail display.** On `app/games/[id]/page.tsx`, add box dimensions display in the metadata section (alongside player count, playing time):

- When `boxDimensions` is not null: "Box: 11.4 x 11.4 x 2.75 in (361 in3)"
- When null: "Box: not measured"

The mockup at `.lore/mockups/mockup-shelf-game-dimensions.html` defines the layout. Follow the existing metadata display pattern on the game detail page.

**5c: Box dimensions edit form.** A client component (like `RatingForm`) that shows three numeric inputs for width, height, depth. The mockup shows this as a collapsible section on the game detail page with "Edit Dimensions" toggle. On save, calls `PUT /api/daemon/games/:id/dimensions`. A "Clear" button sets dimensions to null. All three fields required together (partial rejected).

**5d: CLI flags.** REQ-SHELF-7 specifies flags on `shelf-judge game edit`: `--box-width`, `--box-height`, `--box-depth`, and `--clear-box`. If a `game edit` command doesn't exist yet, it needs to be created. Alternatively, add a `game dimensions` subcommand. The spec's flag names (`--box-width` etc.) avoid collision with any future game-level width/height fields. Calls `PUT /api/games/:id/dimensions`.

```
shelf-judge game edit <id> --box-width <W> --box-height <H> --box-depth <D>
shelf-judge game edit <id> --clear-box
```

All three `--box-*` flags required together, or `--clear-box` alone.

**Verification**: Manual verification against the mockup. CLI `--json` mode returns well-formed JSON. Typecheck passes.

### Phase 6: Shelf Configuration Web UI

**Files**: new file `packages/web/app/shelves/page.tsx`, `packages/web/components/sidebar.tsx`, `packages/web/app/globals.css`
**Depends on**: Phase 4 (routes exist)
**Covers**: REQ-SHELF-27, REQ-SHELF-28, REQ-SHELF-29

**6a: Client helpers.** Add to `packages/web/lib/api.ts`:

```typescript
export async function getShelfConfig(): Promise<ShelfConfiguration> {
  return daemonJson("/api/shelf/config");
}

export async function setShelfConfig(units: ShelfUnit[]): Promise<ShelfConfiguration> {
  return daemonJson("/api/shelf/config", { method: "PUT", body: { units } });
}

export async function addShelfUnit(input: {
  name: string;
  shelves: Array<{ name: string; width: number; height: number | null; depth: number }>;
}): Promise<ShelfUnit> {
  return daemonJson("/api/shelf/units", { method: "POST", body: input });
}

export async function updateShelfUnit(
  id: string,
  input: {
    name?: string;
    shelves?: Array<{
      id?: string;
      name: string;
      width: number;
      height: number | null;
      depth: number;
    }>;
  },
): Promise<ShelfUnit> {
  return daemonJson(`/api/shelf/units/${id}`, { method: "PUT", body: input });
}

export async function removeShelfUnit(id: string): Promise<{ removed: true }> {
  return daemonJson(`/api/shelf/units/${id}`, { method: "DELETE" });
}
```

Export `Shelf`, `ShelfUnit`, `ShelfConfiguration`, `BoxDimensions` from the type re-exports.

**6b: Shelf configuration page.** Create `packages/web/app/shelves/page.tsx` as a client component (needs interactivity for add/edit/remove/reorder). The mockup at `.lore/mockups/mockup-shelf-configuration.html` defines the layout:

- Topbar: "Shelf Configuration" title
- Summary bar: total shelves, total capacity, unconstrained shelf count (REQ-SHELF-28)
- Shelf unit cards: each unit shows its name and a list of shelves with dimensions
- Per-unit actions: edit name, add shelf, remove unit
- Per-shelf actions: edit dimensions/name, remove shelf, reorder (up/down)
- Add unit button at the bottom

The page follows the redundancy settings page pattern (`app/redundancy/page.tsx`): client component, fetch on mount, local state management, save changes via API.

Height field has an "unconstrained" toggle or checkbox. When checked, height is `null` (REQ-SHELF-9). The mockup shows this as a checkbox labeled "Open top (no height limit)".

**6c: Sidebar navigation.** Add a "Shelves" entry to the sidebar. Placement: within the "Settings" group or as a new nav group. Check the mockup for positioning. The shelf config page is a settings concern (configuring physical environment), so it belongs near the redundancy settings page.

**6d: CSS additions.** Reference the mockup HTML for shelf-specific classes. Use `var()` references for all colors. Both light and dark mode tokens are defined in the mockup.

**Verification**: Manual verification against mockup. Create a shelf unit, add shelves with various dimensions, verify persistence. Edit and remove operations work. Unconstrained-height shelves show correctly.

### Phase 7: Shelf Configuration CLI

**Files**: new file `packages/cli/src/commands/shelf.ts`, CLI command registry
**Depends on**: Phase 4 (routes exist)
**Covers**: REQ-SHELF-32 (shelf config commands only: add-unit, add-shelf, remove-unit, remove-shelf, list)

**7a: Command implementations.** Create `packages/cli/src/commands/shelf.ts`:

- `shelfList`: GET `/api/shelf/config`, format as table (unit name, shelf count, shelves with dimensions)
- `shelfAddUnit`: POST `/api/shelf/units` with `{ name, shelves: [] }`
- `shelfAddShelf`: PUT `/api/shelf/units/:id` to add a shelf. Accepts `<unit-id> <name> <width> <height> <depth>`. Height=0 maps to `null` (REQ-SHELF-33).
- `shelfRemoveUnit`: DELETE `/api/shelf/units/:id`
- `shelfRemoveShelf`: Load config, find unit containing the shelf, PUT the unit without that shelf. (There's no direct shelf-delete endpoint; shelf removal is expressed as a unit update that omits the shelf.)

**7b: Register commands.** Add the `shelf` command group to the CLI's command registry.

**Verification**: CLI commands work against a running daemon. `--json` mode returns well-formed JSON.

### Phase 8: Standalone Bin-Packing Algorithm

**Files**: new file `packages/daemon/src/services/bin-packing.ts`
**Depends on**: nothing (standalone, no domain coupling)
**Covers**: REQ-SHELF-16 (rotation), algorithm design doc (all phases, grading, fitness functions)

This is the algorithm defined in `.lore/designs/similarity-weighted-bin-packing.md`, implemented as a standalone module. It has NO imports from `@shelf-judge/shared` and NO knowledge of games, shelves, or fitness scores. It operates on generic items and bins.

**8a: Types.**

```typescript
export interface PackItem {
  id: string;
  dimensions: [number, number, number] | null; // [h, w, d], null = dimensionless
  priority: number; // higher = placed first in overflow ordering
  compare: (other: PackItem) => number; // similarity [0,1], 1 = identical
}

export interface PackBin {
  id: string;
  dimensions: [number, number, number] | null; // [h, w, d], null = dimensionless
  axisPriority: [number, number, number]; // default [0,1,2]
  axisMinimize: [boolean, boolean, boolean]; // default [false, true, true]
  layer: number; // default 0
  neighbors: string[]; // bin IDs
}

export interface PackConfig {
  mergeStrategy: "avg" | "geo" | "harmonic" | "max" | "min" | "geomax";
  binFitnessWeights: { base: number; unsorted: number; neighbor: number; topN: number };
  itemFitnessWeights: { space: number; game: number; neighbor: number };
  minRemainder: [number, number, number];
  forceAxis0Width: boolean;
}

export interface PackResult {
  assignments: Map<string, PackAssignment>; // binId -> assignment
  overflow: string[]; // item IDs that couldn't be placed
}

export interface PackAssignment {
  binId: string;
  itemIds: string[];
  remainingDimensions: [number, number, number] | null;
  grade: string; // S, A, B, C, D, F
  baseFitness: number; // internal coherence score
}
```

**8b: Merge strategies.** Implement all six merge functions from the design doc. Each takes `number[]` and returns a single `number`. The `geomax` formula: `(cap * product)^(1/(n+1))` where cap = max score.

**8c: Rotation logic.** The `findBestRotation` function implements the algorithm from the design doc's "Rotation Algorithm" section. When `forceAxis0Width` is enabled, axis 0 is locked. The function returns rotated dimensions or `null` if the item doesn't fit.

**8d: Fitness functions.**

- `itemInBinFitness(item, bin, config)`: space score + similarity score + neighbor score, weighted by `itemFitnessWeights`.
- `binReadiness(bin, unplacedItems, config)`: base + unsorted + neighbor, weighted by `binFitnessWeights`.
- Space score uses per-axis ratios merged via `mergeStrategy`.
- Similarity score merges pairwise `compare()` results for existing bin contents.
- Neighbor score merges similarities to items in neighboring bins.

**8e: The four-phase packing loop.**

1. **Phase 1 (Fixed items)**: Not used by Shelf Judge in this spec (no manual overrides), but implemented for completeness. Items with hard/soft location overrides go to their assigned bin.
2. **Phase 2 (Unambiguous)**: Items that physically fit exactly one bin are placed there.
3. **Phase 3 (Greedy fill)**: Core loop. Select highest-readiness bin, select highest-fitness item for that bin, place, re-sort. One item per iteration, re-evaluate after each placement.
4. **Phase 4 (Overflow)**: Remaining items go to the overflow list.

**8f: Post-placement dimension update.** After placing an item, subtract the rotated axis-0 size from the bin's remaining axis-0 dimension. Axes 1 and 2 unchanged (the 1D simplification from the design doc).

**8g: Grading.** After packing, compute grades per bin using the normalization and formula from the design doc. Map to letters: S (top 10%), A (10-30%), B (30-50%), C (50-70%), D (70-90%), F (bottom 10%). When fewer than 5 bins exist, grade boundaries collapse proportionally.

**8h: Public API.**

```typescript
export function pack(items: PackItem[], bins: PackBin[], config: Partial<PackConfig>): PackResult;

export const DEFAULT_PACK_CONFIG: PackConfig;
```

The function merges partial config with defaults, runs the four phases, grades bins, and returns results.

**Verification**: This is the most test-heavy phase. Unit tests in `packages/daemon/tests/bin-packing.test.ts`:

- Rotation: item fits when rotated but not in original orientation
- Rotation: item exactly shelf-sized (boundary case)
- Rotation: item 0.1 in too large on one axis, doesn't fit
- Rotation: `forceAxis0Width` locks axis 0
- Dimensionless items bypass spatial checks
- Dimensionless bins accept all items
- Fitness: space score correct for tight fit vs loose fit
- Fitness: similarity score uses `compare()` correctly
- Merge strategies: all six produce correct results for known inputs
- Phase 2: item fitting exactly one bin is placed there
- Phase 3: higher-priority bin fills first, re-sort after each placement
- Phase 4: unfitted items appear in overflow
- Grading: bins receive S through F based on relative fitness
- Empty input (no items, no bins) returns empty result
- Single item, single bin: item placed, bin graded

### Phase 9: Shelf Judge Adapter + Capacity Endpoint

**Files**: new file `packages/daemon/src/services/capacity-service.ts`, new addition to `packages/daemon/src/routes/shelf.ts`, `packages/daemon/src/app.ts`
**Depends on**: Phase 2 (box dimensions on games), Phase 4 (shelf config), Phase 8 (algorithm)
**Covers**: REQ-SHELF-16, REQ-SHELF-17, REQ-SHELF-18, REQ-SHELF-19, REQ-SHELF-20, REQ-SHELF-21, REQ-SHELF-22, REQ-SHELF-23, REQ-SHELF-24, REQ-SHELF-25

This phase bridges the gap between Shelf Judge's domain model and the bin-packing algorithm's generic interface.

**9a: Capacity service.** Create `packages/daemon/src/services/capacity-service.ts`:

```typescript
export interface CapacityService {
  computeCapacity(): Promise<ShelfCapacityResult>;
}

export interface CapacityServiceDeps {
  storageService: StorageService;
  gameService: GameService;
  fitnessService: FitnessService;
}
```

**9b: Pre-pass unfittable check (REQ-SHELF-17, REQ-SHELF-20).** Before calling the algorithm, scan all dimensioned games against all shelves. A game is unfittable if it fits no shelf in any rotation. The rotation check reuses the algorithm's `findBestRotation` function (import it from `bin-packing.ts`). Unfittable games are collected with a human-readable reason string: "Box is W x H x D in; widest shelf is X in" (or whichever dimension causes the failure).

**9c: Item-to-game mapping.** Convert each dimensioned, fittable game into a `PackItem`:

```typescript
{
  id: game.id,
  dimensions: [game.boxDimensions.height, game.boxDimensions.width, game.boxDimensions.depth],
  priority: fitnessScore, // higher fitness = higher priority (placed preferentially)
  compare: (other) => {
    // 1 - compositeDistance(thisVector, otherVector).composite
    return 1 - compositeDistance(vectorCache.get(game.id)!, vectorCache.get(other.id)!).composite;
  },
}
```

The `compare` function is the critical bridge. It uses `compositeDistance` from `feature-vector.ts`, inverted to produce similarity (1 = identical, 0 = unrelated). The adapter pre-encodes all games into `FeatureVector` objects using `buildVocabulary`, `computeContinuousRanges`, and `encodeGame`, then stores them in a `Map<string, FeatureVector>` for the compare closure to reference.

When a game has no feature vector (no BGG data, no ratings), its similarity to all other games is 0. The algorithm places it based on spatial fit alone (REQ-SHELF-25 constraint).

When a game has no fitness score (no axes rated), it receives fitness 0 and becomes a natural cull candidate (REQ-SHELF-25 constraint).

**9d: Bin-to-shelf mapping.** Convert each shelf into a `PackBin`:

```typescript
{
  id: shelf.id,
  dimensions: shelf.height !== null
    ? [shelf.height, shelf.width, shelf.depth]
    : null, // dimensionless for unconstrained-height
  axisPriority: [0, 1, 2],
  axisMinimize: [false, true, true],
  layer: 0,
  neighbors: [], // no neighbor model in this spec
}
```

Unconstrained-height shelves (`height: null`) map to dimensionless bins. They accept any item that fits width and depth. Wait, that's not right. The design doc says dimensionless bins "accept items without spatial constraints." But REQ-SHELF-9 says "When height is null, a game fits the shelf if its box width and depth fit (in some orientation), regardless of box height."

Decision: unconstrained-height shelves are NOT dimensionless bins. They are bins with a very large (effectively infinite) height. Map to `[10000, shelf.width, shelf.depth]`. This ensures width and depth are still checked. The algorithm's rotation logic handles the rest. `capacityIn3` and `utilization` are `null` in the response for these shelves (REQ-SHELF-22).

**9e: Config defaults.** The pack config for Shelf Judge:

```typescript
{
  mergeStrategy: "geomax",
  binFitnessWeights: { base: 0.20, unsorted: 0.70, neighbor: 0.10, topN: 1 },
  itemFitnessWeights: { space: 0.10, game: 0.80, neighbor: 0.10 },
  minRemainder: [0.25, 3, 4],
  forceAxis0Width: true,
}
```

Neighbor weights are 0.10 in the config but no shelves have neighbors in this spec (scope exclusion), so neighbor scores will be 0 for all items and bins. The weights don't need to be zeroed out because the neighbor computation on empty neighbor lists produces 0 naturally.

**9f: Response assembly.** After running the algorithm:

1. Map `PackResult.assignments` back to `ShelfAssignment[]`. For each bin: look up the shelf/unit by bin ID, compute `usedIn3` (sum of assigned game volumes), compute `utilization` (usedIn3 / capacityIn3, null for unconstrained), list assigned games with their fitness scores.
2. Map `PackResult.overflow` to `OverflowEntry[]`. These are games the algorithm couldn't place. Sorted by fitness ascending. `fittable: true` for all (unfittable games were filtered out in the pre-pass).
3. Combine with the pre-pass unfittable list.
4. Set `overflowing: true` if overflowGames is non-empty.
5. Count `gamesWithDimensions` and `gamesWithoutDimensions`.

**9g: Edge cases.**

- No shelf config (REQ-SHELF-23): return `{ configured: false, ... }` with zero/empty values.
- No games with dimensions (REQ-SHELF-24): return valid response with empty assignments and overflow.
- Mixed dimensioned and undimensioned games: undimensioned games are excluded from the algorithm, counted in `gamesWithoutDimensions`.

**9h: Route.** Add `GET /shelf/capacity` to `routes/shelf.ts`. Wire the capacity service in `app.ts`.

**9i: App wiring.** Extend `createShelfRoutes` deps to include `capacityService`. Create `capacityService` in `app.ts`:

```typescript
const capacityService = createCapacityService({
  storageService,
  gameService,
  fitnessService,
});
```

Wait, `fitnessService` is not currently in `AppDeps`. Check: `app.ts` creates `gameService` which takes `fitnessService` as a dep. The `fitnessService` is created in `server.ts` and passed to `gameService`. The capacity service needs access to fitness scores, but `gameService.listGames()` already returns `GameWithScore[]` with scores attached. So the capacity service can use `gameService.listGames()` instead of `fitnessService` directly.

Revised deps:

```typescript
export interface CapacityServiceDeps {
  storageService: StorageService;
  gameService: GameService;
}
```

**Verification**: Tests in `packages/daemon/tests/capacity-service.test.ts`:

- Box that fits only when rotated is reported as fitting
- Box exceeding all shelves in every orientation is unfittable with correct reason
- Unconstrained-height shelves allow any box height but check width/depth
- Unconstrained-height shelves have `capacityIn3: null` and `utilization: null`
- `unfittableGames` sorted by fitness ascending
- `overflowGames` contains only displaced games, not unfittable
- Per-shelf assignments list correct games with utilization
- Games without dimensions excluded, counted in `gamesWithoutDimensions`
- `configured: false` when no shelf units exist
- Mixed dimensioned/undimensioned games handled correctly
- Similarity function uses composite distance (verify by checking game clustering)
- Shelf grades computed and included

Route test in `packages/daemon/tests/shelf-routes.test.ts`:

- GET `/shelf/capacity` returns valid response shape
- GET `/shelf/capacity` with no config returns `configured: false`
- GET `/shelf/capacity` with no dimensioned games returns empty assignments

### Phase 10: Capacity Web UI

**Files**: `packages/web/app/collection/page.tsx`, new file `packages/web/app/capacity/page.tsx`, `packages/web/lib/api.ts`, `packages/web/components/sidebar.tsx`, `packages/web/app/globals.css`
**Depends on**: Phase 9 (capacity endpoint exists)
**Covers**: REQ-SHELF-30, REQ-SHELF-31

**10a: Web client helper.** Add to `packages/web/lib/api.ts`:

```typescript
export async function getShelfCapacity(): Promise<ShelfCapacityResult> {
  return daemonJson("/api/shelf/capacity");
}
```

Export all shelf capacity response types from the re-exports.

**10b: Collection page capacity indicator (REQ-SHELF-30).** The collection page at `app/collection/page.tsx` gains a capacity indicator section. Fetch `getShelfCapacity()` server-side alongside the game list (in the existing `Promise.all` or a separate try/catch). The indicator renders between the topbar and the collection table:

- When `!configured`: no indicator shown
- When `configured && gamesWithDimensions === 0`: "Shelves configured, but no game dimensions available."
- When `!overflowing && unfittableGames.length === 0`: "All N games placed" with utilization summary
- When `overflowing || unfittableGames.length > 0`: warning-colored banner with overflow/unfittable counts and a link to the capacity detail page

The mockup at `.lore/mockups/mockup-shelf-capacity-indicator.html` defines the visual design.

**10c: Capacity detail page (REQ-SHELF-31).** Create `packages/web/app/capacity/page.tsx` as a server component. Fetches `getShelfCapacity()` and renders three sections:

1. **Shelf assignments**: each shelf as a card with assigned games, utilization bar, and grade badge. The mockup at `.lore/mockups/mockup-shelf-capacity-detail.html` defines the layout. Grade badges use the `--grade-*` CSS tokens from the mockup.

2. **Unfittable games** (if any): table sorted by fitness ascending. Each row: game name, fitness score, box dimensions, reason string (REQ-SHELF-20).

3. **Displaced games** (if any): table sorted by fitness ascending. Each row: game name, fitness score, volume (REQ-SHELF-21).

4. **Dimension coverage note**: "N games have no box dimensions and are excluded from this calculation." with a link to filter the collection to games without dimensions.

Empty states: when no config exists or no dimensioned games, show appropriate messages per `.lore/mockups/mockup-shelf-capacity-detail-empty.html`.

**10d: Sidebar navigation.** Add "Capacity" to the sidebar, positioned after the shelf config entry. This links to `/capacity`.

**10e: CSS additions.** Grade badge tokens (`--grade-s`, `--grade-a`, etc.) from the capacity detail mockup. Utilization bar styles. Warning banner styles for the collection page indicator. All with light and dark mode variants.

**Verification**: Manual verification against all four mockups. Test states: overflowing, not overflowing, no config, no dimensions, mixed. Both light and dark mode.

### Phase 11: Capacity CLI

**Files**: `packages/cli/src/commands/shelf.ts` (extend from Phase 7)
**Depends on**: Phase 9 (capacity endpoint exists)
**Covers**: REQ-SHELF-32 (capacity commands: status, capacity), REQ-SHELF-34, REQ-SHELF-35

**11a: `shelfStatus` command (REQ-SHELF-34).** Calls `GET /api/shelf/capacity`. Formats output per the spec's example:

```
Shelf Configuration: 3 units, 14 shelves (2 unconstrained-height)
Games Measured: 87 of 94
Placed: 82 games across 14 shelves
Unfittable: 3 (don't fit any shelf)
Displaced: 2 (fit by shape but no room)
```

**11b: `shelfCapacity` command (REQ-SHELF-35).** Calls `GET /api/shelf/capacity`. Three-section output:

1. Per-shelf assignments: table with shelf name, game count, utilization, grade
2. Unfittable games: table with name, fitness, dimensions, reason
3. Displaced games: table with name, fitness, volume

`--json` mode returns the full `ShelfCapacityResult` object.

**Verification**: CLI commands work against a running daemon. `--json` mode returns well-formed JSON.

### Phase 12: Validate

Launch a fresh-context sub-agent that:

1. Reads the spec (`.lore/specs/shelf-capacity.md`) and this plan
2. Reviews the implementation across all packages
3. Verifies all shelf config CRUD endpoints and the capacity endpoint are implemented and tested
4. Verifies both web client helpers and CLI commands cover all endpoints (client/daemon divergence lesson)
5. Verifies `Game.boxDimensions` change does not break existing serialization/deserialization (null default, storage backfill)
6. Verifies the bin-packing algorithm module has NO imports from `@shelf-judge/shared` (standalone constraint)
7. Verifies the adapter correctly inverts `compositeDistance` for the similarity function
8. Verifies rotation/fit with edge cases: fits only when rotated, exactly shelf-sized, 0.1 in too large
9. Verifies unconstrained-height shelves have `capacityIn3: null` and `utilization: null`
10. Verifies unfittable games are excluded from the packing algorithm (pre-pass, not Phase 4 overflow)
11. Verifies capacity endpoint returns `configured: false` when no units exist (not 400)
12. Verifies web UI renders correctly in both light and dark mode
13. Runs `bun run test`, `bun run typecheck`, `bun run lint`

## Architectural Decisions

### Unconstrained-height shelf mapping

**Decision:** Map `height: null` shelves to bins with height 10000 (effectively infinite), not to dimensionless bins.

**Why:** Dimensionless bins in the algorithm skip ALL spatial checks. Unconstrained-height shelves still need width and depth checked (REQ-SHELF-9). A very large height value preserves the rotation and fit logic while effectively removing the height constraint. The sentinel value (10000 inches, ~250 meters) is far beyond any physical shelf. The alternative (adding a "partially dimensionless" concept to the algorithm) would leak domain knowledge into the standalone module.

### Box dimension endpoint

**Decision:** Separate `PUT /games/:id/dimensions` endpoint instead of extending the ratings endpoint.

**Why:** Dimensions and ratings serve different purposes and have different validation rules. Partial ratings are fine (rate one axis at a time). Partial dimensions are rejected (all three or none). Mixing them in one endpoint creates ambiguity about which validation rules apply. The separate endpoint also makes the CLI flags cleaner (`game dimensions` vs `game rate`).

### Algorithm module isolation

**Decision:** The bin-packing module (`bin-packing.ts`) imports nothing from `@shelf-judge/shared`. Items carry a `compare` closure instead of a reference to game data.

**Why:** The spec's constraints section mandates this. The closure pattern means the algorithm never sees game objects, feature vectors, or fitness scores. It sees items with dimensions and a comparison function. This makes the algorithm testable with synthetic data and reusable for future features (bag packing, different item types). The compare closure captures the pre-encoded feature vectors and composite distance function at adapter construction time.

### Capacity computation scope

**Decision:** The capacity service uses `gameService.listGames()` for scored games, not raw fitness service calls.

**Why:** `listGames()` already returns `GameWithScore[]` with fitness scores computed. The capacity service needs fitness scores for priority ordering and feature vectors for similarity. Computing scores again would duplicate work. The capacity endpoint is read-only, returns fresh results per request (REQ-SHELF-25), and doesn't cache.

### Ownership filtering

**Decision:** The capacity computation uses only owned games (ownership !== "previously-owned").

**Why:** Previously-owned games aren't on the shelf. The capacity question is "do my physical games fit my physical shelves." The `gameService.listGames()` call returns owned games by default (the ownership filter defaults to "owned" per the previously-owned spec). No special handling needed.

## Commission Structure

The plan has 12 phases across three layers plus a standalone algorithm. The commission chain uses foundation-first ordering with review gates before fan-out.

### Stream Layout

```
Phase 1 (shared types) ─── review+fix gate ───┬── Stream A: Layer 1 (Phases 2, 5)
                                               ├── Stream B: Layer 2 (Phases 3, 4, 6, 7)
                                               └── Stream C: Algorithm (Phase 8)

Streams A, B, C complete ─── Stream D: Layer 3 (Phases 9, 10, 11) ─── Phase 12 (validate)
```

### Commission Chain

**C1: Foundation types (Dalton)**
Phases 1.
Add `BoxDimensions`, `Shelf`, `ShelfUnit`, `ShelfConfiguration` to shared types. Add `boxDimensions` to `Game`. Add storage backfill. This is small but load-bearing: every subsequent commission imports these types.
Files: `packages/shared/src/types.ts`, `packages/daemon/src/services/storage-service.ts`, `packages/daemon/src/services/game-service.ts`.

**C2: Foundation review (Thorne)**
Review C1 against the spec's type definitions (REQ-SHELF-1 through REQ-SHELF-3, REQ-SHELF-8 through REQ-SHELF-10). Verify backfill handles legacy data. Verify `addGame` sets `boxDimensions: null`.

**C3: Foundation fix (Dalton)**
Fix findings from C2.

**After the foundation gate, three streams fan out:**

---

**Stream A: Box Dimensions**

**C4: Box dimensions daemon + web + CLI (Dalton)**
Phases 2, 5.
Dimension validation, PUT endpoint, game detail display, edit form, CLI command. This is a bounded feature that fits one commission.
Files: `packages/daemon/src/routes/games.ts`, `packages/daemon/src/services/game-service.ts`, `packages/web/app/games/[id]/page.tsx`, `packages/web/lib/api.ts`, `packages/web/app/globals.css`, `packages/cli/src/commands/game.ts`.

**C5: Box dimensions review (Thorne)**
Review C4 against REQ-SHELF-5 through REQ-SHELF-7, REQ-SHELF-26, REQ-SHELF-36.

**C6: Box dimensions fix (Dalton)**
Fix findings from C5.

---

**Stream B: Shelf Configuration**

**C7: Shelf config service + routes (Dalton)**
Phases 3, 4.
Storage layer, shelf service, CRUD routes, app wiring. Backend-only, no UI.
Files: `packages/daemon/src/services/storage-service.ts`, new `packages/daemon/src/services/shelf-service.ts`, new `packages/daemon/src/routes/shelf.ts`, `packages/daemon/src/app.ts`.

**C8: Shelf config review (Thorne)**
Review C7 against REQ-SHELF-11 through REQ-SHELF-15. Pay attention to the update semantics (shelves with id updated, without id added, absent removed).

**C9: Shelf config fix (Dalton)**
Fix findings from C8.

**C10: Shelf config web + CLI (Dalton)**
Phases 6, 7.
Web configuration page, sidebar nav, CLI commands. Depends on C9 (routes stable).
Files: new `packages/web/app/shelves/page.tsx`, `packages/web/components/sidebar.tsx`, `packages/web/lib/api.ts`, `packages/web/app/globals.css`, new `packages/cli/src/commands/shelf.ts`.

**C11: Shelf config UI review (Thorne)**
Review C10 against REQ-SHELF-27 through REQ-SHELF-29, REQ-SHELF-32, REQ-SHELF-33.

**C12: Shelf config UI fix (Dalton)**
Fix findings from C11.

---

**Stream C: Algorithm**

**C13: Bin-packing algorithm (Dalton)**
Phase 8.
Standalone module: types, merge strategies, rotation, fitness functions, 4-phase packing, grading. No Shelf Judge imports. Heavy test coverage.
Files: new `packages/daemon/src/services/bin-packing.ts`, new `packages/daemon/tests/bin-packing.test.ts`.

**C14: Algorithm review (Thorne)**
Review C13 against the design doc (`.lore/designs/similarity-weighted-bin-packing.md`). Verify standalone constraint (no `@shelf-judge/shared` imports). Verify rotation edge cases, merge strategy correctness, grading formula.

**C15: Algorithm fix (Dalton)**
Fix findings from C14.

---

**Stream D: Capacity Integration (after A, B, C all complete)**

**C16: Capacity adapter + endpoint + web helpers (Dalton)**
Phase 9, Phase 10a.
Capacity service (adapter), pre-pass unfittable check, item/bin mapping, response assembly, GET endpoint, web client helper.
Files: new `packages/daemon/src/services/capacity-service.ts`, `packages/daemon/src/routes/shelf.ts`, `packages/daemon/src/app.ts`, `packages/web/lib/api.ts`.

**C17: Capacity web UI + CLI (Dalton)**
Phases 10b-10e, 11.
Collection page indicator, capacity detail page, sidebar nav entry, CLI status and capacity commands.
Files: `packages/web/app/collection/page.tsx`, new `packages/web/app/capacity/page.tsx`, `packages/web/components/sidebar.tsx`, `packages/web/app/globals.css`, `packages/cli/src/commands/shelf.ts`.

**C18: Capacity integration review (Thorne)**
Review C16 and C17 against REQ-SHELF-16 through REQ-SHELF-25, REQ-SHELF-30, REQ-SHELF-31, REQ-SHELF-34, REQ-SHELF-35. Critical checks: similarity function wiring, unfittable pre-pass vs algorithm overflow distinction, unconstrained-height shelf handling, edge cases (no config, no dimensions).

**C19: Capacity integration fix (Dalton)**
Fix findings from C18.

**C20: Final validation (Thorne)**
Phase 12. Full cross-cutting review against the complete spec.

### Commission Dependencies

```
C1 → C2 → C3 ─┬─ C4 → C5 → C6 ──────────────────────────┐
               ├─ C7 → C8 → C9 → C10 → C11 → C12 ───────┤
               └─ C13 → C14 → C15 ────────────────────────┘
                                                           │
                              C16 → C17 → C18 → C19 → C20 ◄
```

### Sizing Notes

- **C1 (foundation)**: Small, ~30 minutes. Types and backfill only.
- **C4 (box dimensions)**: Medium, combines daemon + web + CLI for one cohesive feature. ~3 files touched significantly.
- **C7 (shelf config backend)**: Medium. New service + routes, ~4 new files.
- **C10 (shelf config UI)**: Medium-large. New page with complex form, ~3 new files.
- **C13 (algorithm)**: Large. ~400-600 lines of algorithm code, ~300-500 lines of tests. This is the single biggest commission. It needs a dedicated context window because the algorithm's logic is self-referential (fitness functions reference each other, phases build on previous phases' state).
- **C16 (adapter)**: Medium. The adapter translates between two known interfaces. The tricky part is wiring the similarity function correctly.
- **C17 (capacity UI)**: Medium-large. Two new views (indicator + detail page) plus CLI commands.

### Parallel Execution Windows

**Window 1**: C4, C7, C13 run in parallel (after C3 completes). These touch completely different files.

**Window 2**: C10 runs after C9. C4 may still be in review (C5/C6). No file conflicts.

**Window 3**: C16 and C17 are sequential (C17 needs C16's endpoint). Both depend on all three streams completing.

## Open Questions

1. **Shelf config page URL.** The plan uses `/shelves` for the config page and `/capacity` for the detail view. These could also be `/shelves/config` and `/shelves/capacity`, or `/settings/shelves` and `/shelves/capacity`. The mockup sidebar shows "Shelves" as a top-level group with "Configuration" and "Capacity" underneath, which suggests `/shelves/config` and `/shelves/capacity`. Decision: use `/shelves` for config (it's the primary shelf page) and `/capacity` for the detail view (accessed from the collection page, not from shelf config).

2. **Capacity indicator fetch cost.** The collection page will call `GET /api/shelf/capacity` on every load. The capacity computation runs the bin-packing algorithm, which is O(N^2 \* B) in the worst case. For a typical collection (~100 games, ~15 shelves), this should be fast (milliseconds), but worth noting as a potential performance concern for very large collections. If it becomes slow, caching or a "last computed" display can be added as a follow-up.

3. **CLI shelf removal by shelf ID.** REQ-SHELF-32 lists `shelf-judge shelf remove-shelf <shelf-id>` as a command, but the API has no direct shelf-delete endpoint. Shelf removal is expressed as a unit update that omits the shelf. The CLI command needs to: load config, find which unit contains the shelf, issue a PUT to that unit without the shelf. This is a multi-step operation in the CLI but avoids adding a seventh endpoint. The alternative (add DELETE `/api/shelf/shelves/:id`) would be cleaner for the CLI but adds an endpoint the web UI doesn't need. Decision: multi-step CLI operation, no new endpoint. If the UX is awkward, add the endpoint later.
