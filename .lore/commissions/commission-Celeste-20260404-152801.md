---
title: "Commission: Brainstorm fitness score model options"
date: 2026-04-04
status: completed
tags: [commission]
worker: Celeste
workerDisplayTitle: "Guild Visionary"
prompt: "Read the project vision at `.lore/vision.md` and the architecture pattern at `.lore/reference/architecture-pattern.md` to ground yourself.\n\nYour task: brainstorm multiple viable approaches to the **fitness score model** for shelf-judge. This is the core math that turns multi-axis personal ratings + BGG data into a single fitness number per game.\n\nKey constraints from the vision:\n- Users define their own rating axes (not a fixed set)\n- Users weight those axes according to personal importance\n- BGG data (community rating, weight, mechanics, categories, player count) feeds in as context, not authority\n- The fitness score must be transparent and decomposable (\"why did this game score X?\")\n- Fitness is collection-aware: redundancy among owned games affects scores\n- The system must predict fitness for unowned games from partial data\n- \"Insufficient data\" is better than a confident wrong number\n\nFor each approach, address:\n1. **How user-defined axes work** — how users create, rate, and weight custom axes\n2. **How BGG data integrates** — as derived axes, normalization inputs, or something else\n3. **The aggregation function** — how axes combine into one number (weighted average, geometric mean, ranked pairs, etc.)\n4. **Redundancy/collection-awareness** — how owning similar games affects fitness\n5. **Prediction for unowned games** — how the system estimates fitness without personal ratings\n6. **Transparency** — how the score breaks down for the user\n7. **Edge cases** — what happens with 1 axis, 0 ratings, conflicting signals\n\nExplore at least 3 meaningfully different approaches. Don't converge prematurely. Name tradeoffs honestly.\n\nWrite the brainstorm artifact to `.lore/brainstorms/fitness-model-options.md`."
dependencies: []
linked_artifacts:
  - .lore/brainstorms/fitness-model-options.md

resource_overrides:
  model: sonnet

activity_timeline:
  - timestamp: 2026-04-04T22:28:01.359Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-04T22:28:01.361Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-04T22:28:01.374Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-04T22:28:06.804Z
    event: progress_report
    reason: "Reading project vision and architecture pattern to ground the brainstorm."
  - timestamp: 2026-04-04T22:28:22.862Z
    event: progress_report
    reason: "Context gathered. Vision is draft status — noting this, proceeding without full four-step vision alignment filtering. No prior brainstorms exist. Writing fitness model options brainstorm now."
  - timestamp: 2026-04-04T22:32:27.142Z
    event: result_submitted
    reason: "Brainstorm complete. Five meaningfully distinct fitness model approaches written to `.lore/brainstorms/fitness-model-options.md`.\n\n**Approaches covered:**\n\n1. **Axis Scorecard** — explicit user-defined axes, weighted average, BGG as derived axes, redundancy penalty. Most transparent, highest user burden.\n\n2. **Pairwise Tournament** — relative comparisons (Elo/Bradley-Terry) instead of absolute ratings. Low burden, strong revealed-preference signal, weak cold-start, hard to explain.\n\n3. **Collection Profile Similarity** — user ratings build a taste profile vector; fitness = cosine similarity to profile. Best prediction (any BGG game), structural redundancy via marginal fitness, but no explicit personal axes.\n\n4. **Multi-Criteria Utility Curves** — like Approach 1 but axes have shape (plateau, S-curve, hard veto). Veto axes (\"wife must play it\") are first-class. Most expressive for hard requirements; highest config burden.\n\n5. **LLM-Mediated Synthesis** — LLM is the aggregation function given all structured inputs. Transparent via natural-language reasoning, handles partial data and edge cases well, but non-determinism risk and latency require caching architecture.\n\n**Three cross-cutting observations** named that apply regardless of which model is chosen: cold-start minimum viable collection threshold, personal/sentimental axis coverage gap, and prediction confidence signal design as a standalone concern.\n\n**Artifact:** `.lore/brainstorms/fitness-model-options.md`"
  - timestamp: 2026-04-04T22:32:38.996Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Context gathered. Vision is draft status — noting this, proceeding without full four-step vision alignment filtering. No prior brainstorms exist. Writing fitness model options brainstorm now."
projectName: shelf-judge
---

Brainstorm complete. Five meaningfully distinct fitness model approaches written to `.lore/brainstorms/fitness-model-options.md`.

**Approaches covered:**

1. **Axis Scorecard** — explicit user-defined axes, weighted average, BGG as derived axes, redundancy penalty. Most transparent, highest user burden.

2. **Pairwise Tournament** — relative comparisons (Elo/Bradley-Terry) instead of absolute ratings. Low burden, strong revealed-preference signal, weak cold-start, hard to explain.

3. **Collection Profile Similarity** — user ratings build a taste profile vector; fitness = cosine similarity to profile. Best prediction (any BGG game), structural redundancy via marginal fitness, but no explicit personal axes.

4. **Multi-Criteria Utility Curves** — like Approach 1 but axes have shape (plateau, S-curve, hard veto). Veto axes ("wife must play it") are first-class. Most expressive for hard requirements; highest config burden.

5. **LLM-Mediated Synthesis** — LLM is the aggregation function given all structured inputs. Transparent via natural-language reasoning, handles partial data and edge cases well, but non-determinism risk and latency require caching architecture.

**Three cross-cutting observations** named that apply regardless of which model is chosen: cold-start minimum viable collection threshold, personal/sentimental axis coverage gap, and prediction confidence signal design as a standalone concern.

**Artifact:** `.lore/brainstorms/fitness-model-options.md`
