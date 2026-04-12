---
title: "Commission: Redundancy Settings Page: Build (Phases 1-2)"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 1-2 of the plan at `.lore/plans/redundancy-setting-move.md`. Read that plan thoroughly before starting.\n\n**Phase 1: New page and sidebar entry**\n- Create `packages/web/app/redundancy/page.tsx` as a `\"use client\"` component following the Axes/Import page pattern (topbar with title, `main-scroll` wrapper)\n- Add \"Redundancy\" sidebar entry in the Settings group in `packages/web/components/sidebar.tsx`, between \"Axes\" and \"Import / BGG\"\n- Load current settings on mount via `fetch(\"/api/daemon/redundancy/settings\")`\n- Render all the same controls as the current `RedundancySettingsPanel` (enabled toggle, stage selector, similarity threshold slider, max penalty slider, component weights, min/expected neighbors, reset to defaults)\n- Remove the collapsible behavior: settings are always visible on their dedicated page\n\n**Phase 2: Save + Regenerate button**\n- Replace auto-save debounce with local-only state. Changes update local state only, no network calls until Save.\n- Dirty flag tracks whether local state differs from last-saved. Save button disabled when not dirty.\n- Button label: \"Save & Regenerate\"\n- On click: (1) PATCH `/api/daemon/redundancy/settings`, (2) POST `/api/daemon/tournament/normalize-fitness`, (3) show success with normalized count, (4) clear dirty flag\n- If either request fails, show error and stop. Don't normalize if save failed.\n- \"Reset to defaults\" resets local state and sets dirty flag (no auto-save)\n\nRun `bun run typecheck` and `bun run lint` before declaring complete."
dependencies:
  - commission-Dalton-20260412-111740
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T18:50:35.124Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T18:50:35.127Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T18:53:58.205Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T18:53:58.207Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
