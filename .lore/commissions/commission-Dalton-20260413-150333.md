---
title: "Commission: Shelf Capacity: Capacity Web UI+CLI (C17)"
date: 2026-04-13
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 10b-10e and 11 of the shelf capacity feature: capacity web UI and CLI.\n\n**Read these first:**\n- `.lore/plans/shelf-capacity.md` (Phases 10 and 11 in detail)\n- `.lore/specs/shelf-capacity.md` (REQ-SHELF-30, REQ-SHELF-31, REQ-SHELF-34, REQ-SHELF-35)\n- `.lore/mockups/mockup-shelf-capacity-indicator.html` (collection page indicator)\n- `.lore/mockups/mockup-shelf-capacity-detail.html` (capacity detail page)\n- `.lore/mockups/mockup-shelf-capacity-detail-empty.html` (empty/unconfigured states)\n- `packages/web/app/collection/page.tsx` (where the indicator goes)\n- `packages/web/components/sidebar.tsx` (sidebar nav)\n\n**Phase 10: Web UI**\n- Collection page capacity indicator (4 states from mockup: all placed, overflow, unfittable, no dimensions)\n- Create `/capacity` page: shelf assignments with utilization bars and grade badges, unfittable games section, displaced games section, dimension coverage note\n- Empty states page from mockup\n- Sidebar nav: \"Capacity\" entry\n- CSS: grade badge tokens, utilization bars, warning banners (light + dark mode)\n\n**Phase 11: CLI**\n- `shelfStatus` command: summary output per REQ-SHELF-34\n- `shelfCapacity` command: three-section output (assignments, unfittable, displaced) per REQ-SHELF-35\n- `--json` mode returns full ShelfCapacityResult\n\n**Verification:** `bun run typecheck`, `bun run lint`. Manual verification against all mockups in light and dark mode."
dependencies:
  - commission-Dalton-20260413-150319
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-13T22:03:33.995Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T22:10:22.777Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-17T03:25:34.297Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-17T03:25:34.302Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
