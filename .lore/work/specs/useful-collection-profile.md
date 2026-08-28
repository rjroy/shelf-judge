---
title: Useful collection profile
date: 2026-08-27
status: approved
tags: [collection, profile, identity, attention, decision-support]
modules: [shared, daemon, cli, web]
related:
  - .lore/work/brainstorm/collection-profile-decision-taxonomy.md
  - .lore/specs/collection/collection-profiling.md
  - .lore/work/notes/trusted-collection-insights-consumers.md
  - .lore/work/specs/collection-purchase-utilization.md
req-prefix: USEFUL-PROF
---

# Useful Collection Profile

## Status And Authority

The owner has reviewed and approved this product and behavior specification. Approval authorizes design and implementation planning, not implementation by itself.

Once approved, this specification supersedes the Profile Overview behavior in [Collection Identity and Trusted Insight Profiling](../../specs/collection/collection-profiling.md). The older document remains the record of the implemented contract before this redesign. It does not justify retaining a surface that this specification removes.

## Goal

The Collection Profile must answer exactly two questions:

1. **What does my collection reveal about me?**
2. **What deserves my attention or a decision now?**

The first answer describes supported patterns in the owner's current collection. The second is a small inbox of choices the owner has explicitly made timely. Neither answer is a dashboard of everything Shelf Judge can calculate.

The first release answers the identity question by rating mechanics, designers, and artists from the current fitness of associated owned games. It answers the attention question with a gentle list of explicit play and replay intentions that the owner chose to keep visible.

It is a successful result for the profile to say that the available evidence does not yet support an identity statement or that nothing needs attention.

## Representative Experiences

### A Supported Identity Pattern

The owner has four eligible owned games credited with worker placement. Their current fitness scores are `8.1`, `7.8`, `8.4`, and `7.7`. The mean is `8.0`, compared with `6.9` across all eligible owned games.

The identity overview can show:

> **Worker Placement**
>
> Games with this mechanic have an average current fitness of **8.0**, compared with **6.9** across your eligible collection. Based on 4 games.

The owner can inspect all four games, each current fitness score, the range and dispersion, exclusions, and the collection comparator. The wording describes an association. It does not claim that worker placement caused the scores.

### Evidence That Is Too Sparse For Identity

One owned game is credited to an artist and has current fitness `9.2`. The artist appears in the entity drilldown as a one-game association, but not in the identity overview and not as a stable preference.

The drilldown says that one game is not enough to establish a recurring collection pattern. Shelf Judge does not fill the overview with impressive but unsupported single-game averages.

### A Gentle Play Intention

The owner explicitly records, "I intend to play Heat: Pedal to the Metal." At that time the game has zero recorded plays.

The attention item asks:

> **Do you still intend to play Heat: Pedal to the Metal?**
>
> You asked Shelf Judge to keep this first-play intention visible. The recorded play count was 0 when you added it and is still 0.

The owner can prioritize the play, retire the intention, mark it complete from personal knowledge, or correct play data. Prioritizing is an external action and leaves the item visible until valid current play evidence exceeds the stored baseline or the owner resolves it. Shelf Judge applies no due date, age, urgency, or overdue language and does not conclude that the game should be sold or that the owner failed.

If there are no active intentions, the section says:

> **Nothing needs attention right now.**

It does not substitute unrelated outliers, low-utilization purchases, or model disagreements to avoid an empty inbox.

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
- population standard deviation;
- minimum and maximum current fitness;
- the arithmetic mean current fitness of all games eligible for that entity class, counting each game once; and
- the signed difference between the entity mean and that collection comparator.

Each class exposes one shared comparator cohort with its count, game-level current fitness evidence, and class-level exclusions. Entity evidence references that cohort rather than duplicating it. This makes both the entity and comparator arithmetic reproducible.

Three eligible associated games are required before an entity can appear as a supported identity pattern. One- and two-game associations remain available in drilldown with an explicit limited-evidence label. The threshold establishes repeated support, not statistical significance.

The overview shows up to three supported entities in each class, ordered by mean current fitness descending, then eligible game count descending, normalized display name ascending, and BGG ID ascending. It does not manufacture a negative-preference section or a minimum difference gate. The complete drilldown includes every entity with at least one eligible associated game and supports deterministic ordering by rating, support, or name.

### Attention Means An Explicit Visible Intention

The first release supports two owner-created intention kinds:

- `first-play`: play a currently unplayed game;
- `replay`: play a game that already has at least one recorded play.

Creating an intention requires a currently owned game and a valid current play count so Shelf Judge can distinguish first play from replay and store an evidence timestamp as the baseline. A previously owned or otherwise unowned game is ineligible. An active intention appears immediately and remains visible because the owner explicitly asked Shelf Judge to remember it. Shelf Judge never infers an intention from ownership, purchase date, cost, fitness, wishlist history, play count, or game metadata.

An intention has no deadline, reminder schedule, age threshold, urgency, or overdue state. Its creation time remains available as provenance but is not used to rank it or pressure the owner.

If valid current play evidence has a count strictly greater than the stored baseline, the intention is complete. The data update that observes the greater count records completion; reading the profile does not silently mutate durable state. The owner may also mark an intention complete from personal knowledge without changing the recorded play count.

Changing a game to previously owned retires its active intention in the same validated ownership mutation and reports that linked transition to the owner. Re-owning the game preserves history but does not recreate an intention; the owner must create a new one explicitly.

The owner can resolve an active item by:

- completing the intention;
- retiring it because it is no longer an intention; or
- correcting or refreshing the play evidence before deciding.

Completion and retirement persist. A completed or retired intention does not reopen because the profile recomputes or because an unrelated score changes. Only an explicit new intention creates another active item with a new intention ID and baseline.

Leaving the intention active is a valid response. The profile does not interpret continued visibility as delay, failure, or deferral.

## Information Hierarchy

The Profile Overview uses the two questions as its only top-level content sections beneath the page title.

### 1. What Does My Collection Reveal About Me?

The section contains:

1. Up to three supported mechanic associations.
2. Up to three supported designer associations.
3. Up to three supported artist associations.
4. A path to the complete entity-rating drilldown, including sparse associations and exclusions.
5. A link to the axis-distribution diagnostic drilldown.

Mechanics, designers, and artists remain separate classes. Their ratings are not combined into one ranking because the same game can credit several entities and the classes answer different owner questions.

Axis distributions remain diagnostic evidence under this identity question. They help the owner verify whether configured axes have the expected coverage, range, clustering, and effective values. They are not identity claims and do not appear as attention items.

### 2. What Deserves My Attention Or A Decision Now?

The section contains:

1. Every active owner-created play or replay intention.
2. A successful nothing-to-decide state when there is no active intention.
3. An evidence warning when current play data cannot establish automatic completion.
4. A path from every item to the game and controls that can resolve it.

Items are ordered by NFC-normalized game name in Unicode code-point order, then stable game ID. Creation time and play count do not affect order. The number of cards does not create urgency or a score.

Attention section state precedence is:

1. Profile unavailable, when the profile cannot be recomputed or validated.
2. Active intentions, with evidence warnings attached where needed.
3. Nothing needs attention, when there is no active intention.

Missing or stale play evidence must never hide an active owner-created intention. It prevents automatic completion, not visibility.

## Attention Item Contract

Every reported attention item must expose:

| Field               | Required meaning                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stable ID           | One durable `intentionId` for this owner-created intention. The card ID derives from it.                                                           |
| Decision family     | `play-intention`; signals do not create separate families.                                                                                         |
| Question            | "Do you still intend to play/replay [game]?" in owner language.                                                                                    |
| Why now             | The owner explicitly asked Shelf Judge to keep this intention visible.                                                                             |
| Evidence            | Intention kind, creation time, baseline play count, current play-count state and value when valid, evidence source, and evidence observation time. |
| Plausible responses | Leave visible or prioritize externally, complete, retire, or correct/refresh evidence.                                                             |
| Abstention basis    | Only explicit active intentions qualify; low play count, age, purchase, ownership, or metadata alone does not.                                     |
| Resolution          | `null` while active; otherwise the owner or observed-play resolution and its time.                                                                 |
| Reopen condition    | A new explicit intention after resolution, with a new intention ID.                                                                                |
| Destination         | The relevant game detail intention controls; evidence refresh may also link to collection refresh.                                                 |

One intention creates at most one attention item. Purchase utilization, fitness, outlier distance, and other facts may be supporting context only if this specification names them. The first release does not, so they cannot create or duplicate a card.

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
| Neglect and generic play history                                       | **Change**                        | Only an explicit active play/replay intention can enter attention. Counts remain completion evidence, not intent, urgency, or neglect.                               |
| Redundancy                                                             | **Remain outside profile**        | Existing collection inspection may remain. It cannot create a profile decision without an owner-stated role and curation constraint.                                 |
| Purchase utilization                                                   | **Remain outside profile**        | Keep game-detail results and owner-selected collection sorts. It cannot create profile attention without separate real-data review and approval.                     |
| Collection-wide averages, variance, absence, and rarity                | **Disappear from profile**        | No demonstrated user job in this release.                                                                                                                            |

Removing a field from the profile contract does not require erasing historical source data. It does require removing the active computation and consumer surface unless another approved feature uses it.

## States And Honest Abstention

### Empty Collection

When there are no currently owned games, the identity section explains that owned games are needed and links to add or import games. The attention section says there are no active collection decisions because there are no owned games. This state is not a profile load error.

### Insufficient Identity Evidence

Each entity class has independent result, metadata, and exclusion dimensions rather than one overlapping status.

| Dimension          | States                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Result             | `supported` when at least one entity has three eligible games; `limited` when associations exist but none has three; `no-eligible-ratings` when at least one entity association exists but no associated game has eligible fitness; `evaluated-empty` only when complete metadata contains zero entity associations in the class; `not-evaluated` when no currently owned game has complete metadata for the class. |
| Metadata readiness | `complete` when every currently owned game has a complete result for the class; `partial` when usable complete results coexist with refresh-needed or unrefreshable games; `refresh-needed` when no currently owned game has a complete result.                                                                                                                                                                     |
| Exclusions         | Counts and game identities grouped by predicted fitness, missing or invalid fitness, refresh-needed metadata, unrefreshable metadata, and other contract-defined reason.                                                                                                                                                                                                                                            |

The result state is computed from usable evidence even when metadata readiness is partial. The UI shows readiness warnings and exclusions alongside that result. The profile may therefore show supported mechanics while designers are awaiting metadata refresh without claiming complete designer coverage.

### Nothing To Decide

When there is no active intention, the attention section says nothing needs attention right now.

### Missing Or Stale Play Evidence

When current play evidence becomes missing, invalid, or older than a known collection refresh, Shelf Judge keeps the explicit intention visible and attaches the exact evidence warning plus a refresh or correction destination. It does not claim that the intention remains unplayed and cannot complete it automatically until valid evidence shows a count above baseline.

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
6. **REQ-USEFUL-PROF-6:** Each entity result must expose its arithmetic mean, eligible associated game count, population standard deviation, range, class-specific eligible-collection mean, signed difference from that mean, and supporting games with current fitness.
7. **REQ-USEFUL-PROF-7:** Each class must expose one comparator cohort with its count, every included game's current fitness, and class-level exclusions; it must count every eligible game once regardless of how many entities are credited to the game.
8. **REQ-USEFUL-PROF-8:** At least three eligible associated games are required for overview placement or stable-pattern language. One- and two-game associations must remain drilldown-only and explicitly limited.
9. **REQ-USEFUL-PROF-9:** The overview must show no more than three supported entities per class and use the deterministic ranking and tie rules in this specification.
10. **REQ-USEFUL-PROF-10:** The full entity drilldown must include every association with at least one eligible game, expose entity and class comparator evidence and exclusions, and support deterministic ordering by rating, support, and name.
11. **REQ-USEFUL-PROF-11:** Entity language must describe association within the owner's collection and must not claim causation, universal quality, statistical significance, or a creator's responsibility for a game's score.
12. **REQ-USEFUL-PROF-12:** BGG thing metadata must preserve mechanic, designer, and artist link IDs and names, distinguish complete empty results from metadata not yet fetched, and retain source observation time.
13. **REQ-USEFUL-PROF-13:** Existing games whose persisted schema cannot establish designer or artist completeness must migrate to a refresh-needed state rather than to a misleading complete empty list.
14. **REQ-USEFUL-PROF-14:** Metadata refresh must update all three entity classes atomically for a game. A failed refresh must preserve complete last-validated metadata as eligible with a refresh-failed warning; migrated refresh-needed data remains ineligible. The first release has no age-based metadata expiration.
15. **REQ-USEFUL-PROF-15:** Axis distributions must remain reachable as diagnostic drilldown under the identity question and must not be narrated as collection identity or attention.
16. **REQ-USEFUL-PROF-16:** Mechanics frequency, categories, families, subdomains, BGG weight clustering, axis weights, utility declarations, variance, rarity, absence, and collection-wide averages must not appear as standalone identity findings.
17. **REQ-USEFUL-PROF-17:** The identity answer must expose the independent result, metadata-readiness, and exclusion dimensions defined in this specification, plus refresh-failed warnings and whole-profile errors, without converting one into another.
18. **REQ-USEFUL-PROF-18:** Identity computation must be deterministic local computation and must make no network or model call; metadata refresh remains a separate owner-initiated operation.
19. **REQ-USEFUL-PROF-19:** The shared runtime contract must reject non-finite aggregates, duplicate entity identities, contradictory counts, mismatched evidence, or an entity or comparator not reproducible from its complete evidence cohort.
20. **REQ-USEFUL-PROF-20:** `GET /api/profile`, the web client, and `shelf-judge profile` JSON must preserve and runtime-validate the complete identity result and its insufficiency states without consumer-side projection.
21. **REQ-USEFUL-PROF-21:** The web identity section must use semantic headings, linked game evidence, keyboard-operable drilldowns, visible focus, non-color-only status cues, and WCAG 2.1 AA contrast.
22. **REQ-USEFUL-PROF-22:** Identity cards, evidence, and controls must fit without horizontal page overflow in current Chromium at `375x812`, `768x1024`, and `1440x900` CSS pixels and at 200% desktop zoom; content must wrap without hiding evidence or requiring hover.
23. **REQ-USEFUL-PROF-23:** The identity cache contract must be versioned forward; old metrics-first cache artifacts and identity results computed from older collection or metadata inputs must be discarded and recomputed.
24. **REQ-USEFUL-PROF-24:** An owned game without a BGG ID must use an explicit unrefreshable metadata exclusion with a manual correction destination when one exists; the profile must not offer an operation that cannot refresh it.

### Question 2: What Deserves My Attention Or A Decision Now?

25. **REQ-USEFUL-PROF-25:** The first release must create attention items only from explicit owner-maintained `first-play` and `replay` intentions.
26. **REQ-USEFUL-PROF-26:** Creating an intention must require a currently owned game, a valid current play count, and a matching intention kind, then store that count and its evidence time as the baseline; a game that is not currently owned must return the ineligible-game result.
27. **REQ-USEFUL-PROF-27:** Ownership, age, purchase state, fitness, low play count, outlier distance, redundancy, and BGG metadata must never create or imply a play intention.
28. **REQ-USEFUL-PROF-28:** Every active intention must appear immediately and remain visible without a deadline, reminder schedule, age threshold, urgency score, overdue state, or time-based ordering.
29. **REQ-USEFUL-PROF-29:** Missing, invalid, or stale current play evidence must attach an exact warning and correction destination without hiding the active intention or claiming that it remains unplayed.
30. **REQ-USEFUL-PROF-30:** A reported attention item must satisfy every field in the Attention Item Contract and must provide completion, retirement, and evidence-correction destinations while allowing the intention to remain active without penalty.
31. **REQ-USEFUL-PROF-31:** The attention section must order active items deterministically by NFC-normalized game name in Unicode code-point order and stable game ID, without using creation time or play count.
32. **REQ-USEFUL-PROF-32:** One active intention must create exactly one card. Other metrics must not create duplicate cards or competing decision families.
33. **REQ-USEFUL-PROF-33:** Completing or retiring an intention must persist the resolution, actor or source, and resolution time in durable collection source data separate from the disposable profile cache.
34. **REQ-USEFUL-PROF-34:** A later observed play-count increase above baseline must complete the active intention during the data update that observes it; reading the profile must not mutate durable intention state.
35. **REQ-USEFUL-PROF-35:** The owner must be able to mark an intention complete from personal knowledge without forcing an unsupported change to recorded play count.
36. **REQ-USEFUL-PROF-36:** A completed or retired intention must become active again only through a new explicit intention with a new intention ID and baseline.
37. **REQ-USEFUL-PROF-37:** When there is no active intention, the profile must show a successful nothing-needs-attention state and must not substitute another metric to populate the section.
38. **REQ-USEFUL-PROF-38:** Active intentions, evidence warnings, and resolved history must use the observable fields, ordering, and destinations in this specification and remain distinguishable from an empty collection and profile failure.
39. **REQ-USEFUL-PROF-39:** Tournament divergence, comparator-backed axis questions, outliers, narration, prediction residuals, redundancy, and purchase utilization must not appear in profile attention in this release.
40. **REQ-USEFUL-PROF-40:** Daemon operations must support create, complete, and retire using the public command and result contract in this specification; command-ID replay must return the original accepted result without creating duplicate intentions or resolutions.
41. **REQ-USEFUL-PROF-41:** Web and CLI must provide equivalent intention mutations and expose the resulting validated intention or conflict; profile JSON must expose the same resulting attention state, and CLI failures must use a nonzero exit status with the structured error on standard error.
42. **REQ-USEFUL-PROF-42:** Concurrent mutation must reject a stale expected intention version rather than overwrite a newer resolution, and the consumer must present a refresh-and-review response.
43. **REQ-USEFUL-PROF-43:** Intention mutations and automatic completion must log the attempted transition, trigger, game and intention identity, prior state/version, and outcome without logging unrelated collection contents.
44. **REQ-USEFUL-PROF-44:** Existing collections must migrate atomically and repeatably with no intentions and no fabricated resolution history. Failure or interruption must preserve the last valid collection for safe retry; existing play counts remain evidence but do not create intentions.
45. **REQ-USEFUL-PROF-45:** The shared runtime contract must reject impossible intention kinds, invalid or mismatched baselines, duplicate active intentions for one game, contradictory resolutions, and attention items not backed by an active explicit intention.
46. **REQ-USEFUL-PROF-46:** The attention UI must announce mutation success and failure, associate validation errors with controls, preserve focus after updates, and provide keyboard and touch access without relying on color or hover.
47. **REQ-USEFUL-PROF-47:** Attention cards and intention controls must fit without horizontal page overflow in current Chromium at `375x812`, `768x1024`, and `1440x900` CSS pixels and at 200% desktop zoom; actions may stack but no response or evidence may disappear, interactive targets must be at least `44x44` CSS pixels, and mobile form text must be at least `16px`.
48. **REQ-USEFUL-PROF-48:** A profile load or recomputation failure must show attention as unavailable with retry, not as nothing needing attention, and must not delete or rewrite durable intentions.
49. **REQ-USEFUL-PROF-49:** Attention projections in the disposable profile cache must be invalidated by any play-evidence, intention, ownership, collection-schema, profile-contract, or profile-algorithm change that can alter their state.
50. **REQ-USEFUL-PROF-50:** Changing a game to previously owned must retire its active intention in the same validated mutation and disclose that transition; later re-ownership must preserve history without creating a new intention.

## Technical Contract

This section constrains implementation where product behavior depends on a consistent boundary. It is not an implementation plan.

### Source And Derived Data

Durable owner intent and resolution history belong in versioned collection source data. Computed entity ratings, attention projections, insufficiency states, and ordering belong in the disposable versioned profile cache.

The profile cache must be invalidated by changes to:

- ownership;
- BGG entity metadata or its completeness state;
- any input that changes displayed current fitness;
- play-count value, validity, source, or observation time;
- intention creation, baseline, state, version, or resolution; and
- the profile contract or algorithm version.

No profile cache migration is required. A collection migration is required because intentions, resolutions, and BGG metadata completeness are durable source data.

Collection migration must write atomically. A failed or interrupted migration leaves the last validated source artifact unchanged and loadable. Repeating migration from the same prior version produces the same current artifact without duplicate history or further semantic changes.

For entity metadata, a complete last-validated class remains eligible after a later refresh attempt fails and carries a refresh-failed warning. Metadata has no age-only expiration in this release. A migrated class whose completeness is unknown remains refresh-needed and ineligible until a successful BGG thing response establishes complete-empty or complete-populated data. A game without a BGG ID is unrefreshable rather than refresh-needed.

### Entity Identity And Arithmetic

BGG link ID is the stable entity identity. Display-name changes update the name without splitting historical identity. If the same ID occurs more than once on one game, deduplicate it before aggregation.

For eligible scores `x1` through `xn`:

```text
entity mean = sum(xi) / n
population standard deviation = sqrt(sum((xi - mean)^2) / n)
collection comparator = sum(each class-eligible game's current fitness once) / eligible game count
difference = entity mean - collection comparator
```

Compute and compare unrounded finite values. Presentation may round fitness aggregates to one decimal place, but deterministic ordering uses unrounded values. Equal ordering values use NFC-normalized display names by Unicode code-point order and then numeric BGG ID.

### Intention Lifecycle

One game may have at most one active intention. `intentionId` identifies one owner commitment from creation through completion or retirement. A new intention after resolution receives a new intention ID and snapshots a new play-count baseline. A monotonically increasing intention version protects every transition.

Allowed lifecycle transitions are:

```text
none -> active
active -> completed
active -> retired
completed or retired -> new intention ID + active
```

`first-play` requires a valid current play count of `0`; `replay` requires a valid current play count of at least `1`. A client-supplied baseline is not authoritative; the daemon snapshots validated current evidence when it accepts creation.

An automatic completion records source `observed-play-increase`. Manual completion records source `owner-confirmed`. Retirement records source `owner-retired`.

### Service Boundaries

The shared package owns exact runtime schemas for profile output, intention commands, mutation results, and conflicts. The daemon owns mutation, persistence, lifecycle enforcement, profile computation, and cache invalidation. The web reaches these operations through its daemon proxy. The CLI exposes discoverable operations for every owner action rather than requiring direct file edits.

The public mutation commands are:

| Command  | Required request                                                         |
| -------- | ------------------------------------------------------------------------ |
| Create   | `commandId`, game ID, kind, and expected absence of an active intention. |
| Complete | `commandId`, game ID, intention ID, and expected version.                |
| Retire   | `commandId`, game ID, intention ID, and expected version.                |

The CLI exposes these as `shelf-judge game intention set`, `complete`, and `retire`; web controls invoke equivalent daemon operations through the proxy. Exact HTTP paths belong in design, but operation discovery must expose one stable operation ID for each command.

Every successful mutation returns the accepted durable intention, version, and any linked ownership transition. Errors use a shared discriminated contract for validation with field issues, game or intention not found, ineligible game or baseline, active-intention conflict, stale expected version with current state, reused command ID with different payload, and persistence failure. CLI failures write the structured error to standard error and exit nonzero.

`commandId` supplies retry idempotency. Replaying the same command ID with the same canonical payload returns the original accepted result even after a lost response. Reusing it with a different payload fails. A different command ID is a new attempt and must satisfy current expected-version rules.

## Out Of Scope

- Inferring personality, taste causes, or universal creator quality
- Rating categories, families, subdomains, publishers, or BGG weight in the first identity answer
- Correcting for co-occurring mechanics, designer teams, or artist teams
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

1. Confirm the recorded owner approval covers all three first-version semantics: three-game supported identity, veto inclusion at displayed zero, and a gentle intention list with no dates, aging, urgency, or overdue state.
2. Trace every requirement to exactly one of the two headline-question subsections. Reject any prominent output that cannot name its question and user job.
3. Build deterministic entity fixtures covering mechanics, designers, and artists; duplicate links; one, two, and three associated games; ties; missing and complete-empty metadata; predicted scores; vetoed scores; previously owned games; and mixed class readiness.
4. Reproduce every entity aggregate and comparator from its game evidence. Inject non-finite, duplicate, mismatched, and contradictory records and verify runtime validation rejects them before persistence or rendering.
5. Verify overview ranking uses unrounded means, support, normalized name, and BGG ID in order, while sparse associations remain drilldown-only.
6. Parse representative BGG thing responses with zero, one, and multiple designer and artist links. Verify new and refreshed games retain IDs, names, completeness, and observation time, migrated old games remain refresh-needed until real data is fetched, failed refresh preserves last-valid eligibility with a warning, and games without BGG IDs are unrefreshable without a false refresh action.
7. Exercise the intention lifecycle from no intention through create, leave active across repeated reads and long elapsed time, complete, retire, automatic observed-play completion, ownership ending, re-ownership, and later explicit new intention. Reject creation for a game that is not currently owned. Verify IDs behave as specified and durable history survives daemon restart and profile-cache deletion.
8. Test first-play with baseline zero and replay with a positive baseline. Reject mismatched kinds, missing or invalid creation evidence, duplicate active intentions, and stale expected versions.
9. Verify every active intention appears immediately and remains visible with identical neutral language and ordering after arbitrary clock advancement. Confirm no date, age, urgency, overdue, countdown, or elapsed-time field affects the result.
10. Verify only valid current play evidence strictly greater than baseline completes the intention during the data update. Cover a corrected count below baseline followed by an increase that remains at or below baseline. Missing, invalid, stale, equal, or lower evidence must leave it visible, with a warning where applicable, and repeated profile reads must cause no durable write.
11. Replay the same command ID and canonical payload and verify the original success result returns without duplicate intentions or resolutions. Reuse the ID with a changed payload and verify rejection; use a new ID with a stale version and verify a current-state conflict. Simulate persistence failure and verify no success is reported.
12. Verify the web and CLI can create, complete, and retire intentions and that their validated results match the subsequent profile output.
13. Verify empty collection, supported identity, limited identity, missing metadata, missing ratings, evaluated-empty, active intentions, nothing-to-decide, evidence warnings, profile recomputation failure, transport failure, and validation failure remain visibly distinct.
14. Verify the Profile Overview and game-detail profile surfaces no longer render narration, divergence, comparator-backed axis questions, outliers, standalone BGG clustering, axis weights, or utility declarations. Verify purchase utilization and redundancy remain available only in their independently approved destinations.
15. Verify semantic heading order, accessible names and descriptions, linked evidence, focus visibility, focus retention, status announcements, field-error association, non-color-only states, contrast, and keyboard operation.
16. Exercise the real rendered page in current Chromium at `375x812`, `768x1024`, and `1440x900` CSS pixels and at 200% desktop zoom. Verify no horizontal page overflow, clipped evidence, hover-only content, target below `44x44` CSS pixels, inaccessible action, focus loss, or mobile input zoom regression. Real-browser evidence is a release gate; if no runner exists, add one or record equivalent manual Chromium evidence rather than accepting source inspection.
17. Verify old profile cache versions are discarded and every listed source change invalidates the affected projection. Run migration fixtures for the current schema, each supported prior schema, malformed partial input, simulated persistence interruption, restart, and repeated load. Existing collections must gain no fabricated intentions or complete designer/artist metadata, and failed migration must preserve the last valid artifact.
18. Run repository typecheck, lint, formatting checks for changed files, all tests, and the production web build. Distinguish known repository-wide baseline failures from failures introduced by the implementation.
19. Ask a fresh reviewer to explain both headline answers, why sparse entities are not identity claims, why active intentions never become overdue, how missing play evidence affects automatic completion, how every attention item resolves, and where every removed current surface went. Treat an unclear answer as a specification or implementation failure.

## Owner Review Decisions

The owner approved these first-version choices on 2026-08-27:

1. **Supported identity threshold:** three eligible associated games for overview placement; one and two remain limited drilldown evidence.
2. **Veto treatment:** include the same displayed current fitness of `0`, visibly identify the veto, and never substitute hypothetical fitness.
3. **Intention visibility:** every explicit active intention remains in a gentle list without dates, aging, urgency, or overdue language until valid current play evidence exceeds its baseline or the owner resolves it.

Changing one of these choices requires updating the examples, requirements, technical contract, and validation together before approval.
