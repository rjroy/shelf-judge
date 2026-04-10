---
title: "Deferred: Collection identity / taste profiling"
date: 2026-04-06
status: approved
tags: [deferred, feature, profiling, collection]
modules: [daemon]
origin: .lore/specs/mvp.md
stub: "[STUB: collection-profile]"
---

# Collection identity / taste profiling

MVP has no "your taste profile says..." inference. The system rates individual games but draws no conclusions about the collection as a whole or the user's preferences.

## What was deferred

Automated analysis of a user's rating patterns to surface their taste profile. Vision Principle 3 ("your collection has an identity") drives this: the collection itself tells you something about what you value, and the system should surface that insight rather than leaving the user to infer it manually.

## Why it was deferred

Profiling builds on a populated rating dataset. Without enough rated games, any profile would be speculative. The MVP needed to prove that multi-axis rating is worth doing before layering inference on top.

## Context for pickup

- Vision Principle 3 is the requirement source.
- The data model already captures per-axis ratings across games, which is the raw input for profiling.
- Could surface things like: "you consistently rate theme higher than mechanics," "your collection skews toward medium-weight euros," "you have no games rated above 7 on player interaction."
- Exit point defined in spec: triggers when "user wants taste profile inference."


USER NOTE: What if this was LLM driven?
USER NOTE: use Claude Agent SDK to gain the benefits of using the subscription. See `.lore/research/claude-agent-sdk.md`