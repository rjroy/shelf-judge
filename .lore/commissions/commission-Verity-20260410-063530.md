---
title: "Commission: Research: Outlier Distance Metric for Collection Profiling"
date: 2026-04-10
status: dispatched
tags: [commission]
worker: Verity
workerDisplayTitle: "Guild Pathfinder"
prompt: "Research the best distance metric for detecting outlier games in a board game collection profile.\n\n**Context:** Shelf Judge computes a statistical profile of the user's board game collection. One component is outlier detection: games that don't fit the collection's statistical identity. The spec at `.lore/specs/collection-profiling.md` (Open Question #2) frames the problem:\n\n> \"The brainstorm specifies 'multi-dimensional distance from collection centroid' but doesn't name the metric. Euclidean distance over normalized attribute vectors is the obvious choice, but cosine similarity may better capture 'doesn't fit' for sparse categorical data (mechanics, categories). The implementer should evaluate both against the 200-game dataset and choose the one that produces more intuitive results.\"\n\nThe user says this needs separate design research.\n\n**The feature vectors** are composed of:\n- BGG mechanics (binary flags, ~200 possible, typical game has 3-8)\n- BGG categories (binary flags, ~80 possible, typical game has 1-4)\n- BGG weight (continuous, 1-5 scale)\n- Community rating (continuous, 1-10 scale)\n- Player count range (min/max tuple)\n- Personal axis ratings (continuous, 1-10 scale, sparse: not every game is rated on every axis)\n\nThe vectors are high-dimensional and sparse (most mechanics/category flags are 0).\n\n**Research questions:**\n1. What distance/similarity metrics work well for mixed feature vectors (binary categorical flags + continuous values)?\n2. Euclidean vs. cosine vs. alternatives (Gower distance, Jaccard for the binary portion, Mahalanobis) for this specific data shape?\n3. How should the binary (mechanics/categories) and continuous (weight, rating, player count) components be combined? Separate metrics composed, or unified after normalization?\n4. What outlier detection approaches work well for small datasets (100-400 items) with high-dimensional sparse features? Simple centroid distance, or something like Local Outlier Factor, Isolation Forest, etc.?\n5. Does the literature on board game recommendation systems (BGG-adjacent) offer precedent?\n\n**Deliverable:** Write a research artifact to `.lore/research/outlier-distance-metric.md` summarizing findings with concrete recommendations for this use case. Include tradeoffs, not just a single answer. The design decision will be made separately based on this research."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T13:35:30.324Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T13:35:30.327Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
