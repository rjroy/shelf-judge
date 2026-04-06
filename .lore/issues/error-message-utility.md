---
title: Extract toErrorMessage utility from 30+ inline copies
date: 2026-04-05
status: open
tags: [cleanup, utility, code-reuse]
modules: [daemon-routes, daemon-services, bgg-client, cli]
---

# Extract `toErrorMessage` utility

The pattern `err instanceof Error ? err.message : String(err)` appears 30+ times across the daemon package (routes, services, bgg-client) and once in the CLI.

A `toErrorMessage(err: unknown): string` function in `packages/shared/` would eliminate all inline repetitions. Low risk, high consistency value. Good candidate for a mechanical find-and-replace.

Locations: `packages/daemon/src/routes/games.ts` (10), `routes/scores.ts` (2), `routes/config.ts` (2), `routes/axes.ts` (4), `services/game-service.ts` (6), `services/bgg-client.ts` (6), `packages/cli/src/index.ts` (1).
