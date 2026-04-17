---
title: "Commission: Brainstorm one-pass bracket mode"
date: 2026-04-17
status: dispatched
tags: [commission]
worker: Celeste
workerDisplayTitle: "Guild Visionary"
prompt: "Brainstorm `.lore/issues/one-pass-bracket-mode.md` using the `/lore-development:brainstorm` skill.\n\nThe issue proposes a tournament mode that reduces pairwise comparisons by using transitivity to skip matches whose outcome can be inferred from prior results. Example from the issue:\n\n- test: a > b\n- test: b > c\n- skip: a vs c (inferred a > c)\n- test: b > d\n- still need c vs d (no transitive path)\n- test: c > d\n- skip: a vs d (inferred a > d)\n\nThe goal is to make tournaments tractable when the pool grows large, accepting less certainty than a full round-robin.\n\nExplore the idea fully. Among the things worth considering:\n- How transitive inference interacts with the current ELO ranking system (currently every pair matters for rating stability)\n- When the tractability gain justifies the loss of information (pool size thresholds, UX patterns)\n- Alternative framings: is \"one pass\" a separate mode, a setting, or a pairing strategy within existing tournaments\n- Edge cases: cycles, near-ties, how to recover when inferred results feel wrong\n- Interaction with existing \"reduce tournament overhead\" work already shipped\n- Whether this changes data model (stored match results vs inferred results)\n- UX: does the user see skipped pairs? Can they opt to test one?\n\nRead `.lore/vision.md`, `.lore/designs/` (especially anything tournament-related), and the tournament implementation in `packages/daemon/` and `packages/web/` before proposing.\n\nRecord the brainstorm under `.lore/brainstorms/` per the skill's convention. The issue file remains open; the brainstorm captures \"what if\" exploration that can later be distilled into a spec if the user decides to pursue it."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-17T03:44:24.907Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-17T03:44:24.911Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
