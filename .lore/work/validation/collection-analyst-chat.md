---
title: Collection Analyst technical validation evidence
date: 2026-09-08
status: in-progress
spec: .lore/work/specs/collection-analyst-chat.md
plan: .lore/work/plans/collection-analyst-chat.md
issue: shelf-judge-3p5.11
---

# Collection Analyst technical validation evidence

This records deterministic technical evidence, not usefulness, semantic truth,
entailment, blinded review, corpus quotas, or baseline comparisons.

## Requirement map

- **1-2, 19, 27, 33:** shared contract and daemon projection/evidence suites.
- **3, 28, 31-32:** daemon turn-boundary and route suites; source/persistence
  audits.
- **4-5, 9-10, 24:** shared contract, result-validator, route, web component,
  and browser suites.
- **6-7, 12:** daemon evidence and transcript-validator suites, including
  owner-note update and clear races. Permanent deletion is covered by the
  owner-note deletion dependency's completed test evidence.
- **8, 16-18, 20, 22-23:** daemon turn-boundary and route suites; the provider
  smoke is conditional.
- **11, 13-15, 21, 25-26:** transcript, route, CLI command, web component, and
  browser suites.
- **29-30:** real Chromium keyboard, disclosure, citation, streaming,
  cancellation, viewport, zoom-project, and accessibility flows in
  `packages/web/e2e/analyst-chat.pw.ts`.

Primary named suites are `packages/shared/tests/collection-analyst.test.ts`,
`packages/daemon/tests/analyst-*.test.ts`,
`packages/daemon/tests/services/analyst-*.test.ts`,
`packages/cli/tests/commands/analyst.test.ts`,
`packages/web/tests/analyst-chat.test.ts`, and
`packages/web/e2e/analyst-chat.pw.ts`.

## Results

- Independent review accepted the code changes. The review inspected the
  Analyst test files and verified that the shared fixture edit is restricted to
  the Analyst cancellation branch.
- Focused Analyst suites: pass, 61 tests and 2,361 assertions.
- Web component test: pass, 4 tests and 25 assertions.
- Analyst browser flow: pass, 8 Chromium executions across mobile, tablet,
  desktop, and the configured 200%-layout-equivalent project.
- `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build`, and
  `bun run typecheck:browser`: pass. The full test run reports 2,905 passed, 1
  skipped, 0 failed, and 16,121 assertions.
- `bun run test:browser`: Analyst executions pass. The repository result is 128
  passed, 60 skipped, and 8 failures in non-Analyst test files: Collection
  navigation, useful Profile navigation, Reflection zoom, and owner-note zoom
  flows. Their baseline status was not demonstrated, so this result does not
  establish that the failures are unrelated to the reviewed changes or
  preexisting.
- Provider smoke: not run. A safe presence-only check found the expected
  `SHELF_JUDGE_GROUNDED_PROVIDER_ID` and `SHELF_JUDGE_GROUNDED_MODEL_ID`
  environment variables absent; no secret value was inspected. Operator
  startup configuration was not otherwise available to this validation run.

## Fix from validation

The web client now creates a 32-byte cryptographic capability, locally aborts
the stream after requesting cancellation, and returns focus to the composer.
The browser test asserts the capability shape and focus return. The fixture also
ignores post-abort stale events instead of enqueueing into a closed stream.

## Limitations

Citation/schema validation establishes structural provenance only. It does not
prove semantic relevance, entailment, usefulness, or truth. The full-browser
gate remains unfinished pending a linked follow-up for these failures:

- `collection-navigation.pw.ts:517`: all four projects time out while closing
  the isolated browser context.
- `useful-profile.pw.ts:553`: no-JavaScript navigation times out.
- Native-zoom flows time out at `collection-navigation.pw.ts:900`,
  `grounded-profile-reflections.pw.ts:202`, and `owner-game-notes.pw.ts:619`.
- Chromium also reports `MutationObserver.observe` errors.

These failures are outside the Analyst test files, and the only shared fixture
edit reviewed is restricted to the Analyst cancellation branch. That limited
scope is not a baseline run and does not demonstrate that the failures are
preexisting or unrelated.
