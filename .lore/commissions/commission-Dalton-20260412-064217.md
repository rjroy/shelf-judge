---
title: "Commission: Redundancy scoring: Phases 7-10 (Web UI)"
date: 2026-04-12
status: pending
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 7-10 of the redundancy scoring plan at `.lore/plans/redundancy-scoring.md`.\n\nRead the full plan first. You are implementing:\n\n- **Phase 7**: RedundancyPanel on game detail page (`packages/web/app/games/[id]/page.tsx`). Shows penalty, original/adjusted score, niche rank, neighbor list. Infer annotation vs integrated mode from data (compare `score.score` to `adjustment.originalScore`). Place above NichePositionPanel.\n\n- **Phase 8**: Collection list enhancements (`packages/web/app/collection/page.tsx`). Add \"Redundancy-Adjusted\" sort option. Add compact penalty badge on game rows with non-zero penalty. Style differs for annotation vs integrated mode.\n\n- **Phase 9**: Search preview redundancy section (`packages/web/app/search/page.tsx`). Show redundancy preview when `redundancyPreview` is non-null: adjusted score, penalty, top 3 similar games.\n\n- **Phase 10**: Settings panel on collection page. Collapsible \"Redundancy Settings\" section below filter/sort controls. Controls: enable/disable toggle, stage selector, similarity threshold slider, max penalty slider, three component weight sliders, min neighbors input, reset to defaults button. Debounce slider changes. Persist via PATCH.\n\nKey UX decisions from the plan:\n- Stage inference from data, not separate settings fetch\n- Settings panel on collection page (co-located with where user cares about redundancy)\n- User-friendly slider labels: \"Mechanics & Categories\", \"Weight & Player Count\", \"Your Personal Ratings\"\n- Annotation mode badges styled lighter/parenthesized vs integrated mode applied style\n\nRun `bun run test`, `bun run typecheck`, and `bun run lint` before declaring complete."
dependencies:
  - commission-Dalton-20260412-064203
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-12T13:42:17.282Z
    event: created
    reason: "Commission created"
current_progress: ""
projectName: shelf-judge
---
