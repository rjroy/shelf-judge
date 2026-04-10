---
title: "Commission: Brainstorm: Prediction Engine for Unowned Games"
date: 2026-04-10
status: dispatched
tags: [commission]
worker: Celeste
workerDisplayTitle: "Guild Visionary"
prompt: "Run a brainstorm on the deferred prediction engine feature described in `.lore/issues/deferred-prediction-engine.md`.\n\nKey context:\n- MVP scores only owned/rated games. No way to estimate fitness for unplayed games.\n- Prediction requires enough rated data (20+ games minimum for signal).\n- BGG data (mechanics, categories, weight, player counts) provides feature vectors for similarity.\n- Personal axis ratings provide the training signal.\n- The utility curves feature (currently being built, see `.lore/plans/utility-curves.md`) adds preference shapes, tolerance, and veto thresholds, which enriches the signal for prediction.\n- The collection profiling feature (being brainstormed separately) is a natural companion: profiling describes what you like, prediction applies that to unrated games.\n- See `.lore/vision.md` for project principles. See `.lore/designs/mvp-fitness-model.md` for the fitness model.\n\nExplore:\n1. What prediction approaches make sense? Collaborative filtering (BGG community similarity), content-based (mechanics/categories as features), hybrid?\n2. How does the fitness model constrain or enable prediction? Can you predict per-axis scores, or only aggregate fitness?\n3. What's the minimum viable prediction? Ranked list of \"games you might like\" vs. full predicted fitness scores with breakdowns?\n4. Where does BGG's existing recommendation data fit? Can we lean on BGG's \"fans also like\" or similar signals rather than building from scratch?\n5. Confidence/uncertainty: how do you communicate \"this is a guess\" vs. \"this is based on strong signal\"?\n6. Cold start: what happens with <20 games? Degrade gracefully or gate the feature?\n7. How does this interact with collection profiling, utility curves, and tournament rankings?\n8. Anti-goals: what should this NOT become? (Reference `.lore/vision.md`)\n\nWrite the brainstorm artifact to `.lore/brainstorms/prediction-engine.md`."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T03:31:14.043Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T03:31:14.045Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
