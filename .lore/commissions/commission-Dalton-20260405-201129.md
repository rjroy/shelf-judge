---
title: "Commission: Fix: BGG batch size limit is 20, not 250"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "The BGG API returns HTTP 400 \"Cannot load more than 20 items\" when batching thing requests. The current `MAX_BATCH_SIZE` in `packages/daemon/src/services/bgg-client.ts` is 250. Change it to 20.\n\nAlso update the BGG research doc at `.lore/research/bgg-api.md` section 6 (Rate Limits) to correct the batch size guidance: the actual limit is 20 IDs per thing request, not 250-500.\n\nAfter fixing, run `bun test` to make sure nothing breaks (some tests may assert on batch behavior with >20 IDs and need adjustment)."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T03:11:29.698Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T03:11:29.700Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
