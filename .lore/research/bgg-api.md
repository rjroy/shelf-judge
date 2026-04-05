---
title: "BGG XML API Research"
date: 2026-04-04
status: approved
tags: [research, bgg, api, external]
---

# BGG XML API Research

**Purpose:** Understand what data is available from Board Game Geek's API and how to access it, for use as input to shelf-judge's fitness score model.

---

## 1. API Versions and Endpoints

### Current: XML API v2

Base URL: `https://boardgamegeek.com/xmlapi2/`

This is the active API. v1 (`https://boardgamegeek.com/xmlapi/`) is legacy and functionally deprecated — it still responds but the community has standardized on v2.

Available endpoints:

| Endpoint | Path | Purpose |
|----------|------|---------|
| Thing | `/thing` | Detailed game data by BGG ID |
| Search | `/search` | Full-text search by name |
| Collection | `/collection` | User's game collection |
| User | `/user` | User profile, top10, hot10 |
| Plays | `/plays` | Play history for a user or game |
| Hot | `/hot` | Trending items |
| Family | `/family` | Game families/series |
| Guild | `/guild` | Guild membership data |
| Forum | `/forum` | Forum threads |
| Forumlist | `/forumlist` | Forum list for an item |
| Thread | `/thread` | Individual forum thread |
| Geeklist | `/geeklist` | Community-curated lists |

---

## 2. Game Data: Thing Endpoint

### Request

```
GET https://boardgamegeek.com/xmlapi2/thing?id=174430&stats=1&type=boardgame
```

Key parameters:
- `id`: Comma-delimited BGG game ID(s). Multiple IDs are batched in one request.
- `type`: Filter by type (`boardgame`, `boardgameexpansion`, `boardgameaccessory`, etc.). Recommended to always include.
- `stats=1`: **Required** to get ratings and weight data. Without this, statistics block is absent.
- `versions=1`, `videos=1`, `marketplace=1`, `comments=1`: Optional enrichment.

### Response Structure (XML)

Root: `<items>` → `<item>` per game

**Core fields** (attributes or child elements with `value` attribute):

```xml
<item type="boardgame" id="174430">
  <thumbnail>...</thumbnail>
  <image>...</image>
  <name type="primary" sortindex="1" value="Gloomhaven"/>
  <name type="alternate" sortindex="1" value="..."/>
  <description>...</description>
  <yearpublished value="2017"/>
  <minplayers value="1"/>
  <maxplayers value="4"/>
  <playingtime value="120"/>
  <minplaytime value="60"/>
  <maxplaytime value="120"/>
  <minage value="14"/>
```

**Link elements** (type attribute identifies the relationship):

```xml
<link type="boardgamecategory" id="1022" value="Adventure"/>
<link type="boardgamemechanic" id="2023" value="Cooperative Game"/>
<link type="boardgamedesigner" id="69802" value="Isaac Childres"/>
<link type="boardgameartist" id="69802" value="..."/>
<link type="boardgamepublisher" id="..." value="Cephalofair Games"/>
<link type="boardgamefamily" id="..." value="..."/>
<link type="boardgameexpansion" id="..." value="..." inbound="true"/>
<link type="boardgameimplementation" id="..." value="..."/>
<link type="boardgamesubdomain" id="..." value="Strategy Games"/>
```

**Polls** (community voting data):

```xml
<poll name="suggested_numplayers" title="User Suggested Number of Players" totalvotes="843">
  <results numplayers="1">
    <result value="Best" numvotes="112"/>
    <result value="Recommended" numvotes="341"/>
    <result value="Not Recommended" numvotes="87"/>
  </results>
  <!-- repeated for 2, 3, 4, 4+ -->
</poll>
<poll name="suggested_playerage" title="User Suggested Player Age" totalvotes="...">
  <results>
    <result value="14" numvotes="..."/>
    <!-- ... -->
  </results>
</poll>
<poll name="language_dependence" title="Language Dependence" totalvotes="...">
  <!-- Low/Moderate/High bins -->
</poll>
```

**Statistics block** (requires `stats=1`):

```xml
<statistics page="1">
  <ratings>
    <usersrated value="76543"/>
    <average value="8.62"/>           <!-- community average rating (1-10) -->
    <bayesaverage value="8.48"/>       <!-- BGG "Geek Rating" (Bayesian, penalizes low vote counts) -->
    <stddev value="1.23"/>
    <median value="0"/>
    <owned value="120000"/>
    <trading value="1200"/>
    <wanting value="3400"/>
    <wishing value="18000"/>
    <numcomments value="12000"/>
    <numweights value="15000"/>
    <averageweight value="3.86"/>      <!-- complexity/weight (1=light, 5=heavy) -->
    <ranks>
      <rank type="subtype" id="1" name="boardgame" friendlyname="Board Game Rank" value="1" bayesaverage="8.48"/>
      <rank type="family" id="5497" name="strategygames" friendlyname="Strategy Game Rank" value="3" bayesaverage="8.45"/>
    </ranks>
  </ratings>
</statistics>
```

### Complete field inventory for shelf-judge fitness model

| Field | Source | Notes |
|-------|--------|-------|
| Community rating | `<average>` in stats | Mean of user ratings |
| BGG Geek Rating | `<bayesaverage>` in stats | Bayesian average; penalizes games with few votes — more reliable for ranking |
| Weight/complexity | `<averageweight>` in stats | 1–5 scale; requires `stats=1` |
| Vote count for weight | `<numweights>` in stats | Confidence indicator |
| Mechanics | `<link type="boardgamemechanic">` | Multiple, each with ID + name |
| Categories | `<link type="boardgamecategory">` | Multiple, each with ID + name |
| Player count range | `<minplayers>`, `<maxplayers>` | Declared by publisher |
| Best player counts | `<poll name="suggested_numplayers">` | Community-voted; richer than min/max |
| Play time | `<minplaytime>`, `<maxplaytime>`, `<playingtime>` | Publisher-declared |
| Year published | `<yearpublished>` | |
| Designer | `<link type="boardgamedesigner">` | |
| Publisher | `<link type="boardgamepublisher">` | |
| Expansions | `<link type="boardgameexpansion">` | Identifies expansion relationships |
| Base game (if expansion) | `<link type="boardgameexpansion" inbound="true">` | |
| Ownership count | `<owned>` in stats | Popularity signal |
| Subdomains | `<link type="boardgamesubdomain">` | Broad categorization (Strategy, Family, etc.) |
| BGG rank | `<rank type="subtype" name="boardgame">` | Overall rank on BGG |
| Language dependence | `<poll name="language_dependence">` | Accessibility signal |

---

## 3. Collection Endpoint

### Request

```
GET https://boardgamegeek.com/xmlapi2/collection?username=USERNAME&own=1&stats=1
```

Key parameters:

| Parameter | Description |
|-----------|-------------|
| `username` | Required. BGG username. |
| `subtype` | `boardgame` (default), `boardgameexpansion`, etc. |
| `own` | `1`/`0` — owned items |
| `wishlist` | `1`/`0` — wishlisted items |
| `want` | `1`/`0` — want in trade |
| `want_to_play` | `1`/`0` |
| `want_to_buy` | `1`/`0` |
| `prev_owned` | `1`/`0` — previously owned |
| `trade` | `1`/`0` — for trade |
| `played` | `1`/`0` — has been played |
| `rated` | `1`/`0` — has been rated |
| `stats=1` | Include BGG community stats per item |
| `showprivate=1` | Include private acquisition data (requires auth as that user) |
| `modified_since` | Filter by last status change date |

### Response structure

Each `<item>` in the collection includes:
- `<name>` — game title
- `<yearpublished>` — year
- `<image>`, `<thumbnail>` — artwork URLs
- `<stats>` — basic stats if `stats=1` (minplayers, maxplayers, minplaytime, maxplaytime, numowned, and rating stats)
- `<status>` — flags: `own`, `prevowned`, `fortrade`, `want`, `wanttoplay`, `wanttobuy`, `wishlist`, `preordered`
- `<numplays>` — number of times the user has logged plays
- `<rating value="N.NN">` — user's personal rating (or "N/A" if unrated)
- `<comment>` — user's comment on the game
- `<privateinfo>` — private data (acquisition price, location, etc.) when `showprivate=1` and authenticated

### 202 Response — Queued Processing

**Critical behavior:** The collection endpoint frequently returns HTTP 202 (Accepted) when a request is received, indicating the server has queued the collection for processing. The actual data is not returned on this response. You must retry the same request after a delay (5–10 seconds recommended) until you receive a 200 response.

This is not an error — it is expected behavior. Any collection fetch implementation must include a retry loop.

---

## 4. Search Endpoint

```
GET https://boardgamegeek.com/xmlapi2/search?query=GAME+NAME&type=boardgame
```

Returns a list of matching items with: `id`, `name`, `yearpublished`. Does not include stats, mechanics, or ratings — those require a follow-up `/thing` request.

Use `exact=1` to require exact name match.

---

## 5. Authentication and Registration

### New requirement (effective 2025)

**BGG now requires registered application tokens for XML API access.** This was announced mid-2025 and enforced through late 2025.

All API requests must include an `Authorization` header:
```
Authorization: Bearer YOUR_APPLICATION_TOKEN
```

Registration is available at `https://boardgamegeek.com/using_the_xml_api` under "Application Tokens."

**Exceptions to registration requirement:**
- A user downloading only their own collection while logged in does not require registration.
- However, any application accessing multiple users' collections, or bulk game data, requires registration.

**User authentication (separate from app token):**
If you need to access private collection data or write operations (logging plays), you must also authenticate as a user via:
```
POST https://boardgamegeek.com/login/api/v1
```
This sets session cookies (`SessionID`, `bgg_password`, `bgg_username`) that must accompany subsequent requests. Note: cookie handling is quirky — the server sets `bgg_username` and `bgg_password` twice, once with a valid expiry and once with a deletion (Unix epoch +1s). Libraries like Python's `requests` handle this correctly; manual cookie handling in curl/Insomnia may not.

---

## 6. Rate Limits

No officially published rate limit. Community consensus:
- **Safe rate:** 1 request per 5 seconds (used by several libraries)
- **Practical limit:** ~2 requests per second before seeing 429 responses
- **Batch size:** Pass comma-delimited IDs to the thing endpoint; 250–500 IDs per request is optimal. Requests exceeding ~1,000 IDs can trigger blocking.

HTTP response codes to handle:
- `200` — Success
- `202` — Queued (collection endpoint); retry after delay
- `429` — Rate limited; back off
- `502`/`503` — Server errors; retry after ~30 seconds

---

## 7. Data Format

**XML only** for the v2 API. No official JSON endpoint exists.

**CORS disabled** — API cannot be called from browser JavaScript directly. All requests must be server-side.

### Known XML quirks

- **Double-escaped descriptions:** Some game descriptions (particularly Japanese titles) exhibit double-encoded HTML entities. Parse carefully.
- **`averageweight` returns 0 for some games:** A known bug (reported ~2023, partially resolved) where some valid games return `averageweight=0` in the API response despite showing a nonzero weight on the website. Treat `0` as missing data rather than "no complexity votes."
- **Non-contiguous IDs:** BGG game IDs are not sequential with no gaps. IDs include non-boardgame items. When crawling by ID range, filter by `type=boardgame` and expect empty/irrelevant results.
- **`<name>` ordering:** A game may have multiple `<name>` elements. The primary name has `type="primary"`.
- **`<median>` always 0:** BGG's statistics endpoint always returns `median=0`. Use `average` or `bayesaverage` instead.

---

## 8. TypeScript / JavaScript Libraries

For shelf-judge (TypeScript project), these are the viable options:

| Library | Status | Notes |
|---------|--------|-------|
| **bgg-xml-api-client** ([npm](https://www.npmjs.com/package/bgg-xml-api-client), [GitHub](https://github.com/Qrzy/bgg-xml-api-client)) | Active | Handles auth tokens; supports `authorizationKey` param; has retry logic for 202 responses; returns JSON. Best fit for new projects. |
| **bgg** ([npm](https://www.npmjs.com/package/bgg), [GitHub](https://github.com/monteslu/bgg)) | Active (v3.0 Feb 2026) | Uses `fast-xml-parser`; converts XML to JSON; supports all v2 endpoints. Recently updated. |
| **bgg-client** ([GitHub](https://github.com/ghall89/bgg-client)) | Active | TypeScript; uses Zod for schemas; built-in rate limiting (1 req/5s); requires manual API key. |
| **bgg-sdk** ([npm](https://www.npmjs.com/package/bgg-sdk)) | Active | Modern TypeScript SDK; full XMLAPI2 support; XML→JSON conversion. |
| **boardgamegeekjsclient** ([GitHub](https://github.com/LearningProcesss/boardgamegeekjsclient)) | Uncertain | TypeScript wrapper for XML2 API; activity level unclear. |

**Recommendation context:** `bgg-xml-api-client` is the most actively maintained library that explicitly handles the 2025 auth token requirement. `bgg` (monteslu) was updated to v3 in February 2026 and may have added token support. Verify token handling before committing to any library.

---

## 9. Alternative Data Sources

### Official BGG data dump

BGG provides a daily CSV download:
- URL: `https://boardgamegeek.com/data_dumps/bg_ranks`
- Requires: BGG login
- Contains: game ID, name, year, BGG rank, average rating, number of raters
- **Missing:** mechanics, categories, weight, player counts, play time, expansions, individual user data

This is useful as a lightweight seed (get all game IDs + basic ranking), but mechanics/categories/weight require the XML API.

### Third-party proxies and scrapers

- **tnaskali/bgg-api** ([GitHub](https://github.com/tnaskali/bgg-api)): Spring Boot proxy exposing XML, JSON, and GraphQL APIs over BGG's underlying APIs. Production-quality but requires self-hosting.
- **Board-Game-Buddy/board-game-geek-data** ([GitHub](https://github.com/Board-Game-Buddy/board-game-geek-data)): Microservice that parses BGG's rank CSV into its own database.

No BGG-licensed JSON API exists. Third-party wrappers all ultimately hit the XML API — they're convenience layers, not alternate data sources.

---

## 10. Summary for shelf-judge

**What we can get per game:**
- Community rating (average, bayesaverage/Geek Rating)
- Weight/complexity (1–5, community-voted)
- Mechanics (full list, each with ID + name)
- Categories (full list, each with ID + name)
- Declared player count (min/max)
- Community-voted best player counts (from suggested_numplayers poll)
- Play time (min/max/typical)
- Year published, designer, publisher
- Expansion relationships
- BGG rank, ownership count, wishlist count

**What requires a user's BGG account:**
- User's personal rating on a game
- Play count per game
- Collection status (owned, wishlisted, etc.)
- Private collection notes

**What we cannot get:**
- Play history details beyond count (without user auth)
- Personal ratings for other users without their auth

**Critical implementation notes:**
1. Register for an application token before building anything that makes API calls.
2. Always include `Authorization: Bearer TOKEN` header.
3. Implement 202 retry logic for collection endpoint.
4. Use `stats=1` on thing endpoint to get weight and rating data.
5. Filter by `type=boardgame` to exclude non-game content.
6. Treat `averageweight=0` as missing, not "unweighted."
7. API is XML-only and CORS-disabled — all fetches must be server-side.

---

## Sources

- [BGG XML API2 Wiki](https://boardgamegeek.com/wiki/page/BGG_XML_API2) — official documentation (403 on direct fetch, access via BGG account)
- [Using the XML API — BGG](https://boardgamegeek.com/using_the_xml_api) — auth/registration page
- [Registration and Authorization announcement thread](https://boardgamegeek.com/thread/3492262/registration-and-authorization-coming-to-the-xml-a) — 2025 token requirement
- [bgg-xml-api-client npm](https://www.npmjs.com/package/bgg-xml-api-client) — TS library with auth support
- [bgg npm (monteslu)](https://www.npmjs.com/package/bgg) — Node.js client
- [bgg-client GitHub](https://github.com/ghall89/bgg-client) — TypeScript client with Zod
- [BGG API Python data fetching (drangovski)](https://drangovski.com/posts/boardgamegeek-python-data-fetching/) — concrete XML field examples
- [Exploring Boardgames: Data Download (Mixed Conclusions)](https://mixedconclusions.com/blog/boardgames_part_one/) — implementation notes, batch behavior, response codes
- [bgg-api Python docs (readthedocs)](https://bgg-api.readthedocs.io/en/stable/modules.html) — comprehensive field documentation
- [averageweight=0 bug thread](https://boardgamegeek.com/thread/3078396/bgg-xml-api2-bug-some-items-returning-averageweigh) — known data quality issue
- [BGG data_dumps thread](https://boardgamegeek.com/thread/3175068/csv-download-of-all-games-with-their-ranks) — bulk CSV info
- [tnaskali/bgg-api GitHub](https://github.com/tnaskali/bgg-api) — Spring Boot proxy with GraphQL
