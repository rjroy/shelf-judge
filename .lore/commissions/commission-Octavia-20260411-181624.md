---
title: "Commission: Spec out redundancy scoring penalty (Proposal 1 behind toggle)"
date: 2026-04-12
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Use the `/lore-development:specify` skill to write a spec for the redundancy scoring penalty feature, based on Proposal 1 from `.lore/brainstorms/redundancy-scoring.md`, behind a user toggle from Proposal 4.\n\nRead the full brainstorm first (Proposals 1, 4, 6, Edge Cases, and Interaction Map). Also read the niche champion display spec at `.lore/specs/niche-champion-display.md`, since that's Proposal 5 (Stage 1) and this builds on top of it as Stage 2/3 of the graduated approach (Proposal 6).\n\nKey elements to spec:\n\n**Core mechanism (Proposal 1):**\n- Post-score redundancy penalty via pairwise cosine similarity\n- For each game: find niche neighbors above similarity threshold, count how many outscore it, apply proportional penalty\n- Best game in niche gets zero penalty\n- Penalty transparent in score breakdown: original score, penalty amount, niche neighbors, niche rank\n\n**User toggle and settings (Proposal 4):**\n- `RedundancySettings` persisted to `redundancy-settings.json`\n- Master `enabled` toggle (defaults OFF, simplicity wins)\n- Configurable: similarity threshold, max penalty, component weights, min cluster size\n- Settings API following the `PredictionSettings` pattern\n\n**Graduated engagement (Proposal 6 Stages 2-3):**\n- Stage 2 (annotation mode): shows \"what if\" penalty without modifying primary score. Collection sortable by redundancy-adjusted fitness. Primary score unchanged.\n- Stage 3 (integrated mode): penalty applied to primary fitness score. Original score visible in breakdown.\n- User explicitly escalates between stages via settings\n\n**Relationship to niche champion display:**\n- Niche champion display (already specced) is Stage 1 — pure information, no score modification\n- This spec covers Stages 2 and 3 — the penalty layer on top\n- Must not duplicate niche champion display's scope; reference it and build on its types/engine\n\n**Edge cases from the brainstorm:**\n- Mutual redundancy (near-tied games both penalized similarly)\n- Games in many niches (penalty based on all pairwise similarities)\n- Vetoed games excluded as niche neighbors\n- Predicted-only games: lower authority as niche references\n- Interaction with utility curves and veto axes (orthogonal, compose independently)\n\n**FitnessResult extension:**\n- New nullable `redundancyAdjustment` field with penalty, originalScore, nicheNeighbors, nicheRank, nicheSize\n\nOutput the spec to `.lore/specs/`."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T01:16:24.911Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T01:16:24.913Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
