---
title: "Implementation plan: daemon-logger"
date: 2026-04-06
status: approved
tags: [plan, observability, logging, cleanup]
modules: [daemon-services, bgg-client]
related:
  [
    .lore/specs/daemon-logger.md,
    .lore/issues/daemon-logger-factory.md,
    .lore/retros/bgg-import-double-request.md,
  ]
---

# Plan: Structured Logger Factory

## Spec Reference

**Spec**: `.lore/specs/daemon-logger.md`

Requirements addressed:

- REQ-LOG-1: `createLogger(name)` returns `{ log, warn, error }` with `...args: unknown[]` signature → Step 1
- REQ-LOG-2: Each method prepends `[name] ` prefix → Step 1
- REQ-LOG-3: Delegates to `console.log`/`console.warn`/`console.error` → Step 1
- REQ-LOG-4: Replace all `console.*` calls in 4 daemon files → Step 2
- REQ-LOG-5: Factory lives in `packages/daemon/src/services/` → Step 1
- REQ-LOG-6: Export `Logger` type → Step 1
- REQ-LOG-7: No timestamps, JSON, log levels, or other features → Step 1

## Codebase Context

### Current State

All daemon logging uses raw `console.log`/`console.warn`/`console.error` with manually typed prefix strings. 32 call sites across 4 files:

| File                                           | Call sites | Current prefix | Logger name |
| ---------------------------------------------- | ---------- | -------------- | ----------- |
| `packages/daemon/src/services/bgg-client.ts`   | 18         | `[bgg]`        | `"bgg"`     |
| `packages/daemon/src/services/game-service.ts` | 6          | `[import]`     | `"import"`  |
| `packages/daemon/src/routes/import.ts`         | 3          | `[route]`      | `"route"`   |
| `packages/daemon/src/index.ts`                 | 5          | none           | `"daemon"`  |

### Patterns in Use

- Services use a factory pattern: `createBggClient(deps)`, `createGameService(deps)`, `createAxisService(deps)`. The logger factory follows this convention naturally.
- Dependency injection is via deps objects, not constructor parameters.
- Tests use `bun test` with hand-crafted fixtures. No `mock.module()`. DI for test isolation.
- Existing test files: `packages/daemon/tests/services/bgg-client.test.ts`, `game-service.test.ts`, etc.
- No test files currently assert on console output (the existing `console.*` calls are untested side effects).

### Integration Points

- `bgg-client.ts` creates its logger at module scope inside `createBggClient()`, used by closures `throttledFetch`, `fetchWithRetry202`, and the returned methods.
- `game-service.ts` logs only from `importBggCollection()`.
- `routes/import.ts` logs from the POST handler and its SSE error callback.
- `index.ts` logs at startup and in shutdown handlers. The `main()` catch block logs a fatal error.

## Implementation Steps

### Step 1: Create the logger factory and tests

**Files**:

- Create `packages/daemon/src/services/logger.ts`
- Create `packages/daemon/tests/services/logger.test.ts`

**Addresses**: REQ-LOG-1, REQ-LOG-2, REQ-LOG-3, REQ-LOG-5, REQ-LOG-6, REQ-LOG-7

**Expertise**: None needed.

Create `packages/daemon/src/services/logger.ts` with:

1. A `Logger` interface exported as a named type:

   ```
   export interface Logger {
     log(...args: unknown[]): void;
     warn(...args: unknown[]): void;
     error(...args: unknown[]): void;
   }
   ```

2. A `createLogger(name: string): Logger` function. Each method passes `[${name}]` as the first argument to the corresponding `console.*` method, followed by the caller's args:

   ```
   log(...args: unknown[]): void {
     console.log(`[${name}]`, ...args);
   }
   ```

   This works because `console.log` inserts a space between arguments, producing `[bgg] fetch: https://...` when called as `logger.log(`fetch: ${url}`)`. The existing code bakes `[bgg] ` into template literals with a trailing space after the bracket, so stripping that prefix and letting the logger add it back produces identical output.

   `index.ts` currently has no prefix. After replacement, `logger.log("Shutting down...")` outputs `[daemon] Shutting down...`. The spec explicitly says `index.ts` "should become `[daemon]`", so this is intentional.

3. Test file `packages/daemon/tests/services/logger.test.ts`:
   - Spy on `console.log`, `console.warn`, `console.error` using `spyOn(console, "log")` (Bun supports this).
   - Verify `createLogger("test").log("hello")` calls `console.log` with `"[test]"` and `"hello"`.
   - Verify `.warn(...)` delegates to `console.warn`.
   - Verify `.error(...)` delegates to `console.error`.
   - Verify multiple args pass through: `logger.log("a", 42, { x: 1 })` calls `console.log("[test]", "a", 42, { x: 1 })`.
   - Restore spies in `afterEach`.

### Step 2: Replace all console.\* calls with logger instances

**Files**:

- `packages/daemon/src/services/bgg-client.ts`
- `packages/daemon/src/services/game-service.ts`
- `packages/daemon/src/routes/import.ts`
- `packages/daemon/src/index.ts`

**Addresses**: REQ-LOG-4

**Expertise**: None needed.

For each file, the change is mechanical:

1. Add `import { createLogger } from "./logger.js"` (or appropriate relative path).
2. Create a logger instance at the appropriate scope.
3. Replace every `console.log(...)` with `logger.log(...)`, `console.warn(...)` with `logger.warn(...)`, `console.error(...)` with `logger.error(...)`.
4. Strip the prefix from the message string since the logger now adds it.

File-by-file details:

#### `bgg-client.ts` (18 calls, prefix `"bgg"`)

- Import `createLogger` from `"./logger.js"`.
- Inside `createBggClient()`, create `const logger = createLogger("bgg")` at the top of the function body (line 57 area, after destructuring deps). This scopes the logger to the client instance, matching how other state like `lastRequestTime` is scoped.
- Replace all 18 `console.*` calls. Each call currently includes `[bgg] ` in the template literal. Strip that prefix from the string argument.
- Example: `console.log(`[bgg] fetch: ${url}`)` becomes `logger.log(`fetch: ${url}`)`.
- Example: `console.warn(`[bgg] rate limited (429), ...`)` becomes `logger.warn(`rate limited (429), ...`)`.
- Example: `console.error(`[bgg] timeout after ...`)` becomes `logger.error(`timeout after ...`)`.

#### `game-service.ts` (6 calls, prefix `"import"`)

- Import `createLogger` from `"./logger.js"`.
- Inside `createGameService()`, create `const logger = createLogger("import")` at the top of the function body (line 85 area).
- Replace all 6 `console.*` calls, stripping the `[import] ` prefix from each message.

#### `routes/import.ts` (3 calls, prefix `"route"`)

- Import `createLogger` from `"../services/logger.js"`.
- Inside `createImportRoutes()`, create `const logger = createLogger("route")` at the top.
- Replace all 3 `console.*` calls, stripping the `[route] ` prefix.

#### `index.ts` (5 calls, currently unprefixed)

- Import `createLogger` from `"./services/logger.js"`.
- Inside `main()`, create `const logger = createLogger("daemon")` near the top (after `resolveConfig()` is fine).
- Replace all 4 `console.*` calls inside `main()` with `logger.*`. These currently have no prefix, so the message strings stay as-is. The logger adds `[daemon]` automatically. Note: one of these is nested inside the `onShutdown` callback passed to `createApp()` (line 47, `console.log("Shutting down via API...")`). It's easy to miss because it's inside an object literal, not a top-level statement.
- The `main().catch(...)` handler at line 74-76 uses `console.error("Failed to start daemon:", err)`. This is outside `main()` and runs before `main()` completes. Two options:
  - Create a module-level logger: `const logger = createLogger("daemon")` at the top of the file. Use it for the catch block and inside `main()`.
  - Keep the one `console.error` in the catch block since the logger isn't available yet.

  Decision: Create the logger at module level. It has no dependencies and the factory is synchronous. The `main()` function and the `.catch()` handler both use the same `logger` instance. This is simpler and avoids leaving a stray `console.error` that would fail the grep-to-zero check.

### Step 3: Validate against spec

**Addresses**: All REQ-LOG-\* requirements.

**Expertise**: None needed, but fresh-context sub-agent should run the review.

1. Run `rg 'console\.(log|warn|error)' packages/daemon/src/` and verify zero results. This is the spec's explicit success criterion. Also run against `packages/daemon/tests/` to confirm no test file is suppressing or asserting on raw `console.*` calls that would mask missed replacements.
2. Run `bun run test` and verify all existing tests pass. No behavior change is expected since the logger output is visually identical.
3. Run `bun run typecheck` and `bun run lint` to catch any import or style issues.
4. Launch a fresh-context sub-agent to review the implementation against the spec. The sub-agent reads `.lore/specs/daemon-logger.md` and all modified files, checking each REQ-LOG-\* requirement.

## Delegation Guide

This work is straightforward mechanical refactoring with a small utility module. No specialized expertise is needed for any step.

Commission structure for Dalton:

- **Commission A** (Steps 1 + 2 + 3): Create the logger factory, replace all call sites, validate. This is small enough to be a single commission. The total change is one new file (~20 lines), one new test file (~40 lines), and mechanical edits to 4 existing files.

  If splitting is preferred for review checkpoints:
  - **Commission A**: Step 1 (create factory + tests)
  - **Commission B**: Steps 2 + 3 (replace call sites + validate)

Consult `.lore/lore-agents.md` (if it exists) for available domain-specific agents for the validation sub-agent in Step 3.

## Open Questions

None. The spec is precise and the codebase state matches the spec's description. The one judgment call (module-level logger in `index.ts`) is documented in Step 2.
