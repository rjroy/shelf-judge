---
title: "Commission: Validate and plan utility curve loose threads"
date: 2026-04-11
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "The issue at `.lore/issues/utility-curve-loose-threads.md` lists five findings from the utility curves review cycle. The user added a note: \"I'm dubious of these claims. Validate before taking action.\"\n\nYour job is to validate each claim against the current codebase, then either prepare a plan or recommend closing the issue (or individual items) if they're not real problems.\n\nFor each of the five findings:\n\n1. **CurvePreview lacks numeric value readouts (REQ-CURVE-20)** — Read the CurvePreview component and the spec at `.lore/specs/utility-curves.md` (specifically REQ-CURVE-20). Does the spec actually require tooltips/hover interactions? Does the current implementation meet the spec as written?\n\n2. **Output clamping missing in `applyPreferenceCurve`** — Read the function in the daemon's curve engine. Can it actually return values outside 1-10? Check the math. Check if downstream consumers handle out-of-range values.\n\n3. **Veto + personal override scale mismatch** — Read how veto checks work when a user overrides a BGG axis. Is there actually a scale mismatch? The community stats fix (commission-Dalton-20260411-154717) extracted `resolveBggRawValue` to shared and may have changed this plumbing. Check the current state.\n\n4. **CLI `formatBreakdown` exact float comparison** — Read the CLI's formatBreakdown function. Compare with the web's approach. Is the `!==` actually causing spurious display?\n\n5. **`AxisSortAltScores` shows \"0.0\" for vetoed games** — Read the component. Does it check for veto? Is this still an issue?\n\nAfter validating, produce one of:\n- A plan at `.lore/plans/` covering confirmed issues, if any are real\n- An update to the issue file marking it resolved with findings, if none are real\n- A mix: resolve items that aren't real, plan items that are\n\nRead the actual code for each finding. Don't take the issue's claims at face value."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-11T22:58:29.778Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T22:58:29.780Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
