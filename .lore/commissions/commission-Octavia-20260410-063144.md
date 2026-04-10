---
title: "Commission: File Issues from Commission Cleanup Retro"
date: 2026-04-10
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Read `.lore/retros/commission-cleanup-2026-04-10.md` and file separate issues from the following sections. Use the `/lore-development:file-issue` skill for each one.\n\n**File these issues:**\n\n1. **One issue for \"Untracked from filter/sort\"** (lines 22-24): Deferred filter types from the filter/sort spec have no issues filed. 8 filter types exist only in the spec with no backlog visibility.\n\n2. **One issue for \"Untracked from utility curves\"** (lines 26-37): This is a single issue covering all the items in that section:\n   - CurvePreview lacks numeric value readouts (REQ-CURVE-20)\n   - Output clamping missing in `applyPreferenceCurve`\n   - Veto + personal override scale mismatch\n   - CLI `formatBreakdown` exact float comparison\n   - `AxisSortAltScores` shows \"0.0\" for vetoed games\n\n3. **Separate issues for each structural concern** (lines 39-44), three total:\n   - `curve-math.ts` duplicated between web and daemon\n   - `axes/page.tsx` has a local `Axis` type\n   - ESLint `disableTypeChecked` for web test files\n\nThat's 5 issues total. Leave the \"Pre-existing, still open\", \"Brainstorm-only decisions\", \"Infrastructure Issues\", and \"Lessons\" sections alone. Do not file issues for those."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T13:31:44.697Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T13:31:44.699Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
