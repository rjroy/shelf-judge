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
- 17:40 commission-Dalton-20260411-172109 result: LLM Narrative feature implemented across all four phases. Typecheck clean, lint clean, 883 tests pass / 0 fail.

**Phase 1 (Shared Types + Cache Logic):**
- Added `ProfileNarration` and `NarrationCach...

- 17:40 commission-Dalton-20260411-172109 completed
- 17:43 commission-Dalton-20260411-174220 cancelled
- 17:49 commission-Dalton-20260411-174435 result: Phases 1-3 of the niche champion display plan implemented and verified.

**Phase 1 (Shared Types):** Added `NicheNeighbor`, `NicheEntry`, `NichePosition`, `NicheImpactEntry`, `NicheImpact` to `package...
- 17:49 commission-Dalton-20260411-174435 completed
- 17:51 commission-Thorne-20260411-174549 result: ## LLM Narrative Implementation Review

Reviewed against REQ-PROFILE-18 through REQ-PROFILE-28 and REQ-PROFILE-34, plus the plan at `.lore/plans/llm-narrative.md`.

---

### Findings (Priority Order)
...
- 17:51 commission-Thorne-20260411-174549 completed
- 17:54 commission-Thorne-20260411-174451 result: ## Niche Champion Display — Phases 1-3 Review

### Verdict: One defect, one test gap, two observations. Foundation is solid.

---

### DEFECT: `isChampion` incorrectly true for predicted games tied wi...
- 17:54 commission-Thorne-20260411-174451 completed