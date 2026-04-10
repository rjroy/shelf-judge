---
title: "Commission: Fix: Clear Axis Value and Revert to BGG"
date: 2026-04-10
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Two bugs to fix from `.lore/issues/clear-value.md`:\n\n1. **Clearing an axis value on a game doesn't save.** When a user clears the value (sets it to empty/null), the cleared state should persist. Right now it seems like clearing in the UX doesn't actually get saved, so the old value reappears.\n\n2. **\"Revert to BGG\" button for BGG-derived axes doesn't work.** These buttons should reset the axis value back to the BGG-derived value.\n\n## Investigation approach\n\nStart by reading the relevant code to understand the data flow:\n- Web UI: how axis values are edited and submitted (look in the game detail page or wherever ratings are edited)\n- Daemon API: how axis value updates are received and persisted (look at the rating/scoring routes and services)\n- Shared types: what the schema says about nullable/optional axis values\n\nThe root cause is likely one of:\n- The UI doesn't send a null/undefined value when clearing (it might skip the field or send empty string)\n- The API/service layer treats null/undefined as \"no change\" instead of \"clear this value\"\n- The Zod schema rejects null values\n- The \"Revert to BGG\" button's click handler isn't wired up or sends the wrong payload\n\n## Requirements\n- Clearing an axis value must persist (the value should be removed/set to null)\n- \"Revert to BGG\" must reset to the BGG-derived value\n- Write tests covering both scenarios\n- Run full test suite, typecheck, and lint before declaring done\n- Update `.lore/issues/clear-value.md` status to `resolved` when complete"
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T13:12:08.617Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T13:12:08.620Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
