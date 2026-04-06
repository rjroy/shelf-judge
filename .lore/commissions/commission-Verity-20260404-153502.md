---
title: "Commission: Research BGG API capabilities and access patterns"
date: 2026-04-04
status: completed
tags: [commission]
worker: Verity
workerDisplayTitle: "Guild Pathfinder"
prompt: "Research the Board Game Geek (BGG) API to understand what data we can pull and how.\n\nContext: We're building shelf-judge, a board game collection curation tool. Read `.lore/vision.md` for the full vision. We need BGG data as input to a fitness score model: community ratings, weight/complexity, mechanics, categories, player counts, play time, and potentially more.\n\nResearch and document:\n\n1. **API versions and endpoints** — BGG has had XML API v1 and v2. What's current? What endpoints exist (search, thing/game details, collection, user data, etc.)?\n2. **Data available per game** — What fields come back? Specifically: community rating, weight, mechanics, categories, player count range, play time, designer, year published, expansions, etc.\n3. **Collection endpoints** — Can we pull a user's BGG collection? What data comes with it (user ratings, play counts, owned/wishlisted status)?\n4. **Rate limiting and authentication** — Is there an API key? Rate limits? Terms of use?\n5. **Data format** — XML? JSON? Any official or popular wrapper libraries (especially TypeScript/JavaScript)?\n6. **Quirks and gotchas** — Known issues, deprecations, unofficial endpoints, things that break.\n7. **Alternative data sources** — Are there mirrors, dumps, or third-party APIs that provide BGG data more conveniently?\n\nWrite the research artifact to `.lore/research/bgg-api.md`."
dependencies: []
linked_artifacts:
  - .lore/research/bgg-api.md

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
  - timestamp: 2026-04-04T22:35:02.166Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-04T22:35:07.531Z
    event: progress_report
    reason: "Starting BGG API research. Reading project vision first, then surveying existing lore artifacts."
  - timestamp: 2026-04-04T22:35:16.437Z
    event: progress_report
    reason: "No cached research found. Starting fresh BGG API research via web sources."
  - timestamp: 2026-04-04T22:38:18.407Z
    event: progress_report
    reason: "Research complete. Found comprehensive data on BGG API v2 endpoints, response structure, the new 2025 authentication requirement (application tokens), rate limits, TypeScript libraries, and data format quirks. Writing artifact now."
  - timestamp: 2026-04-04T22:40:01.585Z
    event: result_submitted
    reason: "Research complete. Artifact written to `.lore/research/bgg-api.md`.\n\nKey findings:\n\n**API:** BGG XML API v2 (`https://boardgamegeek.com/xmlapi2/`) is the active API. XML-only, CORS-disabled (server-side only). Core endpoints for shelf-judge: `/thing` (game data), `/search`, `/collection` (user collections).\n\n**Game data available:** Community rating (`average`, `bayesaverage`/Geek Rating), weight/complexity (1–5, `averageweight`), mechanics and categories (via `<link>` elements), declared and community-voted player counts, play time, year published, designer, expansions, BGG rank, ownership count. Stats require `?stats=1` parameter.\n\n**Collection data:** Per-user owned/wishlisted/played status, personal rating, play count, private notes. Collection endpoint returns HTTP 202 (queued) frequently — requires retry loop with delay.\n\n**Critical 2025 change:** BGG now requires registered application tokens for API access. All requests must include `Authorization: Bearer TOKEN` header. Register at `boardgamegeek.com/using_the_xml_api`. Exception: downloading your own collection while logged in is exempt, but any multi-user or bulk access requires registration.\n\n**Rate limits:** No published limit; community uses 1 req/5s conservatively, ~2 req/s practical ceiling. Batch up to 250–500 IDs per thing request.\n\n**Known gotchas:** `averageweight=0` is a known bug (treat as missing); description text can be double-escaped; IDs are non-contiguous; always filter by `type=boardgame`.\n\n**TypeScript libraries:** `bgg-xml-api-client` explicitly handles the 2025 auth token requirement and 202 retry logic. `bgg` (monteslu, v3 Feb 2026) also viable. `bgg-client` has Zod schemas but needs verification for token support.\n\n**Alternative sources:** BGG provides a daily rank CSV (`/data_dumps/bg_ranks`) with minimal data (ID, name, rank, rating only — no mechanics/categories/weight). Useful as a seed but not sufficient alone."
  - timestamp: 2026-04-04T22:40:12.908Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Research complete. Found comprehensive data on BGG API v2 endpoints, response structure, the new 2025 authentication requirement (application tokens), rate limits, TypeScript libraries, and data format quirks. Writing artifact now."
projectName: shelf-judge
---

Research complete. Artifact written to `.lore/research/bgg-api.md`.

Key findings:

**API:** BGG XML API v2 (`https://boardgamegeek.com/xmlapi2/`) is the active API. XML-only, CORS-disabled (server-side only). Core endpoints for shelf-judge: `/thing` (game data), `/search`, `/collection` (user collections).

**Game data available:** Community rating (`average`, `bayesaverage`/Geek Rating), weight/complexity (1–5, `averageweight`), mechanics and categories (via `<link>` elements), declared and community-voted player counts, play time, year published, designer, expansions, BGG rank, ownership count. Stats require `?stats=1` parameter.

**Collection data:** Per-user owned/wishlisted/played status, personal rating, play count, private notes. Collection endpoint returns HTTP 202 (queued) frequently — requires retry loop with delay.

**Critical 2025 change:** BGG now requires registered application tokens for API access. All requests must include `Authorization: Bearer TOKEN` header. Register at `boardgamegeek.com/using_the_xml_api`. Exception: downloading your own collection while logged in is exempt, but any multi-user or bulk access requires registration.

**Rate limits:** No published limit; community uses 1 req/5s conservatively, ~2 req/s practical ceiling. Batch up to 250–500 IDs per thing request.

**Known gotchas:** `averageweight=0` is a known bug (treat as missing); description text can be double-escaped; IDs are non-contiguous; always filter by `type=boardgame`.

**TypeScript libraries:** `bgg-xml-api-client` explicitly handles the 2025 auth token requirement and 202 retry logic. `bgg` (monteslu, v3 Feb 2026) also viable. `bgg-client` has Zod schemas but needs verification for token support.

**Alternative sources:** BGG provides a daily rank CSV (`/data_dumps/bg_ranks`) with minimal data (ID, name, rank, rating only — no mechanics/categories/weight). Useful as a seed but not sufficient alone.
