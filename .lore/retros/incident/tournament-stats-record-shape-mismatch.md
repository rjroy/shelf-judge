---
title: Tournament stats shape mismatch hid fitness in collection view
date: 2026-04-06
status: complete
tags: [bug, api-contract, types, tournament, web]
modules: [web, daemon]
---

# Retro: Tournament Stats Shape Mismatch

## Summary

The collection page's Tournament sort column rendered "-" for every game even though the game detail page showed the correct tournament fitness. Root cause: the daemon's `GET /api/tournament/stats` was changed to return an enriched array (`[{gameId, gameName, stats}]`) during the CLI-facing cleanup, but the web client helper `getAllTournamentStats` still declared and consumed it as `Record<string, TournamentGameStatsDisplay>`. At runtime the array was cast to a record, every `tournamentStats[game.id]` lookup returned undefined, and the label fell through to the "-" default. Fixed by transforming the array to a record inside the helper so the page code is unchanged.

## What Went Well

- The type annotation on the helper made the intended shape obvious, so the diff between daemon response and web expectation was easy to spot once the daemon route was read.
- A single narrow fix in the API helper restored correct behavior without touching the page or changing the daemon contract the CLI now depends on.

## What Could Improve

- The daemon route was changed without updating both clients. The commission note even called out that the CLI was fixed, but the web client wasn't re-verified.
- `daemonJson` is untyped at the call site unless the caller passes a generic, so a response shape change compiles cleanly and fails silently at runtime. There is no contract check between daemon routes and web helpers.
- No test covered the collection page's tournament-sort rendering, so the regression shipped unnoticed.

## Lessons Learned

- When a daemon route's response shape changes, grep every client helper (web and CLI) in the same change, not just the one that prompted the edit.
- Untyped fetch helpers (`daemonJson` without a generic) hide response-shape regressions. Treat the helper's return type as the contract and update it in the same commit as the route.
- A passing typecheck on a cast-to-record response is not evidence the data is a record. Runtime verification on the actual page is the only proof.

## Artifacts

- `.lore/commissions/commission-Dalton-20260406-153958.md` - the change that reshaped `/api/tournament/stats`
- `packages/web/lib/api.ts` - fix location
- `packages/daemon/src/routes/tournament.ts` - daemon route returning the enriched array
