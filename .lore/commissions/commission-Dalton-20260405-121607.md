---
title: "Commission: Phase 3: BGG Integration"
date: 2026-04-05
status: blocked
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 3 of the MVP plan at `.lore/plans/mvp.md`.\n\nRead the full plan (Phase 3), then also read:\n- `.lore/designs/mvp-bgg-integration.md`\n- `.lore/research/bgg-api.md`\n- `.lore/specs/mvp.md` (REQ-MVP-7, 10, 11, 12, 13, 18, 19)\n\nPhase 3 has four steps:\n\n**3.0 BGG library spike** — Verify `bgg-xml-api-client` handles the 2025 auth token. If it doesn't work, switch to custom client with `fetch` + `fast-xml-parser`. Record the decision.\n\n**3.1 BGG client service** — Implement `BggClient` with factory pattern. Rate limiting (sequential queue, configurable delayMs, tests use delayMs:0). 202 retry with exponential backoff (5s, 10s, 20s, max 3). 429 backoff. 502/503 retry. XML parsing with `fast-xml-parser`. Handle BGG quirks: averageweight=0 as null, primary name extraction, median always 0. Use captured real BGG API responses as test fixtures, NOT synthetic XML.\n\n**3.2 BGG integration into game service** — Extend GameService to use BggClient. Add by bggId fetches BGG data. Search delegates to BggClient. Refresh updates cache, re-derives BGG axis ratings, preserves user overrides. BGG-derived ratings computed at score time in fitness service, not stored.\n\n**3.3 Collection import** — Import via `importBggCollection(username, onProgress)`. Skip duplicates (match bggId). Stream progress events. Handle partial failures. Return summary.\n\n**Critical:** Test fixtures must be captured from real BGG API responses. The spec's AI validation criteria requires this. Capture responses for at least Wingspan (266192) and Gloomhaven (174430).\n\nRun `bun test` after implementation. All Phase 1-3 tests must pass."
dependencies:
  - commission-Dalton-20260405-121552
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-05T19:16:07.291Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-05T19:22:19.171Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
current_progress: ""
projectName: shelf-judge
---
