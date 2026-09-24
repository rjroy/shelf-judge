---
title: "Simplify janitor pass: niche CLI error handling"
date: 2026-09-23
status: complete
tags: [simplify, cli, error-handling]
source: .lore/reference/designs/mvp-cli.md
modules: [cli]
---

# Simplify janitor pass: niche CLI error handling

## Scope and rationale

For shelf-judge-88z, extracted three identical daemon-error decoding blocks in the niche CLI commands into a local `nicheError` helper. The server's error still takes precedence over each command's original fallback message; successful response handling and output are unchanged. Added focused tests for both error cases across all three commands. No other source area was touched.

## Changed files

- `packages/cli/src/commands/niche.ts`: replace repeated error casts and constructors with one local helper.
- `packages/cli/tests/commands/niche.test.ts`: cover server-provided and fallback errors for ignored, ignore, and unignore.
- `.lore/work/notes/simplify-janitor-pass-2026-09-23.md`: record this pass.

## Validation

- `bun test packages/cli/tests/commands/niche.test.ts`: 6 passed, 0 failed.
- `bunx tsc --noEmit -p packages/cli`: passed.
- `bunx eslint packages/cli/src/commands/niche.ts packages/cli/tests/commands/niche.test.ts`: passed.
- `bunx prettier --check packages/cli/src/commands/niche.ts packages/cli/tests/commands/niche.test.ts`: passed after formatting the new test file.
- `git diff --check`: passed.

## Remaining opportunities

- Other CLI command files also repeat daemon-error handling. Consolidating them would require separate, bounded review and tests; this pass intentionally leaves them alone.
- Full repository gates and independent review belong to the orchestrator.
