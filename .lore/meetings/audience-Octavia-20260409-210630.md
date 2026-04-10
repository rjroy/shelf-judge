---
title: "Collection Profiling Brainstorm Review"
date: 2026-04-10
status: closed
tags: [meeting]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
agenda: "Discussing artifact: .lore/brainstorms/collection-profiling.md"
deferred_until: ""
linked_artifacts: []
meeting_log:
  - timestamp: 2026-04-10T04:06:30.981Z
    event: opened
    reason: "User started audience"
  - timestamp: 2026-04-10T04:06:37.732Z
    event: renamed
    reason: "Renamed to: Collection Profiling Brainstorm Review"
  - timestamp: 2026-04-10T04:22:46.147Z
    event: progress_summary
    reason: "Revised collection-profiling brainstorm based on discussion. Key changes: (1) Added \"Direction\" section establishing Profile Overview as home page replacement with stored profile data and cached LLM narration. (2) Renumbered proposals: original Proposal 5 (Prediction Engine) parked as deferred, original Proposal 6 (Drift Detection) replaced with new Proposal 5 (Collection Outlier Detection). (3) Removed tournament-derived preference from Proposal 1 (that's Proposal 3's territory). (4) Updated implementation sequence to reflect the five active proposals. (5) Resolved Open Question 1 (profile IS the home page) and reframed remaining questions around the new direction. (6) Added new open questions for LLM cache invalidation UX and outlier threshold tuning."
  - timestamp: 2026-04-10T04:46:45.097Z
    event: progress_summary
    reason: "Resolved all 7 open questions in the collection-profiling brainstorm: (1) Profile Overview is home, collection list gets its own page. (2) CLI returns full profile as structured JSON for LLM/agent consumption. (3) No minimum collection size gate. (4) Dirty flag, lazy recompute on next view. (5) Three narration states: current/stale/empty, regeneration is user-initiated. (6) Agent SDK handles its own auth, app doesn't touch it. (7) Outlier threshold resolved during implementation."
  - timestamp: 2026-04-10T04:47:59.109Z
    event: progress_summary
    reason: "Collection profiling brainstorm fully revised. Established direction: Profile Overview replaces home page, with stored algorithmic profile, cached LLM narration, tournament/fitness divergence, axis suggestions, and collection outlier detection. Parked prediction engine and rejected drift detection. Resolved all 7 open questions. Brainstorm is ready for speccing, starting with Proposals 1+3 as the minimum viable profiling feature."
  - timestamp: 2026-04-10T04:48:20.047Z
    event: closed
    reason: "User closed audience"
---
MEETING NOTES: Collection Profiling Open Questions Resolution
Guild Hall Workspace | Octavia (Meeting Notes Generator)
Date: 2026-04-10

SUMMARY

Reviewed and resolved all seven open questions from the collection profiling brainstorm document (.lore/brainstorms/collection-profiling.md). The session worked through design and implementation decisions for the Profile Overview feature and supporting infrastructure. All decisions were straightforward and deterministic, with no contentious tradeoffs.

The brainstorm encompasses six proposals (Algorithmic Profile, LLM Narration, Tournament Divergence, Axis Suggestions, Prediction Engine, Profile Changelog) with a clear implementation sequence. The minimum viable feature is Proposals 1+3 (Algorithmic Profile + Tournament/Fitness Divergence), potentially including Proposal 5 (Outlier Detection) in the same release since it reuses the same computed data.

The document is now complete with all questions resolved and ready for specification.

KEY DECISIONS

1. Profile Overview replaces home page; Collection moves to separate nav page. Rationale: Different interaction modes (aggregate understanding vs. per-game browsing) require different surfaces.

2. CLI returns full profile as JSON, with no human-readable summary. The CLI is a programmatic interface for LLM/agent access, not human consumption. The web UI handles all human-facing presentation.

3. No minimum collection size gate. The profile is meaningful at any collection size. Outlier detection will have a natural minimum but no artificial restriction is needed.

4. Dirty flag triggers recomputation on next view. Any write to ratings, games, axes, or tournament results sets the flag. Lazy recomputation avoids unnecessary work while keeping data current.

5. Stale LLM narration shows with a regenerate button rather than auto-regenerating. Keeps token costs under user control while remaining useful (stale data is better than no data).

6. Agent SDK handles its own authentication. The daemon does not touch, configure, or think about API keys. If authentication fails, the narration is unavailable; the profile page shows the empty state.

7. Outlier detection uses 2 standard deviations from collection centroid as threshold. Will be validated during implementation against the actual 200-game dataset.

ARTIFACTS

collection-profiling.md updated with resolved decisions and implementation sequence. Document is in the shelf-judge worktree at .lore/brainstorms/collection-profiling.md.

FOLLOW-UP

Next step is specification work for Proposals 1+3 (Algorithmic Profile and Divergence Analysis). No blocking items remain.
