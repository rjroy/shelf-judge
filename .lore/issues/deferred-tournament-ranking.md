---
title: "Deferred: Pairwise tournament ranking"
date: 2026-04-06
status: open
tags: [deferred, feature, fitness, ranking, tournament]
modules: [daemon, web, cli]
origin: .lore/specs/mvp.md
stub: "[STUB: tournament-ranking]"
---

# Pairwise tournament ranking

MVP uses direct axis-based ratings only. The brainstorm explored a hybrid approach: tournament-style pairwise comparisons for overall fitness combined with direct ratings for individual axes.

## What was deferred

A comparison layer where users evaluate games head-to-head ("which of these two would you keep?"). Tournament results would feed into an overall fitness ranking that complements the per-axis scores. The brainstorm concluded this hybrid model is the long-term direction.

## Why it was deferred

Tournament ranking adds significant UX and implementation complexity. It requires 20+ games to converge on stable rankings. The per-axis scorecard needed to ship first to validate that users find multi-axis rating useful at all. Adding the comparison layer before that validation would have been premature.

## Context for pickup

- The fitness model brainstorm (`.lore/brainstorms/fitness-model-options.md`) explored this as part of the hybrid conclusion.
- Requires significant UX work: the comparison interface, progress tracking, convergence detection.
- Needs enough games in the collection (20+) for tournament results to be meaningful.
- Should complement axis scores, not replace them. The two signals together are more informative than either alone.
- Exit point defined in spec: triggers when "user wants pairwise comparison layer."
