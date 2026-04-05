---
title: "Commission: Write MVP specification for shelf-judge"
date: 2026-04-05
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Write an MVP specification for shelf-judge. Read ALL of the following documents before writing:\n\n- `.lore/vision.md` — project vision, principles, anti-goals, tension resolution\n- `.lore/brainstorms/fitness-model-options.md` — fitness model approaches (Celeste's brainstorm)\n- `.lore/research/bgg-api.md` — BGG API capabilities, data fields, rate limits, quirks (Verity's research)\n- `.lore/reference/architecture-pattern.md` — daemon-first architecture pattern (Hono daemon, Next.js web, CLI discovery)\n\nThe MVP spec should define what we build first. It must be concrete enough to hand to a developer and say \"build this.\" Cover:\n\n1. **Scope** — What's in the MVP, what's explicitly deferred. The MVP should be the smallest thing that demonstrates the core value proposition: personal multi-axis ratings producing a transparent fitness score for owned games.\n\n2. **Data model** — What entities exist (games, axes, ratings, collections). What fields. What's stored locally vs fetched from BGG. Be specific about types.\n\n3. **Fitness score model** — Pick one approach from Celeste's brainstorm (or synthesize the best parts of multiple). Justify the choice for MVP. Define the math precisely enough to implement. Address: axis creation, rating scale, weighting, BGG data integration, aggregation formula, score breakdown/transparency.\n\n4. **BGG integration** — What endpoints we hit, what data we pull, how we handle rate limits and the authentication requirements Verity found. What's cached vs fetched on demand.\n\n5. **API surface** — Key daemon endpoints following the architecture pattern (operations registry, route/service split with DI). Don't design every endpoint, but define the core ones: add game, rate game, create axis, get fitness score, import from BGG collection.\n\n6. **Web UI** — Key screens/views for MVP. Keep it minimal. What does the user see and do?\n\n7. **CLI surface** — What commands exist at MVP. Follow the discovery pattern from the architecture doc.\n\n8. **What's deferred** — Explicitly list what the MVP does NOT include: prediction for unowned games, redundancy/collection-awareness, collection identity/profiling, etc. These are real features from the vision, deferred to post-MVP.\n\nWrite the spec to `.lore/specs/mvp.md`. Use the writing voice from the project (plain, direct, no hedging). Make decisions where decisions are needed; flag genuine open questions separately."
dependencies: []
linked_artifacts: []

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
current_progress: ""
projectName: shelf-judge
---
