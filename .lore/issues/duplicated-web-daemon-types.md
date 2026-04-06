---
title: Consolidate duplicated types between web and daemon packages
date: 2026-04-05
status: open
tags: [cleanup, types, shared-package]
modules: [web-api, daemon-services, shared]
---

# Consolidate duplicated types

`packages/web/lib/api.ts` independently defines interfaces that mirror daemon types: `GameWithScore`, `AddGameResult`, `ImportProgress`, `ImportComplete`, `BggSearchResult`. These are defined separately from the daemon's versions in `packages/daemon/src/services/game-service.ts`.

If the daemon's SSE or JSON response shapes change, the web types silently drift. These should live in `packages/shared/` since that workspace exists specifically for cross-package types. The SSE event shapes (`ImportProgress`, `ImportComplete`) would also benefit from being shared so the frontend parser and daemon emitter stay in sync.
