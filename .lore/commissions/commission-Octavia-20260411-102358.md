---
title: "Commission: Write spec for game links feature"
date: 2026-04-11
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Use the `/lore-development:specify` skill to write a spec for the game links feature.\n\nThe issue is at `.lore/issues/game-links.md`. The concept: any time a game in the system is referenced, it should be a link to open that game.\n\nThis is a small feature but worth specifying so implementation is consistent. Consider:\n\n- Where game names currently appear in the UI (collection table, profile/clustering views, tournament brackets, prediction results, search results, etc.)\n- What the link target should be (the game detail page)\n- Whether external links to BGG should also be included on the game detail page\n- How game references in different contexts (table rows, inline mentions, badges, cards) should be styled as links\n- Any edge cases (games that don't have a detail page yet, deleted games, etc.)\n\nRead the existing web UI code to understand where game names appear today. Output the spec to `.lore/specs/`."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-11T17:23:58.749Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T17:23:58.751Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-11T17:27:27.612Z
    event: status_failed
    reason: "Session error: Claude Code returned an error result: You've hit your limit · resets 12pm (America/Los_Angeles)"
  - timestamp: 2026-04-11T19:20:36.460Z
    event: status_pending
    reason: "Redispatched for retry"
    from: "failed"
    to: "pending"
  - timestamp: 2026-04-11T19:20:36.462Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
