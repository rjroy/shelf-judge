---
status: active
---
# Heartbeat

This file controls what the guild does autonomously. Every hour (configurable),
a Guild Master session reads this file and decides which standing orders warrant
action: creating commissions, dispatching work, or starting meetings.

**Standing Orders** are lines starting with `- `. Write them in plain language.
If you want the guild to check with you before acting on an order, say so in the
order itself.

**Watch Items** are things to monitor. The guild reads these for context but won't
create commissions from them directly.

**Context Notes** are operational context the guild should know (merge freezes, priorities).

**Recent Activity** is managed by the daemon. Don't edit this section manually.
Workers can also add entries to this file during their sessions.

## Standing Orders

## Watch Items

## Context Notes

## Recent Activity
- 13:25 commission-Dalton-20260405-121635 result: Phase 4 implementation complete. All 6 steps delivered:

**4.1 App factory and entry point:**
- `packages/daemon/src/config.ts` - Config resolution from env vars
- `packages/daemon/src/operations.ts` ...

- 13:25 commission-Dalton-20260405-121635 completed
- 13:31 commission-Thorne-20260405-121642 result: # Phase 4 Review: Daemon API (Hono Routes)

- 13:31 commission-Thorne-20260405-121642 completed
- 13:36 commission-Dalton-20260405-121647 result: # Phase 4 Review Fixes: All Findings Addressed

- 13:36 commission-Dalton-20260405-121647 completed
- 13:43 commission-Dalton-20260405-121712 result: Phase 6 (CLI) implemented. All four steps complete:

**6.1 CLI scaffold and daemon client:** Unix socket HTTP client (`client.ts`) with GET/POST/PUT/DELETE/SSE support. Entry point (`index.ts`) with a...
- 13:44 commission-Dalton-20260405-121712 completed
- 13:46 commission-Dalton-20260405-121701 result: Phase 5 (Web UI) implemented. All six steps complete:

**5.1 Next.js setup** - App Router scaffold with `@shelf-judge/shared` workspace dependency. API proxy at `/api/daemon/[...path]/route.ts` forwar...
- 13:46 commission-Dalton-20260405-121701 completed
- 13:49 commission-Thorne-20260405-121728 result: # Phase 6 Review: CLI Implementation

- 13:49 commission-Thorne-20260405-121728 completed
## Summary

The CLI implementation covers all commands from the CLI design, has `--json` tests on every command (REQ-MVP-23 fully satisfied), produces readable ta...
## Findings Fixed

**F1: SSE progress writes not awaited** - Changed `onProgress` callback type to `(event) => Promise<void> | void` in both interface a...
## Verdict

Solid implementation. All routes exist, the DI pattern is clean, operations registry is complete, and test coverage is reasonable. Five findings...