---
title: "Simplification notes: useful profile Step 13"
date: 2026-08-28
status: complete
tags: [simplification, collection-profile, testing]
source: .lore/work/plans/useful-collection-profile.md
modules: [shared, daemon, cli, web]
---

# Simplification notes: useful profile Step 13

## Scope

Cleanup was limited to Step 13 audit and test instrumentation. Approved product behavior, persisted migration, current contracts and diagnostics, rendered behavior, and Step 12 browser/CI work were preserved.

## Deletions

- Deleted the broad repository vocabulary, morphology, deferred-identifier, and pressure-language audit.
- Removed production lifecycle callbacks and test-app plumbing used only to observe coordinator queues and pre-commit timing.
- Removed duplicate one-off accepted-create parity cases and duplicate complete/retire stale-race coverage.
- Consolidated first-cache identity evidence into the profile-service coordinator test and kept deterministic mutation tests on test-owned atomic-rename barriers.

## Retained Evidence

The real filesystem schema-v3-to-v4 flow, byte-identical migration, restart/history/receipt/cache durability, opposite mutation winners, persistence interruption, shared six-case fixtures, rendered focus/live-region behavior, current schemas/engine/axis diagnostics, structural deletions, and Playwright/CI gates remain.

Rendered owner attention comes only from explicit intentions and does not invent urgency, overdue status, or neglect. Source code, logs, errors, diagnostics, and unrelated UI are not vocabulary-constrained.

## Validation Status

Cleanup removed 1,033 net lines. The full suite passed with 2,098 tests and 1 existing skip; 20 concurrency/profile stress repetitions passed 260 tests. Root, web, and browser typechecks, lint, production build, 28 Chromium cases, changed-path formatting, and `git diff --check` passed. The repository-wide format baseline remains limited to three generated Beads files. Independent testing and behavior-focused review found no material defects.

Step 13 is complete and locally accepted. The overall useful-profile plan remains in progress pending Step 14 terminal release validation. No Beads status mutation, commit, push, or sync was performed.
