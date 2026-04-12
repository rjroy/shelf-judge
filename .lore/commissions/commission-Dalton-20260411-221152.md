---
title: "Commission: Fix: Niche tag filtering final review findings"
date: 2026-04-12
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Read Thorne's final review of the complete niche tag filtering feature. The review commission is `commission-Thorne-20260411-221148`. Check `.lore/commissions/` for the review artifact.\n\nAddress ALL findings. The plan is at `.lore/plans/niche-tag-filtering.md` for reference.\n\nRun `bun run test`, `bun run typecheck`, and `bun run lint` after all fixes."
dependencies:
  - commission-Thorne-20260411-221148
linked_artifacts:
  - packages/daemon/tests/niche-settings-integration.test.ts

  - packages/web/components/niche-ignore-button.tsx
  - packages/web/components/niche-ignore-button.tsx
activity_timeline:
  - timestamp: 2026-04-12T05:11:52.457Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T05:19:25.236Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T05:38:47.039Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T05:38:47.043Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T05:38:47.065Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T05:38:58.354Z
    event: progress_report
    reason: "Read Thorne's review. Two findings: (1) actionable test gap on GET /games?includeNiches=true with non-empty ignored tags, (2) informational storageService optionality (no action needed). Writing the missing integration test now."
  - timestamp: 2026-04-12T05:40:30.013Z
    event: result_submitted
    reason: "Addressed all findings from Thorne's review:\n\n**Finding 1 (test gap):** Added two integration tests to `packages/daemon/tests/niche-settings-integration.test.ts` covering GET /games?includeNiches=true with non-empty ignored tags. Both branches tested: `includePredicted=false` and `includePredicted=true`. Tests verify that ignoring \"Deck Building\" mechanic removes it from niche positions while preserving \"Card Game\" category.\n\n**Finding 2 (storageService optionality):** No action required per Thorne's assessment. Pre-existing pattern, informational only.\n\n**Lint fix:** Fixed two `@typescript-eslint/no-misused-promises` errors in `packages/web/components/niche-ignore-button.tsx` where async handlers were passed directly to `onClick`. Wrapped in `() => void handleIgnore()` / `() => void handleRestore()`.\n\nVerification: 930 tests pass, typecheck clean, lint clean."
  - timestamp: 2026-04-12T05:40:34.488Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Read Thorne's review. Two findings: (1) actionable test gap on GET /games?includeNiches=true with non-empty ignored tags, (2) informational storageService optionality (no action needed). Writing the missing integration test now."
projectName: shelf-judge
---
Addressed all findings from Thorne's review:

**Finding 1 (test gap):** Added two integration tests to `packages/daemon/tests/niche-settings-integration.test.ts` covering GET /games?includeNiches=true with non-empty ignored tags. Both branches tested: `includePredicted=false` and `includePredicted=true`. Tests verify that ignoring "Deck Building" mechanic removes it from niche positions while preserving "Card Game" category.

**Finding 2 (storageService optionality):** No action required per Thorne's assessment. Pre-existing pattern, informational only.

**Lint fix:** Fixed two `@typescript-eslint/no-misused-promises` errors in `packages/web/components/niche-ignore-button.tsx` where async handlers were passed directly to `onClick`. Wrapped in `() => void handleIgnore()` / `() => void handleRestore()`.

Verification: 930 tests pass, typecheck clean, lint clean.
