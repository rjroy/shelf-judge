---
title: Game-view next and previous navigation rollout
date: 2026-08-29
status: open
tags:
  [
    navigation,
    game-detail,
    collection,
    local-storage,
    web-locks,
    hydration,
    playwright,
    browser-zoom,
    history-state,
  ]
modules: [web-ui]
related:
  - .lore/work/specs/game-view-next-previous-navigation.md
  - .lore/work/design/game-view-next-previous-navigation.md
  - .lore/work/plans/game-view-next-previous-navigation.md
  - .lore/work/notes/game-view-next-previous-navigation.md
---

# Game-view next and previous navigation rollout

The work began with prior-lore research because Collection order was already split across client filters, persisted preferences, URL-owned scope, prediction and niche state, and specialized sort comparators. The brainstorm compared origin-only, ambient-preference, URL-addressable, history-state, and canonical-order models. The approved specification selected immutable origin snapshots containing the exact flat Collection sequence.

The design placed each snapshot in an independent versioned `localStorage` record and serialized mutation through a named Web Lock. Collection remained the only sequence producer. Game detail received one client boundary for the contextual breadcrumb and optional Previous/Next strip. Contextual return restored Collection controls and focused the original row, while direct and unrelated game links remained context-free.

Implementation followed seven planned phases. Generic sort ties changed first, followed by the validated context store, the projection producer state machine, Collection integration, detail integration, browser acceptance, and release gates. Testing agents repeatedly found assertions that passed without distinguishing the required behavior. The affected tests were expanded for Unicode code-point order, NFC identity, storage-key mismatch, lock scope, refresh-before-LRU ordering, post-write rereads, producer lifecycle timing, stale async completion, and route-cycle cache invalidation.

Three production defects appeared during review or browser execution:

- Reading the browser's default `localStorage` getter could throw before store containment. Default acquisition moved inside guarded dependency resolution.
- Returning to an earlier detail context tuple could briefly reveal its old cached navigation model before revalidation. Detail resolution gained generation-based invalidation and stale-completion rejection.
- Next reset the page-owned Collection scroll container before ordinary Back. Collection began recording scroll in the current history entry for contextual, unmodified, primary, same-tab row activation and consuming that marker after one corresponding return. Review extended this to exclude modifier/new-tab activation and later unrelated Back visits.

The browser suite expansion also exposed a test-order failure outside the feature files. `theme.test.ts` installed non-configurable `localStorage` and `window` globals without restoring them. The context-store throwing-getter test passed alone and failed in the full suite. The theme fixture now installs configurable globals and restores the original descriptors after each test; both file orders and the full suite passed afterward.

The plan expected literal Chromium 200% zoom to require either automation or a completed manual observation. Keyboard shortcuts in headless Chromium did not change zoom. Headed Chromium under the Wayland tiling compositor did not retain the requested 1440x900 window. CDP `Emulation.setPageScaleFactor(2)` changed `visualViewport.scale` and was recorded as page scaling rather than browser zoom. The completed check launched pinned Chromium with a temporary persistent profile using Chromium's native logarithmic zoom preference for factor 2. It measured outer `1440x900`, inner `720x406`, DPR `2`, and visual scale `1`, then checked long accessible names, 44px targets, and horizontal overflow. A follow-up test review moved profile setup and launch inside nested cleanup so failed launch or close could not leave `/tmp/opencode` profiles.

The final changed production surface stayed within the web package: Collection page/table, game detail, global styles, collection sort utilities, the context store, the producer, and the detail boundary. No daemon, shared package, proxy, database, dependency manifest, or lockfile changed. The fixture daemon and browser suite grew to cover multi-game traversal, storage failures, reloads, tabs, mutations, capability changes, grouped mode, focus, history, responsive geometry, and native zoom.

Final validation recorded 2,190 passing unit tests with one existing skip and 81 passing browser cases with 15 viewport/scenario skips. Typechecks, lint, production build, changed-file formatting, and `git diff --check` passed. Root formatting continued to report only the three generated Beads baseline files.
