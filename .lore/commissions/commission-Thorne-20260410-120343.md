---
title: "Commission: Review: Collection Profiling Phase 4-5"
date: 2026-04-10
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review Phases 4 and 5 of the collection profiling implementation.\n\n**Spec**: `.lore/specs/collection-profiling.md`\n**Plan**: `.lore/plans/collection-profiling.md`\n**Mockup**: `.lore/mockups/profile-overview.html`\n\nFocus areas:\n1. **Service layer**: Stale detection logic correct? Timestamp comparison covers all mutation types? ProfileInput assembly uses the right data sources?\n2. **Storage**: loadProfile/saveProfile follows atomic write pattern?\n3. **Route**: Returns correct shape?\n4. **Client updates**: Both web AND CLI clients updated in Phase 4?\n5. **Web UI spec compliance**: All seven sections rendered in correct order? Omission behavior (divergence when no tournament, outliers when < 3 games)?\n6. **Mockup fidelity**: Color language (amber for personal, slate blue for BGG, navy for actions), section structure, responsive breakpoints, histogram styling\n7. **Navigation**: Collection moved to `/collection`, Profile at `/`, sidebar grouped correctly\n8. **Game detail view**: Divergence and outlier status shown for applicable games\n9. **Anti-goals**: Profile is read-only observation, never alters scores (REQ-PROFILE-35-38)\n\nWalk REQ-PROFILE-24, 25, 6, 16, 29, 30, 31 against the implementation."
dependencies:
  - commission-Dalton-20260410-120329
linked_artifacts:
  - packages/daemon/src/services/profile-service.ts

  - packages/daemon/src/services/storage-service.ts
  - packages/daemon/src/routes/profile.ts
  - packages/daemon/src/app.ts
  - packages/web/app/page.tsx
  - packages/web/app/collection/page.tsx
  - packages/web/components/sidebar.tsx
  - packages/web/app/games/[id]/page.tsx
  - packages/web/components/profile/axis-distributions.tsx
  - packages/web/components/profile/outliers.tsx
  - packages/web/components/profile/divergence.tsx
  - packages/web/components/profile/suggestions.tsx
  - packages/web/lib/api.ts
  - packages/daemon/src/services/storage-service.ts
  - packages/daemon/src/routes/profile.ts
  - packages/daemon/src/app.ts
  - packages/web/app/page.tsx
  - packages/web/app/collection/page.tsx
  - packages/web/components/sidebar.tsx
  - packages/web/app/games/[id]/page.tsx
  - packages/web/components/profile/axis-distributions.tsx
  - packages/web/components/profile/outliers.tsx
  - packages/web/components/profile/divergence.tsx
  - packages/web/components/profile/suggestions.tsx
  - packages/web/lib/api.ts
activity_timeline:
  - timestamp: 2026-04-10T19:03:43.986Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T19:10:00.062Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-10T23:26:59.689Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-10T23:26:59.692Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T23:26:59.713Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T23:27:08.530Z
    event: progress_report
    reason: "Starting review of Phases 4 and 5 of collection profiling. Reading spec, plan, and prior commission artifacts."
  - timestamp: 2026-04-10T23:27:52.707Z
    event: progress_report
    reason: "Phase 4 code read. Service, storage, route, and app wiring examined. Now reading web UI (Phase 5) implementation files."
  - timestamp: 2026-04-10T23:29:00.389Z
    event: progress_report
    reason: "All implementation files read. Sub-agents have analyzed components, tests, CSS, and CLI client. Now reading the mockup and doing focused checks on specific requirements before recording findings."
  - timestamp: 2026-04-10T23:32:21.736Z
    event: progress_report
    reason: "All findings recorded. Preparing final review submission with prioritized findings."
  - timestamp: 2026-04-10T23:33:01.051Z
    event: result_submitted
    reason: "## Review: Phases 4 and 5 of Collection Profiling\n\n### Verdict\n\nStructurally sound. The service layer, storage, routing, app wiring, navigation restructuring, and component extraction all follow established patterns correctly. Anti-goals are respected. Color language and responsive behavior match the mockup. One finding requires rework before this feature ships honestly; the rest are integration-test gaps and a pre-existing UI tension the profile exposed.\n\n---\n\n### Finding 1: CRITICAL — Histogram uses Gaussian approximation, not actual data\n\n**File**: `packages/web/components/profile/axis-distributions.tsx:3-33`\n**Requirement**: REQ-PROFILE-2, Plan Phase 5 Section A\n\nThe `computeHistogramBuckets()` function generates histogram bars from a bell curve fitted to `mean` and `standardDeviation`. It does not use actual game counts per rating bucket. The comment on line 9 says so: \"In a real implementation the daemon would provide raw bucket counts; for now we approximate using a normal distribution curve.\"\n\n**Impact**: Every axis histogram will always render as a bell curve regardless of the actual rating distribution. The plan says the histogram reveals \"bimodal patterns, skew, and clustering that summary statistics alone can't convey.\" A Gaussian approximation conveys exactly nothing beyond the summary statistics it's derived from. This is the one visualization on the profile page that exists to show what the numbers can't, and it's fabricating data.\n\n**Fix**: Add `histogram: number[]` (10-element array of game counts per rating bucket) to `AxisDistribution` in shared types. Compute actual bucket counts in the profile engine. Remove the Gaussian approximation from the component and render actual counts.\n\n---\n\n### Finding 2: MEDIUM — Two divergence indicators on game detail page with different thresholds\n\n**File**: `packages/web/app/games/[id]/page.tsx:64-70` and `:218-248`\n**Requirement**: REQ-PROFILE-31\n\nThe game detail page now has two divergence indicators:\n\n1. **Pre-existing banner** (line 64): threshold > 2.0, excludes provisional and vetoed games\n2. **Profile divergence section** (line 218): threshold > 1.5 (per REQ-PROFILE-7), doesn't check provisional or vetoed status\n\nA game with gap 1.8 appears in the profile section but not the banner. A provisional game could appear in the profile section but not the banner. Two signals, different criteria, no explanation of why they disagree.\n\n**Fix**: Either unify the thresholds and exclusion criteria, or remove the pre-existing banner and let the profile divergence section replace it. The profile's 1.5 threshold is the spec-defined value (REQ-PROFILE-7); the pre-existing 2.0 threshold predates the profile feature and should probably yield to it.\n\n---\n\n### Finding 3: MEDIUM — Stale detection lacks per-mutation integration tests\n\n**File**: `packages/daemon/tests/profile-service.test.ts`\n**Requirement**: REQ-PROFILE-25, Plan Phase 4 test requirements\n\nThe plan requires: \"Stale detection triggers after each mutation type: game add, game remove, rating change, axis change, tournament comparison, BGG refresh (verify collection.updatedAt advances in each case).\"\n\nTests cover: fresh computation, cached return, stale on generic collection timestamp change, stale on tournament session update, stale on comparison create.\n\nMissing: explicit tests that game add, game remove, rating change, axis change, and BGG refresh each advance `collection.updatedAt`. The stale detection logic itself is correct (timestamp comparison works), but nothing verifies that the upstream services actually advance the timestamp on every mutation. If any service skips updating `updatedAt`, the profile silently serves stale data.\n\n---\n\n### Finding 4: LOW — Duplicate `computedAt` timestamps on ProfileData and CollectionProfile\n\n**File**: `packages/daemon/src/services/profile-service.ts:97-103`, `packages/daemon/src/services/profile-engine.ts:73`\n**Requirement**: REQ-PROFILE-24\n\n`computeProfile()` sets `CollectionProfile.computedAt` via `new Date()`. Then the service creates `ProfileData` with its own `computedAt` via a separate `new Date()`. Stale detection uses the wrapper timestamp; the UI displays the inner timestamp. These diverge by the computation duration.\n\n**Fix**: Remove `computedAt` from inside `computeProfile()`. Let the service set it once on the returned `CollectionProfile` and on `ProfileData` from the same value.\n\n---\n\n### Finding 5: LOW — CLI client not updated with explicit profile helper\n\n**File**: `packages/cli/src/client.ts`\n**Requirement**: Plan Phase 4 client updates\n\nThe plan says \"Add the profile endpoint to the CLI's daemon client.\" The web client got `getProfile()` in `lib/api.ts`. The CLI client was not modified; the commission notes the generic client can hit any path. This technically satisfies access but doesn't provide the compile-time type pinning that the web helper does. The retro lesson that motivated this was about client helpers with stale type signatures. Phase 6 (CLI command) will need a caller regardless.\n\n---\n\n### Requirement Walk\n\n| Requirement | Status | Notes |\n|---|---|---|\n| REQ-PROFILE-24 (persisted dataset) | **Satisfied** | profile.json with atomic write pattern |\n| REQ-PROFILE-25 (dirty flag) | **Partially satisfied** | Timestamp comparison logic correct; untested per-mutation coverage |\n| REQ-PROFILE-6 (no external calls) | **Satisfied** | Pure function computation, no I/O in engine |\n| REQ-PROFILE-16 (suggestions as questions) | **Satisfied** | Question phrasing, session-only dismiss |\n| REQ-PROFILE-29 (profile replaces home) | **Satisfied** | Collection at /collection, profile at /, sidebar grouped |\n| REQ-PROFILE-30 (sections) | **Partially satisfied** | All sections present and ordered; histogram data is fabricated (Finding 1) |\n| REQ-PROFILE-31 (game detail) | **Partially satisfied** | Divergence and outlier shown; competing divergence indicators (Finding 2) |\n| REQ-PROFILE-35-38 (anti-goals) | **Satisfied** | Read-only, observational, no recommendations |\n\n### What's done well\n\n- Storage follows the atomic write pattern exactly. No new patterns introduced.\n- The service's lazy recompute is clean: load, compare, recompute-if-stale, save, return. No unnecessary complexity.\n- Color language is rigorously maintained. All components use CSS variables, not hardcoded hex.\n- Section omission behavior is correct throughout. Divergence null-checked, outliers and suggestions length-checked.\n- Component extraction into `components/profile/` keeps the page file focused on layout composition.\n- The narration empty state is a smart forward-planning move for the deferred LLM feature."
  - timestamp: 2026-04-10T23:33:08.436Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All findings recorded. Preparing final review submission with prioritized findings."
projectName: shelf-judge
---
## Review: Phases 4 and 5 of Collection Profiling

### Verdict

Structurally sound. The service layer, storage, routing, app wiring, navigation restructuring, and component extraction all follow established patterns correctly. Anti-goals are respected. Color language and responsive behavior match the mockup. One finding requires rework before this feature ships honestly; the rest are integration-test gaps and a pre-existing UI tension the profile exposed.

---

### Finding 1: CRITICAL — Histogram uses Gaussian approximation, not actual data

**File**: `packages/web/components/profile/axis-distributions.tsx:3-33`
**Requirement**: REQ-PROFILE-2, Plan Phase 5 Section A

The `computeHistogramBuckets()` function generates histogram bars from a bell curve fitted to `mean` and `standardDeviation`. It does not use actual game counts per rating bucket. The comment on line 9 says so: "In a real implementation the daemon would provide raw bucket counts; for now we approximate using a normal distribution curve."

**Impact**: Every axis histogram will always render as a bell curve regardless of the actual rating distribution. The plan says the histogram reveals "bimodal patterns, skew, and clustering that summary statistics alone can't convey." A Gaussian approximation conveys exactly nothing beyond the summary statistics it's derived from. This is the one visualization on the profile page that exists to show what the numbers can't, and it's fabricating data.

**Fix**: Add `histogram: number[]` (10-element array of game counts per rating bucket) to `AxisDistribution` in shared types. Compute actual bucket counts in the profile engine. Remove the Gaussian approximation from the component and render actual counts.

---

### Finding 2: MEDIUM — Two divergence indicators on game detail page with different thresholds

**File**: `packages/web/app/games/[id]/page.tsx:64-70` and `:218-248`
**Requirement**: REQ-PROFILE-31

The game detail page now has two divergence indicators:

1. **Pre-existing banner** (line 64): threshold > 2.0, excludes provisional and vetoed games
2. **Profile divergence section** (line 218): threshold > 1.5 (per REQ-PROFILE-7), doesn't check provisional or vetoed status

A game with gap 1.8 appears in the profile section but not the banner. A provisional game could appear in the profile section but not the banner. Two signals, different criteria, no explanation of why they disagree.

**Fix**: Either unify the thresholds and exclusion criteria, or remove the pre-existing banner and let the profile divergence section replace it. The profile's 1.5 threshold is the spec-defined value (REQ-PROFILE-7); the pre-existing 2.0 threshold predates the profile feature and should probably yield to it.

---

### Finding 3: MEDIUM — Stale detection lacks per-mutation integration tests

**File**: `packages/daemon/tests/profile-service.test.ts`
**Requirement**: REQ-PROFILE-25, Plan Phase 4 test requirements

The plan requires: "Stale detection triggers after each mutation type: game add, game remove, rating change, axis change, tournament comparison, BGG refresh (verify collection.updatedAt advances in each case)."

Tests cover: fresh computation, cached return, stale on generic collection timestamp change, stale on tournament session update, stale on comparison create.

Missing: explicit tests that game add, game remove, rating change, axis change, and BGG refresh each advance `collection.updatedAt`. The stale detection logic itself is correct (timestamp comparison works), but nothing verifies that the upstream services actually advance the timestamp on every mutation. If any service skips updating `updatedAt`, the profile silently serves stale data.

---

### Finding 4: LOW — Duplicate `computedAt` timestamps on ProfileData and CollectionProfile

**File**: `packages/daemon/src/services/profile-service.ts:97-103`, `packages/daemon/src/services/profile-engine.ts:73`
**Requirement**: REQ-PROFILE-24

`computeProfile()` sets `CollectionProfile.computedAt` via `new Date()`. Then the service creates `ProfileData` with its own `computedAt` via a separate `new Date()`. Stale detection uses the wrapper timestamp; the UI displays the inner timestamp. These diverge by the computation duration.

**Fix**: Remove `computedAt` from inside `computeProfile()`. Let the service set it once on the returned `CollectionProfile` and on `ProfileData` from the same value.

---

### Finding 5: LOW — CLI client not updated with explicit profile helper

**File**: `packages/cli/src/client.ts`
**Requirement**: Plan Phase 4 client updates

The plan says "Add the profile endpoint to the CLI's daemon client." The web client got `getProfile()` in `lib/api.ts`. The CLI client was not modified; the commission notes the generic client can hit any path. This technically satisfies access but doesn't provide the compile-time type pinning that the web helper does. The retro lesson that motivated this was about client helpers with stale type signatures. Phase 6 (CLI command) will need a caller regardless.

---

### Requirement Walk

| Requirement | Status | Notes |
|---|---|---|
| REQ-PROFILE-24 (persisted dataset) | **Satisfied** | profile.json with atomic write pattern |
| REQ-PROFILE-25 (dirty flag) | **Partially satisfied** | Timestamp comparison logic correct; untested per-mutation coverage |
| REQ-PROFILE-6 (no external calls) | **Satisfied** | Pure function computation, no I/O in engine |
| REQ-PROFILE-16 (suggestions as questions) | **Satisfied** | Question phrasing, session-only dismiss |
| REQ-PROFILE-29 (profile replaces home) | **Satisfied** | Collection at /collection, profile at /, sidebar grouped |
| REQ-PROFILE-30 (sections) | **Partially satisfied** | All sections present and ordered; histogram data is fabricated (Finding 1) |
| REQ-PROFILE-31 (game detail) | **Partially satisfied** | Divergence and outlier shown; competing divergence indicators (Finding 2) |
| REQ-PROFILE-35-38 (anti-goals) | **Satisfied** | Read-only, observational, no recommendations |

### What's done well

- Storage follows the atomic write pattern exactly. No new patterns introduced.
- The service's lazy recompute is clean: load, compare, recompute-if-stale, save, return. No unnecessary complexity.
- Color language is rigorously maintained. All components use CSS variables, not hardcoded hex.
- Section omission behavior is correct throughout. Divergence null-checked, outliers and suggestions length-checked.
- Component extraction into `components/profile/` keeps the page file focused on layout composition.
- The narration empty state is a smart forward-planning move for the deferred LLM feature.

## Decisions

**Are the axis distribution histograms in the web UI showing actual data?**
No. The histograms use a Gaussian approximation from mean/stddev, not actual per-bucket game counts. This defeats the stated purpose of making "bimodal patterns, skew, and clustering" visible.
*Reasoning: axis-distributions.tsx:9 says "In a real implementation the daemon would provide raw bucket counts; for now we approximate using a normal distribution curve." The AxisDistribution type in shared/types.ts only provides mean, median, stddev, range, and ratedGameCount. It does not include histogram bucket data. The computeHistogramBuckets() function on line 3 generates a bell curve from mean and stddev, meaning every axis will appear normally distributed regardless of actual data shape. The plan (Phase 5, Section A) explicitly says the histogram should reveal "bimodal patterns, skew, and clustering that summary statistics alone can't convey." A Gaussian approximation conveys exactly nothing beyond the summary statistics.*

**Does the game detail page have competing divergence indicators?**
Yes. Two divergence indicators coexist with different thresholds (2.0 vs 1.5) and different exclusion criteria (provisional/vetoed status vs null normalizedScore only).
*Reasoning: games/[id]/page.tsx:64-70 has a pre-existing divergence banner with threshold > 2.0, excluding provisional and vetoed games. Lines 218-248 add the profile's divergence section which uses the profile engine's 1.5 threshold (REQ-PROFILE-7), which doesn't check isProvisional or vetoed. A game with gap 1.8 would show in the profile divergence section but NOT trigger the banner. A provisional game could appear in the profile divergence but not the banner. Two competing signals on the same page, with no visual reconciliation or explanation of why they differ.*

**Does the profile have duplicate computedAt timestamps?**
Yes. ProfileData.computedAt and CollectionProfile.computedAt are set by separate new Date() calls, creating two slightly different timestamps for the same concept.
*Reasoning: profile-engine.ts:73 sets computedAt = new Date().toISOString() inside computeProfile(). profile-service.ts:98 sets a separate now = new Date().toISOString() on the ProfileData wrapper. Stale detection (profile-service.ts:58-59) reads from the wrapper's computedAt. The route returns the inner CollectionProfile. The UI displays profile.computedAt (inner). These two timestamps diverge by the computation duration. While negligible in practice for the algorithmic profile, it's unnecessary duplication. If the engine's computedAt were removed and the service set it once on the returned CollectionProfile, both concerns would use the same timestamp.*

**Does stale detection cover all mutation types specified in REQ-PROFILE-25?**
The stale detection logic is structurally correct but relies on an untested assumption: that collection.updatedAt advances on every mutation type. Only tournament-related staleness is integration-tested.
*Reasoning: REQ-PROFILE-25 says "any write to collection data (ratings, games, axes, tournament results, BGG refreshes) sets a dirty flag." The service compares profile.computedAt against collection.updatedAt and tournament timestamps. This works IF collection.updatedAt is reliably advanced by game service (add/remove/rate/refresh) and axis service (create/update/delete). The plan (Phase 4, line 679) explicitly requires tests for each mutation type. The test file covers: fresh computation, cached return, stale on collection change (generic), stale on tournament session update, stale on comparison create. Missing: explicit tests that game add, game remove, rating change, axis change, and BGG refresh each advance collection.updatedAt and trigger recomputation.*

**Does the profile page implement the stale profile indicator from the mockup?**
The CSS exists (.stale-badge, .btn-recompute) but the page component does not render them. This is correct behavior for the algorithmic profile, which always recomputes lazily on read.
*Reasoning: The service's getProfile() checks staleness and recomputes before returning, so the UI never receives a stale algorithmic profile. The stale indicator is needed for the deferred LLM narration layer (where narration is cached and may lag behind profile changes). The CSS being present is forward planning. The mockup shows the stale state as one of four states, but it's narration-specific context. No defect here; the implementation correctly defers what's deferred.*

**Are the anti-goals (REQ-PROFILE-35-38) respected?**
Yes. The profile is read-only observation. No mutation endpoints, no recommendation language, no score generation.
*Reasoning: The daemon exposes a single GET /api/profile endpoint with no mutations. The profile engine is a pure function that reads existing data. UI language is observational: "Composite distance X from collection centroid", "Tournament rates higher than fitness", divergence described as a "gap" not a problem. Suggestions are phrased as questions per REQ-PROFILE-16. The "Dismiss" button on suggestions is session-only (client state, not persisted). No "you should" or "consider removing" language anywhere. REQ-PROFILE-35 (not a recommendation engine): no "buy X" suggestions. REQ-PROFILE-37 (doesn't generate ratings): suggestions prompt user to create axes manually. REQ-PROFILE-38 (not prescriptive): data is presented without action recommendations.*

**Does the web UI match the mockup's section order and omission behavior?**
Section order matches. Omission behavior is correct for divergence (null check) and outliers/suggestions (length check). The utility curves component has its own internal filtering but no explicit "fewer than 3 games" gate.
*Reasoning: page.tsx renders in order: NarrationEmpty, AxisDistributions, AxisWeights, BggClustering, UtilityCurves, Divergence (conditional on !== null), Outliers (conditional on .length > 0), Suggestions (conditional on .length > 0). The spec says "sections with insufficient data are omitted rather than showing empty states" and the constraint says "With fewer than 3 games, some analyses (outlier detection, divergence) will produce empty or partial results." The profile engine handles this by producing empty arrays/null when data is insufficient; the UI omits those sections. This is the right layering.*

**Does the CLI get updated alongside the web client in Phase 4?**
The web client got an explicit getProfile() helper. The CLI client was not modified because it uses a generic client. This technically satisfies the retro lesson but is asymmetric.
*Reasoning: The plan says "Add the profile endpoint to the CLI's daemon client." The commission report says "CLI: Generic client already supports get&lt;CollectionProfile&gt;('/api/profile'), no changes needed to client.ts." The retro lesson (.lore/retros/tournament-stats-record-shape-mismatch.md) that motivated this requirement was about response shape mismatches between daemon and clients. The web client has an explicit helper that pins the response type. The CLI relies on a generic get&lt;T&gt;() where the caller specifies the type at call site. The Phase 6 CLI command (not yet implemented) will be the actual consumer. The risk is lower because the CLI's generic client doesn't have a helper with a stale type signature to maintain, but it also doesn't get compile-time guarantees that the endpoint exists.*

**Does the CSS color language match the mockup specification?**
All five specified color tokens are present and match: amber (#b86c1a), slate blue (#2e5f8a), navy (#1c3d5e), red (#b84040), purple (#5c3d99). Additional outlier palette tokens are defined. Responsive breakpoint at 720px for BGG two-column grid confirmed.
*Reasoning: globals.css :root defines --score-color: #b86c1a, --bgg-accent: #2e5f8a, --action: #1c3d5e, --score-low: #b84040, --outlier-lone: #5c3d99. All components use CSS classes that reference these variables rather than hardcoded hex values. The .two-col grid collapses to single column at 720px via @media query. Color provenance rule (amber for personal, slate blue for BGG, navy for actions) is maintained across all components based on the class naming and CSS variable usage.*
