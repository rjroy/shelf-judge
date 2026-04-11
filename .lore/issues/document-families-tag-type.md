---
title: "Document 'families' as a BGG tag type alongside mechanics/categories"
date: 2026-04-11
status: open
tags: [docs, bgg, profiling, data-model]
---

BGG game data includes `families` as a tag type (e.g., "Game: Catan", "Crowdfunding: Kickstarter"). The codebase already imports and stores families, but specs and design docs only reference mechanics and categories as the two BGG tag types used for profiling, filtering, and feature vectors.

This caused families to be missed during collection profiling implementation, requiring a manual fix.

Docs to update:

- `.lore/designs/mvp-bgg-integration.md` (enumerate all tag types including families)
- `.lore/specs/collection-profiling.md` (feature vector inputs reference mechanics/categories but not families)
- Any future spec that consumes BGG tag data should treat families as a peer to mechanics and categories
