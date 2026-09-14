---
title: Double-request proxy bug broke BGG import and masked progress
date: 2026-04-05
status: complete
tags: [bug, observability]
modules: [web-proxy, daemon-import, bgg-client]
---

# Retro: BGG Import Fix

## Summary

BGG collection import appeared broken: the UI reported "0 imported" and showed no progress. Root cause was a double-request bug in the Next.js API proxy, compounded by zero logging across the import pipeline. Three commits fixed the proxy, restructured progress event timing, and added structured logging.

## What Went Well

- The double-request bug was identifiable from code review alone. Reading the proxy code made the problem obvious: buffer a request to detect SSE, then re-request to stream it. The second request always found games already imported by the first.
- Consolidating `daemonFetch` and `daemonFetchStream` into a single `daemonRequest` that checks content-type from headers (available before body consumption) was a clean fix that simplified the API surface.
- Adding the `onBatch` callback to `getGames` kept the BGG client interface clean while giving callers control over per-batch processing.

## What Could Improve

- The double-request pattern was the original implementation, not a regression. It should have been caught during initial review. Any proxy that makes two requests for one client request is a red flag.
- Zero logging in the import pipeline meant the bug was invisible at runtime. The user had to report that "it doesn't work" with no diagnostic path. Logging should have been part of the original implementation.
- Progress events were designed around the data model (emit per-game after fetch) rather than the user experience (show something meaningful during the slow parts). The batch fetch is the slow operation, but the original code only emitted events during the fast post-fetch loop.

## Lessons Learned

- When proxying streaming responses (SSE, chunked), the proxy must detect the response type from headers before consuming any body. Making a "probe" request to detect content-type, then a second "real" request, doubles the side effects.
- Logging at integration boundaries (API proxy, external API client, service entry points) is not optional. "Add logging later" means "debug blind until someone complains."
- Progress reporting should be paced by the slow operations (network I/O, rate-limited API calls), not by fast in-memory processing. If the progress bar updates only during the instant part, it's useless.

## Artifacts

- Commits: `322a592`, `ecb92b3`, `f66db50`
- Files changed: `packages/web/lib/daemon.ts`, `packages/web/app/api/daemon/[...path]/route.ts`, `packages/web/lib/api.ts`, `packages/daemon/src/routes/import.ts`, `packages/daemon/src/services/bgg-client.ts`, `packages/daemon/src/services/game-service.ts`, `packages/web/app/import/page.tsx`
