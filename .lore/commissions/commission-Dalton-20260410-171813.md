---
title: "Commission: Prediction Engine Phase 5: Web UI"
date: 2026-04-11
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 5 of `.lore/plans/prediction-engine.md`: Web UI.\n\n**Design target**: `.lore/mockups/prediction-engine.html`\n\nKey deliverables:\n1. **Web API additions**: `predictGame`, `getReadiness`, `listGamesWithPredictions` in `packages/web/lib/api.ts`\n2. **Game detail** (mockup Sections 1-3): PREDICTED badge, teal score with tilde prefix, confidence badges on predicted axes, expandable confidence breakdown panel (reference games, stats, weighted average formula), revealed preference tension panel\n3. **Rating form**: Prediction hints for unrated axes with dashed teal border\n4. **Collection list** (mockup Section 4): Predictions toggle in stats strip, teal wash on predicted rows, confidence column, tilde-prefixed predicted scores\n5. **Sidebar readiness widget**: Stage indicator, progress bar, count on all pages\n6. **Readiness page** (mockup Section 5): `packages/web/app/readiness/page.tsx` with stage banner, timeline, weak axes cards, suggested actions\n7. **CSS design tokens**: `--predict-*`, `--conf-*`, `--tourney-*` tokens and all component classes from the plan\n8. **Integration fixes**: `collection-utils.ts` ratedStatus filter for predicted-only games, profile page (`app/page.tsx`) excludes predicted scores from averages\n\nRead the full Phase 5 section for detailed mockup-derived layout specs, color tokens, component classes, and responsive breakpoints. The mockup is authoritative.\n\nRun `bun run typecheck`, `bun run lint`."
dependencies:
  - commission-Dalton-20260410-171758
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-11T00:18:13.841Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T00:20:46.078Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-11T00:47:17.229Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-11T00:47:17.232Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-11T00:58:16.745Z
    event: status_failed
    reason: "Session error: Claude Code returned an error result: You've hit your limit · resets 9pm (America/Los_Angeles)"
  - timestamp: 2026-04-11T04:10:24.612Z
    event: status_pending
    reason: "Redispatched for retry"
    from: "failed"
    to: "pending"
  - timestamp: 2026-04-11T04:10:24.614Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
