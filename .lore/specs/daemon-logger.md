---
title: Structured logger factory for daemon services
date: 2026-04-06
status: implemented
tags: [observability, logging, cleanup, daemon]
modules: [daemon-services, bgg-client]
related: [.lore/issues/daemon-logger-factory.md, .lore/retros/bgg-import-double-request.md]
req-prefix: LOG
---

# Spec: Structured Logger Factory

## Overview

The daemon uses raw `console.log`/`console.warn`/`console.error` calls with manually typed prefix strings across four files (~35 call sites). This works, but the prefix format is inconsistent (some files omit prefixes entirely), there's no single place to change the output format, and adding structure later (timestamps, log levels, output redirection) would require editing every call site.

This spec defines a `createLogger` factory that centralizes prefix formatting and provides a uniform logging interface. The factory returns an object with `log`, `warn`, and `error` methods that prepend a consistent prefix. All existing `console.*` calls in the daemon are replaced with logger calls.

## Entry Points

- Developer creates a new service or route module in the daemon and needs logging.
- Developer wants to change the log output format (add timestamps, change prefix style) and has a single place to do it.

## Requirements

- REQ-LOG-1: A `createLogger(name: string)` function MUST exist that returns an object with `log`, `warn`, and `error` methods. Each method MUST accept the same argument signature as the corresponding `console` method (`...args: unknown[]`).
- REQ-LOG-2: Each method MUST prepend a prefix in the format `[name] ` (bracket-wrapped name followed by a space) to the output, matching the convention already used in `bgg-client.ts` and `game-service.ts`.
- REQ-LOG-3: The factory MUST delegate to `console.log`, `console.warn`, and `console.error` respectively. No custom transport or output destination.
- REQ-LOG-4: All existing `console.log`/`console.warn`/`console.error` calls in the daemon package MUST be replaced with calls through a logger instance. The four current prefixes are: `bgg` (bgg-client.ts), `import` (game-service.ts), `route` (routes/import.ts), and `daemon` (index.ts, currently unprefixed).
- REQ-LOG-5: The `createLogger` function MUST live in a new file within `packages/daemon/src/services/`. The logger is a daemon-internal utility, not a shared package export.
- REQ-LOG-6: The logger type MUST be exported so services can accept it via dependency injection if needed. The type name SHOULD be `Logger`.
- REQ-LOG-7: The factory MUST NOT add timestamps, structured JSON output, log levels, or any other features beyond prefix formatting. These are future concerns. The factory exists to centralize the format so those features can be added in one place later.

## Exit Points

| Exit              | Triggers When                                      | Target                                       |
| ----------------- | -------------------------------------------------- | -------------------------------------------- |
| Structured output | Need arises for timestamps, JSON, or log levels    | Future spec (not yet needed)                 |
| Logger injection  | Services accept logger as a constructor dependency | Incremental adoption during future refactors |

## Success Criteria

How we know this is done:

- [ ] `createLogger` function exists and is tested
- [ ] All `console.log`/`warn`/`error` calls in `packages/daemon/src/` are replaced with logger calls
- [ ] `rg 'console\.(log|warn|error)' packages/daemon/src/` returns zero results
- [ ] Existing tests continue to pass (no behavior change)
- [ ] Logger output matches the existing prefix format (e.g., `[bgg] fetch: https://...`)

## AI Validation

**Defaults** (apply unless overridden):

- Unit tests for `createLogger` verifying prefix formatting and delegation to `console` methods
- Code review by fresh-context sub-agent

**Custom:**

- Zero `console.log`/`warn`/`error` calls remaining in `packages/daemon/src/` (verified by grep)
- Output format of replaced calls is identical to the existing format (no user-visible change)

## Constraints

- MUST NOT change behavior observable to the user. Log messages must look identical before and after.
- MUST NOT introduce dependencies outside the Node/Bun standard library.
- MUST NOT modify the `packages/shared/` package. The logger is daemon-internal.
- MUST NOT change the dependency injection signatures of existing services in this spec. Services that currently call `console.*` directly will call a module-level logger instance instead. Injecting loggers as constructor parameters is a separate, optional improvement.

## Context

This issue was surfaced during the BGG import double-request bug investigation (`.lore/retros/bgg-import-double-request.md`). The retro explicitly noted: "Logging at integration boundaries is not optional. 'Add logging later' means 'debug blind until someone complains.'" The logging itself was added in that fix; this spec addresses the remaining cleanup of centralizing the format.

Current logging call sites by file (these are the only daemon source files with `console.*` calls; other files in the package have none):

- `services/bgg-client.ts`: ~15 calls, prefix `[bgg]`
- `services/game-service.ts`: ~6 calls, prefix `[import]`
- `routes/import.ts`: ~3 calls, prefix `[route]`
- `index.ts`: ~4 calls, no prefix (should become `[daemon]`)
