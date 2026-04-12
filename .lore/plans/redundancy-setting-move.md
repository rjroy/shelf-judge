---
title: Redundancy Settings Page
status: executed 
issue: .lore/issues/redundancy-setting-move.md
date: 2026-04-12
tags: [ux, settings, redundancy]
---

# Plan: Redundancy Settings Page

## Goal

Move redundancy settings out of the Collection page into a dedicated page under the Settings section in the sidebar. Replace the auto-save-without-regeneration behavior with an explicit Save button that persists settings AND triggers fitness regeneration in one action.

## Current State

- **Redundancy settings UI** lives in `packages/web/components/redundancy-settings.tsx` as `RedundancySettingsPanel`. It's a collapsible panel with a toggle, sliders, and number inputs. Every change auto-saves via a debounced PATCH to `/api/daemon/redundancy/settings`.
- **Collection page** (`packages/web/app/collection/page.tsx`) renders `<RedundancySettingsPanel />` at line 119, inside `main-scroll` above the collection table. The page also fetches redundancy settings server-side (lines 51-56) to determine `isIntegrated` for the table.
- **Sidebar** (`packages/web/components/sidebar.tsx`) has a "Settings" group (lines 70-91) containing "Axes" (`/axes`) and "Import / BGG" (`/import`).
- **Fitness regeneration** is triggered by POST to `/api/daemon/tournament/normalize-fitness` (daemon route at `packages/daemon/src/routes/tournament.ts:214-222`). The web UI exposes this via `NormalizeFitnessButton` in `packages/web/components/normalize-fitness-button.tsx`, which lives in the Collection page topbar.
- **Daemon redundancy API** has GET and PATCH at `/api/redundancy/settings` (`packages/daemon/src/routes/redundancy.ts`). No changes needed to the daemon API for this work.

## What Changes

### Moves

- `RedundancySettingsPanel` usage moves from Collection page to a new `/redundancy` page.

### New

- New page at `packages/web/app/redundancy/page.tsx`.
- New sidebar entry "Redundancy" under the Settings group.
- Save button in the new page that PATCHes settings then POSTs normalize-fitness.

### Changes

- `RedundancySettingsPanel` component rewritten to remove auto-save behavior, collapsible toggle, and debouncing. Instead: form state is local until the user clicks Save.
- Collection page loses the `<RedundancySettingsPanel />` render and the `getRedundancySettings` server-side fetch for `isIntegrated`. The `isIntegrated` value is still needed by `CollectionTable`, so the server-side fetch stays but only for that boolean, not for the settings panel.

### No Change

- Daemon API. Both `/api/redundancy/settings` (GET, PATCH) and `/api/tournament/normalize-fitness` (POST) stay as-is.
- `packages/web/lib/api.ts` already exports `getRedundancySettings` and `updateRedundancySettings`. No new API helpers needed.
- CSS classes for the redundancy settings form. Reuse existing `.redundancy-*` styles.

## Phases

### Phase 1: New page and sidebar entry

**What:** Create `packages/web/app/redundancy/page.tsx` with a page shell following the Axes/Import pattern (topbar with title, `main-scroll` wrapper). Add a "Redundancy" entry to the sidebar's Settings group.

**Files touched:**

- `packages/web/app/redundancy/page.tsx` (new)
- `packages/web/components/sidebar.tsx` (add nav item to Settings group)

**Details:**

- The page is a `"use client"` component (needs state for form controls).
- Sidebar entry goes between "Axes" and "Import / BGG" in the Settings group at `sidebar.tsx:70-91`. Use an SVG icon consistent with the existing style (a simple overlap/layers icon for redundancy).
- The page loads current settings on mount via `fetch("/api/daemon/redundancy/settings")`, same as the current component.
- Render all the same controls as the current `RedundancySettingsPanel` (enabled toggle, stage selector, similarity threshold slider, max penalty slider, component weights, min/expected neighbors, reset to defaults).
- Remove the collapsible behavior (no toggle button to show/hide). Settings are always visible on their dedicated page.

**Verification:** Page renders at `/redundancy`. Sidebar shows the new entry, highlights correctly when active. All controls display current values from the daemon.

### Phase 2: Save + Regenerate button

**What:** Replace the auto-save debounce pattern with local-only state and an explicit Save button. Save PATCHes settings, then POSTs normalize-fitness, then shows a result message.

**Files touched:**

- `packages/web/app/redundancy/page.tsx` (the page from Phase 1)

**Details:**

- Local state holds the working copy of settings. Changes to sliders/inputs update local state only, no network calls.
- A dirty flag tracks whether local state differs from last-saved state. The Save button is disabled when not dirty.
- Save button label: "Save & Regenerate" (communicates the combined action).
- On click: (1) PATCH `/api/daemon/redundancy/settings` with the full settings object, (2) if PATCH succeeds, POST `/api/daemon/tournament/normalize-fitness`, (3) show success message with normalized count, (4) clear dirty flag.
- If either request fails, show the error and stop. Don't normalize if the save failed.
- "Reset to defaults" button resets local state to `DEFAULT_SETTINGS` and sets dirty flag (doesn't save automatically).
- No confirmation dialog on Save. The user is on a dedicated settings page and clicked an explicit button; that's sufficient intent.

**Verification:** Change a slider, observe Save button enables. Click Save, observe PATCH then POST in network tab. Settings persist across page reload. Fitness scores reflect the new settings.

### Phase 3: Remove from Collection page

**What:** Remove the redundancy settings panel from the Collection page. Keep the server-side `isIntegrated` check.

**Files touched:**

- `packages/web/app/collection/page.tsx` (remove `<RedundancySettingsPanel />` render and its import)

**Details:**

- Remove the `import { RedundancySettingsPanel }` at line 15.
- Remove the `<RedundancySettingsPanel />` at line 119.
- Keep the `getRedundancySettings` fetch (lines 51-56) and `isIntegrated` variable. `CollectionTable` still needs this to know whether redundancy penalties are live.
- The `NormalizeFitnessButton` in the Collection topbar stays. Users may still want to manually regenerate fitness from the Collection page for reasons other than redundancy settings changes.

**Verification:** Collection page loads without the redundancy settings panel. `isIntegrated` still correctly toggles redundancy column behavior in the table. No unused imports.

### Phase 4: Cleanup

**What:** Remove dead code from the old component if any remains unused, and verify the full flow end-to-end.

**Files touched:**

- `packages/web/components/redundancy-settings.tsx` (delete file if unused, or gut it if referenced elsewhere)

**Details:**

- Check whether `RedundancySettingsPanel` is imported anywhere after Phase 3. If not, delete `packages/web/components/redundancy-settings.tsx`.
- If any CSS classes from `.redundancy-settings-toggle` (the collapsible header) are now orphaned, they can be removed from `globals.css`, but this is low priority.
- Run `bun run typecheck && bun run lint` to confirm no dangling references.

**Verification:** `bun run typecheck` clean. `bun run lint` clean. `bun run test` passes. Navigate through all pages to confirm nothing is broken. Specifically: Collection, Redundancy settings, Axes, Import.

## Delegation Notes

All four phases go to Dalton. Phases 1-2 can be a single commission since the page isn't useful without the save behavior. Phases 3-4 can be a second commission. The split keeps each commission focused: first build the new thing, then remove the old thing.

Suggested commission structure:

1. **Commission A (Dalton):** Phases 1 + 2. Build the redundancy settings page with save+regenerate.
2. **Commission B (Dalton):** Phases 3 + 4. Remove from Collection, clean up dead code.
3. **Commission C (Thorne):** Review the final result across both commissions.
