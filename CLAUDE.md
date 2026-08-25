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

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->

## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:

   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```

5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**

- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
