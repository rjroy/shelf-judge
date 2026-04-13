---
title: "Commission: Previously Owned: Game Detail Page (Phase 5)"
date: 2026-04-13
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 5 of the previously-owned feature: the game detail page UI.\n\n**Read these first:**\n- `.lore/plans/previously-owned.md` (Phase 5 in detail, plus the Mockup Visual Patterns section)\n- `.lore/specs/previously-owned.md` (REQ-PREV-23, REQ-PREV-24, REQ-PREV-25)\n- `.lore/mockups/mockup-previously-owned-game-detail.html` (Sienna's mockup — read for visual patterns, CSS tokens, component structure)\n- `packages/web/app/games/[id]/page.tsx` (current game detail page)\n- `packages/web/components/` (existing component patterns, especially GameActions or equivalent)\n- `packages/web/app/globals.css` (current styles)\n\n**What to build (two states from the plan):**\n- State A (previously-owned game): \"Previously Owned\" badge in hero, annotation panel below hero, breakdown table shows niche/redundancy as \"excluded\", \"Mark as Owned\" button (green `btn-success`), danger zone with \"Remove from Collection\"\n- State B (owned game): \"Owned\" badge in green, standard detail page, \"Mark as Previously Owned\" button (`btn-secondary`), danger zone with \"Remove from Collection\"\n\n**The ownership toggle action** calls `PATCH /api/daemon/games/:id/ownership` via the proxy. On success, `router.refresh()`. This is a client component (like existing GameActions).\n\n**CSS tokens from the mockup:** `.status-badge.prev-owned`, `.status-badge.owned`, `.prev-owned-notice`, `.excluded-row`, `.btn-success`, `.danger-zone` with dark mode overrides.\n\n**Verification:** `bun run typecheck`, `bun run lint`. Manual verification against both mockup states in light and dark mode."
dependencies:
  - commission-Dalton-20260412-174425
linked_artifacts:
  - packages/web/app/games/[id]/page.tsx

  - packages/web/components/game-actions.tsx
  - packages/web/components/score-breakdown.tsx
  - packages/web/app/globals.css
  - packages/web/components/game-actions.tsx
  - packages/web/components/score-breakdown.tsx
  - packages/web/app/globals.css
activity_timeline:
  - timestamp: 2026-04-13T00:44:50.719Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T01:01:48.761Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-13T01:11:25.769Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-13T01:11:25.801Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-13T01:11:25.822Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-13T01:11:31.892Z
    event: progress_report
    reason: "Reading plan, spec, mockup, and current game detail page to understand the implementation scope."
  - timestamp: 2026-04-13T01:12:39.547Z
    event: progress_report
    reason: "Context gathered. Implementing Phase 5: status badge in hero, annotation panel, excluded breakdown rows, ownership toggle action, and danger zone. Adding CSS tokens and modifying the game detail page and GameActions component."
  - timestamp: 2026-04-13T01:15:50.971Z
    event: result_submitted
    reason: "Phase 5 (game detail page UI) implemented. Changes:\n\n**`packages/web/app/games/[id]/page.tsx`**:\n- Added `isPreviouslyOwned` flag derived from `game.ownership`\n- Hero section now uses a title row (`game-hero-title-row`) with conditional \"Previously Owned\" status badge\n- Annotation panel (`prev-owned-notice`) renders below hero for previously-owned games explaining niche/redundancy exclusion\n- Redundancy and niche panels are conditionally hidden for previously-owned games\n- `ScoreBreakdown` receives `isPreviouslyOwned` prop for excluded row rendering\n- `OwnershipActions` component added to right panel below RatingForm\n\n**`packages/web/components/game-actions.tsx`**:\n- `GameActions` simplified to topbar-only (BGG refresh). Remove action moved to `OwnershipActions`.\n- New `OwnershipActions` client component handles ownership toggle and remove-from-collection:\n  - State A (previously-owned): green \"Mark as Owned\" button (`btn-success`), danger zone with \"Remove from Collection\"\n  - State B (owned): secondary \"Mark as Previously Owned\" button, same danger zone\n  - Calls `PATCH /api/daemon/games/:id/ownership` via proxy, then `router.refresh()`\n\n**`packages/web/components/score-breakdown.tsx`**:\n- Accepts optional `isPreviouslyOwned` prop\n- When true, renders two excluded rows (niche bonus, redundancy adj.) with \"Excluded\" badges before the total row\n\n**`packages/web/app/globals.css`**:\n- Added `--prev-owned-*` and `--success-border` tokens in both light and dark mode sections\n- Added component styles: `.status-badge`, `.prev-owned-notice`, `.excluded-row`, `.btn-success`, `.action-section`, `.danger-zone`, and related classes\n\nVerification: `bun run typecheck` clean. `bun run lint` clean. `bun run test` passes all 1038 tests."
  - timestamp: 2026-04-13T01:15:56.349Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Context gathered. Implementing Phase 5: status badge in hero, annotation panel, excluded breakdown rows, ownership toggle action, and danger zone. Adding CSS tokens and modifying the game detail page and GameActions component."
projectName: shelf-judge
---
Phase 5 (game detail page UI) implemented. Changes:

**`packages/web/app/games/[id]/page.tsx`**:
- Added `isPreviouslyOwned` flag derived from `game.ownership`
- Hero section now uses a title row (`game-hero-title-row`) with conditional "Previously Owned" status badge
- Annotation panel (`prev-owned-notice`) renders below hero for previously-owned games explaining niche/redundancy exclusion
- Redundancy and niche panels are conditionally hidden for previously-owned games
- `ScoreBreakdown` receives `isPreviouslyOwned` prop for excluded row rendering
- `OwnershipActions` component added to right panel below RatingForm

**`packages/web/components/game-actions.tsx`**:
- `GameActions` simplified to topbar-only (BGG refresh). Remove action moved to `OwnershipActions`.
- New `OwnershipActions` client component handles ownership toggle and remove-from-collection:
  - State A (previously-owned): green "Mark as Owned" button (`btn-success`), danger zone with "Remove from Collection"
  - State B (owned): secondary "Mark as Previously Owned" button, same danger zone
  - Calls `PATCH /api/daemon/games/:id/ownership` via proxy, then `router.refresh()`

**`packages/web/components/score-breakdown.tsx`**:
- Accepts optional `isPreviouslyOwned` prop
- When true, renders two excluded rows (niche bonus, redundancy adj.) with "Excluded" badges before the total row

**`packages/web/app/globals.css`**:
- Added `--prev-owned-*` and `--success-border` tokens in both light and dark mode sections
- Added component styles: `.status-badge`, `.prev-owned-notice`, `.excluded-row`, `.btn-success`, `.action-section`, `.danger-zone`, and related classes

Verification: `bun run typecheck` clean. `bun run lint` clean. `bun run test` passes all 1038 tests.
