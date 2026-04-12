---
title: "Commission: Plan fix for empty community stats in profiling"
date: 2026-04-11
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Use the `/lore-development:prep-plan` skill to create an implementation plan for fixing the empty community stats bug.\n\nThe issue is at `.lore/issues/the-community-stats-are-empty.md`. The problem:\n\n- Profile community stats show up as empty/null\n- The derived data is not properly hooked up in the profiling context\n- Game detail views display community stats correctly, and fitness values are accurate\n- But in clustering or when sorting games by community stats, they show as null\n\nThis is a data plumbing bug, not a display bug. The community stats exist in the game data but aren't flowing through to the profiling/clustering/sorting layer.\n\nRead the relevant code to understand:\n1. How game detail views access community stats (this works)\n2. How the profiling endpoint assembles its data (this is where it breaks)\n3. How clustering and sorting consume community stats\n4. The derived data pipeline that should connect them\n\nLook at the daemon's profiling routes, the shared types for community stats, and how the web UI's profile page consumes the data.\n\nOutput the plan to `.lore/plans/` following the prep-plan skill conventions."
dependencies: []
linked_artifacts:
  - .lore/plans/fix-community-stats.md

activity_timeline:
  - timestamp: 2026-04-11T17:01:33.818Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T17:01:33.820Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-11T17:01:33.845Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-11T17:01:42.201Z
    event: progress_report
    reason: "Reading the issue file and gathering context before invoking prep-plan skill."
  - timestamp: 2026-04-11T17:03:52.659Z
    event: progress_report
    reason: "Exploration complete. Now reading key source files to pinpoint the exact data plumbing gap before invoking prep-plan."
  - timestamp: 2026-04-11T17:06:31.982Z
    event: progress_report
    reason: "Context gathered. Invoking prep-plan skill to create the implementation plan for the community stats bug fix."
  - timestamp: 2026-04-11T17:12:06.634Z
    event: progress_report
    reason: "Plan drafted and saved to .lore/plans/fix-community-stats.md. Running fresh-eyes plan review."
  - timestamp: 2026-04-11T17:15:23.131Z
    event: result_submitted
    reason: "Created implementation plan at `.lore/plans/fix-community-stats.md` for fixing the empty community stats bug.\n\n**Root cause identified:** BGG-sourced axis values (community rating, weight) are computed on-the-fly by the fitness service but never stored in `game.ratings`. Three consumers read `game.ratings` and find nothing for BGG axes: profile axis distributions, feature vector encoding, and collection sorting by BGG-sourced axes.\n\n**Fix pattern:** Extract `resolveBggRawValue` into `@shelf-judge/shared`, add a `resolveAxisValues` helper that merges personal ratings with BGG fallbacks, and update all three consumers to use it.\n\n**7 implementation steps:** extract shared utility, update profile distributions, update feature vector encoding (both outlier and prediction paths), update collection sorting, handle stale profile cache, add tests, validate.\n\n**Plan reviewed** by fresh-context plan-reviewer agent. Three priority findings addressed: prediction-service call site coverage, `computeHigherIsBetterEffective` dependency for shared package placement, and normalization safety (personal ratings must not be re-normalized)."
  - timestamp: 2026-04-11T17:15:29.295Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Plan drafted and saved to .lore/plans/fix-community-stats.md. Running fresh-eyes plan review."
projectName: shelf-judge
---
Created implementation plan at `.lore/plans/fix-community-stats.md` for fixing the empty community stats bug.

**Root cause identified:** BGG-sourced axis values (community rating, weight) are computed on-the-fly by the fitness service but never stored in `game.ratings`. Three consumers read `game.ratings` and find nothing for BGG axes: profile axis distributions, feature vector encoding, and collection sorting by BGG-sourced axes.

**Fix pattern:** Extract `resolveBggRawValue` into `@shelf-judge/shared`, add a `resolveAxisValues` helper that merges personal ratings with BGG fallbacks, and update all three consumers to use it.

**7 implementation steps:** extract shared utility, update profile distributions, update feature vector encoding (both outlier and prediction paths), update collection sorting, handle stale profile cache, add tests, validate.

**Plan reviewed** by fresh-context plan-reviewer agent. Three priority findings addressed: prediction-service call site coverage, `computeHigherIsBetterEffective` dependency for shared package placement, and normalization safety (personal ratings must not be re-normalized).
