---
title: "Deferred filter types from collection filter/sort spec"
date: 2026-04-10
status: open
tags: [deferred, collection-filter, low-priority]
modules: [web]
related: [.lore/specs/collection-filter-sort.md]
---

# Deferred Filter Types

The filter/sort spec (`.lore/specs/collection-filter-sort.md`, lines 178-188) lists 8 filter types explicitly deferred from the first pass:

1. Score range (min/max slider)
2. Play time range
3. BGG mechanics/categories tag filter
4. Year published range
5. BGG subdomain filter
6. Axis-specific rating range ("show me games rated above 7 on complexity")
7. Tournament provisional status
8. Has BGG data / manually added

## Validation (2026-04-11)

**Claim validated, remedy adjusted.**

The original issue claimed these had "no backlog visibility." That was true at time of filing, none had individual issues. But the spec's deferred section is clear, the items are enumerated with enough detail to act on, and the architecture note confirms they slot in without structural changes (AND-combining filter predicates in the client component).

**Current state:** None of these are implemented. The `FilterState` in `packages/web/lib/collection-utils.ts` has four fields: `search`, `ratedStatus`, `playedStatus`, `playerCount`. The underlying data for most of these filters (mechanics, categories, subdomains, year, play time, scores) already exists in the game data model.

**This issue is the tracking artifact.** Filing 8 individual issues would fragment tracking without adding information. When the user decides to implement a batch, this issue plus the spec's deferred section provide sufficient context. Individual issues should be filed at that point for whichever subset is chosen.
