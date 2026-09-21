---
title: "Implementation plan: expanded profile attention opportunities"
date: 2026-09-20
status: approved
tags: [plan, profile, attention, intention-lifecycle]
modules: [shared, daemon, web]
related:
  - .lore/work/specs/expanded-profile-attention-opportunities.md
  - .lore/reference/specs/current/useful-collection-profile.md
---

# Implementation plan: expanded profile attention opportunities

## Scope

Implement one presentation refinement for existing active intentions. Reuse the existing Profile play-count projection and lifecycle. Do not add migrations, new source/evidence representation, feedback, routes, CLI commands, or durable state.

## Steps

1. Restore and retain the current source and cache versions: collection schema 7, Profile contract 9, and Profile algorithm 12. The algorithm bump discards generic version-11 caches before this presentation refinement can be read. Remove the discarded accepted-source and feedback additions rather than migrating them.
2. In the existing daemon Profile engine, select `Is there a reason you haven’t played this?` only for a currently owned active `want-to-play` intention whose existing current play-count projection is valid and exactly zero. Select `Do you still want to play ${game.name}?` for every other active intention, including historical `first-play` and `replay`.
3. Keep one card per intention and reuse its identity, actions, warning behavior, neutral ordering, and lifecycle projection. The selection helper must be pure: profile reads and presentation changes make no durable writes.
4. Extend only the existing card family/copy contract as needed so consumers render the daemon-selected question. Do not add client-side qualification or new commands.
5. Add focused shared and daemon tests for qualifying zero, nonzero, invalid or unavailable projection, ownership, historical `first-play`, historical `replay`, stable identity/actions, warning fallback, neutral ordering, and no read-side write.
6. Reconcile [Useful Collection Profile](../../reference/specs/current/useful-collection-profile.md) with this implemented presentation rule while preserving its lifecycle, completion, history, ownership, warning, and cache authority.

## Acceptance

Focused tests prove that an owned active `want-to-play` with a valid current zero count receives the specific unplayed question, all other active intentions receive the generic question, and each intention remains one unchanged card apart from presentation. Confirm schema/profile versions remain 7/9/12 and no discarded governance, feedback, migration, route, CLI, or provider surface remains.
