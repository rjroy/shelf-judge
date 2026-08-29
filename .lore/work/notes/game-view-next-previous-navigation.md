---
title: "Implementation notes: Collection-scoped game detail navigation"
date: 2026-08-29
status: complete
tags: [implementation, navigation, game-detail, collection]
source: .lore/work/plans/game-view-next-previous-navigation.md
modules: [web-ui]
related:
  - .lore/work/specs/game-view-next-previous-navigation.md
  - .lore/work/design/game-view-next-previous-navigation.md
---

# Implementation notes: Collection-scoped game detail navigation

## Progress

- [x] Phase 1: Deterministic generic collection order
- [x] Phase 2: Versioned context store
- [x] Phase 3: Projection producer state machine
- [x] Phase 4: Collection production and contextual return
- [x] Phase 5: Detail boundary and responsive strip
- [x] Phase 6: Real-browser acceptance coverage
- [x] Phase 7: Requirement reconciliation and release gates

## Obligation To Evidence

| Obligation                                                                                              | Phase      | Required evidence                                                |
| ------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------- |
| Exact hydrated flat sequence and deterministic ties (`REQ-GAME-NAV-1` through `6`)                      | 1, 3, 4, 6 | Comparator tests, producer tests, DOM/snapshot parity            |
| Strict immutable browser context, retention, failure, and separate tabs (`REQ-GAME-NAV-7` through `12`) | 2, 3, 6    | Store/producer tests and cross-tab browser evidence              |
| Detail neighbors, boundaries, omission, and mutation behavior (`REQ-GAME-NAV-13` through `19`)          | 5, 6       | Pure/static detail tests and traversal acceptance                |
| Reload, tabs, contextual return, focus, fallback (`REQ-GAME-NAV-20` through `24`)                       | 4, 5, 6    | Return helper tests and browser scenarios                        |
| Link semantics, accessibility, targets, responsive overflow (`REQ-GAME-NAV-25` through `29`)            | 5, 6       | Static assertions, Playwright geometry, literal zoom observation |
| Context-free direct and non-Collection routes; no daemon/shared/database expansion                      | 4, 5, 7    | Negative link tests and final changed-surface audit              |

## Consumers And Boundaries

- Producer: hydrated flat rows in `packages/web/components/collection-table.tsx` only.
- Consumer: one game-detail client boundary around breadcrumb and navigation strip.
- Return: `CollectionPage` URL scope plus `CollectionTable` client state/focus.
- Context-free consumers: profile, tournament, niche, redundancy, score, capacity, search, and wishlist links.
- External boundary: disposable browser UI state only; no daemon, shared package, proxy, database, or durable application state.

## Log

### Initialization

- Restored and approved the specification, design, and implementation plan through their human gates.
- Fresh lore research found no implementation divergence. The architecture reference's broad client-state statement is resolved by the approved design's explicit disposable UI-state exception, consistent with existing Collection preference storage.
- Current ownership fetching differs from older lore, but the plan snapshots the actual post-cull rendered arrays and remains valid.
- Current root formatting baseline is limited to three generated Beads files: `.beads/backup/backup_state.json`, `.beads/export-state.json`, and `.beads/push-state.json`. Changed-file failures remain blocking.

### Phase 1: Deterministic Generic Collection Order

- Changed `packages/web/lib/collection-utils.ts` and `packages/web/tests/collection-table.test.ts`.
- Generic equal values and the no-value group now use ascending NFC Unicode-code-point name then stable-ID ties without reversing ties for descending primary sorts. Specialized utilization sorts share the identity comparator without changing category or precision semantics.
- Initial testing passed behavior but found three assertion gaps. The correction added discriminating generic Unicode, no-value NFC/ID, and mixed-case Name-primary cases.
- Gate evidence: 85 focused tests and 138 assertions passed; changed-file Prettier passed; reviewer accepted with no material findings.

### Phase 2: Versioned Context Store

- Added `packages/web/lib/collection-navigation-context.ts` and `packages/web/tests/collection-navigation-context.test.ts`.
- Implemented strict V1 validation, immutable per-context records, named Web Lock mutation, sliding seven-day expiry, deterministic 20-record LRU, refresh-failure current-page use, and lock/storage degradation.
- Initial testing passed behavior but required six discriminating store assertions; all were added without production changes.
- Review found and corrected one browser-boundary defect where the default `localStorage` getter itself could throw outside containment.
- Gate evidence: 23 tests and 125 assertions passed; web typecheck, targeted ESLint, and Prettier passed; targeted verification closed `NAV-P2-001` with no new finding.

### Phase 3: Projection Producer State Machine

- Added `packages/web/lib/collection-navigation-producer.ts` and `packages/web/tests/collection-navigation-producer.test.ts`.
- Implemented canonical all-input fingerprints, exact valued/no-value entries, transition-safe activation, synchronous attempt deduplication, failure/plain behavior, and stale async completion rejection.
- Initial tests validated the pure state but did not execute hook lifecycle behavior. The hook was refactored to use a framework-free lifecycle primitive directly exercised by tests, preserving the no-new-DOM-dependency decision.
- Gate evidence: 29 tests and 143 assertions passed; web typecheck, targeted ESLint, and Prettier passed; reviewer accepted React ref/state semantics and Phase 4 compatibility.

### Phase 4: Collection Production And Contextual Return

- Modified `collection-table.tsx`, Collection page, Collection focus CSS, and focused Collection/link tests.
- Collection now always mounts its client boundary, resolves contextual return before ambient preferences, validates all capabilities with the approved empty exception, restores/persists state atomically, snapshots the exact rendered flat arrays, and keeps ineligible links plain.
- Added semantic heading/row focus targets, grouped-mode exclusion, ordinary unavailable-sort normalization, and valid/invalid return parameter cleanup.
- Local testing passed 154 tests and 472 assertions plus web typecheck, targeted ESLint, and changed-file Prettier. Remaining mounted hydration/storage/focus/history observations are explicitly assigned to Phase 6.
- Reviewer accepted with no material findings.

### Phase 5: Detail Boundary And Responsive Strip

- Added `game-detail-collection-navigation.tsx`, integrated it into game detail, added responsive/focus CSS, and added focused detail/link tests.
- Valid context always supplies contextual return, while the strip appears only for two or more entries; boundaries do not wrap and unrelated links remain plain.
- Initial local gate passed. Review found one route-cycle cache race where revisiting a prior tuple could briefly reveal its old model before revalidation.
- Corrected the race with component-used generation lifecycle primitives and controlled A-to-plain/B-to-A, invalid, and out-of-order completion tests.
- Gate evidence: 34 focused tests and 121 assertions passed; web typecheck, ESLint, and Prettier passed; targeted verification closed `NAV-P5-001` with no regression.

### Phase 6: Real-browser Acceptance Coverage

- Expanded the fixture daemon and added `collection-navigation.pw.ts` for projection parity, traversal, storage failures, cross-tab/reload, contextual return, focus/history, grouped exclusion, accessibility, geometry, and native browser zoom.
- Browser testing exposed ordinary Back scroll loss. The production correction saves page-owned scroll only for unmodified primary same-tab contextual row activation, restores it once, and consumes only its marker while preserving unrelated history state and URL.
- Review found stale marker risks after later departures and modifier/new-tab activation; both were corrected and verified with real browser scenarios.
- Full-suite execution exposed a shared-global leak in `theme.test.ts`; its configurable test globals now restore descriptors in either test order.
- Literal 200% zoom is automated with pinned Chromium's native profile zoom at outer 1440x900. Repeated measurements were inner 720x406, DPR 2, visual scale 1; long accessible names, 44px targets, and no hidden/clipped horizontal overflow passed. Temporary profile cleanup is guaranteed across setup, launch, assertion, close, and removal failures.
- Gate evidence: full unit suite 2,190 passed/1 skipped; targeted navigation 52 passed/12 scoped skips; full browser suite 81 passed/15 scoped skips; literal zoom repeated three times; typechecks, lint, changed-file Prettier, and diff checks passed. Reviewer accepted all corrected Phase 6 surfaces.

### Phase 7: Requirement Reconciliation And Release Gates

- Reconciled `REQ-GAME-NAV-1` through `REQ-GAME-NAV-29` to direct unit, static, browser, accessibility, history, storage, cross-tab, and native-zoom evidence.
- Root typecheck, web typecheck, browser typecheck, lint, unit tests, production build, full Playwright suite, and `git diff --check` passed.
- Formatted all four related navigation lore artifacts. Root `format:check` now differs only on the documented generated Beads baseline: `.beads/backup/backup_state.json`, `.beads/export-state.json`, and `.beads/push-state.json`.
- Terminal acceptance review accepted the complete changed surface with no material findings. The only residual risk is intentional: unavailable browser storage or Web Locks degrades to context-free navigation.

## Accepted Manifest

Captured immediately after terminal acceptance and before lifecycle-only status updates in this section. Index and working-tree identities are recorded separately, including untracked files.

| Path                                                            | Porcelain | Index blob                                 | Working-tree SHA-256                                               |
| --------------------------------------------------------------- | --------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `.beads/interactions.jsonl`                                     | ` M`      | `369ae3f415e0b74bcda761072007ee0c20fcb672` | `d0d68fafeeb95db2e02bc1d3024deaccc41387a5660dc4db29e7d5efd6e91d05` |
| `.beads/issues.jsonl`                                           | ` M`      | `a2f6e18ad7b37714e3fc5ee57fe80232eb49b12b` | `22681e803f0535fafd4232beea478f3b386696ecadbb5c8a4a6624883070840f` |
| `.lore/work/brainstorm/game-view-next-previous-navigation.md`   | ` M`      | `4a00947ef01339e1e86ffef19e366f5408c0bff8` | `9b4f7df16d8d15dcf5ecf255be6d69481e33133807db101a69ec47975ac4855d` |
| `.lore/work/design/game-view-next-previous-navigation.md`       | ` M`      | `89887dfd62ad1bf978cb330898bacd6372394647` | `d837c9f74570c9e14de6d5676fdcdeda45c012c506aac41a5ff6daf61bafb28a` |
| `packages/web/app/collection/page.tsx`                          | ` M`      | `4684831bee7992b8b2d59ee198540204d00d6801` | `d0d388ffe9a3ed4dce6fe25c678f530a610ce7a405f2ed96421f9e228d5f4de3` |
| `packages/web/app/games/[id]/page.tsx`                          | ` M`      | `c3a37a2f5e6da64d940655bca1120473c6589a89` | `abf011b3e6baf685c2fdf55015a097698c4a0624f4aefcb9c188795ee6d83c1f` |
| `packages/web/app/globals.css`                                  | ` M`      | `385a5e1eab6bddd6dd3903a49fb450490fd5a0ed` | `afc7602a5a4467d295e8f6e97e33daa520063727fcabd772073f760bfc64dba4` |
| `packages/web/components/collection-table.tsx`                  | ` M`      | `f1517d4d12c66a291758ae413fade53f34d52508` | `24f86f9c707a9fe1d4ac2d688ad0d8dfc57fc34c9bce71ce3cee64d3538d4652` |
| `packages/web/e2e/fixture-daemon.ts`                            | ` M`      | `51ca10af8b378d67cb25870b594e852c074a6fe6` | `1ef1d5d1d04fe20065f9935c48233803b78990cc6ccf4b42d851292cfaa897e1` |
| `packages/web/lib/collection-utils.ts`                          | ` M`      | `93352a7f490365a9454e5bc17923901ba36d1e40` | `32c6fcbc3bb8e9ebb23a31c25dca6c90266fa4ddf560b8186587e5be14fde515` |
| `packages/web/tests/collection-table.test.ts`                   | ` M`      | `bc25c5de7f2ea0b78fc36eb57f9fcbea9048ca9f` | `813d500e8e36e8e456609006f5b2594cb562d038976aac9dc5fdf7d98184d58d` |
| `packages/web/tests/game-links.test.tsx`                        | ` M`      | `5b6d80da86dd9bb9d3987f3a3912cc85ff776a15` | `411903075758dfc94a5b276ce55a44f66cfdfef748b8da90cee7ea8de026a759` |
| `packages/web/tests/theme.test.ts`                              | ` M`      | `dd03f148a53e4d4c23b90594955e620e067f03f0` | `5624771b3e404ff23eb81aae7929098fbadc7f24394e37352c47a97d1d4d8e4b` |
| `.lore/work/notes/game-view-next-previous-navigation.md`        | `??`      | `absent`                                   | `0dce6d6ca57e98fe3d4478e0f7e6f6f3412617c9db4ba6ac4c14f33a5c7e4a5e` |
| `.lore/work/plans/game-view-next-previous-navigation.md`        | `??`      | `absent`                                   | `0f5b81f1f9bd481ea91921b54b78d4c0fc8e5b395d7be550ba3c8325776732a3` |
| `packages/web/components/game-detail-collection-navigation.tsx` | `??`      | `absent`                                   | `2e107cc3440fba5e42c80a6a60cbe154c381c1ae401a48feb9c45e0c072e3613` |
| `packages/web/e2e/collection-navigation.pw.ts`                  | `??`      | `absent`                                   | `78964c8833943a88ddffd778797c42e06a92d5238e93d051584484f07ee80925` |
| `packages/web/lib/collection-navigation-context.ts`             | `??`      | `absent`                                   | `c7ee09bbc6874f3730c1ebcec0cacc19d3081b95ea057465ced856bc02b785cf` |
| `packages/web/lib/collection-navigation-producer.ts`            | `??`      | `absent`                                   | `51f3db05d014e240e440545fa1b9996c0b8f54fc435a19f84e08e7e4bf2fd409` |
| `packages/web/tests/collection-navigation-context.test.ts`      | `??`      | `absent`                                   | `9d853325af165015d8fb159dc00a00879eff2c2102e7ddb89568892cbf95f0bd` |
| `packages/web/tests/collection-navigation-producer.test.ts`     | `??`      | `absent`                                   | `85e363d9200a79b719b0579c9264a7701d929aaf9042dfce3c6d9c58583028dc` |
| `packages/web/tests/game-detail-collection-navigation.test.tsx` | `??`      | `absent`                                   | `7017beaf88ba5a00301ee7ae507a969c5b1fb494acf85af479118d0c067d5feb` |
