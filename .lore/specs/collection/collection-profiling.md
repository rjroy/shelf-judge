---
title: "Collection Identity and Trusted Insight Profiling"
date: 2026-04-10
status: implemented
tags: [spec, profiling, collection, trusted-insights, outlier, divergence, narration]
modules: [shared, daemon, cli, web]
req-prefix: PROFILE
related:
  - .lore/brainstorms/collection-profiling.md
  - .lore/work/notes/trusted-collection-insights-consumers.md
  - .lore/work/notes/trusted-collection-insights-validation.md
  - .lore/specs/tournament/elo-axis-source.md
  - .lore/specs/tournament/tournament-ranking.md
  - .lore/specs/fitness/utility-curves.md
  - .lore/work/specs/derived-bgg-axes.md
  - .lore/vision.md
---

# Spec: Collection Identity and Trusted Insight Profiling

## Authority And Supersession

This document describes the implemented profile contract and algorithm as of 2026-08-27. It supersedes the signal methods proposed in the April 2026 [collection-profiling brainstorm](../../brainstorms/collection-profiling.md) and in earlier revisions of this spec.

The original product intent remains useful: make the collection's identity legible, compare stated and revealed preference without deciding which is correct, and present observations rather than curation instructions. The following old methods are not current behavior:

- Tournament divergence against a fitness score that contains the Tournament axis
- ownership concentration or factual variance as evidence that an axis should exist
- collection-centroid distance and a two-standard-deviation outlier threshold
- `lone-wolf`, `category-orphan`, or `high-fitness` outlier classifications
- omitted insufficiency and unavailable states
- free-form narration that can create new profile claims

The persisted profile contract version is **6** and the profile algorithm version is **7**. These versions identify the current disposable cache shape and producer semantics. They do not promise migration or compatibility for old profile artifacts.

## Purpose

The Profile Overview makes existing collection evidence inspectable. It combines deterministic summaries with trusted insight records for preference divergence, factual collection outliers, and evidence-backed axis questions. The profile never changes a game rating, fitness score, axis, Tournament result, or ownership decision.

The profile is available through:

- the web Profile Overview
- trusted insight sections on game detail
- `GET /api/profile`
- the structured JSON returned by `shelf-judge profile`
- user-initiated profile narration

## Profile Summary Data

1. **REQ-PROFILE-1:** Profile computation MUST be deterministic local computation over stored collection, fitness, BGG, and Tournament data. The algorithmic computation MUST make no network or model call.
2. **REQ-PROFILE-2:** Axis distributions MUST use effective ratings from fitness breakdowns for enabled scoring axes. Each distribution MUST expose rated-game count, histogram, mean, median, population standard deviation, and range. An enabled axis with no effective ratings MUST remain present with zero values and ten zero histogram buckets.
3. **REQ-PROFILE-3:** Axis weights MUST include enabled scoring axes, express each weight as a percentage of total enabled weight, and sort them by descending percentage. No weights MUST produce an empty list.
4. **REQ-PROFILE-4:** BGG clustering MUST count mechanics, categories, families, and subdomains among games with BGG data. A repeated label on one game MUST count once. Weight-range percentages MUST use only games with a non-null BGG weight as their denominator.
5. **REQ-PROFILE-5:** Utility curve declarations MUST include enabled axes with explicit curve or veto configuration. They MUST expose shape, ideal and tolerance settings, veto, native scale, unit, and available derived-field provenance/configuration.
6. **REQ-PROFILE-6:** `ratedGameCount` MUST count games with a stored personal rating or personal override on an enabled non-Tournament axis. Automatic derived values, Tournament values, and disabled legacy-axis ratings MUST NOT count as user-rated games.

The summary sections describe their inputs. They are not trusted preference claims and do not turn a tight distribution, common attribute, or configured curve into an inferred recommendation.

## Trusted Insight Contract

7. **REQ-PROFILE-7:** Every divergence, outlier, and axis-question record MUST use the shared trusted insight contract. Each record MUST identify its method and version, cohort, sufficiency gates, evidence, comparator when applicable, limitations, and status.
8. **REQ-PROFILE-8:** A `reported` record MUST have nonempty sourced evidence, all declared sufficiency gates met, a canonical observation, optional canonical interpretation, details, and notability with a measured value and threshold. The reported value MUST strictly exceed its declared reporting threshold where the current contract uses an above-threshold rule.
9. **REQ-PROFILE-9:** An `insufficient` record MUST expose a failed sample, coverage, normalization, or comparator prerequisite and explain the abstention. It MUST NOT be presented as a weak report.
10. **REQ-PROFILE-10:** A `suppressed` record MUST explain why the current method cannot support an interpretation. A `retired` record MUST identify a superseded method and explain why it no longer supports a recommendation.
11. **REQ-PROFILE-11:** An empty family array MUST mean the method completed and found nothing notable. It MUST remain distinguishable from `null` or a failed profile request, which means analysis is unavailable. An array containing only abstentions MUST remain visible and MUST NOT collapse to an empty state.
12. **REQ-PROFILE-12:** Current producers MUST set reported insight confidence to `null`. Collection counts and threshold passage MUST NOT be relabeled as calibrated low, moderate, or high confidence.
13. **REQ-PROFILE-13:** Runtime validation MUST bind reported details, arithmetic, evidence values and sources, comparator identities, sufficiency, and notability to one coherent record. Invalid persisted or transported records MUST be rejected rather than rendered.

## Preference Divergence

14. **REQ-PROFILE-14:** Preference divergence MUST compare a normalized Tournament score with an independent fitness score recomposed from rated, positive-weight, non-Tournament fitness breakdown entries for the same game. Tournament axes MUST NOT contribute to the comparator.
15. **REQ-PROFILE-15:** Tournament-axis weight changes and Tournament-axis vetoes MUST NOT alter independent fitness. A valid non-Tournament veto MUST remain part of the independent comparator and may reduce it to zero.
16. **REQ-PROFILE-16:** Divergence MUST abstain for a game when its comparison count is below the configured Tournament provisional threshold, its result is provisional, its normalized Tournament score is unavailable, or no independent non-Tournament comparator can be composed. The default comparison threshold is six, but the stored Tournament setting controls evaluation.
17. **REQ-PROFILE-17:** A sufficient game MUST be reported only when the absolute difference between normalized Tournament score and independent fitness is strictly greater than 1.5 points. A gap exactly equal to 1.5 MUST produce no reported record.
18. **REQ-PROFILE-18:** A reported divergence MUST identify the direction as `tournament-outlier` when Tournament preference is higher or `fitness-outlier` when independent fitness is higher. Evidence MUST include the normalized Tournament score, comparison count, provisional state, and independent fitness with their canonical sources.
19. **REQ-PROFILE-19:** Divergence limitations MUST state that Tournament preference reflects only opponents compared so far. The record MUST name the disagreement without claiming that one signal is correct.

When no Tournament stats exist, divergence is unavailable (`null`). When Tournament stats exist and all eligible games pass prerequisites but no gap exceeds the threshold, divergence is evaluated-empty (`[]`). Per-game prerequisite failures remain explicit `insufficient` records.

## Factual Collection Outliers

20. **REQ-PROFILE-20:** Outlier detection MUST evaluate only currently owned games. A usable game MUST have nonempty BGG mechanics and categories, a BGG weight, minimum and maximum player counts, and playing time. Missing values MUST be excluded rather than estimated.
21. **REQ-PROFILE-21:** The outlier family MUST abstain with `insufficient-sample` when fewer than six owned games have complete factual inputs. Once that sample gate passes, it MUST abstain with `insufficient-coverage` when usable games represent less than 60% of currently owned games.
22. **REQ-PROFILE-22:** For each usable subject, detection MUST find the two nearest other usable owned games using equal contributions from five factual dimensions: Jaccard distance for mechanics and categories; fixed-scale normalized absolute distance for BGG weight, player-count range, and playing time. Personal axis ratings and fitness MUST NOT affect distance or neighbor selection.
23. **REQ-PROFILE-23:** Neighborhood distance MUST equal the mean composite distance to the two nearest comparison games. A subject MAY be reported only when that mean is strictly greater than 0.5 and at least two factual dimensions differ materially from both nearest comparators. Each material comparator dimension distance MUST be at least 0.35.
24. **REQ-PROFILE-24:** A reported outlier MUST expose both nearest comparator identities, each comparator's composite and per-dimension distances, the subject and comparator factual values for every reported driver, and the arithmetic needed to audit neighborhood and driver means.
25. **REQ-PROFILE-25:** A current fitness score MAY appear only as separately sourced interpretation context. If present, it MUST match one subject measurement from the Fitness engine and MUST NOT imply a veto, collection fit judgment, or outlier classification.
26. **REQ-PROFILE-26:** Outlier language MUST describe compositional distance from local owned-game neighbors. It MUST NOT classify a game as a lone wolf, category orphan, high-fitness exception, statistical anomaly, or candidate for removal.

The local-neighborhood rule preserves well-supported modes in a multimodal collection. It is a deterministic heuristic, not a population significance test or a claim that the nearest games are substantively interchangeable.

## Comparator-Backed Axis Questions

27. **REQ-PROFILE-27:** The current axis-question method MUST evaluate only BGG mechanics and categories found on games with sufficient non-provisional Tournament results and an independent non-Tournament fitness comparator. A candidate already covered by an enabled axis name or description MUST NOT be reported.
28. **REQ-PROFILE-28:** The current method MUST calculate each evaluated game's signed gap as normalized Tournament score minus independent fitness, round it to one decimal place for publication, and use that published gap as the canonical input to all subsequent suggestion arithmetic and directional gates. Candidate support MUST come from at least three reported divergence games with the same direction.
29. **REQ-PROFILE-29:** Before reporting, the method MUST have at least six evaluated games overall, at least three attribute-positive games, and at least three attribute-negative comparator games. Missing Tournament/BGG coverage, an undersized sample or group, and an absent comparator group MUST produce explicit insufficiency where the method has a candidate or method-level failure to expose.
30. **REQ-PROFILE-30:** Attribute-positive games MUST be at least 80% directionally consistent, MUST have a directional mean gap of at least 1.5 points, and MUST contain no opposite-direction gap beyond 1.5 points.
31. **REQ-PROFILE-31:** The method MUST sum the canonical one-decimal signed gaps in each group, independently round each exact group mean to one decimal for publication, derive the direction-specific effect from the two unrounded canonical group means, and round that effect to one decimal for publication. Runtime validation MUST reproduce this sequence exactly from evidence. It MUST NOT derive the effect by subtracting the displayed rounded means or accept arbitrary precision within a tolerance. The published effect MUST be strictly greater than 1.5 points. An effect that publishes as 1.5 MUST NOT be reported.
32. **REQ-PROFILE-32:** A candidate MUST be suppressed when another same-direction candidate with sufficient support has Jaccard membership overlap of at least 0.75. This prevents a nearly identical attribute grouping from being presented as an independent interpretation.
33. **REQ-PROFILE-33:** A reported record MUST expose positive and comparator game evidence, disjoint group identities, signed gaps, comparison counts, group means, direction, effect, and notability. Its interpretation MUST end as a question asking whether the attribute could explain the directional difference. It MUST NOT instruct the user to create, change, or weight an axis.
34. **REQ-PROFILE-34:** The `unexpressed-concentration` and `high-variance` methods are retired. When their legacy trigger would have recommended an uncovered axis, the profile MUST emit a `retired` record explaining that ownership frequency or factual spread does not establish preference. Such records MUST NOT be narrated as findings or displayed as current recommendations.

The axis question reports an observational association. BGG attributes are labels, not causal measures, and Tournament outcomes reflect only comparisons made so far.

## Grounded Narration

35. **REQ-PROFILE-35:** Narration generation MUST be user-initiated and MUST consume only `reported` divergence, outlier, and axis-question records. Insufficient, suppressed, retired, evaluated-empty, distributions, and general collection metadata MUST NOT become narration claims.
36. **REQ-PROFILE-36:** The model MAY select reported insight and evidence-game references for summary, surprise, or tension sections. The server MUST construct claim text by copying the selected records' canonical observations and interpretations. The model MUST NOT supply free-form claim text.
37. **REQ-PROFILE-37:** Every narration reference MUST identify a reported insight in the same profile and games present in that insight's evidence. Tensions MUST reference divergence records. Runtime validation MUST reject unsupported IDs, game references, section use, or text.
38. **REQ-PROFILE-38:** When no reported trusted insight exists, narration generation MUST return empty claim sections and the canonical abstention `No reported trusted insights are available to narrate.` It MUST NOT call the model to invent a summary.
39. **REQ-PROFILE-39:** Narration failure or model unavailability MUST NOT prevent deterministic profile access. Narration MUST never determine or alter fitness, insight status, evidence, or notability.

## Persistence And Recompute Lifecycle

40. **REQ-PROFILE-40:** The current profile MUST persist in `profile.json` with profile contract version 6, algorithm version 7, the Tournament settings used, matching profile/data timestamps, and optional narration plus its timestamp.
41. **REQ-PROFILE-41:** `profile.json` MUST be treated as a disposable derived cache. Loading MUST validate the exact current contract and algorithm. Invalid, malformed, non-finite, contradictory, older-contract, or older-algorithm artifacts MUST be deleted and recomputed on the next profile read. No old profile or narration compatibility path is required.
42. **REQ-PROFILE-42:** A valid current cache MUST be reused when its collection timestamp and latest Tournament activity are not newer and its stored Tournament settings match current settings.
43. **REQ-PROFILE-43:** The service MUST recompute on read when collection data is newer, a Tournament session or comparison is newer, or the K-factor threshold, normalization half-width, or provisional threshold differs. Collection schema migration MUST invalidate the dependent profile artifact before it can be consumed.
44. **REQ-PROFILE-44:** Recompute MUST persist fresh insight evidence with narration empty. It MUST NOT carry narration across replaced evidence. Narration generated concurrently MUST be discarded if the profile changed before persistence.
45. **REQ-PROFILE-45:** Narration cache state MUST distinguish `empty`, `fresh`, and `stale` by narration presence and timestamps. This state describes a current validated artifact only and MUST NOT be interpreted as compatibility with discarded profile versions.

## Presentation And Transport

46. **REQ-PROFILE-46:** `GET /api/profile`, the web client, CLI client, and `shelf-judge profile` JSON output MUST preserve and validate the complete profile contract without projecting away evidence or abstention states.
47. **REQ-PROFILE-47:** Profile Overview and game detail MUST use the same trusted-insight fields for method, cohort, sufficiency, evidence, comparator, limitations, notability, status, observation, and interpretation. Consumers MUST NOT add credibility thresholds or infer confidence.
48. **REQ-PROFILE-48:** Presentation MUST visibly distinguish reported, insufficient, suppressed, retired, evaluated-empty, family-unavailable, profile-load-failure, and zero-game states. Collection-level and method-level abstentions MUST remain visible on game detail where relevant.
49. **REQ-PROFILE-49:** Evidence and comparator games MUST remain inspectable and linked. Axis-question interpretations MUST be labeled as questions, not actions.

## Constraints And Anti-Goals

50. **REQ-PROFILE-50:** Profiling MUST remain read-only with respect to collection decisions. It MUST NOT create axes, generate ratings, alter weights, override scores, or feed results back into fitness.
51. **REQ-PROFILE-51:** The profile MUST NOT recommend buying, selling, keeping, removing, or avoiding a game. It MAY present a measured disagreement or compositional difference for the owner to interpret.
52. **REQ-PROFILE-52:** Deterministic thresholds MUST be described as reporting heuristics. The product MUST NOT claim statistical significance, population calibration, causal inference, or calibrated confidence.
53. **REQ-PROFILE-53:** Profiling MUST remain owner-focused and local except for a user-initiated narration model call. It is not a social profile, personality quiz, or collection ranking against other users.

## Success Criteria

The implemented behavior is accepted when automated coverage demonstrates:

- [x] deterministic axis distributions, weights, BGG clustering, utility declarations, and rated-game counting
- [x] independent divergence in both directions, with provisional, sample, normalized-score, comparator, veto, and strict-threshold controls
- [x] explicit reported and abstained divergence evidence that satisfies runtime cross-field validation
- [x] local-neighborhood outlier detection with sample and coverage gates, nearest comparators, factual drivers, sourced distances, multimodal controls, and rating independence
- [x] comparator-backed directional axis questions with positive/comparator groups, direction controls, strict published-effect threshold, confounder suppression, and question framing
- [x] explicit retirement of concentration and high-variance recommendation methods
- [x] reported, insufficient, suppressed, retired, evaluated-empty, and unavailable transport/presentation states
- [x] canonical reported-evidence narration, canonical no-evidence abstention, and rejection of unsupported claims or references
- [x] exact current-version persistence, fresh-storage reload, stale recomputation, old-version discard, migration invalidation, and compute-to-persist-to-GET integration
- [x] complete validated JSON transport through daemon, web, and CLI consumers

## Known Limitations

- The current outlier distance gives equal weight to five factual dimensions and uses fixed normalization scales. Those choices are transparent heuristics, not learned or statistically calibrated parameters.
- Outlier evaluation excludes any owned game missing one required factual dimension. The coverage gate limits but does not remove selection effects from incomplete metadata.
- Tournament normalization and divergence depend on the compared cohort and current Tournament settings. They do not measure stable preference outside those comparisons.
- Axis questions test mechanics and categories only. They do not test families, subdomains, continuous BGG fields, interactions among attributes, or causal effects.
- Near-identical candidate membership is suppressed, but the method does not perform general multivariate confounder adjustment.
- Confidence remains `null` because no calibrated confidence model is implemented.
- Narration can reorder or group reported evidence by selecting references, but it cannot add prose beyond canonical observations and interpretations.
- The profile cache has no compatibility guarantee. Current code discards unsupported artifacts and recomputes from source data.

## Historical Context

The April 2026 brainstorm established the enduring product direction: the collection should reveal patterns without replacing owner judgment. Its first implementation design assumed that concentration and variance implied preference, compared Tournament against full fitness, used a global centroid for outliers, classified outliers subjectively, omitted weak states, and deferred narration.

The Trusted Collection Insights epic tested those assumptions against a common evidence contract. The resulting implementation repaired divergence, retired unsupported suggestion sources, replaced centroid classification with factual local comparisons, exposed abstention, and constrained narration to canonical reported evidence. The historical brainstorm and outlier-distance research remain useful records of why those alternatives were considered, but this spec governs current behavior.
