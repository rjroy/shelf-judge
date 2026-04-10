---
title: "Commission: Brainstorm: Prediction Engine for Unowned Games"
date: 2026-04-10
status: completed
tags: [commission]
worker: Celeste
workerDisplayTitle: "Guild Visionary"
prompt: "Run a brainstorm on the deferred prediction engine feature described in `.lore/issues/deferred-prediction-engine.md`.\n\nKey context:\n- MVP scores only owned/rated games. No way to estimate fitness for unplayed games.\n- Prediction requires enough rated data (20+ games minimum for signal).\n- BGG data (mechanics, categories, weight, player counts) provides feature vectors for similarity.\n- Personal axis ratings provide the training signal.\n- The utility curves feature (currently being built, see `.lore/plans/utility-curves.md`) adds preference shapes, tolerance, and veto thresholds, which enriches the signal for prediction.\n- The collection profiling feature (being brainstormed separately) is a natural companion: profiling describes what you like, prediction applies that to unrated games.\n- See `.lore/vision.md` for project principles. See `.lore/designs/mvp-fitness-model.md` for the fitness model.\n\nExplore:\n1. What prediction approaches make sense? Collaborative filtering (BGG community similarity), content-based (mechanics/categories as features), hybrid?\n2. How does the fitness model constrain or enable prediction? Can you predict per-axis scores, or only aggregate fitness?\n3. What's the minimum viable prediction? Ranked list of \"games you might like\" vs. full predicted fitness scores with breakdowns?\n4. Where does BGG's existing recommendation data fit? Can we lean on BGG's \"fans also like\" or similar signals rather than building from scratch?\n5. Confidence/uncertainty: how do you communicate \"this is a guess\" vs. \"this is based on strong signal\"?\n6. Cold start: what happens with <20 games? Degrade gracefully or gate the feature?\n7. How does this interact with collection profiling, utility curves, and tournament rankings?\n8. Anti-goals: what should this NOT become? (Reference `.lore/vision.md`)\n\nWrite the brainstorm artifact to `.lore/brainstorms/prediction-engine.md`."
dependencies: []
linked_artifacts:
  - .lore/brainstorms/prediction-engine.md

activity_timeline:
  - timestamp: 2026-04-10T03:31:14.043Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T03:31:14.045Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T03:31:14.069Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T03:31:20.190Z
    event: progress_report
    reason: "Starting brainstorm on prediction engine. Reading vision, fitness model, utility curves plan, collection profiling brainstorm, and the deferred issue."
  - timestamp: 2026-04-10T03:32:30.646Z
    event: progress_report
    reason: "Context gathered: vision, fitness model, utility curves spec/plan, all 5 brainstorm approaches, deferred issues (prediction, profiling, redundancy, tournament). Now examining current BGG data structures and recent git history before drafting proposals."
  - timestamp: 2026-04-10T03:32:46.989Z
    event: progress_report
    reason: "All context gathered. Drafting the brainstorm artifact with 5-6 proposals covering prediction approaches, fitness model interaction, confidence signals, cold start, BGG data leverage, and feature interactions."
  - timestamp: 2026-04-10T03:36:34.771Z
    event: result_submitted
    reason: "Brainstorm artifact written to `.lore/brainstorms/prediction-engine.md` with 6 proposals:\n\n1. **Curve-First Prediction for BGG-Derived Axes** (Small) — Apply the user's utility curves to BGG data for any game, producing real per-axis scores with zero estimation. Immediate value, no training data needed.\n\n2. **Nearest-Neighbor Estimation for Personal Axes** (Medium) — k-NN approach using BGG mechanics, categories, weight, and player counts as feature vectors. The user's own rated games provide training labels. Interpretable: reference games are the explanation.\n\n3. **Tournament ELO as Prediction Prior** (Medium) — Connect revealed preference (tournament matchup data) to prediction as a correction signal. Surfaces tension between \"what your axis ratings predict\" and \"what you actually prefer in practice.\"\n\n4. **Confidence Architecture with Explicit Uncertainty** (Small-Medium) — Structured confidence model (actual/strong/moderate/weak/insufficient) per axis. The mechanism that makes prediction honest rather than misleading. Should be designed before or alongside estimation logic.\n\n5. **BGG \"Fans Also Like\" as Candidate Discovery** (Large) — Use BGG's taxonomy (families, mechanic clusters) as candidate discovery, scored by the user's personal axes. Inverts the question from \"what would this game score?\" to \"what games score well on my axes?\"\n\n6. **Graceful Cold Start with Progressive Unlock** (Small) — Four-stage progression (0-5-15-30 games) with honest labeling at each stage. Turns prediction uncertainty into a call to action: \"rate deck-building games to improve predictions in that category.\"\n\nEach proposal includes vision alignment analysis (anti-goal check, principle alignment, tension resolution, constraint check). The interaction map shows how proposals relate to each other and to adjacent features (collection profiling, redundancy scoring, utility curves, tournament ranking)."
  - timestamp: 2026-04-10T03:36:41.989Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All context gathered. Drafting the brainstorm artifact with 5-6 proposals covering prediction approaches, fitness model interaction, confidence signals, cold start, BGG data leverage, and feature interactions."
projectName: shelf-judge
---
Brainstorm artifact written to `.lore/brainstorms/prediction-engine.md` with 6 proposals:

1. **Curve-First Prediction for BGG-Derived Axes** (Small) — Apply the user's utility curves to BGG data for any game, producing real per-axis scores with zero estimation. Immediate value, no training data needed.

2. **Nearest-Neighbor Estimation for Personal Axes** (Medium) — k-NN approach using BGG mechanics, categories, weight, and player counts as feature vectors. The user's own rated games provide training labels. Interpretable: reference games are the explanation.

3. **Tournament ELO as Prediction Prior** (Medium) — Connect revealed preference (tournament matchup data) to prediction as a correction signal. Surfaces tension between "what your axis ratings predict" and "what you actually prefer in practice."

4. **Confidence Architecture with Explicit Uncertainty** (Small-Medium) — Structured confidence model (actual/strong/moderate/weak/insufficient) per axis. The mechanism that makes prediction honest rather than misleading. Should be designed before or alongside estimation logic.

5. **BGG "Fans Also Like" as Candidate Discovery** (Large) — Use BGG's taxonomy (families, mechanic clusters) as candidate discovery, scored by the user's personal axes. Inverts the question from "what would this game score?" to "what games score well on my axes?"

6. **Graceful Cold Start with Progressive Unlock** (Small) — Four-stage progression (0-5-15-30 games) with honest labeling at each stage. Turns prediction uncertainty into a call to action: "rate deck-building games to improve predictions in that category."

Each proposal includes vision alignment analysis (anti-goal check, principle alignment, tension resolution, constraint check). The interaction map shows how proposals relate to each other and to adjacent features (collection profiling, redundancy scoring, utility curves, tournament ranking).
