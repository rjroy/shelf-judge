---
title: "Simplify CLI daemon error handling: shelf-judge-b73"
date: 2026-09-24
status: complete
tags: [simplify, cli, daemon-errors]
source: shelf-judge-b73
modules: [cli]
---

# Simplify CLI daemon error handling: shelf-judge-b73

The CLI repeats `new Error(body.error ?? fallback)` across roughly 50 command handlers. Axis validation errors and structured profile and note failures have different contracts and were left alone. The bounded cleanup shared the plain-error handling between niche and redundancy commands via `responseError` in `packages/cli/src/errors.ts`. Existing niche tests and new redundancy tests cover server-provided messages and every command's fallback.

Changed files: `packages/cli/src/errors.ts`, `packages/cli/src/commands/niche.ts`, `packages/cli/src/commands/redundancy.ts`, and `packages/cli/tests/commands/redundancy.test.ts`. Other repeated handlers remain unchanged to avoid a broad mechanical rewrite.

Focused tests passed (16). The full suite passed (3,191 tests, one skipped), as did typecheck, lint, build, and format check. Independent review found no material behavior change or type-safety regression. There were no failures or correction rounds.
