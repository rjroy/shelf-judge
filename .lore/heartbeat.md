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
- 15:42 commission-Dalton-20260406-153803 result: Phases 1 and 2 implemented. All checks pass: 281 tests green, typecheck clean, lint clean.

**Phase 1: Data Model and Shared Types**
- Added 11 tournament types to `packages/shared/src/types.ts`: Tour...

- 15:42 commission-Dalton-20260406-153803 completed
- 15:46 commission-Thorne-20260406-153813 result: ## Review: Tournament Phase 1+2 (Types + ELO Engine)

### Findings by Priority

**1. DEFECT — "Incremental matches recalculate" test is vacuous**
File: `packages/daemon/tests/elo-engine.test.ts:234-25...
- 15:46 commission-Thorne-20260406-153813 completed