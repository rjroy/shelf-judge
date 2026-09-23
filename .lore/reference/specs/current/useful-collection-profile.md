---
title: Useful collection profile
date: 2026-08-27
status: implemented
tags: [collection, profile, identity, attention, decision-support]
modules: [shared, daemon, cli, web]
related:
  - .lore/work/brainstorm/collection-profile-decision-taxonomy.md
  - .lore/archive/specs/collection/collection-profiling.md
  - .lore/work/notes/trusted-collection-insights-consumers.md
  - .lore/reference/specs/current/collection-purchase-utilization.md
  - .lore/work/specs/expanded-profile-attention-opportunities.md
req-prefix: USEFUL-PROF
---

# Useful Collection Profile

## Status And Authority

The owner reviewed and approved this product and behavior specification. The amended adjusted-fit requirements are implemented and passed terminal acceptance.

**Authority notice:** This file is the authority for Profile identity behavior and the durable intention lifecycle. Ranked attention behavior is defined by the approved [Fitness-ranked Profile attention](../../../work/specs/fitness-ranked-profile-attention.md) specification, which supersedes the earlier intention-only attention presentation and ordering requirements below. Active intentions and their completion, retirement, ownership-transition, evidence, and history semantics remain authoritative here; attention candidates, selection, ranking, and the configured visible cap follow the ranked-attention specification. Profile reads remain read-only with respect to collection source state.

Once approved, this specification supersedes the Profile Overview behavior in [Collection Identity and Trusted Insight Profiling](../../../archive/specs/collection/collection-profiling.md). The older document remains the record of the implemented contract before this redesign. It does not justify retaining a surface that this specification removes.

Final validation passed 229 focused tests with 902 assertions, 2,274 full-suite tests with 1 skip and 9,062 assertions, and 86 browser tests with 30 intentional skips and no failures. Typechecks, lint after the typed `STEP8-LINT-1` route-test correction, build, changed-file formatting, and diff checks passed. The final reviewer accepted the amended behavior with no material findings. The root format check differs only on the three accepted generated Beads baseline files.

Two accepted residual risks remain: local validation used Bun 1.3.11 rather than the declared Bun 1.4.0, and profile zoom coverage uses the 720x450 DPR 2 zoom-equivalent project while the literal Chromium 200% probe is on collection detail. Review accepted both as non-material to this implementation.

## Goal

The Collection Profile must answer exactly two questions:

1. **What does my collection reveal about me?**
2. **What deserves my attention or a decision now?**

The first answer describes supported patterns in the owner's current collection. The second is a capped, ranked set of current situations that may merit owner judgment, including but not limited to situations the owner explicitly recorded. Neither answer is a dashboard of everything Shelf Judge can calculate.

The first release answers the identity question by ranking mechanics, designers, and artists by comparator-adjusted current fitness of associated owned games. Profile attention evaluates built-in rules for currently owned games, selects at most one reason per game, globally ranks winning cards, and applies the configured card limit. An explicit play intention is one candidate reason among discovered situations; it is not guaranteed a visible slot.

It is a successful result for the profile to say that the available evidence does not yet support an identity statement or that no eligible attention cards remain after rule evaluation, dispositions, and the configured cap.

## Representative Experiences

### A Supported Identity Pattern

The owner has four eligible owned games credited with worker placement. Their current fitness scores are `8.1`, `7.8`, `8.4`, and `7.7`. The mean is `8.0`, compared with `6.9` across all eligible owned games.

With the configured mechanic minimum of three used as the comparator weight, the adjusted fit is `(4 * 8.0 + 3 * 6.9) / 7`, or about `7.5`. The identity overview can show:

> **Worker Placement**
>
> Games with this mechanic have an adjusted fit of **7.5**, based on 4 games averaging **8.0** compared with **6.9** across your eligible collection.

The owner can inspect all four games, each current fitness score, the range and dispersion, exclusions, and the collection comparator. The wording describes an association. It does not claim that worker placement caused the scores.

### Evidence That Is Too Sparse For Identity

One owned game is credited to an artist and has current fitness `9.2`. The artist appears in the entity drilldown as a one-game association, but not in the identity overview and not as a stable preference.

The drilldown says that one game is not enough to establish a recurring collection pattern. Shelf Judge does not fill the overview with impressive but unsupported single-game averages.

### A Ranked Never-Played Situation

Current Profile play-count evidence validly reports zero plays for Heat: Pedal to the Metal.

If its never-played rule wins per-game selection and ranks within the visible cap, the card says:

> **You have not recorded a play of Heat: Pedal to the Metal.**
>
> Do you want to make a plan to play it, intentionally keep it without a plan, or reconsider it?

This card can exist without an intention. Separately, an active intention remains durable and follows its existing lifecycle: it can lose per-game selection or a visible slot; valid current play evidence strictly above its stored baseline may complete it during the data update; the owner can complete or retire it explicitly. Profile visibility does not change that lifecycle. Shelf Judge does not infer that the owner failed or should sell the game.

If there are no selected cards, the section may say:

> **Nothing needs attention right now.**

This successful empty state can occur even while active intentions exist. It does not substitute unrelated findings; only the approved ranked-attention rules can produce cards, and any cards are subject to per-game selection, dispositions, ranking, and cap.

## Product Model

### Identity Means Repeated Association

An entity is one BGG mechanic, designer, or artist identified by its BGG link ID and current name. Every eligible owned game contributes its full current fitness once to each credited entity. Co-occurring mechanics and collaborators are therefore confounded. Entity fitness is an association within this collection, not a causal rating of a person's work or a universal rating of the entity.

An eligible game must:

- be currently owned;
- have complete BGG metadata for the entity class being evaluated;
- have a finite current fitness equal to the fitness shown elsewhere for that game; and
- have no predicted contribution in that current fitness.

A vetoed game remains eligible at its displayed current fitness of `0`. The supporting evidence must identify the veto so the owner can understand a low entity average. Shelf Judge must not replace a vetoed score with its hypothetical score. Tournament contributions, derived-axis values, and redundancy adjustments remain part of current fitness when they are already part of the displayed non-predicted score; this feature does not recompose a second profile-only fitness.

For each entity, Shelf Judge calculates:

- eligible associated game count;
- arithmetic mean current fitness;
- comparator-adjusted mean current fitness;
- population standard deviation;
- minimum and maximum current fitness;
- the arithmetic mean current fitness of all games eligible for that entity class, counting each game once; and
- the signed difference between the entity mean and that collection comparator.

Each class exposes one shared comparator cohort with its count, game-level current fitness evidence, and class-level exclusions. Entity evidence references that cohort rather than duplicating it. This makes both the entity and comparator arithmetic reproducible.

An entity needs at least its class's configured `minimumSupportedGames`, currently three by default, before it can appear as a supported identity pattern. Associations below that threshold remain available in drilldown with an explicit limited-evidence label. The threshold establishes repeated support and supplies the comparator weight for adjusted fit; it is policy, not learned truth or statistical significance.

The overview shows the first configured number of supported entities from each class's `bestFit` ordering. `bestFit` orders every drilldown entity by exact adjusted mean current fitness descending, then eligible game count descending, normalized display name ascending, and BGG ID ascending. It does not manufacture a negative-preference section or a minimum difference gate. The complete drilldown includes every entity with at least one eligible associated game and supports deterministic ordering by `bestFit`, diagnostic `support`, or `name`.

### Attention Means An Explicit Visible Intention

> Superseded for primary intention creation by `shelf-judge-a8l`: a user may author a general Want to play action without count evidence. The historical first-play/replay kinds below remain compatibility and automatic-completion bookkeeping, not the primary expression of desire.

The intention lifecycle historically supported two owner-created intention kinds:

- `first-play`: play a currently unplayed game;
- `replay`: play a game that already has at least one recorded play.

Historical first-play/replay creation required a currently owned game and valid current play-count evidence. That gate is no longer the primary intention contract. A previously owned or otherwise unowned game remains ineligible, and Shelf Judge never infers an intention from ownership, purchase date, cost, fitness, wishlist history, play count, or game metadata.

An intention has no deadline, reminder schedule, age threshold, urgency, or overdue state. Its creation time remains available as provenance but is not used to rank it or pressure the owner.

If valid current play evidence has a count strictly greater than the stored baseline, the intention is complete. The data update that observes the greater count records completion; reading the profile does not silently mutate durable state. The owner may also mark an intention complete from personal knowledge without changing the recorded play count.

Changing a game to previously owned retires its active intention in the same validated ownership mutation and reports that linked transition to the owner. Re-owning the game preserves history but does not recreate an intention; the owner must create a new one explicitly.

The owner can resolve an active item by:

- completing the intention;
- retiring it because it is no longer an intention; or
- correcting or refreshing the play evidence before deciding.

Completion and retirement persist. A completed or retired intention does not reopen because the profile recomputes or because an unrelated score changes. Only an explicit new intention creates another active item with a new intention ID and baseline.

Leaving the intention active is a valid response. The lifecycle does not interpret a continued active state as delay, failure, or deferral, whether or not the intention is currently selected for a Profile card.

## Information Hierarchy

The Profile Overview uses the two questions as its only top-level content sections beneath the page title.

### 1. What Does My Collection Reveal About Me?

The section contains:

1. Up to three supported mechanic associations.
2. Up to three supported designer associations.
3. Up to three supported artist associations.
4. A path to the complete adjusted-fit entity drilldown, including sparse associations and exclusions.
5. A link to the axis-distribution diagnostic drilldown.

Mechanics, designers, and artists remain separate classes. Their adjusted fits are not combined into one ranking because the same game can credit several entities and the classes answer different owner questions.

Axis distributions remain diagnostic evidence under this identity question. They help the owner verify whether configured axes have the expected coverage, range, clustering, and effective values. They are not identity claims and do not appear as attention items.

### 2. What Deserves My Attention Or A Decision Now?

The section contains:

1. The daemon-selected, globally ranked winning attention cards for eligible owned games, up to the configured limit. Initial reasons include valid never-played evidence, sufficiently old trustworthy dated play history, an underused purchase established by existing purchase utilization, and an active explicit intention.
2. A successful empty state when no cards remain after evaluation and selection; active intentions may exist but lose a per-game rule comparison, a visible slot, or be hidden by a disposition.
3. Relevant evidence warnings, correction destinations, and actions for each selected card.
4. A path from every item to the game and controls appropriate to its winning reason.

Cards are ordered by exact attention score descending, then NFC-normalized game name, stable game ID, and stable rule ID. The configured cap is applied after ranking. Attention score measures competition for a limited Profile slot, not game fitness or urgency; the tie-break keys do not add priority signals.

Attention section state precedence is:

1. Profile unavailable, when the profile cannot be recomputed or validated.
2. Ranked selected cards, with relevant evidence warnings attached where needed.
3. Successful empty when no selected cards are returned, including when there are no eligible candidates or the configured cap is zero.

Missing or stale play evidence does not erase or resolve a durable intention, but it may make a rule abstain or affect a selected card's evidence. It prevents automatic intention completion; it does not imply zero plays. Whether an intention appears as a card is governed by candidate eligibility, per-game winner selection, ranking, dispositions, and the visible cap.

## Attention Item Contract

Every reported attention item must expose:

| Field               | Required meaning                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stable ID           | One durable `intentionId` for this owner-created intention. The card ID derives from it.                                                           |
| Field               | Required meaning |
| ------------------- | ---------------- |
| Card identity        | Stable game-and-winning-rule identity; an explicit-intention card also retains its associated intention identity. |
| Winning reason       | One applicable, unsuperseded rule selected for this game; no game produces more than one card. |
| Ranking              | Exact attention score descending, then normalized game name, stable game ID, and stable rule ID; the configured cap follows ranking. |
| Evidence and actions | The winning rule's relevant evidence, decision, actions, and correction destinations. |
| Intention lifecycle  | An intention card is backed by an active explicit intention. Its durable completion, retirement, ownership, and history semantics remain as defined in this file. |

An active intention may qualify for an explicit-intention candidate but is not guaranteed a card or slot. Other approved rules can produce cards without an intention. Purchase utilization is permitted only through the approved underused-purchase Profile rule, which reuses its existing calculation; it does not add a purchase-utilization card to the collection view or change purchase-utilization sorting, recommendations, resale behavior, or the requirement for real-data review before broader collection interpretation.

## Existing Surface Disposition

These decisions apply to the Profile Overview and its profile-specific game-detail cards, API fields, CLI profile output, and narration action. Features with an independent destination remain there.

| Current surface or candidate                                           | Disposition                       | Destination or first-release behavior                                                                                                                                |
| ---------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Axis distributions                                                     | **Move to drilldown**             | Retain under the identity question as model diagnostics, with current effective-rating behavior.                                                                     |
| Axis weights                                                           | **Disappear from profile**        | Axis configuration remains the authoritative destination.                                                                                                            |
| Rated-game count                                                       | **Disappear from profile**        | Identity classes expose their own eligible cohort, support, and exclusion counts; one global count would conflate their different readiness.                         |
| Utility curves and veto declarations                                   | **Disappear from profile**        | Axis configuration and game score breakdown remain authoritative.                                                                                                    |
| BGG mechanics, categories, families, subdomains, and weight clustering | **Change**                        | Standalone frequency summaries disappear. Mechanics contribute only to fitness-associated entity ratings. Other classes have no profile destination in this release. |
| Tournament value versus independent fitness divergence                 | **Disappear**                     | No demonstrated profile job or user response. Remove its overview, game-detail, API, CLI, and narration surfaces.                                                    |
| Comparator-backed axis questions                                       | **Disappear**                     | They depend on removed divergence and have no independent first-release job.                                                                                         |
| Factual collection outliers                                            | **Disappear pending redesign**    | Do not show distance as identity or attention. No current profile destination.                                                                                       |
| Grounded narration                                                     | **Disappear**                     | It only restates removed findings. Remove the profile narration action and output.                                                                                   |
| Trusted-insight abstention cards for removed families                  | **Disappear with their families** | Abstention remains mandatory only for analyses retained by this specification.                                                                                       |
| Prediction residuals                                                   | **Deferred**                      | Do not compute or show them until a prior prediction can be compared with a later owner judgment and a clear response is specified.                                  |
| Neglect and generic play history                                       | **Change**                        | Play history and counts do not imply an owner intention. The approved evidence-backed never-played and dormant rules may independently enter ranked attention; an explicit intention is another candidate, not a prerequisite for attention. These rules create no inferred intention, and play history alone is not urgency or neglect. |
| Redundancy                                                             | **Remain outside profile**        | Existing collection inspection may remain. It cannot create a profile decision without an owner-stated role and curation constraint.                                 |
| Purchase utilization                                                   | **Narrow Profile exception**      | The approved underused-purchase rule may use a qualifying existing utilization result as one ranked Profile candidate. This does not imply collection auto-sort, automatic judgment, resale or buy/keep/sell recommendations, aggregation or brief placement, or that real collection data has been reviewed. Game-detail results and owner-selected collection sorts remain governed by the purchase-utilization specification. |
| Collection-wide averages, variance, absence, and rarity                | **Disappear from profile**        | No demonstrated user job in this release.                                                                                                                            |

Removing a field from the profile contract does not require erasing historical source data. It does require removing the active computation and consumer surface unless another approved feature uses it.

## States And Honest Abstention

### Empty Collection

When there are no currently owned games, the identity section explains that owned games are needed and links to add or import games. The attention section says there are no active collection decisions because there are no owned games. This state is not a profile load error.

### Insufficient Identity Evidence

Each entity class has independent result, metadata, and exclusion dimensions rather than one overlapping status.

| Dimension          | States                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Result             | `supported` when at least one entity meets the class's configured `minimumSupportedGames`; `limited` when associations exist but none meets that threshold; `no-eligible-ratings` when at least one entity association exists but no associated game has eligible fitness; `evaluated-empty` only when complete metadata contains zero entity associations in the class; `not-evaluated` when no currently owned game has complete metadata for the class. |
| Metadata readiness | `complete` when every currently owned game has a complete result for the class; `partial` when usable complete results coexist with refresh-needed or unrefreshable games; `refresh-needed` when no currently owned game has a complete result.                                                                                                                                                                                                            |
| Exclusions         | Counts and game identities grouped by predicted fitness, missing or invalid fitness, refresh-needed metadata, unrefreshable metadata, and other contract-defined reason.                                                                                                                                                                                                                                                                                   |

The result state is computed from usable evidence even when metadata readiness is partial. The UI shows readiness warnings and exclusions alongside that result. The profile may therefore show supported mechanics while designers are awaiting metadata refresh without claiming complete designer coverage.

### Nothing To Decide

When no cards are selected, the attention section reports a successful empty state. This does not establish that there are no active intentions: candidates may abstain, lose per-game selection, be suppressed by a disposition, rank below the configured cap, or be disabled by a zero cap.

### Missing Or Stale Play Evidence

When current play evidence becomes missing, invalid, or older than a known collection refresh, Shelf Judge does not erase or resolve the durable intention. Ranked attention evaluates each rule using its declared evidence dependencies; a card that is selected and depends on that evidence must communicate the applicable uncertainty and correction destination. Missing or stale evidence does not establish that a game remains unplayed and cannot complete the intention automatically; valid current evidence must show a count above baseline.

### Stale Derived Profile

The daemon recomputes a profile whose source collection, intention, relevant fitness, or metadata state changed after the cached computation. Consumers do not label an old cache as current. If recomputation fails, they show an error rather than silently serving stale identity or attention.

### Error

A daemon, transport, validation, or recomputation failure produces a profile-unavailable state with a retry action. Valid collection data and durable intentions remain available through their normal destinations. One entity class with missing metadata is an insufficient state, not a whole-profile error.

### Intention History

Resolved intentions remain available from game detail without competing with active attention:

| Projection       | Minimum fields                                                                                 | Ordering and destination                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Resolved history | Intention ID, game identity, kind, baseline count, creation time, resolution, source, and time | Resolution time descending, then intention ID; available from game detail rather than promoted on Profile Overview. |

The complete API and CLI profile result exposes active intentions and their evidence warnings. Game detail exposes resolved history through its validated game contract.

## Requirements

Every requirement is assigned to one headline question. Delivery requirements are duplicated where the two answers have different data or behavior rather than introducing a third product purpose.

### Question 1: What Does My Collection Reveal About Me?

1. **REQ-USEFUL-PROF-1:** The identity overview must present mechanics, designers, and artists as three separate classes of collection-specific fitness association.
2. **REQ-USEFUL-PROF-2:** An entity result must use currently owned games with complete metadata for that entity class and the same finite current fitness shown elsewhere for each game.
3. **REQ-USEFUL-PROF-3:** A game whose current fitness contains a predicted contribution must be excluded from entity evidence and the exclusion count and reason must remain inspectable.
4. **REQ-USEFUL-PROF-4:** A vetoed game must contribute its displayed fitness of `0`, must be identified as vetoed in game evidence, and must never be replaced with hypothetical fitness.
5. **REQ-USEFUL-PROF-5:** Each game must contribute at most once to an entity identified by BGG link ID, even if duplicate metadata links are received.
6. **REQ-USEFUL-PROF-6:** Each entity result must expose its arithmetic mean, comparator-adjusted mean current fitness, eligible associated game count, population standard deviation, range, class-specific eligible-collection mean, signed difference from that mean, and supporting games with current fitness.
7. **REQ-USEFUL-PROF-7:** Each class must expose one comparator cohort with its count, every included game's current fitness, and class-level exclusions; it must count every eligible game once regardless of how many entities are credited to the game.
8. **REQ-USEFUL-PROF-8:** At least the class's serialized `minimumSupportedGames` eligible associated games are required for overview placement or stable-pattern language. Associations below that configured threshold must remain drilldown-only and explicitly limited.
9. **REQ-USEFUL-PROF-9:** The overview must show no more than the configured class limit of supported entities, selected as the supported prefix of the exact `bestFit` ordering: adjusted mean current fitness descending, eligible associated game count descending for an exact adjusted tie, NFC-normalized display name in Unicode code-point order, then BGG ID ascending.
10. **REQ-USEFUL-PROF-10:** The full entity drilldown must include every association with at least one eligible game, expose entity and class comparator evidence and exclusions, and support complete deterministic `bestFit`, diagnostic count-first `support`, and `name` orderings.
11. **REQ-USEFUL-PROF-11:** Entity language must describe association within the owner's collection and must not claim causation, universal quality, statistical significance, confidence, preference, identity strength, representation as appreciation, or a creator's responsibility for a game's score.
12. **REQ-USEFUL-PROF-12:** BGG thing metadata must preserve mechanic, designer, and artist link IDs and names, distinguish complete empty results from metadata not yet fetched, and retain source observation time.
13. **REQ-USEFUL-PROF-13:** Existing games whose persisted schema cannot establish designer or artist completeness must migrate to a refresh-needed state rather than to a misleading complete empty list.
14. **REQ-USEFUL-PROF-14:** Metadata refresh must update all three entity classes atomically for a game. A failed refresh must preserve complete last-validated metadata as eligible with a refresh-failed warning; migrated refresh-needed data remains ineligible. The first release has no age-based metadata expiration.
15. **REQ-USEFUL-PROF-15:** Axis distributions must remain reachable as diagnostic drilldown under the identity question and must not be narrated as collection identity or attention-rule candidates.
16. **REQ-USEFUL-PROF-16:** Mechanics frequency, categories, families, subdomains, BGG weight clustering, axis weights, utility declarations, variance, rarity, absence, and collection-wide averages must not appear as standalone identity findings.
17. **REQ-USEFUL-PROF-17:** The identity answer must expose the independent result, metadata-readiness, and exclusion dimensions defined in this specification, plus refresh-failed warnings and whole-profile errors, without converting one into another.
18. **REQ-USEFUL-PROF-18:** Identity computation must be deterministic local computation and must make no network or model call; metadata refresh remains a separate owner-initiated operation.
19. **REQ-USEFUL-PROF-19:** The shared runtime contract must independently reproduce and verify each exact adjusted mean, every complete deterministic ordering, and the supported `bestFit` overview prefix, and must reject non-finite aggregates, duplicate entity identities, contradictory counts, mismatched evidence, or an entity or comparator not reproducible from its complete evidence cohort.
20. **REQ-USEFUL-PROF-20:** `GET /api/profile`, the web client, and `shelf-judge profile` JSON must preserve and runtime-validate the complete identity result and its insufficiency states without consumer-side projection.
21. **REQ-USEFUL-PROF-21:** The web identity section must use semantic headings, linked game evidence, keyboard-operable drilldowns, visible focus, non-color-only status cues, and WCAG 2.1 AA contrast.
22. **REQ-USEFUL-PROF-22:** Identity cards, evidence, and controls must fit without horizontal page overflow in current Chromium at `375x812`, `768x1024`, and `1440x900` CSS pixels and at 200% desktop zoom; content must wrap without hiding evidence or requiring hover.
23. **REQ-USEFUL-PROF-23:** The identity cache contract must be versioned forward; old metrics-first cache artifacts and identity results computed from older collection or metadata inputs must be discarded and recomputed.
24. **REQ-USEFUL-PROF-24:** An owned game without a BGG ID must use an explicit unrefreshable metadata exclusion with a manual correction destination when one exists; the profile must not offer an operation that cannot refresh it.

### Question 2: What Deserves My Attention Or A Decision Now?

25. **REQ-USEFUL-PROF-25 (attention selection superseded by `fitness-ranked-profile-attention`):** An explicit-intention attention candidate must be backed by a currently owned game with an active owner-maintained intention, including preserved historical first-play/replay intentions. The approved ranked-attention specification governs candidate selection, presentation, ranking, and visibility; an active intention is not guaranteed a selected card or visible slot. Any presentation variation must not create or mutate durable intention state.
26. **REQ-USEFUL-PROF-26 (superseded by shelf-judge-a8l for primary creation):** Historical first-play/replay creation required a currently owned game, valid current play count, and matching kind. The current primary Want to play action is not count-gated; a game that is not currently owned remains ineligible.
27. **REQ-USEFUL-PROF-27:** Ownership, age, purchase state, fitness, low play count, outlier distance, redundancy, and BGG metadata must never create or imply a play intention.
28. **REQ-USEFUL-PROF-28 (visibility superseded by `fitness-ranked-profile-attention`):** Intention lifecycle must not acquire a deadline, reminder schedule, overdue state, or read-side mutation. Whether an active intention appears in Profile attention is governed by ranked rule selection, disposition, and cap semantics in the approved ranked-attention specification.
29. **REQ-USEFUL-PROF-29:** Missing, invalid, or stale current play evidence must not imply zero or authorize automatic intention completion. When an applicable selected card depends on such evidence, it must communicate the relevant uncertainty and correction destination; read-side evidence failure must not mutate or resolve durable intention state. Candidate eligibility and card visibility follow ranked-attention rule dependencies and selection.
30. **REQ-USEFUL-PROF-30 (card contract superseded by `fitness-ranked-profile-attention`):** Ranked cards must use the winning-rule card contract from the approved ranked-attention specification. An explicit-intention card must expose appropriate existing intention actions without changing the durable lifecycle contract or penalizing an intention left active.
31. **REQ-USEFUL-PROF-31 (ordering superseded by `fitness-ranked-profile-attention`):** Profile attention must use ranked-attention's exact score ordering and deterministic tie-breakers; intention creation time and play count do not independently rank intention candidates.
32. **REQ-USEFUL-PROF-32 (one-card-per-game selection supersedes intention-card guarantee):** An active intention may contribute the explicit-intention rule for its game, but does not guarantee a card; the daemon emits at most one winning-rule card per game and applies global ranking and the configured cap as specified by ranked attention.
33. **REQ-USEFUL-PROF-33:** Completing or retiring an intention must persist the resolution, actor or source, and resolution time in durable collection source data separate from the disposable profile cache.
34. **REQ-USEFUL-PROF-34:** A trustworthy later observed play-count increase above a trustworthy captured baseline must complete the active intention during the data update that observes it. An absent baseline remains absent and cannot authorize automatic completion; reading the profile must not mutate durable intention state.
35. **REQ-USEFUL-PROF-35:** The owner must be able to mark an intention complete from personal knowledge without forcing an unsupported change to recorded play count.
36. **REQ-USEFUL-PROF-36:** A completed or retired intention must become active again only through a new explicit intention with a new intention ID and a baseline captured only when trustworthy evidence is available.
37. **REQ-USEFUL-PROF-37 (empty-state meaning superseded by `fitness-ranked-profile-attention`):** A successful empty attention result means no cards were selected for presentation, not necessarily that no active intention exists. Empty-state semantics, including a zero configured cap, follow the ranked-attention specification; errors remain distinct from successful empty.
38. **REQ-USEFUL-PROF-38:** The explicit-intention candidate and its evidence must be backed by the active intention and use its lifecycle fields as defined here; ranked card selection, ordering, and visibility follow the approved ranked-attention specification. Resolved history must use the fields, ordering, and destination in this specification and remain distinguishable from active state, successful empty, and profile failure.
39. **REQ-USEFUL-PROF-39 (purchase-utilization exception):** Tournament divergence, comparator-backed axis questions, outliers, narration, prediction residuals, and redundancy must not appear in Profile attention in this release. The narrowly defined underused-purchase rule is the sole approved purchase-utilization Profile candidate and is governed by `fitness-ranked-profile-attention`; it does not authorize other purchase-value surfaces or behavior.
40. **REQ-USEFUL-PROF-40:** Daemon operations must support create, complete, and retire using the public command and result contract in this specification; command-ID replay must return the original accepted result without creating duplicate intentions or resolutions.
41. **REQ-USEFUL-PROF-41:** Web and CLI must provide equivalent intention mutations and expose the resulting validated intention or conflict; profile JSON must expose the same resulting attention state, and CLI failures must use a nonzero exit status with the structured error on standard error.
42. **REQ-USEFUL-PROF-42:** Concurrent mutation must reject a stale expected intention version rather than overwrite a newer resolution, and the consumer must present a refresh-and-review response.
43. **REQ-USEFUL-PROF-43:** Intention mutations and automatic completion must log the attempted transition, trigger, game and intention identity, prior state/version, and outcome without logging unrelated collection contents.
44. **REQ-USEFUL-PROF-44:** Existing collections must migrate atomically and repeatably with no intentions and no fabricated resolution history. Failure or interruption must preserve the last valid collection for safe retry; existing play counts remain evidence but do not create intentions.
45. **REQ-USEFUL-PROF-45:** The shared runtime contract must reject impossible intention kinds, invalid or mismatched baselines, duplicate active intentions for one game, and contradictory resolutions. Ranked attention cards must validate against their winning-rule contract; an explicit-intention card must be backed by an active explicit intention, while discovered-rule cards need not have an associated intention.
46. **REQ-USEFUL-PROF-46:** The attention UI must announce mutation success and failure, associate validation errors with controls, preserve focus after updates, and provide keyboard and touch access without relying on color or hover.
47. **REQ-USEFUL-PROF-47:** Attention cards and intention controls must fit without horizontal page overflow in current Chromium at `375x812`, `768x1024`, and `1440x900` CSS pixels and at 200% desktop zoom; actions may stack but no response or evidence may disappear, interactive targets must be at least `44x44` CSS pixels, and mobile form text must be at least `16px`.
48. **REQ-USEFUL-PROF-48:** A profile load or recomputation failure must show attention as unavailable with retry, not as nothing needing attention, and must not delete or rewrite durable intentions.
49. **REQ-USEFUL-PROF-49:** Attention projections in the disposable profile cache must be invalidated by any play-evidence, intention, ownership, collection-schema, profile-contract, or profile-algorithm change that can alter their state.
50. **REQ-USEFUL-PROF-50:** Changing a game to previously owned must retire its active intention in the same validated mutation and disclose that transition; later re-ownership must preserve history without creating a new intention.

## Technical Contract

This section constrains implementation where product behavior depends on a consistent boundary. It is not an implementation plan.

### Source And Derived Data

Durable owner intent and resolution history belong in versioned collection source data. Computed entity adjusted fits and insufficiency states belong in the disposable versioned Profile cache. Ranked-attention candidates and their dependency state belong in the separately versioned disposable candidate artifact defined by the approved ranked-attention specification; selected cards and their score order are daemon-published Profile output. Neither artifact is authority for durable intention history.

The Profile cache and ranked-attention candidate projection are distinct derived artifacts and must be invalidated or updated according to their declared dependencies. Relevant inputs include changes to:

- ownership;
- BGG entity metadata or its completeness state;
- any input that changes displayed current fitness;
- play-count value, validity, source, or observation time;
- intention creation, baseline, state, version, or resolution;
- the configured entity policy, including any class's `minimumSupportedGames`; and
- the profile contract or algorithm version.

The current disposable Profile contract is version 10 and its algorithm is version 13. Ranked attention also has separately versioned candidate state. The durable collection is schema version 8. No Profile cache migration is required: an older contract/algorithm version or a Profile whose serialized entity policy differs from current configuration is discarded and recomputed. Candidate artifact compatibility and recovery follow the ranked-attention authority. A collection migration is required when durable intentions, resolutions, BGG metadata completeness, dated BGG play sessions, attention dispositions, or another collection source field changes schema.

Collection migration must write atomically. A failed or interrupted migration leaves the last validated source artifact unchanged and loadable. Repeating migration from the same prior version produces the same current artifact without duplicate history or further semantic changes.

For entity metadata, a complete last-validated class remains eligible after a later refresh attempt fails and carries a refresh-failed warning. Metadata has no age-only expiration in this release. A migrated class whose completeness is unknown remains refresh-needed and ineligible until a successful BGG thing response establishes complete-empty or complete-populated data. A game without a BGG ID is unrefreshable rather than refresh-needed.

### Entity Identity And Arithmetic

BGG link ID is the stable entity identity. Display-name changes update the name without splitting historical identity. If the same ID occurs more than once on one game, deduplicate it before aggregation.

For eligible scores `x1` through `xn`:

```text
entity mean = sum(xi) / n
population standard deviation = sqrt(sum((xi - mean)^2) / n)
collection comparator = sum(each class-eligible game's current fitness once) / eligible game count
adjusted mean = (n * entity mean + minimumSupportedGames * collection comparator)
                / (n + minimumSupportedGames)
difference = entity mean - collection comparator
```

Compute adjusted values and ordering comparisons with exact arithmetic. Presentation may round fitness aggregates to one decimal place, but deterministic ordering never uses displayed values. `bestFit` orders by exact adjusted mean descending, exact ties by associated game count descending, then NFC-normalized display name by Unicode code-point order and numeric BGG ID. Diagnostic `support` orders by count descending, exact raw mean descending, normalized name, and ID. `name` orders by normalized name and ID. Every ordering contains every entity exactly once. The overview filters `bestFit` to supported entities before applying the configured class limit; a limited entity may lead the full ordering but cannot enter the overview.

### Adjusted-Fit Scenarios

The following exact fixtures use valid class comparator cohorts. Unless stated otherwise, `minimumSupportedGames = 3` and the cohort sum `C` divided by cohort count `k` is exactly `7`. Entity score sums are `E`, and the adjusted value is `(E * k + m * C) / (k * (n + m))`, equivalently `(E + 7m) / (n + m)` in these rows.

| Scenario                             | Exact game evidence and comparator cohort                                                                                                                                                                                      | Expected result                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three excellent versus many average  | A has `n=3`, scores `[9,9,9]`, `E=27`; B has `n=20`, all `7`, `E=140`; one unassociated comparator game scores `1`, so `k=24`, `C=168`.                                                                                        | A adjusts to `8`; B to `7`. A leads `bestFit`; B leads diagnostic `support`.                                                                                                                      |
| Tiny raw edge with stronger evidence | A has `n=3`, scores `[9,9,9]`, `E=27`; B has `n=20`, all `8.9`, `E=178`; seven unassociated comparator games total `5`, so `k=30`, `C=210`.                                                                                    | A adjusts to `8`; B to `199/23`. B leads `bestFit`.                                                                                                                                               |
| Quantity is not affinity             | A has `n=3`, scores `[9,9,9]`, `E=27`; B has `n=20`, all `5`, `E=100`; twelve unassociated games score eleven `10`s and one `8`, so `k=35`, `C=245`.                                                                           | A adjusts to `8`; B to `121/23`. Count cannot make B lead.                                                                                                                                        |
| Limited outlier                      | A has `n=1`, score `[10]`, `E=10`; B has `n=3`, scores `[8,8,8]`, `E=24`; one unassociated game scores `1`, so `k=5`, `C=35`.                                                                                                  | A adjusts to `31/4` and leads full `bestFit`; B adjusts to `15/2` and is the first overview entry because A is limited.                                                                           |
| Exact adjusted tie                   | A has `n=3`, scores `[8,8,8]`, `E=24`; B has `n=6`, scores totaling `46.5`, `E=46.5`; two unassociated games total `6.5`, so `k=11`, `C=77`.                                                                                   | Both adjust to `15/2`; B wins by count.                                                                                                                                                           |
| Vetoed zero evidence                 | A scores `[0,9,9]`; B scores `[6,6,6]`; two unassociated games score `[10,10]`, so `k=8`, `C=56`.                                                                                                                              | Both raw means are `6` and both adjust to `13/2`; the veto remains zero, then normalized name and ID decide.                                                                                      |
| Beyond display precision             | A has `n=1`, score `[9]`; B has `n=2`, scores `[8.2,8.35]`; two unassociated games total `9.45`, so `k=5`, `C=35`.                                                                                                             | A adjusts to `15/2`; B to `751/100`. Both display as `7.5`, but B leads by exact value.                                                                                                           |
| Different class priors               | In each class, one entity has `n=3`, scores `[9,9,9]`; three unassociated games total `15`, so `k=6`, `C=42`. Use class minima `m=2`, `3`, and `5`.                                                                            | Adjusted values are respectively `41/5`, `8`, and `31/4`; each class is ordered independently.                                                                                                    |
| Empty comparator                     | No eligible class games, so `k=0`, `C=0`, and there are no entities.                                                                                                                                                           | Every ordering and the overview are empty; an entity attached to this comparator is invalid.                                                                                                      |
| Reordered Unicode ties               | IDs `30` `A😀`, `31` `A😁`, `20` `Café` (decomposed), and `40` `Café` (precomposed) all link to the same three games scoring `[8,8,8]`; three unassociated games total `18`, so `k=6`, `C=42`. Shuffle source games and links. | Every entity adjusts to `15/2`. `bestFit`, `support`, and `name` are all `[30,31,20,40]`; with limit three, overview is `[30,31,20]`. Records by ID and arrays remain identical after reordering. |

The canonical target shape records `adjustedMeanCurrentFitness` beside each entity's raw aggregates, exposes exactly `orderings: { bestFit, support, name }`, and exposes one `overviewEntityIds` list. Each ordering is a full entity-ID permutation. `overviewEntityIds` is not a fourth ordering: it is the prefix of up to the configured length obtained by removing limited IDs from `bestFit`.

One concrete canonical mechanics fixture uses `minimumSupportedGames = 3`, `overviewLimit = 3`, and an 11-game comparator totaling `77`:

| ID   | Canonical name  | Associated scores | Raw mean | Exact adjusted mean | Support   |
| ---- | --------------- | ----------------- | -------- | ------------------- | --------- |
| `10` | `Limited Spark` | `[10]`            | `10`     | `31/4`              | limited   |
| `20` | `Alpha`         | `[8,8,8]`         | `8`      | `15/2`              | supported |
| `30` | `Many Average`  | `[7,7,7,7,7,7]`   | `7`      | `7`                 | supported |

The ten associated games total `76`; one unassociated comparator game scores `1`, producing comparator mean `7`. The serialized adjusted values are respectively `7.75`, `7.5`, and `7`. Exact expected IDs are:

```text
orderings.bestFit = [10, 20, 30]
orderings.support = [30, 20, 10]
orderings.name = [20, 10, 30]
overviewEntityIds = [20, 30]
```

### Intention Lifecycle

One game may have at most one active intention. `intentionId` identifies one owner commitment from creation through completion or retirement. A new intention after resolution receives a new intention ID and snapshots a play-count baseline only when trustworthy evidence is available. A monotonically increasing intention version protects every transition.

Allowed lifecycle transitions are:

```text
none -> active
active -> completed
active -> retired
completed or retired -> new intention ID + active
```

The primary creation action is `Want to play` for a currently owned game and has no count-evidence prerequisite or owner-selected kind. When current evidence is valid, timestamped, and not stale, the daemon snapshots it as an automatic-completion baseline. Otherwise the baseline is absent and no count-driven completion may be inferred. First-play or replay is optional presentation context derived only from current trustworthy evidence. Historical `first-play` and `replay` intentions retain their original kind and baseline.

An automatic completion records source `observed-play-increase`. Manual completion records source `owner-confirmed`. Retirement records source `owner-retired`.

### Dated BGG Play Sessions And Neutral Context

Schema version 7 stores validated dated BGG `/plays` records as `bggPlaySessions`, keyed uniquely by BGG `playId`, with `bggId`, `quantity`, `playedOn`, and `observedAt`. Play dates remain `YYYY-MM-DD` values without invented times; `observedAt` identifies the fetch observation, not the play time. A complete `/plays` observation replaces only the requested game's primary and additional BGG-ID scope, removes records absent from that complete response, and retains sessions outside the scope. Failed or partial retrieval never replaces stored sessions. Records without a valid play date are not stored as dated sessions. The accepted aggregate count is the sum of valid dated, deduplicated session quantities; legacy collection aggregates do not fabricate sessions.

A complete `/plays` observation is accepted as the source for sessions, aggregate count evidence, last-played date, recent volume, and count-driven automatic completion only when it is newer than the current accepted count/check evidence, or replays the accepted BGG `/plays` evidence at the same observation time without a newer check. An older observation preserves both the existing sessions and newer manual or current evidence. Equal-time replay cannot replace manual evidence or clear a newer missing/invalid check merely because the last valid evidence came from BGG.

`lastPlayedAt` is the latest stored valid play date. `recentPlayCount` is the sum of session quantities in the inclusive 365-day interval ending on the accepted `/plays` observation date (that date minus 364 days through that date). These summaries describe the accepted session snapshot, not the wall clock or the date of a later manual count correction. A manual correction preserves imported history but supersedes its role as current count evidence; game detail must not label those historical summaries with the manual observation time. Game detail may show factual dated context as the last dated play and this exact window when session-derived evidence is available. Otherwise it reports dated context as unavailable. This context does not infer enjoyment, urgency, neglect, or a recommendation.

### Service Boundaries

The shared package owns exact runtime schemas for profile output, intention commands, mutation results, and conflicts. The daemon owns mutation, persistence, lifecycle enforcement, profile computation, and cache invalidation. The web reaches these operations through its daemon proxy. The CLI exposes discoverable operations for every owner action rather than requiring direct file edits.

The public mutation commands are:

| Command  | Required request                                                   |
| -------- | ------------------------------------------------------------------ |
| Create   | `commandId`, game ID, and expected absence of an active intention. |
| Complete | `commandId`, game ID, intention ID, and expected version.          |
| Retire   | `commandId`, game ID, intention ID, and expected version.          |

The CLI exposes these as `shelf-judge game intention set`, `complete`, and `retire`; web controls invoke equivalent daemon operations through the proxy. Exact HTTP paths belong in design, but operation discovery must expose one stable operation ID for each command.

Every successful mutation returns the accepted durable intention, version, and any linked ownership transition. Errors use a shared discriminated contract for validation with field issues, game or intention not found, ineligible game or baseline, active-intention conflict, stale expected version with current state, reused command ID with different payload, and persistence failure. CLI failures write the structured error to standard error and exit nonzero.

`commandId` supplies retry idempotency. Replaying the same command ID with the same canonical payload returns the original accepted result even after a lost response. Reusing it with a different payload fails. A different command ID is a new attempt and must satisfy current expected-version rules.

## Out Of Scope

- Inferring personality, taste causes, or universal creator quality
- Rating categories, families, subdomains, publishers, or BGG weight in the first identity answer
- Correcting for co-occurring mechanics, designer teams, or artist teams
- Correcting common mechanics or prolific creators against external prevalence data
- Learning a causal or multivariate entity model
- Automatic buy, sell, keep, remove, rating, axis, weight, or model changes
- Keep/remove or role decisions before owner-maintained role and curation context exist
- Prediction-residual diagnostics before a comparable prior prediction exists
- Outlier attention before a supported identity baseline and unresolved role exist
- Future-buying attention before real-data review and acquisition context exist
- Individual play-session history, attendance, or duration
- Inferred intention from a calendar, wishlist, purchase, shelf assignment, or BGG status
- Free-form or model-generated profile narration

## AI Validation

1. Confirm the recorded owner approval covers all three first-version semantics: the configured class support minimum, currently three by default; veto inclusion at displayed zero; and a gentle intention list with no dates, aging, urgency, or overdue state.
2. Trace every requirement to exactly one of the two headline-question subsections. Reject any prominent output that cannot name its question and user job.
3. Build deterministic entity fixtures covering mechanics, designers, and artists; duplicate links; one, two, and three associated games; ties; missing and complete-empty metadata; predicted scores; vetoed scores; previously owned games; and mixed class readiness.
4. Reproduce every entity aggregate and comparator from its game evidence. Inject non-finite, duplicate, mismatched, and contradictory records and verify runtime validation rejects them before persistence or rendering.
5. Independently derive exact adjusted means from entity games, comparator games, and each class's serialized `minimumSupportedGames`. Verify `bestFit` uses exact adjusted mean, count, normalized name, and BGG ID in order; diagnostic `support` remains count-first; every ordering is a complete permutation; and the overview is the supported prefix of `bestFit` capped at the configured length. Cover every Adjusted-Fit Scenario, including equal displayed values with unequal exact values and a limited entity that leads the full ordering.
6. Parse representative BGG thing responses with zero, one, and multiple designer and artist links. Verify new and refreshed games retain IDs, names, completeness, and observation time, migrated old games remain refresh-needed until real data is fetched, failed refresh preserves last-valid eligibility with a warning, and games without BGG IDs are unrefreshable without a false refresh action.
7. Exercise the intention lifecycle from no intention through create, leave active across repeated reads and long elapsed time, complete, retire, automatic observed-play completion, ownership ending, re-ownership, and later explicit new intention. Reject creation for a game that is not currently owned. Verify IDs behave as specified and durable history survives daemon restart and profile-cache deletion.
8. Create Want to play with missing, invalid, stale, and timestamp-less evidence and verify a null baseline. Verify no presentation or selection decision changes the intention's durable kind, baseline, lifecycle record, or command receipt. Preserve historical `first-play` and `replay` kinds, baselines, lifecycle records, and original command receipts through migration and replay. Reject duplicate active intentions and stale expected versions.
9. Verify attention follows the approved ranked-attention rule eligibility, winner selection, exact score ordering, deterministic tie-breakers, dispositions, and cap. Include active intentions that lose to another rule for the same game, rank below the visible cap, or are hidden by a disposition; verify durable intention state is unchanged.
10. Verify only valid current play evidence strictly greater than baseline completes the intention during the data update. Cover a corrected count below baseline followed by an increase that remains at or below baseline. Missing, invalid, stale, equal, or lower evidence must not complete it. Repeated Profile reads and candidate publication must cause no durable intention, evidence, or history write.
11. Replay the same command ID and canonical payload and verify the original success result returns without duplicate intentions or resolutions. Reuse the ID with a changed payload and verify rejection; use a new ID with a stale version and verify a current-state conflict. Simulate persistence failure and verify no success is reported.
12. Verify the web and CLI can create, complete, and retire intentions and that their validated results match the subsequent profile output.
13. Verify empty collection, supported identity, limited identity, missing metadata, missing ratings, evaluated-empty, populated ranked attention, successful empty attention (including zero cap and no selected candidates), evidence warnings, Profile recomputation failure, transport failure, and validation failure remain visibly distinct. Do not infer that successful empty means there are no active intentions.
14. Verify the Profile Overview and game-detail profile surfaces no longer render narration, divergence, comparator-backed axis questions, outliers, standalone BGG clustering, axis weights, or utility declarations. Verify the approved underused-purchase rule is limited to ranked Profile attention, while purchase calculation/detail and owner-selected collection sorts remain independently governed; it does not introduce collection auto-sort, resale or buy/keep/sell recommendations, or an unreviewed broader collection judgment.
15. Verify semantic heading order, accessible names and descriptions, linked evidence, focus visibility, focus retention, status announcements, field-error association, non-color-only states, contrast, and keyboard operation.
16. Exercise the real rendered page in current Chromium at `375x812`, `768x1024`, and `1440x900` CSS pixels and at 200% desktop zoom. Verify no horizontal page overflow, clipped evidence, hover-only content, target below `44x44` CSS pixels, inaccessible action, focus loss, or mobile input zoom regression. Real-browser evidence is a release gate; if no runner exists, add one or record equivalent manual Chromium evidence rather than accepting source inspection.
17. Verify old profile cache versions are discarded and every listed source change invalidates the affected projection. Run migration fixtures for the current schema, each supported prior schema, malformed partial input, simulated persistence interruption, restart, and repeated load. Existing collections must gain no fabricated intentions or complete designer/artist metadata, and failed migration must preserve the last valid artifact.
18. Run repository typecheck, lint, formatting checks for changed files, all tests, and the production web build. Distinguish known repository-wide baseline failures from failures introduced by the implementation.
19. Ask a fresh reviewer to explain both headline answers, why sparse entities are not identity claims, why active intentions never become overdue, how missing play evidence affects automatic completion, how every attention item resolves, and where every removed current surface went. Treat an unclear answer as a specification or implementation failure.

## Owner Review Decisions

The owner approved these first-version choices on 2026-08-27:

1. **Supported identity threshold:** the class's configured `minimumSupportedGames`, three by default, controls overview placement; associations below it remain limited drilldown evidence.
2. **Veto treatment:** include the same displayed current fitness of `0`, visibly identify the veto, and never substitute hypothetical fitness.
3. **Intention lifecycle:** an explicit active intention has no date-based aging, urgency, or overdue state and remains durable until valid current play evidence exceeds its baseline or the owner resolves it. Profile visibility is now governed by the approved ranked-attention specification; not every active intention is guaranteed a card or visible slot.

Changing one of these choices requires updating the examples, requirements, technical contract, and validation together before approval.
