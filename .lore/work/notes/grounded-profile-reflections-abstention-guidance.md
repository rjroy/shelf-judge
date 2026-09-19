---
title: Grounded profile reflection abstention guidance implementation
status: implemented
date: 2026-09-19
---

## Obligations

Do not represent every cited game as a missing-note task. Distinguish current notes that were not examined from no current notes, do not promise that notes will produce an answer, and preserve owner-approved per-question refresh.

## Phase progress

- Shared result contract now carries daemon-owned, reason-specific abstention guidance.
- Evidence collection records aggregate current-note state without publishing broad game lists.
- The validator selects guidance from the question, abstention reason, and evidence state.
- The card presents the supplied message and explicit per-question refresh instruction.
- Component and browser regressions cover missing testimony, present-but-unexamined notes, non-note blockers, removal of the broad game list, and the owner-triggered per-question refresh path.
- Storage read normalizes legacy cached `noteGuidance` by discarding its broad list before shared-contract validation, preserving that cache and unrelated valid entries.

## Decisions

Game-specific suggestions are omitted because the lazy evidence turn cannot prove that every cited game is a bounded, relevant missing-note target. Non-note blockers state that additional notes may not resolve the abstention. When testimony is the actionable blocker, guidance says that relevant experiences across more than one game can help without imposing a numeric rule on questions whose policy makes notes optional.

## Tests

Focused shared, daemon evidence, daemon validator, and web component tests cover the revised contract and absence of broad game lists. The grounded Playwright fixture seeds all three guidance classes and verifies that no refresh occurs during navigation, while the exact question refresh is sent only after the owner selects `Refresh this question` and confirms disclosure.

The migration rename-failure regression verifies that the durable source cache remains byte-for-byte unchanged and is never unlinked, while allowing atomic-write cleanup to unlink temporary artifacts.
