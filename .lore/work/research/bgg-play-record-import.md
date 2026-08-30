---
title: BGG play record import
date: 2026-08-29
status: active
tags: [boardgamegeek, plays, xml-api, pagination]
modules: [daemon, bgg-client]
---

# BGG play record import

## Key Findings

- BGG XML API2 exposes play records at `/xmlapi2/plays`.
- Supplying both `username` and an item `id` restricts results to one collector and one BGG entry.
- Results are reverse chronological and paginated at 100 records per page with the `page` parameter.
- Play records expose a stable play `id` and a `quantity`; aggregation should deduplicate by `id` and sum each unique record's quantity.
- The endpoint accepts one item ID per request, so related entries require separate paginated requests.
- BGG recommends about five seconds between XML API requests and may return 500 or 503 when throttled. Shelf Judge's existing queued request and retry behavior should remain the request boundary.

## Implications

The collection endpoint's `numplays` aggregate cannot identify duplicate records returned for multiple related entries. Shelf Judge should retain that path for games with only a primary BGG ID, preserving existing behavior, and use play-record retrieval when a game has additional BGG IDs. The record path must finish all pages before replacing current play evidence; a partial result must not be persisted as a complete count.

## Source

- [BoardGameGeek XML API2: Plays](https://boardgamegeek.com/wiki/page/BGG_XML_API2#toc12), accessed 2026-08-29.
