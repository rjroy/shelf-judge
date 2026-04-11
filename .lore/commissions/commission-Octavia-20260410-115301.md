---
title: "Commission: Update Plan: Prediction Engine with Mockup Reference"
date: 2026-04-10
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Update the plan at `.lore/plans/prediction-engine.md` to incorporate the mockup at `.lore/mockups/prediction-engine.html`.\n\nRead the mockup to understand the visual layout decisions Sienna made. Then update the plan's UI/frontend phases to reference the mockup as the design target. Add the mockup to the plan's related artifacts. Where the mockup makes layout or component decisions that the plan left open, incorporate those decisions into the relevant implementation steps.\n\nDon't rewrite the plan from scratch. This is a targeted update to connect the mockup to the existing plan."
dependencies: []
linked_artifacts:
  - .lore/plans/prediction-engine.md

activity_timeline:
  - timestamp: 2026-04-10T18:53:01.372Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T18:53:01.374Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T18:53:01.397Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T18:53:16.822Z
    event: progress_report
    reason: "Reading the plan and mockup. Both are large files, reading in chunks."
  - timestamp: 2026-04-10T18:53:48.948Z
    event: progress_report
    reason: "Finished reading both artifacts in full. Now synthesizing the mockup's layout decisions into targeted plan updates for Phase 5 (Web UI)."
  - timestamp: 2026-04-10T18:56:27.752Z
    event: result_submitted
    reason: "Updated `.lore/plans/prediction-engine.md` to incorporate the mockup at `.lore/mockups/prediction-engine.html`. Three areas of change:\n\n1. **Frontmatter**: Added mockup to `related:` artifacts list.\n\n2. **Key Files section**: Updated the Web file list to include the new readiness page (`app/readiness/page.tsx`), sidebar readiness widget, `globals.css` design tokens, and noted the mockup as the layout reference.\n\n3. **Phase 5 (Web UI)**: Replaced the original open-ended descriptions with concrete layout decisions from the mockup across all five mockup sections:\n   - **Game detail** (Sections 1-3): Teal-vs-amber color distinction for predicted scores, tilde prefix, \"PREDICTED\" pill badge, teal row backgrounds in breakdown table, expandable confidence breakdown panels with reference game lists and weighted average formula, tension panel placement below breakdown table with side-by-side signal cards, rating form prediction hints with dashed borders.\n   - **Collection list** (Section 4): \"Predictions on\" toggle in stats strip, new Confidence column with per-row badges, predicted row teal wash, \"not rated\" labels, sort column header treatment.\n   - **Sidebar readiness widget**: Persistent widget on all pages showing stage name, progress bar, and games-to-next-stage count.\n   - **Readiness page** (Section 5): New route at `/readiness` with stage banner, 4-stage timeline grid, weak axes cards (coverage per axis + underrepresented mechanic clusters), and suggested actions list.\n   - **CSS tokens**: Documented the full set of design tokens (`--predict-*`, `--conf-*`, `--tourney-*`) and component classes from the mockup.\n   - **Responsive**: Added breakpoint behavior (800px mobile, 800-1100px tablet) from the mockup.\n   - **Component extraction**: Updated risk note #5 with concrete sub-component recommendations based on the mockup's five surfaces.\n\nNo changes to Phases 1-4, 6, or 7. The plan's structure and non-UI content are preserved."
  - timestamp: 2026-04-10T18:56:31.404Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Finished reading both artifacts in full. Now synthesizing the mockup's layout decisions into targeted plan updates for Phase 5 (Web UI)."
projectName: shelf-judge
---
Updated `.lore/plans/prediction-engine.md` to incorporate the mockup at `.lore/mockups/prediction-engine.html`. Three areas of change:

1. **Frontmatter**: Added mockup to `related:` artifacts list.

2. **Key Files section**: Updated the Web file list to include the new readiness page (`app/readiness/page.tsx`), sidebar readiness widget, `globals.css` design tokens, and noted the mockup as the layout reference.

3. **Phase 5 (Web UI)**: Replaced the original open-ended descriptions with concrete layout decisions from the mockup across all five mockup sections:
   - **Game detail** (Sections 1-3): Teal-vs-amber color distinction for predicted scores, tilde prefix, "PREDICTED" pill badge, teal row backgrounds in breakdown table, expandable confidence breakdown panels with reference game lists and weighted average formula, tension panel placement below breakdown table with side-by-side signal cards, rating form prediction hints with dashed borders.
   - **Collection list** (Section 4): "Predictions on" toggle in stats strip, new Confidence column with per-row badges, predicted row teal wash, "not rated" labels, sort column header treatment.
   - **Sidebar readiness widget**: Persistent widget on all pages showing stage name, progress bar, and games-to-next-stage count.
   - **Readiness page** (Section 5): New route at `/readiness` with stage banner, 4-stage timeline grid, weak axes cards (coverage per axis + underrepresented mechanic clusters), and suggested actions list.
   - **CSS tokens**: Documented the full set of design tokens (`--predict-*`, `--conf-*`, `--tourney-*`) and component classes from the mockup.
   - **Responsive**: Added breakpoint behavior (800px mobile, 800-1100px tablet) from the mockup.
   - **Component extraction**: Updated risk note #5 with concrete sub-component recommendations based on the mockup's five surfaces.

No changes to Phases 1-4, 6, or 7. The plan's structure and non-UI content are preserved.
