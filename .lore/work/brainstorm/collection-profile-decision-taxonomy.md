---
title: Collection profile questions and decision taxonomy
date: 2026-08-27
status: resolved
tags: [collection, profile, identity, attention, decision-support]
modules: [profile]
related:
  - .lore/specs/collection/collection-profiling.md
  - .lore/work/notes/trusted-collection-insights-validation.md
  - .lore/work/specs/collection-purchase-utilization.md
---

# Collection Profile Questions and Decision Taxonomy

## Product Boundary

The profile must answer exactly two questions:

1. **What does my collection reveal about me?**
2. **What deserves my attention or a decision now?**

These questions are not two presentations of the same statistics. The first makes stable identity legible. The second identifies unresolved choices. A fact can answer the first without belonging in the second.

The profile is not a dashboard of everything Shelf Judge can calculate. Computability, statistical defensibility, and evidentiary integrity are necessary for a claim to be trustworthy, but none of them establish that the claim is useful.

## Four Kinds of Output

| Kind                         | User meaning                                                                                | Requires action? | Profile treatment                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| Stable identity              | "This is a recurring characteristic of what I own or value."                                | No               | Answer the identity question and allow supporting drilldown.                                 |
| Model diagnostic             | "My recorded ratings, configured model, or observed choices may not describe me correctly." | Maybe            | Ask whether the input is stale, the model is missing something, or the game is an exception. |
| Unresolved collection choice | "I have not decided what role or intention this game has."                                  | Yes              | Place in attention only when the unresolved choice and valid responses can be named.         |
| Mere statistic               | "This number is true, but it does not change my understanding or expose a choice."          | No               | Omit from the profile; retain only in a relevant detail or analysis view if useful there.    |

An unusual game is not automatically an unresolved choice. A low-utilization purchase is not automatically an unresolved choice. A threshold crossing is not a choice at all.

## Question 1: What Does My Collection Reveal About Me?

This question asks for durable patterns, not a personality label and not a summary of configured settings.

A useful identity statement should:

- describe a repeated pattern in owned games, ratings, or use;
- distinguish what the owner chooses from what BGG happens to label;
- remain meaningful when no game needs attention;
- show enough examples or distribution context for the owner to recognize or reject it;
- avoid turning absence, frequency, or variance into a preference without behavioral or evaluative support;
- avoid restating an axis weight or utility curve as if configuration proved behavior.

Candidate forms include:

- **Demonstrated preference:** games with a characteristic repeatedly receive high personal ratings or use, relative to games without it.
- **Collection role pattern:** the collection repeatedly serves particular occasions, player groups, durations, or experiences.
- **Tolerance boundary:** the owner consistently keeps or values games across one dimension while rejecting or rating poorly beyond a boundary.
- **Intentional breadth:** the collection supports several distinct, well-represented modes rather than one statistical center.
- **Intentional exception:** a game is unlike its neighbors but has a clear role or strong personal value, and therefore reveals breadth rather than incoherence.

The first version need not infer all of these. The framework excludes weaker substitutes such as "most games use hand management" unless ownership frequency is connected to rating, use, role, or a direct owner declaration.

### First Identity Answer: Rated Mechanics and Creators

The owner chose a concrete first answer: use the current fitness ratings of owned games to determine collection-specific ratings for their **mechanics, designers, and artists**.

For each entity, the profile should answer:

- Which owned games are associated with it?
- What is the average of those games' current fitness scores?
- How does that average compare with the owner's currently owned, eligible collection?
- How many games support the rating, and how dispersed are their fitness scores?
- Which games most strongly explain the result?

This reveals patterns such as "games using this mechanic tend to fit me well" or "games involving this designer or artist have rated highly in my collection." It does **not** establish that the mechanic, designer, or artist caused the rating. A game contributes its full fitness to every credited entity; co-occurring mechanics and collaborators remain confounded. Presentation must use associative language and keep the supporting games inspectable.

The rating source is the same current fitness shown for the game, not a new profile score and not a BGG community rating. To avoid circular evidence, an entity rating must exclude a game when its current displayed fitness contains predicted contributions. Mechanics participate in prediction features, so using prediction-influenced fitness to establish mechanic preference would partly validate the model with its own output. Vetoed and otherwise unusual current fitness results are not silently replaced; the specification must decide whether they remain eligible or appear as separately explained cases.

Mechanics are already persisted in `BggGameData`. BGG thing responses contain `boardgamedesigner` and `boardgameartist` links, but the current parser and persisted type discard them. Designer and artist ratings therefore require metadata expansion and refresh before the identity answer is complete.

"Supported" means the rating shows its eligible game count, collection comparator, dispersion, and game evidence. "Durable" means the profile distinguishes one-game associations from repeated patterns. Exact minimum counts and ranking rules belong in the specification, but a single game must never be narrated as a stable preference.

### Identity Drilldown

Identity claims should lead to inspectable examples and distributions. The drilldown answers "why does Shelf Judge say this?" It is not a second stream of profile findings.

Axis distributions belong here as diagnostic drilldown even when they do not support a broader identity claim. They let the owner verify whether configured axes have ratings, range, clustering, and effective values consistent with how the axes are intended to work.

## Question 2: What Deserves My Attention or a Decision Now?

An attention item must identify a current unresolved choice. It must be possible for the owner to resolve the item without making the metric cross a threshold.

### Actionability Gate

An item belongs in attention only when all of the following are true:

1. **A live intention, role, or model input is uncertain.** Historical regret or an unusual number is insufficient.
2. **The unresolved question can be stated in owner language.** For example, "Do I still intend to play this?" rather than "Play count is below 3."
3. **At least two substantively different responses are valid.** The system is surfacing a choice, not disguising a recommendation. Administrative dismissal or deferral does not create a second response by itself.
4. **The evidence distinguishes the item from the ordinary collection.** A generic possibility that applies to every game creates a queue, not attention.
5. **Resolving the question changes something the owner cares about.** It clarifies an intention, a collection role, a rating/model, an exception, or future acquisition behavior.
6. **The system can explain why it is asking now.** Recency can contribute, but a threshold crossing alone cannot create the unresolved condition.

If any condition fails, abstain from creating an attention item. "Nothing needs attention" is a successful result.

## Decision Families

### Play, Replay, or Retire an Intention

**Unresolved condition:** The owner appears to still treat a game as something they mean to play or revisit, but actual play does not support that intention and the intention has not been reaffirmed or retired.

**Evidence required:** A source for the active intention; play count or last-played evidence with provenance; enough elapsed opportunity to make the gap meaningful; relevant fitness, role, or purchase context; no known reason that makes play infeasible or intentionally rare.

**Plausible responses:** Schedule or prioritize a play; replay before judging; explicitly stop treating the game as an active intention; clarify that it serves a rare but valid occasion; correct stale play data.

**Reasons to abstain:** No explicit or inferable active intention; recently acquired game without a reasonable opportunity; campaign, seasonal, event, legacy, or high-player-count game expected to be rare; missing or stale play history; already resolved role; low play count is the only evidence.

### Keep, Remove, or Clarify a Role

**Unresolved condition:** A game's reason for occupying collection space is unclear, contested, or duplicated under a real owner constraint.

**Evidence required:** The role the game is expected to serve, or evidence that no role has been established; close alternatives and the dimensions on which they overlap; relevant differences; current preference/use evidence; an actual curation constraint such as shelf capacity, desired collection size, or owner-initiated review.

**Plausible responses:** Keep it for a distinct role; choose between overlapping games; remove or mark previously owned; clarify that apparent duplication is intentional variety; defer until the games have been played enough to compare.

**Reasons to abstain:** Similarity without a curation constraint; different games serve different groups or occasions; insufficient plays or ratings; one game is an expansion, campaign, sentimental item, or intentional variant; the system cannot state the disputed role.

### Correct a Rating or Model

**Unresolved condition:** The recorded personal inputs or resulting prediction appear inconsistent with the owner's current judgment, and the inconsistency could materially affect how Shelf Judge evaluates games.

**Evidence required:** The current rating or prediction with its inputs; a newer actual rating, repeated behavior, or direct owner judgment that conflicts with it; the size and practical effect of the mismatch; comparable games or affected axes where relevant.

**Plausible responses:** Update a stale rating; add or revise an axis; change a curve, veto, or weight; leave the model unchanged because the mismatch is local; mark the game as an intentional exception; identify bad or missing source data.

**Reasons to abstain:** No newer judgment; difference is small or has no practical consequence; predicted and actual values are not comparable; sparse neighbors make the prediction uninformative; disagreement is only between two model outputs with no owner-facing consequence.

### Recognize an Intentional Exception

**Unresolved condition:** A game departs from an otherwise meaningful pattern, and it is not yet clear whether that difference is a valued exception, a separate collection mode, bad data, or a game without a role.

**Evidence required:** A supported collection pattern rather than a global centroid alone; concrete dimensions of difference; the game's personal rating, use, and role context; nearby games or absence of peers; enough information to distinguish unusual composition from poor fit.

**Plausible responses:** Confirm the game as a valued exception; name the distinct role or collection mode it represents; correct metadata or ratings; move it into another decision family because its role remains unresolved; dismiss the question as not meaningful.

**Reasons to abstain:** Difference is only a distance score; the collection is intentionally multimodal; the game already has a clear role; incomplete BGG metadata; unusual composition is being treated as evidence of removal; no stable pattern exists to be an exception to.

Recognition is usually a resolution to another prompt, not a demand for behavioral change. Once confirmed, the exception should contribute to identity and stop appearing in attention unless new evidence reopens the question.

### Change Future Buying

**Unresolved condition:** Multiple completed or clearly abandoned purchases expose a repeated mismatch between acquisition intent and later value, use, or fit, and the owner has not decided whether to change the rule used for future purchases.

**Evidence required:** Purchase cost and acquisition context where available; sufficient opportunity for use; play and fitness evidence; repeated pattern across purchases or a deliberately reviewed high-impact purchase; separation of purchase quality from current keep/remove value.

**Plausible responses:** Adopt a waiting period, play-before-buying rule, budget, role check, or utilization target; narrow a type of speculative purchase; accept the cost as exploration; make no change because the evidence is isolated or circumstances changed.

**Reasons to abstain:** One low-utilization game with no repeated pattern; recent purchase; missing cost or use evidence; gifts and inherited games presented as purchases; a game was a worthwhile experience despite low replay; the prompt is covertly recommending a specific purchase or ban.

## Data Readiness

The taxonomy describes legitimate product jobs, not claims that current data can support them. Until a family has the required evidence, the profile must abstain rather than infer owner intent from convenient proxies.

| Family                | Available now                                                                | Missing dependency                                                                                                                                | Behavior until available                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Play/replay intention | Lifetime play count and current game/model context                           | Explicit active intention, reliable last-played history, intention time, and rare-occasion context                                                | **Selected for first attention scope.** Add owner-maintained intention data; produce no prompt until intention is explicit.          |
| Keep/remove/role      | Similarity/redundancy data, ratings, and configured physical shelf capacity  | Owner-recognized game role and persisted resolution; an owner-initiated curation review can supply the decision context without physical overflow | **Unresolved.** Capacity overflow can explain why review is timely, but cannot identify which role is dispensable.                   |
| Correct rating/model  | Current personal and predicted breakdowns with prediction support evidence   | A prediction snapshot that predates the owner's actual rating, or another direct newer judgment that makes the mismatch real                      | **Unresolved.** Do not compare a recomputed prediction with the rating that already became one of its inputs.                        |
| Intentional exception | Current factual-neighborhood evidence and personal fitness context           | An approved identity baseline, owner-recognized role, and persisted exception resolution                                                          | **Unresolved.** Current outlier distance remains evidence, not an attention item.                                                    |
| Future buying         | Purchase cost, lifetime play count, modeled utilization, and current fitness | Purchase/acquisition timing and context, sufficient-opportunity semantics, repeated-pattern review, and persisted buying-rule resolution          | **Unresolved for profile attention.** Keep per-game utilization and user-selected sorts only until real collection data is reviewed. |

Inference of intention, role, acquisition context, or resolution is not permitted by this framework. The specification may propose new owner input, but must not silently replace it with BGG metadata, age of the game, similarity, or threshold status.

## Signal Audit

The disposition applies to the Profile Overview, not necessarily to every detail, CLI, or diagnostic surface.

| Signal                                                 | Disposition                                           | Jobs it can serve                                           | Why                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Axis distributions                                     | **Retain as drilldown**                               | Identity verification; model diagnostic                     | The owner explicitly values seeing whether configured axes are used as expected. Distribution shape does not by itself establish identity or create attention.                                                                                                      |
| Tournament value versus independent fitness divergence | **Remove from default profile**                       | None demonstrated                                           | Evidentiary repairs made the comparison trustworthy but did not make it useful. A disagreement between two modeled preference signals does not identify a live owner response. Do not preserve it merely because it exists.                                         |
| Collection outliers                                    | **Redesign**                                          | Intentional exception; role clarification; identity breadth | Factual distance alone is a statistic. It becomes useful only when anchored to a supported collection pattern and an unresolved question about role, exception, data, or model.                                                                                     |
| Comparator-backed axis questions                       | **Remove from default profile**                       | No independent job demonstrated                             | The current questions are derived from Tournament-versus-fitness divergence. Removing the underlying signal also removes its derivative unless a future model-correction design independently demonstrates a user response.                                         |
| Prediction misses                                      | **Unresolved candidate**                              | Correct rating/model; intentional exception                 | The question is promising, but current recomputation does not prove what the model predicted before the owner supplied an actual rating. It needs a comparable prior prediction and a practical consequence before it can become attention or diagnostic drilldown. |
| Neglect and play history                               | **Redesign**                                          | Play/replay or retire intention; role clarification         | Time and count thresholds do not prove neglect. The useful signal is a gap between an active intention and actual play, with opportunity and rare-role context.                                                                                                     |
| Redundancy                                             | **Redesign**                                          | Keep/remove/clarify role                                    | Similarity alone does not create a decision. It matters when games compete for the same stated role under an actual collection constraint and the owner has enough experience to compare them.                                                                      |
| Purchase utilization                                   | **Retain as drilldown; profile attention unresolved** | Change future buying; play intention context                | It answers whether a purchase earned its cost, but the implemented feature explicitly lacks real-data proof for automatic insight. Keep per-game results and user-selected sorts. Reconsider attention only after owner review of real collection results.          |
| Grounded narration                                     | **Remove with its source findings**                   | Recognition, if it adds value beyond source evidence        | Current narration only selects and restates trusted findings. It has no independent job and must not keep divergence, outliers, or axis questions alive. A future narration design must prove that it improves recognition or resolution.                           |

### Remaining Current Outputs

| Current output                                                   | Disposition                                     | Destination                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Axis weights                                                     | **Remove from profile**                         | Axis configuration already explains the model. Use as supporting evidence only when a model-diagnostic question names a specific weight.                                                                                  |
| Utility curve and veto declarations                              | **Remove from profile**                         | Axis configuration and score breakdown. Use as supporting evidence only when a model-diagnostic question names the configuration.                                                                                         |
| BGG mechanic, category, family, subdomain, and weight clustering | **Remove from profile as standalone summaries** | Mechanic membership supplies identity inputs only when joined to eligible current fitness. Frequency alone is not an identity claim. Categories, families, subdomains, and weight do not enter the first identity answer. |
| High variance, absence, rarity, and collection-wide averages     | **Remove from profile**                         | No destination unless a later decision framework establishes a job and comparator.                                                                                                                                        |
| Trusted-insight abstention cards for removed families            | **Remove with the family**                      | Abstention remains required for analyses that survive; it is not a reason to keep an unused analysis visible.                                                                                                             |

## Attention Item Contract

The product specification should require every attention item to expose:

| Field               | Purpose                                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| Question            | The unresolved choice in owner language.                                       |
| Why now             | The event or evidence change that made the question timely.                    |
| Evidence            | The minimum sourced facts needed to understand the question.                   |
| Plausible responses | Multiple valid ways the owner could resolve it.                                |
| Abstention basis    | Why similar games were not raised, and what missing context prevents a claim.  |
| Resolution          | The owner's answer, including intentional exception or dismissal.              |
| Reopen condition    | What future evidence, if any, would make the resolved item worth asking again. |

This is a product contract, not a proposed storage schema. The specification should decide persistence only after deciding whether resolutions must survive recomputation.

### Collision Rule

One unresolved owner question must not become several cards because several metrics detected it. The specification must assign one canonical decision family, merge supporting evidence from other signals, and define precedence and deduplication. Model correction owns a question when changing an input is the unresolved outcome; role clarification owns it when collection purpose is unresolved; play intention owns it when the live commitment is unresolved. Intentional exception is normally a resolution, not a competing card. Future-buying questions describe a repeated acquisition pattern and should not duplicate a per-game keep/remove question.

## Profile Composition

The question-first profile implied by this taxonomy is:

1. **Identity:** a small set of supported, durable patterns with examples and drilldowns.
2. **Attention:** unresolved owner questions grouped by decision family, or an explicit "nothing needs attention" result.
3. **Diagnostics:** axis distributions and other owner-requested tools for checking the model, reached from identity or attention rather than promoted as findings.

Signal-family sections such as "Divergence," "Outliers," and "Suggestions" should not define the information architecture. A signal is evidence for a user question, not a user job.

## Decisions Established Here

- The profile has exactly two top-level questions.
- Identity, diagnostics, unresolved choices, and statistics are different product outputs.
- Attention requires a live unresolved choice, not a threshold crossing.
- It is valid and desirable to report that nothing needs attention.
- The system presents questions and evidence, not automatic buying, selling, rating, or weight changes.
- Axis distributions remain available because they support owner verification of configured axes.
- Tournament-versus-fitness divergence does not survive by default because no useful owner response has been demonstrated.
- Outliers, neglect, redundancy, and utilization require decision-centered redesign and missing owner context before appearing in attention.
- Prediction misses remain unresolved until Shelf Judge can compare an actual judgment with a prediction made before that judgment became an input.
- Current comparator-backed axis questions and grounded narration do not survive removal of their source findings by default.
- Existing model declarations and BGG summary statistics are removed from the profile rather than retained without a named job.
- The first identity answer rates mechanics, designers, and artists from eligible owned-game current fitness.
- The first attention family uses explicit owner-maintained play or replay intentions; ownership, purchase, and low play count do not imply intention.

## Resolved Scope Decisions

The owner resolved the two scope decisions needed for the product-specification handoff:

1. **Minimum identity answer:** Resolved. Rate mechanics, designers, and artists from the current fitness of their eligible owned games, with supporting games and collection-relative context.
2. **First attention family:** Resolved. Add explicit owner-maintained play intentions and ask whether to act on or retire an intention when use and intention diverge.

## Specification Decisions

These decisions are recorded rather than hidden in implementation. They can be resolved while writing the next specification once first-version scope is chosen:

1. **What is the explicit intention model?** The owner must set the intention. The specification must define whether the states distinguish first play from replay, whether an intended time horizon is required, and how the owner retires or completes the intention. Purchase recency and ownership are context, never substitutes for intent.
2. **Must attention resolutions persist?** Without persistence, intentional exceptions and dismissed questions will recur after every recomputation. With persistence, the product needs a resolution and reopen model.
3. **What establishes a game role?** Free-form owner labels, a controlled role taxonomy, inferred occasions, or a combination lead to different redundancy and exception behavior.
4. **What collection constraint activates keep/remove questions?** Shelf capacity is concrete, but the owner may also initiate a curation review without a physical constraint.
5. **Can one exceptional purchase justify a future-buying prompt, or is a repeated pattern always required?** The current recommendation is repeated evidence; a single-purchase exception requires explicit owner approval after real-data review.
6. **How should sparse entity ratings be presented?** A single associated game can have a descriptive average but cannot establish stable identity. The specification must define the minimum repeated support for ranking or identity language.
7. **How long do resolutions last and what reopens them?** Reopening should follow a material evidence or owner-intent change, not every profile recomputation.

## Specification Handoff

The next specification should define the smallest coherent version of both top-level answers, not repackage all existing profile output. The identity answer rates mechanics, designers, and artists from eligible owned-game current fitness. The attention answer begins with explicit play/replay intentions. It should map each retained output to this taxonomy, define abstention and resolution behavior, and explicitly retire or relocate current sections that do not answer either question.

The specification should not begin with UI layout or metric thresholds. After the two blocking scope decisions are resolved, it can define the selected form and family while resolving the recorded semantics above. Unselected families remain explicitly deferred rather than partially specified.
