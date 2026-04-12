---
title: "Commission: Wishlist: Final Review"
date: 2026-04-12
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Full review of the completed wishlist feature against the spec at `.lore/specs/wishlist.md` and plan at `.lore/plans/wishlist.md`.\n\nReview ALL implementation across:\n- `packages/shared/src/types.ts` (wishlist types)\n- `packages/daemon/src/services/` (storage, wishlist service)\n- `packages/daemon/src/routes/` (wishlist routes, games auto-removal)\n- `packages/daemon/src/app.ts` (wiring)\n- `packages/web/lib/api.ts` (client helpers)\n- `packages/web/app/search/page.tsx` (wishlist button)\n- `packages/web/app/wishlist/page.tsx` (wishlist page)\n- `packages/web/components/sidebar.tsx` (nav entry)\n- `packages/web/app/globals.css` (new styles)\n- `packages/cli/src/commands/wishlist.ts` (CLI commands)\n- All test files\n\nVerify against the spec's requirements (REQ-WISH-1 through REQ-WISH-29):\n1. All six API endpoints implemented and tested\n2. Web client helpers cover all endpoints (client/daemon divergence check)\n3. CLI commands cover all endpoints\n4. POST /games auto-removes matching wishlist entry (REQ-WISH-10)\n5. Wishlist operations do NOT trigger profile dirty flag or niche recomputation (REQ-WISH-28)\n6. Search page wishlist button works for both states (REQ-WISH-18/19)\n7. Wishlist page renders all card states from the mockup\n8. Sidebar order: Collection, Wishlist, Add Games (REQ-WISH-24)\n9. Dark mode uses existing tokens only\n\nRun `bun run test`, `bun run typecheck`, `bun run lint`.\n\nSurface ALL findings. Do not triage or defer anything."
dependencies:
  - commission-Dalton-20260412-111714
  - commission-Dalton-20260412-111723
linked_artifacts:
  - packages/web/app/wishlist/page.tsx

  - packages/daemon/src/services/wishlist-service.ts
  - packages/daemon/src/routes/wishlist.ts
  - packages/daemon/src/routes/games.ts
  - packages/web/app/search/page.tsx
  - packages/web/components/sidebar.tsx
  - packages/web/lib/api.ts
  - packages/cli/src/commands/wishlist.ts
  - packages/daemon/tests/wishlist-service.test.ts
  - packages/daemon/tests/wishlist-routes.test.ts
  - packages/daemon/src/services/wishlist-service.ts
  - packages/daemon/src/routes/wishlist.ts
  - packages/daemon/src/routes/games.ts
  - packages/web/app/search/page.tsx
  - packages/web/components/sidebar.tsx
  - packages/web/lib/api.ts
  - packages/cli/src/commands/wishlist.ts
  - packages/daemon/tests/wishlist-service.test.ts
  - packages/daemon/tests/wishlist-routes.test.ts
activity_timeline:
  - timestamp: 2026-04-12T18:17:33.997Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T18:17:33.998Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T18:45:12.345Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T18:45:12.347Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T18:45:12.372Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T18:45:20.053Z
    event: progress_report
    reason: "Starting wishlist feature review. Reading spec, plan, and all implementation files."
  - timestamp: 2026-04-12T18:45:55.311Z
    event: progress_report
    reason: "Read all implementation files. Now reading test files and running verification commands."
  - timestamp: 2026-04-12T18:46:29.585Z
    event: progress_report
    reason: "Code review complete. Recording findings. Proxy route handles DELETE. All major implementation files read. Now analyzing for defects and spec compliance."
  - timestamp: 2026-04-12T18:49:37.441Z
    event: result_submitted
    reason: "# Wishlist Feature Review\n\n## Verdict\n\nThe implementation satisfies all 29 spec requirements (REQ-WISH-1 through REQ-WISH-29). The backend is clean, well-tested, and correctly structured. Two UI state management bugs need fixing before the feature is ready.\n\n---\n\n## Confirmed Defects\n\n### 1. Refresh button stuck in loading state after successful refresh\n**File:** `packages/web/app/wishlist/page.tsx:115, 178-183`\n**Impact:** Every Refresh click permanently disables the button on that card. The user cannot refresh the same entry twice without reloading the page.\n\nThe `refreshing` useState is set to `true` on click but never reset to `false`. The parent's `handleRefresh` (line 279) updates the entry via `setEntries`, which re-renders the WishlistCard with new props, but React preserves the component instance (same `key={entry.id}`) and its internal state.\n\n**Fix:** Either lift the refreshing state to the parent (pass `refreshingId` as a prop), or have `onRefresh` return a promise so the child can `await` it and reset its own state in a `finally` block.\n\n### 2. Add to Collection button stuck in loading state on failure\n**File:** `packages/web/app/wishlist/page.tsx:116, 168-172`\n**Impact:** If adding to collection fails (409, network error), the \"Add to Collection\" button permanently shows \"Adding...\" on that card. The user cannot retry.\n\nSame root cause as #1: `addingToCollection` is set to `true` with no reset path on failure. On success, the component unmounts (entry removed), so this only manifests when the add fails.\n\n**Fix:** Same pattern as #1. Lift state or return a promise.\n\n---\n\n## Style/Dark Mode Concern\n\n### 3. `.btn-wishlisted` border mixes with `white` rather than a theme-aware token\n**File:** `packages/web/app/globals.css:6392`\n**Impact:** In dark mode, the border `color-mix(in hsl, var(--score-high), white 75%)` produces a brighter border than the dark theme convention. Other dark mode tokens consistently mix with `var(--bg-base)` (e.g., `--outlier-fitness-border` at line 227 has a dark override). This button has no dark override, so the border uses the light mode formula.\n\n**Fix:** Either add a dark mode override for the border, or use an existing token like `--score-high-bg` instead of the inline color-mix.\n\n---\n\n## Observations (non-blocking)\n\n### 4. Confidence fallback in buildEntry defaults null to \"strong\"\n**File:** `packages/daemon/src/services/wishlist-service.ts:38`\n\n`b.predictionConfidence ?? \"strong\"` is a defensive default that masks rather than surfaces a gap. For predicted games, this field should always be set by the prediction engine. If it's ever null, defaulting to \"strong\" is the worst possible guess. A null propagation or \"weak\" default would be more honest. Low risk because the triggering condition requires a bug in the prediction engine.\n\n### 5. refreshAll reloads niche settings and game list per entry\n**File:** `packages/daemon/src/services/wishlist-service.ts:149-153`\n\nEach entry in the `refreshAll` loop calls `computeNicheImpactForResult`, which reloads niche settings and all games from storage. For N entries, that's N redundant reads. Not a correctness issue. For the expected wishlist size (tens of entries per REQ-WISH-21), the overhead is negligible.\n\n### 6. Route-level test gap for partial-failure refreshAll\n**File:** `packages/daemon/tests/wishlist-routes.test.ts:202-211`\n\n`POST /api/wishlist/refresh` is only tested for the all-success case. The service-level test (`wishlist-service.test.ts:391-429`) covers partial failure thoroughly. Since the route is a thin passthrough, this is low risk, but it means the HTTP response shape for `{ refreshed: 1, errors: [\"...\"] }` is untested at the route layer.\n\n---\n\n## Spec Compliance Checklist\n\nAll 29 requirements verified:\n\n| Requirement | Status | Evidence |\n|---|---|---|\n| REQ-WISH-1 (data model) | PASS | `types.ts:517-534` matches spec exactly |\n| REQ-WISH-2 (shared types) | PASS | Defined in `packages/shared`, consumed by all packages |\n| REQ-WISH-3 (BGG ID uniqueness) | PASS | `wishlist-service.ts:76-78` |\n| REQ-WISH-4 (snapshot semantics) | PASS | Stored at add time, only updated on explicit refresh |\n| REQ-WISH-5 (add with Stage 0) | PASS | `buildEntry` handles `predictionUnavailable`, tested |\n| REQ-WISH-6 (reject if in collection) | PASS | `wishlist-service.ts:80-83`, tested |\n| REQ-WISH-7 (no full Game persistence) | PASS | Only WishlistEntry fields stored |\n| REQ-WISH-8 (remove individual) | PASS | Service + route implemented and tested |\n| REQ-WISH-9 (clear with confirmation) | PASS | CLI: readline prompt; Web: `confirm()` dialog |\n| REQ-WISH-10 (auto-removal) | PASS | `games.ts:143-146`, fire-and-forget with `.catch()`, tested |\n| REQ-WISH-11 (refresh preserves addedAt) | PASS | `wishlist-service.ts:131-133`, tested |\n| REQ-WISH-12 (bulk refresh with errors) | PASS | Sequential processing, error collection, tested |\n| REQ-WISH-13 (separate file) | PASS | `wishlist.json` in data dir |\n| REQ-WISH-14 (atomic write) | PASS | Uses `atomicWrite` via storage service |\n| REQ-WISH-15 (six endpoints) | PASS | All six routes registered with correct methods/paths |\n| REQ-WISH-16 (response shapes) | PASS | Shapes match spec |\n| REQ-WISH-17 (route module pattern) | PASS | Follows existing pattern with OperationDefinition[] |\n| REQ-WISH-18 (search wishlist button) | PASS | Button with both states implemented |\n| REQ-WISH-19 (wishlist state on mount) | PASS | `useEffect` fetches wishlist, builds `Set<number>` |\n| REQ-WISH-20 (wishlist page content) | PASS | All display elements present |\n| REQ-WISH-21 (sort options) | PASS | Date/Score/Name with nulls-last for score |\n| REQ-WISH-22 (Refresh All) | PASS | Button in topbar, refetches list after completion |\n| REQ-WISH-23 (Add to Collection) | PASS | Calls POST /games, navigates to game detail on success |\n| REQ-WISH-24 (sidebar order) | PASS | Collection, Wishlist, Add Games in Library group |\n| REQ-WISH-25 (CLI commands) | PASS | All 5 subcommands registered |\n| REQ-WISH-26 (CLI list output) | PASS | Table with Name/Year/Score/Confidence/Added columns |\n| REQ-WISH-27 (CLI add output) | PASS | \"Added {name} (predicted: X.X)\" or \"(no prediction)\" |\n| REQ-WISH-28 (no collection effect) | PASS | No profile dirty flag, no niche recomputation |\n| REQ-WISH-29 (prediction read-only) | PASS | Uses `predictBggGame`, no collection mutation |\n\n## Test Coverage\n\nBoth test files provide good coverage:\n- **wishlist-service.test.ts**: 10 tests covering add, Stage 0, duplicate rejection, collection conflict, remove, clear, refresh (preserving addedAt), removeByBggId, refreshAll with partial failure\n- **wishlist-routes.test.ts**: 13 tests covering all route response codes, sorting, auto-removal on game add, collection isolation\n\n## Client/Daemon Divergence Check\n\nAll six daemon endpoints have corresponding:\n- Web client helpers in `packages/web/lib/api.ts:298-323`\n- CLI commands in `packages/cli/src/commands/wishlist.ts`\n- Web proxy route handles DELETE (`packages/web/app/api/daemon/[...path]/route.ts:70-75`)\n\nNo divergence detected."
  - timestamp: 2026-04-12T18:49:48.071Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Code review complete. Recording findings. Proxy route handles DELETE. All major implementation files read. Now analyzing for defects and spec compliance."
projectName: shelf-judge
---
# Wishlist Feature Review

## Verdict

The implementation satisfies all 29 spec requirements (REQ-WISH-1 through REQ-WISH-29). The backend is clean, well-tested, and correctly structured. Two UI state management bugs need fixing before the feature is ready.

---

## Confirmed Defects

### 1. Refresh button stuck in loading state after successful refresh
**File:** `packages/web/app/wishlist/page.tsx:115, 178-183`
**Impact:** Every Refresh click permanently disables the button on that card. The user cannot refresh the same entry twice without reloading the page.

The `refreshing` useState is set to `true` on click but never reset to `false`. The parent's `handleRefresh` (line 279) updates the entry via `setEntries`, which re-renders the WishlistCard with new props, but React preserves the component instance (same `key={entry.id}`) and its internal state.

**Fix:** Either lift the refreshing state to the parent (pass `refreshingId` as a prop), or have `onRefresh` return a promise so the child can `await` it and reset its own state in a `finally` block.

### 2. Add to Collection button stuck in loading state on failure
**File:** `packages/web/app/wishlist/page.tsx:116, 168-172`
**Impact:** If adding to collection fails (409, network error), the "Add to Collection" button permanently shows "Adding..." on that card. The user cannot retry.

Same root cause as #1: `addingToCollection` is set to `true` with no reset path on failure. On success, the component unmounts (entry removed), so this only manifests when the add fails.

**Fix:** Same pattern as #1. Lift state or return a promise.

---

## Style/Dark Mode Concern

### 3. `.btn-wishlisted` border mixes with `white` rather than a theme-aware token
**File:** `packages/web/app/globals.css:6392`
**Impact:** In dark mode, the border `color-mix(in hsl, var(--score-high), white 75%)` produces a brighter border than the dark theme convention. Other dark mode tokens consistently mix with `var(--bg-base)` (e.g., `--outlier-fitness-border` at line 227 has a dark override). This button has no dark override, so the border uses the light mode formula.

**Fix:** Either add a dark mode override for the border, or use an existing token like `--score-high-bg` instead of the inline color-mix.

---

## Observations (non-blocking)

### 4. Confidence fallback in buildEntry defaults null to "strong"
**File:** `packages/daemon/src/services/wishlist-service.ts:38`

`b.predictionConfidence ?? "strong"` is a defensive default that masks rather than surfaces a gap. For predicted games, this field should always be set by the prediction engine. If it's ever null, defaulting to "strong" is the worst possible guess. A null propagation or "weak" default would be more honest. Low risk because the triggering condition requires a bug in the prediction engine.

### 5. refreshAll reloads niche settings and game list per entry
**File:** `packages/daemon/src/services/wishlist-service.ts:149-153`

Each entry in the `refreshAll` loop calls `computeNicheImpactForResult`, which reloads niche settings and all games from storage. For N entries, that's N redundant reads. Not a correctness issue. For the expected wishlist size (tens of entries per REQ-WISH-21), the overhead is negligible.

### 6. Route-level test gap for partial-failure refreshAll
**File:** `packages/daemon/tests/wishlist-routes.test.ts:202-211`

`POST /api/wishlist/refresh` is only tested for the all-success case. The service-level test (`wishlist-service.test.ts:391-429`) covers partial failure thoroughly. Since the route is a thin passthrough, this is low risk, but it means the HTTP response shape for `{ refreshed: 1, errors: ["..."] }` is untested at the route layer.

---

## Spec Compliance Checklist

All 29 requirements verified:

| Requirement | Status | Evidence |
|---|---|---|
| REQ-WISH-1 (data model) | PASS | `types.ts:517-534` matches spec exactly |
| REQ-WISH-2 (shared types) | PASS | Defined in `packages/shared`, consumed by all packages |
| REQ-WISH-3 (BGG ID uniqueness) | PASS | `wishlist-service.ts:76-78` |
| REQ-WISH-4 (snapshot semantics) | PASS | Stored at add time, only updated on explicit refresh |
| REQ-WISH-5 (add with Stage 0) | PASS | `buildEntry` handles `predictionUnavailable`, tested |
| REQ-WISH-6 (reject if in collection) | PASS | `wishlist-service.ts:80-83`, tested |
| REQ-WISH-7 (no full Game persistence) | PASS | Only WishlistEntry fields stored |
| REQ-WISH-8 (remove individual) | PASS | Service + route implemented and tested |
| REQ-WISH-9 (clear with confirmation) | PASS | CLI: readline prompt; Web: `confirm()` dialog |
| REQ-WISH-10 (auto-removal) | PASS | `games.ts:143-146`, fire-and-forget with `.catch()`, tested |
| REQ-WISH-11 (refresh preserves addedAt) | PASS | `wishlist-service.ts:131-133`, tested |
| REQ-WISH-12 (bulk refresh with errors) | PASS | Sequential processing, error collection, tested |
| REQ-WISH-13 (separate file) | PASS | `wishlist.json` in data dir |
| REQ-WISH-14 (atomic write) | PASS | Uses `atomicWrite` via storage service |
| REQ-WISH-15 (six endpoints) | PASS | All six routes registered with correct methods/paths |
| REQ-WISH-16 (response shapes) | PASS | Shapes match spec |
| REQ-WISH-17 (route module pattern) | PASS | Follows existing pattern with OperationDefinition[] |
| REQ-WISH-18 (search wishlist button) | PASS | Button with both states implemented |
| REQ-WISH-19 (wishlist state on mount) | PASS | `useEffect` fetches wishlist, builds `Set<number>` |
| REQ-WISH-20 (wishlist page content) | PASS | All display elements present |
| REQ-WISH-21 (sort options) | PASS | Date/Score/Name with nulls-last for score |
| REQ-WISH-22 (Refresh All) | PASS | Button in topbar, refetches list after completion |
| REQ-WISH-23 (Add to Collection) | PASS | Calls POST /games, navigates to game detail on success |
| REQ-WISH-24 (sidebar order) | PASS | Collection, Wishlist, Add Games in Library group |
| REQ-WISH-25 (CLI commands) | PASS | All 5 subcommands registered |
| REQ-WISH-26 (CLI list output) | PASS | Table with Name/Year/Score/Confidence/Added columns |
| REQ-WISH-27 (CLI add output) | PASS | "Added {name} (predicted: X.X)" or "(no prediction)" |
| REQ-WISH-28 (no collection effect) | PASS | No profile dirty flag, no niche recomputation |
| REQ-WISH-29 (prediction read-only) | PASS | Uses `predictBggGame`, no collection mutation |

## Test Coverage

Both test files provide good coverage:
- **wishlist-service.test.ts**: 10 tests covering add, Stage 0, duplicate rejection, collection conflict, remove, clear, refresh (preserving addedAt), removeByBggId, refreshAll with partial failure
- **wishlist-routes.test.ts**: 13 tests covering all route response codes, sorting, auto-removal on game add, collection isolation

## Client/Daemon Divergence Check

All six daemon endpoints have corresponding:
- Web client helpers in `packages/web/lib/api.ts:298-323`
- CLI commands in `packages/cli/src/commands/wishlist.ts`
- Web proxy route handles DELETE (`packages/web/app/api/daemon/[...path]/route.ts:70-75`)

No divergence detected.

## Decisions

**Does the WishlistCard refresh button reset its loading state after completion?**
DEFECT: The `refreshing` useState in WishlistCard is set to true on click but never reset to false. The parent's handleRefresh updates the entry prop, which re-renders the card, but React doesn't reset local useState on prop changes. The Refresh button permanently displays "..." after one click.
*Reasoning: wishlist/page.tsx:115 declares `const [refreshing, setRefreshing] = useState(false)`. Lines 155-157 and 178-183 set it true. No code path sets it back to false. The parent callback is fire-and-forget from the child's perspective. Verified by tracing the full data flow: parent handleRefresh (line 279) updates entries state, which triggers re-render of WishlistCard with new entry prop, but the component instance persists (same key) so its internal state is preserved.*

**Does the WishlistCard Add to Collection button handle failure states?**
DEFECT: The `addingToCollection` useState in WishlistCard is set to true on click but never reset on failure. If the parent's handleAddToCollection hits a 409 or network error, the card persists with the button stuck in "Adding..." state. On success, the component unmounts (entry removed from list), so this only manifests on failure paths.
*Reasoning: wishlist/page.tsx:116 declares `const [addingToCollection, setAddingToCollection] = useState(false)`. Line 170 sets it true. No code path sets it back to false. The parent's handleAddToCollection (line 323) catches errors and sets error state but has no callback to the child to reset its loading flag. The child's `onAddToCollection` callback is fire-and-forget.*

**Are all 29 spec requirements (REQ-WISH-1 through REQ-WISH-29) satisfied?**
All 29 requirements are satisfied. Types in shared (REQ-WISH-1/2), duplicate/collection checks (REQ-WISH-3/6), snapshot semantics (REQ-WISH-4/7), CRUD operations (REQ-WISH-5/8/9), auto-removal (REQ-WISH-10), refresh with preserved addedAt (REQ-WISH-11/12), storage (REQ-WISH-13/14), all six API endpoints (REQ-WISH-15/16/17), search page button (REQ-WISH-18/19), wishlist page (REQ-WISH-20/21/22/23), sidebar order (REQ-WISH-24), CLI commands (REQ-WISH-25/26/27), collection isolation (REQ-WISH-28/29).
*Reasoning: Verified by reading each implementation file against the corresponding requirement. Types match spec exactly. Service implements all business logic. Routes implement all six endpoints with correct response shapes. Web UI has search button, wishlist page with sort/refresh/add-to-collection/clear. Sidebar has correct order (Collection, Wishlist, Add Games). CLI has all five subcommands with --json support. No profile dirty flag or niche recomputation in wishlist code paths.*

**Does the confidence fallback in buildEntry correctly handle edge cases?**
OBSERVATION: wishlist-service.ts:38 uses `b.predictionConfidence ?? "strong"` when mapping breakdown entries. For predicted games, predictionConfidence should always be set on predicted axes. The fallback to "strong" would silently misrepresent confidence if it ever fired. Low risk since the condition is unlikely to trigger, but the defensive default masks rather than surfaces a gap.
*Reasoning: FitnessBreakdownEntry has `predictionConfidence: PredictionConfidence | null`. For non-collection games being predicted, the prediction engine sets this field. The null case would only arise from a bug in the prediction engine itself. Defaulting to "strong" is the wrong direction for a defensive default - "weak" or propagating null would be more honest.*

**Does the dark mode styling for wishlist button use consistent token patterns?**
OBSERVATION: globals.css line ~6392 `.btn-wishlisted` border uses `color-mix(in hsl, var(--score-high), white 75%)`. Other dark mode tokens consistently mix with `var(--bg-base)` rather than `white`. This could produce an overly bright border in dark mode. All other wishlist CSS correctly uses existing design tokens.
*Reasoning: The light theme tokens (e.g., --score-high-bg, --action-subtle) mix with `white`. The dark theme overrides (starting at globals.css:141) redefine these tokens to mix with `var(--bg-base)` instead. The `.btn-wishlisted` border is defined once and uses `white`, which works fine in light mode but doesn't adapt for dark mode because it's not using a CSS variable. Compare with `--outlier-fitness-border` which has a dark mode override at line 227.*
