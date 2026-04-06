---
title: "Commission: Fix: Generate Missing Favicons"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Resolve the issue documented in `.lore/issues/missing-favicons.md`.\n\nThe source icon exists at `.lore/art/icon.webp` (512x512). Generate the following from it and place them in `packages/web/public/`:\n\n- `favicon-32.png` (32x32)\n- `favicon-16.png` (16x16)\n- `apple-touch-icon.png` (180x180)\n\nUse whatever image tooling is available in the Bun/Node ecosystem (sharp, or a shell tool like ImageMagick if installed). If neither is available, check what's on the system.\n\nThen update the Next.js metadata in `packages/web/app/layout.tsx` to reference all three in the `icons` config so browsers pick them up correctly.\n\nRun `bun run typecheck` and `bun run lint` when done. Update the issue status to `resolved` in `.lore/issues/missing-favicons.md`."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T15:30:52.691Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T15:30:52.693Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
