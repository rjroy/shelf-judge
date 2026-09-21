---
title: Expanded profile attention opportunities
date: 2026-09-20
status: approved
tags: [collection, profile, attention]
modules: [shared, daemon, web]
related:
  - .lore/reference/specs/current/useful-collection-profile.md
req-prefix: PROFILE-ATTN
---

# Expanded Profile Attention Opportunities

## Purpose

Make the existing active Want to play card more specific when the owner currently owns the game and the existing current Profile play-count projection validly says it has never been played. This is presentation only, not a new product system.

## Requirements

1. **REQ-PROFILE-ATTN-1:** For each active intention, render exactly one card. Preserve its `intentionId`, derived card identity, actions, lifecycle, completion and retirement behavior, history, and existing warning behavior.
2. **REQ-PROFILE-ATTN-2:** Render the specific `Is there a reason you haven’t played this?` question only when the game is currently owned, the active intention is `want-to-play`, and the existing current Profile play-count projection is valid and exactly zero.
3. **REQ-PROFILE-ATTN-3:** Otherwise render the generic `Do you still want to play ${game.name}?` play-intention question. Historical `first-play` and `replay` intentions always use that generic question, including when a current count is zero.
4. **REQ-PROFILE-ATTN-4:** The daemon owns this projection. Changing presentation must not write, migrate, resolve, retire, reopen, or otherwise mutate durable data. Existing update-time observed-play completion remains unchanged; Profile reads do not write.
5. **REQ-PROFILE-ATTN-5:** Keep the existing active-intention warning and correction behavior when the play-count projection is unavailable or invalid. Do not infer zero from absent or invalid evidence.
6. **REQ-PROFILE-ATTN-6:** Keep the existing two Profile questions, successful empty state, and neutral ordering. The change must not add a source registry, conflict/freshness policy beyond the existing projection, feedback or answer history, suppression, rating or goal cards, AI/provider behavior, routes, CLI commands, or durable state.

## AI Validation

1. Fixture an owned active `want-to-play` intention with a valid current count of zero. Verify one card uses the specific unplayed question and retains the same identity and actions.
2. Fixture owned `want-to-play` intentions with a nonzero, unavailable, or invalid current projection. Verify one generic card each, with existing warnings where applicable and no inferred zero.
3. Fixture historical `first-play` and `replay` intentions, including a valid zero count. Verify they use one generic card.
4. Change only the current projection between qualifying and non-qualifying values. Verify only card copy changes. Verify no read-side write and that existing completion, retirement, history, warning, empty-state, and neutral-order tests continue to pass.
