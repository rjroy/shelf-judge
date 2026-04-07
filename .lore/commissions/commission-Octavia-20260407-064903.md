---
title: "Commission: Revise Brainstorm: Collection Filter/Sort with User Feedback"
date: 2026-04-07
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Revise `.lore/brainstorms/collection-filter-sort.md` to incorporate the user's inline responses (marked with `USER RESPONSE:` and `USER GENERAL RESPONSE` sections). Don't just append or annotate. Rewrite the entire document so the user's decisions are integrated into the body text as settled conclusions, not as separate callouts.\n\nKey user decisions to weave in:\n\n1. **Client-side only.** No daemon API filtering. This is decided, not a recommendation.\n2. **Score column shows sort value.** Selecting a sort value signals what the user cares about. The score column changes to display the active sort metric. If sorting alphabetically, show fitness score as a special case.\n3. **Rated/unrated split = \"has sort value / doesn't have sort value.\"** When sorting by min player count and a game has no player count, it falls into the \"no sort value\" group. This generalizes the current rated/unrated visual split.\n4. **localStorage for filter AND sort persistence.** Remember sort selection and filter state across sessions.\n5. **Replace the tournament toggle** with a proper sort dropdown. Remember the selection via localStorage.\n6. **Column headers clickable where they map to a single sort field.** Score column reflects whatever is selected (fitness or tournament). Sort dropdown covers fields without their own column.\n7. **Mobile: replace the existing toggle with the sort dropdown.** No slide-out panel needed.\n8. **No OR filter logic.** AND only.\n9. **Axis-specific sorting is interesting to the user.** Promote this from \"maybe later\" to \"include in the design.\" The user explicitly wants to sort by a specific axis.\n\nRemove all `USER RESPONSE:` annotations and the `USER GENERAL RESPONSE` section. The revised document should read as a clean brainstorm with decisions already incorporated. Update the \"Open Questions\" section to remove questions that are now answered, keeping only genuinely open items. Update \"Next Steps\" to reflect the settled decisions.\n\nDo NOT change the frontmatter status. Keep it as `open`."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-07T13:49:03.448Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T13:49:22.065Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
