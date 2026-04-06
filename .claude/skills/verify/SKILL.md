---
name: verify
description: Run typecheck, lint, and tests to verify the codebase is healthy. Use after making changes or before committing.
---

Run the following checks in sequence, stopping on first failure:

1. **Type checking:** `bun run typecheck`
2. **Linting:** `bun run lint`
3. **Tests:** `bun run test`

Report results concisely. If anything fails, show the relevant errors and suggest fixes.
