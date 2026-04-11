---
title: "Commission: Execute color system migration per consolidation notes"
date: 2026-04-11
status: pending
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Execute the color system migration defined in `.lore/notes/color-system-consolidation.md`. The spec is at `.lore/designs/shelf-judge-color-system.md`. The previous commission produced the plan but left most of the checklist unchecked. Your job is to complete the actual work.\n\nFollow the procedure in the notes file exactly:\n\n1. **Replace the `:root` color section** of `packages/web/app/globals.css` with the canonical block from the spec (the CSS block in the \"The canonical `:root` block\" section of `.lore/designs/shelf-judge-color-system.md`). Non-color tokens (typography, spacing) stay as-is.\n\n2. **Repair every `color-mix(in rgb, ...)` occurrence** throughout `globals.css` (not just `:root`, also selectors). Change `in rgb` to `in srgb` and fix the percentage placement. Verify with bash: `grep -n 'color-mix(in rgb,' packages/web/app/globals.css` must return zero matches.\n\n3. **Run the hex-in-components enforcement grep** from the spec's Enforcement section:\n```bash\ngrep -rn '#[0-9a-fA-F]\\{3,6\\}' packages/web --include='*.tsx' --include='*.ts' --include='*.css' --exclude='globals.css'\n```\nFix each match by using an existing token or adding a new one (update both globals.css and the spec).\n\n4. **Verification:**\n   - `bun run typecheck` must pass\n   - `bun run lint` must pass  \n   - `bun run test` must pass\n   - Both enforcement greps must return zero matches\n\n5. **After completion:** Update the status checklist in `.lore/notes/color-system-consolidation.md` to reflect what you completed. If all items are done, delete the notes file as the procedure instructs."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-11T17:08:44.208Z
    event: created
    reason: "Commission created"
current_progress: ""
projectName: shelf-judge
---
