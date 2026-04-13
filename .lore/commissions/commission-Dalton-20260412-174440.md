---
title: "Commission: Previously Owned: Collection Page (Phase 4)"
date: 2026-04-13
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 4 of the previously-owned feature: the collection page UI.\n\n**Read these first:**\n- `.lore/plans/previously-owned.md` (Phase 4 in detail, plus the Architectural Decisions and Mockup Visual Patterns sections)\n- `.lore/specs/previously-owned.md` (REQ-PREV-20, REQ-PREV-21, REQ-PREV-22)\n- `.lore/mockups/mockup-previously-owned-collection.html` (Sienna's mockup — read for visual patterns, CSS tokens, component structure)\n- `packages/web/app/collection/page.tsx` (current collection page)\n- `packages/web/app/globals.css` (current styles)\n- The existing filter/sort pattern in the collection table to determine if filters use URL search params or client-side state\n\n**What to build (three states from the plan):**\n- State A (default): Owned-only view, no visible ownership UI unless previously-owned games exist\n- State B (filters open): \"Owned Status\" filter group with segmented buttons when `previouslyOwnedCount > 0`\n- State C (toggle active): Active filter chip, info banner about niche/redundancy, previously-owned rows with muted styling, badge, dashes for niche/redundancy columns\n\n**Key architectural decision:** The ownership toggle triggers a server re-fetch (not client-side filtering) because the niche/redundancy computation universe changes. Use URL search params to keep the page as a server component.\n\n**CSS tokens from the mockup:** `--prev-owned-bg`, `--prev-owned-badge-bg`, `--prev-owned-badge-border`, `--prev-owned-badge-text` with dark mode overrides.\n\n**Verification:** `bun run typecheck`, `bun run lint`. Manual verification against mockup states A, B, C in both light and dark mode."
dependencies:
  - commission-Dalton-20260412-174425
linked_artifacts:
  - packages/web/app/collection/page.tsx

  - packages/web/components/collection-table.tsx
  - packages/web/app/globals.css
  - packages/web/components/collection-table.tsx
  - packages/web/app/globals.css
activity_timeline:
  - timestamp: 2026-04-13T00:44:40.823Z
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
  - timestamp: 2026-04-13T01:11:25.771Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-13T01:11:25.795Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-13T01:11:33.740Z
    event: progress_report
    reason: "Reading plan, spec, mockup, and current collection page to understand the implementation requirements."
  - timestamp: 2026-04-13T01:13:05.044Z
    event: progress_report
    reason: "Read all source files. Understanding the pattern: filters are client-side (localStorage), but ownership toggle needs server re-fetch via URL search params. Planning implementation across page.tsx, collection-table.tsx, collection-utils.ts, and globals.css."
  - timestamp: 2026-04-13T01:16:54.569Z
    event: progress_report
    reason: "Implementation complete. Added CSS tokens, page.tsx searchParams handling, CollectionTable ownership filter UI (filter panel group, chip, info banner), and GameRow previously-owned styling. Running verification."
  - timestamp: 2026-04-13T01:17:59.939Z
    event: result_submitted
    reason: "Phase 4 (collection page UI) implemented across 3 files.\n\n**`packages/web/app/collection/page.tsx`:**\n- Accepts `searchParams` prop (Next.js 16 async pattern)\n- Reads `?ownership=all` to determine whether to show previously-owned games\n- Fetches `listGames({ ownership: \"all\" })` when toggle is active, default (owned-only) otherwise\n- Fetches previously-owned count separately when in default mode (to show/hide the filter group)\n- Passes `previouslyOwnedCount` and `showPreviouslyOwned` to `CollectionTable`\n- Topbar shows \"44 games (2 previously owned)\" in mixed view\n- Avg fitness computed from owned games only (excludes previously-owned)\n- Empty state check accounts for previously-owned count\n\n**`packages/web/components/collection-table.tsx`:**\n- New props: `previouslyOwnedCount`, `showPreviouslyOwned`\n- Uses `useRouter` for navigation-based toggle (URL search params keep page as server component)\n- \"Owned Status\" filter group in filter panel: segmented buttons \"Owned only\" / \"+ Prev Owned\", only shown when `previouslyOwnedCount > 0` (State B)\n- Hint text showing \"(N previously owned)\" below the filter group\n- \"Prev Owned\" chip in active chips row when filter is active (State C)\n- Filter count badge incremented when ownership filter is active\n- \"Clear all\" button navigates back to `/collection` when ownership filter is active\n- Info banner: \"Previously-owned games are shown. Niche and redundancy data reflects only your current shelf.\"\n- `GameRow` gains `prev-owned` CSS class when `game.ownership === \"previously-owned\"`\n- \"Prev Owned\" badge rendered below game name for previously-owned rows\n- Niche/redundancy data naturally shows dashes (server returns null for excluded games)\n\n**`packages/web/app/globals.css`:**\n- Added `--prev-owned-bg`, `--prev-owned-badge-bg`, `--prev-owned-badge-border`, `--prev-owned-badge-text` tokens (light mode)\n- Added matching dark mode overrides in `[data-theme=\"dark\"]`\n- Added `.game-row.prev-owned` styles: muted background, dimmed thumbnail (opacity 0.7), secondary text color for name, reduced score opacity\n- Added `.badge-prev-owned` styles matching mockup\n- Added `.filter-chip.chip-prev-owned` styles\n- Added `.view-notice` and `.view-notice-icon` for info banner\n\n**Three mockup states implemented:**\n- State A: Default owned-only view, no ownership UI unless previously-owned games exist\n- State B: Filter panel open with \"Owned Status\" group visible\n- State C: Filter active with chip, info banner, and muted previously-owned rows\n\n**Verification:** `bun run typecheck` clean, `bun run lint` clean, `bun run test` 1038 pass / 0 fail."
  - timestamp: 2026-04-13T01:18:08.045Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Implementation complete. Added CSS tokens, page.tsx searchParams handling, CollectionTable ownership filter UI (filter panel group, chip, info banner), and GameRow previously-owned styling. Running verification."
projectName: shelf-judge
---
Phase 4 (collection page UI) implemented across 3 files.

**`packages/web/app/collection/page.tsx`:**
- Accepts `searchParams` prop (Next.js 16 async pattern)
- Reads `?ownership=all` to determine whether to show previously-owned games
- Fetches `listGames({ ownership: "all" })` when toggle is active, default (owned-only) otherwise
- Fetches previously-owned count separately when in default mode (to show/hide the filter group)
- Passes `previouslyOwnedCount` and `showPreviouslyOwned` to `CollectionTable`
- Topbar shows "44 games (2 previously owned)" in mixed view
- Avg fitness computed from owned games only (excludes previously-owned)
- Empty state check accounts for previously-owned count

**`packages/web/components/collection-table.tsx`:**
- New props: `previouslyOwnedCount`, `showPreviouslyOwned`
- Uses `useRouter` for navigation-based toggle (URL search params keep page as server component)
- "Owned Status" filter group in filter panel: segmented buttons "Owned only" / "+ Prev Owned", only shown when `previouslyOwnedCount > 0` (State B)
- Hint text showing "(N previously owned)" below the filter group
- "Prev Owned" chip in active chips row when filter is active (State C)
- Filter count badge incremented when ownership filter is active
- "Clear all" button navigates back to `/collection` when ownership filter is active
- Info banner: "Previously-owned games are shown. Niche and redundancy data reflects only your current shelf."
- `GameRow` gains `prev-owned` CSS class when `game.ownership === "previously-owned"`
- "Prev Owned" badge rendered below game name for previously-owned rows
- Niche/redundancy data naturally shows dashes (server returns null for excluded games)

**`packages/web/app/globals.css`:**
- Added `--prev-owned-bg`, `--prev-owned-badge-bg`, `--prev-owned-badge-border`, `--prev-owned-badge-text` tokens (light mode)
- Added matching dark mode overrides in `[data-theme="dark"]`
- Added `.game-row.prev-owned` styles: muted background, dimmed thumbnail (opacity 0.7), secondary text color for name, reduced score opacity
- Added `.badge-prev-owned` styles matching mockup
- Added `.filter-chip.chip-prev-owned` styles
- Added `.view-notice` and `.view-notice-icon` for info banner

**Three mockup states implemented:**
- State A: Default owned-only view, no ownership UI unless previously-owned games exist
- State B: Filter panel open with "Owned Status" group visible
- State C: Filter active with chip, info banner, and muted previously-owned rows

**Verification:** `bun run typecheck` clean, `bun run lint` clean, `bun run test` 1038 pass / 0 fail.
