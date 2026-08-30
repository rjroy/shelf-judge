---
title: Profile appreciation scoring
date: 2026-08-29
status: active
tags: [collection-profile, ranking, bayesian-shrinkage, entity-associations]
modules: [collection-profile-engine, collection-profile-validation, profile-web]
---

# Profile appreciation scoring

## Key Findings

Profile appreciation should mean: **entities associated with games that fit the owner's current preferences.**

Rank entities by a Bayesian-style adjusted fitness mean. Use the configured `minimumSupportedGames` for that entity class as the prior weight. Association count matters as evidence, not appreciation: it controls shrinkage, determines whether evidence is supported, and breaks adjusted-mean ties.

Do not add a representation ranking to the overview. A common mechanic such as Hand Management can appear frequently because many games use cards, not because it explains why the owner values those games. Prolific designers and artists create the same false signal. Count and collection share may remain available in the evidence drilldown, but must not be presented as preference, identity, or appreciation.

## Recommended Algorithm

For entity `e` within one entity class, let:

- `n_e` be its unique eligible associated game count.
- `mean_e` be those games' arithmetic mean current fitness.
- `mean_class` be the existing eligible collection comparator mean for that class.
- `m` be the class's configured `minimumSupportedGames`, currently `3` by default.

Define:

```text
adjustedMean_e = (n_e * mean_e + m * mean_class) / (n_e + m)
```

Order entities by:

1. `adjustedMean_e` descending.
2. `n_e` descending.
3. normalized name using the existing code-point comparison.
4. entity ID ascending.

Compute the adjusted mean for every entity in the full drilldown. Continue to exclude entities with fewer than `minimumSupportedGames` from the overview. The adjusted value is an explainable policy heuristic, not a probability, confidence interval, or inferred true rating.

The overview should explain each result with the adjusted mean, raw mean, class comparator, and associated game count. For example: "Games associated with this mechanic have an adjusted fit of 8.0, based on 3 games averaging 9.0 compared with 7.0 across the eligible collection."

## Why Count Is Not A Second Ranking

Association count answers "what occurs often in this collection," not "what does the owner appreciate." Those differ for several reasons:

- Ubiquitous mechanics occur across games chosen for unrelated qualities.
- Prolific designers and artists have more opportunities to appear.
- A game can link to several entities, so representation shares overlap.
- Metadata richness varies between games and entity classes.
- Ownership does not establish which linked entity caused enjoyment.

Do not fractionally divide one game's contribution among linked entities. That would penalize richer metadata and imply unsupported credit allocation. Continue to count a given game once per distinct entity and deduplicate repeated links to the same entity.

Count remains useful in three places:

- It determines whether evidence is limited or supported.
- It determines how strongly the raw mean is shrunk toward the comparator.
- It breaks exact adjusted-mean ties and can remain an explicit drilldown sort for diagnostic use.

## Candidate Evaluation

| Candidate                                 | Strengths                                                                 | Failure mode                                                                                                     | Decision                                  |
| ----------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Arithmetic mean                           | Exact, simple, already exposed                                            | Minimally supported entities can win on tiny raw-mean differences                                                | Retain as evidence, not the ranking value |
| Comparator-adjusted mean                  | Tempers small samples and converges toward the raw mean as evidence grows | Prior weight is policy, not learned truth; shared games make entity observations correlated                      | Use for appreciation ranking              |
| Count or collection share                 | Direct and explainable representation measure                             | Common mechanics and prolific creators dominate without showing why games fit                                    | Keep as diagnostic evidence only          |
| Adjusted mean plus `lambda * log(1+n)`    | Produces one sortable number                                              | Mixes unlike units; `lambda` silently defines appreciation and can let frequency hide poor fit                   | Reject                                    |
| Separate fit and representation overviews | Preserves two observable signals                                          | Elevates a noisy occurrence signal into a profile claim                                                          | Reject                                    |
| External prevalence adjustment            | Could discount ubiquitous entities                                        | Requires a defensible game universe, opportunity model, metadata policy, and refresh lifecycle that do not exist | Defer; do not block adjusted-fit ranking  |

## Representative Scenarios

These fixtures assume a comparator mean of `7.0` and configured `minimumSupportedGames = 3`.

| Scenario                            | Entity A                              | Entity B                                      | Required result                                                            |
| ----------------------------------- | ------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| Three excellent versus many average | 3 games at mean `9.0`; adjusted `8.0` | 20 games at mean `7.0`; adjusted `7.0`        | A ranks first; B's count remains evidence only                             |
| Tiny raw edge                       | 3 games at mean `9.0`; adjusted `8.0` | 20 games at mean `8.9`; adjusted about `8.65` | B ranks first because its nearly equal raw fit has much stronger evidence  |
| Quantity is not affinity            | 3 games at mean `9.0`; adjusted `8.0` | 20 games at mean `5.0`; adjusted about `5.26` | A ranks first; B does not receive a count bonus                            |
| Limited outlier                     | 1 game at `10.0`; adjusted `7.75`     | 3 games at mean `8.0`; adjusted `7.5`         | Limited entity can lead the full drilldown but remains out of the overview |
| Exact adjusted tie                  | 3 games at mean `8.0`                 | 6 games at mean `7.75`                        | Both adjust to `7.5`; B wins the count tie-break                           |
| Veto evidence                       | 3 games scored `[0, 9, 9]`            | 3 games scored `[6, 6, 6]`                    | Both adjust to `6.5`; existing name and ID tie-breakers apply              |

Tests must also cover empty comparators, incomplete metadata, exclusions, duplicate links, non-ASCII normalized names, reordered input, and adjusted values that differ only beyond display precision.

## Entity Classes And Prevalence

Use the same formula for mechanics, designers, and artists, but calculate each class independently with its own comparator and configured minimum. Never compare adjusted means across entity classes.

The collection-only data cannot correct for ubiquitous mechanics or prolific creators. Inverse-frequency weighting could do so only with a stable external corpus and a defined opportunity set. Using the owner's collection as both observation and prevalence baseline would be circular. Until suitable external data exists, labels must say "associated with high-fitting games," not "favorite," "preferred," or "responsible for fit."

## Data And Contract Requirements

The implementation needs no new external data. Preserve all current eligibility, exclusion, canonical-name, deduplication, support-threshold, and evidence rules, including vetoed zero scores.

The disposable profile contract should:

- Add `adjustedMeanCurrentFitness` to every entity.
- Rename the ambiguous `rating` ordering to `bestFit`; retain `support` only as a diagnostic count-first drilldown ordering and retain `name`.
- Keep one `overviewEntityIds` list selected from supported entities in `bestFit` order.
- Include or expose the prior weight used for the snapshot so consumers can explain the calculation without ambient defaults.

The daemon and shared validator must independently recompute adjusted means and deterministic ordering with exact rational arithmetic. Serialize numeric display values only after ordering; never sort rounded values.

Increment the disposable profile contract and algorithm versions, then regenerate rather than translate old `profile.json` snapshots. The collection schema does not change. Update API, CLI, web, persistence, accessibility, and end-to-end fixtures together.

## Validation Requirements

1. Hand-calculated daemon tests cover every scenario above.
2. Shared contract tests independently reject incorrect adjusted means, ordering, ties, support filtering, and overview IDs.
3. Web tests show adjusted mean, raw evidence, comparator, and count without describing count as appreciation.
4. Drilldown count sorting is clearly diagnostic and never controls the overview.
5. Snapshot tests prove older profile contract and algorithm versions are invalidated.
6. Typecheck, lint, tests, build, and changed-file formatting pass.

## Sources

- Gelman, A. (2006), ["Multilevel (Hierarchical) Modeling: What It Can and Cannot Do"](https://www.stat.columbia.edu/~gelman/research/published/multi2.pdf). Partial pooling tempers unstable group estimates; it does not turn group size into preference.
- scikit-learn User Guide, ["Tf-idf term weighting"](https://scikit-learn.org/stable/modules/feature_extraction.html#tfidf-term-weighting), accessed 2026-08-29. Inverse document frequency motivates prevalence correction but does not supply the missing game corpus or opportunity model.
- Shelf Judge profile engine, shared validation, web components, and tests, inspected 2026-08-29.

## Decision

Rank appreciation only by comparator-adjusted fitness. Use the configured `minimumSupportedGames` as the prior weight. Keep association count as evidence, shrinkage strength, support eligibility, and a deterministic tie-breaker, but do not present representation as a second appreciation or identity ranking.
