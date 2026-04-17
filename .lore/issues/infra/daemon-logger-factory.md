---
title: Add structured logger factory for daemon services
date: 2026-04-05
status: resolved
tags: [observability, logging, cleanup]
modules: [daemon-services, bgg-client]
---

# Structured logger factory

All daemon logging uses raw `console.log`/`console.warn`/`console.error` with manually typed prefix strings (`[bgg]`, `[import]`, `[route]`). This works but makes it harder to filter, redirect, or add structure (timestamps, request IDs) later.

A simple `createLogger("bgg")` returning `{ log, warn, error }` functions would centralize the prefix format and provide a single place to add structured output if needed. Low priority since the current approach is readable and functional.
