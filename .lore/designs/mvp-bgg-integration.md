---
title: "MVP BGG Integration"
date: 2026-04-04
status: implemented
tags: [design, bgg, api, integration, mvp]
modules: [daemon]
related:
  - .lore/specs/mvp.md
  - .lore/research/bgg-api.md
---

# Design: MVP BGG Integration

Satisfies: REQ-MVP-3, REQ-MVP-7, REQ-MVP-10, REQ-MVP-11, REQ-MVP-12, REQ-MVP-13, REQ-MVP-18, REQ-MVP-19

## Application Token

All BGG API requests require an `Authorization: Bearer TOKEN` header. The token is registered at `https://boardgamegeek.com/using_the_xml_api` and stored in `~/.shelf-judge/config.json`.

The daemon validates the token is present on startup. If missing, API-dependent operations return a clear error: "BGG application token not configured. Register at [URL] and run `shelf-judge config set bgg-token YOUR_TOKEN`."

## Endpoints Used

**Thing endpoint** (`/xmlapi2/thing`):

- Used when adding a game by BGG ID or after search
- Parameters: `id={bggId}&stats=1&type=boardgame`
- Supports comma-delimited IDs for batch fetch (up to 250 per request)
- Provides: name, player count, play time, year, mechanics, categories, families, community rating, weight, suggested player counts

**Search endpoint** (`/xmlapi2/search`):

- Used when the user searches for a game by name
- Parameters: `query={name}&type=boardgame`
- Returns: ID, name, year only. A follow-up Thing request is needed for full data.

**Collection endpoint** (`/xmlapi2/collection`):

- Used for bulk import from a BGG user's public collection
- Parameters: `username={bggUsername}&own=1&subtype=boardgame&stats=1`
- Returns: all owned games with basic stats
- **202 handling required:** This endpoint returns HTTP 202 when queued. The daemon retries with exponential backoff: 5s, 10s, 20s, up to 3 retries. If still 202 after retries, return an error to the client.

## Rate Limiting

No officially published limits. The daemon enforces a conservative request throttle:

- **Default:** 1 request per 5 seconds
- **Batch thing requests:** Up to 250 IDs per call, reducing total request count
- **429 response:** Back off 30 seconds, then resume at 1 req/10s, gradually returning to normal
- **502/503 response:** Retry after 30 seconds, up to 2 retries

Rate limiting is handled in the BGG client service, not in individual route handlers.

## Caching

BGG data is cached in the `bggData` field of each Game record. Cache invalidation:

- **Default TTL:** 7 days. BGG data (ratings, weight) changes slowly.
- **Manual refresh:** User can trigger a refresh for a single game or the entire collection.
- **Stale data is fine.** Community rating shifting from 7.8 to 7.9 doesn't materially change a fitness score. Prefer fewer API calls over fresher data.

## XML Parsing

The BGG API returns XML only. The daemon uses an XML parsing library (e.g., `fast-xml-parser`) to convert responses to typed objects. Known quirks to handle:

- `averageweight` of 0 is treated as null (known BGG bug)
- Primary name is the `<name>` element with `type="primary"`
- `<median>` is always 0; ignored

## Library Decision

Deferred to implementation. The research identifies several viable TypeScript libraries (`bgg-xml-api-client`, `bgg-sdk`, `bgg`). The implementer should verify that the chosen library handles the 2025 auth token requirement before committing. If no library handles it cleanly, a thin custom client over `fast-xml-parser` is acceptable; the API surface we use is small (three endpoints).
