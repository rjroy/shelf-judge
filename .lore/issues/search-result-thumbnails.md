---
title: Search result thumbnails
date: 2026-04-06
status: open
tags: [ui, bgg, search]
modules: [daemon, web]
---

# Search result thumbnails

BGG search results don't display game thumbnails. `BggSearchResult` only returns `bggId`, `name`, and `yearPublished`. Adding thumbnails requires the daemon to include the thumbnail URL from BGG's search response in the result shape, and the web UI to render it.
