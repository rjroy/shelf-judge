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
- 11:08 commission-Octavia-20260410-110602 result: Comprehensive search completed. Rich prior work found across all major .lore/ categories. No existing implementation plan for collection profiling exists yet. See full findings below.

- 11:10 commission-Dalton-20260410-070846 result: Phase 3 (Service Layer Changes) complete. All changes implemented per plan:

**Storage** (`packages/daemon/src/services/storage-service.ts`):
- `createDefaultTournament()` no longer produces a top-lev...
- 11:10 commission-Dalton-20260410-070846 completed
- 11:14 commission-Dalton-20260410-070855 result: Phase 4 (Remove Recalculate and Client Grep) complete. All changes implemented per plan:

**Route removal** (`packages/daemon/src/routes/tournament.ts`):
- Removed `POST /tournament/recalculate` route...
- 11:15 commission-Dalton-20260410-070855 completed
- 11:19 commission-Octavia-20260410-110602 completed
- 11:21 commission-Thorne-20260410-070903 result: ## Review: Phases 3 & 4 of Tournament Overhead Reduction

### Findings (priority order)

**1. DEFECT: All-stats endpoint no longer enriches `opponentGameName`**
File: `packages/daemon/src/routes/tourn...
- 11:21 commission-Thorne-20260410-070903 completed
- 11:21 commission-Octavia-20260410-110831 result: Implementation plan for the prediction engine written and reviewed.

**Artifact**: `.lore/plans/prediction-engine.md` (status: draft, 37 requirements mapped across 7 phases)

**Structure**: 7 sequenti...
- 11:21 commission-Octavia-20260410-110831 completed
- 11:22 commission-Dalton-20260410-070908 result: Fixed both findings from Thorne's Phase 3+4 review:

1. **DEFECT: all-stats endpoint opponentGameName enrichment** (`packages/daemon/src/routes/tournament.ts:197-203`): Added enrichment loop inside th...
- 11:22 commission-Dalton-20260410-070908 completed
- 11:25 commission-Sienna-20260410-111128 result: Created `.lore/mockups/profile-overview.html` — a complete HTML mockup for the Profile Overview page.

**Sections implemented (REQ-PROFILE-30):**
1. **LLM Narration slot** — empty state with "Generate...
- 11:25 commission-Sienna-20260410-111128 completed
- 11:25 commission-Thorne-20260410-070916 result: ## Final Validation: Reduce Tournament Overhead (Phase 5)

All 14 REQ-RTO requirements verified against the implementation. **No unmet requirements found.**

### Requirement Status

| Requirement | St...
- 11:25 commission-Thorne-20260410-070916 completed