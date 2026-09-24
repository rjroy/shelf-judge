---
title: "Simplification notes: web E2E fixture"
date: 2026-09-23
status: complete
tags: [simplification, browser-tests, test-fixtures]
source: .beads/issues.jsonl
modules: [web]
---

# Simplification notes: web E2E fixture

Issue: `shelf-judge-pa3`. Extracted deterministic data, collection and reflection builders, and synchronous owner-note persistence into four modules under `packages/web/e2e/fixture/`. The entrypoint retains live scenario state, reset, request dispatch, asynchronous mutations, and socket lifecycle. Moved the used reflection policies import to the leading import block. No failures or corrections were needed.

Independent validation passed: browser typecheck; desktop browser tests (63 passed, 3 skipped); full browser suite (204 passed, 60 skipped); production build; targeted ESLint and Prettier; `git diff --check`. Independent review found no material behavior changes.

Issue `shelf-judge-icd` was closed without changes: the E2E TypeScript config already extends the base config, while its file list must be repeated to select the isolated generated Next types.
