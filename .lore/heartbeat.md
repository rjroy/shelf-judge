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
- 12:22 commission-Dalton-20260405-121511 result: Phase 1 implemented. 31 tests pass, types check clean.

**Step 1.1 - Project scaffolding:**
- Bun workspace with 4 packages (shared, daemon, web placeholder, cli placeholder)
- TypeScript strict mode,...

- 12:22 commission-Dalton-20260405-121511 completed
- 12:26 commission-Thorne-20260405-121520 result: ## Phase 1 Review: Project Scaffolding and Data Model

### Verdict: PASS with 3 findings

The implementation is solid. Types match the design docs exactly, atomic writes are correctly implemented, def...
- 12:26 commission-Thorne-20260405-121520 completed