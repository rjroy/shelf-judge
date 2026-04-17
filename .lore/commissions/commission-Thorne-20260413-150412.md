---
title: "Commission: Shelf Capacity: Final Validation (C20)"
date: 2026-04-13
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Final cross-cutting review of the complete shelf capacity feature (Phase 12).\n\n**Read for context:**\n- `.lore/specs/shelf-capacity.md` (all requirements REQ-SHELF-1 through REQ-SHELF-36)\n- `.lore/plans/shelf-capacity.md` (Phase 12 validation checklist)\n- `.lore/designs/similarity-weighted-bin-packing.md` (algorithm design)\n\n**Validation checklist:**\n1. All shelf config CRUD endpoints implemented and tested\n2. Capacity endpoint implemented and tested\n3. Web client helpers AND CLI commands cover ALL endpoints (client/daemon divergence)\n4. `Game.boxDimensions` doesn't break existing serialization (null default, backfill)\n5. Bin-packing algorithm has NO imports from `@shelf-judge/shared` (standalone)\n6. Adapter correctly inverts compositeDistance for similarity\n7. Rotation edge cases: fits only when rotated, exactly shelf-sized, 0.1 in too large\n8. Unconstrained-height shelves: capacityIn3=null, utilization=null\n9. Unfittable games excluded from algorithm (pre-pass, not Phase 4)\n10. Capacity endpoint returns configured:false when no units (not 400)\n11. Web UI renders correctly in light and dark mode\n12. Run `bun run test`, `bun run typecheck`, `bun run lint`\n\n**Files to review across all packages:**\n- `packages/shared/src/types.ts`\n- `packages/daemon/src/services/bin-packing.ts`\n- `packages/daemon/src/services/capacity-service.ts`\n- `packages/daemon/src/services/shelf-service.ts`\n- `packages/daemon/src/routes/shelf.ts`\n- `packages/daemon/src/routes/games.ts`\n- `packages/daemon/tests/` (all shelf/capacity/bin-packing tests)\n- `packages/web/lib/api.ts`\n- `packages/web/app/shelves/page.tsx`\n- `packages/web/app/capacity/page.tsx`\n- `packages/web/app/collection/page.tsx`\n- `packages/cli/src/commands/shelf.ts`\n\nThis is the final gate. Record all findings."
dependencies:
  - commission-Dalton-20260413-150356
linked_artifacts:
  - packages/daemon/src/services/capacity-service.ts

  - packages/daemon/src/services/bin-packing.ts
  - packages/daemon/src/services/storage-service.ts
  - packages/daemon/tests/capacity-service.test.ts
  - packages/web/app/capacity/page.tsx
  - packages/web/app/collection/page.tsx
  - .lore/specs/shelf-capacity.md
  - .lore/designs/similarity-weighted-bin-packing.md
  - packages/daemon/src/services/bin-packing.ts
  - packages/daemon/src/services/storage-service.ts
  - packages/daemon/tests/capacity-service.test.ts
  - packages/web/app/capacity/page.tsx
  - packages/web/app/collection/page.tsx
  - .lore/specs/shelf-capacity.md
  - .lore/designs/similarity-weighted-bin-packing.md
activity_timeline:
  - timestamp: 2026-04-13T22:04:12.967Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T22:10:22.777Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-17T04:01:00.237Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-17T04:01:00.240Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-17T04:01:00.267Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-17T04:01:22.480Z
    event: progress_report
    reason: "Read spec, plan, and algorithm design doc. Beginning code review across packages."
  - timestamp: 2026-04-17T04:08:01.262Z
    event: progress_report
    reason: "Confirmed axis-semantic bug in capacity-service adapter (REQ-SHELF-1 violation). Running verification commands."
  - timestamp: 2026-04-17T04:13:02.979Z
    event: result_submitted
    reason: "Phase 12 cross-cutting review of the shelf capacity feature. Inspected spec REQ-SHELF-1 through REQ-SHELF-36, daemon services/routes, shared types, web UI pages, CLI commands, and test coverage. Findings recorded below in priority order. Checklist item 12 (bun test/typecheck/lint) was not executed — I have no Bash access.\n\n---\n\n## CRITICAL\n\n### 1. Axis-0 semantic bug: the \"height\" label is load-bearing, contradicting REQ-SHELF-1\n\n**Where:** `packages/daemon/src/services/capacity-service.ts:201-211`\n\n```ts\nfunction boxToTuple(dims: BoxDimensions): [number, number, number] {\n  // Algorithm axis 0 = height (the axis that gets consumed along the shelf length\n  // when forceAxis0Width is on).\n  return [dims.height, dims.width, dims.depth];\n}\nfunction shelfToBinDims(shelf: Shelf): [number, number, number] {\n  const h = shelf.height === null ? UNCONSTRAINED_HEIGHT_SENTINEL : shelf.height;\n  return [h, shelf.width, shelf.depth];\n}\n```\n\n**What's wrong:** Both adapters map algorithm axis 0 to the `height` field of the stored record. `bin-packing.ts` with `forceAxis0Width: true` locks axis 0 (see `bin-packing.ts:144-148`) and `placeItem` subtracts only axis 0 from the shelf's remaining capacity (`bin-packing.ts:377-384`). That means the `height` field becomes the *consumption axis* — the axis that gets eaten up as games are placed along the shelf.\n\nREQ-SHELF-1 (`.lore/specs/shelf-capacity.md:47`) states: *\"For the purpose of shelf fitting, the system checks all orientations (see REQ-SHELF-16), so the labeling convention is informational, not load-bearing.\"* But axis 0 is explicitly locked by `forceAxis0Width`, so the field placed there IS load-bearing. The labeling is not informational.\n\nDesign doc `.lore/designs/similarity-weighted-bin-packing.md:59` says axis 0 should be locked to *width* (`\"Lock axis 0 to the item's width\"`); design doc line 272 says axis 0 is \"height/facing\". Spec REQ-SHELF-16 says the locked axis is \"games face outward on the shelf\". The design doc is internally inconsistent.\n\n**Why it matters:** Practical impact on realistic inputs. Spec example (REQ-SHELF-9 sections): a Kallax cube is 13×13×15 (w×h×d). A Wingspan box, entered per the documented convention (width 12, height 12, depth 2.8), passes `[12, 12, 2.8]` as axis 0. The first game consumes 12 of 13 height-units, leaving room for zero more. Physically, ~4 Wingspan copies fit spine-out in a Kallax cube. The algorithm only produces the right answer if users deliberately enter the spine dimension in the \"height\" field — exactly what REQ-SHELF-1 says they shouldn't have to do.\n\n**Why tests don't catch this:** `capacity-service.test.ts:341` \"rotates a box that only fits rotated\" uses game `{w:6, h:3, d:2}` against shelf `{w:3, h:5, d:2}`. The game's height field (3) is already the smallest dimension, so rotation happens between axes 1 and 2, never touching axis 0. No test exercises a case where axis 0 (height) must actually rotate out to fit.\n\n**What to do:**\n- Align the code, spec, and design doc on one consistent semantic. Recommended: axis 0 = spine/thickness (the dimension that's consumed along the shelf length), which matches the design doc line 59 and the physical \"games face outward\" model. That means `boxToTuple` should map to `[dims.depth, dims.width, dims.height]` or the `BoxDimensions` type needs a semantic redefinition.\n- If the current semantic is intended, REQ-SHELF-1 must be rewritten to say the height field IS load-bearing.\n- Add a test that exercises real axis-0 rotation: a game whose stored `height` is larger than its smallest edge, on a shelf where it fits only if axis 0 rotates out. The existing test comment \"Rotating so 3 is height\" is misleading and does not catch the bug.\n- Fix the design doc's internal contradiction (line 33 \"height first\" vs. line 59 \"Lock axis 0 to the item's width\").\n\n---\n\n## MEDIUM\n\n### 2. No schema validation on loadShelfConfig — violates project CLAUDE.md cache-validation lesson\n\n**Where:** `packages/daemon/src/services/storage-service.ts:262-272`\n\nThe method does `JSON.parse(raw) as ShelfConfiguration` with a plain cast, no Zod schema check. Project `CLAUDE.md` explicitly warns: *\"Daemon caches that survive schema-shape bugs extend the blast radius. Version the cache or validate on load so corrupted stored state doesn't keep leaking into clients after the code is fixed.\"*\n\n**Why it matters:** If `shelf-config.json` is hand-edited, corrupted, or carries a stale shape from a future migration, the daemon will hand it to `capacity-service` and fail deep in bin-packing with type-unsafe crashes rather than a clear validation error. All other storage loads (tournament, config, profile) use the same pattern, but shelf-config is the newest and should follow the guidance that was written down after the earlier incident.\n\n**What to do:** Validate on load with the `ShelfConfigurationSchema` from `@shelf-judge/shared`. Return a typed error if validation fails so the daemon surfaces a clear message instead of crashing downstream.\n\n### 3. Silent catch on `getShelfCapacity` in the collection page\n\n**Where:** `packages/web/app/collection/page.tsx:76-80`\n\n```ts\ntry {\n  capacity = await getShelfCapacity();\n} catch {\n  // Capacity data may not be available\n}\n```\n\n**Why it matters:** Global `rules/lessons-learned.md`: *\"Silent catch blocks at integration points are bugs, not defensive programming. If it can fail, log it and surface it.\"* The capacity endpoint is always available once shelves exist (or returns `configured: false` cleanly). A thrown error here indicates a real daemon failure that the user should see. Swallowing it means the collection page silently drops the cull-candidate column with no user feedback.\n\nThere are similar silent catches for `tournamentStats`, `predictedGames`, `nicheGames`, etc. in the same function. Those predate this change and aren't in scope — but the new capacity catch shouldn't inherit the pattern without thought.\n\n**What to do:** At minimum, `console.warn` the caught error. Better: distinguish \"not configured\" (expected) from \"daemon error\" (surface to user).\n\n---\n\n## LOW\n\n### 4. Dead `.score-chip` CSS class\n\n**Where:** `packages/web/app/capacity/page.tsx:19-23`\n\n```ts\nfunction scoreChipClass(score: number): string {\n  if (score >= 7.5) return \"score-chip high\";\n  if (score >= 5.0) return \"score-chip mid\";\n  return \"score-chip low\";\n}\n```\n\n`.score-chip` is never defined in `packages/web/app/globals.css`. Grep confirms only `.score-value.high`, `.score-dot.high`, `.util-bar-fill.high`, and `.shelf-game-score.high` exist. The `.high`/`.mid`/`.low` suffix classes inherit no styling because the base class is missing.\n\n**Why it matters:** The fitness score chip in the Unfittable and Displaced tables renders unstyled. Not a correctness bug; it's a visual regression versus the intended design.\n\n**What to do:** Either add a `.score-chip` base style in globals.css or switch to an existing class like `score-value` that already has the color modifiers.\n\n### 5. `OverflowEntry.fittable` is dead\n\n**Where:** `packages/daemon/src/services/capacity-service.ts` (search for `fittable: true`)\n\nEvery `OverflowEntry` is constructed with `fittable: true`. There's no code path that sets it to `false` — \"overflow\" by definition means \"fits shape, no room left\". The field adds noise without adding information.\n\n**What to do:** Remove the field from the `OverflowEntry` type in shared, or document in the type why it exists (forward-compat? union discriminator?). Right now it reads like the result of a half-finished refactor.\n\n### 6. Design doc internal inconsistency on axis 0 semantics\n\n**Where:** `.lore/designs/similarity-weighted-bin-packing.md`\n\n- Line 33 calls axis 0 \"height first\"\n- Line 59 says `force_axis_0_width: true # Lock axis 0 to the item's width`\n- Line 96 says \"axis 0 is locked to the item's original axis 0 (the 'facing' dimension)\"\n- Line 272 says \"axis 0 (height/facing) is subtracted\"\n\nThese do not agree. A future reader cannot tell what axis 0 actually means.\n\n**What to do:** Pick one semantic and make the whole doc consistent. Resolving Finding #1 will likely force this.\n\n---\n\n## CHECKLIST COVERAGE\n\n| # | Check | Result |\n|---|---|---|\n| 1 | CRUD completeness REQ-SHELF-11–15 | ✅ All 6 endpoints present in `shelf.ts`; service validates; tests cover paths |\n| 2 | Capacity endpoint REQ-SHELF-18/19/23/24 | ✅ Present; returns `ShelfCapacityResult` verbatim |\n| 3 | Web + CLI client parity with daemon | ✅ Both hit the same routes; CLI covers REQ-SHELF-33/34/35 |\n| 4 | `Game.boxDimensions` serialization | ✅ Schema, setter, clear flag, backfill all wired |\n| 5 | bin-packing.ts standalone | ✅ Confirmed — zero `@shelf-judge/shared` imports; pure algorithm module |\n| 6 | compositeDistance → similarity inversion | ✅ Verified in capacity-service; `1 - distance` cast to similarity |\n| 7 | Rotation edge cases | ⚠️ Finding #1 — tests don't actually exercise axis-0 rotation |\n| 8 | Unconstrained-height shelves | ✅ `UNCONSTRAINED_HEIGHT_SENTINEL`; UI shows \"unconstrained height\"; utilization correctly null |\n| 9 | Unfittable pre-pass | ✅ Computed before assignment; reasons populated |\n| 10 | `configured: false` handling | ✅ Daemon emits it; web shows `NotConfiguredEmpty` |\n| 11 | Light/dark mode CSS | ✅ All new rules use CSS variables; dark overrides scoped via `[data-theme=\"dark\"]` |\n| 12 | `bun run test/typecheck/lint` | ❌ **Not executed** — read-only warden has no Bash access. Must be run by the implementer or another worker before merge. |\n\n---\n\n## TRIAGE NOTE\n\nPer project lessons-learned: the reader decides what to act on. Finding #1 is the one I'd hold the merge on — it's a genuine contract violation between spec and code, and a realistic input (Kallax + Wingspan as specified) produces a visibly wrong assignment. Findings #2 and #3 are fixable in the same pass. Findings #4–#6 are cleanup."
  - timestamp: 2026-04-17T04:13:07.225Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Confirmed axis-semantic bug in capacity-service adapter (REQ-SHELF-1 violation). Running verification commands."
projectName: shelf-judge
---
Phase 12 cross-cutting review of the shelf capacity feature. Inspected spec REQ-SHELF-1 through REQ-SHELF-36, daemon services/routes, shared types, web UI pages, CLI commands, and test coverage. Findings recorded below in priority order. Checklist item 12 (bun test/typecheck/lint) was not executed — I have no Bash access.

---

## CRITICAL

### 1. Axis-0 semantic bug: the "height" label is load-bearing, contradicting REQ-SHELF-1

**Where:** `packages/daemon/src/services/capacity-service.ts:201-211`

```ts
function boxToTuple(dims: BoxDimensions): [number, number, number] {
  // Algorithm axis 0 = height (the axis that gets consumed along the shelf length
  // when forceAxis0Width is on).
  return [dims.height, dims.width, dims.depth];
}
function shelfToBinDims(shelf: Shelf): [number, number, number] {
  const h = shelf.height === null ? UNCONSTRAINED_HEIGHT_SENTINEL : shelf.height;
  return [h, shelf.width, shelf.depth];
}
```

**What's wrong:** Both adapters map algorithm axis 0 to the `height` field of the stored record. `bin-packing.ts` with `forceAxis0Width: true` locks axis 0 (see `bin-packing.ts:144-148`) and `placeItem` subtracts only axis 0 from the shelf's remaining capacity (`bin-packing.ts:377-384`). That means the `height` field becomes the *consumption axis* — the axis that gets eaten up as games are placed along the shelf.

REQ-SHELF-1 (`.lore/specs/shelf-capacity.md:47`) states: *"For the purpose of shelf fitting, the system checks all orientations (see REQ-SHELF-16), so the labeling convention is informational, not load-bearing."* But axis 0 is explicitly locked by `forceAxis0Width`, so the field placed there IS load-bearing. The labeling is not informational.

Design doc `.lore/designs/similarity-weighted-bin-packing.md:59` says axis 0 should be locked to *width* (`"Lock axis 0 to the item's width"`); design doc line 272 says axis 0 is "height/facing". Spec REQ-SHELF-16 says the locked axis is "games face outward on the shelf". The design doc is internally inconsistent.

**Why it matters:** Practical impact on realistic inputs. Spec example (REQ-SHELF-9 sections): a Kallax cube is 13×13×15 (w×h×d). A Wingspan box, entered per the documented convention (width 12, height 12, depth 2.8), passes `[12, 12, 2.8]` as axis 0. The first game consumes 12 of 13 height-units, leaving room for zero more. Physically, ~4 Wingspan copies fit spine-out in a Kallax cube. The algorithm only produces the right answer if users deliberately enter the spine dimension in the "height" field — exactly what REQ-SHELF-1 says they shouldn't have to do.

**Why tests don't catch this:** `capacity-service.test.ts:341` "rotates a box that only fits rotated" uses game `{w:6, h:3, d:2}` against shelf `{w:3, h:5, d:2}`. The game's height field (3) is already the smallest dimension, so rotation happens between axes 1 and 2, never touching axis 0. No test exercises a case where axis 0 (height) must actually rotate out to fit.

**What to do:**
- Align the code, spec, and design doc on one consistent semantic. Recommended: axis 0 = spine/thickness (the dimension that's consumed along the shelf length), which matches the design doc line 59 and the physical "games face outward" model. That means `boxToTuple` should map to `[dims.depth, dims.width, dims.height]` or the `BoxDimensions` type needs a semantic redefinition.
- If the current semantic is intended, REQ-SHELF-1 must be rewritten to say the height field IS load-bearing.
- Add a test that exercises real axis-0 rotation: a game whose stored `height` is larger than its smallest edge, on a shelf where it fits only if axis 0 rotates out. The existing test comment "Rotating so 3 is height" is misleading and does not catch the bug.
- Fix the design doc's internal contradiction (line 33 "height first" vs. line 59 "Lock axis 0 to the item's width").

---

## MEDIUM

### 2. No schema validation on loadShelfConfig — violates project CLAUDE.md cache-validation lesson

**Where:** `packages/daemon/src/services/storage-service.ts:262-272`

The method does `JSON.parse(raw) as ShelfConfiguration` with a plain cast, no Zod schema check. Project `CLAUDE.md` explicitly warns: *"Daemon caches that survive schema-shape bugs extend the blast radius. Version the cache or validate on load so corrupted stored state doesn't keep leaking into clients after the code is fixed."*

**Why it matters:** If `shelf-config.json` is hand-edited, corrupted, or carries a stale shape from a future migration, the daemon will hand it to `capacity-service` and fail deep in bin-packing with type-unsafe crashes rather than a clear validation error. All other storage loads (tournament, config, profile) use the same pattern, but shelf-config is the newest and should follow the guidance that was written down after the earlier incident.

**What to do:** Validate on load with the `ShelfConfigurationSchema` from `@shelf-judge/shared`. Return a typed error if validation fails so the daemon surfaces a clear message instead of crashing downstream.

### 3. Silent catch on `getShelfCapacity` in the collection page

**Where:** `packages/web/app/collection/page.tsx:76-80`

```ts
try {
  capacity = await getShelfCapacity();
} catch {
  // Capacity data may not be available
}
```

**Why it matters:** Global `rules/lessons-learned.md`: *"Silent catch blocks at integration points are bugs, not defensive programming. If it can fail, log it and surface it."* The capacity endpoint is always available once shelves exist (or returns `configured: false` cleanly). A thrown error here indicates a real daemon failure that the user should see. Swallowing it means the collection page silently drops the cull-candidate column with no user feedback.

There are similar silent catches for `tournamentStats`, `predictedGames`, `nicheGames`, etc. in the same function. Those predate this change and aren't in scope — but the new capacity catch shouldn't inherit the pattern without thought.

**What to do:** At minimum, `console.warn` the caught error. Better: distinguish "not configured" (expected) from "daemon error" (surface to user).

---

## LOW

### 4. Dead `.score-chip` CSS class

**Where:** `packages/web/app/capacity/page.tsx:19-23`

```ts
function scoreChipClass(score: number): string {
  if (score >= 7.5) return "score-chip high";
  if (score >= 5.0) return "score-chip mid";
  return "score-chip low";
}
```

`.score-chip` is never defined in `packages/web/app/globals.css`. Grep confirms only `.score-value.high`, `.score-dot.high`, `.util-bar-fill.high`, and `.shelf-game-score.high` exist. The `.high`/`.mid`/`.low` suffix classes inherit no styling because the base class is missing.

**Why it matters:** The fitness score chip in the Unfittable and Displaced tables renders unstyled. Not a correctness bug; it's a visual regression versus the intended design.

**What to do:** Either add a `.score-chip` base style in globals.css or switch to an existing class like `score-value` that already has the color modifiers.

### 5. `OverflowEntry.fittable` is dead

**Where:** `packages/daemon/src/services/capacity-service.ts` (search for `fittable: true`)

Every `OverflowEntry` is constructed with `fittable: true`. There's no code path that sets it to `false` — "overflow" by definition means "fits shape, no room left". The field adds noise without adding information.

**What to do:** Remove the field from the `OverflowEntry` type in shared, or document in the type why it exists (forward-compat? union discriminator?). Right now it reads like the result of a half-finished refactor.

### 6. Design doc internal inconsistency on axis 0 semantics

**Where:** `.lore/designs/similarity-weighted-bin-packing.md`

- Line 33 calls axis 0 "height first"
- Line 59 says `force_axis_0_width: true # Lock axis 0 to the item's width`
- Line 96 says "axis 0 is locked to the item's original axis 0 (the 'facing' dimension)"
- Line 272 says "axis 0 (height/facing) is subtracted"

These do not agree. A future reader cannot tell what axis 0 actually means.

**What to do:** Pick one semantic and make the whole doc consistent. Resolving Finding #1 will likely force this.

---

## CHECKLIST COVERAGE

| # | Check | Result |
|---|---|---|
| 1 | CRUD completeness REQ-SHELF-11–15 | ✅ All 6 endpoints present in `shelf.ts`; service validates; tests cover paths |
| 2 | Capacity endpoint REQ-SHELF-18/19/23/24 | ✅ Present; returns `ShelfCapacityResult` verbatim |
| 3 | Web + CLI client parity with daemon | ✅ Both hit the same routes; CLI covers REQ-SHELF-33/34/35 |
| 4 | `Game.boxDimensions` serialization | ✅ Schema, setter, clear flag, backfill all wired |
| 5 | bin-packing.ts standalone | ✅ Confirmed — zero `@shelf-judge/shared` imports; pure algorithm module |
| 6 | compositeDistance → similarity inversion | ✅ Verified in capacity-service; `1 - distance` cast to similarity |
| 7 | Rotation edge cases | ⚠️ Finding #1 — tests don't actually exercise axis-0 rotation |
| 8 | Unconstrained-height shelves | ✅ `UNCONSTRAINED_HEIGHT_SENTINEL`; UI shows "unconstrained height"; utilization correctly null |
| 9 | Unfittable pre-pass | ✅ Computed before assignment; reasons populated |
| 10 | `configured: false` handling | ✅ Daemon emits it; web shows `NotConfiguredEmpty` |
| 11 | Light/dark mode CSS | ✅ All new rules use CSS variables; dark overrides scoped via `[data-theme="dark"]` |
| 12 | `bun run test/typecheck/lint` | ❌ **Not executed** — read-only warden has no Bash access. Must be run by the implementer or another worker before merge. |

---

## TRIAGE NOTE

Per project lessons-learned: the reader decides what to act on. Finding #1 is the one I'd hold the merge on — it's a genuine contract violation between spec and code, and a realistic input (Kallax + Wingspan as specified) produces a visibly wrong assignment. Findings #2 and #3 are fixable in the same pass. Findings #4–#6 are cleanup.

## Decisions

**Does the capacity-service adapter correctly implement REQ-SHELF-1's claim that "the system checks all orientations, so the labeling convention is informational, not load-bearing"?**
No. The adapter locks the game's `height` field to the shelf's `height` field as the consumption axis. The label IS load-bearing, contradicting REQ-SHELF-1.
*Reasoning: REQ-SHELF-1 says "width is the longest face edge (what you see from the front), height is the vertical dimension when the box is stored upright... For the purpose of shelf fitting, the system checks all orientations (see REQ-SHELF-16), so the labeling convention is informational, not load-bearing." capacity-service.ts:201-211 (boxToTuple and shelfToBinDims) both map axis 0 to `height`. bin-packing.ts with forceAxis0Width=true locks result[0] = itemDims[0] (game's height), which never participates in rotation. Post-placement (placeItem, line 377-384) subtracts only axis 0, meaning each game consumes shelf.height by the game's height-field value. Practical consequence: a Kallax cube 13x13x15 with Wingspan entered per the spec convention (w=12, h=12, d=2.8) gets 1 game per cube (12 consumed from 13, leaving 1, insufficient for the next game's 12-height). Physically ~4-5 Wingspan boxes fit spine-out. The algorithm only works if users enter the spine-thickness dimension in the "height" field, contradicting the spec's documented convention. The label is load-bearing, not informational. Evidence: capacity-service.ts line 202 comment acknowledges "Algorithm axis 0 = height (the axis that gets consumed along the shelf length when forceAxis0Width is on)." The rotation test at capacity-service.test.ts:341 does not exercise axis-0 rotation - its game has h=3 and a shelf h=5, so the height-field is already the smallest, masking the issue.*

**Does the capacity page's `scoreChipClass` produce the expected styled score chips in the unfittable/displaced tables?**
No. `.score-chip` is referenced in capacity/page.tsx:20-22 but no `.score-chip` selector exists in globals.css. The spans render unstyled (plain text, no background/border/color).
*Reasoning: Grep across globals.css for `.score-chip` returns zero matches. The class appears only in packages/web/app/capacity/page.tsx:20-22. The siblings `score-value.high/mid/low`, `score-dot.high/mid/low`, `util-bar-fill.high/mid/low`, `shelf-game-score.high/mid/low` are all prefix-scoped — `score-chip` does not match any of them. Result: the UnfittableTable and DisplacedTable render fitness numbers as plain `<span>` text with no background or colored chip treatment, contradicting the visual intent the function name implies. Low impact (functionality still works; only visual polish), but the unused class is a dead reference.</reasoning*

**Does storage-service.loadShelfConfig validate the shape of the stored JSON before returning it?**
No. It parses JSON and casts to ShelfConfiguration without validation.
*Reasoning: storage-service.ts:262-272 reads shelf-config.json and runs `JSON.parse(raw) as ShelfConfiguration`. No Zod or structural check. Per the project-level critical lesson in CLAUDE.md: "Daemon caches that survive schema-shape bugs extend the blast radius. Version the cache or validate on load so corrupted stored state doesn't keep leaking into clients after the code is fixed. Shelf Judge caches profile/tournament/collection under `~/.shelf-judge/data/`; any shape change needs a load-time guard or a cache reset." The shelf-config file fits this pattern. Impact: if a future change alters ShelfConfiguration shape, or the file is edited externally, malformed state propagates silently to all clients.*

**Does the collection page handle getShelfCapacity failures appropriately?**
Silently swallows errors at collection/page.tsx:78-80.
*Reasoning: `try { capacity = await getShelfCapacity(); } catch { /* Capacity data may not be available */ }`. The error is dropped with no logging. This matches surrounding patterns for other optional subsystems (niche, redundancy) on this page, but collides with the project's lessons-learned note: "Silent catch blocks at integration points are bugs, not defensive programming. If it can fail, log it and surface it." Low impact because capacity is optional for this page's core function, but a real daemon error (socket down, 500) will be indistinguishable from "capacity not configured." A console.warn would preserve the graceful-fallback behavior while surfacing the error to the developer.*

**Is bin-packing.ts a standalone module with no imports from @shelf-judge/shared (per Phase 12 constraint)?**
Yes. Confirmed standalone.
*Reasoning: Grep for `from "@shelf-judge/shared"` and `from ".*shared"` in packages/daemon/src/services/bin-packing.ts returns zero matches. The module exports PackItem, PackBin, PackConfig, PackResult, PackAssignment, MergeStrategy, DEFAULT_PACK_CONFIG, merge, findBestRotation, itemInBinFitness, binReadiness, and pack - all defined locally. capacity-service.ts is the adapter bridging @shelf-judge/shared domain types to the algorithm's pure primitives.*
