---
title: "Commission: Brainstorm redundancy scoring approaches"
date: 2026-04-11
status: completed
tags: [commission]
worker: Celeste
workerDisplayTitle: "Guild Visionary"
prompt: "Brainstorm possible approaches for redundancy/collection-awareness scoring. The issue is at `.lore/issues/deferred-redundancy-scoring.md`.\n\nThe core idea: a game's fitness score should decrease if the collection already has strong coverage in that game's niche. Vision Principle 5 says \"the shelf has a carrying capacity.\"\n\nContext to read before brainstorming:\n- `.lore/vision.md` — especially Principle 5\n- `.lore/designs/mvp-fitness-model.md` — current fitness model (per-game, independent)\n- `.lore/specs/collection-profiling.md` — the profiling system already builds feature vectors from mechanics, categories, families, weight, player counts\n- `.lore/specs/prediction-engine.md` — the prediction engine already computes similarity between games\n- The daemon's existing scoring and profiling code\n\nThe profiling and prediction systems are already built. They include feature vectors and similarity computation. Redundancy scoring likely builds on that foundation rather than starting from scratch.\n\nExplore multiple approaches. Consider:\n- How existing profiling feature vectors and prediction similarity could be reused\n- Whether redundancy is a post-processing penalty on fitness or integrated into the score calculation\n- How to define \"coverage\" and \"niche\" using existing data\n- Whether redundancy should be per-game or per-cluster\n- Edge cases: what happens when a game is the best in its niche? When two games are equally redundant with each other?\n- How this interacts with utility curves and veto axes\n- User control: should redundancy sensitivity be configurable?\n\nOutput a brainstorm artifact to `.lore/` following the brainstorm skill conventions."
dependencies: []
linked_artifacts:
  - .lore/brainstorms/redundancy-scoring.md

activity_timeline:
  - timestamp: 2026-04-11T21:39:38.804Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T21:39:38.805Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-11T21:39:38.830Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-11T21:39:49.044Z
    event: progress_report
    reason: "Reading context: vision, fitness model, profiling spec, prediction spec, and the deferred issue."
  - timestamp: 2026-04-11T21:40:22.669Z
    event: progress_report
    reason: "Context loaded. Reading existing brainstorms to avoid duplicating proposals, then drafting the brainstorm artifact."
  - timestamp: 2026-04-11T21:40:56.019Z
    event: progress_report
    reason: "Full context loaded. Writing the brainstorm artifact with 6 proposals for redundancy/collection-awareness scoring."
  - timestamp: 2026-04-11T21:45:00.391Z
    event: result_submitted
    reason: "Brainstorm artifact written to `.lore/brainstorms/redundancy-scoring.md` with 6 proposals for redundancy/collection-awareness scoring:\n\n1. **Post-Score Redundancy Penalty via Pairwise Similarity** (Medium) - Compute cosine similarity between all scored games, penalize lower-ranked games within each niche. Most precise approach, leverages existing `cosineSimilarity` from `feature-vector.ts`.\n\n2. **Integrated Redundancy as a Virtual Axis** (Medium) - System-managed \"Uniqueness\" axis with niche-density-based ratings that participates in the standard weighted average. Elegant but conflates structural and qualitative dimensions.\n\n3. **Cluster-Then-Rank via Mechanic/Category Grouping** (Small-Medium) - Use existing profile BGG clustering to define niches, apply position-based discounts within clusters. Simpler to explain but loses the similarity gradient.\n\n4. **User-Defined Niche Boundaries via Similarity Threshold** (Small) - Configurable `RedundancySettings` (enabled toggle, similarity threshold, max penalty, component weights). Extension that applies to any scoring approach. Follows `PredictionSettings` pattern.\n\n5. **Niche Champion Display Without Score Modification** (Small) - Pure information: show niche membership and rank per game, no score changes. Safest starting point, aligned with \"data serves judgment.\"\n\n6. **Hybrid Approach with Graduated Engagement** (Medium-Large total, Small per stage) - Three-stage rollout: niche display → redundancy annotations (preview penalties without applying) → integrated scoring. User escalates deliberately.\n\nRecommended path: Start with Proposal 5/6-Stage-1 (zero-risk display), then ship Proposal 1 (pairwise penalty) behind a toggle (Proposal 4's settings). Pairwise similarity captures the gradient of overlap better than discrete clusters.\n\nAlso covers edge cases (best-in-niche, mutual redundancy, multi-niche games, vetoed games, predicted-only games) and interaction with profiling, prediction, tournament, and LLM narration systems."
  - timestamp: 2026-04-11T21:45:05.164Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Full context loaded. Writing the brainstorm artifact with 6 proposals for redundancy/collection-awareness scoring."
projectName: shelf-judge
---
Brainstorm artifact written to `.lore/brainstorms/redundancy-scoring.md` with 6 proposals for redundancy/collection-awareness scoring:

1. **Post-Score Redundancy Penalty via Pairwise Similarity** (Medium) - Compute cosine similarity between all scored games, penalize lower-ranked games within each niche. Most precise approach, leverages existing `cosineSimilarity` from `feature-vector.ts`.

2. **Integrated Redundancy as a Virtual Axis** (Medium) - System-managed "Uniqueness" axis with niche-density-based ratings that participates in the standard weighted average. Elegant but conflates structural and qualitative dimensions.

3. **Cluster-Then-Rank via Mechanic/Category Grouping** (Small-Medium) - Use existing profile BGG clustering to define niches, apply position-based discounts within clusters. Simpler to explain but loses the similarity gradient.

4. **User-Defined Niche Boundaries via Similarity Threshold** (Small) - Configurable `RedundancySettings` (enabled toggle, similarity threshold, max penalty, component weights). Extension that applies to any scoring approach. Follows `PredictionSettings` pattern.

5. **Niche Champion Display Without Score Modification** (Small) - Pure information: show niche membership and rank per game, no score changes. Safest starting point, aligned with "data serves judgment."

6. **Hybrid Approach with Graduated Engagement** (Medium-Large total, Small per stage) - Three-stage rollout: niche display → redundancy annotations (preview penalties without applying) → integrated scoring. User escalates deliberately.

Recommended path: Start with Proposal 5/6-Stage-1 (zero-risk display), then ship Proposal 1 (pairwise penalty) behind a toggle (Proposal 4's settings). Pairwise similarity captures the gradient of overlap better than discrete clusters.

Also covers edge cases (best-in-niche, mutual redundancy, multi-niche games, vetoed games, predicted-only games) and interaction with profiling, prediction, tournament, and LLM narration systems.
