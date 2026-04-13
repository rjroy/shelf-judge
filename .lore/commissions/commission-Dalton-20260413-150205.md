---
title: "Commission: Shelf Capacity: Shelf Config Web+CLI (C10)"
date: 2026-04-13
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 6 and 7 of the shelf capacity feature: shelf configuration web UI and CLI.\n\n**Read these first:**\n- `.lore/plans/shelf-capacity.md` (Phases 6 and 7 in detail)\n- `.lore/specs/shelf-capacity.md` (REQ-SHELF-27 through REQ-SHELF-29, REQ-SHELF-32, REQ-SHELF-33)\n- `.lore/mockups/mockup-shelf-configuration.html` (shelf config page mockup)\n- `packages/web/app/redundancy/page.tsx` (settings page pattern)\n- `packages/web/components/sidebar.tsx` (sidebar navigation)\n- `packages/web/lib/api.ts` (client helper patterns)\n- `packages/cli/src/commands/` (CLI command patterns)\n\n**Phase 6: Web UI**\n- Client helpers: getShelfConfig, setShelfConfig, addShelfUnit, updateShelfUnit, removeShelfUnit\n- Create `/shelves` page as client component (match redundancy settings pattern)\n- Shelf unit cards with shelf lists, add/edit/remove, unconstrained-height toggle\n- Live summary bar: total shelves, capacity, unconstrained count\n- Sidebar navigation entry\n- CSS additions from mockup (light + dark mode)\n\n**Phase 7: CLI**\n- Create `shelf.ts` command file: shelfList, shelfAddUnit, shelfAddShelf, shelfRemoveUnit, shelfRemoveShelf\n- Height=0 maps to null for unconstrained (REQ-SHELF-33)\n- Register shelf command group\n\n**Verification:** `bun run typecheck`, `bun run lint`. Manual verification against mockup."
dependencies:
  - commission-Dalton-20260413-150152
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-13T22:02:05.893Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T22:10:22.776Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-13T22:32:16.077Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-13T22:32:16.079Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
