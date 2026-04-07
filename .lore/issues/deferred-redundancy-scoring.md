---
title: "Deferred: Redundancy / collection-awareness scoring"
date: 2026-04-06
status: open
tags: [deferred, feature, fitness, scoring]
modules: [daemon]
origin: .lore/specs/mvp.md
stub: "[STUB: redundancy-scoring]"
---

# Redundancy / collection-awareness scoring

MVP calculates fitness per game in isolation. No mechanic overlap penalty, no awareness that you already own three worker-placement games. The vision's Principle 5 ("the shelf has a carrying capacity") is the driver for this feature.

## What was deferred

Collection-level fitness adjustments. A game's score would decrease if the collection already has strong coverage in that game's niche (mechanics, weight range, player count). The exact penalty model was not designed.

## Why it was deferred

The core scoring loop needed to be proven first. Redundancy scoring depends on having a populated collection with enough rated games to make overlap detection meaningful. Adding it before users validate that multi-axis rating is useful would have been premature complexity.

## Context for pickup

- Vision Principle 5 defines the intent: "the shelf has a carrying capacity."
- The fitness model design (`.lore/designs/mvp-fitness-model.md`) treats each game independently. Redundancy would need a second pass that adjusts scores based on collection composition.
- Mechanics and categories are already cached from BGG data per game, so the raw data for overlap detection is available.
- Exit point defined in spec: triggers when "user wants overlap-aware fitness."
