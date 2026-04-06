---
title: "Commission: File Issues: MVP Deferred Items"
date: 2026-04-06
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Read `.lore/specs/mvp.md` and identify all deferred items, out-of-scope items, and future work mentioned in the spec.\n\nFor each deferred item, file a separate structured issue to `.lore/issues/` using the `/lore-development:file-issue` skill. Each issue should capture what was deferred, why it was deferred, and enough context that someone picking it up later understands the intent without re-reading the full MVP spec.\n\nRead any existing issues in `.lore/issues/` first to avoid duplicating items already tracked."
dependencies: []
linked_artifacts:
  - .lore/issues/deferred-redundancy-scoring.md

  - .lore/issues/deferred-prediction-engine.md
  - .lore/issues/deferred-collection-profiling.md
  - .lore/issues/deferred-tournament-ranking.md
  - .lore/issues/deferred-utility-curves.md
  - .lore/issues/deferred-llm-integration.md
  - .lore/issues/deferred-bgg-user-auth.md
  - .lore/issues/deferred-play-history-import.md
  - .lore/issues/open-question-axis-weight-ux.md
  - .lore/issues/deferred-prediction-engine.md
  - .lore/issues/deferred-collection-profiling.md
  - .lore/issues/deferred-tournament-ranking.md
  - .lore/issues/deferred-utility-curves.md
  - .lore/issues/deferred-llm-integration.md
  - .lore/issues/deferred-bgg-user-auth.md
  - .lore/issues/deferred-play-history-import.md
  - .lore/issues/open-question-axis-weight-ux.md
activity_timeline:
  - timestamp: 2026-04-06T13:35:52.972Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T13:35:52.974Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-06T13:35:52.993Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-06T13:36:03.773Z
    event: progress_report
    reason: "Read MVP spec and listed existing issues. Now reading existing issues to avoid duplicates before filing new ones for deferred items."
  - timestamp: 2026-04-06T13:36:32.411Z
    event: progress_report
    reason: "Identified 8 deferred/future items from MVP spec: redundancy scoring, prediction engine, collection profiling, tournament ranking, utility curves, LLM features, BGG user auth, play history import. Plus 1 open question (axis weight UX). Filing issues now."
  - timestamp: 2026-04-06T13:38:15.295Z
    event: result_submitted
    reason: "Filed 9 structured issues from the MVP spec's deferred items and open questions. No overlap with the 6 pre-existing issues (which track implementation quality and cleanup).\n\n**8 deferred features filed:**\n- `deferred-redundancy-scoring.md` — collection-awareness, vision Principle 5\n- `deferred-prediction-engine.md` — fitness estimates for unowned games\n- `deferred-collection-profiling.md` — taste profile inference, vision Principle 3\n- `deferred-tournament-ranking.md` — pairwise comparison layer (brainstorm hybrid conclusion)\n- `deferred-utility-curves.md` — non-linear scoring and veto axes (brainstorm Approach 4)\n- `deferred-llm-integration.md` — natural language explanations and conversational axis creation\n- `deferred-bgg-user-auth.md` — user login for private BGG data access\n- `deferred-play-history-import.md` — BGG play logs\n\n**1 open question filed:**\n- `open-question-axis-weight-ux.md` — raw numbers vs normalized sliders (flagged for resolution through use)\n\nEach issue captures what was deferred, why, the spec's reasoning for deferral, and pointers to relevant design artifacts. The 6 items with spec exit point stubs have stub references in their frontmatter."
  - timestamp: 2026-04-06T13:38:18.005Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Identified 8 deferred/future items from MVP spec: redundancy scoring, prediction engine, collection profiling, tournament ranking, utility curves, LLM features, BGG user auth, play history import. Plus 1 open question (axis weight UX). Filing issues now."
projectName: shelf-judge
---
Filed 9 structured issues from the MVP spec's deferred items and open questions. No overlap with the 6 pre-existing issues (which track implementation quality and cleanup).

**8 deferred features filed:**
- `deferred-redundancy-scoring.md` — collection-awareness, vision Principle 5
- `deferred-prediction-engine.md` — fitness estimates for unowned games
- `deferred-collection-profiling.md` — taste profile inference, vision Principle 3
- `deferred-tournament-ranking.md` — pairwise comparison layer (brainstorm hybrid conclusion)
- `deferred-utility-curves.md` — non-linear scoring and veto axes (brainstorm Approach 4)
- `deferred-llm-integration.md` — natural language explanations and conversational axis creation
- `deferred-bgg-user-auth.md` — user login for private BGG data access
- `deferred-play-history-import.md` — BGG play logs

**1 open question filed:**
- `open-question-axis-weight-ux.md` — raw numbers vs normalized sliders (flagged for resolution through use)

Each issue captures what was deferred, why, the spec's reasoning for deferral, and pointers to relevant design artifacts. The 6 items with spec exit point stubs have stub references in their frontmatter.
