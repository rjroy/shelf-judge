---
title: "Commission: Niche champion display: Phase 5 (web UI)"
date: 2026-04-12
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 5 of the niche champion display plan at `.lore/plans/niche-champion-display.md`. Read the plan's Phase 5 section fully before starting.\n\n## Phase 5: Web UI\n- 5a: Update `lib/api.ts` listGames to support `includeNiches` param\n- 5b: Game detail page gains Niche Position panel below score breakdown (REQ-NICHE-18, REQ-NICHE-19)\n- 5c: Collection page gains Show Niches toggle (REQ-NICHE-22, REQ-NICHE-23) and Group by Niche view mode (REQ-NICHE-24, REQ-NICHE-25). Client-side filter intersection per plan. Discard niche groups with <2 filtered members.\n- 5d: Search preview gains Niche Impact section with \"Would be your Nth...\" display (REQ-NICHE-26, REQ-NICHE-27)\n- Neighbor names link to game detail (REQ-NICHE-21)\n\n## Verification\n- `bun run typecheck` must pass\n- `bun run lint` must pass\n- `bun run test` must pass"
dependencies:
  - commission-Dalton-20260411-174506
linked_artifacts:
  - packages/web/lib/api.ts

  - packages/web/app/games/[id]/page.tsx
  - packages/web/app/collection/page.tsx
  - packages/web/components/collection-table.tsx
  - packages/web/app/search/page.tsx
  - packages/web/app/globals.css
  - packages/web/app/games/[id]/page.tsx
  - packages/web/app/collection/page.tsx
  - packages/web/components/collection-table.tsx
  - packages/web/app/search/page.tsx
  - packages/web/app/globals.css
activity_timeline:
  - timestamp: 2026-04-12T00:45:16.257Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T00:45:16.258Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T01:00:28.883Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T01:00:28.886Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T01:00:28.909Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T01:00:41.400Z
    event: progress_report
    reason: "Read the plan. Starting Phase 5 (Web UI). Will read the existing web files to understand current patterns before implementing."
  - timestamp: 2026-04-12T01:01:38.418Z
    event: progress_report
    reason: "Read all target files. Starting implementation: 5a (api.ts), then 5b (game detail), 5c (collection), 5d (search preview), plus CSS for all new components."
  - timestamp: 2026-04-12T01:09:26.499Z
    event: result_submitted
    reason: "Phase 5 (Web UI) implemented. All verification passes: typecheck, lint, 908 tests green.\n\n**5a: Web API helpers** (`packages/web/lib/api.ts`)\n- `listGames()` now accepts optional `{ includeNiches?: boolean }` param, appends `?includeNiches=true` query string\n- Added type re-exports for `NichePosition`, `NicheEntry`, `NicheNeighbor`, `NicheImpact`, `NicheImpactEntry`\n\n**5b: Game detail page** (`packages/web/app/games/[id]/page.tsx`)\n- Niche Position panel renders below tournament breakdown, above score breakdown (REQ-NICHE-18)\n- Each niche entry shows: name, type badge (mechanic/category/family), size, rank, champion indicator, neighbor links (REQ-NICHE-19)\n- Neighbor names link to game detail pages (REQ-NICHE-21)\n- Predicted neighbors show `~` indicator\n- Vetoed games show \"excluded from niche rankings\" message (REQ-NICHE-7)\n- Panel omitted when no niches\n\n**5c: Collection page** (`packages/web/app/collection/page.tsx`, `packages/web/components/collection-table.tsx`)\n- \"Show Niches\" toggle in stats strip, merges niche data from pre-fetched `nicheGames` (REQ-NICHE-22)\n- Compact niche summary per game row: \"3 niches, champion of 1\" (REQ-NICHE-23)\n- \"Group by Niche\" view mode toggle (REQ-NICHE-24): groups games under niche headings, sorted by size descending, champion highlighted with left border\n- Client-side filter intersection: niche groups respect active filters, groups with <2 filtered members discarded (REQ-NICHE-25)\n- Server component pre-fetches `listGames({ includeNiches: true })` and passes as `nicheGames` prop\n\n**5d: Search preview** (`packages/web/app/search/page.tsx`)\n- Niche Impact section in prediction preview (REQ-NICHE-26)\n- \"Would be your Nth game\" display with ordinal formatting (REQ-NICHE-27)\n- \"Would be your 1st\" for new niches, \"Would be your best\" when candidate would be champion\n- Shows current champion with score for existing niches\n\n**CSS** (`packages/web/app/globals.css`)\n- Added niche design tokens (accent, type colors for mechanic/category/family)\n- Niche type badges, card layout, champion badge, neighbor links\n- Collection niche summary, group headers, champion row highlight\n- Search preview niche impact styles\n- Responsive: single-column niche grid below 800px"
  - timestamp: 2026-04-12T01:09:31.588Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Read all target files. Starting implementation: 5a (api.ts), then 5b (game detail), 5c (collection), 5d (search preview), plus CSS for all new components."
projectName: shelf-judge
---
Phase 5 (Web UI) implemented. All verification passes: typecheck, lint, 908 tests green.

**5a: Web API helpers** (`packages/web/lib/api.ts`)
- `listGames()` now accepts optional `{ includeNiches?: boolean }` param, appends `?includeNiches=true` query string
- Added type re-exports for `NichePosition`, `NicheEntry`, `NicheNeighbor`, `NicheImpact`, `NicheImpactEntry`

**5b: Game detail page** (`packages/web/app/games/[id]/page.tsx`)
- Niche Position panel renders below tournament breakdown, above score breakdown (REQ-NICHE-18)
- Each niche entry shows: name, type badge (mechanic/category/family), size, rank, champion indicator, neighbor links (REQ-NICHE-19)
- Neighbor names link to game detail pages (REQ-NICHE-21)
- Predicted neighbors show `~` indicator
- Vetoed games show "excluded from niche rankings" message (REQ-NICHE-7)
- Panel omitted when no niches

**5c: Collection page** (`packages/web/app/collection/page.tsx`, `packages/web/components/collection-table.tsx`)
- "Show Niches" toggle in stats strip, merges niche data from pre-fetched `nicheGames` (REQ-NICHE-22)
- Compact niche summary per game row: "3 niches, champion of 1" (REQ-NICHE-23)
- "Group by Niche" view mode toggle (REQ-NICHE-24): groups games under niche headings, sorted by size descending, champion highlighted with left border
- Client-side filter intersection: niche groups respect active filters, groups with <2 filtered members discarded (REQ-NICHE-25)
- Server component pre-fetches `listGames({ includeNiches: true })` and passes as `nicheGames` prop

**5d: Search preview** (`packages/web/app/search/page.tsx`)
- Niche Impact section in prediction preview (REQ-NICHE-26)
- "Would be your Nth game" display with ordinal formatting (REQ-NICHE-27)
- "Would be your 1st" for new niches, "Would be your best" when candidate would be champion
- Shows current champion with score for existing niches

**CSS** (`packages/web/app/globals.css`)
- Added niche design tokens (accent, type colors for mechanic/category/family)
- Niche type badges, card layout, champion badge, neighbor links
- Collection niche summary, group headers, champion row highlight
- Search preview niche impact styles
- Responsive: single-column niche grid below 800px
