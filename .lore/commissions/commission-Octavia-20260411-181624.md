---
title: "Commission: Spec out redundancy scoring penalty (Proposal 1 behind toggle)"
date: 2026-04-12
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Use the `/lore-development:specify` skill to write a spec for the redundancy scoring penalty feature, based on Proposal 1 from `.lore/brainstorms/redundancy-scoring.md`, behind a user toggle from Proposal 4.\n\nRead the full brainstorm first (Proposals 1, 4, 6, Edge Cases, and Interaction Map). Also read the niche champion display spec at `.lore/specs/niche-champion-display.md`, since that's Proposal 5 (Stage 1) and this builds on top of it as Stage 2/3 of the graduated approach (Proposal 6).\n\nKey elements to spec:\n\n**Core mechanism (Proposal 1):**\n- Post-score redundancy penalty via pairwise cosine similarity\n- For each game: find niche neighbors above similarity threshold, count how many outscore it, apply proportional penalty\n- Best game in niche gets zero penalty\n- Penalty transparent in score breakdown: original score, penalty amount, niche neighbors, niche rank\n\n**User toggle and settings (Proposal 4):**\n- `RedundancySettings` persisted to `redundancy-settings.json`\n- Master `enabled` toggle (defaults OFF, simplicity wins)\n- Configurable: similarity threshold, max penalty, component weights, min cluster size\n- Settings API following the `PredictionSettings` pattern\n\n**Graduated engagement (Proposal 6 Stages 2-3):**\n- Stage 2 (annotation mode): shows \"what if\" penalty without modifying primary score. Collection sortable by redundancy-adjusted fitness. Primary score unchanged.\n- Stage 3 (integrated mode): penalty applied to primary fitness score. Original score visible in breakdown.\n- User explicitly escalates between stages via settings\n\n**Relationship to niche champion display:**\n- Niche champion display (already specced) is Stage 1 — pure information, no score modification\n- This spec covers Stages 2 and 3 — the penalty layer on top\n- Must not duplicate niche champion display's scope; reference it and build on its types/engine\n\n**Edge cases from the brainstorm:**\n- Mutual redundancy (near-tied games both penalized similarly)\n- Games in many niches (penalty based on all pairwise similarities)\n- Vetoed games excluded as niche neighbors\n- Predicted-only games: lower authority as niche references\n- Interaction with utility curves and veto axes (orthogonal, compose independently)\n\n**FitnessResult extension:**\n- New nullable `redundancyAdjustment` field with penalty, originalScore, nicheNeighbors, nicheRank, nicheSize\n\nOutput the spec to `.lore/specs/`."
dependencies: []
linked_artifacts:
  - .lore/specs/redundancy-scoring.md

activity_timeline:
  - timestamp: 2026-04-12T01:16:24.911Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T01:16:24.913Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T01:16:24.937Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T01:16:31.054Z
    event: progress_report
    reason: "Reading brainstorm and related specs before writing the redundancy scoring spec."
  - timestamp: 2026-04-12T01:17:44.346Z
    event: progress_report
    reason: "Context gathered. Read brainstorm (all 6 proposals, edge cases, interaction map), niche champion display spec, existing types (FitnessResult, PredictionSettings, GameWithScore, NichePosition, ComponentWeights), daemon service patterns (storage, routes, settings API), and spec-writing compendium entry. Now invoking the specify skill to write the spec."
  - timestamp: 2026-04-12T01:21:22.348Z
    event: result_submitted
    reason: "Wrote the redundancy scoring penalty spec at `.lore/specs/redundancy-scoring.md`.\n\nThe spec covers 41 requirements (REQ-REDUN-1 through REQ-REDUN-41) across these sections:\n\n**Redundancy Settings (REQ-REDUN-1 through 5):** `RedundancySettings` type with master toggle (defaults OFF), stage selector (annotation/integrated), similarity threshold, max penalty, component weights, and min neighbors. Persisted to `redundancy-settings.json` following the `PredictionSettings` pattern. GET/PATCH API at `/redundancy/settings`.\n\n**Redundancy Engine (REQ-REDUN-6 through 13):** Pure-function module at `redundancy-engine.ts`. Pairwise cosine similarity on flattened feature vectors. For each game: find neighbors above threshold, count how many outscore it, apply proportional penalty (`coverageRatio * maxPenalty`). Best game in niche gets zero penalty. Handles edge cases: mutual redundancy (tied games don't penalize each other), vetoed games excluded, predicted-only games carry reduced authority as niche references.\n\n**Data Model (REQ-REDUN-14 through 16):** `RedundancyAdjustment` type with penalty, originalScore, adjustedScore, nicheNeighbors, nicheRank, nicheSize. Added as nullable field on `FitnessResult`.\n\n**Stage 2 - Annotation Mode (REQ-REDUN-17 through 18):** Shows what-if penalty without modifying primary score. `FitnessResult.score` unchanged; adjustment is advisory.\n\n**Stage 3 - Integrated Mode (REQ-REDUN-19 through 21):** Penalty applied to `FitnessResult.score`. Post-processing step after all other fitness computations. Single-game requests require computing all scores for pairwise comparison.\n\n**Interactions (REQ-REDUN-22 through 27):** Prediction preview gains `redundancyPreview`. Niche champion display unchanged and independent. Utility curves and veto compose independently.\n\n**API, Web UI, CLI (REQ-REDUN-28 through 41):** Full daemon API surface, game detail redundancy section, collection sort by adjusted fitness, search preview, CLI subcommands, settings panel.\n\nKey design decisions documented: pairwise over cluster-based (captures gradient), `NichePosition` uses pre-redundancy scores to avoid circular dependency, `getGame()` must compute all scores (known cost of collection-aware scoring), enabled defaults to false (simplicity wins)."
  - timestamp: 2026-04-12T01:21:27.116Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Context gathered. Read brainstorm (all 6 proposals, edge cases, interaction map), niche champion display spec, existing types (FitnessResult, PredictionSettings, GameWithScore, NichePosition, ComponentWeights), daemon service patterns (storage, routes, settings API), and spec-writing compendium entry. Now invoking the specify skill to write the spec."
projectName: shelf-judge
---
Wrote the redundancy scoring penalty spec at `.lore/specs/redundancy-scoring.md`.

The spec covers 41 requirements (REQ-REDUN-1 through REQ-REDUN-41) across these sections:

**Redundancy Settings (REQ-REDUN-1 through 5):** `RedundancySettings` type with master toggle (defaults OFF), stage selector (annotation/integrated), similarity threshold, max penalty, component weights, and min neighbors. Persisted to `redundancy-settings.json` following the `PredictionSettings` pattern. GET/PATCH API at `/redundancy/settings`.

**Redundancy Engine (REQ-REDUN-6 through 13):** Pure-function module at `redundancy-engine.ts`. Pairwise cosine similarity on flattened feature vectors. For each game: find neighbors above threshold, count how many outscore it, apply proportional penalty (`coverageRatio * maxPenalty`). Best game in niche gets zero penalty. Handles edge cases: mutual redundancy (tied games don't penalize each other), vetoed games excluded, predicted-only games carry reduced authority as niche references.

**Data Model (REQ-REDUN-14 through 16):** `RedundancyAdjustment` type with penalty, originalScore, adjustedScore, nicheNeighbors, nicheRank, nicheSize. Added as nullable field on `FitnessResult`.

**Stage 2 - Annotation Mode (REQ-REDUN-17 through 18):** Shows what-if penalty without modifying primary score. `FitnessResult.score` unchanged; adjustment is advisory.

**Stage 3 - Integrated Mode (REQ-REDUN-19 through 21):** Penalty applied to `FitnessResult.score`. Post-processing step after all other fitness computations. Single-game requests require computing all scores for pairwise comparison.

**Interactions (REQ-REDUN-22 through 27):** Prediction preview gains `redundancyPreview`. Niche champion display unchanged and independent. Utility curves and veto compose independently.

**API, Web UI, CLI (REQ-REDUN-28 through 41):** Full daemon API surface, game detail redundancy section, collection sort by adjusted fitness, search preview, CLI subcommands, settings panel.

Key design decisions documented: pairwise over cluster-based (captures gradient), `NichePosition` uses pre-redundancy scores to avoid circular dependency, `getGame()` must compute all scores (known cost of collection-aware scoring), enabled defaults to false (simplicity wins).
