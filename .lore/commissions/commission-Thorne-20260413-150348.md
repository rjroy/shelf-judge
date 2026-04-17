---
title: "Commission: Shelf Capacity: Review Capacity Integration (C18)"
date: 2026-04-13
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the capacity integration: adapter, endpoint, web UI, and CLI (Phases 9-11).\n\n**Context:**\n- `.lore/plans/shelf-capacity.md` (Phases 9, 10, 11)\n- `.lore/specs/shelf-capacity.md` (REQ-SHELF-16 through REQ-SHELF-25, REQ-SHELF-30, REQ-SHELF-31, REQ-SHELF-34, REQ-SHELF-35)\n- `.lore/mockups/mockup-shelf-capacity-indicator.html`\n- `.lore/mockups/mockup-shelf-capacity-detail.html`\n- `.lore/mockups/mockup-shelf-capacity-detail-empty.html`\n\n**Critical review points:**\n1. Similarity function wiring: compositeDistance inverted correctly (1 - composite = similarity)\n2. Unfittable pre-pass vs algorithm overflow: unfittable games excluded from algorithm, reported separately\n3. Unconstrained-height shelves: mapped to height=10000 bins (not dimensionless), capacityIn3=null, utilization=null\n4. Edge cases: no config returns configured:false, no dimensions returns empty results\n5. Web client helpers cover the capacity endpoint\n6. CLI `--json` returns well-formed ShelfCapacityResult\n7. Collection page indicator handles all four states\n8. Capacity detail page has all three sections + dimension coverage note\n9. Grade badges styled correctly (S through F)\n10. Previously-owned games excluded from capacity computation (owned-only filter)\n\n**Files:** `packages/daemon/src/services/capacity-service.ts`, `packages/daemon/src/routes/shelf.ts`, `packages/web/app/collection/page.tsx`, `packages/web/app/capacity/page.tsx`, `packages/web/lib/api.ts`, `packages/cli/src/commands/shelf.ts`, `packages/web/app/globals.css`\n\nRecord all findings."
dependencies:
  - commission-Dalton-20260413-150333
linked_artifacts:
  - packages/web/app/capacity/page.tsx

  - packages/web/components/capacity-indicator.tsx
  - packages/web/app/collection/page.tsx
  - packages/web/lib/api.ts
  - packages/daemon/src/services/capacity-service.ts
  - packages/daemon/src/routes/shelf.ts
  - packages/cli/src/commands/shelf.ts
  - packages/web/components/capacity-indicator.tsx
  - packages/web/app/collection/page.tsx
  - packages/web/lib/api.ts
  - packages/daemon/src/services/capacity-service.ts
  - packages/daemon/src/routes/shelf.ts
  - packages/cli/src/commands/shelf.ts
activity_timeline:
  - timestamp: 2026-04-13T22:03:48.591Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T22:10:22.777Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-17T03:38:15.741Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-17T03:38:15.744Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-17T03:38:15.774Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-17T03:38:38.889Z
    event: progress_report
    reason: "Loaded spec, plan, and capacity-service.ts. Now reviewing bin-packing algorithm, routes, web UI, and CLI."
  - timestamp: 2026-04-17T03:46:52.634Z
    event: result_submitted
    reason: "\n# Review: Shelf Capacity Integration (Phases 9–11)\n\nScope: capacity-service adapter, GET /shelf/capacity endpoint, web collection indicator, web /capacity detail page, client helpers, CLI shelf commands, and supporting CSS.\n\n## Defects\n\n### 1. [HIGH] Broken game-detail links on the capacity page\n`packages/web/app/capacity/page.tsx` lines 100, 127, 163 use `href={`/game/${id}`}` (singular). The actual route is `app/games/[id]/page.tsx` (plural) and every other call site across `packages/web` uses `/games/` (11 plural vs 3 singular; all three singulars are in capacity/page.tsx). `packages/web/tests/game-links.test.tsx` enforces `/games/` but does not cover capacity/page.tsx — which is why this slipped through. Every game name link from the shelf-assignment cards, the unfittable table, and the displaced table currently 404s.\n**Fix:** replace all three with `/games/${...}`; extend game-links.test.tsx to include capacity/page.tsx in its assertion set.\n\n### 2. [MEDIUM] Coverage-note link doesn't satisfy REQ-SHELF-31's filter-to-undimensioned intent\nThree call sites route users to plain `/collection` with no query param:\n- `capacity/page.tsx:361` (coverage note under the detail page)\n- `capacity/page.tsx:263,267` (NoDimensionsEmpty buttons)\n- `components/capacity-indicator.tsx:22` (neutral-state link)\n\n`app/collection/page.tsx` only honors `ownership=all` in searchParams — no \"undimensioned\" filter is implemented. This is both a call-site gap (nothing is sent) and a feature gap (nothing would receive it). The user journey \"I'll go add dimensions for my unmeasured games\" today ends in an unfiltered collection.\n**Decide:** is the filter Phase 10 scope or a follow-up? Either way, the link targets should carry intent (e.g. `?dimensions=missing`) so shipping the filter later doesn't require revisiting every call site.\n\n### 3. [LOW] Pre-pass unfittable check uses DEFAULT_PACK_CONFIG.forceAxis0Width, not the merged config\n`capacity-service.ts:234` passes `DEFAULT_PACK_CONFIG.forceAxis0Width` directly to `findBestRotation` in the pre-pass. The `mergedConfig` built at line 104 is not consulted. Today no caller overrides packConfig so there's no observable bug, but a caller changing `forceAxis0Width` would get a pre-pass with one rotation policy and a packer with another — and \"unfittable\" would mean different things on each side. Pre-pass and packer must agree on rotation rules or the unfittable/overflow split loses its meaning.\n**Fix:** read `forceAxis0Width` from `mergedConfig` (with default fallback) once and reuse.\n\n### 4. [LOW/STYLE] Redundant config merge in capacity-service\n`capacity-service.ts:104` builds `{ ...DEFAULT_PACK_CONFIG, ...packConfig }`, but `bin-packing.ts:527` `pack()` performs the same merge internally. The caller ends up with two merged configs — one the packer uses, one consulted in the pre-pass — which is what enables finding #3. Fold the two merges into one path to remove this class of bug, not just the current instance.\n\n### 5. [STYLE] CapacityIndicator placement diverges from mockup\n`app/collection/page.tsx:142` renders `<CapacityIndicator />` between `.topbar` and `.main-scroll` at page root. The mockup placed it inside the `.filter-bar` with the other collection controls. The component is a full-width band in `globals.css` so current placement is self-consistent, but it isn't the design.\n\n### 6. [STYLE] Route registration order\n`packages/daemon/src/routes/shelf.ts:120` registers GET /shelf/capacity between PUT and DELETE on /shelf/units/:id. No correctness impact in Hono. Reads out-of-place; grouping unit CRUD together and the capacity rollup at the end of the router would be more legible.\n\n## Observation (not a defect)\n`OverflowEntry.fittable` is always `true` in practice. Undimensioned games are filtered before becoming PackItems; the pre-pass removes geometrically unfittable games. The `fittable: false` branch in capacity-service is dead. Either drop the field or leave a comment explaining it's reserved for a future case — otherwise a future reader will think there's a meaningful distinction in the data.\n\n## Requirements Verified\n\nSatisfied:\n- **REQ-SHELF-16/17** — unfittable vs overflow separated via pre-pass; test at capacity-service.test.ts:269-290 confirms ordering behavior.\n- **REQ-SHELF-19/23** — no config returns 200 with configured=false, no 400.\n- **REQ-SHELF-21** — previously-owned excluded at capacity-service.ts:69. `OwnershipStatus` is \"owned\" | \"previously-owned\" only (verified in shared/types.ts), so the filter produces the correct owned-only set.\n- **REQ-SHELF-22** — unconstrained-height shelves use sentinel 10000 for packing; capacityIn3/utilization null downstream; web and CLI handle the null branch.\n- **REQ-SHELF-25** — similarity = `1 - compositeDistance(...).composite`; compositeDistance returns 0 for identical, 1 for maximally distant, so the conversion produces the [0, 1] similarity the packer expects. Null-vector guards return 0.\n- **REQ-SHELF-30** — four states (neutral/warning/danger/success) + compound danger+displaced subrow.\n- **REQ-SHELF-31** — three sections + coverage note present structurally; the note's link target is the gap in finding #2.\n- **REQ-SHELF-34** — CLI shelfStatus matches spec format.\n- **REQ-SHELF-35** — CLI shelfCapacity has three sections and --json returns raw ShelfCapacityResult.\n- Web client: getShelfCapacity() wired at lib/api.ts:347; all five shelf types re-exported.\n- CSS: .grade-S through .grade-F defined with light/dark tokens; .capacity-indicator classes complete.\n\nNot verified:\n- Behavior under non-default packConfig overrides (no caller, no test). This is what elevates finding #3 from speculation — if a caller is added later, the inconsistency will bite.\n- Exhaustive visual parity vs mockup screenshots. Flagged placement (finding #5); deferred further visual review.\n\n## Priority Summary\n- Fix before ship: **#1** (broken nav — every game link in three tables currently 404s), **#2** (broken filter-to-undimensioned journey — either wire the param or decide to punt explicitly).\n- Fix before next refactor of capacity-service: **#3** and **#4** together — same root cause.\n- Backlog: **#5**, **#6**, and the OverflowEntry.fittable dead-field observation.\n"
  - timestamp: 2026-04-17T03:46:58.244Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Loaded spec, plan, and capacity-service.ts. Now reviewing bin-packing algorithm, routes, web UI, and CLI."
projectName: shelf-judge
---

# Review: Shelf Capacity Integration (Phases 9–11)

Scope: capacity-service adapter, GET /shelf/capacity endpoint, web collection indicator, web /capacity detail page, client helpers, CLI shelf commands, and supporting CSS.

## Defects

### 1. [HIGH] Broken game-detail links on the capacity page
`packages/web/app/capacity/page.tsx` lines 100, 127, 163 use `href={`/game/${id}`}` (singular). The actual route is `app/games/[id]/page.tsx` (plural) and every other call site across `packages/web` uses `/games/` (11 plural vs 3 singular; all three singulars are in capacity/page.tsx). `packages/web/tests/game-links.test.tsx` enforces `/games/` but does not cover capacity/page.tsx — which is why this slipped through. Every game name link from the shelf-assignment cards, the unfittable table, and the displaced table currently 404s.
**Fix:** replace all three with `/games/${...}`; extend game-links.test.tsx to include capacity/page.tsx in its assertion set.

### 2. [MEDIUM] Coverage-note link doesn't satisfy REQ-SHELF-31's filter-to-undimensioned intent
Three call sites route users to plain `/collection` with no query param:
- `capacity/page.tsx:361` (coverage note under the detail page)
- `capacity/page.tsx:263,267` (NoDimensionsEmpty buttons)
- `components/capacity-indicator.tsx:22` (neutral-state link)

`app/collection/page.tsx` only honors `ownership=all` in searchParams — no "undimensioned" filter is implemented. This is both a call-site gap (nothing is sent) and a feature gap (nothing would receive it). The user journey "I'll go add dimensions for my unmeasured games" today ends in an unfiltered collection.
**Decide:** is the filter Phase 10 scope or a follow-up? Either way, the link targets should carry intent (e.g. `?dimensions=missing`) so shipping the filter later doesn't require revisiting every call site.

### 3. [LOW] Pre-pass unfittable check uses DEFAULT_PACK_CONFIG.forceAxis0Width, not the merged config
`capacity-service.ts:234` passes `DEFAULT_PACK_CONFIG.forceAxis0Width` directly to `findBestRotation` in the pre-pass. The `mergedConfig` built at line 104 is not consulted. Today no caller overrides packConfig so there's no observable bug, but a caller changing `forceAxis0Width` would get a pre-pass with one rotation policy and a packer with another — and "unfittable" would mean different things on each side. Pre-pass and packer must agree on rotation rules or the unfittable/overflow split loses its meaning.
**Fix:** read `forceAxis0Width` from `mergedConfig` (with default fallback) once and reuse.

### 4. [LOW/STYLE] Redundant config merge in capacity-service
`capacity-service.ts:104` builds `{ ...DEFAULT_PACK_CONFIG, ...packConfig }`, but `bin-packing.ts:527` `pack()` performs the same merge internally. The caller ends up with two merged configs — one the packer uses, one consulted in the pre-pass — which is what enables finding #3. Fold the two merges into one path to remove this class of bug, not just the current instance.

### 5. [STYLE] CapacityIndicator placement diverges from mockup
`app/collection/page.tsx:142` renders `<CapacityIndicator />` between `.topbar` and `.main-scroll` at page root. The mockup placed it inside the `.filter-bar` with the other collection controls. The component is a full-width band in `globals.css` so current placement is self-consistent, but it isn't the design.

### 6. [STYLE] Route registration order
`packages/daemon/src/routes/shelf.ts:120` registers GET /shelf/capacity between PUT and DELETE on /shelf/units/:id. No correctness impact in Hono. Reads out-of-place; grouping unit CRUD together and the capacity rollup at the end of the router would be more legible.

## Observation (not a defect)
`OverflowEntry.fittable` is always `true` in practice. Undimensioned games are filtered before becoming PackItems; the pre-pass removes geometrically unfittable games. The `fittable: false` branch in capacity-service is dead. Either drop the field or leave a comment explaining it's reserved for a future case — otherwise a future reader will think there's a meaningful distinction in the data.

## Requirements Verified

Satisfied:
- **REQ-SHELF-16/17** — unfittable vs overflow separated via pre-pass; test at capacity-service.test.ts:269-290 confirms ordering behavior.
- **REQ-SHELF-19/23** — no config returns 200 with configured=false, no 400.
- **REQ-SHELF-21** — previously-owned excluded at capacity-service.ts:69. `OwnershipStatus` is "owned" | "previously-owned" only (verified in shared/types.ts), so the filter produces the correct owned-only set.
- **REQ-SHELF-22** — unconstrained-height shelves use sentinel 10000 for packing; capacityIn3/utilization null downstream; web and CLI handle the null branch.
- **REQ-SHELF-25** — similarity = `1 - compositeDistance(...).composite`; compositeDistance returns 0 for identical, 1 for maximally distant, so the conversion produces the [0, 1] similarity the packer expects. Null-vector guards return 0.
- **REQ-SHELF-30** — four states (neutral/warning/danger/success) + compound danger+displaced subrow.
- **REQ-SHELF-31** — three sections + coverage note present structurally; the note's link target is the gap in finding #2.
- **REQ-SHELF-34** — CLI shelfStatus matches spec format.
- **REQ-SHELF-35** — CLI shelfCapacity has three sections and --json returns raw ShelfCapacityResult.
- Web client: getShelfCapacity() wired at lib/api.ts:347; all five shelf types re-exported.
- CSS: .grade-S through .grade-F defined with light/dark tokens; .capacity-indicator classes complete.

Not verified:
- Behavior under non-default packConfig overrides (no caller, no test). This is what elevates finding #3 from speculation — if a caller is added later, the inconsistency will bite.
- Exhaustive visual parity vs mockup screenshots. Flagged placement (finding #5); deferred further visual review.

## Priority Summary
- Fix before ship: **#1** (broken nav — every game link in three tables currently 404s), **#2** (broken filter-to-undimensioned journey — either wire the param or decide to punt explicitly).
- Fix before next refactor of capacity-service: **#3** and **#4** together — same root cause.
- Backlog: **#5**, **#6**, and the OverflowEntry.fittable dead-field observation.


## Decisions

**Do the game-detail links on the capacity page point to the correct route?**
[HIGH] Broken links. packages/web/app/capacity/page.tsx lines 100, 127, 163 use href={`/game/${id}`} (singular). Canonical route is app/games/[id]/page.tsx (plural) — confirmed against 11 other call sites across packages/web. Clicking any game name in an assignment card, the unfittable table, or the displaced table 404s.
*Reasoning: Grep across packages/web shows /games/ (plural) is used everywhere else. The singular form appears only in capacity/page.tsx. The web tests at packages/web/tests/game-links.test.tsx enforce /games/ but don't include capacity/page.tsx in their assertion set, which is why this slipped through.*

**Does the coverage-note link satisfy REQ-SHELF-31's "filter the collection to games without dimensions"?**
[MEDIUM] Partial gap. Three call sites send the user to plain /collection with no query param: capacity/page.tsx:361 (coverage note), capacity/page.tsx:263/267 (NoDimensionsEmpty buttons), and components/capacity-indicator.tsx:22 (neutral state). app/collection/page.tsx only honors ownership=all in searchParams — no "undimensioned" filter exists. Both the call sites and the collection-page feature are missing. The journey "I'll go fix my unmeasured games" lands in an unfiltered collection.
*Reasoning: REQ-SHELF-31 is specific about the filter intent. Current behavior routes users to the right page but offers no scoping. Needs a decision: is the filter in Phase 10 scope or a follow-up? Either way the link targets should convey intent (e.g., ?dimensions=missing) even if the collection-side filter ships later.*

**Is the pre-pass unfittable check consistent with the main packing algorithm?**
[LOW] Latent inconsistency. capacity-service.ts:234 passes DEFAULT_PACK_CONFIG.forceAxis0Width directly to findBestRotation for the pre-pass. The merged config built at line 104 is not consulted. Today no caller overrides packConfig, so there's no observable divergence — but a caller changing forceAxis0Width would get a pre-pass with one rotation policy and a packer with another, and "unfittable" would mean different things on each side.
*Reasoning: Pre-pass and packer must agree on rotation rules to preserve the semantics of the unfittable/overflow split. Fix by reading forceAxis0Width from mergedConfig with a default fallback, once.*

**Is the config merge in capacity-service necessary?**
[LOW/STYLE] Redundant. capacity-service.ts:104 builds mergedConfig = { ...DEFAULT_PACK_CONFIG, ...packConfig } but bin-packing.ts:527 pack() performs the same merge internally. The caller ends up with two merged configs — one the packer uses, one consulted in the pre-pass — which is what enables the inconsistency in finding #3. Either pass mergedConfig into pack() and rely on it end-to-end, or drop the local merge.
*Reasoning: Same root cause as finding #3. Folding the two merges together removes a class of bug, not just the current instance.*

**Does the similarity wiring match REQ-SHELF-25?**
SATISFIED. capacity-service.ts:326–332 builds the compare closure as `1 - compositeDistance(thisVector, otherVector).composite`. compositeDistance returns 0 for identical vectors and 1 for maximally distant, so the conversion produces [0, 1] similarity with 1 = identical — which is what the packer's compare function expects. Null vector guards return 0 (treated as no similarity), which is correct.
*Reasoning: Matches the decision recorded in .lore/plans/shelf-capacity.md and the algorithm's assumption that compare is similarity-valued, not distance-valued. Verified against feature-vector.ts compositeDistance return shape.*

**Does the pre-pass correctly separate unfittable games from Phase 4 overflow?**
SATISFIED. capacity-service.ts runs a geometric pre-pass before packing: games that fail findBestRotation against every shelf are removed from the PackItems list and emitted as UnfittableEntry with reason "too big for any shelf". Only the surviving fittable-by-shape items go into pack(). Phase 4 overflow from pack() therefore contains only games that fit by shape but were displaced by priority/capacity — the correct semantics of "displaced."
*Reasoning: REQ-SHELF-16 (unfittable) and REQ-SHELF-17 (overflow) require the two to be distinct, and the test at capacity-service.test.ts:269-290 confirms the ordering behavior for unfittable-by-fitness-ascending.*

**Are unconstrained-height shelves handled per REQ-SHELF-22?**
SATISFIED. Unconstrained shelves are mapped to height=10000 sentinel for packing (UNCONSTRAINED_HEIGHT_SENTINEL) so they still participate in the algorithm. Downstream, capacityIn3 is set to null and utilization is null — the web (capacity/page.tsx:61 "No utilization tracked") and CLI both handle the null branch without crashing. The sentinel leaks only into the algorithm, not into the response.
*Reasoning: REQ-SHELF-22 requires unconstrained shelves to participate but not show utilization. Verified in capacity-service.ts, capacity/page.tsx ShelfAssignmentCard, and capacity-indicator.tsx.*

**Do edge cases (no config, no dimensions, previously-owned) produce correct responses?**
SATISFIED. (a) No units or no shelves → empty result with configured=false, no 400 (REQ-SHELF-23). (b) No games with dimensions → configured=true, gamesWithDimensions=0, empty assignments; web renders NoDimensionsEmpty and CLI shows the state D message. (c) Previously-owned games are filtered at capacity-service.ts:69 via g.game.ownership !== "previously-owned". OwnershipStatus is "owned" | "previously-owned" only (verified in shared/types.ts), so this filter produces the correct owned-only set.
*Reasoning: Verified in capacity-service.ts and covered by tests in capacity-service.test.ts including the previously-owned-exclusion test. Web and CLI branches both handle the structured empty/degenerate responses without crashing.*

**Does the CLI shelfCapacity command satisfy REQ-SHELF-35?**
SATISFIED. packages/cli/src/commands/shelf.ts implements shelfCapacity with three sections (assignments, unfittable, displaced) and --json that returns the raw ShelfCapacityResult. shelfStatus (REQ-SHELF-34) also matches spec format; its --json returns { config, capacity } which isn't explicitly specified but isn't contradicted either.
*Reasoning: REQ-SHELF-35 requires raw JSON for programmatic use; returning the ShelfCapacityResult directly (not a wrapped/remapped shape) is the correct interpretation.*

**Does the CapacityIndicator component cover all four REQ-SHELF-30 states?**
SATISFIED. capacity-indicator.tsx covers: neutral (configured but no dimensions), danger (unfittable present, optionally with a displaced subrow), warning (overflow only), success (all placed, with shelf count and avg utilization). The compound danger+displaced subrow matches REQ-SHELF-30's layered messaging.
*Reasoning: Four states + compound case verified by reading capacity-indicator.tsx lines 7–113. Placement on the page is a separate style concern (see finding #5).*

**Is the CapacityIndicator placement aligned with the mockup?**
[STYLE] Divergence. app/collection/page.tsx:142 renders <CapacityIndicator /> between .topbar and .main-scroll at the page root. The mockup placed it inside the .filter-bar alongside the other collection controls. The band is a full-width strip in globals.css so current placement is self-consistent, but it isn't the design.
*Reasoning: Visual parity with the mockup wasn't exhaustively verified; flagging this one because it's structural, not a pixel nit.*

**Does the web client surface cover the capacity endpoint?**
SATISFIED. lib/api.ts:347 exports getShelfCapacity(); all five capacity-related types (ShelfCapacityResult, ShelfAssignment, AssignedGame, UnfittableEntry, OverflowEntry) are re-exported from @shelf-judge/shared for consumption by capacity/page.tsx, capacity-indicator.tsx, and collection/page.tsx.
*Reasoning: All types imported in the page/component files resolve through lib/api.ts or directly from shared, with no missing helper.*

**Is grade-badge CSS complete for S–F?**
SATISFIED. packages/web/app/globals.css defines .grade-S, .grade-A, .grade-B, .grade-C, .grade-D, .grade-F with light and dark-mode tokens. Capacity indicator classes (.capacity-indicator, .success/.warning/.danger/.neutral, .cap-icon, .cap-text, .cap-detail-link) also present.
*Reasoning: Verified via grep on globals.css. No missing grade class would degrade the detail page's badge rendering.*

**Does OverflowEntry.fittable have a live code path?**
OBSERVATION (not a defect). The fittable: false branch is dead. Undimensioned games are filtered out before they become PackItems, and the pre-pass removes geometrically unfittable games. Every OverflowEntry currently produced has fittable: true. Either drop the field or leave an explanatory comment — otherwise a future reader will think there's a meaningful distinction in the data.
*Reasoning: Traced the data flow in capacity-service.ts: any game reaching pack() already passed the pre-pass and has dimensions. pack()'s overflow output cannot produce a "geometrically impossible" entry because those were filtered upstream.*

**Is the route registration order in shelf.ts deliberate?**
[STYLE] packages/daemon/src/routes/shelf.ts:120 registers GET /shelf/capacity between PUT /shelf/units/:id and DELETE /shelf/units/:id. No correctness impact in Hono (no path collision). Reads out-of-place; grouping unit CRUD together and the capacity rollup at the end of the router would be more legible.
*Reasoning: Purely organizational. Flagging for completeness since the review brief called out handler organization.*
