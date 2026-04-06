---
title: "Deferred: LLM-mediated features"
date: 2026-04-06
status: open
tags: [deferred, feature, llm, ai]
modules: [daemon, web, cli]
origin: .lore/specs/mvp.md
stub: "[STUB: llm-integration]"
---

# LLM-mediated features

MVP has no AI in the fitness calculation or anywhere else. The score is deterministic math, and the vision explicitly requires this (Principle 2: scores are transparent and reproducible).

## What was deferred

Two categories of LLM features:

1. **Natural language score explanation.** Instead of just showing the numerical breakdown, an LLM could narrate why a game scored the way it did: "Wingspan scores high because you value theme and solo playability, but its complexity drags it down slightly."

2. **Conversational axis creation.** Instead of manually defining axes, a user could describe what they care about in natural language and the system would suggest axis definitions.

## Why it was deferred

The MVP constraint is explicit: "No AI/LLM in MVP. Fitness is deterministic math." LLM features are enhancements on top of a working scoring system, not replacements for it. The core loop had to prove itself with transparent, reproducible math before layering explanatory AI on top.

## Context for pickup

- The fitness calculation must remain deterministic. LLM features explain or assist, never determine scores.
- Score breakdowns (REQ-MVP-5) already provide the structured data an LLM would narrate from.
- Conversational axis creation could lower the barrier to entry for users who find "create an axis with weight 0-100" intimidating.
- Exit point defined in spec: triggers when "user wants natural language explanations."
