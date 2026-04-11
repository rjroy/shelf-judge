---
title: Commission batch cleanup (2026-04-10 to 2026-04-11)
date: 2026-04-11
status: complete
tags: [retro, commissions, cleanup]
---

## Context

45 commissions across 5 workers (Dalton 22, Octavia 13, Thorne 9, Sienna 2, Verity 1), spanning 2026-04-10 to 2026-04-11. Three feature chains: Reduce Tournament Overhead (complete, PR #13 area), Collection Profiling (complete), Prediction Engine (complete, PR #14). Plus one standalone fix (clear axis value) and one followup (prediction preview on search results, PR #14).

## What Worked

The implement-review-fix cycle caught real defects before merge. Across the three chains, Thorne reviews surfaced two critical bugs (Jaccard distance with fractional centroids, revealed-preference tension type mismatch) and several medium-severity gaps that Dalton fixed in subsequent commissions. The phased implementation approach (types first, then service, then UI, then CLI) kept blast radius manageable per phase.

Octavia's reconciliation commission (updating prediction spec/plan after profiling shipped) prevented the prediction chain from building on stale assumptions about shared infrastructure.

## Loose Threads

### Prediction engine divergence

The prediction engine implementation drifted from spec in several ways. The user pulled it back toward useful, but the broader question is whether the spec itself needs revision. Specific symptoms:

- The spec uses "experimental" terminology; the implementation uses "weak" vs "strong" confidence labels. The implementation's approach is arguably clearer for users.
- `predictionUnavailable` field is emitted by the daemon but consumed by neither client. The global readiness widget partially compensates at Stage 0.
- The prediction mockup assumes a navigation structure that profiling subsequently changed.
- Normalization approach differs from profiling (collection-relative vs potentially fixed-scale for out-of-collection games).

These aren't individual bugs to fix. They suggest the prediction spec needs a reconciliation pass against what was actually built and what the user adjusted post-implementation.

### Resolved during triage

- **Pre-existing typecheck errors in test fixtures:** Fixed by the user.
- **Profiling LLM requirements tracking gap:** Updated `actually-implement-the-llm-narrative.md` to include REQ-PROFILE-18 through 28.
- **REQ-TOURN-7 supersession:** Marked superseded in the original tournament spec with cross-reference to reduce-tournament-overhead spec.

### Filed as new issue

- **`document-families-tag-type`:** BGG `families` tag type is imported and stored but not referenced in specs or design docs. This caused it to be missed during collection profiling, requiring a manual fix.

### Dismissed Thorne final-validation findings

These survived the fix cycle but are style opinions or theoretical concerns, not defects:

- **Profiling: Suggestion text is declarative instead of question-form.** The spirit of the requirement (don't command the user) is met. Functional impact is zero.
- **Profiling: Outlier rows show numeric distance chips instead of named-attribute reason text.** Plan deviation, not a spec violation. Chips answer "which component drove this" at a glance.
- **Profiling: Dead stale-state CSS.** Infrastructure that was correctly not needed. A few lines of unused CSS, not a bug.
- **Profiling: Low-count BGG attributes not visually distinguished.** Sorted position with small bars provides implicit de-emphasis. Polish, not correctness.

## Infrastructure Issues

**Rate-limit retries.** Three Dalton commissions hit API rate limits during execution (Tournament Phase 3, Profiling Phase 4, Prediction Phase 5 Web UI). All retried successfully, but this pattern suggests the commission system's concurrent dispatch can overwhelm tool APIs.

## Lessons

- Reconciliation commissions (updating specs/plans after a related feature ships) prevent stale-assumption bugs in dependent chains. Worth the overhead.
- Thorne final-validation findings need triage before filing. Of 10 surviving findings across three chains, 3 were genuine, 3 were trivial fixes, and 4 were style opinions. Treating all findings as equal creates noise.
- Pre-existing issues accumulate across phases when each commission reports them as "not mine." The typecheck fixture errors were noted in at least 3 commissions but never addressed because no single commission owned them.
