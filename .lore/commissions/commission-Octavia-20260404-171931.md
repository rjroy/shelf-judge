---
title: "Commission: Write MVP specification for shelf-judge"
date: 2026-04-05
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write an MVP specification for shelf-judge. Read ALL of the following documents before writing:\n\n- `.lore/vision.md` — project vision, principles, anti-goals, tension resolution\n- `.lore/brainstorms/fitness-model-options.md` — fitness model approaches (Celeste's brainstorm)\n- `.lore/research/bgg-api.md` — BGG API capabilities, data fields, rate limits, quirks (Verity's research)\n- `.lore/reference/architecture-pattern.md` — daemon-first architecture pattern (Hono daemon, Next.js web, CLI discovery)\n\nThe MVP spec should define what we build first. It must be concrete enough to hand to a developer and say \"build this.\" Cover:\n\n1. **Scope** — What's in the MVP, what's explicitly deferred. The MVP should be the smallest thing that demonstrates the core value proposition: personal multi-axis ratings producing a transparent fitness score for owned games.\n\n2. **Data model** — What entities exist (games, axes, ratings, collections). What fields. What's stored locally vs fetched from BGG. Be specific about types.\n\n3. **Fitness score model** — Pick one approach from Celeste's brainstorm (or synthesize the best parts of multiple). Justify the choice for MVP. Define the math precisely enough to implement. Address: axis creation, rating scale, weighting, BGG data integration, aggregation formula, score breakdown/transparency.\n\n4. **BGG integration** — What endpoints we hit, what data we pull, how we handle rate limits and the authentication requirements Verity found. What's cached vs fetched on demand.\n\n5. **API surface** — Key daemon endpoints following the architecture pattern (operations registry, route/service split with DI). Don't design every endpoint, but define the core ones: add game, rate game, create axis, get fitness score, import from BGG collection.\n\n6. **Web UI** — Key screens/views for MVP. Keep it minimal. What does the user see and do?\n\n7. **CLI surface** — What commands exist at MVP. Follow the discovery pattern from the architecture doc.\n\n8. **What's deferred** — Explicitly list what the MVP does NOT include: prediction for unowned games, redundancy/collection-awareness, collection identity/profiling, etc. These are real features from the vision, deferred to post-MVP.\n\nWrite the spec to `.lore/specs/mvp.md`. Use the writing voice from the project (plain, direct, no hedging). Make decisions where decisions are needed; flag genuine open questions separately."
dependencies: []
linked_artifacts:
  - .lore/specs/mvp.md

resource_overrides:
  model: opus

activity_timeline:
  - timestamp: 2026-04-05T00:19:31.496Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-05T00:19:31.498Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-05T00:19:31.509Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-05T00:19:38.912Z
    event: progress_report
    reason: "Reading all referenced documents before drafting the MVP spec."
  - timestamp: 2026-04-05T00:20:08.793Z
    event: progress_report
    reason: "All source documents read. Compendium spec-writing guidance loaded. Now drafting the MVP spec."
  - timestamp: 2026-04-05T00:22:52.557Z
    event: progress_report
    reason: "MVP spec drafted at .lore/specs/mvp.md. Running a self-review pass before submitting."
  - timestamp: 2026-04-05T00:23:13.491Z
    event: result_submitted
    reason: "MVP specification written to `.lore/specs/mvp.md`.\n\nThe spec defines shelf-judge MVP as: user-defined rating axes with weights, per-game ratings (1-10), BGG data integration (community rating, weight, mechanics, categories), and a weighted-average fitness score with mandatory transparent breakdown.\n\nKey decisions made:\n- **Fitness model:** Axis Scorecard (Approach 1) with weighted average. Chosen for transparency (every point traceable), zero cold-start, and serving as the foundation the pairwise tournament (DEF-4) would extend later.\n- **Data model:** Game, Axis, BggGameData, Collection types with JSON file persistence. Single collection, single user.\n- **BGG integration:** Three endpoints (Thing, Search, Collection), application token auth, 202 retry logic, 7-day cache TTL, conservative rate limiting (1 req/5s).\n- **API:** 15 operations following the daemon-first architecture pattern (Hono, route/service DI factories, operations registry).\n- **Web:** 5 screens (collection view, game detail with breakdown, search/add, axes management, import status).\n- **CLI:** Runtime discovery from daemon, human-readable default output with --json flag.\n\n8 explicit deferrals: redundancy/collection-awareness, prediction for unowned games, collection profiling, pairwise tournament, utility curves, LLM scoring, BGG user auth, play history.\n\n3 open questions flagged: axis weight UX (raw vs normalized), BGG library choice, import conflict resolution.\n\n12 success criteria defined (7 automated, 5 manual verification)."
  - timestamp: 2026-04-05T00:23:17.004Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "MVP spec drafted at .lore/specs/mvp.md. Running a self-review pass before submitting."
projectName: shelf-judge
---

MVP specification written to `.lore/specs/mvp.md`.

The spec defines shelf-judge MVP as: user-defined rating axes with weights, per-game ratings (1-10), BGG data integration (community rating, weight, mechanics, categories), and a weighted-average fitness score with mandatory transparent breakdown.

Key decisions made:

- **Fitness model:** Axis Scorecard (Approach 1) with weighted average. Chosen for transparency (every point traceable), zero cold-start, and serving as the foundation the pairwise tournament (DEF-4) would extend later.
- **Data model:** Game, Axis, BggGameData, Collection types with JSON file persistence. Single collection, single user.
- **BGG integration:** Three endpoints (Thing, Search, Collection), application token auth, 202 retry logic, 7-day cache TTL, conservative rate limiting (1 req/5s).
- **API:** 15 operations following the daemon-first architecture pattern (Hono, route/service DI factories, operations registry).
- **Web:** 5 screens (collection view, game detail with breakdown, search/add, axes management, import status).
- **CLI:** Runtime discovery from daemon, human-readable default output with --json flag.

8 explicit deferrals: redundancy/collection-awareness, prediction for unowned games, collection profiling, pairwise tournament, utility curves, LLM scoring, BGG user auth, play history.

3 open questions flagged: axis weight UX (raw vs normalized), BGG library choice, import conflict resolution.

12 success criteria defined (7 automated, 5 manual verification).
