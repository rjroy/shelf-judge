---
title: "Commission: Phase 6: CLI"
date: 2026-04-05
status: blocked
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 6 of the MVP plan at `.lore/plans/mvp.md`.\n\nRead the full plan (Phase 6), then also read:\n- `.lore/designs/mvp-cli.md`\n- `.lore/designs/mvp-api-surface.md`\n- `.lore/specs/mvp.md` (REQ-MVP-22, 23, 24)\n\nPhase 6 has four steps:\n\n**6.1 CLI scaffold and daemon client** — Unix socket HTTP client. Entry point with argument parsing. Operation discovery from daemon `/api/help`.\n\n**6.2 Game and axis commands** — All game and axis CRUD commands per the CLI design. Default: human-readable tables. `--json` flag on ALL commands (REQ-MVP-23). Test table and JSON output.\n\n**6.3 Score commands** — `score list` (ranked by fitness) and `score get <id>` (full breakdown). Breakdown format must match the CLI design document. Test `--json` on both.\n\n**6.4 Import and config commands** — `import bgg-collection <username>` reads SSE stream, displays terminal progress. `config set/get`. `start/stop` daemon management. Commands check if daemon is running.\n\n**Critical: `--json` coverage requirement** from the plan: Every CLI command must have at least one test asserting `--json` produces parseable JSON. This includes ALL commands listed in the plan's section 6 review gate.\n\nRun `bun test` after implementation. All tests must pass."
dependencies:
  - commission-Dalton-20260405-121647
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-05T19:17:12.467Z
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
