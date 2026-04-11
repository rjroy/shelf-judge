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
- 21:20 commission-Dalton-20260410-171813 result: Phase 5 (Web UI) complete. 812 tests pass, 1 skip (pre-existing), 0 fail. Typecheck, lint, and format all clean.

**Files created:**
- `packages/web/app/readiness/page.tsx` — Dedicated prediction read...

- 21:22 commission-Dalton-20260410-171813 completed