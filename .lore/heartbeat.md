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
- 00:32 commission-Octavia-20260412-002610 result: Wrote implementation plan to `.lore/plans/redundancy-scoring.md` (status: draft).

The plan has 12 phases covering all 41 spec requirements:

1. **Shared Types** (REQ-REDUN-1,2,14-16): `RedundancySett...

- 00:32 commission-Octavia-20260412-002610 completed
- 00:33 commission-Octavia-20260412-002912 result: Wrote wishlist specification to `.lore/specs/wishlist.md` (status: draft, 29 requirements, prefix WISH).

The spec defines:

**Data model:** `WishlistEntry` stores BGG identity (bggId, name, year, thu...
- 00:33 commission-Octavia-20260412-002912 completed
- 00:34 commission-Celeste-20260412-003019 result: Wrote brainstorm to `.lore/brainstorms/shelf-layout-designer.md` with 6 proposals exploring the shelf layout designer idea at two altitudes.

**Curation-aligned proposals (extend existing vision):**
-...
- 00:34 commission-Celeste-20260412-003019 completed