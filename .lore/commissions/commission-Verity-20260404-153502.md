---
title: "Commission: Research BGG API capabilities and access patterns"
date: 2026-04-04
status: dispatched
tags: [commission]
worker: Verity
workerDisplayTitle: "Guild Pathfinder"
prompt: "Research the Board Game Geek (BGG) API to understand what data we can pull and how.\n\nContext: We're building shelf-judge, a board game collection curation tool. Read `.lore/vision.md` for the full vision. We need BGG data as input to a fitness score model: community ratings, weight/complexity, mechanics, categories, player counts, play time, and potentially more.\n\nResearch and document:\n\n1. **API versions and endpoints** — BGG has had XML API v1 and v2. What's current? What endpoints exist (search, thing/game details, collection, user data, etc.)?\n2. **Data available per game** — What fields come back? Specifically: community rating, weight, mechanics, categories, player count range, play time, designer, year published, expansions, etc.\n3. **Collection endpoints** — Can we pull a user's BGG collection? What data comes with it (user ratings, play counts, owned/wishlisted status)?\n4. **Rate limiting and authentication** — Is there an API key? Rate limits? Terms of use?\n5. **Data format** — XML? JSON? Any official or popular wrapper libraries (especially TypeScript/JavaScript)?\n6. **Quirks and gotchas** — Known issues, deprecations, unofficial endpoints, things that break.\n7. **Alternative data sources** — Are there mirrors, dumps, or third-party APIs that provide BGG data more conveniently?\n\nWrite the research artifact to `.lore/research/bgg-api.md`."
dependencies: []
linked_artifacts: []

resource_overrides:
  model: sonnet

activity_timeline:
  - timestamp: 2026-04-04T22:35:02.150Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-04T22:35:02.152Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
