---
title: "Commission: Brainstorm redundancy scoring approaches"
date: 2026-04-11
status: dispatched
tags: [commission]
worker: Celeste
workerDisplayTitle: "Guild Visionary"
prompt: "Brainstorm possible approaches for redundancy/collection-awareness scoring. The issue is at `.lore/issues/deferred-redundancy-scoring.md`.\n\nThe core idea: a game's fitness score should decrease if the collection already has strong coverage in that game's niche. Vision Principle 5 says \"the shelf has a carrying capacity.\"\n\nContext to read before brainstorming:\n- `.lore/vision.md` — especially Principle 5\n- `.lore/designs/mvp-fitness-model.md` — current fitness model (per-game, independent)\n- `.lore/specs/collection-profiling.md` — the profiling system already builds feature vectors from mechanics, categories, families, weight, player counts\n- `.lore/specs/prediction-engine.md` — the prediction engine already computes similarity between games\n- The daemon's existing scoring and profiling code\n\nThe profiling and prediction systems are already built. They include feature vectors and similarity computation. Redundancy scoring likely builds on that foundation rather than starting from scratch.\n\nExplore multiple approaches. Consider:\n- How existing profiling feature vectors and prediction similarity could be reused\n- Whether redundancy is a post-processing penalty on fitness or integrated into the score calculation\n- How to define \"coverage\" and \"niche\" using existing data\n- Whether redundancy should be per-game or per-cluster\n- Edge cases: what happens when a game is the best in its niche? When two games are equally redundant with each other?\n- How this interacts with utility curves and veto axes\n- User control: should redundancy sensitivity be configurable?\n\nOutput a brainstorm artifact to `.lore/` following the brainstorm skill conventions."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-11T21:39:38.804Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T21:39:38.805Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
