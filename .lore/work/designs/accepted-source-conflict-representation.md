---
title: Accepted-source conflict representation
date: 2026-09-20
status: completed
kind: technical-design
bead: shelf-judge-1l7.3
implements:
  - .lore/work/specs/expanded-profile-attention-opportunities.md#req-profile-attn-5
  - .lore/work/specs/expanded-profile-attention-opportunities.md#req-profile-attn-7
  - .lore/work/plans/expanded-profile-attention-opportunities.md#1-document-the-completed-accepted-source-conflict-representation
related:
  - .lore/reference/specs/current/useful-collection-profile.md
---

# Accepted-source conflict representation

## Authority and purpose

This completed technical design records the implementation representation discovered for approved plan step 1. It implements the evidence boundary required by approved [Expanded Profile Attention Opportunities](../specs/expanded-profile-attention-opportunities.md), REQ-PROFILE-ATTN-5 and REQ-PROFILE-ATTN-7. It creates no product requirement, separate normative authority, or additional approval gate. The approved product spec and implementation plan remain authoritative.

The shipped [Useful Collection Profile](../../reference/specs/current/useful-collection-profile.md) remains authoritative for legacy intention lifecycle, evidence warnings, baseline capture, and update-time-only above-baseline automatic completion.

## Discovered current model

Before the v8 extension, the durable collection schema was v7. A game had one aggregate `playCountEvidence`, one `latestPlayCountCheck`, and dated `bggPlaySessions`; the aggregate could establish one current value but could not preserve disagreement among accepted sources. Existing mutation paths are BGG aggregate checks, dated BGG `/plays` imports, and manual correction. `profile.json` is derived cache data; profile reads do not mutate, and validation/cache/recomputation failure is profile unavailable with retry rather than an empty fallback.

## Chosen additive representation

v8 retains all legacy evidence fields and mutation semantics, and adds versioned `acceptedPlaySources` data separate from legacy current evidence:

- A closed accepted-source registry identifies `bgg-collection-aggregate@1` (`bgg.aggregate.total.v1`), `bgg-play-sessions@1` (`bgg.plays.snapshot.v1`), and `owner-manual-correction@1` (`owner.manual-correction.v1`). Unknown tuples are invalid.
- Append-only source-scoped observations and checks are keyed by game, source/version, and check definition. Observations carry canonical IDs, `observedAt`, `receivedAt`, immutable check ID, finite non-negative count, and deterministic payload identity. Checks record exactly `valid`, `missing`, or `invalid`; `valid` references a same-stream observation with matching check/time/count.
- Stream order is ascending canonical `(receivedAt, checkId)`. The newest check supersedes prior checks in its stream. Exact identical replay is idempotent; a conflicting duplicate identity is invalid.
- Evaluator policy snapshots contain an ordered exact `requiredSourceSet`, distinct from the registry. v1 uses only a linked game's `bgg-collection-aggregate@1` tuple. Unlinked games have no conflict-sensitive qualification state. Manual correction and `/plays` observations are accepted but not implicitly required.
- Evaluator-scoped immutable freshness boundaries identify the establishing check and refresh-start time. A valid observation is fresh only when `observedAt > refreshedAt`; equality is stale. With no boundary, a valid timestamped observation is fresh. Missing `observedAt` produces a well-formed `invalid` check, while malformed persisted data fails collection validation.
- Source status is deterministically missing, invalid, stale, or valid. Set-level precedence is `invalid > missing > stale > disagreement > agreement`. Only agreement can supply conflict-sensitive exact-zero qualification; every other state makes the predicate false and preserves the existing `play-intention` warning fallback.

The representation intentionally defines no cross-source precedence, averaging, merging, or inferred source set.

## Compatibility, migration, and fixture implications

The extension never replaces or supplies legacy `playCountEvidence`, latest BGG check, sessions, baselines, or automatic-completion inputs. Legacy BGG/manual/session acceptance rules remain independent. A valid trusted later legacy count above its captured baseline continues to complete an intention only during the accepted evidence update.

Migration from v7 to v8 is atomic and repeatable: preserve legacy evidence, sessions, intentions, baselines, resolutions, and history; initialize additive streams/boundaries empty; record migration origin; and do not backfill or fabricate observations, checks, boundaries, or IDs. A linked required source without a captured new check reports `missing/legacy-unavailable` in the new evaluator only.

Implementation fixtures must cover canonical identity/replay, source-local supersession, timestamp freshness, missing/invalid/stale/disagreement precedence, malformed persisted data producing unavailable-with-retry, no-backfill migration, unlinked games, cache invalidation, and preservation of legacy completion/session behavior. These are design constraints for the approved implementation work, not an approval prerequisite.
