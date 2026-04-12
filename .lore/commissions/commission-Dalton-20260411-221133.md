---
title: "Commission: Niche tag filtering: Phase 6 (Web UI)"
date: 2026-04-12
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 6 of the niche tag filtering plan at `.lore/plans/niche-tag-filtering.md`.\n\nRead the full plan first. You are implementing:\n\n- **Phase 6a**: Web API helpers in `packages/web/lib/api.ts` — `getNicheSettings`, `updateNicheSettings`, `ignoreNicheTag`, `unignoreNicheTag`\n- **Phase 6b**: Dismiss button on `NicheEntryCard` in `packages/web/app/games/[id]/page.tsx`. Small dismiss/hide button on each niche card. On click, calls `ignoreNicheTag()` and refreshes page data. The button should feel light — no modal confirmation. A brief undo toast or the restore section (6d) is the safety net.\n- **Phase 6c**: Dismiss button on collection niche group headings in `packages/web/app/collection/page.tsx`.\n- **Phase 6d**: \"Ignored Niches\" restore section below the active niches on the game detail page and collection niche view. Shows each ignored tag as a muted chip with a restore button. Clicking restore calls `unignoreNicheTag()` and refreshes.\n\nThe plan chose Option B (inline restore section) over a separate settings page. Keep management co-located with the niche display.\n\nRun `bun run test`, `bun run typecheck`, and `bun run lint` before declaring complete."
dependencies:
  - commission-Dalton-20260411-221125
linked_artifacts:
  - packages/web/lib/api.ts

  - packages/web/app/api/daemon/[...path]/route.ts
  - packages/web/app/games/[id]/page.tsx
  - packages/web/app/collection/page.tsx
  - packages/web/components/collection-table.tsx
  - packages/web/components/niche-ignore-button.tsx
  - packages/web/app/globals.css
  - packages/web/app/api/daemon/[...path]/route.ts
  - packages/web/app/games/[id]/page.tsx
  - packages/web/app/collection/page.tsx
  - packages/web/components/collection-table.tsx
  - packages/web/components/niche-ignore-button.tsx
  - packages/web/app/globals.css
activity_timeline:
  - timestamp: 2026-04-12T05:11:33.799Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T05:19:25.235Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T05:27:24.249Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T05:27:24.252Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T05:27:24.274Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T05:27:40.707Z
    event: progress_report
    reason: "Starting Phase 6 implementation. Reading current state of web API helpers, game detail page, and collection page."
  - timestamp: 2026-04-12T05:28:44.351Z
    event: progress_report
    reason: "Context gathered. Implementing Phase 6a (API helpers), 6b (dismiss on game detail), 6c (dismiss on collection), 6d (ignored niches restore section). Also need to add PATCH handler to the daemon proxy route."
  - timestamp: 2026-04-12T05:34:06.593Z
    event: result_submitted
    reason: "## Phase 6 Complete: Web UI for Niche Tag Filtering\n\n### 6a: Web API Helpers\n`packages/web/lib/api.ts`: Added `getNicheSettings()`, `updateNicheSettings()`, `ignoreNicheTag()`, `unignoreNicheTag()`. Re-exported `NicheSettings` and `NicheTagFilter` types.\n\nAlso added missing `PATCH` handler to `packages/web/app/api/daemon/[...path]/route.ts` (the proxy route had GET/POST/PUT/DELETE but no PATCH, which the niche settings endpoint needs).\n\n### 6b: Dismiss Button on NicheEntryCard\n`packages/web/app/games/[id]/page.tsx`: Added `NicheIgnoreButton` to the `NicheEntryCard` header. Appears as a subtle \"x\" button that fades in on hover. On click, calls `POST /niches/settings/ignore` through the proxy, then `router.refresh()` to reload server data. No modal confirmation, as the plan specified.\n\n### 6c: Dismiss Button on Collection Niche Group Headers\n`packages/web/components/collection-table.tsx`: Added `NicheIgnoreButton` to each niche group heading in the \"Group by Niche\" view. Same click-to-dismiss behavior.\n\n### 6d: Ignored Niches Restore Section\nBoth pages now fetch niche settings and display an \"Ignored Niches\" section:\n- **Game detail page**: Below the active niche grid, shows muted chips with type badges and \"Restore\" buttons.\n- **Collection page**: Below the niche groups (in niche view mode), same chip+restore pattern.\n\nClicking \"Restore\" calls `DELETE /niches/settings/ignore` and refreshes.\n\n### New Component\n`packages/web/components/niche-ignore-button.tsx`: Client component with `NicheIgnoreButton` (dismiss) and `NicheRestoreButton` (restore). Both use `fetch` to the daemon proxy and `router.refresh()` for data reload.\n\n### CSS\n`packages/web/app/globals.css`: Added styles for `.niche-ignore-btn`, `.niche-restore-btn`, `.niche-ignored-section`, `.niche-ignored-title`, `.niche-ignored-chips`, `.niche-ignored-chip`.\n\n### Verification\n- `bun run test`: 928 pass, 0 fail, 1 skip\n- `bun run typecheck`: clean (pre-existing test-only type errors in web package unrelated to this change)\n- `bun run lint`: clean"
  - timestamp: 2026-04-12T05:34:12.430Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Context gathered. Implementing Phase 6a (API helpers), 6b (dismiss on game detail), 6c (dismiss on collection), 6d (ignored niches restore section). Also need to add PATCH handler to the daemon proxy route."
projectName: shelf-judge
---
## Phase 6 Complete: Web UI for Niche Tag Filtering

### 6a: Web API Helpers
`packages/web/lib/api.ts`: Added `getNicheSettings()`, `updateNicheSettings()`, `ignoreNicheTag()`, `unignoreNicheTag()`. Re-exported `NicheSettings` and `NicheTagFilter` types.

Also added missing `PATCH` handler to `packages/web/app/api/daemon/[...path]/route.ts` (the proxy route had GET/POST/PUT/DELETE but no PATCH, which the niche settings endpoint needs).

### 6b: Dismiss Button on NicheEntryCard
`packages/web/app/games/[id]/page.tsx`: Added `NicheIgnoreButton` to the `NicheEntryCard` header. Appears as a subtle "x" button that fades in on hover. On click, calls `POST /niches/settings/ignore` through the proxy, then `router.refresh()` to reload server data. No modal confirmation, as the plan specified.

### 6c: Dismiss Button on Collection Niche Group Headers
`packages/web/components/collection-table.tsx`: Added `NicheIgnoreButton` to each niche group heading in the "Group by Niche" view. Same click-to-dismiss behavior.

### 6d: Ignored Niches Restore Section
Both pages now fetch niche settings and display an "Ignored Niches" section:
- **Game detail page**: Below the active niche grid, shows muted chips with type badges and "Restore" buttons.
- **Collection page**: Below the niche groups (in niche view mode), same chip+restore pattern.

Clicking "Restore" calls `DELETE /niches/settings/ignore` and refreshes.

### New Component
`packages/web/components/niche-ignore-button.tsx`: Client component with `NicheIgnoreButton` (dismiss) and `NicheRestoreButton` (restore). Both use `fetch` to the daemon proxy and `router.refresh()` for data reload.

### CSS
`packages/web/app/globals.css`: Added styles for `.niche-ignore-btn`, `.niche-restore-btn`, `.niche-ignored-section`, `.niche-ignored-title`, `.niche-ignored-chips`, `.niche-ignored-chip`.

### Verification
- `bun run test`: 928 pass, 0 fail, 1 skip
- `bun run typecheck`: clean (pre-existing test-only type errors in web package unrelated to this change)
- `bun run lint`: clean
