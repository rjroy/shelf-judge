---
title: "Shelf Judge: Fitness Model Kickoff"
date: 2026-04-04
status: closed
tags: [meeting]
worker: Guild Master
workerDisplayTitle: "Guild Master"
agenda: "First step"
deferred_until: ""
linked_artifacts: []
meeting_log:
  - timestamp: 2026-04-04T22:05:23.487Z
    event: opened
    reason: "User started audience"
  - timestamp: 2026-04-04T22:28:05.323Z
    event: renamed
    reason: "Renamed to: Shelf Judge: Fitness Model Kickoff"
  - timestamp: 2026-04-06T04:01:23.704Z
    event: closed
    reason: "User closed audience"
---
**Summary**

During review of the BGG import rate limiting implementation, the team confirmed that Dalton's code correctly implements the research-documented behavior: 5-second default delays, 429 throttling with 30-second backoff, 202 retry with exponential backoff, and batched requests. However, testing revealed a discrepancy between documented limits and BGG's actual API behavior. The research document specified 250–500 IDs per batch request based on community consensus, but BGG's API returns HTTP 400 with "Cannot load more than 20 items" when attempting to batch larger requests. The batch size constant in `bgg-client.ts` must be reduced from 250 to 20 to match BGG's actual enforcement. This appears to be either a tightening of limits by BGG or incomplete documentation in the research artifact gathered from public sources.

**Key Decisions**

The batch fetch size constant (`MAX_BATCH_SIZE`) in `packages/daemon/src/services/bgg-client.ts` will be corrected from 250 to 20. The BGG XML API research document will be updated to reflect the actual observed limit and note the discrepancy between published community consensus and BGG's enforced behavior. No architectural changes required; this is a parameter correction only.

**Artifacts Referenced**

.lore/research/bgg-xml-api-research.md (requires update to section 6, batch size documentation); packages/daemon/src/services/bgg-client.ts (constant correction); commission for Dalton assigned to execute both fixes.

**Open Items**

Commission-Dalton-20260405-201129 (in progress): Update MAX_BATCH_SIZE constant and correct research documentation. Testing of refresh-all feature after fix completes.
