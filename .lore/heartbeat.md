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
- 15:32 commission-Celeste-20260404-152801 result: Brainstorm complete. Five meaningfully distinct fitness model approaches written to `.lore/brainstorms/fitness-model-options.md`.

**Approaches covered:**

1. **Axis Scorecard** — explicit user-define...

- 15:32 commission-Celeste-20260404-152801 completed
- 15:40 commission-Verity-20260404-153502 result: Research complete. Artifact written to `.lore/research/bgg-api.md`.

Key findings:

**API:** BGG XML API v2 (`https://boardgamegeek.com/xmlapi2/`) is the active API. XML-only, CORS-disabled (server-si...
- 15:40 commission-Verity-20260404-153502 completed