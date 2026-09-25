---
title: BGG discovery beyond title search for Collection Analyst
date: 2026-09-25
status: active
tags: [bgg, discovery, analyst, api, research]
modules: [daemon, web, shared]
related:
  - .lore/work/specs/collection-analyst-bgg-discovery.md
  - .lore/archive/research/bgg-api.md
  - .lore/reference/designs/mvp-bgg-integration.md
---

# BGG Discovery Beyond Title Search for Collection Analyst

## Key Findings

- A request like “find deck-building games published this year that I might like” **cannot be expressed as a documented XML API2 `/search` query**. Its `query` is name/title search, with `type` and optional `exact`; it is not free-form natural-language search or a year/mechanic filter.
- `/hot?type=boardgame` supplies a bounded, activity-biased candidate pool. Fetching candidates through `/thing` and checking `yearpublished` and `boardgamemechanic` locally can find *some* matching games, but **cannot claim exhaustive coverage** or infer that the owner will like them.
- BGG's website advanced search can serve the owner directly, but no equivalent advanced-filter API was found in documented XML API2. A large, licensed catalogue/index route might expand coverage, but would require separate authorization, update, and scope decisions; a rank export is not necessarily a complete all-games catalogue.
- Shelf Judge currently implements only title search (`BggClient.searchGames`) and ID-based Thing detail (`getGame`/`getGames`). It has no hot endpoint or facet discovery capability. Existing local prediction can estimate fitness **after** a candidate is known, with readiness and confidence limitations.

## Endpoint evidence and limits

| Source | Documented discovery role | What it cannot promise |
| --- | --- | --- |
| [`/xmlapi2/search`](https://boardgamegeek.com/wiki/page/BGG_XML_API2) | Name query; `type=boardgame`; optional `exact=1`. Result identity, name, year. | Search by year or mechanic, semantic discovery, completeness for titles unrelated to the query. |
| [`/xmlapi2/hot`](https://boardgamegeek.com/wiki/page/BGG_XML_API2) | Most-active items by type, including `boardgame`. | Filtering by mechanic/year or personal relevance; coverage of games not currently hot. |
| [`/xmlapi2/thing`](https://boardgamegeek.com/wiki/page/BGG_XML_API2) | Resolve IDs into game records with year and linked mechanics; optional `stats=1` for community statistics. | Generate the initial set of IDs, or treat community rating as owner preference. |
| [BGG website advanced search](https://boardgamegeek.com/advsearch/boardgame) | Owner-facing exploration of BGG's website filters. | A documented machine-readable XML API2 advanced-search contract. |
| [BGG data export / API access](https://boardgamegeek.com/using_the_xml_api) | Potential larger name/rank seed, subject to approval and licensing. | Guaranteed complete, current list of every game or a cheap on-demand discovery query. |

The official XML API2 wiki and terms pages returned HTTP 403 during this research. Endpoint details above come from indexed excerpts of the official wiki, corroborated where possible with the existing client and [archived local API research](../../archive/research/bgg-api.md); live page-body wording, item-batch maxima, exact-match reliability, current data-use terms, and quota details remain unverified. The [Using the XML API](https://boardgamegeek.com/using_the_xml_api) page was indexed as requiring application bearer-token authorization. Do not hard-code a reported request maximum or treat the CSV as an authorized source without checking current BGG documentation and permissions.

## Product implications

**Small first step:** Offer title lookup and a separately labeled **Explore hot board games** source. For hot IDs, fetch bounded Thing details through the daemon's existing authorized BGG client, filter by requested year and *verified* mechanic ID, and calculate the existing local preview/prediction for a small owner-selected set. Make the candidate-selection gate and privacy policy explicit. Results must say “among currently hot games checked” and report the number checked, never “the best deck builders this year.” If no matches are found, report limited coverage rather than “there are none.”

**Broader discovery:** If the owner's actual goal is searching *all* recent deck builders, investigate whether an authorized catalogue/index can be maintained and filtered locally, or whether BGG's website advanced search is the only appropriate broad route. Estimate data completeness, update frequency, hosting/storage, token/terms, request volume, and whether expansions are included before promising this flow. Unbounded scanning of BGG IDs or pretending `/search?query=deck-building` searches mechanics is not a viable design.

**Personalization:** Candidate generation, factual filtering, and “might like” are distinct steps. After factual filtering, existing predicted fitness and reference games can offer a tentative personal signal, subject to stage, confidence, and metadata coverage. Community rankings and `/hot` are discovery signals only, not preference evidence. Owner chooses which candidates to preview; no automatic purchase or collection mutation.

## Current implementation anchors

- `packages/daemon/src/services/bgg-client.ts`: `searchGames` issues `/search?query=…&type=boardgame` and enriches the first 20 results for thumbnails; `getGame` fetches Thing detail. No `/hot` operation exists.
- `packages/daemon/src/services/bgg-xml-parser.ts`: parsed search entries include BGG ID, primary name, and year; Thing parsing includes linked metadata.
- `packages/web/app/search/page.tsx`: title-only UI with ID/name/year/thumbnail results, no mechanic/year facets.
- `.lore/reference/specs/fitness/prediction-engine.md`: non-persisted BGG-ID preview and stage-0 prediction behavior.

## Open verification questions

1. Confirm current official API docs/terms through an authorized browser or direct access: Hot response size/ordering, Thing batch maximum, token requirements, allowed caching or storage, and permissible automated catalogue download.
2. Confirm BGG's canonical deck-building mechanic ID and whether the owner means exactly that mechanic, a family of related mechanisms, or natural-language similarity. A title/year match alone cannot answer this.
3. Confirm whether the product needs an intentionally narrow **hot-based sampler** or genuinely broad discovery. The latter changes data sourcing and may require an independently approved design/spec revision.

## Sources

- [BGG XML API2 documentation](https://boardgamegeek.com/wiki/page/BGG_XML_API2) (indexed excerpts; direct fetch blocked)
- [BGG XML API access and application token](https://boardgamegeek.com/using_the_xml_api) (indexed excerpt)
- [BGG XML API terms](https://boardgamegeek.com/wiki/page/XML_API_Terms_of_Use) (direct fetch blocked)
- [BGG advanced search](https://boardgamegeek.com/advsearch/boardgame)
- [Community Postman XML API notes](https://www.postman.com/1toddlewis/boardgamegeek/documentation/xppe6sp/bgg-xml-api) (secondary; exact-match caveat not verified)
