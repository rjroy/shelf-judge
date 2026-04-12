---
title: "Commission: Review: Redundancy scoring Phases 5-6"
date: 2026-04-12
status: pending
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the redundancy scoring route integration (Phases 5-6) against the plan at `.lore/plans/redundancy-scoring.md` and spec at `.lore/specs/redundancy-scoring.md`.\n\nThis is the highest-risk phase. Check:\n1. All THREE route handlers updated: GET /games, GET /games/:id, GET /predictions/bgg/:bggId\n2. Computation order in each handler: scores → niches (pre-redundancy) → redundancy (REQ-REDUN-26)\n3. In integrated mode, `score.score` updated to `adjustedScore` AFTER niche computation\n4. In annotation mode, `score.score` unchanged, `redundancyAdjustment` populated\n5. Prediction route creates temporary GameWithScore for candidate and runs full pass (REQ-REDUN-22)\n6. Pre-redundancy scores used for existing games in prediction preview (REQ-REDUN-23)\n7. `PredictedGameResponse` has `redundancyPreview` field (REQ-REDUN-22)\n8. Feature vector caching per-request (Open Question 1)\n9. `getFeatureVector` callback built correctly (vocabulary, ranges, axes from collection)\n10. Web helpers in api.ts match the route paths\n11. Type re-exports updated\n12. Integration tests cover annotation mode, integrated mode, disabled mode, prediction preview\n\nReport ALL findings."
dependencies:
  - commission-Dalton-20260412-064151
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T13:41:59.277Z
    event: created
    reason: "Commission created"
current_progress: ""
projectName: shelf-judge
---
