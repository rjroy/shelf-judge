---
title: Typesafe all-games reflection ranking
date: 2026-09-18
status: draft
tags: [reflection, typesafe, system-one, evidence-ranking, grounded-analysis]
modules: [profile-reflections, grounded-analysis, reflection-evidence]
related: []
---

# Typesafe all-games reflection ranking

## Decision

Adopt a **bounded, versioned reflection-rubric and cross-game catalog**. Pi first converts a user question into a constrained `ScoringPlan` that selects and weights only catalog-defined, question-policy-authorized rubric dimensions and catalog records. TypeSafe System One then evaluates **every eligible game in the captured projection** in bounded batches against code-supplied subjects, facets, tensions, and candidates. Deterministic code aggregates those typed judgments into ranked cross-game groups, preserves required support and counterevidence coverage, diversifies a bounded evidence pack, and gives Pi only those typed groups, their pack evidence, and controlled selected-game inspection tools for final synthesis.

The initial implementation should use a small, fixed Score catalog and an optional Noul relevance gate. A scoring plan is data, not executable prompts. Its version, rubric IDs, weights, thresholds, and snapshot identity are validated by code. `Choice` is reserved for a genuinely closed selection such as a plan mode or a bounded contradiction disposition, not for grading every game.

This is an inversion of the current Pi-led evidence retrieval, not a replacement for it. System One is not an LLM replacement: it provides focused, typed semantic judgments; Pi still interprets the request and writes the cited answer. Deterministic code retains authority for evidence authorization, policy enforcement, cross-game candidate construction and aggregation, ranking, selection, citation assembly, cache publication, and abstention.

## Why this fits the current architecture

The current reflection contract already has the boundaries needed for this design:

- `packages/shared/src/profile-reflections.ts` defines the three default questions, versions, evidence classes, per-question authorization, abstention reasons, scope, citations, dependencies, and cache identity. In particular, pattern exceptions require the complete deterministic candidate set; recurring trade-offs require independent present-note testimony from at least two games; repeated values permits zero notes but must distinguish personal evaluations from indirect computed signals.
- `packages/daemon/src/services/reflection-evidence-projections.ts` captures a frozen collection/profile/displayed-fitness snapshot, produces per-game identity, scoring, metadata, play/acquisition, and structure sources, computes a `snapshotFingerprint`, and records deterministic pattern candidates. Its `page()` contract already demonstrates snapshot-bound paging.
- `packages/daemon/src/services/reflection-refresh-service.ts` owns refresh admission, disclosure acknowledgement, one active batch, evidence revalidation before publication, structured submission validation, cache state transitions, cancellation, and safe failure mapping.
- `packages/daemon/src/services/grounded-analysis/collection-tools.ts` constrains Pi to ranked retrieval, search, selected-game reads (at most ten IDs per call), and deterministic summaries. The final stage can retain these bounded tool semantics while limiting `readGames` to pack IDs and preserving field authorization.

## Topology

```text
owner question + question policy + captured projection snapshot
                         |
                         v
       Pi plan compiler (no collection-note bodies by default)
                         |
             validated ScoringPlan vN (catalog only)
                         |
                         v
  eligible game records, complete deterministic candidate ledger
                         |
  batches of bounded per-game state via a future, contract-approved multi-provider operation
                         |
       Noul relevance? + stable catalog Scores (parallel)
                         |
                         v
 deterministic typed-group aggregate, eligibility, contradiction and diversity
                         |
                   bounded EvidencePack
                         |
                         v
 Pi grounded synthesizer -> ranked typed groups + pack citations + pack-only readGames -> validator
                         |
                         v
        existing revalidation, cache publication, stream events
```

No model crosses an authorization boundary. Pi cannot authorize a new evidence class, add a scoring instruction, invent a subject, facet, tension, candidate, or relation, alter an answer policy, or expand the selected pack. The System One implementation receives only code-built question definitions and code-projected state through a future contract-approved operation. It never receives a Pi-authored instruction as authoritative scoring behavior. Under the current Reflection contract, this topology is prohibited; the diagram describes the post-migration design, not a currently permitted adapter implementation.

## Variants considered

| Variant | Benefits | Material failure | Decision |
| --- | --- | --- | --- |
| Pi creates freeform per-request TypeSafe criteria and prompts | Very expressive, little upfront catalog work | An unbounded LLM-generated instruction becomes the actual classifier policy. It is hard to version, test, compare, audit, cache, or defend against prompt injection and semantic drift. Weights and criteria cannot be safely interpreted as stable data. | Reject. |
| Pi selects a constrained rubric DSL/catalog | Stable question meanings, narrow validation surface, replayable judgments, deterministic aggregation, offline evaluation, safe caching | Less expressive until the catalog grows; plan compiler needs a no-fit outcome | Choose. |
| No Pi plan, fixed rubric set per default question | Simplest operationally | Misses useful query-specific emphasis and makes the inversion merely a fixed reranker | Keep as a fallback and shadow baseline, not the primary design. |

The safety rationale is structural: TypeSafe instructions and criteria define the System One judgment. Letting an upstream generative model write them turns generated prose into executable behavioral authority. JSON schema validation cannot establish that a novel instruction is policy-safe or semantically comparable. Therefore only shipped catalog entries, identified by immutable ID and version, can enter a request.

## Data contracts

The following contracts are conceptual additions. They should use strict schemas and canonical serialization, analogous to existing reflection schemas.

### `ScoringPlan`

```ts
type ScoringPlan = {
  planContractVersion: 1;
  planId: string;
  questionId: ReflectionQuestionId;
  questionVersion: number;
  snapshotFingerprint: string;
  rubricCatalogVersion: number;
  mode: "repeated-values" | "pattern-exceptions" | "recurring-trade-offs";
  relevanceGate: { rubricId: "eligible-relevance"; minYesProbability: number } | null;
  dimensions: readonly {
    rubricId: string;       // catalog member authorized for questionId
    rubricVersion: number;  // exact catalog definition
    weight: number;         // finite, non-negative; normalized by code
  }[];
  crossGameSubjects: readonly {
    kind: "quality-facet" | "trade-off" | "pattern-candidate";
    id: string;             // exact policy-approved catalog/candidate ID
    version: number;        // catalog version, or projection candidate-ledger version
  }[];
  selection: {
    targetPackSize: number; // configured bounded default, for example 25, not universal
    minIndependentGames: number;
    preserveCompleteCandidateLedger: boolean;
  };
};
```

Pi may return a user-facing explanation and this schema-shaped proposal, but the server must: derive `questionId`, question version, snapshot fingerprint, policy flags, and allowable mode; reject unknown/duplicate rubrics or subjects; cap the dimension/subject count; normalize weights; clamp policy-owned thresholds; and persist the canonical resulting plan. It may choose only from policy-approved facet/trade-off records and projection-supplied pattern candidates included in the supplied manifest, never create an ID or alter its members. The server may instead require all authorized subjects for a default question when completeness policy requires it. `planId` is a hash of canonical plan data, not a model-generated identity.

The plan compiler gets the user question, the selected reflection question definition and policy, and a catalog manifest. It does **not** need owner notes or unbounded all-game data to choose among stable meanings. If it cannot express the request with the catalog, it returns `no-supported-plan`; the refresh uses the question's baseline plan or reports an unavailable/abstained outcome according to the product decision below.

### Rubric catalog

Each catalog entry is code-owned and versioned:

```ts
type ReflectionRubric = {
  id: string;
  version: number;
  applicableQuestions: readonly ReflectionQuestionId[];
  primitive: "noul" | "score";
  stateFields: readonly AuthorizedGameField[];
  instructions: string | Record<string, unknown>;
  criteria: unknown; // Noul true/false or ordered Score levels
  role: "relevance" | "support" | "exception" | "trade-off-testimony" | "contradiction";
};
```

Initial Score dimensions should be small and question-specific, rather than a generic personality profile:

- **Repeated values:** strength of evidence that this game exemplifies a recurring evaluated quality; quality of direct personal-rating support; strength of qualifying/mixed evidence. Computed fitness, Elo, and predictions remain indirect signals by rubric instruction.
- **Pattern exceptions:** strength of note-backed qualification of the supplied deterministic association; materiality of the exception; strength of competing/confounding explanation. These dimensions operate only after the complete candidate ledger is captured.
- **Recurring trade-offs:** strength that the *same present note* expresses both a positive and limiting side; cross-game recurrence support; material contradiction. The first dimension must reject proxy evidence and split-sided testimony.

All Score criteria are ordered descriptions of observable evidence situations, never labels such as “low/medium/high.” Score returns an ordered-level position, level probabilities, and confidence. Normalize a Score by its maximum level before applying code-owned weights. Noul returns only the estimated probability that the yes condition holds; a probability near 0.5 is ambiguity, not medium relevance or a confidence score. A `Choice` has a closed options set and should only be used where exactly one plan mode or disposition must be chosen, with a `none-of-the-above` option where applicable.

### Catalog-bounded cross-game subjects and relations

`GameJudgment` keyed only by `gameId` cannot establish a cross-game claim. Before any System One request, deterministic code constructs a complete, versioned `CrossGameCandidateLedger` from the captured projection and the selected question policy. It is the only source of cross-game subjects and relations. A model may judge a supplied relationship but cannot discover a new relationship or create a group.

```ts
type CrossGameSubject =
  | { kind: "quality-facet"; facetId: QualityFacetId; catalogVersion: number }
  | { kind: "trade-off"; tradeoffId: TradeoffId; catalogVersion: number }
  | { kind: "pattern-candidate"; candidateId: PatternCandidateId; candidateKind: "mechanic" | "designer" | "artist" };

type CandidateMembership = {
  subject: CrossGameSubject;
  gameId: string;
  relation: "member" | "comparator" | "support" | "qualifies" | "counterevidence";
  deterministicSourceId: string;
};

type CrossGameCandidate = {
  candidateId: string;
  subject: CrossGameSubject;
  members: readonly CandidateMembership[];
  requiredSupportCount: number;
  requiredCounterevidenceCoverage: boolean;
  aggregationRuleId: string;
};
```

The supplied catalog is finite and policy-approved for the default question:

- **Repeated values** uses `QualityFacetId` entries, such as the shipped evaluated-quality facets. Every eligible game is paired with every facet authorized by the selected plan, so a facet group has a complete eligible-game denominator. A game can support, qualify, or counter a facet, but cannot name a new quality.
- **Recurring trade-offs** uses `TradeoffId` entries that each define a paired positive/limiting tension. Every present-note game is paired with every authorized tension. A qualifying support requires the *same note* to support both sides of that exact paired ID; a one-sided note, a different tension, or a behavioral proxy is counterevidence or non-qualifying evidence, never an inferred trade-off.
- **Pattern exceptions** uses the projection's precomputed `PatternCandidateId` records in class/order. Their member, comparator, confounder, and exclusion memberships are deterministic. A game may appear in multiple candidate records, and is judged separately for each `(gameId, candidateId)` relation; aggregation must not collapse those memberships.

For each candidate, code emits a fixed set of relation-scoped questions from catalog rubrics, for example `supports`, `qualifies`, and `counterevidence`. The result is a typed judgment on `(gameId, subject, relation)`, not an arbitrary semantic explanation. The exact candidates, memberships, rubric IDs, and aggregation-rule IDs are retained in the ledger and in cache provenance.

### Deterministic candidate-group aggregation

After all required relation judgments reach terminal ledger states, code aggregates each candidate independently using its versioned `aggregationRuleId`. It computes support and counterevidence totals from the corresponding role-scoped judgment results, applies question-specific direct-note and completeness gates, and ranks only the resulting candidate groups. No model compares arbitrary selected games to infer a theme.

```ts
type RankedCandidateGroup = {
  candidateId: string;
  subject: CrossGameSubject;
  aggregationRuleId: string;
  memberGameIds: readonly string[];
  supportGameIds: readonly string[];
  counterevidenceGameIds: readonly string[];
  supportScore: number;
  counterevidenceScore: number;
  rank: number;
  qualification: "qualified" | "disqualified" | "incomplete";
  coverage: { expectedRelations: number; completedRelations: number };
  evidenceBindings: readonly GroupRoleEvidenceBinding[];
};
```

The repeated-values rule ranks a facet only after all eligible facet/game relations are complete and retains direct-rating support separately from indirect signals and qualifying/mixed counterevidence. The trade-off rule ranks a paired tension only after exhaustive present-note relations are complete, requires at least two distinct same-note qualifying support games, and treats material counterevidence as the existing abstention trigger. The pattern-exception rule ranks each precomputed candidate only after every candidate relation is complete, requires its existing note-backed exception gates, and retains candidate-specific comparators and confounders. Stable ties use candidate class/order, catalog ID, then normalized ID. These groups, rather than raw game scores, are the final-synthesis subject matter.

### Relation-to-evidence authorization and pack

Scores are not evidence. Before dispatch, code assigns every ledger relation a stable `relationInstanceId`, derived from the snapshot, plan, candidate, subject, game, relation, and required rubric versions. It also constructs its evidence authorization map from the projection and question policy. A relation can have zero authorized evidence only when its aggregation rule explicitly permits a non-testimonial negative or membership result. A `support`, `qualifies`, or `counterevidence` result that is eligible to influence a group must have at least one mapped authorized evidence identity; a qualifying trade-off must map the one exact note that carries both sides.

```ts
type AuthorizedEvidenceIdentity =
  | {
      kind: "owner-note";
      evidenceId: string; // canonical server identity, not a model-created ID
      noteId: string;
      gameId: string;
      contentVersion: number;
      bodyFingerprint: string;
      excerpt: { start: number; end: number; textFingerprint: string };
    }
  | {
      kind: "deterministic-source";
      evidenceId: string; // canonical identity for this exact captured source
      gameId: string | null;
      sourceKind: "rating" | "fitness" | "elo" | "prediction" | "metadata" | "play" | "acquisition" | "pattern-membership" | "candidate-comparator" | "candidate-confounder";
      deterministicSourceId: string;
      sourceVersion: number;
      sourceFingerprint: string;
    };

type RelationEvidenceBinding = {
  relationInstanceId: string;
  candidateId: string;
  subject: CrossGameSubject;
  gameId: string;
  relation: "support" | "qualifies" | "counterevidence" | "member" | "comparator";
  authorizedEvidence: readonly AuthorizedEvidenceIdentity[];
  citationIds: readonly string[]; // exact ReflectionCitation IDs resolving to authorizedEvidence
};

type GroupRoleEvidenceBinding = {
  candidateId: string;
  subject: CrossGameSubject;
  role: "support" | "qualification" | "counterevidence" | "member" | "comparator";
  relationInstanceIds: readonly string[];
  citationIds: readonly string[];
};
```

`evidenceId` is deterministic from the canonical captured source identity and its version/fingerprint. For an owner note, the cited excerpt must be a bounded range of the captured `contentVersion`, and its text fingerprint must match the exact range. For a deterministic source, `deterministicSourceId`, version, and fingerprint identify the precise projection record. The server creates `ReflectionCitation` records from these identities and rejects a binding unless each `citationId` resolves one-to-one to an identity in that binding. Thus `EvidencePack.citations` is an indexed citation table, not an unlinked list.

The binding key includes both `candidateId` and `subject`, so the same game may appear in multiple subjects or pattern candidates and has a distinct relation instance and evidence authorization for each. Code may reuse the same immutable evidence identity across bindings, but it may never merge relations merely because their `gameId` matches.

### Per-game judgment and pack

```ts
type GameJudgment = {
  snapshotFingerprint: string;
  planId: string;
  gameId: string;
  subject: CrossGameSubject;
  relation: "support" | "qualifies" | "counterevidence" | "member" | "comparator";
  candidateId: string;
  relationInstanceId: string;
  evidenceBinding: RelationEvidenceBinding;
  inputFingerprint: string;
  relevanceYesProbability: number | null;
  scores: readonly { rubricId: string; rubricVersion: number; score: number; confidence: number; probabilities: Record<string, number> }[];
  provider: { providerId: string; modelId: string };
};

type EvidencePack = {
  snapshotFingerprint: string;
  planId: string;
  packPolicyVersion: number;
  targetPackSize: number;
  selectedGameIds: readonly string[];
  selectedCandidateIds: readonly string[];
  rankedCandidateGroups: readonly RankedCandidateGroup[];
  reserveGameIds: readonly string[];
  selectionReasons: readonly PackSelectionReason[];
  coverage: ReflectionScope;
  groupCoverage: readonly { candidateId: string; supportCount: number; counterevidenceCount: number; complete: boolean }[];
  relationEvidenceBindings: readonly RelationEvidenceBinding[];
  citations: readonly ReflectionCitation[];
  dependencies: readonly ReflectionDependency[];
};
```

`GameJudgment` is diagnostic/replay data, not a citation and not testimony. Its binding is nevertheless mandatory provenance for any role that can affect qualification or rank. `EvidencePack` contains the complete relation-binding table, group-role bindings, citations, and exact dependencies projected by the server. Final Pi may cite only a `citationId` reachable from a selected group's `evidenceBindings` and the corresponding `relationEvidenceBindings`; it may not cite another pack citation merely because it is present. Validators must reject an answer when a selected group lacks its required support/qualification/counterevidence bindings, when a cited identity is not mapped to that group role, or when a note version, excerpt range/fingerprint, or deterministic source identity differs from the mapped identity. Final Pi output otherwise stays under the existing `ReflectionCompleted` and result-validator rules.

## Candidate coverage and batching

“All games” means all **policy-eligible owned games in the one captured projection**, not whichever games a model chose to inspect. Eligibility remains question-specific: the existing snapshot includes all owned games for repeated values and recurring trade-offs, while pattern exceptions operates over the deterministic pattern-game/candidate projection. Previously owned games retain current exclusion behavior unless policy changes deliberately.

1. Capture one immutable `ReflectionProjectionSnapshot`; enumerate and sort eligible game IDs and construct the complete `CrossGameCandidateLedger`: authorized facet/game relations for repeated values, paired-tension/present-note relations for trade-offs, and the exact `patternCandidateIds` with all deterministic memberships in documented class/order for exceptions.
2. Create a coverage and evidence ledger before System One work: expected `(gameId, candidateId, subject, relation, rubricId)` entries, their `relationInstanceId`, immutable `RelationEvidenceBinding`, dispatched/completed/failed states, and input fingerprints. Do not aggregate a candidate or select a pack until every relation required by its aggregation rule has a terminal ledger entry and every role that affects it has a valid evidence binding.
3. Partition stable ordered relation entries into byte- and item-bounded batches. Each state contains only the game, its supplied subject/relation, authorized projected fields, binding identities, and plan metadata. They may run concurrently only under the post-migration composite operation's configured batch/request/call, concurrency, and cost ceilings. A retry retains the same state, binding, and question definitions.
4. Send the relevance Noul and independent role-scoped Score questions together for each relation. Do not batch multiple relations into an inseparable text blob if individual results, retries, and cache keys are needed.
5. A TypeSafe timeout, malformed response, or partial batch marks affected IDs failed. For policies requiring complete coverage, this yields `incomplete-scope`, not a silently narrowed answer. For best-effort questions only after explicit policy approval, retain the known coverage counts and do not call it exhaustive.

For pattern exceptions, complete candidate coverage is non-negotiable: every `overviewEntityIds` candidate and its deterministic comparator/support/dispersion/exclusions/confounders ledger must be available before aggregation. The bounded pack can prioritize detailed game records, but it cannot omit a ranked group's candidate ledger or required counterevidence from final Pi context. For trade-offs, every present note must be examined enough to calculate `examinedPresentNoteCount`, `totalPresentNoteCount`, and `exhaustiveNotes`; a top-25 pack must never be represented as exhaustive note coverage. A pack must include at least two independently qualifying same-note games for a specific paired `tradeoffId` before an answered trade-off is possible.

## Deterministic ranking, diversity, and contradiction handling

Code computes a normalized composite only after applying policy gates:

1. **Hard gates:** authorized ownership/evidence classes; complete required ledger; relevance Noul threshold if configured; direct note/testimony requirements; no missing snapshot identity.
2. **Base rank:** weighted sum of normalized catalog Scores. Low Score confidence does not alter truth, but can apply a configured, tested uncertainty discount or place the item in a review/reserve band. It must not be treated as evidence of the opposite.
3. **Candidate qualification and mandatory reserves:** aggregate only the typed candidate groups above, then reserve the group-specific independently supporting games, deterministic pattern candidate entries, and concrete role-scoped counterevidence when their gates pass. Each reserve carries its `GroupRoleEvidenceBinding`, so the selected group can be traced to its support, qualification, and counterevidence relation instances and citations. A game may occupy multiple pattern candidates, but each group retains its own membership, roles, and bindings. These reserves are selected by rules, not allowed to lose to a high composite.
4. **Diversification:** greedily fill remaining capacity by marginal value: base rank minus redundancy penalty for duplicate game, candidate, mechanic/designer/artist association, and near-identical evidence role. Apply per-source caps only when they do not violate mandatory coverage. Deterministic tie-break order is composite, evidence role priority, confidence, normalized game name/ID.
5. **Contradictions:** a high contradiction Score creates a counterevidence reserve. If material contradiction remains after fetching its necessary details, force it into the pack and direct Pi to qualify or abstain. For recurring trade-offs, current materially contradictory evidence triggers the existing `conflicting-evidence` abstention rule rather than being averaged away. For repeated values, mixed signals become a required limitation. For pattern exceptions, co-occurrence, collaborator, veto, sparse-note, metadata, and comparator confounders remain explicit pack fields.

The target pack size is a policy/configured budget, initially around 25 games plus non-game candidate/aggregate records. It is not a universal product constant. Mandatory coverage can exceed it, in which case the pack records `targetExceededForPolicy` and final synthesis receives the complete required set. The pack always carries every qualified group's typed aggregate, required support, and required counterevidence coverage, even when its selected detail-game list is shorter. If required coverage would violate a hard context ceiling, abstain with `incomplete-scope` or use a question-specific deterministic compression that preserves every required candidate, role, and count, never model-selected omission.

## Question-policy preservation

| Default question | Complete universe and selection rule | Required outcome guard |
| --- | --- | --- |
| `repeated-values` v2 | Evaluate every eligible owned game against all authorized non-note game evidence. Notes are optional explanatory context; a note-free answer remains possible. | Distinguish direct personal axis ratings from calculated fitness, normalized Elo, and predictions. Do not claim a motive; cite identities and exact evidence. |
| `pattern-exceptions` v1 | Preserve every deterministic candidate from class order `mechanic`, `designer`, `artist` and serialized overview order. Rank/pack may choose detail games, but never omit the ledger. | Answer only with two supporting games having present relevant notes and a material note-backed qualification, competing explanation, or meaningful difference. Low score/outlier alone is not an exception. |
| `recurring-trade-offs` v1 | Evaluate every eligible game and every present note necessary to establish exhaustive-note scope. Select at least two distinct qualifying testimony records, plus counterexamples. | Each qualifying note independently contains both positive and limiting sides. Never infer either side from missing notes or behavioral proxies. Material contradiction abstains. |

The final Pi prompt must continue to declare collection content untrusted, require server-supplied citation IDs only, require exact minimal excerpts for cited owner notes, and forbid Pi from supplying server-owned scope, dependencies, evidence identity, timestamps, or citations. It receives only ranked, qualified `RankedCandidateGroup` records plus their required support/counterevidence and may synthesize among those groups; it may not rediscover a theme, facet, tension, pattern candidate, or relationship over arbitrarily selected games. Pack membership is a retrieval bound, not permission to turn deterministic evidence into testimony.

## Snapshot, cache, and invalidation

`snapshotFingerprint` deliberately does not contain note bodies. It therefore cannot establish that the note state used by planning, deterministic candidate selection, or System One is unchanged. Every note whose presence, metadata, or body is sent to a provider **or considered by deterministic selection** is an exact, versioned dependency, including notes that were examined but were unselected, non-qualifying, or relegated to a reserve.

```ts
type ReflectionNoteDependency = {
  noteId: string;
  gameId: string;
  state: "present" | "absent";
  contentVersion: number | null;
  bodyFingerprint: string | null;
  metadataFingerprint: string | null;
  use: "plan-input" | "candidate-selection" | "system-one-state" | "support" | "counterevidence" | "examined-unselected";
};

type NoteDependencyManifest = {
  manifestVersion: 1;
  snapshotFingerprint: string;
  selectionPolicyVersion: number;
  dependencies: readonly ReflectionNoteDependency[];
  fingerprint: string;
};
```

The projection records a canonical manifest for the whole policy-relevant note universe before selection, including explicit `absent` entries where note presence changes eligibility. A derived request stores the subset actually transmitted to a provider and the complete selection manifest. The plan compiler currently receives no note body; if a future plan path receives note presence or body, those exact entries are added with `plan-input` before the call. A note must not be omitted from the manifest merely because its game is not selected for the final pack.

The cache hierarchy is:

1. **Projection snapshot:** retain the existing `snapshotFingerprint`, collection revision/schema, profile contract/algorithm versions, and source dependencies.
2. **Plan cache:** keyed by question ID/version, normalized user-question fingerprint, catalog version, plan-compiler provider/model identity, policy version, and its `NoteDependencyManifest.fingerprint` whenever planning considers note presence/body. The plan cannot cross a snapshot if it embeds snapshot-bound eligibility or thresholds.
3. **Per-relation judgment cache:** keyed by snapshot fingerprint, canonical plan ID, candidate-ledger fingerprint, subject/candidate/relation IDs, canonical relation-evidence-binding fingerprint, rubric catalog version, exact game input fingerprint, exact transmitted-note dependency fingerprint, post-migration disclosed provider/model identities, and primitive request shape. Reuse only exact matches.
4. **Evidence-pack cache:** keyed by snapshot fingerprint, plan ID, complete candidate-ledger fingerprint, complete note-selection-manifest fingerprint, all required judgment fingerprints, aggregation/diversification policy version, and target budget policy.
5. **Reflection result cache:** remains the current validated result cache and current/stale/purged state model, extended to include the plan/pack provenance in dependencies or a versioned internal sidecar.

Any note creation, edit, metadata/presence change, or deletion invalidates every descendant whose complete or transmitted manifest contains that note's ID or affected absence entry, including an unselected note. A collection/profile algorithm, question, rubric, aggregation, candidate-coverage, provider/model, adapter, or plan-contract version change invalidates the relevant descendant cache. On deletion, install a deletion fence immediately: cancel in-flight work with a matching manifest, reject result publication during revalidation, invalidate plan/judgment/ledger/pack derivatives, and purge retained raw provider payloads and ranking artifacts that contain the deleted body. Existing published-result purge semantics remain mandatory where the deleted note/game was cited; otherwise mark the result stale and regenerate rather than silently serving a ranking made using deleted or changed unselected evidence. Before publication, rerun the existing evidence revalidation fence against the captured plan/pack source dependencies **and the complete note manifest**; never publish a fresh semantic ranking over stale evidence.

## Privacy, provider disclosure, and retention

**Hard prerequisite, not an adapter design choice:** the authoritative Reflection contract currently permits one provider/model acknowledgement and maximum two provider inference round trips per question. This design requires Pi planning/final synthesis plus potentially many System One relation calls. A daemon-owned adapter does not make those calls compatible with the current public acknowledgement, disclosure, accounting, round-trip, or operation semantics. Therefore this topology is **prohibited under the current Reflection contract** and must not be implemented, feature-flagged, or described as an approved adapter extension.

It can be enabled only after a separately reviewed and approved, versioned Reflection-contract migration expands the public contract to define all of the following:

- acknowledgement and disclosure of every external subprovider and model identity, the data classes/note paths each receives, and local-only or disabled behavior;
- per-subprovider and aggregate provider usage and cost accounting, with the displayed identities and accounting representation explicitly specified;
- a bounded maximum System One batch, request, and provider-call ceiling per reflection attempt, counting retries, alongside concurrency, byte, cost, and timeout budgets;
- cancellation propagation and event lifecycle for queued and active subrequests, deterministic cleanup, and exactly-once terminal behavior;
- the new operation and provider-inference round-trip semantics, including how the existing maximum-two rule is replaced or versioned for the composite operation; and
- acknowledgement invalidation whenever any disclosed provider/model, data class, note path, local-only behavior, accounting method, or call-limit policy changes.

The migration must settle these public contracts before any daemon adapter or TypeSafe call path is written. After acceptance, its adapter may be daemon-owned and server-configured, but that implementation is downstream of the migration rather than a mechanism for bypassing it. The product alternative is decisive: do not make LLM-defined TypeSafe scoring a Reflection feature unless this contract migration is accepted. Credentials remain daemon-side and no client may select an undeclared provider.

Pi receives question/policy/catalog and then only the typed candidate groups and authorized evidence pack. The System One extension receives only the authorized per-relation fields necessary for catalog rubrics. Owner-note text is transmitted only for question/rubric paths explicitly authorized to use it, never merely because it is available. Neither subprovider has mutation authority; identifiers, request IDs, and logs are minimized/redacted as current provider-view patterns require.

Persist canonical plans, disclosed adapter/subprovider model versions, usage/cost records, hashes, numerical judgments, manifests, and selection provenance only as long as needed for cache/audit and according to the Reflection deletion policy. Do not persist raw note text in new ranking logs. Deleting Reflection data must delete plan, judgment, candidate-ledger, manifest, and pack derivatives alongside current results.

## Failure behavior

- **Plan compiler refusal, malformed plan, or no catalog fit:** use the fixed baseline plan if it covers the selected default question; otherwise mark the question unavailable with a safe detail. Never fall back to freeform instructions.
- **Contract migration absent or not acknowledged:** do not invoke TypeSafe or a composite adapter. Use the current Reflection path only; this ranking feature is unavailable.
- **Post-migration composite operation not configured, disclosure not acknowledged, auth/rate-limit/outage, invalid response, call-budget exhaustion, or cancelled batch:** map through the migrated operation lifecycle. Preserve prior cache as stale rather than replacing it with a partial answer.
- **Coverage shortfall:** `incomplete-scope` where policy requires completeness. Do not shrink the candidate universe to a successful subset.
- **No qualifying testimony/pattern/exception:** use the current question-specific abstention reason such as `no-owner-testimony`, `insufficient-independent-testimony`, `no-supported-pattern`, or `no-material-synthesis`.
- **Contradiction:** package it or abstain according to the table above. It is never discarded as a low-ranked outlier.
- **Pi synthesis/tool failure:** retain the validated pack only as non-user-facing diagnostic state; do not publish an answer. Existing structured-submission validation, cancellation, and terminal stream semantics remain authoritative.

## Offline and shadow validation gates

Do not put this path in front of owners until it passes a recorded, de-identified fixture corpus with expected outcomes reviewed against current reflection policy.

1. **Contract tests:** strict plan/catalog schemas reject unknown rubrics, freeform instructions, unapproved evidence classes, duplicate dimensions, wrong versions, malformed primitive responses, and snapshot mismatch. Require a unique relation-instance binding for every role-scoped judgment; reject missing, cross-candidate, stale-note-version, excerpt-fingerprint/range mismatch, and unresolvable deterministic-source bindings. Reject final citations that are not reachable from the selected group's role binding.
2. **Coverage tests:** fixture collections prove every expected game/candidate/relation is dispatched; repeated-value facet denominators are complete; pattern-exception candidate order, set, and multi-candidate game memberships exactly match the projection; pagination/batch boundaries do not affect deterministic candidate groups or packs; trade-off paired-tension scope counts and exhaustive-note flag remain correct.
3. **Policy regression tests:** include note-free repeated values, indirect-only evidence, qualifying and non-qualifying exceptions, split-sided trade-offs, missing-note proxies, co-occurrence confounders, and material contradictions. Compare answer/abstention/citation validators to the current pipeline.
4. **Ranking tests:** deterministic candidate-group aggregation and diversity with equal scores, repeated sources, required support/counterevidence roles, multi-candidate games, mandatory reserves exceeding target, low-confidence Scores, relevance near 0.5, and contradiction reserves. Assert group IDs, roles, relation-instance-to-citation traceability, coverage, and reasons, not only selected IDs.
5. **TypeSafe calibration evaluation:** label relevance and each Score dimension on held-out real-shaped fixtures. Set thresholds, uncertainty treatment, dimensions, and weights from observed errors, not vendor examples or confidence alone.
6. **Shadow mode:** execute plan, System One, and deterministic pack construction alongside the current Pi retrieval flow without affecting answers. Store only approved diagnostic artifacts, compare coverage, abstentions, candidate preservation, evidence-pack size, latency, cost, and human-rated usefulness/citation support. Review disagreement samples before rollout.
7. **Contract-migration and dependency tests:** before enabling this feature, prove the approved migration discloses and acknowledges every subprovider/model, accounts for individual and aggregate usage/cost, enforces the batch/request/call ceiling including retries, propagates cancellation, and implements the migrated event and round-trip lifecycle. Reject any adapter configuration under the old contract. Prove a changed, created, or deleted unselected note invalidates its manifests and caches; prove the deletion fence blocks publication and purges retained body-bearing derivatives.
8. **Canary and kill switch:** gate per question behind a feature flag; retain the current pipeline fallback. A single adapter configuration switch disables System One planning/ranking without changing persisted current answers.

## Assumptions

- A separately approved, versioned Reflection-contract migration expands acknowledgement/disclosure, provider identity, usage/cost accounting, bounded System One batch/request/call ceilings, cancellation/event lifecycle, and operation/round-trip semantics for this composite topology. Without it, this work is prohibited rather than merely blocked on an adapter.
- The existing projection can supply a compact per-game state without weakening its evidence authorization/citation model.
- The catalog initially has enough stable dimensions for the three shipped question types; “no supported plan” is acceptable for novel freeform questions.
- A roughly 25-game target is an initial context/cost budget, calibrated by fixture and shadow data rather than hardcoded across questions and collection sizes.

## Open decisions

1. Is the Pi plan compiler run for only the three default questions, or does a future custom-question surface require a separately versioned question-policy registry?
2. Should no-supported-plan use a fixed baseline plan automatically or show an explicit owner-facing abstention/unavailable state?
3. What exact target budgets, concurrency, request-byte ceiling, and provider cost limits pass shadow evaluation for each question type?
4. Which rubric dimensions demonstrate adequate calibration to ship, and should low confidence discount rank or only trigger a reserve/review path?
5. Are TypeSafe judgments retained across a provider model upgrade for analysis only, or deleted immediately when no longer cache-valid?
6. What aggregation-rule thresholds and target budgets meet fixture and shadow-validation evidence for each catalog subject type?
