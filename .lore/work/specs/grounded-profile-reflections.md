---
title: Grounded profile reflections
date: 2026-08-30
status: approved
tags: [collection, profile, reflections, llm, grounding]
modules: [shared, daemon, cli, web]
related:
  - .lore/work/specs/useful-collection-profile.md
  - .lore/work/specs/owner-game-notes.md
  - .lore/work/specs/collection-analyst-chat.md
  - .lore/work/design/profile-evidence-explorer.md
req-prefix: REFLECT
---

# Grounded Profile Reflections

## Goal

Shelf Judge must offer a small set of optional profile questions that help the owner recognize or articulate something about their collection that the deterministic Profile cards do not already say. A reflection combines current owner game notes, treated as testimony, with bounded deterministic collection evidence. It returns one inspectable synthesis or abstains.

Reflections are not a replacement for the deterministic Profile. Ordinary Profile reads remain local, immediate, and useful without model configuration or network access. A model runs only after the owner explicitly refreshes one or more enabled questions and acknowledges the provider boundary. Model failure cannot make the Profile, its evidence explorer, game notes, or collection data unavailable.

Useful reflection means more than accurate paraphrase. An answer must identify a repeated owner-expressed criterion, a material exception to a supported collection pattern, or a recurring trade-off that connects at least two independently cited pieces of owner testimony to current computed or imported evidence. It must give the owner a concise statement they could recognize, reject, or refine. Repeating entity rankings, score arithmetic, note sentences, or generic collection statistics is not useful and must result in abstention.

## Representative Experiences

### Repeated Value With A Complication

The owner has notes on three games that independently praise low setup friction. Two games also have strong current fitness and appear among supported mechanic associations. A third has lower fitness because of a hard veto on a different personal axis.

For **What qualities do I repeatedly value in my games?**, Shelf Judge may answer:

> You repeatedly describe quick setup as part of why a game works for you, especially for _Cascadia_ and _The Crew_. _Mysterium_ is a useful limit on that pattern: your note also values its group experience, but its current score is held to 0 by your player-count veto. This supports "low setup friction matters in some recurring contexts," not "you always prefer lighter games."

The answer labels each note as owner testimony, cites each current note version, cites the current score or veto evidence, and links to the canonical game and score destinations. It does not infer that setup is a rating axis, a universal preference, or a keep decision.

### A Supported Pattern With A Meaningful Exception

The deterministic Profile shows worker placement as a supported high-fit association. Notes on several supporting games describe satisfying planning, while a note on one equally high-fit worker-placement game says it succeeds because negotiation disrupts optimization.

For **Where does my experience complicate my collection's strongest patterns?**, Shelf Judge may answer:

> Worker placement is a supported high-fit association in your collection, but your notes do not describe one uniform appeal. Three notes emphasize planning; your note on _Dune: Imperium_ instead emphasizes negotiation disrupting a perfect plan. The collection pattern is real as an association, while the testimony suggests more than one route to a high score.

This adds an inspectable qualification to the deterministic card. It does not claim causation, personality, or a newly discovered preference. If the only available sentence is "worker placement ranks highly," the question abstains because the Profile already says that.

### A Recurring Trade-Off

Several notes pair positive and limiting testimony, such as loving interaction but needing the right group, or valuing depth but avoiding long setup on weeknights. Current metadata and scores support comparison without proving the owner's social circumstances.

For **What trade-offs recur in how I describe my games?**, Shelf Judge may answer:

> Your notes repeatedly pair interaction with group dependence. _Captain Sonar_ and _Sidereal Confluence_ are described as distinctive social experiences, while both notes limit that value to a suitable group. Their player-count metadata is consistent with that context, but Shelf Judge has no evidence about who your regular group includes or how often that group meets.

The answer identifies a repeated tension because the testimony contains both sides. It does not manufacture an opposing side from low play count, purchase age, ownership, or missing notes.

### Nothing Useful To Add

Only one game has a present note, "Great art." The collection has complete artist evidence, but no second owner statement or material contradiction establishes a recurring value, pattern exception, or trade-off.

Each question independently abstains with a specific explanation. The Profile remains complete. Shelf Judge does not stretch one note into a stable preference, infer meaning from every other game's missing note, or paraphrase the note and call it synthesis.

## Initial Questions

The first release provides exactly these versioned questions. Their wording and evidence policy are product contract, not a prompt-only implementation detail.

### 1. What Qualities Do I Repeatedly Value In My Games?

- **User job:** Articulate a criterion the owner has expressed across games but has not represented as a structured axis or deterministic Profile card.
- **Required evidence:** Present notes from at least two distinct games that independently express the same bounded quality, plus current evidence for each cited game's identity and at least one of current fitness, score breakdown, play evidence, imported metadata, ownership, or supported Profile association.
- **Useful-answer test:** The answer names the repeated criterion in language no stronger than the notes, explains how current evidence supports or limits it, and includes a material counterexample or says that no material counterexample appears in the retrieved scope. It must not merely concatenate or summarize notes.
- **Abstention rule:** Abstain when fewer than two independent present notes support one criterion; the apparent repetition depends on copied, boilerplate, or semantically empty text; current evidence cannot connect the testimony to the collection; a counterexample materially defeats the synthesis; or the result would only restate an existing axis, ranking, or note.
- **Representative output:** The low-setup-friction example above.

### 2. Where Does My Experience Complicate My Collection's Strongest Patterns?

- **User job:** Understand where owner-described experience qualifies a supported deterministic mechanic, designer, or artist association.
- **Required evidence:** The complete deterministic candidate set consisting of every class's current `overviewEntityIds` (at most the configured overview limit, currently three, from each class's exact `bestFit` ordering); complete comparator, support, dispersion, exclusions, confounders, and supporting-game evidence for every candidate; present notes on at least two supporting games of the selected candidate; and at least one note-backed material exception, competing explanation, or meaningful difference within that association. The daemon examines candidates in class order `mechanic`, `designer`, `artist`, then their serialized overview order. It records coverage of the complete candidate set before answering or abstaining.
- **Useful-answer test:** The answer leaves the deterministic association intact, identifies a specific qualification that changes how the owner might describe it, and discloses co-occurrence, collaborator, veto, sparse-note, or metadata confounders that could change the interpretation.
- **Abstention rule:** Abstain when no entity is supported, fewer than two supporting games have relevant present notes, no material qualification exists, the qualification depends only on a low score or outlier calculation, or the answer would repeat the entity card and arithmetic.
- **Representative output:** The worker-placement example above.

### 3. What Trade-Offs Recur In How I Describe My Games?

- **User job:** Give the owner concise language for a recurring positive-versus-limiting consideration they have already expressed across different games.
- **Required evidence:** Present notes from at least two distinct games, each independently expressing both the positive and limiting side of the same trade-off, plus relevant current game identity and deterministic evidence that tests the stated context. Splitting the positive side into one note and the limiting side into another establishes disagreement, not recurrence, and does not qualify.
- **Useful-answer test:** The answer names both sides, identifies where the trade-off recurs and where it does not, and distinguishes testimony from metadata or computed association. It gives the owner a proposition they can reject or refine without turning it into advice.
- **Abstention rule:** Abstain when one side is inferred from missing notes, low plays, age, ownership, rating, or another proxy; only one game expresses the trade-off; current evidence materially contradicts the synthesis; or generic language such as "depth versus accessibility" is not traceable to specific testimony.
- **Representative output:** The interaction-and-group-dependence example above.

Each question evaluates only its own evidence and outcome. One answered question does not require the others to answer. No release gate requires a surprise, exception, tension, negative finding, or minimum number of answered questions.

## Evidence And Claim Model

### Bounded Evidence Package

The daemon, not the model or clients, builds one immutable evidence package for each question attempt against a captured evidence identity. The first release authorizes only:

| Evidence class                | Authorized meaning                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Game identity and ownership   | Stable game ID, display name, BGG ID when present, and current owned or previously-owned state                                                                    |
| Owner game notes              | Current present note text as owner testimony with game ID and note version; missing or cleared state without deleted text                                         |
| Current scoring               | Displayed current fitness, source state, axis contributions, prediction state, tournament and redundancy effects already in the breakdown, and vetoes             |
| Imported metadata             | Current validated categories, mechanics, families, subdomains, designers, artists, player counts, play time, weight, completeness, observation time, and warnings |
| Play and acquisition evidence | Current play count, acquisition date and price, source, observation time, and approved deterministic purchase-utilization result                                  |
| Collection structure          | Current shelf assignment and approved deterministic redundancy result                                                                                             |
| Profile evidence              | Current entity associations, comparator cohort, support policy, dispersion, supporting games, exclusions, warnings, profile contract, and algorithm version       |

Question policy narrows this manifest further. The repeated-values and trade-offs questions retrieve current present notes and game evidence in deterministic bounded pages. The pattern-exception question starts from the supported Profile entities and retrieves notes only for their supporting games. The provider receives no broad durable game object, raw collection file, command receipt, deleted or superseded note text, credential, environment variable, logs, caches, backup, wishlist data, or evidence unrelated to the selected question.

Each evidence item has a daemon-issued citation ID, evidence class, stable source identity, source revision or version, observation time where applicable, canonical summary, structured fields, and server-selected destination. The evidence package records its manifest version, question ID and version, collection ID and revision, collection schema version, Profile contract and algorithm versions, provider and model, and generation time.

### Testimony Versus Deterministic Evidence

Owner notes report what the owner wrote. They are not verified facts, model instructions, ratings, stable preferences, structured roles, intentions, or recommendations. Missing and cleared notes mean only that current testimony is unavailable. They supply no negative evidence.

Computed and imported evidence reports the current deterministic application state and its source limitations. Co-occurrence remains confounded. A Profile association does not prove causation or preference. A play count does not prove neglect or desire. Ownership, purchase age, and fitness do not imply keep, remove, buy, sell, play, or replay intent.

Every substantive answer block must cite at least one owner-testimony item and one computed or imported item unless it is an explicit limitation. A claim combining several games must cite every game necessary to establish the pattern. A counterexample must be cited beside the claim it qualifies. The UI labels source classes and never presents generated prose as source evidence.

### Counterexamples, Confounders, And Scope

Before model invocation, the daemon must retrieve the question's complete bounded evidence package, including its required counterexample and confounder projection. An answer must disclose any supplied evidence that materially narrows, contradicts, or provides a competing explanation for its central synthesis. It must not hide vetoes, predicted values, incomplete metadata, sparse notes, broad dispersion, co-occurring mechanics, collaborator teams, or contradictory testimony when they affect the claim.

The answer states the evaluated scope, including note-bearing game count, relevant eligible game count, and known exclusions. It cannot claim exhaustive testimony unless every current present note in the question's fixed snapshot was examined. Retrieval or context limits that prevent required coverage produce abstention, not a confident partial synthesis.

### Useful Answer And Runtime Validation

An answered reflection contains one central synthesis and up to three supporting blocks. It must pass structural validation before presentation:

- every citation exists in the attempt package and matches its recorded version;
- every substantive block has the required source classes;
- the central synthesis has the question's minimum independent note support;
- required counterexample and confounder retrieval completed;
- cited structured values match canonical evidence exactly;
- all claims and citations fit the selected question's authorization policy; and
- the output contains no unknown fields, arbitrary URLs, instructions, or collection mutations.

Runtime validation proves identity, authorization, versions, and structure. It cannot prove that prose is entailed by a citation or adds understanding. The versioned release evaluation corpus supplies that semantic gate.

## Visible Behavior

### Profile

Reflections appear as a nested **Optional reflections** subsection within the existing top-level **What does my collection reveal about me?** question, after its deterministic identity cards and evidence-explorer destination and before the second top-level attention question. They do not create a third Profile question or top-level content section and cannot interrupt or replace deterministic identity or attention results. The subsection shows the configured provider and model, privacy and cost disclosure, enabled-question controls, one card per enabled question, and an explicit **Refresh reflections** action.

Each card independently renders a cached-result state and an attempt state. Cached result is `none`, `current/answered`, `current/abstained`, `stale/answered`, or `stale/abstained`. Attempt is `idle`, `refreshing`, `cancelled`, `unavailable`, or `purged`. A refreshing, cancelled, or unavailable banner therefore can appear above a preserved prior result without changing its current or stale identity. When no cache exists, `none/idle` is labeled `not-generated`; `none/purged` explains why prior output was removed. Successful answered or abstained persistence replaces the cache and resets attempt to `idle`. Starting another attempt replaces the prior terminal attempt banner. Terminal attempt metadata persists across restart until another attempt, disable, or successful refresh; it contains no generated or evidence text. An active attempt interrupted by daemon restart becomes `unavailable/internal` with safe detail `daemon-restarted`. Re-enabling a disabled question returns `none/idle`.

Stale content is collapsed behind a clear **Show previous stale reflection** control and is never presented as current. Its citations open the captured canonical evidence snapshot, not current evidence mislabeled as support. Note-backed cached results are the exception: any set, clear, or permanent game deletion affecting an examined note immediately purges the complete dependent question result and its note-derived snapshots so superseded note text does not survive in a derived artifact.

All three questions are enabled by default in the first release. The owner may enable or disable each independently. Disabling a question cancels its active attempt, hides it from refresh, and deletes its cached result. Re-enabling starts at `not-generated`; it never restores deleted output. A **Delete all reflections** action confirms and removes every cached result without changing source data or question settings.

### Explicit Refresh And Disclosure

No reflection generates on Profile load, Profile recomputation, note read or mutation, collection mutation, daemon start, timer, or background job. **Refresh reflections** snapshots current evidence and attempts each enabled question sequentially in fixed question order. A per-card **Refresh this question** attempts only that question. The UI states the number of model operations and maximum provider inference round trips before confirmation.

Before transmission, web and interactive CLI show the resolved provider and model; evidence categories; that relevant owner notes and deterministic collection evidence leave the local application boundary; that provider processing and retention follow provider configuration and policy; what Shelf Judge retains locally; that Shelf Judge imposes no fixed token or monetary cap; and how to cancel. The owner may leave without transmission.

Acknowledgement applies only to that refresh batch and exact provider/model pair. It is not durable consent. A provider or model change before an attempt prevents transmission and returns `model-configuration`; the owner must start and acknowledge a new refresh. Each question attempt is a separate potentially charged model operation. One attempt may use at most two provider inference round trips: initial structured submission and, only when pi-agent requires it after the submission-tool result, terminal completion. The disclosure shows both the attempt count and the maximum provider round trips, currently twice the attempt count. Evidence retrieval is local and adds no provider round trip. Actual model or provider context-limit exhaustion returns `context-exhaustion`; a missing, malformed, or invalid structured submission after the allowed rounds returns `output-validation`. Neither starts another charged call.

### CLI

The CLI provides discoverable equivalents:

```text
shelf-judge profile reflections [--json]
shelf-judge profile reflections refresh [--question <id>] [--json] [--acknowledge-disclosure]
shelf-judge profile reflections cancel <batch-id> --capability <token> [--json]
shelf-judge profile reflections enable <question-id> [--json]
shelf-judge profile reflections disable <question-id> [--json]
shelf-judge profile reflections delete [--json]
```

The read command makes no model call. Human output distinguishes all card states, labels testimony and deterministic evidence, and prints numbered citations and destinations. JSON validates and preserves the complete shared contract. Interactive refresh prints disclosure to standard error and asks for confirmation. Noninteractive or JSON refresh requires `--acknowledge-disclosure`; omission fails before evidence retrieval or transmission. Refresh prints the batch ID and cancellation capability to standard error before work begins; JSON mode includes them only in its local acceptance event, never in logs or answer content. The standalone cancel command requires both values. `Ctrl-C` in the initiating process uses the same capability. Typed progress is emitted as NDJSON in JSON mode. Unavailable, rejected, or invalid operations use structured standard-error output and a nonzero exit status. Cancellation is not reported as a completed answer. Documentation warns that placing the capability in a command may expose it through shell history and recommends `Ctrl-C` in the initiating process.

### Accessibility And Mobile

Question headings identify their cards. Status, staleness, testimony, error, and outcome are communicated in text, not color alone. Refresh, cancel, enable, disable, disclosure, delete confirmation, stale-content disclosure, and citations are keyboard operable with visible focus. Progress uses a polite live region; completion, failure, cancellation, and purge receive concise announcements. Focus returns to the relevant question or batch action after a state change.

At `375x812`, `768x1024`, and `1440x900` CSS pixels and at 200% desktop zoom, disclosure, question controls, stale warnings, prose, scope, citations, errors, and progress wrap without horizontal page overflow or clipped evidence. Actions may stack. Touch targets are at least `44x44` CSS pixels, mobile form controls use at least `16px` text, and no evidence requires hover or horizontal swipe. Reduced-motion preferences disable nonessential progress animation.

## Refresh, Cache, And Deletion

Reflection output is a disposable, separately versioned local derived artifact. It is never part of the deterministic `GET /api/profile` cache and never becomes the only copy of a note or other source evidence. Ordinary Profile reads may join the current reflection-state projection, but they cannot trigger evidence retrieval, model access, cache generation, or refresh.

One cache entry exists per question ID. A successful answered or abstained attempt atomically replaces only that question's prior entry after complete validation. Cancelled, unavailable, malformed, or persistence-failed attempts do not replace it. Each entry records the complete evidence identity, a text-free dependency manifest for every retrieved source whether cited or not, structured answer, safe citation snapshots, provider-reported usage, and generation time. It contains no prompt, model reasoning, raw provider event, credential, or note text beyond the minimum owner-testimony excerpts explicitly quoted in the validated answer and citation presentation.

The dependency manifest records every examined note as game ID plus note version and every non-note dependency as source category plus stable identity, version or canonical fingerprint, and observation time where applicable. It retains no uncited note text or canonical note summary. Category fingerprints cover scoring, ownership, play, acquisition, metadata, shelf, Profile evidence, question policy, and provider configuration. An entry becomes stale when a non-note dependency fingerprint changes, the collection revision changes, the Profile contract or algorithm changes, its question or evidence-manifest version changes, or the configured provider/model differs. Compared fingerprints produce the visible changed-category list. Staleness is determined on read from recorded identity and dependencies, not by trusting a dirty flag. Unrelated source changes may conservatively mark every entry stale and identify `collection` as the changed category. Stale entries never refresh automatically.

Any accepted note set or clear purges every entry whose dependency manifest included that game's note and removes every retained excerpt or summary from that note. Permanent game deletion purges every entry whose dependency manifest includes the game, whether cited or only examined. Note mutation, permanent deletion, question disable, and delete-all cancel or invalidate affected in-flight attempts and advance a durable reflection-deletion generation in the same serialized application mutation boundary. Before cache persistence, every attempt must revalidate captured note versions, game existence, collection revision, question-enabled state, and deletion generation inside that boundary. A mismatch discards all derived content and cannot restore a deleted cache. Mutation success is not observable until purge, generation advance, and invalidation persist together. Entries not dependent on the changed note become stale through collection-revision mismatch.

Deleting all reflections removes cache content, invalidates active attempts, and advances the deletion generation, but preserves source collection data, notes, deterministic Profile data, provider configuration, and enabled-question settings. Disabling deletes one question's cache and fences its active attempt. Cache-load validation failure deletes the invalid artifact and reports `not-generated`, while logging a redacted validation outcome.

## Provider, Budget, And Failure Boundary

All reflection model work uses the same daemon-owned grounded-analysis integration as Collection Analyst Chat, built on `@earendil-works/pi-coding-agent` and `@earendil-works/pi-agent-core`. The operator configures one required provider ID and model ID with no implicit default. The session binds only operator-allowlisted provider extensions, resolves the model from the bound session registry, and rejects extra model-visible extension tools or hooks before supplying evidence.

The model receives the daemon-built bounded evidence package and one schema-backed reflection-submission tool. It receives no evidence-retrieval, shell, filesystem, general network, browser, operation-discovery, credential, collection-mutation, note-mutation, or configuration tool. Note text, imported prose, game names, provider output, and extension content are untrusted data and cannot override policy or authorize capabilities.

Shelf Judge sets no fixed token or monetary cap in the first release. Cost control instead comes from explicit owner initiation, one model operation and at most two provider inference round trips per question attempt, visible attempt and round-trip ceilings, fixed sequential order, bounded evidence pages and fields, model context limits, no automatic retries after provider acceptance, and no silent provider or model fallback. Provider-reported input/output/cache usage and monetary cost are retained and shown exactly when available; missing data is labeled unavailable and never estimated.

Cancellation and disconnect immediately propagate an abort signal through route, evidence retrieval, pi-agent, and provider. No reconnect or replacement transport attaches to the attempt. Cancellation prevents later questions in the same batch from starting and does not replace prior cache entries. The disclosure states that already transmitted content may have been processed and may have incurred cost.

Unavailable reasons are `evidence-load`, `model-configuration`, `extension-binding`, `authentication`, `provider-refusal`, `rate-limit`, `provider-outage`, `context-exhaustion`, `output-validation`, `persistence`, `transport`, and `internal`. Abstention reasons are `no-owner-testimony`, `insufficient-independent-testimony`, `no-supported-pattern`, `no-material-synthesis`, `conflicting-evidence`, `incomplete-scope`, and `question-not-applicable`. Clients preserve these categories and may add safe retry guidance without converting failure or abstention into an answer.

Routine logs record model-service attempts and outcomes with batch and attempt IDs, trigger, question ID/version, provider/model identifiers, evidence-class counts, evidence identity, timing, cancellation, provider-reported usage, validation outcome, cache transition, and error category. Logs omit note text, generated prose, prompts, raw evidence, citation summaries, provider payloads, credentials, and disclosure acknowledgements that contain owner data.

## Requirements

1. **REQ-REFLECT-1:** The first release must provide exactly the three versioned Initial Questions, each with the stated user job, required evidence, useful-answer test, abstention rule, and independent outcome.
2. **REQ-REFLECT-2:** An answered reflection must add a repeated criterion, material pattern qualification, or recurring trade-off beyond deterministic Profile cards; paraphrased cards, arithmetic, note concatenation, and generic statistics must abstain as `no-material-synthesis`.
3. **REQ-REFLECT-3:** No question may be required to produce a surprise, exception, tension, blind spot, negative finding, or answer; honest independent abstention is successful behavior.
4. **REQ-REFLECT-4:** Every attempt must use one immutable daemon-built evidence package restricted by the closed manifest, selected question policy, captured evidence identity, deterministic bounds, and server-selected destinations.
5. **REQ-REFLECT-5:** Every substantive answer block must cite current authorized evidence, including owner testimony and computed or imported evidence, while limitations may stand without citations; multi-game claims must cite every game needed to establish them.
6. **REQ-REFLECT-6:** Owner notes must remain labeled testimony and must never be treated as instructions, verified facts, ratings, structured roles, intentions, recommendations, or evidence of what missing or cleared notes mean.
7. **REQ-REFLECT-7:** Reflections must not infer causation, personality, stable preference, social context, urgency, future outcome, or buy, sell, keep, remove, play, or replay intent from notes or proxy evidence.
8. **REQ-REFLECT-8:** Required counterexample and confounder retrieval must complete before an answer; material conflicting testimony, vetoes, predictions, incomplete metadata, sparse notes, dispersion, co-occurrence, collaborator teams, exclusions, and scope limitations must be disclosed beside the affected synthesis.
9. **REQ-REFLECT-9:** An answer must state its evaluated note and game scope and may claim exhaustive testimony only after every page in the fixed current snapshot is examined; insufficient required coverage must abstain as `incomplete-scope`.
10. **REQ-REFLECT-10:** The daemon must reject malformed structured output, unknown or unauthorized citations, version mismatches, missing source classes, incomplete required retrieval, arbitrary destinations, unsupported fields, and instructions or mutations before presenting or caching an answer.
11. **REQ-REFLECT-11:** Structural validation must not be represented as proof of semantic entailment or usefulness; both properties must pass the versioned release evaluation corpus.
12. **REQ-REFLECT-12:** Ordinary Profile, Collection, game, note, import, refresh, scoring, and background operations must make no reflection model call, and reflection unavailability must not degrade deterministic Profile behavior.
13. **REQ-REFLECT-13:** Model work must begin only through an explicitly acknowledged owner refresh for the exact provider/model pair; no load, source change, timer, daemon start, cache miss, or background event may generate or refresh a reflection.
14. **REQ-REFLECT-14:** Web and CLI disclosure before transmission must identify provider, model, transmitted evidence classes including relevant notes, local retention, provider policy boundary, lack of fixed application token or monetary caps, model-operation and provider-round-trip ceilings, and cancellation.
15. **REQ-REFLECT-15:** All three questions must begin enabled, support independent enable and disable, and disabling must cancel its active attempt and delete its cached result without changing source data.
16. **REQ-REFLECT-16:** Batch refresh must attempt enabled questions sequentially in fixed question order with one model operation and at most two disclosed provider inference round trips per question, stop later attempts on cancellation, and never automatically retry an accepted request or silently change provider or model.
17. **REQ-REFLECT-17:** Every answered or abstained cache entry must record a complete evidence identity, text-free dependency manifest for every examined source, structured result, inspectable safe citation snapshots, generation time, and exact provider-reported usage when available, while excluding prompts, reasoning, raw events, credentials, and unnecessary note text.
18. **REQ-REFLECT-18:** Non-note source, revision, contract, algorithm, manifest, question, provider, or model changes must make dependent cached results visibly stale on read without automatic refresh or presentation as current.
19. **REQ-REFLECT-19:** Stale non-note results may remain available only behind an explicit stale disclosure that names changed source categories and resolves citations to captured evidence rather than current evidence.
20. **REQ-REFLECT-20:** Any accepted note set or clear must purge every cache entry and retained snapshot whose dependency manifest includes that note before success is observable; permanent game deletion must do the same for every entry that examined the game, and mutation, disable, or delete operations must fence in-flight late writes through version and deletion-generation revalidation.
21. **REQ-REFLECT-21:** Cancelled, unavailable, invalid, or persistence-failed attempts must preserve the prior cache entry unless an independent note mutation or game deletion requires its purge, and must report a distinct attempt outcome; they must never masquerade as answered, abstained, empty, or current.
22. **REQ-REFLECT-22:** The owner must be able to confirm deletion of all reflection output and disable individual questions; deletion must not alter notes, collection source data, deterministic Profile data, provider configuration, or unrelated settings.
23. **REQ-REFLECT-23:** All provider access must use one daemon-owned pi-agent grounded-analysis boundary shared with Collection Analyst Chat, with required explicit provider/model configuration, bound-session model resolution, operator-allowlisted extensions, capability inspection, and no model-visible evidence-retrieval, mutation, or general system tools; implementation requires an approved architecture supersession of the current Claude-Agent-SDK-only rule.
24. **REQ-REFLECT-24:** Authentication and availability must be resolved by the selected bound provider session rather than one environment-variable preflight, and every abstention and unavailable reason must preserve the shared categorized contract across daemon, web, and CLI.
25. **REQ-REFLECT-25:** Cost controls must consist of explicit initiation, visible model-operation and provider-round-trip ceilings, bounded locally assembled evidence, sequential attempts, context limits, no automatic charged retry beyond the two-round-trip attempt contract, no fallback, exact provider usage reporting when available, and honest unavailable reporting rather than estimates.
26. **REQ-REFLECT-26:** Explicit cancellation and disconnect must abort evidence and provider work, prevent later batch attempts, permit no reconnect or replacement transport, disclose possible prior processing and cost, and preserve protected source data and prior cache entries.
27. **REQ-REFLECT-27:** Logs must record each model-boundary attempt and outcome with correlation, trigger, question, provider/model, evidence counts and identity, timing, usage, validation, cancellation, cache transition, and error category while omitting owner, note, answer, prompt, evidence, citation-summary, provider-payload, and credential text.
28. **REQ-REFLECT-28:** Web must present Optional reflections as a nested subsection after deterministic identity evidence within the Profile's existing first top-level question, preserve all defined states and per-question controls, show adjacent inspectable citations and testimony labels, create no third top-level Profile section, and never block or replace deterministic content.
29. **REQ-REFLECT-29:** CLI must provide the defined read, refresh, cancel, enable, disable, and delete behavior with human and validated JSON or NDJSON output, explicit noninteractive disclosure acknowledgement, and structured nonzero failures.
30. **REQ-REFLECT-30:** Web and CLI must consume the same shared runtime schemas and daemon outcomes; neither client may assemble evidence, call a provider, validate citations, infer staleness, or reinterpret result categories independently.
31. **REQ-REFLECT-31:** Reflection controls, states, progress, disclosure, citations, stale content, and deletion must satisfy the keyboard, focus, announcement, non-color, and reduced-motion accessibility behavior in this specification.
32. **REQ-REFLECT-32:** Reflection content and controls must fit without horizontal overflow at the required mobile, tablet, desktop, and zoom viewports, with wrapping evidence, stacked actions, minimum touch targets, and no hover-only access.
33. **REQ-REFLECT-33:** Reflection implementation planning must depend on the approved owner-note read and mutation contract for note-backed evidence and purge hooks, and must define one shared grounded-analysis infrastructure dependency with Collection Analyst Chat without blocking specification work on either feature.

## Technical Contract

### Question And Result Shapes

Shared strict runtime schemas own contracts equivalent to:

```ts
type ReflectionQuestionId = "repeated-values" | "pattern-exceptions" | "recurring-trade-offs";

type EvidenceCategory =
  | "note"
  | "scoring"
  | "ownership"
  | "play"
  | "acquisition"
  | "metadata"
  | "shelf"
  | "profile"
  | "question-policy"
  | "provider-configuration"
  | "collection";

type ReflectionDeterministicEvidenceClass =
  | "game-identity-ownership"
  | "current-scoring"
  | "imported-metadata"
  | "play-acquisition"
  | "collection-structure"
  | "profile-evidence";

type ReflectionEvidenceIdentity = {
  manifestVersion: number;
  questionId: ReflectionQuestionId;
  questionVersion: number;
  collectionId: string;
  collectionSchemaVersion: number;
  collectionRevision: number;
  profileContractVersion: number;
  profileAlgorithmVersion: number;
  providerId: string;
  modelId: string;
};

type ReflectionDependency =
  | {
      category: "note";
      gameId: string;
      noteVersion: number;
    }
  | {
      category: Exclude<EvidenceCategory, "note">;
      sourceId: string;
      fingerprint: string;
      observedAt?: string;
    };

type ReflectionCitationBase = {
  citationId: string;
  sourceId: string;
  sourceVersion: string;
  observedAt?: string;
  canonicalSummary: string;
  destination: {
    operationId: string;
    parameters: Record<string, string>;
  };
};

type ReflectionCitation = ReflectionCitationBase &
  (
    | {
        evidenceClass: "owner-game-note";
        testimony: true;
      }
    | {
        evidenceClass: ReflectionDeterministicEvidenceClass;
        testimony: false;
      }
  );

type ReflectionScope = {
  examinedPresentNoteCount: number;
  totalPresentNoteCount: number;
  examinedGameCount: number;
  relevantEligibleGameCount: number;
  excludedGameCount: number;
  exhaustiveNotes: boolean;
  patternCandidateIds?: string[];
};

type GroundedProviderUsage = {
  state: "reported";
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  monetaryCost?: {
    amount: string; // Provider-reported decimal; never application-estimated.
    currency: string; // ISO 4217 code supplied or mapped from provider metadata.
  };
  inferenceRoundTrips: number; // Positive safe integer in the shared contract.
};

type ReflectionProviderUsage = GroundedProviderUsage & {
  inferenceRoundTrips: 1 | 2;
};

type ReflectionBlock = {
  text: string;
  citationIds: string[];
  uncertainty?: string;
};

type ReflectionCompletedBase = {
  supportingBlocks: ReflectionBlock[];
  citations: ReflectionCitation[];
  scope: ReflectionScope;
  evidenceIdentity: ReflectionEvidenceIdentity;
  dependencies: ReflectionDependency[];
  generatedAt: string;
  usage: ReflectionProviderUsage | { state: "unavailable" };
};

type ReflectionCompleted = ReflectionCompletedBase &
  (
    | {
        outcome: "answered";
        centralSynthesis: ReflectionBlock;
      }
    | {
        outcome: "abstained";
        reason:
          | "no-owner-testimony"
          | "insufficient-independent-testimony"
          | "no-supported-pattern"
          | "no-material-synthesis"
          | "conflicting-evidence"
          | "incomplete-scope"
          | "question-not-applicable";
        explanation: string;
      }
  );

type ReflectionCacheState =
  | { state: "none" }
  | {
      state: "current";
      result: ReflectionCompleted;
    }
  | {
      state: "stale";
      changedCategories: EvidenceCategory[];
      result: ReflectionCompleted;
    };

type ReflectionAttemptState =
  | { state: "idle" }
  | { state: "refreshing"; batchId: string; startedAt: string }
  | { state: "cancelled"; occurredAt: string }
  | {
      state: "unavailable";
      reason: ReflectionUnavailableReason;
      safeDetail?: string;
      occurredAt: string;
    }
  | {
      state: "purged";
      reason: "note-changed" | "game-deleted" | "owner-deleted";
      occurredAt: string;
    };

type ReflectionQuestionState = {
  questionId: ReflectionQuestionId;
  enabled: boolean;
  cache: ReflectionCacheState;
  attempt: ReflectionAttemptState;
};
```

The answered variant requires one central synthesis and one to three supporting blocks. The abstained variant forbids a synthesis, requires a reason and safe explanation, and may contain zero to three cited supporting blocks that explain the limit. `ReflectionUnavailableReason` is the exact unavailable union in Provider, Budget, And Failure Boundary. Runtime schemas reject unknown fields, duplicate citation or dependency identities, negative or unsafe counts, inconsistent scope totals, non-ISO currency codes, non-decimal cost strings, and variant-invalid fields. Citation destinations resolve through allowlisted operation IDs and validated parameters rather than arbitrary URLs.

The daemon response contains every `ReflectionQuestionState`, including disabled questions for settings management. Web cards omit disabled questions but settings and CLI reads expose them. Cache state persists. Terminal attempt metadata persists as defined in Visible Behavior. The active `refreshing` state is process-owned; restart converts it to `unavailable/internal` with `daemon-restarted`. A successful result atomically updates cache and resets attempt to `idle`; cancellation or failure updates only attempt; purge sets cache to `none` and attempt to `purged`.

Question definitions and manifest versions are serialized constants in shared code. Prompt text may evolve only with a prompt version recorded for diagnostics; any change that alters question meaning, authorized evidence, minimum support, useful-answer criteria, or output semantics requires the corresponding question or contract version change and invalidates prior current status.

### Operations

Operation discovery exposes stable operations equivalent to:

| Operation                                   | Purpose                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `shelf.profile.reflections.get`             | Read settings, configuration status, and current/stale/cached question states without model access                         |
| `shelf.profile.reflections.settings.update` | Enable or disable one known question and enforce deletion/cancellation behavior                                            |
| `shelf.profile.reflections.refresh.stream`  | Acknowledge disclosure, snapshot evidence, and refresh one question or all enabled questions as typed SSE or NDJSON events |
| `shelf.profile.reflections.cancel`          | Abort the exact active batch using its unguessable capability and batch ID                                                 |
| `shelf.profile.reflections.delete`          | Confirm and delete every cached reflection result                                                                          |

Refresh uses a client-generated batch ID, request ID, and at least 256-bit random cancellation capability. At most one batch may run at a time. Duplicate transport attachment, changed request-ID reuse, guessed cancellation, or concurrent refresh fails without another model operation or provider inference round trip. Exact HTTP paths belong in implementation design.

Typed events cover acceptance, question start, evidence retrieval, model status, validated result, provider usage, cache outcome, question completion, cancellation, and failure. Clients never receive raw model tokens, reasoning, prompts, tool arguments, raw evidence, credentials, or provider events.

### Structured pi-agent Submission

The pi-agent session receives the complete bounded package and completes each question through a schema-backed submission tool. The daemon captures validated arguments, resolves citation IDs against the immutable attempt registry, applies structural and question-policy validation, and reaches terminal completion within at most two provider inference round trips. Free-form final text, malformed tool calls, unknown tools, ambiguous termination, round-trip exhaustion, or context exhaustion cannot be parsed or guessed into a completed reflection.

### Dependencies

Specification work is complete against the approved Owner Game Notes contract. Implementation of note retrieval, citation identity, cache purge, and privacy tests depends on the implemented owner-note capability, including current game ID plus note-version identity and mutation/deletion hooks. Planning must reconcile any implementation-level changes to the final note projection without broadening note exposure.

Reflection and Collection Analyst Chat must share the pi-agent session factory, provider configuration, extension allowlist and capability inspection, evidence manifest primitives, citation registry, structured submission, categorized failures, redacted model-boundary logging, and adversarial evaluation harness. Feature-specific question policy, preassembled evidence packages, durable reflection cache, staleness, and purge behavior remain reflection-owned.

The current `.lore/reference/architecture-pattern.md` mandates `@anthropic-ai/claude-agent-sdk` and conflicts with this specification's pi-agent boundary. Neither this draft nor the draft Analyst specification silently supersedes that current reference. Before a shared grounded-analysis implementation task can be approved or started, the owner must approve the provider-architecture change and the planning work must update or supersede that reference with one authoritative pi-agent decision. Owner rejection requires revising both reflection and Analyst provider contracts before implementation; it must not produce two provider stacks.

## Out Of Scope

- Free-form questions or conversation; Collection Analyst Chat owns that surface
- Automatic narration, background generation, proactive messages, notifications, or mandatory insights
- More than the three initial questions or owner-authored question templates
- Advice to buy, sell, keep, remove, play, replay, rate, rerate, or change axes
- Model-driven collection, note, intention, ownership, shelf, score, metadata, or configuration mutations
- Treating note text as structured roles, tags, preferences, factual corrections, or prompt instructions
- External browsing, live BGG lookup during reflection, embeddings, cross-owner comparisons, or provider training claims
- Durable prompt, reasoning, raw provider event, or full provider-payload storage
- Provider credential management, billing prediction, automatic model routing, or application-level spending limits
- Secure erasure guarantees for provider systems, process memory, filesystem history, backups, screenshots, or terminal scrollback

## AI Validation

### Evaluation Corpus And Rubric

The release corpus contains at least 20 independently authored fixtures per question: at least 12 answerable fixtures and at least 8 abstention fixtures. Across each question's abstention fixtures, every applicable abstention reason appears at least once; across the complete corpus, every reason appears at least twice. At least one third of answerable fixtures contain a material counterexample or confounder, one third contain sparse or incomplete adjacent evidence that does not defeat the answer, and one third contain plausible paraphrase traps. Fixture authors record expected evidence scope, required and prohibited claims, material counterexamples, expected outcome, and rationale before generation.

Reviewers see randomized paired outputs labeled A and B, one generated reflection and one deterministic-card-plus-note baseline, without provider, prompt, implementation, expected outcome, or label identity. Each fixture receives two independent reviews. A third reviewer adjudicates any dimension score differing by more than one point, any answered-versus-abstain disagreement, and any disagreement that changes a release threshold. The adjudicated score replaces neither original silently; all three and the stated resolution remain in the evaluation record.

Each dimension uses this `0` through `3` rubric:

| Score | Grounding                                                                                   | Scope honesty                                                                               | Citation inspectability                                                       | Additional usefulness                                                              |
| ----- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `0`   | One or more material claims are unsupported or contradict source evidence.                  | The answer hides or invents scope, certainty, or source meaning.                            | A material claim cannot be traced to supporting canonical evidence.           | The output misleads, distracts, or is less useful than the baseline.               |
| `1`   | The core may be plausible, but a material claim needs correction or stronger evidence.      | A material limitation, counterexample, or testimony distinction is missing.                 | Citations exist but a material claim is remote, ambiguous, or non-entailing.  | The output mostly paraphrases the baseline or adds only generic framing.           |
| `2`   | Every material claim is supported; only non-material wording improvements remain.           | Scope, uncertainty, counterexamples, and source meanings are sufficient for the conclusion. | Every material claim resolves to understandable, relevant canonical evidence. | The output adds one concrete owner-recognizable synthesis beyond the baseline.     |
| `3`   | Support is precise, complete for stated scope, and uses no stronger language than evidence. | Boundaries and confounders sharpen understanding without obscuring the answer.              | Citations make the complete reasoning path unusually easy to audit.           | The output adds a concise, specific synthesis the baseline does not make apparent. |

An unsupported critical claim is any unsupported statement that changes the central synthesis, attributes preference or intent, recommends an owner action, contradicts testimony, omits a material counterexample, claims complete scope falsely, or exposes unauthorized private data. One such claim fails release regardless of aggregate scores. “Acceptable or better” means an adjudicated score of at least `2`. The 70% usefulness threshold counts answerable fixtures where the reflection's adjudicated additional-usefulness score exceeds its paired baseline score; ties do not count.

1. Build a versioned corpus for all three questions with realistic `answered` and every abstention reason. Include copied notes, single-note claims, semantically empty notes, missing and cleared notes, contradictory testimony, stale metadata, vetoes, predicted values, broad dispersion, co-occurring mechanics, collaborator teams, and incomplete retrieval.
2. For every initial question, verify the corpus records the user job, required evidence, useful-answer test, abstention rule, and representative expected output. Reject any implementation that accepts a question based on wording alone or applies one question's support rule to another.
3. Compare each candidate reflection under the corpus's randomized paired blinding protocol against the same evidence shown as deterministic Profile cards and canonical note excerpts. Apply the complete rubric, preserve both independent reviews and adjudication, and reveal labels only after scores are locked.
4. Require zero unsupported critical claims, privacy leaks, unauthorized evidence fields, unreported material counterexamples, or capability-isolation failures. Require at least 90% of answerable cases overall and at least 80% for each individual question to score acceptable or better for grounding, scope honesty, and citation inspectability. Require reflections to score higher than card-only evidence for additional usefulness in at least 70% overall and at least 60% for each question.
5. Reject a candidate as paraphrase when a reviewer can derive its complete central synthesis by copying one deterministic card, listing its values, concatenating notes, or replacing game names in a generic template. Record `no-material-synthesis` as the expected outcome for those fixtures.
6. Resolve every substantive sentence to adjacent citations and canonical sources. Inject absent, invented, stale, wrong-game, wrong-note-version, cross-attempt, unauthorized, and structurally valid but irrelevant citations. Runtime tests must reject identity and structure defects; corpus review must reject non-entailing or misleading citations.
7. Recompute every cited deterministic value through current source functions with exact ordering and unrounded arithmetic. Reject copied display rounding that changes order, invented aggregates, hidden exclusions, or claims stronger than current Profile semantics.
8. Enumerate every field in captured synthetic provider payloads against the exact manifest and question policy. Verify selective note retrieval, deterministic bounds, complete required pagination, server-owned destinations, and absence of broad game objects, receipts, deleted text, credentials, logs, caches, backups, unrelated questions, and wishlist data.
9. Place prompt injection, fake system messages, tool syntax, URLs, HTML, Markdown, shell commands, credential requests, and mutation requests in notes, imported prose, and game names. Verify they remain inert testimony or imported data and cannot alter tools, policy, retrieval, citations, output schema, or application state.
10. Instrument the real pi-agent lifecycle. Verify allowlisted extensions bind before bound-registry model resolution, added extension tools or hooks make the attempt unavailable before transmission, only the approved reflection-submission tool remains model-visible, and free-form final text never becomes a reflection.
11. Exercise absent or changed configuration, unknown provider/model, missing extension, authentication failure, refusal, rate limit, outage, context exhaustion, malformed submission, citation failure, persistence failure, transport loss, and internal failure. Verify exact categorized parity across stream, web, and CLI with no fallback, automatic retry, credential disclosure, or source mutation.
12. Load the deterministic Profile, all profile drilldowns, Collection, game detail, notes, CLI profile, and daemon at rest with model-boundary instrumentation. Verify zero reflection calls. Make model configuration and network unavailable and verify every deterministic surface remains useful.
13. Refresh one question and all enabled questions. Verify exact model-operation and provider-inference-round-trip counts never exceed the disclosed ceilings, fixed sequential order, per-batch disclosure, provider/model race rejection, independent outcomes, no demand that every question answer, and no automatic retry. Cancel before transmission, during retrieval, during provider work, and between questions; verify abort propagation and no later attempt.
14. Change score, ownership, play, metadata, shelf, Profile policy, contract, algorithm, manifest, question version, provider, and model after a completed result. Verify deterministic stale detection, collapsed stale presentation, changed-category explanation, captured citation resolution, and no automatic refresh.
15. Set, edit, and clear every examined note and permanently delete a cited or uncited examined game while cache reads and in-flight completions race the mutation. Verify dependency-based purge, version and deletion-generation fences, inaccessible cached prose and snapshots before success is observable, unaffected entries becoming stale as specified, failure preserving the last valid source/cache pairing, and no superseded note text returning through a late write.
16. Disable and re-enable each question, delete all reflections during an active batch, restart during refresh, corrupt the cache, and simulate interrupted atomic persistence. Verify the complete cache-plus-attempt state transitions, late-write fencing, `not-generated`, terminal metadata persistence, `daemon-restarted`, prior-result preservation, validation cleanup, settings preservation, and source-data independence exactly match the contract.
17. Capture successful, abstained, cancelled, unavailable, validation-failed, and cache-purged logs. Verify attempt and state transitions are reconstructable from correlation, provider/model, evidence counts and identity, timing, usage, validation, and outcome without note, generated, prompt, evidence, citation, payload, or credential text.
18. Exercise every CLI command in human and JSON or NDJSON modes, including missing acknowledgement, unknown question, concurrent batch, cancellation, unavailable provider, stale output, purge, and structured failure. Validate every request, event, and response at process boundaries.
19. Exercise web current, stale, refreshing, abstained, cancelled, unavailable, purged, disable, delete, disclosure, citation, and retry behavior with keyboard-only and screen-reader-oriented checks. Verify focus recovery, restrained announcements, testimony labels, non-color states, and reduced motion.
20. Run current Chromium at `375x812`, `768x1024`, and `1440x900` CSS pixels and at 200% desktop zoom. Verify no horizontal overflow, clipped citations, hidden stale warning, hover-only evidence, undersized target, mobile input zoom, or unreachable cancellation.
21. Run repository typecheck, lint, changed-file formatting, all automated tests, production build, and browser suite. Distinguish accepted repository-wide baseline failures from feature-introduced failures.
22. Ask a fresh reviewer to explain why each question is useful, when it abstains, how testimony differs from computed evidence, what changes make output stale versus purged, when data leaves the machine, how cost is bounded, and why ordinary Profile reads remain useful without a model. Treat any ambiguous answer as a specification defect.

## Decisions Requiring Owner Approval Before Implementation

1. The first release uses the three Initial Questions and enables all three by default.
2. Non-note source changes retain collapsed stale output for inspectability; note changes purge dependent output to honor the no-prior-note-text contract.
3. Reflection and analyst features share one pi-agent boundary with explicit provider/model configuration and no implicit default.
4. Shelf Judge applies no fixed token or monetary cap; explicit per-question requests, bounded evidence, no retries, and usage disclosure are the application cost controls.

Changing one of these choices requires updating examples, requirements, technical contracts, and evaluation fixtures together before approval.
