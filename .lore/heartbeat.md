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
- 18:09 commission-Dalton-20260411-174516 result: Phase 5 (Web UI) implemented. All verification passes: typecheck, lint, 908 tests green.

**5a: Web API helpers** (`packages/web/lib/api.ts`)
- `listGames()` now accepts optional `{ includeNiches?: bo...

- 18:09 commission-Dalton-20260411-174516 completed