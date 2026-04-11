---
title: "Deferred filter types have no backlog visibility"
date: 2026-04-10
status: open
tags: [gap, backlog, collection-filter]
modules: [web, daemon]
related: [.lore/retros/commission-cleanup-2026-04-10.md]
---

# Deferred Filter Types Have No Backlog Visibility

USER NOTE: I'm dubious of this claim. Validate before further action.

## What Happened

The filter/sort spec lists 8 deferred filter types that were never filed as issues:

1. Score range
2. Play time range
3. BGG mechanics
4. BGG categories
5. Year published range
6. BGG subdomain
7. Axis-specific rating range
8. Tournament provisional status
9. Has BGG data

These exist only as a deferred section in the spec. Anyone reading the issue backlog has no visibility into this planned work.

## Why It Matters

Deferred items in specs don't automatically become trackable work. Without explicit issues, these filter types are invisible to planning, prioritization, and anyone who isn't reading the spec line by line. The pattern of deferred-but-untracked items has been identified as a recurring gap in this project.

## Fix Direction

File individual issues for each deferred filter type, or group them into a single tracking issue with a checklist. The grouping depends on whether they'll be implemented independently or as a batch.
