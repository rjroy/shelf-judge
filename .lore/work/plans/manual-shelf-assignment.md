---
title: "Implementation plan: manual shelf assignment"
date: 2026-06-27
status: draft
tags: [plan, shelf-layout, manual-assignment, capacity, bin-packing]
modules: [shared, daemon, web, cli]
related:
  - .lore/work/specs/manual-shelf-assignment.md
  - .lore/specs/features/shelf-capacity.md
  - .lore/designs/similarity-weighted-bin-packing.md
---

# Implementation plan: manual shelf assignment

## Goal

Implement `.lore/work/specs/manual-shelf-assignment.md` (REQ-SHELF-ASSIGN-1 through REQ-SHELF-ASSIGN-24): an owned, measured game can be pinned to a configured shelf; pinned games reserve capacity first; automatic packing fills what remains; invalid fixed placements are reported as assignment conflicts rather than moved or forced into impossible space.

Implementation ends after code, tests, and behavioral validation. Spec approval and implementation execution remain separate user decisions.

## Current system boundaries

- `Game` and shelf-capacity response types live in `packages/shared/src/types.ts`; collection loading backfills newer game fields in `packages/daemon/src/services/storage-service.ts`.
- `GameService` owns persisted game mutations. `setOwnership` and `setBoxDimensions` are the closest patterns for the new assignment mutation.
- `ShelfService` owns full-config replacement and unit/shelf removal. Shelf removal currently returns only the updated unit or `void`, and does not mutate collection data.
- `CapacityService` filters owned/measured games, performs an unfittable pre-pass, adapts games and shelves into generic pack items/bins, then maps pack output into API response types.
- The generic packer has hard and soft location overrides. A hard override currently bypasses fit checks and can create a synthetic bin; that behavior cannot directly represent this feature's fixed-but-must-fit semantics.
- The game detail page already hosts `BoxDimensionsForm`; shelf configuration and capacity have dedicated pages. CLI game edits and shelf capacity output already provide the corresponding command surfaces.

## Decisions made concrete for implementation

- Persist the selection as `Game.manualShelfId: string | null`.
- Use `PUT /api/games/:id/shelf-assignment` with `{ shelfId: string | null }`; this is idempotent and parallels box-dimension editing.
- Add `shelf-judge game assign-shelf <game-id> <shelf-id>` and `shelf-judge game clear-shelf <game-id>` rather than overloading dimension flags on `game edit`.
- Process pinned games in ascending game ID order. This is deterministic independent of fitness sorting returned by `listGames()`.
- Extend the generic packer's override contract with fixed placement rejection output instead of changing existing hard-override semantics. Existing consumers and tests for hard/soft overrides remain compatible.
- A shelf mutation response that can remove shelves returns `clearedAssignmentCount`; callers that currently consume only the updated unit/config are updated with the new wrapper shape.

## Step 1: Extend shared data and response contracts

**Files:**

- `packages/shared/src/types.ts`
- Any test fixture or inline `Game` literal identified by type checking

**Changes:**

1. Add `manualShelfId: string | null` to `Game`.
2. Add an assignment-source discriminator such as `assignmentSource: "manual" | "automatic"` to `AssignedGame`.
3. Add an `AssignmentConflict` response type containing game ID/name, shelf ID/name, unit ID/name, box dimensions, and reason.
4. Extend `ShelfCapacityResult` with `assignmentConflicts` and ensure its placement-problem boolean semantics cover conflicts as well as ordinary overflow. Prefer an explicit aggregate such as `hasPlacementProblems`; retain `overflowing` for ordinary overflow compatibility.
5. Add shared response types for shelf-config/unit mutations that include `clearedAssignmentCount` and the updated entity.
6. Keep legacy normalization in the daemon storage boundary; the shared package has no collection storage schema today and MUST NOT gain one solely for this field.

**Validation gate:**

- Shared package type-check and tests pass.
- Shared types and representative fixtures compile with the new field and response contracts.
- Response types can represent manual placement, automatic placement, and assignment conflict without overloading `unfittableGames` or `overflowGames`.

## Step 2: Add game assignment persistence and API mutation

**Files:**

- `packages/daemon/src/services/storage-service.ts`
- `packages/daemon/src/services/game-service.ts`
- `packages/daemon/src/routes/games.ts`
- `packages/daemon/tests/storage-backfill.test.ts`
- `packages/daemon/tests/services/game-service.test.ts`
- `packages/daemon/tests/routes/games.test.ts`
- `packages/daemon/tests/helpers/test-app.ts` and affected service mocks

**Changes:**

1. Backfill `manualShelfId = null` while loading legacy collection games.
2. Initialize the field to `null` in every game creation/import path.
3. Add `GameService.setManualShelf(id, shelfId)`:
   - find the game;
   - when setting, require owned status and complete dimensions;
   - load the shelf configuration and require the shelf ID to exist;
   - set or clear the field, update timestamps, and persist once.
4. Update `setOwnership` to clear `manualShelfId` in the same collection write when moving a game to previously owned.
5. Define and validate `{ shelfId: string | null }` on `PUT /games/:id/shelf-assignment`, return `{ game }`, and register an idempotent operation definition.
6. Return stable client-visible status codes: 404 for a missing game or shelf and 400 for ownership/dimension preconditions.

**Validation gate:**

- Service and route tests cover set, replace, clear, unknown shelf, unmeasured game, previously owned game, and missing game.
- Failed validation leaves the stored collection unchanged.
- Ownership transition clears the assignment in the same persisted game update.

## Step 3: Make shelf removal clean up assignments coherently

**Files:**

- `packages/daemon/src/services/shelf-service.ts`
- `packages/daemon/src/routes/shelf.ts`
- `packages/daemon/src/services/storage-service.ts` if a coordinated-write helper is required
- `packages/daemon/tests/shelf-service.test.ts`
- `packages/daemon/tests/shelf-routes.test.ts`
- `packages/web/app/shelves/page.tsx`
- `packages/cli/src/commands/shelf.ts`

**Changes:**

1. For `setConfig`, `updateUnit`, and `removeUnit`, compare existing shelf IDs with the proposed result before saving.
2. Find collection games whose `manualShelfId` references a removed ID, clear those values, and update affected game/collection timestamps.
3. Coordinate shelf-config and collection persistence as one service operation. Preserve original snapshots and restore the first file if the second write fails; do not return success unless both final files agree. Surface a hard error if rollback itself fails.
4. Return `clearedAssignmentCount` from all operations capable of removing shelves. Update daemon route response shapes, the web shelf editor fetch helpers, and CLI shelf mutation parsing.
5. Show the cleared count after a successful destructive action when it is nonzero.

**Validation gate:**

- Tests cover deleting one shelf through `updateUnit`, deleting a unit, and replacing the full config.
- Only assignments to removed shelf IDs are cleared; reordering, renaming, or resizing a shelf with the same ID preserves assignments.
- Simulated failure of either write does not return success and does not leave a silently dangling assignment.

## Step 4: Add fixed-fit placement support to the generic packer

**Files:**

- `packages/daemon/src/services/bin-packing.ts`
- `packages/daemon/tests/bin-packing.test.ts`
- `.lore/designs/similarity-weighted-bin-packing.md` after behavior is verified

**Changes:**

1. Add an explicit override mode for “fixed to this existing bin, but reject if it does not fit,” keeping current hard and soft behavior intact for compatibility.
2. In phase 1, process fixed-fit items in input order. Place each only when the target bin exists and the item fits the bin's current remaining dimensions.
3. Remove rejected fixed-fit items from later automatic phases and return their IDs plus a machine-readable reason (`missing-bin`, `shape`, or `remaining-capacity`) in `PackResult`.
4. Ensure accepted fixed-fit items update remaining dimensions and participate in similarity/grading exactly like other placed items.
5. Document the new override behavior in the implemented algorithm design after tests establish the contract.

**Validation gate:**

- Existing bin-packing tests remain unchanged and pass for current hard/soft semantics.
- New tests prove fixed-fit items reserve space before phase 2, are never reassigned, reject missing/shape/cumulative-capacity cases, and produce deterministic results.

## Step 5: Integrate manual assignments into capacity calculation

**Files:**

- `packages/daemon/src/services/capacity-service.ts`
- `packages/daemon/tests/capacity-service.test.ts`
- `packages/daemon/tests/shelf-routes.test.ts`
- A focused integration test under `packages/daemon/tests/integration/` if route/service tests do not exercise the full persisted flow

**Changes:**

1. Partition measured owned games into pinned and automatic groups before the ordinary geometric pre-pass.
2. Sort pinned games by game ID and build fixed-fit pack items with their saved shelf IDs. Build automatic items using the existing adapter behavior.
3. Keep pinned games out of ordinary `unfittableGames`; map rejected fixed-fit output into `assignmentConflicts` with resolved shelf/unit context and human-readable reasons.
4. Run the existing unfittable pre-pass only for automatic games, then pack accepted candidates after pinned items have reserved space.
5. Mark each successful `AssignedGame` as manual or automatic.
6. Compute used volume, utilization, and grade from all successful placements. Set aggregate placement-problem state when conflicts, unfittable games, or overflow games exist, while preserving the existing meaning of ordinary overflow fields.
7. Handle defensive legacy/corrupt dangling shelf IDs as conflicts even though normal shelf mutations clear them.

**Validation gate:**

- A pin to a nonpreferred shelf is honored before automatic placement.
- Repeated runs return the same pinned order and result.
- Shape and cumulative-capacity failures appear only as assignment conflicts and retain persisted assignments.
- Automatic-only scenarios retain current results and ordering.
- Empty configuration, no-dimensions, unconstrained-height, and previously-owned edge cases remain covered.

## Step 6: Add the game-detail web control and capacity explanations

**Files:**

- New `packages/web/components/shelf-assignment-form.tsx`
- `packages/web/app/games/[id]/page.tsx`
- `packages/web/lib/api.ts`
- `packages/web/app/capacity/page.tsx`
- `packages/web/components/capacity-indicator.tsx`
- `packages/web/app/globals.css`
- New or extended tests under `packages/web/tests/`

**Changes:**

1. Load shelf configuration for the game detail server component and pass flattened unit-qualified options to a client assignment form.
2. Place the form next to Box Dimensions. Show `Automatic (fill shelves)` plus entries formatted as `Unit name — Shelf name`.
3. Disable manual selection and explain the requirement when dimensions are missing or the game is previously owned.
4. Save through the daemon proxy, preserve the current value on load, show mutation errors, and refresh server data after success.
5. Label manual games in each capacity shelf card.
6. Add an assignment-conflicts section with links to affected games, selected shelf/unit context, dimensions, and reason.
7. Update the collection capacity indicator so conflicts contribute to its warning count/state without being described as ordinary displaced overflow.

**Validation gate:**

- Component tests cover option labels, selected state, automatic clearing, disabled preconditions, request payload, error state, and refresh behavior.
- Capacity rendering tests distinguish manual/automatic placements and conflicts.
- Run a browser smoke check for game detail and capacity pages at narrow and desktop widths.

## Step 7: Add CLI assignment commands and conflict output

**Files:**

- `packages/cli/src/commands/game.ts`
- `packages/cli/src/commands/shelf.ts`
- `packages/cli/src/index.ts`
- `packages/cli/tests/commands/game.test.ts`
- `packages/cli/tests/commands/shelf.test.ts`
- `packages/cli/tests/output.test.ts` if table formatting changes

**Changes:**

1. Register `game assign-shelf` and `game clear-shelf`, validate positional arguments, and call the game assignment endpoint.
2. Include dimension-precondition guidance in command usage/help and preserve structured JSON output.
3. Add an assignment marker/source column to detailed capacity output.
4. Add a distinct assignment-conflicts section before ordinary unfittable/displaced sections.
5. Update shelf removal commands to report nonzero cleared-assignment counts from Step 3.

**Validation gate:**

- CLI tests cover usage errors, request paths/payloads, human-readable success/error output, JSON output, manual labels, and conflict rendering.

## Step 8: Final validation against the source spec

1. Run formatting, lint, type-check, and all package test suites defined by the root/package scripts.
2. Execute every behavioral scenario in the spec's AI Validation section, recording any scenario not represented by an automated test.
3. Inspect the final diff for unrelated changes and confirm every requirement REQ-SHELF-ASSIGN-1 through REQ-SHELF-ASSIGN-24 maps to implementation and test evidence.
4. Verify help/operation discovery includes the assignment endpoint and CLI commands.
5. Verify legacy collection loading, shelf deletion cleanup, fixed placement, conflict display, and automatic fallback in one end-to-end persisted-data scenario.
6. Update this plan status only after implementation and validation are complete; do not mark the source spec implemented until all validation gates pass.

## Requirement coverage

| Requirements | Plan steps |
| --- | --- |
| REQ-SHELF-ASSIGN-1–2 | 1, 2 |
| REQ-SHELF-ASSIGN-3–5 | 2 |
| REQ-SHELF-ASSIGN-6 | 3 |
| REQ-SHELF-ASSIGN-7–9 | 1, 2 |
| REQ-SHELF-ASSIGN-10–17 | 4, 5 |
| REQ-SHELF-ASSIGN-18–22 | 6 |
| REQ-SHELF-ASSIGN-23–24 | 7 |
| All behavioral validation | 8 |

## Risks and review notes

- **Cross-file consistency:** shelf configuration and collection are separate JSON files. Step 3 requires explicit rollback behavior; two independent atomic renames are not a true transaction. Tests must cover partial-write failure rather than assuming atomicity across both files.
- **Generic algorithm compatibility:** changing existing hard-override behavior would break its documented use for synthetic/dimensionless bins. A separate fixed-fit mode contains the feature-specific constraint.
- **Response compatibility:** wrapping shelf mutation results affects web and CLI consumers. Update all callers in the same step and preserve fields where practical.
- **Legacy fixtures:** adding a required field to `Game` will touch many inline test objects. Prefer a shared fixture builder where already available; avoid broad unrelated test refactors.
- **Conflict terminology:** manual conflicts, geometric unfittable games, and displacement overflow are different user actions and must remain separate in types and UI copy.

## Fresh-eyes review

- Every spec requirement is mapped to a step and validation gate.
- The plan identifies the only multi-file persistence boundary and includes failure-path tests.
- The packing change preserves existing override semantics instead of silently redefining them.
- The plan makes deterministic order, endpoint shape, CLI surface, and aggregate warning semantics explicit so implementation does not need product guesses.
- No specialist dependency is required; the highest-risk work is the generic packer contract and coordinated shelf/collection persistence.
