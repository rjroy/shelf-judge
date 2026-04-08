---
title: "Implementation plan: utility-curves"
date: 2026-04-07
status: approved
tags: [plan, fitness, scoring, axes, utility-curves, curves, veto]
modules: [shared, daemon, web, cli]
related:
  - .lore/specs/utility-curves.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/designs/mvp-data-model.md
  - .lore/brainstorms/fitness-model-options.md
  - .lore/issues/deferred-utility-curves.md
---

# Plan: Utility Curves for Axis Scoring

## Spec Reference

**Spec**: `.lore/specs/utility-curves.md`
**Fitness model**: `.lore/designs/mvp-fitness-model.md`
**Data model**: `.lore/designs/mvp-data-model.md`

Requirements addressed:

- REQ-CURVE-1: Native scale per axis → Phase 1, Phase 2
- REQ-CURVE-2: Personal axes fixed 1-10 native scale → Phase 2
- REQ-CURVE-3: BGG native scales hardcoded per field → Phase 2
- REQ-CURVE-4: Preference shape defines raw-to-effective mapping → Phase 2, Phase 3
- REQ-CURVE-5: Three preference shapes → Phase 2
- REQ-CURVE-6: Default "higher is better," corrected BGG normalization → Phase 2, Phase 3
- REQ-CURVE-7: Sweet spot ideal value → Phase 1, Phase 2
- REQ-CURVE-8: Tolerance levels (flexible/moderate/strict) → Phase 2
- REQ-CURVE-9: Asymmetric tolerance (lean direction) → Phase 2
- REQ-CURVE-10: Effective rating enters weighted average → Phase 3
- REQ-CURVE-11: Fixed points per shape → Phase 2
- REQ-CURVE-12: Continuous, monotonic curves → Phase 2
- REQ-CURVE-13: Veto threshold → Phase 1, Phase 3
- REQ-CURVE-14: Veto independent of shape → Phase 3
- REQ-CURVE-15: Veto breakdown with hypothetical score → Phase 3
- REQ-CURVE-16: Expanded fitness breakdown → Phase 1, Phase 3
- REQ-CURVE-17: Curve-affected axis highlighting → Phase 3
- REQ-CURVE-18: Web axis config with shape selection → Phase 5
- REQ-CURVE-19: Sweet spot UI with slider and curve preview → Phase 5
- REQ-CURVE-20: Curve preview showing effective ratings → Phase 5
- REQ-CURVE-21: Veto threshold config in web UI → Phase 5
- REQ-CURVE-22: Veto status visual in game/scores views → Phase 5
- REQ-CURVE-23: CLI axis create/update with curve options → Phase 6
- REQ-CURVE-24: CLI score display with curve effects → Phase 6
- REQ-CURVE-25: BGG axes use preference shapes same as personal → Phase 2, Phase 3
- REQ-CURVE-26: UI/CLI show BGG values in native scale → Phase 5, Phase 6
- REQ-CURVE-27: Curve transform at calculation time, not storage → Phase 3
- REQ-CURVE-28: Removing a curve restores default linear → Phase 3

## Codebase Context

### Architecture

Bun monorepo, four workspace packages. The daemon owns all data via services injected through factory functions. Web talks to daemon via Unix socket (`lib/daemon.ts`). CLI talks to daemon via Unix socket (Bun `fetch` with `unix` option). Shared types and Zod schemas in `packages/shared/`.

### Existing Patterns

**Service layer**: Each domain has a service interface and `create*Service(deps)` factory. Services receive `StorageService` and peer services via dependency injection. No classes, just closures over deps. See `game-service.ts`, `axis-service.ts`, `fitness-service.ts`.

**Pure math modules**: `elo-engine.ts` establishes the pattern for pure-function math modules. Exported functions, no service dependencies, no I/O. Heavy unit test coverage. The curve engine follows this pattern exactly.

**Routes**: Each route module exports `{ routes: Hono, operations: OperationDefinition[] }` via `createXRoutes(deps)`. Routes parse/validate input, call service, map errors to HTTP status codes.

**CLI**: Hand-rolled arg parser in `index.ts` with a `COMMANDS` map. Each command module exports async functions that take `(client, args, opts)`. Output via `formatTable` and `printOutput` helpers.

**Web**: Next.js 16 with App Router. Server components fetch from daemon via `lib/api.ts`. Client components use the `/api/daemon/[...path]` proxy route for mutations. CSS in a global stylesheet.

### Key Files That Will Change

- `packages/shared/src/types.ts` — extend `Axis` with curve config, extend `FitnessBreakdownEntry` with raw/effective fields, extend `FitnessResult` with veto info
- `packages/shared/src/validation.ts` — update `CreateAxisSchema` and `UpdateAxisSchema` with curve fields
- `packages/shared/src/index.ts` — re-export new types
- `packages/daemon/src/services/curve-engine.ts` — **new**: pure curve math
- `packages/daemon/src/services/fitness-service.ts` — replace `resolveBggRating`, integrate curves and veto
- `packages/daemon/src/services/axis-service.ts` — store curve config on create/update
- `packages/daemon/src/routes/axes.ts` — accept curve fields on create/update
- `packages/web/app/axes/page.tsx` — curve configuration UI with preview
- `packages/web/components/score-breakdown.tsx` — show raw vs effective, veto status
- `packages/web/app/games/[id]/page.tsx` — veto display, curve-affected highlighting
- `packages/web/app/page.tsx` — veto indicator in collection table
- `packages/web/components/collection-table.tsx` — veto visual
- `packages/cli/src/commands/axis.ts` — curve flags on create/update
- `packages/cli/src/commands/score.ts` — expanded breakdown display
- `packages/cli/src/output.ts` — update `BreakdownEntry` and `formatBreakdown`
- `packages/web/lib/curve-math.ts` — **new**: client-side curve math for live preview

### Cross-Cutting Concerns

**Backward compatibility**: Existing axes have no curve config. The default preference shape is "higher is better." For personal axes (native 1-10), this produces identical scores to the current implementation. For BGG complexity (native 1-5), the corrected linear normalization (1-5 to 1-10) replaces the old `weight * 2` mapping (1-5 to 2-10), producing a minor score shift. This is called out in REQ-CURVE-6 as intentional.

**BGG normalization removal**: The current `resolveBggRating` function in `fitness-service.ts:14-27` hardcodes `weight * 2` for complexity and pass-through for community rating. After this change, `resolveBggRating` returns raw native-scale values only. The curve engine handles all normalization to 1-10 effective ratings. This is the core architectural change.

**FitnessBreakdownEntry expansion**: The existing `rating` field currently holds the value that enters the weighted average (already 1-10 scale). After curves, this field becomes the effective rating (post-curve, 1-10). A new `rawValue` field holds the native-scale value. For personal axes with no curve, `rawValue` equals `rating`. For BGG complexity, `rawValue` is 1-5 (BGG weight) while `rating` is the 1-10 effective value. This distinction is what makes the breakdown transparent (REQ-CURVE-16).

**Web UI local type duplication**: The web axes page (`packages/web/app/axes/page.tsx:5-14`) duplicates the `Axis` interface locally instead of importing from shared. When curve fields are added to the shared `Axis` type, the web page's local type must also be updated. This is a known issue (`.lore/issues/duplicated-web-daemon-types.md`). The plan addresses this by noting the files that need local type updates alongside the shared type changes.

## Technical Decisions

### 1. Curve math: power curve with per-side exponent

**Decision**: Use `f(t) = 1 + 9 * (1 - t)^k` where `t` is normalized distance from ideal to endpoint (0 at ideal, 1 at endpoint), and `k` controls curvature.

**Rationale**: This satisfies all spec constraints. At t=0 (ideal), f=10. At t=1 (endpoint), f=1. The curve is smooth, continuous, and monotonic on each side. Different `k` per side enables asymmetric lean (REQ-CURVE-9). The `k` values are calibrated from the tolerance anchors in REQ-CURVE-8.

For higher-is-better and lower-is-better, the function simplifies to a linear map (k=1), which is exactly the linear interpolation specified in REQ-CURVE-11.

### 2. Tolerance calibration

**Decision**: Derive `k` values from the spec's quantitative anchors (REQ-CURVE-8). The anchors define effective ratings at one-third of the native scale range from the ideal. The `k` value that satisfies each anchor depends on where the ideal sits relative to the endpoints, since `t` (the normalized distance) varies.

**Rationale**: The spec gives behavioral anchors, not formulas. The calibration step solves for `k` at a representative ideal position (center of scale) and uses that `k` uniformly. This produces curves that match the spec's descriptions ("I'm not picky" vs "I know exactly what I want") while keeping the implementation simple. The exact `k` values will be determined during Phase 2 and validated against the spec's anchor points. If calibration at center-of-scale doesn't produce satisfactory results at extreme ideal positions, the alternative is to compute `k` dynamically per-axis based on where the ideal sits. Start with the simpler approach.

### 3. Native scale as derived, not stored

**Decision**: Native scales are not stored on the Axis. They're derived from a pure function: `getNativeScale(source, bggField)`. Personal axes always return `{min: 1, max: 10}`. BGG axes return hardcoded scales per `bggField` (`communityRating`: 1-10, `weight`: 1-5).

**Rationale**: The spec (REQ-CURVE-2, REQ-CURVE-3) says personal scales are fixed and BGG scales are hardcoded per field. Storing derived data on the axis creates a synchronization problem. Deriving from source + bggField is a pure function with no data dependency.

### 4. Veto on FitnessResult, not just breakdown

**Decision**: Add `vetoed: boolean`, `vetoedBy: { axisId, axisName, threshold, direction, rawValue } | null`, and `hypotheticalScore: number | null` to `FitnessResult`. When vetoed, `score` is 0 and `hypotheticalScore` holds what the score would have been.

**Rationale**: Veto affects the entire result, not just one breakdown entry. Clients (web, CLI) need to know at the result level whether the game is vetoed, which axis triggered it, and what the score would be otherwise (REQ-CURVE-15). Embedding this only in breakdown entries forces clients to scan all entries to find the veto, which is both awkward and error-prone.

### 5. Curve config fields on Axis

**Decision**: Add these optional fields to the `Axis` interface:

```typescript
preferenceShape?: "higher-is-better" | "lower-is-better" | "sweet-spot";
idealValue?: number | null;       // native-scale value, for sweet-spot
tolerance?: "flexible" | "moderate" | "strict";
leanDirection?: "lower" | "higher" | null;
veto?: { direction: "below" | "above"; threshold: number } | null;
```

All are optional. Missing fields use defaults: `preferenceShape` defaults to `"higher-is-better"`, `tolerance` to `"moderate"`, `leanDirection` to `null` (symmetric), `veto` to `null` (no veto).

**Rationale**: Optional fields preserve backward compatibility. Existing axes serialize without curve config and deserialize cleanly. Defaults are defined in the curve engine, not in the type system, so the engine is the single source of truth for default behavior. `idealValue` is nullable because it's only meaningful for sweet-spot shapes. `veto` uses an object (direction + threshold) because veto direction depends on the axis, not the shape (REQ-CURVE-14).

### 6. Breaking change to `bggOriginal` semantics

**Decision**: The existing `FitnessBreakdownEntry.bggOriginal` field currently stores the BGG value after the `* 2` normalization (e.g., BGG weight 2.9 is stored as `bggOriginal: 5.8`). After this change, `bggOriginal` stores the raw BGG value in native-scale terms (e.g., `bggOriginal: 2.9`). The `rawValue` field on the same entry also holds 2.9. When source is `"override"`, `bggOriginal` shows what BGG says (native scale) and `rawValue` shows what the user entered (also native scale, since personal overrides are 1-10 and personal native scale is 1-10).

**Rationale**: Storing the pre-normalization native value is more honest (you can see what BGG actually reports) and consistent with the spec's mandate that all values be presented in native-scale terms (REQ-CURVE-26). The old behavior (`bggOriginal: 5.8` for a weight of 2.9) leaked the normalization implementation detail to the user. The `score-breakdown.tsx` component already shows `bggOriginal` in its override detail; it will now show the true BGG value.

## Implementation Steps

### Phase 1: Shared Types and Validation

**Files**: `packages/shared/src/types.ts`, `packages/shared/src/validation.ts`, `packages/shared/src/index.ts`
**Addresses**: REQ-CURVE-1, REQ-CURVE-7, REQ-CURVE-13, REQ-CURVE-16
**Expertise**: None

#### Type changes

Add to `packages/shared/src/types.ts`:

```typescript
// Curve configuration types

export type PreferenceShape = "higher-is-better" | "lower-is-better" | "sweet-spot";
export type ToleranceLevel = "flexible" | "moderate" | "strict";
export type LeanDirection = "lower" | "higher";

export interface VetoConfig {
  direction: "below" | "above";
  threshold: number; // native-scale value
}

export interface NativeScale {
  min: number;
  max: number;
}
```

Extend the existing `Axis` interface with optional curve fields:

```typescript
export interface Axis {
  // ... existing fields ...
  preferenceShape?: PreferenceShape;
  idealValue?: number | null;
  tolerance?: ToleranceLevel;
  leanDirection?: LeanDirection | null;
  veto?: VetoConfig | null;
}
```

Extend `FitnessBreakdownEntry`:

```typescript
export interface FitnessBreakdownEntry {
  // ... existing fields ...
  rawValue: number | null; // native-scale value (new)
  effectiveRating: number | null; // post-curve 1-10 value (new, same as rating)
  preferenceShape: PreferenceShape; // which shape was applied (new)
  curveAffected: boolean; // true when curve changed the rating by > 0.5 (new)
}
```

Note: `rating` remains for backward compatibility and holds the same value as `effectiveRating`. Both exist during the transition; the `rating` field is what the existing web and CLI code already reads.

Extend `FitnessResult`:

```typescript
export interface FitnessResult {
  // ... existing fields ...
  vetoed: boolean;
  vetoedBy: {
    axisId: string;
    axisName: string;
    threshold: number; // native-scale
    direction: "below" | "above";
    rawValue: number; // native-scale
  } | null;
  hypotheticalScore: number | null; // score without veto, null when not vetoed
}
```

#### Validation changes

Update `CreateAxisSchema` in `packages/shared/src/validation.ts`:

```typescript
export const CreateAxisSchema = z.object({
  name: z.string().min(1, "Axis name cannot be empty"),
  description: z.string().nullable().optional().default(null),
  weight: z.number().int("Weight must be an integer").min(0).max(100),
  source: z.enum(["personal", "bgg"]).optional().default("personal"),
  bggField: z.string().nullable().optional().default(null),
  // Curve config (all optional, defaults applied by curve engine)
  preferenceShape: z.enum(["higher-is-better", "lower-is-better", "sweet-spot"]).optional(),
  idealValue: z.number().nullable().optional(),
  tolerance: z.enum(["flexible", "moderate", "strict"]).optional(),
  leanDirection: z.enum(["lower", "higher"]).nullable().optional(),
  veto: z
    .object({
      direction: z.enum(["below", "above"]),
      threshold: z.number(),
    })
    .nullable()
    .optional(),
});
```

Update `UpdateAxisSchema` to include the same curve fields (all optional).

Add cross-field validation refinements:

- `idealValue` required when `preferenceShape` is `"sweet-spot"`
- `idealValue` must be within the axis's native scale (this requires knowing source+bggField; validate at the route/service level, not in the schema, since schemas don't have axis context)
- `tolerance` and `leanDirection` only meaningful with `"sweet-spot"` (not an error if provided with other shapes, just ignored)

Re-export new types from `packages/shared/src/index.ts`.

**Tests**: Zod schema validation tests. Verify curve fields are accepted, sweet-spot requires idealValue, veto threshold validates correctly. Verify existing axis payloads (without curve fields) still parse successfully.

**Review gate**: Types define the contract for every downstream phase. Incorrect types propagate everywhere.

---

### Phase 2: Curve Engine (Pure Math, No I/O)

**Files**: `packages/daemon/src/services/curve-engine.ts` (new), `packages/daemon/tests/curve-engine.test.ts` (new)
**Addresses**: REQ-CURVE-2, REQ-CURVE-3, REQ-CURVE-4, REQ-CURVE-5, REQ-CURVE-6, REQ-CURVE-7, REQ-CURVE-8, REQ-CURVE-9, REQ-CURVE-11, REQ-CURVE-12, REQ-CURVE-25
**Expertise**: None (standard math)

Create a pure-function module `curve-engine.ts` following the `elo-engine.ts` pattern:

1. **`getNativeScale(source: AxisSource, bggField: string | null): NativeScale`** — Returns `{min: 1, max: 10}` for personal axes. For BGG axes: `communityRating` returns `{min: 1, max: 10}`, `weight` returns `{min: 1, max: 5}`. Unknown bggField throws (defensive; should not happen with validated data).

2. **`applyPreferenceCurve(rawValue: number, scale: NativeScale, shape: PreferenceShape, config: { idealValue?: number | null, tolerance?: ToleranceLevel, leanDirection?: LeanDirection | null }): number`** — The core function. Returns effective rating on 1-10 scale. Dispatches by shape:
   - **Higher is better** (default): Linear map. `effective = 1 + 9 * (rawValue - scale.min) / (scale.max - scale.min)`. When scale is 1-10, this is identity (REQ-CURVE-6).

   - **Lower is better**: Inverted linear. `effective = 10 - 9 * (rawValue - scale.min) / (scale.max - scale.min)`.

   - **Sweet spot**: Power curve with per-side exponent. For each side of the ideal:
     - Left side (rawValue < ideal): `t = (ideal - rawValue) / (ideal - scale.min)`, then `effective = 1 + 9 * (1 - t)^k_left`
     - Right side (rawValue > ideal): `t = (rawValue - ideal) / (scale.max - ideal)`, then `effective = 1 + 9 * (1 - t)^k_right`
     - At ideal: `effective = 10`

   Tolerance determines the base `k` value. Lean direction skews `k` between sides: the preferred side gets a lower `k` (gentler slope), the avoided side gets a higher `k` (steeper slope).

3. **`calibrateTolerance(tolerance: ToleranceLevel): number`** — Returns the base `k` exponent for the tolerance level. Calibrated against REQ-CURVE-8 anchors at center-of-scale ideal position (where t at one-third-range equals 2/3):
   - Flexible: solve `(1 - 2/3)^k >= 6/9`, giving `k` ≈ 0.37
   - Moderate: solve `(1 - 2/3)^k ≈ 7/18`, giving `k` ≈ 0.85
   - Strict: solve `(1 - 2/3)^k <= 1/6`, giving `k` ≈ 1.63

   Export these as named constants for test verification.

4. **`applyLean(baseK: number, leanDirection: LeanDirection | null, side: "left" | "right"): number`** — When lean is null, returns baseK for both sides. When lean is `"lower"`, the left side (lower values) gets `baseK * 0.6` (gentler) and the right side gets `baseK * 1.5` (steeper). When lean is `"higher"`, the opposite. The 0.6/1.5 multipliers are tuning parameters; the tests verify directional behavior (leaned side produces higher effective ratings at equal distance), not exact multiplier values.

5. **`checkVeto(rawValue: number, veto: VetoConfig | null): boolean`** — Returns true if veto triggers. `direction: "below"` triggers when `rawValue < veto.threshold`. `direction: "above"` triggers when `rawValue > veto.threshold`. Returns false when veto is null.

6. **`computeHigherIsBetterEffective(rawValue: number, scale: NativeScale): number`** — The reference linear map used for REQ-CURVE-17 highlighting. This is the "what would the rating be if the shape were higher-is-better" comparison baseline.

**Tests**: This is the most test-heavy phase. The spec's AI Validation section requires specific curve math tests:

- **Fixed points** (REQ-CURVE-11): For each shape, verify that the documented fixed points produce the expected effective ratings. Higher-is-better: min→1, max→10. Lower-is-better: min→10, max→1. Sweet spot: ideal→10, min→1, max→1.
- **Continuity** (REQ-CURVE-12): Sample 100 evenly spaced points on each side of a sweet spot curve. Verify each point's effective rating is between its neighbors' values (monotonic). Verify no point differs from its neighbors by more than a reasonable delta (smooth).
- **Tolerance anchors** (REQ-CURVE-8): For BGG complexity (scale 1-5) with ideal at 3.0 (center), verify that at distance 1.33 (~range/3): flexible produces ≥ 7, moderate produces 4-5, strict produces ≤ 2.5. For personal axis (scale 1-10) with ideal at 5.5, verify the same constraints at distance 3 (range/3).
- **Asymmetric lean** (REQ-CURVE-9): With ideal at 2.75 on 1-5 scale, lean "toward lower": verify that rawValue 1.5 (1.25 below ideal) produces higher effective rating than rawValue 4.0 (1.25 above ideal). This directly matches the spec's success criterion.
- **Native scales** (REQ-CURVE-2, REQ-CURVE-3): Personal → {1, 10}. communityRating → {1, 10}. weight → {1, 5}. Unknown bggField → throws.
- **Linear identity** (REQ-CURVE-6): Personal axis, higher-is-better: `applyPreferenceCurve(x, {1, 10}, "higher-is-better", {})` returns `x` for every integer 1-10.
- **BGG complexity correction**: Old mapping `weight * 2` mapped 1→2, 5→10 (range 2-10). New linear maps 1→1, 5→10 (range 1-10). Verify at BGG weight 1.0: old produces 2.0, new produces 1.0. At weight 3.0: old produces 6.0, new produces 5.5.
- **Veto**: Below-threshold triggers, at-threshold does not, above-threshold does not. Above-threshold triggers for "above" direction. Null veto never triggers.
- **Edge cases**: Raw value at scale boundaries. Ideal value at scale minimum. Ideal value at scale maximum (one side has zero width; function must handle gracefully without division by zero).

**Review gate**: Curve math must be verified against hand calculations before proceeding. Incorrect math propagates incorrect scores to every game.

---

### Phase 3: Fitness Service Integration

**Files**: `packages/daemon/src/services/fitness-service.ts`, `packages/daemon/tests/fitness-service.test.ts` (new or extended)
**Addresses**: REQ-CURVE-4, REQ-CURVE-6, REQ-CURVE-10, REQ-CURVE-13, REQ-CURVE-14, REQ-CURVE-15, REQ-CURVE-16, REQ-CURVE-17, REQ-CURVE-27, REQ-CURVE-28
**Expertise**: None

This is the critical integration phase. The fitness service is the only consumer of the curve engine, and it's the code path that produces every score in the system.

#### Replace `resolveBggRating`

The existing `resolveBggRating` function (`fitness-service.ts:14-27`) has two jobs: (1) resolve which BGG field to read, and (2) normalize the value. Split these apart:

1. **`resolveBggRawValue(axis: Axis, bggData: BggGameData | null): number | null`** — Returns the raw native-scale BGG value. For `communityRating`, returns `bggData.communityRating`. For `weight`, returns `bggData.weight` (raw 1-5, no `* 2`). Returns null when no data.

2. The curve engine's `applyPreferenceCurve` handles all normalization to 1-10.

#### Scoring loop changes

In `calculateScore`, the loop over axes becomes:

```
vetoTriggered = false
vetoInfo = null

for each axis:
  1. Determine raw value (personal rating, BGG raw value, or override)
  2. Get native scale from curve engine
  3. Check veto (raw value vs axis.veto) — if triggered, flag vetoTriggered and record vetoInfo
     (do NOT short-circuit; continue processing all axes for the full breakdown)
  4. Apply preference curve to get effective rating (1-10)
  5. Compute "what would higher-is-better produce" for highlighting (REQ-CURVE-17)
  6. Build expanded breakdown entry with rawValue, effectiveRating, preferenceShape, curveAffected
  7. Accumulate weighted sum using effective rating

after loop:
  hypotheticalScore = weightedSum / weightSum (the score as if no veto)
  if vetoTriggered: score = 0, hypotheticalScore = hypotheticalScore
  else: score = hypotheticalScore, hypotheticalScore = null
```

Key change: the `rating` field in breakdown entries now holds the effective (post-curve) value. The new `rawValue` field holds the native-scale value. For personal axes with higher-is-better, these are identical. For BGG complexity with any shape, they differ (raw is 1-5, effective is 1-10).

#### Veto handling

When a veto triggers (REQ-CURVE-13, REQ-CURVE-14):

1. Record which axis triggered it and the raw value vs threshold.
2. Continue processing all axes to build the full breakdown (the breakdown still shows what every axis contributes).
3. Compute the hypothetical score (the weighted average as if no veto existed).
4. Set the actual score to 0.
5. Return `FitnessResult` with `vetoed: true`, `vetoedBy` populated, `hypotheticalScore` set, and `score: 0`.

Only the first triggering veto is recorded in `vetoedBy`. If multiple axes veto, the first one encountered (in axis order) is reported. This is a simplification; the spec doesn't address multiple simultaneous vetoes.

#### Backward compatibility test

Write a specific test that constructs a collection with:

- 2 personal axes (higher-is-better, native 1-10)
- 2 BGG axes (communityRating and weight)
- 3 games with various ratings

Compute scores with the old `resolveBggRating` logic (inline in the test) and the new curve engine. Verify:

- Personal axis scores are identical (REQ-CURVE-6).
- BGG communityRating scores are identical (native 1-10, higher-is-better is identity).
- BGG complexity scores differ by the expected amount: at weight 2.9, old produces `5.8`, new produces `1 + 9 * (2.9 - 1) / (5 - 1) = 5.275`. Document this shift.

#### `bggOriginal` semantics change

When source is `"override"` and the axis is BGG-derived, `bggOriginal` now stores the raw BGG value in native-scale terms (e.g., `2.9` for weight, not `5.8`). Update the assignment in the scoring loop accordingly.

**Tests**:

- Full scoring with each preference shape.
- Veto triggers: score becomes 0, hypothetical score is correct, breakdown is complete.
- Veto before curve: raw value that would veto also gets its effective rating computed (for the hypothetical).
- Curve-affected highlighting: axis with sweet-spot curve produces `curveAffected: true` when effective differs from higher-is-better by > 0.5.
- Missing curve config: axes without curve fields score identically to the current implementation (personal axes).
- Removing a curve: changing preferenceShape back to higher-is-better produces the same scores as default.
- Multiple vetoes: game that triggers veto on two axes still scores 0, `vetoedBy` reports the first triggering axis, hypothetical score computed from all axes.
- Curve-affected threshold boundary: axis producing effective rating exactly 0.5 different from higher-is-better baseline has `curveAffected: false`; 0.51 difference has `curveAffected: true`.

**Review gate**: This phase changes every score in the system. Review before building client-facing changes.

---

### Phase 4: API and Service Layer Changes

**Files**: `packages/daemon/src/routes/axes.ts`, `packages/daemon/src/services/axis-service.ts`, `packages/shared/src/validation.ts` (refinements), `packages/daemon/tests/` (route tests)
**Addresses**: REQ-CURVE-18 (API foundation), REQ-CURVE-21 (API foundation), REQ-CURVE-23 (API foundation)
**Expertise**: None

#### Axis service changes

In `axis-service.ts`, update `createAxis` and `updateAxis` to pass through curve fields:

```typescript
// In createAxis:
const axis: Axis = {
  // ... existing fields ...
  preferenceShape: parsed.preferenceShape, // undefined if not provided
  idealValue: parsed.idealValue,
  tolerance: parsed.tolerance,
  leanDirection: parsed.leanDirection,
  veto: parsed.veto,
};

// In updateAxis:
if (parsed.preferenceShape !== undefined) axis.preferenceShape = parsed.preferenceShape;
if (parsed.idealValue !== undefined) axis.idealValue = parsed.idealValue;
if (parsed.tolerance !== undefined) axis.tolerance = parsed.tolerance;
if (parsed.leanDirection !== undefined) axis.leanDirection = parsed.leanDirection;
if (parsed.veto !== undefined) axis.veto = parsed.veto;
```

#### Cross-field validation

Add validation at the service level (not schema level, since schema doesn't know the axis context):

- When `preferenceShape` is `"sweet-spot"`, `idealValue` must be provided and must fall within the axis's native scale. Use `getNativeScale(axis.source, axis.bggField)` to determine bounds.
- When updating an axis to `"sweet-spot"` without providing `idealValue`, check if the axis already has one stored. If not, reject.
- When `preferenceShape` is not `"sweet-spot"`, clear `idealValue`, `tolerance`, and `leanDirection` to avoid stale config confusion.

#### Route changes

The axis routes (`routes/axes.ts`) don't need structural changes. The Zod schemas already accept the new fields (Phase 1). The routes pass parsed input to the service, which handles it. The operation descriptions should be updated to reflect that axis create/update now accept curve configuration.

**Tests**: Route-level tests using `app.request()`:

- Create axis with curve config, verify stored correctly.
- Update axis to sweet-spot, verify idealValue required.
- Update axis from sweet-spot to higher-is-better, verify idealValue/tolerance/lean cleared.
- Create axis with veto, verify stored.
- Update axis to add/remove veto.
- Existing create/update payloads (no curve fields) still work.

**Review gate**: API surface should be reviewed before Phase 5/6 consume it.

---

### Phase 5: Web UI

**Files**: `packages/web/app/axes/page.tsx`, `packages/web/components/score-breakdown.tsx`, `packages/web/app/games/[id]/page.tsx`, `packages/web/app/page.tsx`, `packages/web/components/collection-table.tsx`, `packages/web/lib/api.ts`, `packages/web/lib/curve-math.ts` (new), global CSS
**Addresses**: REQ-CURVE-18, REQ-CURVE-19, REQ-CURVE-20, REQ-CURVE-21, REQ-CURVE-22, REQ-CURVE-26
**Expertise**: Frontend

#### Axis configuration (axes page)

Expand the create and edit forms on `/axes`:

**Shape selector**: Radio buttons or segmented control with three options: "Higher is better" (default), "Lower is better", "Sweet spot." Each option has a one-line plain-language description:

- Higher is better: "Higher values on this axis mean a better fit."
- Lower is better: "Lower values mean a better fit."
- Sweet spot: "There's an ideal value, and further from it is worse."

**Sweet spot controls** (visible only when sweet-spot selected):

- Ideal value: number input (or slider) with min/max matching the native scale. For BGG complexity, the slider ranges 1-5 with 0.25 step. For personal axes, 1-10 with 1 step. Label shows the native scale context ("BGG Weight" for complexity, "Rating" for personal).
- Tolerance: three-option selector (Flexible / Moderate / Strict) with descriptions matching REQ-CURVE-8 language.
- Lean direction: optional toggle. "Symmetric" (default), "Prefer lower", "Prefer higher." Hidden if tolerance is not relevant.

**Curve preview** (REQ-CURVE-19, REQ-CURVE-20): A small canvas or SVG element that renders the curve shape. X-axis is native scale values, Y-axis is effective 1-10 rating. Updates live as the user changes ideal, tolerance, and lean. The preview doesn't need to be pixel-perfect; a simple line chart with labeled axes is sufficient. Show a few sample points: "BGG Weight 2.0 → Effective 7.2" as tooltips or annotations.

Implementation approach: compute the curve in the browser using the same math as the curve engine. Create `packages/web/lib/curve-math.ts` containing the pure curve functions (`applyPreferenceCurve`, `calibrateTolerance`, `applyLean`, `getNativeScale`). This duplicates ~50 lines of math from `curve-engine.ts`, but the functions are pure and stable, and client-side computation enables instant preview updates without API round-trips.

**Veto threshold** (REQ-CURVE-21): Separate section below curve config, clearly labeled "Veto Threshold." Checkbox to enable, direction selector ("Veto games below" / "Veto games above"), threshold value input in native-scale terms. Enable confirmation dialog before saving ("This will set any game scoring [below/above] [threshold] on this axis to fitness 0. Continue?").

**Local type update**: The axes page duplicates the `Axis` interface locally (`page.tsx:5-14`). Add the curve fields to this local interface to match the shared type.

#### Score breakdown (game detail page)

Update `score-breakdown.tsx` to show expanded breakdown:

- **Remove the broken "scaled" rendering logic.** The existing lines 42-43 show `BGG value: {bggOriginal.toFixed(1)} → scaled {Math.round(bggOriginal)}`. After the `bggOriginal` semantics change (Technical Decision 6), this renders nonsense. Delete the entire `breakdown-override-detail` div and replace with the new raw/effective column approach below.
- Add "Raw" column between "Axis" and "Rating." Shows native-scale value when it differs from the effective rating. For personal axes with higher-is-better, the raw column is empty or shows the same value. For BGG complexity, shows "2.9" while Rating shows "5.3". For override rows, show the user's rating as the raw value and "BGG: {bggOriginal}" in a subtitle.
- Rename "Rating" header to "Effective" for clarity.
- Add visual indicator (highlight class, small icon) on rows where `curveAffected` is true (REQ-CURVE-17).
- When the game is vetoed: show a veto banner above the breakdown table with the triggering axis, threshold, raw value, and hypothetical score (REQ-CURVE-15). Style the table with reduced opacity or a strikethrough effect to indicate the scores are hypothetical.

#### Collection page veto display (REQ-CURVE-22)

In the collection table, vetoed games (score = 0 with `vetoed: true`) should be visually distinct from simply low-scoring games. Add a "VETOED" badge or icon next to the score, styled differently from the score itself (e.g., red/muted, with a tooltip showing which axis triggered the veto).

The collection table already receives `GameWithScore[]`, and `GameWithScore.score` is typed as `FitnessResult | null` in shared types. The `vetoed` field added in Phase 1 will be available. In the score cell rendering, when `score.vetoed` is true: replace the numeric score with a "VETOED" badge (red/muted background, smaller text showing the hypothetical score underneath). This is a separate DOM element from the score display, not a modifier on the existing score cell. Add a CSS class `score-vetoed` for styling.

#### API additions

Update `packages/web/lib/api.ts`: the existing `createAxis` and `updateAxis` functions need to accept curve config in their body parameters. No new API functions are needed; curves flow through the existing axis endpoints.

**Tests**: No component-level tests required for server-rendered pages. Visual verification against the spec's success criteria descriptions. The curve preview behavior is tested by the curve engine unit tests (same math).

**Review gate**: Verify the curve configuration UX is intuitive. Check that native-scale values are shown correctly for both personal and BGG axes (REQ-CURVE-26). Verify veto display is visually distinct.

---

### Phase 6: CLI

**Files**: `packages/cli/src/commands/axis.ts`, `packages/cli/src/commands/score.ts`, `packages/cli/src/output.ts`, `packages/cli/src/index.ts`
**Addresses**: REQ-CURVE-23, REQ-CURVE-24, REQ-CURVE-26
**Expertise**: None

#### Axis commands (REQ-CURVE-23)

Extend `axisCreate` and `axisUpdate` with new flags:

- `--shape higher-is-better|lower-is-better|sweet-spot`
- `--ideal <value>` (native-scale)
- `--tolerance flexible|moderate|strict`
- `--lean lower|higher|none`
- `--veto-below <value>` (native-scale)
- `--veto-above <value>` (native-scale)
- `--no-veto` (remove veto)

The `--veto-below` and `--veto-above` flags are mutually exclusive. They map to `veto: { direction: "below"|"above", threshold: value }`.

Update arg parsing in `index.ts` to recognize these flags and pass them in the options object to the axis command functions.

`axisList` output: add a "Shape" column showing the preference shape (abbreviated: "linear↑", "linear↓", "sweet@2.75"). Show veto status with a "V" indicator.

#### Score display (REQ-CURVE-24)

Update `BreakdownEntry` in `output.ts` to include `rawValue`, `effectiveRating`, `preferenceShape`, `curveAffected`.

Update `formatBreakdown` to show:

- "Raw" column (native-scale value) when it differs from effective.
- A `*` marker on curve-affected rows.
- When the game is vetoed: print a "VETOED" line before the breakdown, showing the triggering axis, threshold, and hypothetical score. Print the breakdown underneath (as hypothetical).

#### Score get enrichment

In `scoreGet` (`score.ts`), when the response includes `vetoed: true`, format the output to show:

```
GameName
Fitness: VETOED (hypothetical: 7.2)
Veto: "Wife will play it" scored 3 (threshold: below 4)

[breakdown table]
```

**Tests**: Verify arg parsing for new flags. Verify output formatting for vetoed games and curve-affected breakdown entries.

**Review gate**: Verify all new flags produce correct output for both human and `--json` modes. JSON output mirrors the daemon's `FitnessResult` response directly (all new fields included: `vetoed`, `vetoedBy`, `hypotheticalScore`, expanded breakdown entries with `rawValue`, `effectiveRating`, `curveAffected`). No custom JSON formatting needed.

---

### Phase 7: Integration Verification

**Files**: No new files. Run existing + new tests.
**Addresses**: All REQ-CURVE-\* (cross-cutting verification)
**Expertise**: Fresh-context review agent

1. Run `bun run test` across all packages. All tests must pass.
2. Run `bun run typecheck`. Clean output required.
3. Run `bun run lint`. Clean output required.
4. Launch a sub-agent to read the spec at `.lore/specs/utility-curves.md` and verify each of the 28 requirements against the implementation. The agent checks:
   - Each REQ-CURVE-N is implemented in the code.
   - Automated success criteria from the spec are covered by tests.
   - Manual verification scenarios are achievable (describe how to demo each one).
5. Verify the spec's success criteria:
   - Sweet spot at 2.75 on Complexity: game with BGG weight 2.75 scores higher than games with weight 1 or 5.
   - Lower-is-better on personal axis: game rated 2 scores higher than game rated 8.
   - Asymmetric lean: BGG weight 1.5 ranks higher than 4.0 on complexity axis with ideal 2.75 and lean "toward lower."
   - Changing shape immediately recalculates scores.
   - Curve preview shows native scale with live updates.
   - Vetoed game shows fitness 0 with explanation and hypothetical.
   - Existing personal scores unchanged. BGG complexity scores shift as documented.
   - Breakdown shows raw and effective values.

## Delegation Guide

This plan is designed for Dalton (Guild Artificer) as the primary implementer. Phase structure supports commission-per-phase with review gates.

**Phase 1**: Straightforward type definitions and schema updates. Low risk. Can proceed quickly.
**Phase 2**: Pure math, high test density. Must be reviewed before Phase 3 (incorrect curve math propagates everywhere). The tolerance calibration step requires solving for exponent values from the spec's anchors. The implementer should compute these, document them as constants, and verify with test cases.
**Phase 3**: The critical integration phase. Changes the scoring path for every game. Backward compatibility test is essential. Warrants careful review.
**Phase 4**: Follows established route/service patterns. Review API shapes before Phase 5/6 consume them.
**Phase 5**: Largest surface area. The curve preview is the most novel UI element. Reference the spec's descriptions of what the user should see. Can run in parallel with Phase 6 after Phase 4 is reviewed.
**Phase 6**: CLI follows established patterns. Lowest risk. Can run in parallel with Phase 5.
**Phase 7**: Thorne (Guild Warden) should run the spec verification. Fresh context catches what the implementer misses.

Suggested commission cadence:

- Phase 1+2 as one commission (types + math are fast, tightly coupled)
- Phase 3 as one commission (critical scoring integration, needs focused review)
- Phase 4 as one commission (API surface, gateway to clients)
- Phase 5 as one commission (web UI, largest surface area)
- Phase 6 as one commission (CLI, can run parallel with Phase 5 after Phase 4 review)
- Phase 7 as a Thorne review commission

## Open Questions

1. **Multiple simultaneous vetoes**: The plan records only the first triggering veto. If a game fails two veto thresholds, the user sees only one. This could be extended to report all vetoed axes, but the spec doesn't address it and the simplification is reasonable for now.

2. **Tolerance k-value calibration**: The plan proposes solving for `k` at center-of-scale ideal position and using that uniformly. If this produces unsatisfactory curve shapes at extreme ideal positions (near scale boundaries), the fallback is dynamic `k` computation per-axis. Start simple; the tests will reveal if the fixed approach has problems.

3. **BGG complexity score migration notice**: The corrected normalization changes existing scores. The shift is small (e.g., weight 2.9 goes from effective 5.8 to effective 5.275) and the spec calls it out as intentional (REQ-CURVE-6). No user notification mechanism exists in the app. If the user is surprised by score changes, the explanation is in the fitness breakdown (which now shows the curve). Consider whether a one-time notice in the UI would help, but this is not required by the spec.
