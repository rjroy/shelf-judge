---
title: "Commission: Spec out redundancy scoring: Niche Champion Display (Proposal 5)"
date: 2026-04-11
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Use the `/lore-development:specify` skill to write a spec for Proposal 5 from `.lore/brainstorms/redundancy-scoring.md`: \"Niche Champion Display Without Score Modification.\"\n\nRead the full brainstorm first (especially Proposal 5, the Edge Cases section, and the Interaction Map). The core idea: surface redundancy as a read-only annotation alongside the fitness score, without modifying the score itself. For each game, identify which niches it belongs to and where it ranks within each.\n\nKey elements to spec:\n\n**Game detail view — Niche Position panel:**\n- Show each niche the game belongs to (mechanics, categories, families clusters)\n- Rank within niche, champion game, adjacent games\n- Uses existing profile clustering and fitness scores, no new computation beyond sorting\n\n**Collection list view — niche visibility:**\n- Optional \"niche rank\" columns or \"show redundancy\" mode\n- Grouping games by niche, highlighting champions\n\n**Data layer:**\n- Reuses profiling's BGG clustering (`computeBggClustering`) for niche definitions\n- Reuses existing `GameWithScore[]` fitness scores for ranking\n- No changes to FitnessResult type or scoring formula\n\n**Edge cases from the brainstorm to address:**\n- Best game in its niche (zero penalty, champion status)\n- Game in many niches (participates in multiple niche rankings)\n- Vetoed games (fitness 0) excluded as niche neighbors\n- Predicted-only games: lower weight as niche references\n\n**Interactions:**\n- Prediction: search preview should show niche impact (\"would be your 4th Deck Building game\")\n- This is Stage 1 of the graduated approach (Proposal 6), so design it to be extensible\n\nReference docs: `.lore/vision.md` (Principle 5), `.lore/designs/mvp-fitness-model.md`, `.lore/specs/collection-profiling.md`, `.lore/specs/prediction-engine.md`\n\nOutput the spec to `.lore/specs/`."
dependencies: []
linked_artifacts:
  - .lore/specs/niche-champion-display.md

activity_timeline:
  - timestamp: 2026-04-11T22:26:12.885Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T22:26:12.888Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-11T22:26:12.912Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-11T22:26:19.719Z
    event: progress_report
    reason: "Reading brainstorm and referenced documents to gather context before specifying."
  - timestamp: 2026-04-11T22:27:15.113Z
    event: progress_report
    reason: "Context gathered: read brainstorm (Proposal 5 + edge cases + interaction map), vision, fitness model design, profiling spec, prediction spec, and verified types/services in code. Now invoking the specify skill to draft the spec."
  - timestamp: 2026-04-11T22:30:51.592Z
    event: result_submitted
    reason: "Wrote the Niche Champion Display spec at `.lore/specs/niche-champion-display.md`. 33 requirements (REQ-NICHE-1 through REQ-NICHE-33) covering:\n\n- **Niche definition** (REQ-NICHE-1 through 3): Cluster-based niches from BGG mechanics, categories, and families. Minimum 2 games per niche.\n- **Niche ranking** (REQ-NICHE-4 through 8): Fitness-score-descending ranking with tie-breaking rules. Vetoed games excluded. Predicted games participate but flagged and ranked below actual on ties.\n- **Data model** (REQ-NICHE-9 through 11): `NichePosition`, `NicheEntry`, `NicheNeighbor` as shared types. Separate from `FitnessResult` (no score type modification). Up to 2 adjacent neighbors above/below.\n- **Daemon API** (REQ-NICHE-12 through 15): Extended `GET /games/:id` and `GET /games` responses. `NicheImpact` type for search preview via `GET /predictions/bgg/:bggId`. Pure-function `niche-engine.ts` module.\n- **Engine implementation** (REQ-NICHE-16 through 17): `computeNichePositions` and `computeNicheImpact` functions specified.\n- **Web UI** (REQ-NICHE-18 through 27): Game detail Niche Position panel, collection list niche toggle, Group by Niche view mode, search preview niche impact section.\n- **CLI** (REQ-NICHE-28 through 30): Niche data in game detail, `--show-niches` flag for scores, niche impact in predict.\n- **Interactions** (REQ-NICHE-31 through 33): One-way dependency on fitness scores. No modification to profiling or prediction. Computed on demand.\n\nAll four brainstorm edge cases addressed: best game in niche (REQ-NICHE-5), game in many niches (REQ-NICHE-4/9), vetoed games (REQ-NICHE-7), predicted-only games (REQ-NICHE-8). Prediction interaction (search preview niche impact) covered in REQ-NICHE-14/26/27. Stage 1 extensibility preserved via exit points to Stages 2 and 3.\n\nOne open question flagged: BGG family noise (publisher families creating incidental niches)."
  - timestamp: 2026-04-11T22:30:56.807Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Context gathered: read brainstorm (Proposal 5 + edge cases + interaction map), vision, fitness model design, profiling spec, prediction spec, and verified types/services in code. Now invoking the specify skill to draft the spec."
projectName: shelf-judge
---
Wrote the Niche Champion Display spec at `.lore/specs/niche-champion-display.md`. 33 requirements (REQ-NICHE-1 through REQ-NICHE-33) covering:

- **Niche definition** (REQ-NICHE-1 through 3): Cluster-based niches from BGG mechanics, categories, and families. Minimum 2 games per niche.
- **Niche ranking** (REQ-NICHE-4 through 8): Fitness-score-descending ranking with tie-breaking rules. Vetoed games excluded. Predicted games participate but flagged and ranked below actual on ties.
- **Data model** (REQ-NICHE-9 through 11): `NichePosition`, `NicheEntry`, `NicheNeighbor` as shared types. Separate from `FitnessResult` (no score type modification). Up to 2 adjacent neighbors above/below.
- **Daemon API** (REQ-NICHE-12 through 15): Extended `GET /games/:id` and `GET /games` responses. `NicheImpact` type for search preview via `GET /predictions/bgg/:bggId`. Pure-function `niche-engine.ts` module.
- **Engine implementation** (REQ-NICHE-16 through 17): `computeNichePositions` and `computeNicheImpact` functions specified.
- **Web UI** (REQ-NICHE-18 through 27): Game detail Niche Position panel, collection list niche toggle, Group by Niche view mode, search preview niche impact section.
- **CLI** (REQ-NICHE-28 through 30): Niche data in game detail, `--show-niches` flag for scores, niche impact in predict.
- **Interactions** (REQ-NICHE-31 through 33): One-way dependency on fitness scores. No modification to profiling or prediction. Computed on demand.

All four brainstorm edge cases addressed: best game in niche (REQ-NICHE-5), game in many niches (REQ-NICHE-4/9), vetoed games (REQ-NICHE-7), predicted-only games (REQ-NICHE-8). Prediction interaction (search preview niche impact) covered in REQ-NICHE-14/26/27. Stage 1 extensibility preserved via exit points to Stages 2 and 3.

One open question flagged: BGG family noise (publisher families creating incidental niches).
