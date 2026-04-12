---
title: "Commission: Fix: Redundancy scoring P1-4 review findings"
date: 2026-04-12
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Read Thorne's review of redundancy scoring Phases 1-4. The review commission is `commission-Thorne-20260412-064133`. Check `.lore/commissions/` for the review artifact.\n\nAddress ALL findings before doing anything else. The plan is at `.lore/plans/redundancy-scoring.md` and the spec at `.lore/specs/redundancy-scoring.md` for reference.\n\nRun `bun run test`, `bun run typecheck`, and `bun run lint` after all fixes."
dependencies:
  - commission-Thorne-20260412-064133
linked_artifacts:
  - packages/daemon/src/services/redundancy-engine.ts

  - packages/daemon/src/routes/redundancy.ts
  - packages/daemon/tests/redundancy-engine.test.ts
  - packages/daemon/src/routes/redundancy.ts
  - packages/daemon/tests/redundancy-engine.test.ts
activity_timeline:
  - timestamp: 2026-04-12T13:41:39.338Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T13:45:52.838Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T13:59:19.905Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T13:59:19.909Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T13:59:19.933Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T13:59:45.130Z
    event: progress_report
    reason: "Read Thorne's review. 8 findings to address: 2 defects (callback signature, adjustedScore rounding), 3 concerns (NaN in weights, NaN in cosine, nicheRank vs predicted authority), 2 gaps (missing test cases), 1 observation (dead pre-merge validation code, flattenWeighted edge case). Reading implementation files now."
  - timestamp: 2026-04-12T14:03:35.793Z
    event: progress_report
    reason: "All 8 Thorne findings addressed. Fixed: callback signature (Game not GameWithScore), adjustedScore rounding (2 decimal places), NaN guards for zero-sum weights and zero-magnitude vectors, nicheRank aligned with predicted authority, flattenWeighted null personalAxes fallback, dead pre-merge validation removed. Added 5 new tests (3 tied games, 3/5 proportional, zero-sum weights, zero-magnitude vectors, nicheRank predicted authority). Full suite: 972 pass, typecheck clean, lint clean."
  - timestamp: 2026-04-12T14:03:51.395Z
    event: result_submitted
    reason: "Addressed all 8 findings from Thorne's review of redundancy scoring Phases 1-4.\n\n**Defects fixed:**\n1. Engine callback signature aligned with spec REQ-REDUN-7: `(game: Game) => FeatureVector` instead of `(game: GameWithScore) => FeatureVector`. Call site updated to pass `gws.game`.\n2. `adjustedScore` rounding changed from 1 decimal to 2 decimal places, matching penalty precision and spec intent.\n\n**Concerns resolved:**\n3. Zero-sum componentWeights guard: engine returns empty map instead of producing NaN.\n4. Zero-magnitude vector guard: `cosineSimilarity` NaN result explicitly mapped to 0.\n5. `nicheRank` now uses `betterCount + 1` (same predicted authority filter as penalty), so rank and penalty agree.\n\n**Observations addressed:**\n7. `flattenWeighted` with null `personalAxes` and `includePersonalAxes=true` now falls back to `includePersonalAxes=false`, preventing weight underweighting. Test updated to verify equivalence.\n8. Removed dead pre-merge `componentWeights` sum check (lines 59-66 of redundancy.ts). Post-merge check at line 131 is the actual enforcement.\n\n**Missing tests added (Finding 6):**\n- 3 games with identical scores: all get zero penalty\n- 5 neighbors where 3 score higher: penalty = (3/5) * maxPenalty = 1.2\n- Zero-sum weights returns empty map\n- Zero-magnitude vectors produce no NaN\n- nicheRank respects predicted authority\n\nTest count: 22 engine tests (up from 17), 20 route tests. Full suite: 972 pass, 0 fail. Typecheck and lint clean."
  - timestamp: 2026-04-12T14:03:54.687Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All 8 Thorne findings addressed. Fixed: callback signature (Game not GameWithScore), adjustedScore rounding (2 decimal places), NaN guards for zero-sum weights and zero-magnitude vectors, nicheRank aligned with predicted authority, flattenWeighted null personalAxes fallback, dead pre-merge validation removed. Added 5 new tests (3 tied games, 3/5 proportional, zero-sum weights, zero-magnitude vectors, nicheRank predicted authority). Full suite: 972 pass, typecheck clean, lint clean."
projectName: shelf-judge
---
Addressed all 8 findings from Thorne's review of redundancy scoring Phases 1-4.

**Defects fixed:**
1. Engine callback signature aligned with spec REQ-REDUN-7: `(game: Game) => FeatureVector` instead of `(game: GameWithScore) => FeatureVector`. Call site updated to pass `gws.game`.
2. `adjustedScore` rounding changed from 1 decimal to 2 decimal places, matching penalty precision and spec intent.

**Concerns resolved:**
3. Zero-sum componentWeights guard: engine returns empty map instead of producing NaN.
4. Zero-magnitude vector guard: `cosineSimilarity` NaN result explicitly mapped to 0.
5. `nicheRank` now uses `betterCount + 1` (same predicted authority filter as penalty), so rank and penalty agree.

**Observations addressed:**
7. `flattenWeighted` with null `personalAxes` and `includePersonalAxes=true` now falls back to `includePersonalAxes=false`, preventing weight underweighting. Test updated to verify equivalence.
8. Removed dead pre-merge `componentWeights` sum check (lines 59-66 of redundancy.ts). Post-merge check at line 131 is the actual enforcement.

**Missing tests added (Finding 6):**
- 3 games with identical scores: all get zero penalty
- 5 neighbors where 3 score higher: penalty = (3/5) * maxPenalty = 1.2
- Zero-sum weights returns empty map
- Zero-magnitude vectors produce no NaN
- nicheRank respects predicted authority

Test count: 22 engine tests (up from 17), 20 route tests. Full suite: 972 pass, 0 fail. Typecheck and lint clean.
