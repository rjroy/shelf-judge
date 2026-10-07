---
title: "Design: unified similarity for prediction and redundancy"
date: 2026-10-04
status: completed
tags: [ design, prediction, redundancy, jev, similarity, privacy, wishlist ]
modules: [ daemon-services, prediction, redundancy, jev-cache, wishlist, shared-contracts ]
related: [ .lore/local/plans/unified-similarity-prediction-redundancy.md, .lore/work/design/semantic-snapshot-cache.md, .lore/reference/specs/fitness/prediction-engine.md, .lore/reference/specs/fitness/redundancy-scoring.md, .lore/reference/specs/features/wishlist.md, .lore/reference/specs/current/owner-game-notes.md ]
---

# Design: unified similarity for prediction and redundancy

## Authority and lifecycle

This design is **approved by the user** as the implementation contract for Beads epic `shelf-judge-bs1y`. Its companion `.lore/work/plans/unified-similarity-prediction-redundancy.md` sequences implementation and validation. Approval authorizes the planned seven-phase work and creation of its bounded phase beads; it does not mean implementation has started or waive phase gates. The epic remains open while work proceeds and is routed `agentic` once its approved executable child workgraph is recorded.

> **Current evidence publication authority — 2026-10-05:** The approved [semantic snapshot cache design](semantic-snapshot-cache.md) adds the durable run-owned staging and terminal publication boundary used by this design. It changes evidence visibility timing, not F/D/O arithmetic, pair demand, proof identity, source eligibility, frozen authorization, consent, or privacy. Run checkpoint progress remains atomic with private staging but ordinary readers continue to see only published evidence; the worker alone receives its run overlay. One terminal finalizer can publish the still-valid subset after every terminal outcome, without a full-coverage or activation gate. Execution outcome remains distinct from published/unchanged/pending state; sealed outcomes survive restart, and provider-free retry/recovery preserves them. Immediate source/permission fencing and the existing indexed point-read/performance contracts remain in force. Phases 1–5b are locally accepted; holistic validation and terminal project acceptance remain pending.

## Product impact requiring explicit approval

- Similarity now uses prediction's factual Jaccard/normalized-Manhattan evidence plus currently valid cached JEV on both collection and wishlist prediction reads. Neighbors, scores, confidence, redundancy, and order can change; old numeric fixtures are not guaranteed to remain calibrated.
- Current wishlist reads no longer present stale saved derived scores as current fallback. Saved facts/history remain stored, but entries without enough saved factual source can show `missing-source` until explicit refresh. Current results are explicit `available`/`unavailable` projections.
- Note-dependent predictions and their transitive ranking/redundancy effects are revoked/fenced with their source permission. A cleanup failure or disabled redundancy does not permit showing a derived result that used revoked notes.

These are material effects, not implementation details. The user explicitly approved these impacts together with the design and plan; preserve them during implementation and validation.

## Design goals and non-goals

One factual/component/weight definition must govern pair similarity wherever prediction or redundancy consumes it. Collection and wishlist prediction must be the same algorithm. Prediction may use axis-specific rated reference sets while redundancy uses its own owned-positive/non-veto set, but if the pair, source evidence, availability, and effective settings are identical, the pair similarity is identical. Ordinary reads use valid cache only and remain inference-free. Explicit inference has a frozen, disclosed, bounded scope. Derived results are privacy-fenced by the complete dependency proof.

Non-goals: a second persisted prediction-weight model; new per-consumer defaults or wishlist scoring exceptions; a new privacy/publication framework; network inference or BGG hydration on reads; permanent feature toggles or mixed algorithms; preserving former numerical calibration; wishlist historical-score/provenance redesign; unrelated UI redesign.

## Shared similarity and settings

Factual similarity `F` uses the prediction encoder's existing factual binary Jaccard distance and normalized continuous Manhattan distance. It excludes personal and tournament axes. Let `b` and `c` be the existing stored `RedundancySettings.componentWeights.binary` and `.continuous` values:

```text
F = 1 - (b * jaccardDistance + c * normalizedManhattanDistance) / (b + c)
```

The default ratio is `b:c = 4:3`, but every valid persisted ratio is respected. Do not hardcode `4/7` and `3/7` in place of stored settings. Keep source-revision compatibility behavior in `stored-source-revision.ts`, including stripping historical personal axes and mapping legacy `b=c=0` to existing default factual weights. Factual vectors are constructed using the frozen context of all collection BGG factual fields, including previously-owned/ineligible games; a candidate is encoded against that context and is not added to it.

For available components F (factual), D (description JEV), and O (owner-note JEV), the shared pair score is:

```text
S = sum(w_i * s_i for available i) / sum(w_i for available i)
```

Unavailable or unauthorized components are omitted from both sums. An available component with value zero remains available and retains its configured weight. If no positive-weight component is available, return typed `UNAVAILABLE`/`null`, never numeric zero. The same effective component settings and calculation are used by prediction and redundancy.

### Existing settings are the sole persisted source

Continue storing redundancy settings in `redundancy-settings.json` (`RedundancySettings.componentWeights`) and semantic settings in `collection.semanticRedundancy.settings` (`enabled`, `weights.factual/description/ownerNote`, `cachedOwnerNoteUse`). Capture these into one logical in-memory `SimilaritySettings`; do not persist a duplicate prediction-weight object or add avoidable migration.

- `collection.semanticRedundancy.settings.enabled` governs D/O semantic component use for every consumer.
- `cachedOwnerNoteUse`, source provenance, consent and current permission govern whether note-derived evidence is usable/transmittable under current rules.
- `RedundancySettings.enabled` governs only applying the redundancy penalty/adjustment. It never gates prediction similarity.
- Keep `jev1.13.0`, question 2, and compatible raw cached JEV judgments; raw judgment identity is weight-independent.
- Settings/source write fences bind calculations to the exact captured settings. Weight changes invalidate derived outputs/proofs as required but do not discard reusable raw judgments or start provider work.

## Prediction and reference semantics

Keep the current axis-specific k, minimum-neighbor threshold, estimator, confidence, and readiness rules. Replace only the similarity inputs. The estimator remains `sum(rating²*S) / sum(rating*S)` for its existing eligible rated neighbors. Derive actual personal and tournament labels/readiness from captured actual sources; never use a predicted score as a training label. Do not encode axis names, ratings, or labels as factual features. Exclude the candidate itself. Include genuine previously-owned personal/tournament-rated references where existing rules permit them.

For each target and each axis that actually needs prediction, prediction demand contains one pair to every reference actually rated on that axis. Do not factual-top-K prefilter pair requests; semantic evidence must be able to change nearest-neighbor ordering. The target's fixed collection factual context includes all collection BGG facts, including references not eligible on that axis. Collection and wishlist invoke this same predictor, settings, and pair resolver.

## Source capture, pair scopes, and frozen inference

Capture raw collection/BGG facts, tournament source data/labels, notes, prediction settings, semantic settings, source permission/provenance, cache revision, and source/mutation identity before deriving fitness. Source authorization and pair eligibility must be independent of downstream prediction fitness and redundancy eligibility.

Define canonical demanded pair key by collection ID/domain, canonical pair members and signal/subkey. Consumer and prediction axis do not belong in raw cache judgment identity. The prediction demand set P is:

- Collection full-list/snapshot: every non-previously-owned target needing at least one axis crossed with each actual rated reference for each such axis.
- Collection explicit target-list: only requested eligible targets, crossed with those same per-axis actual rated references.
- `predictGame`: that one requested target crossed with the applicable references.
- Wishlist: only selected wishlist candidates crossed with actual rated local collection references, including previously-owned refs. Local-member tagging is not an ownership gate. Preserve acquisition-controlled candidate-to-owned transfer behavior.

Wishlist runs may use owned-local cache-only prediction to determine current fitness, but that does not authorize collection-pair inference in a wishlist run. Determine the actual targets selected by current public callers when implementing the scope, but do not expand the scope beyond these definitions.

After cache-only resolution of P, compute current fitness. Derive redundancy demand R from the current owned positive-score, non-veto candidate/reference set under existing redundancy rules. Resolve `R \ P` cache-only in the same prepared context, then seal proof. An explicit preview freezes and discloses `U0 = dedup(Pscope ∪ Rscope)` including expanded references, requested source inputs, cache hits/misses and budgets. A run executes only U0 even if newly cached judgments later change eligibility; further pairs require a later explicit preview/run. Completion means the frozen authorized scope is complete, not global cache coverage. Source changes invalidate the authorization; cache coverage growth alone never expands it.

## Prepared pair resolver and proof boundary

Create one internal `PreparedSimilarity` (or equivalent existing-convention component) from a captured source/settings snapshot. It builds one factual context/vectors and memoizes canonical pairs. It provides:

1. Cache-only indexed `resolvePairs(demandedSet)`; no gateway or BGG calls.
2. `similarity(pair): number | null`, which combines available authorized F/D/O with the shared settings.
3. `sealProof()` after all demanded pairs have been resolved; a sealed instance rejects pair expansion.
4. `isCurrent()` for source/permission/cache freshness at publication and read boundaries.

Use indexed point-cache queries and reusable read proofs; never list/scan the full cache for each consumer. Raw judgments remain weight-independent. Keep raw-row validation/provenance/source validity separate from consumer fitness eligibility. Freeze authorized settings/policy/selection/source-mutation generation separately from raw judgment identity.

Extend the existing shared `SemanticScoringInputProof` to version 2 rather than adding a proof framework. Add the common algorithm identifier `SIMILARITY_ALGORITHM_VERSION = "unified-jaccard-manhattan-jev-v1"`. Deterministic durable identity binds factual context, actual labels/tournament data, prediction settings, common similarity settings, permissions, demanded pairs, all examined component-availability states and validated row identities—not just top-K rows. `processEpoch`, live change token and cache mutation revision are freshness fences, not durable cross-restart content identity. Note text stays private; only opaque proof/digests cross allowed persistence/publication boundaries.

## Privacy, revocation, and publication

An output is note-dependent if any path through source selection, shared C/D judgment, O judgment, neighbor selection, score, confidence, redundancy, or ordering depends on note-authorized evidence. Shared C/D judgments can be note-dependent even when O weight is zero. Wishlist ordering can inherit dependency through owned prediction even when the wishlist's own direct evidence is C-only.

Extend the existing displayed-fitness proof/publication boundary and owner-note revocation lifecycle. Fence immediately when permission is revoked, before/irrespective of asynchronous cleanup. This applies with redundancy disabled, during pending calculation, after restart, and if cleanup fails. At final acceptance/publication, check current source/proof immediately adjacent to the publish operation with no intervening await. On source change, bounded recapture/recompute or return explicit unavailable. Recompute the entire prediction and redundancy because top-K membership may change; never subtract a revoked component from a stale result. Historical v1 derived artifacts are not valid v2 proof and must be rebuilt from authorized current facts or remain unavailable.

Ordinary reads query currently valid cache only—no explicit refresh, inference, or BGG hydration. If one pair component is missing/unreadable, remaining coherent authorized components may still yield a valid prediction. If authority or factual source is insufficient, report unavailable; do not fabricate similarity/fitness zero or fall back to old saved-derived output. A valid F-based prediction with missing JEV remains valid. A genuine current veto score of zero remains a valid result.

## Wishlist and public result contract

Keep saved wishlist factual fields and historic derived storage immutable during ordinary reads. Wishlist reads operate on saved verified factual fields and current collection/tournament/settings sources; they do not call BGG prediction fetch. Use the exact collection prediction engine for current score, confidence and breakdown. Apply current redundancy once to that current base, never to a previously adjusted saved base.

Add a required `CurrentPredictionProjection` to `WishlistEntryReadResult` and shared runtime validation/types/exports:

- `availability`: `available` or `unavailable`; `source: "current"`.
- `result`: current `FitnessResult` or `null`.
- `predictionUnavailable`: existing readiness reason or `null`.
- Unavailable reason: `missing-source`, `source-unavailable`, `source-changed`, or `no-scoring-contribution`.

Keep existing readiness reasons distinct. A `WishlistRedundancyProjection` identifies `source: current | base-prediction | unavailable`, current adjustment (or null), and current adjusted/base ordering score (or null). Preserve flat GET wishlist array shape; any legacy derived fields alias current prediction or null, never historical saved scores. Existing GET wishlist/redundancy keeps `entry` and `redundancy` and adds current prediction. Add/Refresh responses return the same current projection. Web score/confidence/breakdown and prediction sorting use current prediction; redundancy sorting uses current adjusted/base ordering and puts unavailable last. CLI wishlist list uses the same projection; add/refresh copy states that facts were saved, not that the current score was saved. Do not expose private facts or notes in public profiles/API payloads.

An entry lacking sufficient saved factual source is `missing-source` on ordinary read until explicit refresh; no stale derived fallback is permitted. Preserve history in storage, but do not add a new persisted wishlist provenance/history framework. Treat the difference from old response semantics as an explicit compatibility change for user approval.

## Settings, budgets, and performance invariants

Keep existing `stored-source-revision.ts` compatibility and preserve arbitrary stored binary:continuous ratios and existing write fences. No per-consumer defaults, new persisted duplicate weights, or weights migration.

JEV run budget remains: default 1,000 attempts, 2,000,000 reported-token stop threshold, 30 minutes; maximum 75,000 attempts; reported-token threshold may be any positive safe integer; duration 1–720 minutes. Provider usage is learned after a response: usage can cross/overshoot threshold for that response, then subsequent dispatch is stopped. This is not a hard billing/token ceiling. All-hit run performs zero gateway calls and needs no authorization restart. Provider calls are serial, bounded, cancellable, outside short coordinator locks; each accepted judgment and progress update is one atomic checkpoint in private staging, not ordinary published evidence.

Use deterministic work counts, not invented latency targets. Preserve relevant existing evidence: 7 encodes for 12 pairs; 4×3 indexed comparisons; the wishlist read-proof fixture has 124 eligible owned IDs but validates 3 rows with 3 candidate plus 3 owned membership probes; unchanged proof causes 0 rereads; pair/signal memoization; no full-cache scan; all-hit zero gateway; serial maximum concurrency 1; one atomic judgment+progress checkpoint. Retain fixture definitions and meanings when extending tests.

## Design resolution trace

The design satisfies epic requirements by these contracts: common F/D/O S and shared weights; exact pair parity independent of consumer reference purpose; same collection/wishlist predictor; source-first P and post-fitness R with frozen union; cache-only reads and bounded explicit run; transitive permission fencing; no stale saved-score fallback; compatible settings and raw judgments; and deterministic proof/performance evidence. The companion approved plan sequences those contracts into inert phases followed by one atomic activation. No alternate metric, separate settings model, prediction-read refresh path, or deployment toggle is left as an open option.
