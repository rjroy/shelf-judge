---
title: "Deferred: Utility curves and veto axes"
date: 2026-04-06
status: resolved
tags: [deferred, feature, fitness, scoring, axes]
modules: [daemon]
origin: .lore/specs/mvp.md
stub: "[STUB: utility-curves]"
---

# Utility curves and veto axes

MVP uses linear scoring on all axes. A rating of 8 contributes exactly twice as much as a rating of 4 (with equal weight). There is no way to express non-linear preferences or hard disqualifiers.

## What was deferred

Non-linear axis scoring: plateau curves (diminishing returns above a threshold), S-curves (rapid value gain in a range), and hard vetoes (a rating below X on this axis disqualifies the game regardless of other scores). The brainstorm's Approach 4 covered this territory.

## Why it was deferred

Utility curves increase configuration burden. Each axis would need a curve type selection and possibly curve parameters, which complicates both the UI and the mental model. Linear scoring is the right default for MVP; curves are a refinement for users who discover that linear doesn't capture their preferences well enough.

## Context for pickup

- Brainstorm explored this as Approach 4 (`.lore/brainstorms/fitness-model-options.md`).
- The fitness calculation currently uses a simple weighted average. Non-linear curves would transform the rating value before it enters the weighted sum.
- Veto axes are a special case: if a game scores below a threshold on a veto axis, its fitness drops to zero (or a penalty floor) regardless of other scores.
- UX challenge: how to present curve configuration without overwhelming users who are fine with linear.
- Exit point defined in spec: triggers when "user needs non-linear axis scoring."

## Resolution

Specified in `.lore/specs/fitness/utility-curves.md` (2026-04-06). The spec defines three preference shapes (higher-is-better, lower-is-better, sweet spot), tolerance levels with quantitative anchors, asymmetric lean, and veto thresholds. Additive weighted average is preserved; curves transform ratings before they enter the sum.
