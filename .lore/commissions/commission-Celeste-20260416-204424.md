---
title: "Commission: Brainstorm one-pass bracket mode"
date: 2026-04-17
status: completed
tags: [commission]
worker: Celeste
workerDisplayTitle: "Guild Visionary"
prompt: "Brainstorm `.lore/issues/one-pass-bracket-mode.md` using the `/lore-development:brainstorm` skill.\n\nThe issue proposes a tournament mode that reduces pairwise comparisons by using transitivity to skip matches whose outcome can be inferred from prior results. Example from the issue:\n\n- test: a > b\n- test: b > c\n- skip: a vs c (inferred a > c)\n- test: b > d\n- still need c vs d (no transitive path)\n- test: c > d\n- skip: a vs d (inferred a > d)\n\nThe goal is to make tournaments tractable when the pool grows large, accepting less certainty than a full round-robin.\n\nExplore the idea fully. Among the things worth considering:\n- How transitive inference interacts with the current ELO ranking system (currently every pair matters for rating stability)\n- When the tractability gain justifies the loss of information (pool size thresholds, UX patterns)\n- Alternative framings: is \"one pass\" a separate mode, a setting, or a pairing strategy within existing tournaments\n- Edge cases: cycles, near-ties, how to recover when inferred results feel wrong\n- Interaction with existing \"reduce tournament overhead\" work already shipped\n- Whether this changes data model (stored match results vs inferred results)\n- UX: does the user see skipped pairs? Can they opt to test one?\n\nRead `.lore/vision.md`, `.lore/designs/` (especially anything tournament-related), and the tournament implementation in `packages/daemon/` and `packages/web/` before proposing.\n\nRecord the brainstorm under `.lore/brainstorms/` per the skill's convention. The issue file remains open; the brainstorm captures \"what if\" exploration that can later be distilled into a spec if the user decides to pursue it."
dependencies: []
linked_artifacts:
  - .lore/brainstorms/one-pass-bracket-mode.md

activity_timeline:
  - timestamp: 2026-04-17T03:44:24.907Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-17T03:44:24.911Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-17T03:44:24.940Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-17T03:47:15.984Z
    event: progress_report
    reason: "Read vision, tournament specs, RTO spec, existing tournament service implementation, and prior brainstorms. Vision is active — honesty-over-coverage tension applies. Drafting 5 proposals covering transitive-skip pairing, information-gain heuristic, Bracket Sort mode, preference DAG as first-class data, and Top-N Finisher framing."
  - timestamp: 2026-04-17T03:51:10.840Z
    event: result_submitted
    reason: "Brainstorm on `.lore/issues/one-pass-bracket-mode.md` saved to `.lore/brainstorms/one-pass-bracket-mode.md`. Issue remains open per skill convention.\n\nFive proposals, each with evidence, rationale, vision alignment (four-step), and scope:\n\n1. **Transitivity-aware pairing filter** (Medium) — DAG-derived skip set in `getNextPair`; inferred edges disclosed, never update ELO.\n2. **Information-gain pairing** (Small) — replace ELO-proximity sort with skip threshold where expected score > 1 − ε. Pure ELO-native.\n3. **Bracket Sort Mode** (Large) — new session kind running merge sort / binary insertion / partial quickselect. Every comparison real; algorithm only routes questions.\n4. **Preference DAG as first-class data** (Large) — persistent edges with aging and overturn model. Substrate for Proposals 1, 3, 5. Tension with RTO spec named explicitly.\n5. **Convergence-based auto-end banner** (Small) — fills existing `[STUB: convergence-detection]`. Signals enough without inferring.\n\nCheapest path: Proposals 2 + 5 first (no data-model change, honesty-preserving). Most structurally interesting: Proposal 4 — three other proposals independently reach for edge-level preference data; naming it first would collapse the duplication. Most reframing: Proposal 3 — honors transitivity structurally without claiming inferred outcomes as evidence.\n\nVision status: active. The honesty-over-coverage tension row was load-bearing throughout; Proposal 1's original framing (skip and infer rating) failed that test and was rewritten to require disclosure and no ELO update."
  - timestamp: 2026-04-17T03:51:14.730Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Read vision, tournament specs, RTO spec, existing tournament service implementation, and prior brainstorms. Vision is active — honesty-over-coverage tension applies. Drafting 5 proposals covering transitive-skip pairing, information-gain heuristic, Bracket Sort mode, preference DAG as first-class data, and Top-N Finisher framing."
projectName: shelf-judge
---
Brainstorm on `.lore/issues/one-pass-bracket-mode.md` saved to `.lore/brainstorms/one-pass-bracket-mode.md`. Issue remains open per skill convention.

Five proposals, each with evidence, rationale, vision alignment (four-step), and scope:

1. **Transitivity-aware pairing filter** (Medium) — DAG-derived skip set in `getNextPair`; inferred edges disclosed, never update ELO.
2. **Information-gain pairing** (Small) — replace ELO-proximity sort with skip threshold where expected score > 1 − ε. Pure ELO-native.
3. **Bracket Sort Mode** (Large) — new session kind running merge sort / binary insertion / partial quickselect. Every comparison real; algorithm only routes questions.
4. **Preference DAG as first-class data** (Large) — persistent edges with aging and overturn model. Substrate for Proposals 1, 3, 5. Tension with RTO spec named explicitly.
5. **Convergence-based auto-end banner** (Small) — fills existing `[STUB: convergence-detection]`. Signals enough without inferring.

Cheapest path: Proposals 2 + 5 first (no data-model change, honesty-preserving). Most structurally interesting: Proposal 4 — three other proposals independently reach for edge-level preference data; naming it first would collapse the duplication. Most reframing: Proposal 3 — honors transitivity structurally without claiming inferred outcomes as evidence.

Vision status: active. The honesty-over-coverage tension row was load-bearing throughout; Proposal 1's original framing (skip and infer rating) failed that test and was rewritten to require disclosure and no ELO update.
