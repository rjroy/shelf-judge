---
title: "Deferred: Play history import from BGG"
date: 2026-04-06
status: declined
tags: [deferred, feature, bgg]
modules: [daemon]
origin: .lore/specs/mvp.md
---

# Play history import from BGG

MVP does not use BGG play logs in any capacity.

## What was deferred

Importing play history (play dates, player counts, locations, session notes) from BGG. Play data is available through the BGG API but is not fetched, stored, or used in MVP scoring.

## Why it was deferred

Play history is available from BGG but was not part of the MVP scoring model. The fitness calculation uses ratings and BGG metadata (community rating, weight, mechanics), not play frequency. Play data could feed future features like "games you haven't played in a year" or "plays-per-month trends" but those features were out of scope.

## Context for pickup

- BGG API research (`.lore/research/bgg-api.md`) documents the plays endpoint.
- Play data could inform new axes (e.g., "times played" as a derived axis) or collection management features.
- Could also feed the prediction engine: games with high play counts and high ratings are stronger signals than ratings alone.
- No exit point stub defined in spec.
