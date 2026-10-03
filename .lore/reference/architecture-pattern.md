---
title: Daemon-First Architecture Pattern
status: current
tags: [reference, portable]
date: 2026-04-04
---

# Daemon-First Architecture Pattern

The daemon is the application. Everything else is a client.

Web, CLI, and agents don't make decisions or hold state. They relay user intent to the daemon and render what comes back. If the daemon stops, there is no application. If a client stops, nothing is lost.

## Hard Constraint: One Daemon-Owned Inference Gateway

All model work is owned by one daemon inference gateway. The gateway currently
provides the grounded-analysis capability built on
`@earendil-works/pi-coding-agent` and `@earendil-works/pi-agent-core`. The approved
Jev redundancy design adds a distinct typed-Jev capability within that same
gateway; it does not turn Jev into a pi-agent grounded-analysis session or imply
that pi-agent supports Jev Score. The Jev capability is an approved future
contract, not an assertion that it is implemented or currently available.
Routes, feature services, web, and CLI do not call providers or create independent
model stacks.

For grounded analysis, the operator explicitly configures the provider, model, and
allowlisted provider extensions. There is no implicit model default. The
integration binds allowlisted extensions before resolving the model through the
bound session registry and rejects unapproved model-visible tools or hooks before
supplying application data. Provider authentication remains the selected
provider's responsibility. The typed-Jev capability separately owns explicit
TypeSafe provider/model selection and pinning, credentials, request/answer schemas,
usage accounting, budget and concurrency limits, retry/backoff, cancellation,
failure classification, and redacted attempt/outcome logging. All capabilities
remain behind the daemon gateway and expose test-injectable boundaries.

The one-gateway rule replaced the prior Claude-Agent-SDK-only constraint by owner
decision on 2026-08-30 so Grounded Profile Reflections and Collection Analyst Chat
could share one provider-neutral integration surface. The later approved Jev
amendment preserves the pi-agent boundary for those grounded features while adding
the separate typed-Jev capability described in [the approved similarity
design](../work/design/jev-redundancy-similarity.md) and
[contract-amendment proposal](../work/design/jev-contract-amendments.md). The
amendment authorizes the architecture contract only; it does not authorize an
actual request or establish shipped functionality.

## Three Clients, One App

| System     | Stack                                           | Role                                                              |
| ---------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| **Daemon** | Hono on Unix socket via `Bun.serve()`           | The application. Owns all state, logic, and coordination.         |
| **Web**    | Next.js App Router (server + client components) | Read-only UI. Calls daemon REST API for writes.                   |
| **CLI**    | Plain bun scripts                               | Discovers operations from daemon at runtime. No built-in catalog. |

The daemon runs on a Unix socket (or TCP for cross-platform). Web and CLI never touch the filesystem, config, or internal state directly.

### Why CLI Matters

The CLI isn't a convenience interface. It's what makes the daemon usable by other agents.

An agent with shell access can discover what the daemon offers, invoke operations, and read results without a custom client library. The operations registry and runtime discovery serve this directly: agents learn the surface the same way humans do.

**When you make a thing, you make a CLI.**

## Running the System

The root `package.json` uses `concurrently` to run the daemon and web server together with labeled, color-coded output:

```
bun run dev    # daemon (bun --watch) + next dev
bun run start  # daemon (bun) + next start
```

The daemon and web packages each define `dev` and `start` scripts. The root `dev` script runs them via `bun run --cwd packages/daemon dev` and `bun run --cwd packages/web dev`; the root `start` script uses `bun run --filter` to launch each package's `start` script.

## Unix Socket Connectivity

The daemon listens on a Unix socket via `Bun.serve({ unix: socketPath })`. Clients connect differently depending on their runtime:

**Bun clients (CLI, daemon-to-daemon):** Use Bun's `fetch` extension with the `unix` option. This is a Bun-specific API that doesn't exist in Node.js or browser `fetch`.

```typescript
fetch("http://localhost/api/axes", { unix: socketPath });
```

**Next.js server components and API routes:** Next.js runs on Node.js, not Bun, even when started via `bun run`. Bun's `fetch({ unix })` is silently ignored. Instead, use Node's `http.request()` with `socketPath`:

```typescript
import http from "node:http";

http.request({ socketPath: SOCKET_PATH, path, method }, resolve);
```

The web package wraps this in a `lib/daemon.ts` module that exposes `daemonFetch()` (buffered) and `daemonFetchStream()` (for SSE). Both return standard Web API `Response` objects so the rest of the web code doesn't touch `node:http` directly.

**Client-side JavaScript (browser):** Cannot reach Unix sockets. Client components go through Next.js API route handlers (`/api/daemon/[...path]`) which proxy to the daemon via the `node:http` pattern above.

## Daemon Internals

### Route/Service Split with DI Factories

Every route file is a factory: `createXRoutes(deps) → RouteModule`. Each factory receives only the slice of dependencies it needs. Production wiring lives in one place, which builds real deps and passes them down.

```typescript
type RouteModule = {
  routes: Hono;
  operations: OperationDefinition[];
};
```

Tests provide mock deps. The app can start with a fallback if production setup fails.

### One Gateway for Model Calls

All model interaction flows through the daemon inference gateway, with two
distinct capabilities: existing grounded analysis through the pi-agent
provider/session boundary, and (when implemented and explicitly authorized) typed
Jev requests for redundancy refresh. No direct pi-agent or provider calls are
permitted from routes, feature services, domain logic, web, CLI, or the pure
redundancy scoring engine.

The gateway owns capability-specific provider/model configuration, evidence
submission and validation, cancellation, usage capture, failure categorization,
and redacted logging. The grounded-analysis capability owns extension binding,
bound-registry model resolution and capability inspection, and schema-backed
completion. The typed-Jev capability owns pinned TypeSafe model selection and
strict typed question/answer validation; it is not a grounded free-form completion.
Feature callers supply an authorized evidence manifest, policy, and strict
submission schema. For Jev refresh, the daemon verifies the current authorization
and disclosed pair/source identity immediately before each submission; the allowed
evidence is the two current BGG descriptions and, only with separate explicit
authorization, the two current owner notes for the disclosed eligible pair. No
broad collection, note history, system tools, or unrelated profile data may be
sent. Provider-side privacy/retention is disclosed, not presumed local. Ordinary
reads and note mutations make no Jev call.

This is not abstraction for its own sake. A single gateway prevents each feature
from inventing provider configuration, error handling, streaming, privacy, and tool
authorization behavior while keeping the typed Jev protocol distinct from
grounded-analysis session semantics.

### Tool Definitions as DI Factories

Model-visible tools follow the same factory pattern as routes and services. Each
factory receives only the narrow callbacks it needs, validates strict input and
output schemas, and exports pure logic for direct testing. The grounded-analysis
boundary inspects the final session capability set before transmitting application
data. Typed Jev does not expose system tools. Feature policy, not extension
registration or model output, determines which tools are available.

## Operations Registry and CLI Discovery

Routes export `OperationDefinition` objects with hierarchy metadata. The registry builds a navigation tree.

```typescript
interface OperationDefinition {
  operationId: string; // "project.status.get"
  name: string; // "get"
  description: string;
  invocation: { method: string; path: string };
  requestSchema?: ZodType;
  hierarchy: { root: string; feature: string };
  parameters?: OperationParameter[];
  idempotent: boolean;
}
```

CLI fetches the tree from `/help` endpoints. Progressive discovery:

```
mycli help                    → Full tree
mycli project help            → Subtree
mycli project status get      → Operation details
```

The CLI binary contains no operation catalog. The daemon is the source of truth.

## SSE Streaming

Route handlers use Hono's `streamSSE` helper to stream events directly to clients. There is no intermediate EventBus or pub/sub layer. The route handler owns the SSE stream lifecycle: it opens the stream, runs the session query, writes events as they arrive, and closes the stream when the query completes or the client disconnects.

This inline approach works when there's a single consumer per stream (the HTTP client that initiated the request). If you need multiple subscribers or cross-request event delivery, introduce a bus then, not before.

Socket idle timeout must be disabled (`idleTimeout: 0`) for long-lived SSE connections. Bun's type definition for this is overly strict; a type assertion (`0 as never`) may be needed.

## State Model

All durable state is in YAML and markdown files. No database.

Humans can inspect and edit state files directly. This is a feature, not a limitation. When something goes wrong, you open a file and read it.

## Type Boundaries

- **Shared types** live in a common package. Never import from daemon or web packages.
- **Daemon types** stay in the daemon. Consider branded types (e.g., `ProjectId`, `SessionId`) when multiple ID namespaces coexist and could be confused at call sites.
- **Web types** derive from API responses, not from daemon internals.

## Testing Seams

DI factories are the primary testing seam. Every external dependency is injectable:

- **`fileOps`**: A single interface wrapping all filesystem operations (`readFile`, `writeFile`, `readDir`, `fileExists`, `stat`, etc.). Tests provide in-memory implementations. This is the dominant DI seam in practice: most services need filesystem access, and a single interface keeps the injection surface narrow.
- **Inference gateway seams**: Inject deterministic grounded-analysis sessions/provider events and a typed-Jev client for exhaustive tests. Retain focused real-library lifecycle tests for pi-agent extension binding/model resolution, and test Jev state minimization, authorization, strict answers, usage/errors, budgets, and cancellation at its separate typed seam.
- **Service interfaces**: Services like `adventureService`, `historyService`, `compactionService` are injected into route factories. Tests can stub individual service methods without replacing the filesystem layer.
- Hono's `app.request()` test client with injected deps for integration-level route testing.
- `fs.mkdtemp()` for temp directories, env vars for path isolation when testing against real filesystems.

**Type export conventions:** Services export an explicit interface (`AdventureService`) plus a factory function (`createAdventureService`). For simpler services where the interface would duplicate the return type, `ReturnType<typeof createX>` is a valid shorthand. Both patterns coexist; pick the one that communicates the contract clearly.

Never `mock.module()` (causes infinite loops in bun). Design for dependency injection instead.

### Config Resolution

Config resolution (`resolveConfig()`) lives in the app factory module, not in the entry point. The factory conditionally resolves environment config only when DI deps don't provide the needed values. This avoids env coupling in tests: test callers pass paths and functions directly, and the factory never touches `process.env`.

```typescript
// Only resolves env config when deps don't provide what we need
const config = !deps?.adventuresPath || !deps?.queryFn ? resolveConfig() : undefined;
const adventuresPath = deps?.adventuresPath ?? config!.adventuresPath;
```
