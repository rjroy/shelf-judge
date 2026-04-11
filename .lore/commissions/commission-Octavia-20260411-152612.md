---
title: "Commission: Spec out redundancy scoring: Niche Champion Display (Proposal 5)"
date: 2026-04-11
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Use the `/lore-development:specify` skill to write a spec for Proposal 5 from `.lore/brainstorms/redundancy-scoring.md`: \"Niche Champion Display Without Score Modification.\"\n\nRead the full brainstorm first (especially Proposal 5, the Edge Cases section, and the Interaction Map). The core idea: surface redundancy as a read-only annotation alongside the fitness score, without modifying the score itself. For each game, identify which niches it belongs to and where it ranks within each.\n\nKey elements to spec:\n\n**Game detail view — Niche Position panel:**\n- Show each niche the game belongs to (mechanics, categories, families clusters)\n- Rank within niche, champion game, adjacent games\n- Uses existing profile clustering and fitness scores, no new computation beyond sorting\n\n**Collection list view — niche visibility:**\n- Optional \"niche rank\" columns or \"show redundancy\" mode\n- Grouping games by niche, highlighting champions\n\n**Data layer:**\n- Reuses profiling's BGG clustering (`computeBggClustering`) for niche definitions\n- Reuses existing `GameWithScore[]` fitness scores for ranking\n- No changes to FitnessResult type or scoring formula\n\n**Edge cases from the brainstorm to address:**\n- Best game in its niche (zero penalty, champion status)\n- Game in many niches (participates in multiple niche rankings)\n- Vetoed games (fitness 0) excluded as niche neighbors\n- Predicted-only games: lower weight as niche references\n\n**Interactions:**\n- Prediction: search preview should show niche impact (\"would be your 4th Deck Building game\")\n- This is Stage 1 of the graduated approach (Proposal 6), so design it to be extensible\n\nReference docs: `.lore/vision.md` (Principle 5), `.lore/designs/mvp-fitness-model.md`, `.lore/specs/collection-profiling.md`, `.lore/specs/prediction-engine.md`\n\nOutput the spec to `.lore/specs/`."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-11T22:26:12.885Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T22:26:12.888Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
