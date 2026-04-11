---
title: "Commission: Validate and plan utility curve loose threads"
date: 2026-04-11
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "The issue at `.lore/issues/utility-curve-loose-threads.md` lists five findings from the utility curves review cycle. The user added a note: \"I'm dubious of these claims. Validate before taking action.\"\n\nYour job is to validate each claim against the current codebase, then either prepare a plan or recommend closing the issue (or individual items) if they're not real problems.\n\nFor each of the five findings:\n\n1. **CurvePreview lacks numeric value readouts (REQ-CURVE-20)** — Read the CurvePreview component and the spec at `.lore/specs/utility-curves.md` (specifically REQ-CURVE-20). Does the spec actually require tooltips/hover interactions? Does the current implementation meet the spec as written?\n\n2. **Output clamping missing in `applyPreferenceCurve`** — Read the function in the daemon's curve engine. Can it actually return values outside 1-10? Check the math. Check if downstream consumers handle out-of-range values.\n\n3. **Veto + personal override scale mismatch** — Read how veto checks work when a user overrides a BGG axis. Is there actually a scale mismatch? The community stats fix (commission-Dalton-20260411-154717) extracted `resolveBggRawValue` to shared and may have changed this plumbing. Check the current state.\n\n4. **CLI `formatBreakdown` exact float comparison** — Read the CLI's formatBreakdown function. Compare with the web's approach. Is the `!==` actually causing spurious display?\n\n5. **`AxisSortAltScores` shows \"0.0\" for vetoed games** — Read the component. Does it check for veto? Is this still an issue?\n\nAfter validating, produce one of:\n- A plan at `.lore/plans/` covering confirmed issues, if any are real\n- An update to the issue file marking it resolved with findings, if none are real\n- A mix: resolve items that aren't real, plan items that are\n\nRead the actual code for each finding. Don't take the issue's claims at face value."
dependencies: []
linked_artifacts:
  - .lore/issues/utility-curve-loose-threads.md

activity_timeline:
  - timestamp: 2026-04-11T22:58:29.778Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T22:58:29.780Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-11T22:58:29.804Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-11T22:58:38.801Z
    event: progress_report
    reason: "Reading the issue file and beginning validation of all five claims against the codebase."
  - timestamp: 2026-04-11T22:59:13.900Z
    event: progress_report
    reason: "All five source locations read. Analyzing each claim now."
  - timestamp: 2026-04-11T23:00:24.590Z
    event: result_submitted
    reason: "Validated all five claims in the utility-curve-loose-threads issue against the codebase. Four of five are factually false (the code already handles the reported issues correctly), and the fifth is a debatable UX interpretation, not a bug. Marked the issue as resolved with detailed per-finding evidence.\n\n**Findings:**\n1. **CurvePreview readouts (REQ-CURVE-20):** Not a bug. The spec requires the user \"can see\" what ratings result from native values. The SVG preview with labeled axes provides this. The spec never mentions tooltips or hover interactions.\n2. **Output clamping:** False. Every branch in `applyPreferenceCurve` calls `clamp()` (Math.max(1, Math.min(10, value))).\n3. **Veto + override scale mismatch:** False. The fitness service resets `valueScale` to personal scale for overrides (line 72) and skips veto checks entirely for overrides (line 89).\n4. **CLI float comparison:** False. The CLI uses `Math.abs(...) > 0.05`, the same threshold approach the issue attributes only to the web.\n5. **AxisSortAltScores veto display:** False. The component explicitly checks `score.vetoed` and renders a \"V\" badge with hypothetical score.\n\nNo plan needed. Issue closed."
  - timestamp: 2026-04-11T23:00:27.924Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All five source locations read. Analyzing each claim now."
projectName: shelf-judge
---
Validated all five claims in the utility-curve-loose-threads issue against the codebase. Four of five are factually false (the code already handles the reported issues correctly), and the fifth is a debatable UX interpretation, not a bug. Marked the issue as resolved with detailed per-finding evidence.

**Findings:**
1. **CurvePreview readouts (REQ-CURVE-20):** Not a bug. The spec requires the user "can see" what ratings result from native values. The SVG preview with labeled axes provides this. The spec never mentions tooltips or hover interactions.
2. **Output clamping:** False. Every branch in `applyPreferenceCurve` calls `clamp()` (Math.max(1, Math.min(10, value))).
3. **Veto + override scale mismatch:** False. The fitness service resets `valueScale` to personal scale for overrides (line 72) and skips veto checks entirely for overrides (line 89).
4. **CLI float comparison:** False. The CLI uses `Math.abs(...) > 0.05`, the same threshold approach the issue attributes only to the web.
5. **AxisSortAltScores veto display:** False. The component explicitly checks `score.vetoed` and renders a "V" badge with hypothetical score.

No plan needed. Issue closed.
