# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Shelf Judge is a board game collection curation tool. It combines personal multi-axis ratings with BGG community data to produce a transparent fitness score per game. Single-user, local-only, JSON file storage.

## Architecture

Bun monorepo with four workspace packages:

- `packages/shared/` - TypeScript types and Zod validation schemas (shared across all packages)
- `packages/daemon/` - Hono server on a Unix socket (`/tmp/shelf-judge.sock`), JSON file persistence at `~/.shelf-judge/`
- `packages/web/` - Next.js 16 frontend, proxies to daemon via `/api/daemon/[...path]` route
- `packages/cli/` - Bun CLI (`shelf-judge` / `sj`), communicates with daemon over Unix socket

The daemon owns all data access. Web and CLI are both clients of the daemon API.

## Commands

```bash
bun run dev          # Start daemon + web UI concurrently
bun run test         # Bun test suite across all packages
bun run typecheck    # TypeScript strict checking
bun run lint         # ESLint
bun run format       # Prettier format
bun run format:check # Verify formatting without writing
```

## Code Style

- Prettier: double quotes, semicolons, trailing commas, 100 char line width (see `.prettierrc`)
- ESLint with typescript-eslint (strict)
- TypeScript strict mode

## Testing

- Use `bun test` (Bun's built-in test runner)
- BGG API tests use hand-crafted XML fixtures in `packages/daemon/tests/fixtures/`
- Do not use `mock.module()` (causes infinite loops in Bun). Use dependency injection instead.

## Documentation

Design docs, specs, plans, and research live in `.lore/`. Check there before asking about architectural decisions or domain context. Key files:

- `.lore/vision.md` - Project principles and anti-goals
- `.lore/specs/mvp.md` - MVP requirements (24 items)
- `.lore/designs/` - Data model, fitness algorithm, API surface, BGG integration, CLI, web UI

## Critical Lessons

- When a daemon route's response shape changes, grep every client helper (web and CLI) in the same change, not just the one that prompted the edit.
- Distance and aggregation functions should throw on dimension mismatch, not quietly iterate off the end of the shorter array. `for (let i = 0; i < a.length; i++) b[i]` is a silent failure waiting to happen the moment vector shapes aren't enforced by a wrapping type.
- When a refactor replaces "build a complete keyset" with "return only populated entries", check every downstream consumer that assumed fixed shape. Dimensional invariants that used to hold by construction need to be reasserted.
- Daemon caches that survive schema-shape bugs extend the blast radius. Version the cache or validate on load so corrupted stored state doesn't keep leaking into clients after the code is fixed. Shelf Judge caches profile/tournament/collection under `~/.shelf-judge/data/`; any shape change needs a load-time guard or a cache reset.
- When stored data contradicts the declared type, trust the data over the type and find the serialization hole. A lopsided split (e.g. 4 valid vs 172 null) is decisive evidence about which code path is broken.
