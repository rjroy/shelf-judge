---
title: "Commission: Collection Profiling Phase 5: Web UI"
date: 2026-04-10
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 5 of `.lore/plans/collection-profiling.md`: Web UI.\n\n**Design target**: `.lore/mockups/profile-overview.html` (the visual spec)\n\nKey deliverables:\n1. **Navigation restructuring**: Move collection list from `/` to `/collection`. New Profile Overview at `/`. Update sidebar nav with grouped sections (Overview, Library, Ranking, Settings) per mockup.\n2. **Profile Overview page**: Server component fetching from daemon. Seven sections in mockup order:\n   - Topbar with stale state handling (amber badge, Recompute button)\n   - LLM narration empty state (deferred, non-functional Generate button)\n   - Axis Rating Distributions (mini-histograms, 10 buckets, amber bars)\n   - Axis Importance (horizontal bar chart)\n   - BGG Attribute Concentrations (two-column grid, collapses at 720px)\n   - Utility Curve Declarations (pill tags by type)\n   - Preference Divergence (conditional, side-by-side scores)\n   - Collection Outliers (per-component distance chips, classification tags)\n   - Axis Suggestions (question-phrased cards with dismiss)\n3. **Game detail additions**: Divergence and outlier status on game pages\n4. **CSS**: Extract from mockup, add color language tokens to globals.css\n5. **Component extraction**: Split into sub-components per section to manage file size\n\nFollow the plan's detailed section-by-section layout specs and color language rules. The mockup is authoritative for visual design.\n\nRun `bun run typecheck` and `bun run lint`."
dependencies:
  - commission-Dalton-20260410-120312
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T19:03:29.968Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T19:10:00.062Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-10T23:17:31.508Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-10T23:17:31.511Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
