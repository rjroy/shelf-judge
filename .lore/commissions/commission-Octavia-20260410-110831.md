---
title: "Commission: Plan: Prediction Engine"
date: 2026-04-10
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write an implementation plan from the spec at `.lore/specs/prediction-engine.md`.\n\nUse the `/lore-development:prep-plan` skill. Follow the project's existing plan conventions (see `.lore/plans/utility-curves.md` and `.lore/plans/collection-filter-sort.md` for reference).\n\nKey context:\n- The core is k-NN estimation for personal axes with cosine similarity over feature vectors (mechanics binary flags, categories binary flags, BGG weight, community rating, player count range).\n- Extensions: tournament ELO as prediction prior, confidence architecture with explicit uncertainty levels, cold start progressive unlock (deprioritized).\n- The feature vector module should be structured for reuse by the collection profiling feature (they share the same similarity computations). See `.lore/specs/collection-profiling.md` for what profiling needs.\n- The brainstorm at `.lore/brainstorms/prediction-engine.md` has the full accepted/rejected context.\n- The outlier distance metric research at `.lore/research/outlier-distance-metric.md` is relevant for the shared feature vector design (profiling uses a composite metric with Jaccard for binary + normalized Manhattan for continuous, while prediction uses cosine similarity, but the underlying feature vectors are the same).\n\nRead the spec thoroughly, then break into phased steps with clear boundaries, test expectations, and review gates. Consider the daemon-first architecture and that web and CLI are both clients."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T18:08:31.690Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T18:08:31.692Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
