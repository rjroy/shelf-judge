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
- 15:49 commission-Dalton-20260405-121733 result: ## All 7 Thorne findings addressed

### Defects fixed

**DEFECT 1: Silent drop of out-of-range ratings** (`rating-form.tsx`)
- Submit handler now validates all ratings before sending. Out-of-range val...

- 15:49 commission-Dalton-20260405-121733 completed
- 16:00 commission-Thorne-20260405-121750 result: # Final Integration Verification: Shelf Judge MVP

- 16:00 commission-Thorne-20260405-121750 completed
- 16:05 commission-Sienna-20260405-155040 result: Visual direction defined and mockups produced for Shelf Judge. Here's what was created and why.

- 16:05 commission-Sienna-20260405-155040 completed
## Creative Direction

**Personality:** Shelf Judge is a personal curation tool, not a product. The rig...
## Test Execution

**Cannot run tests.** Thorne is read-only (no Bash tool). All findings below are from static analysis. Running `bun test` from the...