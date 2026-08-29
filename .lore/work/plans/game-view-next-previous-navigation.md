---
title: "Implementation plan: Collection-scoped game detail navigation"
date: 2026-08-29
status: executed
tags: [plan, navigation, game-detail, collection, testing]
modules: [web-ui]
related:
  - .lore/work/specs/game-view-next-previous-navigation.md
  - .lore/work/design/game-view-next-previous-navigation.md
  - .lore/work/brainstorm/game-view-next-previous-navigation.md
  - .lore/work/research/game-view-next-previous-navigation.md
---

# Implementation plan: Collection-scoped game detail navigation

## Goal And Sources

Implement the approved behavior in `.lore/work/specs/game-view-next-previous-navigation.md` using the architecture in `.lore/work/design/game-view-next-previous-navigation.md`.

The implementation remains web-only. Collection produces immutable snapshots from the exact flat rows it renders. Game detail consumes optional browser context without fetching or reconstructing the collection. Direct routes and all non-Collection game links remain context-free.

## Requirement Coverage

| Obligations                                                                                                                       | Implemented in    | Primary evidence                                                           |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------- |
| Exact flat sequence, hydration gating, contextual row links, grouped exclusion, deterministic ties (`REQ-GAME-NAV-1` through `6`) | Steps 1, 3, 4     | Sort/projection unit tests, producer tests, DOM-to-snapshot browser parity |
| Versioned context integrity, immutability, retention, storage failure, separate projections/tabs (`REQ-GAME-NAV-7` through `12`)  | Steps 2 and 3     | Store and producer unit tests, cross-tab browser cases                     |
| Detail strip, exact neighbors, boundaries, omission, mutation/unavailable behavior (`REQ-GAME-NAV-13` through `19`)               | Step 5            | Pure model/static rendering tests and browser traversal                    |
| Reload, new tabs, contextual return, row/heading focus, fallback (`REQ-GAME-NAV-20` through `24`)                                 | Steps 4 through 6 | Context resolution tests and Playwright return scenarios                   |
| Semantic links, accessible names, focus, target size, responsive overflow (`REQ-GAME-NAV-25` through `29`)                        | Steps 5 and 6     | Static assertions and browser accessibility/geometry checks                |
| Direct route stability, non-Collection links, grouped mode, no wrapping, no prevalidation, no durable-state or daemon expansion   | Steps 4 through 7 | Negative link tests, grouped/direct browser cases, changed-surface review  |

Every approved requirement maps to at least one implementation step and executable check. Step 7 reconciles the complete list against final evidence rather than treating a passing broad suite as proof by itself.

## Step 1: Make Generic Collection Order Deterministic

**Files**

- Modify `packages/web/lib/collection-utils.ts`.
- Modify `packages/web/tests/collection-table.test.ts`.
- Reuse or extend `packages/web/tests/purchase-utilization-sorting.test.ts` only if helper extraction changes specialized-sort assertions.

**Changes**

1. Promote the existing Unicode code-point comparison and NFC-name/stable-ID tie logic into one shared collection identity comparator.
2. Apply selected direction only to the generic primary sort comparison. When primary values compare equal, use ascending normalized name and stable ID without direction reversal.
3. Use the same identity comparator for the generic no-value group.
4. Preserve existing specialized value-remaining and estimated-additional-plays category and displayed-precision behavior while routing their ties through the shared comparator.
5. Preserve the existing case-insensitive primary Name sort; use original normalized name and ID only after that primary value ties.

**Local gate**

- Tests cover equal numeric/date/string primary values in both directions, NFC-equivalent names, case-insensitive Name ties, identical names with different IDs, and no-value ties.
- Existing generic and specialized sorting tests pass with no category, null-placement, precision, or direction regressions.
- Run:

```bash
bun test packages/web/tests/collection-table.test.ts packages/web/tests/purchase-utilization-sorting.test.ts
bunx prettier --check packages/web/lib/collection-utils.ts packages/web/tests/collection-table.test.ts packages/web/tests/purchase-utilization-sorting.test.ts
```

## Step 2: Implement The Versioned Context Store

**Files**

- Add `packages/web/lib/collection-navigation-context.ts`.
- Add `packages/web/tests/collection-navigation-context.test.ts`.

**Changes**

1. Define the version-1 context, projection, scope, and entry types without `any`, unsafe assertions, or unvalidated parsed JSON.
2. Implement strict runtime validation for schema, field unions, finite timestamps, nonempty IDs/names, unique entry IDs, opaque UUID-format keys, and exact-once requested current/origin membership.
3. Store each immutable context under its own versioned prefix. Never rewrite sequence, scope, or projection fields for an existing key.
4. Inject storage, clock, UUID generation, and exclusive-lock execution into pure store operations; production defaults use `localStorage`, `Date.now`, `crypto.randomUUID`, and the named Web Lock.
5. Implement locked creation with collision checks, complete-write confirmation, and `null` on any failed create/write/read-back.
6. Implement resolution in the approved order: read/validate, reject expiry, refresh timestamp monotonically, re-read when refresh succeeds, then clean malformed/expired records and retain the newest 20 while preferring the requested record on timestamp ties.
7. If refresh alone fails, return the already-read valid record for the current page without advancing stored recency. If Web Locks are unavailable, creation fails and resolution is read-only with no unlocked mutation.
8. Keep cleanup and storage errors contained so no route or render throws because browser storage is unavailable or corrupt.

**Local gate**

- Unit tests cover valid creation/resolution, every malformed field family, duplicate IDs, exact-once current/origin checks, schema mismatch, seven-day edge, creation/detail/return recency events, refresh-write failure, collision handling, deterministic 20-record LRU, requested-record retention, monotonic serialized competing operations, lock-unavailable fallback, storage exceptions, and immutable independent records.
- Run:

```bash
bun test packages/web/tests/collection-navigation-context.test.ts
bunx tsc --noEmit -p packages/web/tsconfig.json
bunx prettier --check packages/web/lib/collection-navigation-context.ts packages/web/tests/collection-navigation-context.test.ts
```

## Step 3: Implement The Projection Producer State Machine

**Files**

- Add `packages/web/lib/collection-navigation-producer.ts`.
- Add `packages/web/tests/collection-navigation-producer.test.ts`.

**Changes**

1. Define canonical entry creation and fingerprint inputs for ordered entry IDs, names, and order; sort field and direction; search, rated, played, and player-count filters; ownership and dimensions scopes; user and effective prediction state; niches state; and flat/grouped mode.
2. Implement a pure state transition model for current fingerprint, attempted fingerprint, and successful `{ fingerprint, key }`.
3. Make the selector return a key only when hydration, flat eligibility, current fingerprint, and successful fingerprint all agree.
4. Implement the React hook around the state machine. Mark an attempt before awaiting context creation so effect replay cannot duplicate it.
5. Ignore late success for activation when the projection has moved on, while leaving the independently stored old context available to already-open links.
6. Expose a structural helper that creates snapshot entries from the same `withValue` then `withoutValue` arrays Collection renders.

**Local gate**

- Unit tests cover pre-hydration and grouped ineligibility, attempt deduplication, failed persistence, atomic activation after success, immediate old-key rejection on fingerprint change, stale asynchronous success, new-key activation, separate producer instances, and exact valued/no-value entry order.
- A table-driven fingerprint test varies each input independently: entry ID, entry name, entry order, sort field, sort direction, search, rated status, played status, player count, ownership scope, dimensions scope, user prediction toggle, effective prediction state, niches state, and grouped mode. Every eligible change immediately rejects the old key and activates a distinct key only after persistence; grouped mode remains ineligible.
- Run:

```bash
bun test packages/web/tests/collection-navigation-producer.test.ts
bunx tsc --noEmit -p packages/web/tsconfig.json
bunx prettier --check packages/web/lib/collection-navigation-producer.ts packages/web/tests/collection-navigation-producer.test.ts
```

## Step 4: Integrate Context Production And Collection Return

**Files**

- Modify `packages/web/components/collection-table.tsx`.
- Modify `packages/web/app/collection/page.tsx`.
- Modify `packages/web/app/globals.css` for Collection row/heading focus and restore status.
- Extend producer/store tests if integration extracts pure capability or URL helpers.

**Changes**

1. Parse `collectionContext` and `collectionOrigin` as singular optional values in `CollectionPage`; duplicate query values become absent.
2. Replace the topbar title with a semantic, programmatically focusable Collection `h1` and stable ID.
3. Always mount `CollectionTable`, including an empty collection. Move the existing empty panel behind its hydration/return path; keep irrelevant topbar actions conditional when empty.
4. On an apparent contextual return, server and initial client output show a neutral restoring status rather than default rows, controls, fragments, or empty state.
5. Resolve contextual return before ambient preference loading. Validate scope equality; enabled axis-sort membership; tournament and BGG sort availability; availability of every stored enabled prediction/niche enrichment source; and equality between the stored effective prediction state and the result of applying the stored user toggle under current integrated-redundancy settings. A nonempty capability mismatch uses normal persisted-state fallback; a structurally/scope-valid empty collection restores snapshot state despite missing row-derived capabilities.
6. Store both user and effective prediction state in snapshots. Restore sort, filters, prediction toggle, niches toggle, and flat mode in one committed state before revealing rows. Persist the restored sort and filters through the existing `shelf-judge-sort` and `shelf-judge-filters` contracts so subsequent ordinary Collection visits use the restored view.
7. Normalize an unavailable persisted sort to `DEFAULT_SORT` on ordinary nonempty hydration before rendering controls, and persist the normalized sort so controls and computed order cannot disagree on later visits.
8. Derive snapshot entries directly from current `withValue` and `withoutValue`; do not add another projection or comparator.
9. Integrate the producer fingerprint and hook. Rows use context only after successful persistence for that exact fingerprint; all rows remain plain before hydration, during a changed projection, in grouped mode, and after failed persistence.
10. Pass complete hrefs into `GameRow`. Flat rows receive context plus their own `collectionOrigin`; grouped rows receive plain routes. Add stable focus IDs only to flat primary row links.
11. After a valid return renders, focus the origin row's primary link or the Collection heading when current data excludes/deletes it. Do not weaken restored filters or scope.
12. Complete every apparent return attempt, valid or invalid, by removing `collectionContext` and `collectionOrigin` with `history.replaceState` after restored-state or ordinary-fallback commit. Preserve URL-owned scope and any fragment, do not add a history entry, and keep valid stored snapshots. Invalid context, invalid origin, and capability fallback use ordinary persisted preferences and do not repeatedly retry on reload.

**Local gate**

- Pure integration helpers have focused tests for scope equality; enabled/removed axis sorts; available/unavailable tournament and BGG sorts; available/unavailable prediction and niche sources; matching/mismatching effective prediction state under integrated redundancy; successful restored sort/filter persistence; ordinary-sort normalization and normalized persistence; the approved empty exception; href construction; valid/invalid transport cleanup; and focus target selection where extraction is needed.
- Existing Collection sorting/filtering tests continue to pass.
- Static source/link tests confirm grouped call sites explicitly remain plain and flat rows receive passed hrefs.
- The full hydration, storage-failure, DOM parity, and focus lifecycle remains gated in Step 6 because the repository intentionally has no DOM unit-test dependency.
- Run:

```bash
bun test packages/web/tests/collection-table.test.ts packages/web/tests/game-links.test.tsx packages/web/tests/collection-navigation-context.test.ts packages/web/tests/collection-navigation-producer.test.ts
bunx tsc --noEmit -p packages/web/tsconfig.json
bunx prettier --check packages/web/components/collection-table.tsx packages/web/app/collection/page.tsx packages/web/app/globals.css packages/web/tests/collection-table.test.ts packages/web/tests/game-links.test.tsx
```

## Step 5: Add The Detail Boundary And Responsive Strip

**Files**

- Add `packages/web/components/game-detail-collection-navigation.tsx`.
- Modify `packages/web/app/games/[id]/page.tsx`.
- Modify `packages/web/app/globals.css`.
- Add `packages/web/tests/game-detail-collection-navigation.test.tsx`.
- Modify `packages/web/tests/game-links.test.tsx`.

**Changes**

1. Accept singular optional context/origin values from game-detail `searchParams`; reject duplicate arrays before passing raw values to the client.
2. Replace the current breadcrumb/topbar shell with one client boundary that receives game identity and the existing `GameActions` child.
3. Preserve the current plain breadcrumb and omit the strip on initial render, direct entry, invalid context, unavailable storage, or invalid current/origin membership.
4. Resolve valid context once. Always produce a contextual Collection breadcrumb for valid context/origin, including one-entry sequences.
5. Build a navigation model only for sequences of at least two entries. Preserve key and initial origin through Previous/Next hrefs.
6. Render exact immediate neighbors, non-focusable first/last boundary text, and no wrap. Delegate unavailable targets to the existing detail route without prevalidation.
7. Insert the strip between the topbar and `.main-scroll`. Add equal-width responsive regions, `min-width: 0`, visible direction text, ellipsized visual names with full accessible names, 44px targets, explicit focus-visible styling, and no page-level overflow masking.
8. Keep every tournament, niche, redundancy, score, profile, search, capacity, and wishlist game link context-free.

**Local gate**

- Static/pure tests cover middle, first, last, two-entry, one-entry contextual breadcrumb, preserved origin, exact href encoding, full accessible labels, non-focusable boundaries, and invalid omission.
- Existing missing-game and game-link tests pass with explicit negative context assertions for unrelated links.
- Run:

```bash
bun test packages/web/tests/game-detail-collection-navigation.test.tsx packages/web/tests/game-links.test.tsx
bunx tsc --noEmit -p packages/web/tsconfig.json
bunx prettier --check packages/web/components/game-detail-collection-navigation.tsx "packages/web/app/games/[id]/page.tsx" packages/web/app/globals.css packages/web/tests/game-detail-collection-navigation.test.tsx packages/web/tests/game-links.test.tsx
```

## Step 6: Add Real-browser Acceptance Coverage

**Files**

- Modify `packages/web/e2e/fixture-daemon.ts`.
- Add `packages/web/e2e/collection-navigation.pw.ts`.

**Changes**

1. Extend the fixture daemon with deterministic multi-game Collection and detail responses plus the tournament, redundancy, niche, capacity, prediction, and mutation seams required by the existing page.
2. Include valued/no-value games, deterministic ties, previously owned and missing-dimension games, prediction/niche variants, grouped duplicates, long names, one-result filters, and deletable/unavailable origins and targets.
3. Block external network and reset fixture state between tests using the established profile-browser pattern.
4. Verify exact visible filtered/sorted traversal, specialized ordering, first/last/no-wrap, one-result contextual return without strip, grouped omission, and direct/isolated-browser fallback.
5. Read feature-prefixed storage and flat DOM row IDs to prove snapshot order exactly equals rendered order.
6. Verify all-link atomic activation, injected write failure leaving links plain, no old-key/new-row exposure during projection changes, and no duplicate context for effect replay.
7. Verify reload, same-browser new tab, immutable chain after another tab changes preferences, and expiry/malformed context fallback.
8. Verify explicit return restores scope/controls, persists restored sort/filters, and focuses origin. Cover changed membership, deleted origin, final-origin empty collection, each capability mismatch family, heading focus, and transport-parameter cleanup.
9. Open Collection detail and use ordinary browser Back without the explicit breadcrumb; verify the mounted Collection view and browser-maintained scroll position remain unchanged. Separately visit Collection with invalid context and invalid origin parameters; verify ordinary persisted-state fallback, scope/fragment preservation, parameter cleanup, and no repeated restore attempt on reload.
10. Verify keyboard order, visible focus, semantic/non-focusable boundary behavior, full accessible names, 44px targets, and measured horizontal overflow at 375x812, 768x1024, 1440x900, and the existing effective 200-percent project.
11. Verify literal Chromium 200% browser zoom from a 1440x900 viewport through reliable automation or a completed manual observation. Record which method was used and the no-horizontal-overflow result. The existing 720x450/DPR project is supporting evidence only and cannot satisfy this gate by itself.

**Local gate**

- Browser TypeScript compiles and the new navigation browser file passes in every configured Playwright project.
- Existing browser suites continue to pass against the expanded fixture.
- Literal Chromium 200% zoom from 1440x900 has been actually observed with no horizontal overflow. If automation cannot perform it, implementation pauses for the human observation rather than passing this local gate with a future requirement.
- Run:

```bash
bun run typecheck:browser
bun run --cwd packages/web test:browser -- collection-navigation.pw.ts
bun run test:browser
bunx prettier --check packages/web/e2e/fixture-daemon.ts packages/web/e2e/collection-navigation.pw.ts
```

## Step 7: Reconcile Requirements And Run Release Gates

**Evidence reconciliation**

1. Walk `REQ-GAME-NAV-1` through `REQ-GAME-NAV-29` and record the exact unit, static, or browser assertion proving each requirement.
2. Confirm changed production paths match the approved design and that no daemon, shared package, API proxy, database, dependency, or ambient game-link propagation was added.
3. Confirm direct `/games/{id}` and existing destination-owned missing-game behavior remain intact.
4. Inspect browser evidence for desktop, phone, tablet, effective zoom geometry, completed literal 200% zoom observation, keyboard/focus, and storage failure.

**Repository gates**

```bash
bun run typecheck
bunx tsc --noEmit -p packages/web/tsconfig.json
bun run typecheck:browser
bun run lint
bun run test
bun run build
bun run test:browser
git diff --check
```

Run Prettier and ESLint over every changed path before broad checks. `bun run format:check` may still report the known current generated-file baseline:

- `.beads/backup/backup_state.json`
- `.beads/export-state.json`
- `.beads/push-state.json`

Any changed-file formatting failure or any additional root formatting failure is introduced by this work and must be corrected. Final acceptance and Beads closure are blocked until literal Chromium 200% zoom from 1440x900 has been completed and recorded; the existing device-scale project cannot substitute for it.

## Implementation Notes And Review Gates

- Tests are written in the same phase as production behavior, not deferred to Step 6. Step 6 covers only behavior that requires a real browser, cross-tab storage, hydration, focus, or measured geometry.
- After each step, use a fresh testing agent to execute the local gate and a fresh reviewer to compare the changed surface with that step's mapped requirements.
- Route failed checks and material review findings back to the implementation phase before starting the next dependency.
- After all local gates pass, run one terminal acceptance review using the full approved spec, requirement-evidence table, final changed-file manifest, and named Collection/detail consumers.
