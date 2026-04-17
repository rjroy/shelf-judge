---
title: "Commission: Shelf Capacity: Fix Capacity Integration Review (C19)"
date: 2026-04-13
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Read Thorne's review of the capacity integration. Address ALL findings. Run `bun run test`, `bun run typecheck`, `bun run lint` after all fixes."
dependencies:
  - commission-Thorne-20260413-150348
linked_artifacts:
  - packages/web/app/capacity/page.tsx

  - packages/web/app/collection/page.tsx
  - packages/web/components/collection-table.tsx
  - packages/web/components/capacity-indicator.tsx
  - packages/web/app/globals.css
  - packages/web/tests/game-links.test.tsx
  - packages/daemon/src/services/capacity-service.ts
  - packages/daemon/src/routes/shelf.ts
  - packages/web/app/collection/page.tsx
  - packages/web/components/collection-table.tsx
  - packages/web/components/capacity-indicator.tsx
  - packages/web/app/globals.css
  - packages/web/tests/game-links.test.tsx
  - packages/daemon/src/services/capacity-service.ts
  - packages/daemon/src/routes/shelf.ts
activity_timeline:
  - timestamp: 2026-04-13T22:03:56.634Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T22:10:22.777Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-17T03:46:58.448Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-17T03:46:58.452Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-17T03:46:58.477Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-17T03:47:13.022Z
    event: progress_report
    reason: "Read Thorne's review. 6 findings + 1 observation. Starting by reading the affected files."
  - timestamp: 2026-04-17T03:50:58.999Z
    event: progress_report
    reason: "Resuming after compaction. Starting with straightforward fixes: broken /game/ links (Finding #1), pack config DRY and pre-pass config bug (Findings #3+#4), route reordering (Finding #6), and the fittable comment (observation)."
  - timestamp: 2026-04-17T03:54:04.315Z
    event: progress_report
    reason: "Findings #1, #2 (URL-driven dimensions filter), #3+#4, #6, and observation comment done. Next: Finding #5 (move CapacityIndicator inside filter-bar + CSS restructure), then tests + lint + typecheck."
  - timestamp: 2026-04-17T04:00:55.058Z
    event: result_submitted
    reason: "All 6 Thorne findings + 1 observation addressed in code. **Verification commands could not be run**: bash execution is blocked in this sandbox by a seccomp failure (`prctl(PR_SET_SECCOMP) failed: Invalid argument`) — confirmed by both the primary shell and a delegated sub-agent. `bun run test`, `bun run typecheck`, and `bun run lint` must be run by the user before merge.\n\n## Fixes applied\n\n**Finding #1 (HIGH) — broken /game/${id} links**\n- `packages/web/app/capacity/page.tsx`: fixed 3 hrefs to `/games/${id}`, added `game-link` class on each (assigned rows, unfittable table, displaced table).\n- `packages/web/tests/game-links.test.tsx`: new `describe(\"Capacity page game links\")` block asserts correct hrefs, class presence, and that no singular `/game/{id}` form remains.\n\n**Finding #2 (MEDIUM) — unfiltered \"View unmeasured games\" links**\n- `packages/web/app/capacity/page.tsx`: NoDimensionsEmpty button + coverage-note inline link both use `/collection?dimensions=missing`.\n- `packages/web/components/capacity-indicator.tsx`: neutral-state inline \"Add box dimensions\" link uses the same param.\n- `packages/web/app/collection/page.tsx`: reads `params.dimensions === \"missing\"` into `missingDimensionsOnly`, passes to `CollectionTable`.\n- `packages/web/components/collection-table.tsx`: new `missingDimensionsOnly` prop filters `after_ownership` to `boxDimensions === null`; `buildCollectionUrl` helper composes both params; `toggleOwnership` preserves missing-dimensions state; `clearMissingDimensions` drops it; \"Missing dimensions\" chip with × button; chip counted by `activeFilterCount`/`hasAnyFilter`; \"Clear all\" routes back to `/collection` when either URL filter is set.\n\n**Finding #3 (LOW) — splitUnfittable used DEFAULT_PACK_CONFIG.forceAxis0Width**\n- `packages/daemon/src/services/capacity-service.ts`: `resolvedConfig: PackConfig = { ...DEFAULT_PACK_CONFIG, ...packConfig }` resolved before splitUnfittable, passed as 3rd arg. Signature changed to `splitUnfittable(dimensioned, shelves, config: PackConfig)`. Pre-pass now uses `config.forceAxis0Width`.\n\n**Finding #4 (LOW/style) — double config merge**\n- Same file: renamed local to `resolvedConfig`, passed to both splitUnfittable and pack(). No more re-merge inside pack paths.\n\n**Finding #5 (style) — CapacityIndicator placement**\n- Moved `<CapacityIndicator>` render from `collection/page.tsx` into `CollectionTable` as the last child of `.filter-bar` (after active-chips-row).\n- `globals.css`: `.filter-bar` now has no padding/gap; `.filter-row-1`, `.filter-panel`, `.active-chips-row`, and `.capacity-indicator` each carry their own horizontal padding (`var(--content-padding)`). Capacity indicator keeps a `border-top` for the divider. Mobile rule cleaned up: `.filter-bar` mobile padding removed, `.filter-row-1` takes the 8px vertical padding instead, so indicator stays edge-to-edge on all breakpoints.\n\n**Finding #6 (style) — route ordering**\n- `packages/daemon/src/routes/shelf.ts`: GET /shelf/capacity moved to be registered after DELETE /shelf/units/:id, keeping related resources adjacent in the route table.\n\n**Observation — OverflowEntry.fittable always true**\n- `capacity-service.ts`: added a 3-line comment where `fittable: true` is set, explaining every entry survived the pre-pass today and why the field (REQ-SHELF-19) is reserved for future cases.\n\n## What the user must run\n\n```\nbun run test\nbun run typecheck\nbun run lint\n```\n\nAny failures should be surfaced so I can patch them. The new test block in `game-links.test.tsx` is the only new runtime assertion; the rest are pure refactors that should be caught by typecheck if broken."
  - timestamp: 2026-04-17T04:01:00.031Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Findings #1, #2 (URL-driven dimensions filter), #3+#4, #6, and observation comment done. Next: Finding #5 (move CapacityIndicator inside filter-bar + CSS restructure), then tests + lint + typecheck."
projectName: shelf-judge
---
All 6 Thorne findings + 1 observation addressed in code. **Verification commands could not be run**: bash execution is blocked in this sandbox by a seccomp failure (`prctl(PR_SET_SECCOMP) failed: Invalid argument`) — confirmed by both the primary shell and a delegated sub-agent. `bun run test`, `bun run typecheck`, and `bun run lint` must be run by the user before merge.

## Fixes applied

**Finding #1 (HIGH) — broken /game/${id} links**
- `packages/web/app/capacity/page.tsx`: fixed 3 hrefs to `/games/${id}`, added `game-link` class on each (assigned rows, unfittable table, displaced table).
- `packages/web/tests/game-links.test.tsx`: new `describe("Capacity page game links")` block asserts correct hrefs, class presence, and that no singular `/game/{id}` form remains.

**Finding #2 (MEDIUM) — unfiltered "View unmeasured games" links**
- `packages/web/app/capacity/page.tsx`: NoDimensionsEmpty button + coverage-note inline link both use `/collection?dimensions=missing`.
- `packages/web/components/capacity-indicator.tsx`: neutral-state inline "Add box dimensions" link uses the same param.
- `packages/web/app/collection/page.tsx`: reads `params.dimensions === "missing"` into `missingDimensionsOnly`, passes to `CollectionTable`.
- `packages/web/components/collection-table.tsx`: new `missingDimensionsOnly` prop filters `after_ownership` to `boxDimensions === null`; `buildCollectionUrl` helper composes both params; `toggleOwnership` preserves missing-dimensions state; `clearMissingDimensions` drops it; "Missing dimensions" chip with × button; chip counted by `activeFilterCount`/`hasAnyFilter`; "Clear all" routes back to `/collection` when either URL filter is set.

**Finding #3 (LOW) — splitUnfittable used DEFAULT_PACK_CONFIG.forceAxis0Width**
- `packages/daemon/src/services/capacity-service.ts`: `resolvedConfig: PackConfig = { ...DEFAULT_PACK_CONFIG, ...packConfig }` resolved before splitUnfittable, passed as 3rd arg. Signature changed to `splitUnfittable(dimensioned, shelves, config: PackConfig)`. Pre-pass now uses `config.forceAxis0Width`.

**Finding #4 (LOW/style) — double config merge**
- Same file: renamed local to `resolvedConfig`, passed to both splitUnfittable and pack(). No more re-merge inside pack paths.

**Finding #5 (style) — CapacityIndicator placement**
- Moved `<CapacityIndicator>` render from `collection/page.tsx` into `CollectionTable` as the last child of `.filter-bar` (after active-chips-row).
- `globals.css`: `.filter-bar` now has no padding/gap; `.filter-row-1`, `.filter-panel`, `.active-chips-row`, and `.capacity-indicator` each carry their own horizontal padding (`var(--content-padding)`). Capacity indicator keeps a `border-top` for the divider. Mobile rule cleaned up: `.filter-bar` mobile padding removed, `.filter-row-1` takes the 8px vertical padding instead, so indicator stays edge-to-edge on all breakpoints.

**Finding #6 (style) — route ordering**
- `packages/daemon/src/routes/shelf.ts`: GET /shelf/capacity moved to be registered after DELETE /shelf/units/:id, keeping related resources adjacent in the route table.

**Observation — OverflowEntry.fittable always true**
- `capacity-service.ts`: added a 3-line comment where `fittable: true` is set, explaining every entry survived the pre-pass today and why the field (REQ-SHELF-19) is reserved for future cases.

## What the user must run

```
bun run test
bun run typecheck
bun run lint
```

Any failures should be surfaced so I can patch them. The new test block in `game-links.test.tsx` is the only new runtime assertion; the rest are pure refactors that should be caught by typecheck if broken.
