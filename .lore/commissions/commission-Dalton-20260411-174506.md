---
title: "Commission: Niche champion display: Phase 4 (daemon routes)"
date: 2026-04-12
status: blocked
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 4 of the niche champion display plan at `.lore/plans/niche-champion-display.md`.\n\n## Phase 4: Daemon Route Integration\n- GET /games/:id gains `nichePosition` (load full collection via prediction service, compute, attach)\n- GET /games gains `?includeNiches=true` query param\n- GET /predictions/bgg/:bggId gains `nicheImpact`\n- Niche engine called from route handlers, NOT from services (per architectural decision in the plan)\n- When `includeNiches` is true but `includePredicted` is not, use prediction service's list for niche computation but return standard list to client\n\nAdd route-level tests for all three endpoints covering the niche data.\n\n## Verification\n- `bun run typecheck` must pass\n- `bun run lint` must pass\n- `bun run test` must pass\n\nStop after Phase 4. Do not proceed to web UI or CLI."
dependencies:
  - commission-Dalton-20260411-174456
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T00:45:06.940Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T00:45:06.942Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
current_progress: ""
projectName: shelf-judge
---
