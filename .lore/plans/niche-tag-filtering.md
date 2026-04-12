---
title: "Implementation plan: niche-tag-filtering"
date: 2026-04-11
status: executed 
tags: [plan, niche, settings, filtering, tags]
modules: [shared, daemon, web, cli]
related:
  - .lore/specs/niche-champion-display.md
  - .lore/plans/niche-champion-display.md
  - .lore/specs/redundancy-scoring.md
---

# Plan: Niche Tag Filtering

## Goal

Add a user-configurable ignore list for niche tags so that uninteresting niches (e.g., `family: "Crowdfunding: Kickstarter"`, `family: "Players: Solitaire Only Games"`) are filtered out before the niche engine computes positions. The ignore list is a persistent settings file following the `prediction-settings.json` pattern. The niche engine consumes the list as a filter parameter, and users can manage the list through API, web UI, and CLI.

This is a standalone feature. It does not require a spec because the scope is bounded: a settings type, storage, CRUD API, niche engine integration, and UX for adding/removing tags. It extends the niche champion display (implemented) without modifying the niche spec's requirements.

## Codebase Context

### Settings Pattern (prediction-settings.json)

The established settings pattern has three layers:

1. **Shared type**: `PredictionSettings` in `packages/shared/src/types.ts:400-405`. Four numeric fields with documented defaults.
2. **Storage**: `StorageService` interface (`storage-service.ts:26-27`) exposes `loadPredictionSettings()` / `savePredictionSettings()`. Implementation at lines 176-189 reads/writes `prediction-settings.json` in `~/.shelf-judge/data/`. Returns defaults when file doesn't exist. Full object overwrite on save.
3. **API**: `GET /predictions/settings` returns current settings. `PATCH /predictions/settings` accepts partial object, merges with current, persists (`prediction.ts:26-56`). Validation in the service layer (`prediction-service.ts:405-410`).
4. **Defaults**: `DEFAULT_PREDICTION_SETTINGS` constant exported from the engine module (`prediction-engine.ts`), imported by storage service.

### Niche Engine

Pure-function module at `packages/daemon/src/services/niche-engine.ts` (289 lines). Two exported functions:

- `computeNichePositions(gamesWithScores: GameWithScore[]): Map<string, NichePosition>` (line 148)
- `computeNicheImpact(existingGamesWithScores, candidateGame, candidateScore): NicheImpact` (line 221)

Both call `buildAttributeIndex()` (line 96) which iterates `bggData.mechanics`, `bggData.categories`, and `bggData.families`. This is the natural insertion point for the ignore filter: skip any `(type, name)` pair that appears on the ignore list before adding it to the index.

### Call Sites

The niche engine is called from three places, all in route handlers:

- `routes/games.ts:101,116` (GET /games with `includeNiches=true`)
- `routes/games.ts:137` (GET /games/:id)
- `routes/prediction.ts:70` (GET /predictions/bgg/:bggId)

All three currently pass only `GameWithScore[]`. Adding an ignore list parameter means updating all three call sites to load the settings and pass the list.

### Web NichePositionPanel

`packages/web/app/games/[id]/page.tsx:466-538` renders each niche entry as a `NicheEntryCard`. This is where a "dismiss this niche" affordance would live, as a small button on each card.

### Related Work

The redundancy-scoring spec (draft, `.lore/specs/redundancy-scoring.md`) defines `RedundancySettings` following the exact same storage pattern (REQ-REDUN-1 through REQ-REDUN-5). It persists to `redundancy-settings.json` with `loadRedundancySettings()`/`saveRedundancySettings()`. Not yet implemented, but validates the pattern is repeatable.

## Implementation Steps

### Phase 1: Shared Types

**Files**: `packages/shared/src/types.ts`
**Expertise**: none

Add a `NicheTagFilter` type and a `NicheSettings` type after the existing niche types:

```typescript
interface NicheTagFilter {
  type: "mechanic" | "category" | "family";
  name: string;
}

interface NicheSettings {
  ignoredTags: NicheTagFilter[];
}
```

The `NicheTagFilter` is a `(type, name)` pair identifying a specific BGG tag. `NicheSettings` wraps the ignore list. The wrapper allows future settings (e.g., max-niche-size-percentage from the spec's Open Question 1) without changing the storage shape.

Export both types.

### Phase 2: Storage Layer

**Files**: `packages/daemon/src/services/niche-engine.ts`, `packages/daemon/src/services/storage-service.ts`
**Expertise**: none

**2a: Default constant.** Add `DEFAULT_NICHE_SETTINGS` to `niche-engine.ts`:

```typescript
export const DEFAULT_NICHE_SETTINGS: NicheSettings = { ignoredTags: [] };
```

This follows the pattern where the engine module owns its defaults (like `DEFAULT_PREDICTION_SETTINGS` in `prediction-engine.ts`).

**2b: Storage interface.** Add to `StorageService` interface:

```typescript
loadNicheSettings(): Promise<NicheSettings>;
saveNicheSettings(settings: NicheSettings): Promise<void>;
```

**2c: Storage implementation.** In `createStorageService()`, add `loadNicheSettings` and `saveNicheSettings` following the prediction settings pattern:

- File: `niche-settings.json` in the data directory
- Load returns `DEFAULT_NICHE_SETTINGS` when file doesn't exist
- Save writes full object via `atomicWrite`

Import `DEFAULT_NICHE_SETTINGS` from `niche-engine.ts` and `NicheSettings` from `@shelf-judge/shared`.

### Phase 3: Niche Engine Integration

**Files**: `packages/daemon/src/services/niche-engine.ts`
**Expertise**: none

**3a: Update `buildAttributeIndex`.** Add an `ignoredTags` parameter:

```typescript
function buildAttributeIndex(
  eligibleGames: GameWithScore[],
  ignoredTags: NicheTagFilter[],
): Map<string, NicheGroup>;
```

Build a `Set<string>` from ignored tags at the top of the function, keyed by `"${type}:${name}"`. In the inner loop where tags are iterated (line 108), skip any tag whose key is in the ignore set. This is O(1) per tag lookup.

**3b: Update `computeNichePositions`.** Add a `settings` parameter:

```typescript
export function computeNichePositions(
  gamesWithScores: GameWithScore[],
  settings?: NicheSettings,
): Map<string, NichePosition>;
```

The parameter is optional with a default of `DEFAULT_NICHE_SETTINGS` so existing tests don't break. Pass `settings.ignoredTags` to `buildAttributeIndex`.

**3c: Update `computeNicheImpact`.** Same pattern:

```typescript
export function computeNicheImpact(
  existingGamesWithScores: GameWithScore[],
  candidateGame: Game,
  candidateScore: FitnessResult,
  settings?: NicheSettings,
): NicheImpact;
```

Pass `settings.ignoredTags` to `buildAttributeIndex`. Also filter the candidate game's own tag iteration (line 241) to skip ignored tags. Without this, the impact would report entries for ignored tags.

### Phase 4: Daemon Routes

**Files**: `packages/daemon/src/routes/games.ts`, `packages/daemon/src/routes/prediction.ts`, new file `packages/daemon/src/routes/niche.ts`, `packages/daemon/src/app.ts` (route registration)
**Expertise**: none

**4a: CRUD routes.** Create `packages/daemon/src/routes/niche.ts` with:

- `GET /niches/settings` returns current `NicheSettings`
- `PATCH /niches/settings` accepts partial update, merges with current, persists. Validation: `ignoredTags` must be an array of `{ type, name }` objects where `type` is one of `"mechanic" | "category" | "family"` and `name` is a non-empty string. Invalid entries return 400.
- `POST /niches/settings/ignore` is a convenience endpoint for adding a single tag: accepts `{ type, name }`, adds to the ignore list if not already present, returns updated settings. This powers the "dismiss" button in the UI without requiring the client to read-modify-write.
- `DELETE /niches/settings/ignore` accepts `{ type, name }` in the body, removes the matching tag from the ignore list, returns updated settings.

Register in `app.ts` alongside other route groups. Dependencies: `storageService` only (no service layer needed; the routes do direct load/merge/save through storage).

**4b: Pass settings to niche engine calls.** Update the three call sites:

- `routes/games.ts` GET /games (lines 101, 116): Load niche settings from storage, pass to `computeNichePositions(games, settings)`.
- `routes/games.ts` GET /games/:id (line 137): Same.
- `routes/prediction.ts` GET /predictions/bgg/:bggId (line 70): Load niche settings, pass to `computeNicheImpact(allGames, result.game, result.score, settings)`.

The game routes already receive `gameService` which has access to `storageService`. The niche route dependencies need `storageService` injected. Check how the game routes access storage: they go through `gameService`, but niche settings don't belong on the game service. Pass `storageService` directly to the niche routes (the prediction routes receive `predictionService` which wraps storage, so the pattern of narrower dependency injection is established).

For the game and prediction routes that call niche engine functions, add `storageService` to their dependency interfaces so they can load niche settings directly. Alternatively, load settings in the route handler and pass them through. The first approach is cleaner since it avoids adding storage awareness to route files that currently delegate everything to services.

**Decision**: Add `storageService` to `GameRoutesDeps` and `PredictionRoutesDeps`. The route handlers load niche settings once per request and pass them to the niche engine functions. This keeps the niche engine pure (no I/O) and keeps the settings load co-located with the niche computation call.

**4c: Operation definitions.** Add operation definitions for the new routes following the existing pattern in prediction.ts.

### Phase 5: Tests

**Files**: `packages/daemon/tests/niche-engine.test.ts` (modify existing), `packages/daemon/tests/niche-settings-routes.test.ts` (new)
**Expertise**: none

**5a: Niche engine tests.** Add test cases to the existing test file:

- Ignored tag is excluded from niche grouping (game that would form a niche via the ignored mechanic no longer does)
- Ignoring a tag that reduces a niche below 2 members eliminates that niche
- `computeNicheImpact` with ignored tags does not report impact entries for ignored tags
- Empty ignore list produces identical results to no settings parameter (backward compat)
- Multiple ignored tags across different types (mechanic, category, family) all filtered correctly

Use the existing test fixture (8-10 games) and extend it rather than creating a new fixture.

**5b: Route tests.** Test the CRUD endpoints:

- GET /niches/settings returns defaults when no file exists
- PATCH /niches/settings adds ignored tags
- POST /niches/settings/ignore adds a single tag (idempotent)
- DELETE /niches/settings/ignore removes a tag
- Validation: rejects invalid type, rejects empty name, rejects non-array ignoredTags
- GET /games/:id with ignored tags active filters the niche position accordingly
- GET /predictions/bgg/:bggId with ignored tags active filters the niche impact

### Phase 6: Web UI

**Files**: `packages/web/lib/api.ts`, `packages/web/app/games/[id]/page.tsx`, `packages/web/app/collection/page.tsx`
**Expertise**: frontend (React/Next.js)

**6a: Web API helpers.** Add to `packages/web/lib/api.ts`:

```typescript
export async function getNicheSettings(): Promise<NicheSettings> { ... }
export async function updateNicheSettings(patch: Partial<NicheSettings>): Promise<NicheSettings> { ... }
export async function ignoreNicheTag(tag: NicheTagFilter): Promise<NicheSettings> { ... }
export async function unignoreNicheTag(tag: NicheTagFilter): Promise<NicheSettings> { ... }
```

These call the daemon endpoints from Phase 4a.

**6b: Dismiss button on NicheEntryCard.** Add a small dismiss/hide button (e.g., an "x" or eye-slash icon) to each `NicheEntryCard` in `packages/web/app/games/[id]/page.tsx`. On click, call `ignoreNicheTag({ type: niche.type, name: niche.name })` and refresh the page data. The niche card disappears because the daemon now filters it out.

This is the primary discovery UX: the user sees a useless niche, clicks dismiss, and it's gone. The button should have a confirm tooltip or brief undo affordance to prevent accidental dismissal.

**6c: Dismiss button on collection niche view.** In the collection page's Group by Niche view (`packages/web/app/collection/page.tsx`), add a dismiss button on each niche group heading. Same API call as 6b.

**6d: Niche settings management.** The user needs a way to see and restore ignored tags. Two options:

- **Option A**: A dedicated settings section (e.g., on a settings page or a modal accessible from the niche panel).
- **Option B**: An "Ignored Niches" section at the bottom of the niche panel showing dismissed tags with a restore button.

**Decision**: Option B. An inline "Ignored Niches" section below the active niches on the game detail page, and a similar section on the collection niche view. This keeps the management co-located with the niche display. The section shows each ignored tag as a muted chip with a restore button. Clicking restore calls `unignoreNicheTag(tag)` and refreshes.

This avoids creating a new settings page for a feature with a single list. If the niche settings grow (e.g., max-size-percentage), a dedicated section can be added later.

### Phase 7: CLI

**Files**: `packages/cli/src/commands/niche.ts` (new)
**Expertise**: none

Add `shelf-judge niche` subcommands:

- `shelf-judge niche ignored` lists currently ignored tags (text table or JSON with `--json`)
- `shelf-judge niche ignore <type> <name>` adds a tag to the ignore list (calls POST /niches/settings/ignore)
- `shelf-judge niche unignore <type> <name>` removes a tag (calls DELETE /niches/settings/ignore)

Validation: `type` must be one of `mechanic`, `category`, `family`. Provide helpful error message on invalid type.

Register the `niche` command group in the CLI's command registry.

### Phase 8: Validate

Launch a fresh-context sub-agent that:

1. Reads this plan and the niche champion display spec
2. Reviews the implementation across all packages
3. Verifies all three call sites (GET /games, GET /games/:id, GET /predictions/bgg/:bggId) pass niche settings
4. Verifies both web proxy route and CLI client helper are updated (per the client/daemon divergence lesson)
5. Verifies the niche engine remains pure (no I/O added)
6. Runs `bun run test`, `bun run typecheck`, `bun run lint`

## Delegation Guide

**Phases 1-5** (types, storage, engine, routes, tests): Single implementer. Straightforward backend work following established patterns. No specialized expertise needed.

**Phase 6** (web UI): Can run after Phase 5 completes. Benefits from frontend awareness for the dismiss button UX and the undo/restore interaction. The collection page's Group by Niche view is the most complex integration point due to the niche heading dismiss button and data refresh.

**Phase 7** (CLI): Can run in parallel with Phase 6 after Phase 5 completes. Simple command registration and output formatting.

**Phase 8** (validation): Fresh-context sub-agent. Must run after all other phases.

Steps requiring review attention:

- Phase 4b: The `storageService` injection into game and prediction route deps is a minor interface change. Verify it doesn't break the app wiring in `app.ts`.
- Phase 6b/6c: The dismiss button UX needs to feel light (not a modal confirmation dialog for every dismiss). A brief undo toast or a restore section is better than a "Are you sure?" prompt.

Consult `.lore/lore-agents.md` (if it exists) for available domain-specific agents.

## Open Questions

1. **Max-size-percentage filter.** The niche spec's Open Question 1 and the user's annotation raise whether niches covering >50% of the collection are noise. The `NicheSettings` wrapper type is designed to accommodate this as a future field (e.g., `maxSizePercent?: number`). This plan does not implement it, but the type shape won't need restructuring when it's added. Could be a follow-up issue.

2. **Ignore list seeding.** Should the system ship with a default ignore list (e.g., common noisy families like "Crowdfunding: Kickstarter")? The plan defaults to an empty list, letting the user discover and dismiss tags organically. A curated default list risks hiding tags the user would find interesting. If the user wants seeding, it can be added to `DEFAULT_NICHE_SETTINGS` later.

3. **Bulk operations.** The current plan supports one-at-a-time ignore/unignore. If the user wants to ignore all families (or all tags of a type), a bulk operation would be convenient. The PATCH endpoint already supports replacing the entire `ignoredTags` array, so a client can implement bulk operations without API changes. The web UI could add a "hide all families" toggle as a future enhancement.
