---
title: Collection Analyst technical validation evidence
date: 2026-09-11
status: complete
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

## Current validation continuation, 2026-09-11

The preceding 128-pass/8-failure browser result is historical evidence only.
Beads issue `shelf-judge-bka` subsequently records an independently reviewed
port-isolation repair and a completed 148-pass/60-skipped browser run. This
validation continuation will record its own isolated full-suite command and
result before final acceptance; it does not weaken the full-browser requirement.

- `SHELF_JUDGE_E2E_FIXTURE_PORT=32100 SHELF_JUDGE_E2E_WEB_PORT=32101
SHELF_JUDGE_E2E_SOCKET=/tmp/shelf-judge-playwright-32100.sock
SHELF_JUDGE_E2E_NEXT_DIST_DIR=.next-e2e-32101 bun run test:browser`: pass,
  148 passed and 60 skipped in 3.7 minutes. The run used no default occupied
  port and did not terminate the existing Next process. An initial isolated-port
  attempt exposed the existing `.next-e2e` output lock; Playwright now accepts a
  unique ignored `.next-e2e-*` output directory and Next selects the matching
  E2E TypeScript configuration for that directory.
- `bun run format:check`: pass after Prettier updated the 23 reported tracked
  files and the changed validation/configuration files.
- `bun test packages/cli/tests/commands/analyst.test.ts
packages/cli/tests/index.test.ts`: pass, 41 tests and 75 assertions.
- `bun run typecheck && bun run typecheck:browser && bun run lint`: pass.
- `bun test packages/cli/tests/commands/analyst.test.ts
packages/cli/tests/index.test.ts`: pass after JSON acknowledgement repair, 46
  tests and 88 assertions. It covers validated completion, terminal failure,
  interactive chat, root `--json` parsing, `--question`, positional-question
  compatibility, and rejection of unacknowledged JSON before a turn request.
- `bun test packages/cli/tests/commands/analyst.test.ts
packages/cli/tests/index.test.ts packages/cli/tests/commands/help.test.ts`:
  pass, 53 tests and 132 assertions. This confirms the documented chat `--json`
  usage in addition to the Analyst regression coverage.
- `bun test`: pass, 2,952 passed, 1 skipped, 0 failed, and 18,498 assertions
  across 174 files. Prior independent evidence records build, typecheck, lint,
  format, browser typecheck, and isolated browser 148 passed/60 skipped as
  passing. This validation record remains pending independent acceptance.

## Final acceptance, 2026-09-11

Independent targeted review accepted the JSON acknowledgement repair: the 53-test,
132-assertion focused suite confirms that JSON requires explicit acknowledgement
before configuration or turn work and that the positional question alias remains
permitted. Final repository evidence is 2,952 passed, 1 skipped, 0 failed, and
18,498 assertions across 174 files; typecheck, browser typecheck, lint, build,
format, and the isolated browser suite (148 passed, 60 skipped) pass.

Provider smoke remains unavailable in this validation environment because the
non-secret provider/model configuration identifiers are absent. The previously
recorded configured-provider smoke reached retrieval and retained its concrete,
non-secret structured-output validation blocker; no usefulness or semantic-truth
claim is made by this evidence.

The CLI implementation had drifted from the approved command contract: the
[specification CLI syntax](../specs/collection-analyst-chat.md#cli) and
[plan Step 7.1](../plans/collection-analyst-chat.md#step-7-add-one-shot-and-interactive-cli-parity)
require `analyst ask --question <text> [--json]`, while code, help, and tests
accepted positional question text. The documented `--question` syntax is restored
with command and parser tests; the positional form remains a compatible alias.
Root `--json` now reaches both one-shot and
interactive Analyst commands. They emit each shared runtime-validated daemon
event as one stdout NDJSON line; disclosure, prompts, and human status stay on
stderr, so they cannot contaminate the machine-readable stream.

## Source obligation links

- [Collection Analyst requirements](../specs/collection-analyst-chat.md#requirements)
  map to the [Step 10 release gates](../plans/collection-analyst-chat.md#step-10-complete-persisted-flow-privacy-documentation-and-release-validation).
- The shared model-boundary, capability, redaction, and deterministic evidence
  obligations map to [model-directed evidence tool flow](../designs/model-directed-evidence-tool-flow.md).
- Owner-note deletion, retention, and race obligations map to
  [owner-note final validation](../notes/owner-game-notes-final-validation.md).
- Browser blocker resolution and the previously accepted port-isolation evidence
  map to Beads issue `shelf-judge-bka`; this final-validation issue stays open
  until independent acceptance confirms the current evidence.
