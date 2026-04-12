---
title: "Audience with Guild Master"
date: 2026-04-12
status: closed
tags: [meeting]
worker: Guild Master
workerDisplayTitle: "Guild Master"
agenda: "Next Up"
deferred_until: ""
linked_artifacts: []
meeting_log:
  - timestamp: 2026-04-12T05:09:41.476Z
    event: opened
    reason: "User started audience"
  - timestamp: 2026-04-12T18:04:42.254Z
    event: closed
    reason: "User closed audience"
---
MEETING NOTES: REDUNDANCY SETTINGS UX & WISHLIST PLANNING
2026-04-12

SUMMARY

Guild Master identified a critical UX gap in the redundancy feature: its settings interface is undiscoverable, buried as a collapsible panel on the collection page with no sidebar navigation entry. The user cannot interact with the feature without stumbling into it. Simultaneously, mockup generation and planning were commissioned for the wishlist feature.

REDUNDANCY SETTINGS ISSUES IDENTIFIED

The current implementation auto-saves settings changes without triggering a regeneration pass, creating a disconnect between user mental model ("I save settings to update the games") and system behavior ("changing a setting saves it, but you must separately normalize fitness to apply changes"). Users expect a Save button that both persists settings and triggers the scoring recalculation. The feature needs a dedicated page under a Settings sidebar section, not a hidden collapsible panel.

KEY DECISION: SETTINGS CONSOLIDATION APPROACH

Three separate settings surfaces now exist across the app (prediction settings, niche tag settings, redundancy settings) with no central home. Proposed solution: Create a dedicated Settings page accessible from sidebar navigation, consolidating all three. This gives redundancy (and the other settings features) proper discoverability and consistent UX.

OPEN ITEM: PLANNING GATE

User asked whether the redundancy settings work is direct enough to hand directly to Dalton (implementer) or if Octavia (planner) should prepare a formal plan first to prevent mistakes. Decision pending.

ARTIFACTS REFERENCED

`.lore/specs/redundancy-scoring.md` (plan structure showing settings panel placement, decision to put on collection page)
`.lore/specs/wishlist.md` (new feature spec)
`.lore/mockups/mockup-search-wishlist.html` and `.lore/mockups/mockup-wishlist.html` (reference designs for wishlist UI)

FOLLOW-UPS

Commission Octavia to plan a Settings consolidation page (or confirm Dalton can proceed with direct requirements). Determine scope: does this include moving other settings, or just redundancy as first entry.
