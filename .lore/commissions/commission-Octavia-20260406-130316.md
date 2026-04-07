---
title: "Commission: Spec: Tournament ELO Ranking"
date: 2026-04-06
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Read `.lore/issues/deferred-tournament-ranking.md` and write a specification for tournament-based ELO ranking.\n\nUse the `/lore-development:specify` skill. Read the existing fitness algorithm design at `.lore/designs/fitness-algorithm.md`, the data model at `.lore/designs/data-model.md`, and the vision at `.lore/vision.md` for context on how this would fit into the system.\n\n## Open questions the user wants explored in the spec\n\nThese aren't rhetorical. The spec should take a position on each, with rationale:\n\n1. **Is ELO fitness just another axis? Or does it replace the fitness score and keep axes only for prediction?** The current system has multi-axis weighted fitness. Where does a head-to-head ELO score live relative to that? Consider: if ELO replaces fitness, the axes lose their scoring purpose. If ELO is just another axis, it competes with axes it's derived from. There may be a third option.\n\n2. **How do we start a tournament? Full collection bracket? Or pick a subset?** A 200-game collection makes a full round-robin impractical. What's the tournament structure? How does the user initiate it? Can they scope it (e.g., \"just my strategy games\" or \"games I haven't compared recently\")?\n\n3. **Do we need to record which games have been compared?** ELO typically tracks match history. Is that a first-class data model concern, or can we derive it? What's the minimum state needed to make ELO updates correct and resumable?\n\nThe spec should address all three with clear decisions, not punt them as \"future work.\""
dependencies: []
linked_artifacts:
  - .lore/specs/tournament-ranking.md

resource_overrides:
  model: opus

activity_timeline:
  - timestamp: 2026-04-06T20:03:16.486Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T20:03:16.488Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-06T20:03:16.506Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-06T20:03:25.281Z
    event: progress_report
    reason: "Reading issue file, existing designs, and vision for context before drafting the tournament ranking spec."
  - timestamp: 2026-04-06T20:04:12.153Z
    event: progress_report
    reason: "Context gathered: issue, vision, brainstorm, MVP spec, fitness model design, data model design. Now checking current implementation types and the compendium before drafting."
  - timestamp: 2026-04-06T20:04:34.814Z
    event: progress_report
    reason: "All context gathered. Invoking /lore-development:specify to draft the tournament ranking spec with proper structure."
  - timestamp: 2026-04-06T20:08:42.801Z
    event: progress_report
    reason: "Spec drafted and reviewed. Addressing three priority issues from fresh-eyes review: pause/resume status contradiction, small-collection normalization, and game deletion during active sessions."
  - timestamp: 2026-04-06T20:11:21.803Z
    event: result_submitted
    reason: "Wrote tournament ranking specification at `.lore/specs/tournament-ranking.md` (20 requirements, REQ-TOURN-1 through REQ-TOURN-20 plus REQ-TOURN-15a).\n\n**Positions taken on the three open questions:**\n\n1. **ELO is a peer score, not an axis or replacement.** Axis fitness and tournament rank are independent signals displayed side-by-side. Axis fitness captures stated preference; tournament rank captures revealed preference. Divergence between them is surfaced as information (REQ-TOURN-18). No combined score is computed.\n\n2. **Session-based with adaptive pairing and optional filters.** No full bracket or round-robin. Users start sessions scoped by filter (name, axis threshold, BGG tag, staleness) or unfiltered. Pairs are selected adaptively (low-comparison games first, similar ELO preferred). Sessions are open-ended, resumable, one active at a time.\n\n3. **Comparison history is first-class data.** Every comparison is recorded (game pair, winner, timestamp, session ID). ELO scores are recalculable from history. This enables algorithm tuning, audit trails, and the transparency the vision requires.\n\n**Review findings addressed:** Fresh-eyes review identified three priority issues (pause/resume status contradiction, small-collection normalization instability, game deletion during active sessions) and four minor issues. All seven were resolved in the final draft. Key changes: fixed-range normalization (1100-1900) instead of min/max, explicit \"not yet ranked\" threshold at 5 compared games, REQ-TOURN-15a for mid-session game deletion, session status clarified to active/completed only."
  - timestamp: 2026-04-06T20:11:25.149Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Spec drafted and reviewed. Addressing three priority issues from fresh-eyes review: pause/resume status contradiction, small-collection normalization, and game deletion during active sessions."
projectName: shelf-judge
---
Wrote tournament ranking specification at `.lore/specs/tournament-ranking.md` (20 requirements, REQ-TOURN-1 through REQ-TOURN-20 plus REQ-TOURN-15a).

**Positions taken on the three open questions:**

1. **ELO is a peer score, not an axis or replacement.** Axis fitness and tournament rank are independent signals displayed side-by-side. Axis fitness captures stated preference; tournament rank captures revealed preference. Divergence between them is surfaced as information (REQ-TOURN-18). No combined score is computed.

2. **Session-based with adaptive pairing and optional filters.** No full bracket or round-robin. Users start sessions scoped by filter (name, axis threshold, BGG tag, staleness) or unfiltered. Pairs are selected adaptively (low-comparison games first, similar ELO preferred). Sessions are open-ended, resumable, one active at a time.

3. **Comparison history is first-class data.** Every comparison is recorded (game pair, winner, timestamp, session ID). ELO scores are recalculable from history. This enables algorithm tuning, audit trails, and the transparency the vision requires.

**Review findings addressed:** Fresh-eyes review identified three priority issues (pause/resume status contradiction, small-collection normalization instability, game deletion during active sessions) and four minor issues. All seven were resolved in the final draft. Key changes: fixed-range normalization (1100-1900) instead of min/max, explicit "not yet ranked" threshold at 5 compared games, REQ-TOURN-15a for mid-session game deletion, session status clarified to active/completed only.
