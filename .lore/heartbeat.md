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
- 08:55 commission-Thorne-20260407-081621 result: ## Final Review: Collection Filter/Sort Feature

### Verdict: PASS. All 30 requirements satisfied. All 5 prior findings addressed. Test coverage is thorough.

---

### Prior Review Findings: All 5 Add...

- 08:55 commission-Thorne-20260407-081621 completed
- 09:00 commission-Dalton-20260407-082044 result: Thorne's final review: PASS with no new findings. All 30 requirements satisfied, all 5 prior findings addressed, 56 collection tests covering all specified cases.

Fixed one pre-existing lint issue: t...
- 09:00 commission-Dalton-20260407-082044 completed