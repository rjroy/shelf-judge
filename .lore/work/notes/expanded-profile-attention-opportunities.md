---
title: Expanded Profile attention implementation log
date: 2026-09-20
status: in-progress
bead: shelf-judge-1l7.4
---

# Expanded Profile attention implementation log

Phase 2 is in progress pending parent review. The shared contracts, additive v8
migration, and validation fixtures are implemented. The approved plan and the accepted-source conflict representation design govern this phase. Beads remains the task-status
authority. No source-selection or feedback handler behavior is part of this phase.

## Artifact reclassification

`accepted-source-conflict-representation.md` was reclassified from a spec to a non-normative technical design under `.lore/work/designs/`. It records completed plan-step discovery derived from the already approved product spec and plan; it adds no approval gate. Phase 2 implementation remains in progress and is not accepted.

## Obligation and evidence matrix

| Obligation | Implementation and validation evidence |
| --- | --- |
| Versioned registry, immutable source checks/observations, evaluator snapshots, boundaries | `packages/shared/src/accepted-play-sources.ts`; `packages/shared/tests/expanded-profile-contract.test.ts` rejects malformed historical rows, invalid references, duplicate identities, and snapshot/count mismatches |
| Atomic repeatable migration, empty streams, legacy-origin markers, no evidence backfill | `collection-migration.ts` v7→v8 step; `expanded-profile-migration.test.ts` covers deterministic repeat, artifact invalidation, temporary-write, and rename interruptions |
| Preserve legacy evidence, intentions, baselines, resolutions, and history | Migration fixture covers timestamped, timestamp-less, missing, invalid, unlinked, active baseline/baseline-free, completed, retired, and dated-session data; entire historical projection remains equal |
| Local feedback events, bounded No reason, strict owner/game/card associations | `attention-feedback.ts`, collection/source validators; contract tests cover all answers, unauthorized trusted contexts, malformed IDs/times, wrong associations, forbidden fields, and bounded Unicode text |
| Record/history/delete contracts and text-free idempotence receipts | Command schemas, stable canonical request fingerprints, owner-context schema factory, current-card schema factory, and receipt metadata; history/delete require durable event ID, not an active card. Actual command replay/persistence handlers belong to phase 4 |
| Public family/history contracts and duplicate-card rejection | Attention schemas accept the two families, retain intention-derived identity/actions/destinations, expose optional feedback IDs and separate accepted-source evidence; duplicate cards and inconsistent evidence summaries reject |
| Disposable cache version bump | Collection schema 8, Profile contract 10, algorithm 12; `profile-persistence.test.ts` proves outgoing and mixed-version caches are discarded |
| Existing permanent game deletion | `game-service.ts` removes additive per-game source metadata atomically after the existing intention-history guard; `game-service.test.ts` proves migrated metadata does not make a game undeletable |
| Quality gates | `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run build` passed. Full suite: 3,036 passed, 1 skipped, 0 failed. Changed shared/daemon files pass Prettier; `git diff --check` passes |

## Contract decisions for the next phase

- Durable fields are `acceptedPlaySources` and `attentionFeedback`. The new source
  registry is closed at representation version 1. Observation IDs use JSON-array
  encoding of the approved canonical tuple. Payload identity is a SHA-256 digest;
  complete BGG session observations retain their own validated snapshot, separate
  from legacy `bggPlaySessions`.
- Migration establishes v1 singleton policy snapshots for games with a non-null
  `bggId`, leaves unlinked games without a policy, and marks all historical game
  IDs. It captures no checks, observations, boundaries, feedback, or owner actions.
  Policy snapshots can outlive a later BGG unlink. The future evaluator must check
  current linkage before using v1, rather than making unlinking fail validation.
- Feedback is scoped to the local owner collection ID. Authorization factories
  require a trusted daemon context; a request-supplied identity is not authority.
  Reasons have categories `not-relevant`, `already-aware`, `incorrect-evidence`,
  or `other`, with optional text limited to 500 Unicode code points. Only No may
  have a reason. A separate validated `attach-feedback-reason` command supports
  persisting No before its single optional reason submission. Its future handler
  must enforce No-only, one attachment, and immutable event identity/answer/time.
- Receipts retain SHA-256 request fingerprints and acceptance metadata only.
  They contain no reason category/text or full request/result event and remain
  valid after event deletion. Future handlers deduplicate identical command IDs
  and reject conflicting reuse. Source writers likewise deduplicate exact replay
  before persistence; persisted duplicate canonical identities are invalid.
- Existing `currentPlayEvidence` remains legacy-owned. Optional
  `acceptedPlayEvidence` is a separate validated public summary. Step 3 must
  produce it from durable source records and enforce current/superseded checks,
  boundary selection, missing-origin reasons, cache invalidation, and fallback.
  Its structural consistency checks do not perform card selection.

## Scope adjustments and review

The only production touch beyond the likely step-2 paths is the permanent-game
deletion cleanup in `game-service.ts`. Without it, the migration-origin marker
would cause existing deletion to fail collection referential validation. The
existing history guard and all evidence/completion paths are unchanged. Existing
test fixtures were mechanically advanced to v8, while historical fixtures retain
their historical schemas.

A fresh subagent review was attempted but the harness rejected it with
`Subagent depth limit reached (1)`. Parent review is still required. No bead was
closed and no commit or remote sync was performed.

## Resume boundary

Implement only plan step 2. Keep `shelf-judge-1l7.4` open for parent review.
Selection, source mutation capture, feedback handlers, routes, CLI, and web are
subsequent phases. New source records never replace legacy current evidence or
authorize/veto existing automatic completion.
