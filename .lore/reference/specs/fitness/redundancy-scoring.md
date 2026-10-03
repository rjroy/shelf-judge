---
title: "Redundancy Scoring Penalty"
date: 2026-04-11
status: implemented
tags: [spec, redundancy, fitness, scoring, collection-awareness]
modules: [daemon, shared, web, cli]
req-prefix: REDUN
related:
  - .lore/work/brainstorm/redundancy-scoring.md
  - .lore/reference/specs/fitness/niche-champion-display.md
  - .lore/reference/specs/fitness/prediction-engine.md
  - .lore/archive/specs/collection/collection-profiling.md
  - .lore/reference/designs/mvp-fitness-model.md
  - .lore/work/design/jev-redundancy-similarity.md
  - .lore/work/design/wishlist-jev-description-similarity.md
  - .lore/reference/specs/features/wishlist.md
  - .lore/work/issues/deferred-redundancy-scoring.md
  - .lore/reference/vision.md
---

# Spec: Redundancy Scoring Penalty

> **Authority and delivery status:** This maintained reference describes factual-plus-optional-semantic redundancy. The SQLite storage/run/disclosure amendments follow the [approved SQLite Jev pair-cache design](../../../work/design/sqlite-jev-pair-cache.md). The current interface is a direct aggregate preview followed by one explicit **Run**, with active-run progress, cancellation, and refreshable status; this contract does not claim live provider validation. The implementation status in the front matter describes the original factual redundancy feature; it does **not** mean live Jev/provider behavior has been validated. The [approved Jev similarity design](../../../work/design/jev-redundancy-similarity.md) informs the earlier semantic contract. Prediction, shelf placement, and niche-cluster contracts are unchanged.

> **Current Jev storage/run/scoring target (supersedes conflicting clauses below):** Validated numeric per-pair C/D judgments and compact run/activation state live in daemon-owned SQLite as disposable derived state, not in collection JSON. Collection JSON remains authoritative for games, notes, semantic settings, and cached-D-use permission/consent fences. Cache loss or mismatch is a cache miss; reads never call a provider. Only a user's explicit, disclosed one-click **Run** operation may make provider calls. Show aggregate scope/count/budget/progress disclosure and authorize note transmission for that execution; a complete pair manifest, pair-by-pair browsing, download, or acknowledgement is not required. For each eligible pair, score using F and whichever positive-weight C/D signals are valid and current for that pair, normalized by the sum of included weights. Omit missing, stale, failed, or permission-blocked C/D components for that pair rather than treating them as zero; a valid cached numeric zero is present. F+D and F-only are both valid cases. If no positive-weight component is available, omit that pair. Partial caches improve valid pairs on the next read while other pairs remain factual-only; report honest partial status and aggregate coverage. Complete coverage is not a scoring prerequisite, and SQLite activation is advisory/inert for scoring. A missing source is genuinely unavailable and can be omitted from that pair's blend. Combined C+D results depend on all fields sent in their shared request, so note edits/revocation invalidate both C and D from those requests, and description changes invalidate both C and D from combined requests (but not independent D-only results). Preserve permission, exact-source, and stale-result fences for Run and reads. The clauses explicitly marked **SUPERSEDED** describe the former collection-owned generation/full-manifest contract and must not be implemented.

> **Wishlist candidate amendment — 2026-10-03 (owner-approved target; not yet delivered):** The wishlist specification extends this collection contract with a separate wishlist-to-eligible-owned comparison domain. In scoring notation F=factual, C=description, O=owner-note; in cache signal labels C=description and D=owner-note. A wishlisted candidate has no O/D: only independent C_ONLY judgments are admissible; shared C+D C is note-dependent and forbidden. Compute only candidate-to-eligible-owned pairs, with no wishlist-to-wishlist or candidate-owned-owned work. Reuse the established pairwise F/C blend, threshold, neighbor and penalty arithmetic; unavailable signals and weights are omitted together while valid zero remains in the denominator. Saved valid prediction scores are always rankable regardless of C/cache availability. This amendment changes neither owned scoring results nor the pure engine's requirement for a complete collection-owned pair table: candidate-only pairs are consumed at a distinct result boundary and never passed as an incomplete collection table.

> Wishlist adds compact BGG factual source persistence, explicit `scope=wishlist` preview/run, and a current redundancy projection beside the saved factual snapshot. Preview omission continues to mean existing collection scope. Wishlist preview hydrates/persists missing legacy source before aggregate disclosure and freezes all input identities and candidate-owned pairs; start validates and consumes only that authorization. No ordinary prediction, wishlist read, status poll, or factual refresh infers. Current projection uses current adjustment when computable, else saved factual adjustment, else base prediction, with the saved base score and exactly one penalty application. This is target authority only; `implemented` describes the original redundancy feature, not this candidate extension. See the [wishlist specification](../features/wishlist.md) and [approved design](../../../work/design/wishlist-jev-description-similarity.md).

## Overview

The niche champion display (Stage 1) shows where each game sits within its niches. This spec builds the next two stages: a redundancy penalty that quantifies how much a game's fitness is reduced by the presence of higher-scoring niche neighbors. Stage 2 shows the penalty as a "what if" annotation alongside the unmodified primary score. Stage 3 applies the penalty to the primary fitness score. The user escalates between stages via settings, with the system defaulting to the least invasive mode.

The factual baseline uses pairwise cosine similarity on flattened feature vectors (Proposal 1 from the brainstorm), not cluster-based grouping. The target contract retains that factual cosine, removes personal axes from redundancy, and optionally blends published Jev description/note judgments. Pairwise similarity captures the gradient of overlap between games rather than forcing discrete niche boundaries. The niche champion display's cluster-based niches and this spec's pairwise similarity-based penalties are complementary: cluster niches answer "what mechanic/category groups do I own?", pairwise penalties answer "how much of this game's overall profile is covered by better-scoring games?"

## Entry Points

- Redundancy settings API: aggregate `GET /redundancy/settings`; factual-only `PATCH /redundancy/settings`; semantic-only `PATCH /redundancy/semantic-settings`
- Game detail view (web): redundancy annotation in score breakdown (Stage 2+)
- Collection list (web): sort by redundancy-adjusted fitness (Stage 2+)
- Game detail CLI: redundancy adjustment in `shelf-judge game <id>` output (Stage 2+)
- Collection CLI: `shelf-judge scores` shows redundancy-adjusted scores (Stage 3)
- Search preview (web/CLI): predicted redundancy impact for candidate games
- Prerequisite: niche champion display (Stage 1) is implemented

## Requirements

### Redundancy Settings

- REQ-REDUN-1: A `RedundancySettings` type is defined in `packages/shared/src/types.ts`:

```typescript
interface RedundancySettings {
  /** Master toggle. When false, no redundancy computation occurs. Defaults to false. */
  enabled: boolean;
  /** Active engagement stage. "annotation" shows what-if penalties without modifying primary score.
      "integrated" applies the penalty to the primary fitness score. Defaults to "annotation". */
  stage: "annotation" | "integrated";
  /** Minimum factual or valid blended similarity for neighbor status. Range [0.0, 1.0]. Default 0.6. */
  similarityThreshold: number;
  /** Maximum penalty in fitness points. Range [0.5, 5.0]. Default 2.0. */
  maxPenalty: number;
  /** Weights within the factual binary/continuous cosine; saved ratios are preserved. */
  factualComponentWeights: { binary: number; continuous: number };
  /** Minimum number of niche neighbors (games above threshold) before penalties apply. Default 1. */
  minNeighbors: number;
}

/** Stored only in the revisioned collection, never in redundancy-settings.json. */
interface SemanticRedundancySettings {
  enabled: boolean;
  factualWeight: number; // F; default 7, inert while disabled
  descriptionWeight: number; // Cw; default 0 until explicit opt-in
  noteWeight: number; // Dw; default 0 until explicit opt-in
  cachedNoteUseEnabled: boolean;
  // Run authorization and durable consent/policy fences are not client-writable
  // semantic settings. Pair judgments/run state live in daemon-owned SQLite.
}

/** Read-only aggregate returned by GET; the two nested settings have separate write authorities. */
interface RedundancySettingsView {
  factual: RedundancySettings;
  semantic: SemanticRedundancySettings;
}
```

The factual-component weights apply only to the existing binary/continuous feature encoding and their weighted flattening before one cosine is computed. `personalAxes` is removed from redundancy-only settings and similarity; personal/tournament ratings and shared feature-vector support used elsewhere remain unchanged. The separate `factualWeight` (F) weights the already-computed factual cosine only in the final semantic blend; it is not derived from, or a replacement for, the binary/continuous ratio.

- REQ-REDUN-2: Default values for `RedundancySettings`:

```typescript
const DEFAULT_REDUNDANCY_SETTINGS: RedundancySettings = {
  enabled: false,
  stage: "annotation",
  similarityThreshold: 0.6,
  maxPenalty: 2.0,
  factualComponentWeights: { binary: 0.4, continuous: 0.3 },
  minNeighbors: 1,
};
```

The factual master `enabled` flag defaults to `false`. Semantic settings have separate defaults in the revisioned collection: disabled, F=7, C=0, D=0, and cached-note use disabled. Semantic mode requires explicit opt-in for new and migrated installations. On first explicit opt-in, initialize weights to the approved starting values F=7, C=5, D=10 unless the owner chooses other values; these are opt-in defaults, not calibrated production defaults. While mode remains off, migrated and fresh-install C/D values remain zero and F is inert. The illustrative `4A, 1B, 5C, 10D` is not a new definition of A/B or a reason to alter the factual binary:continuous 4:3 ratio.

- REQ-REDUN-3: Factual `RedundancySettings` only (master enablement, stage, threshold, penalty, binary/continuous weights, and minimum neighbors) are persisted to `~/.shelf-judge/data/redundancy-settings.json` following the `PredictionSettings` storage pattern. Semantic enablement, F/C/D weights, cached-note-use permission, and durable consent/policy fences remain collection-owned. Validated numeric pair judgments plus compact run progress and advisory activation identity are stored in daemon-owned SQLite, which is disposable derived state and never client-writable. Semantic state is never mirrored in `redundancy-settings.json`.

- REQ-REDUN-4: `GET /redundancy/settings` returns a `RedundancySettingsView` composed from factual settings in `redundancy-settings.json` and semantic settings in the revisioned collection; its response identifies those distinct authorities and does not expose note text, per-game note state, or consent secrets. Configuration writes are separate: `PATCH /redundancy/settings` accepts only factual fields and persists factual configuration in the settings file; a separate `PATCH /redundancy/semantic-settings` accepts only semantic enablement/F/C/D and cached-note-use permission and persists semantic configuration only in the revisioned collection through its serialized mutation coordinator. Run authorization is one-execution state; pair cache and compact run/activation state are daemon-owned SQLite state, not settings PATCH fields or collection JSON. Reject fields belonging to the other configuration authority rather than splitting a PATCH across stores. A factual similarity-weight PATCH may also perform the ordered collection epoch invalidation below, but it never writes semantic configuration there. There is no cross-file transaction claim.

  When a factual PATCH changes binary/continuous weights that affect the factual cosine, it must run through the serialized collection mutation coordinator in this order: (1) atomically advance the durable semantic/source epoch in the revisioned collection and fence every in-flight Run captured against the prior epoch; invalidate/withdraw SQLite activation before accepting semantic reads; then (2) atomically persist the factual settings file. Do not write the factual settings file if step (1) fails. If step (2) fails, return failure and leave the prior factual settings file unchanged; the already-advanced collection epoch and withdrawn activation remain in effect. Per-pair scoring may use any independently valid current rows under the new factual identity; activation is not a scoring gate. This is intentionally not a cross-file transaction: the intermediate state may be factual-only or partially blended, never a stale semantic blend. PATCHes that change only unrelated factual settings (for example stage, threshold, or penalty) retain their existing factual-file-only behavior and do not advance the semantic/source epoch or withdraw activation. A PATCH containing both similarity weights and unrelated factual settings follows the fenced two-step sequence above.

  Each Run captures the durable semantic/source epoch as well as factual cosine-input identity. Reads and Run completion validate **both** against the current collection epoch and current factual settings; matching setting values alone are insufficient. Activation metadata is advisory and inert for scoring; partial current rows remain usable after a fence change when their individual source, policy, and factual identities validate. A PATCH must never restore an old activation identity. Therefore A→B→A weight changes irreversibly invalidate prior activation, including across restart, while individually valid unaffected pair rows may remain reusable. Validation rules:
  - `similarityThreshold` must be in [0.0, 1.0]
  - `maxPenalty` must be in [0.5, 5.0]
  - factual binary/continuous weights must be finite, nonnegative, and have positive sum
  - `minNeighbors` must be >= 1
  - `stage` must be "annotation" or "integrated"

  Semantic PATCH validation: F must be finite and >0; C/D must be finite and >=0. A positive-weight component is enabled only when semantic mode is on. Invalid values return 400 with a descriptive error. GET may assemble values from the two stores for display, but must not imply a cross-store transaction or use the aggregate endpoint as a write boundary.

  Invalid values return 400 with a descriptive error message. The routes live in a new `packages/daemon/src/routes/redundancy.ts` file, registered in the app alongside other route groups.

- REQ-REDUN-5: When factual `enabled` is `false`, no pairwise redundancy computation occurs. The game service skips pair scoring, but scored results still expose the safe `redundancySimilarityInfo` with mode/status `disabled` and no active semantic identity. Other redundancy fields/adjustments are null. This is a short-circuit, not a "compute then discard."

### Redundancy Engine

- REQ-REDUN-6: The redundancy engine is a pure-function module at `packages/daemon/src/services/redundancy-engine.ts`. It has no service-layer dependencies. It takes scored games, factual feature vectors, factual settings, and a caller-built full factual pair table augmented with independently available C/D values, weights, and safe status/identity provenance. The caller resolves cache rows and validates their source, policy, and permission identities; the engine validates the table against the eligible factual pair universe, recomputes factual cosine to verify the supplied factual values, composes each pair's F/C/D weighted blend, and returns adjustments plus similarity status. The engine does not read storage, caches, providers, note text, or source records; call other services; perform I/O; or maintain state.

- REQ-REDUN-7: The redundancy engine exposes a primary function:

```typescript
function computeRedundancyAdjustments(
  gamesWithScores: GameWithScore[],
  settings: RedundancySettings,
  getFeatureVector: (game: Game) => FeatureVector,
  pairTable?: RedundancyPairTable,
): Map<string, RedundancyAdjustment>;

interface RedundancyPairTable {
  /** Complete factual unordered-pair universe; semantic values are independently optional per pair. */
  status: "disabled" | "factual" | "not-ready" | "stale" | "partial" | "ready";
  identity: { generationId: string; consentEpoch: string; settingsEpoch: string };
  expectedIdentity: { generationId: string; consentEpoch: string; settingsEpoch: string };
  weights: { factual: number; description: number; ownerNote: number };
  pairs: Array<{
    gameAId: string;
    gameBId: string;
    factual: number;
    description?: number | null;
    ownerNote?: number | null;
  }>;
}
```

`computeRedundancyAnalysis` takes the same arguments and returns per-game adjustments, per-game safe similarity info, and default safe similarity info. Pair-table status may be `partial` when semantic components are not available for every eligible pair; the factual pair universe remains complete.

The caller constructs a full factual pair universe and adds each independently valid/current/permitted SQLite C/D value that is available after source, policy, and permission validation. It supplies the factual settings identity, semantic weights, and safe status/identity provenance; it does not precompose final similarities. Missing, corrupt, stale, failed, or blocked semantic values are absent for that pair, not represented as zero. The engine verifies pair identities and complete factual-universe coverage, recomputes factual cosine from current feature vectors to verify each supplied factual value, then composes F plus whichever positive-weight C/D values exist for each pair, renormalizing over included weights. A valid cached zero remains present. Partial semantic availability is scored immediately for pairs with valid cached signals; pairs without available C/D use factual-only. A pair with no available positive-weight component is omitted. Report aggregate coverage and honest partial status. Activation metadata is advisory and does not gate scoring. No read invokes inference. The pure engine consumes no cache, source, note-text, or provider data and performs no I/O. Tests supply pair tables with varied per-pair availability without storage, provider, or note-text infrastructure.

- REQ-REDUN-8: For each non-vetoed game with a fitness score > 0, the engine:
  1. Reads that pair's factual score and independently available C/D values from the caller-supplied complete factual pair table, verifies the factual score against a cosine computed using only existing binary and continuous feature blocks, and composes the per-pair weighted blend using the supplied weights. Activation is not a scoring prerequisite. Personal axes never participate in target redundancy similarity. The engine performs no cache or source lookup of its own. The semantic blend is effective only when factual redundancy and semantic mode are both enabled and at least one of C/D has positive weight; absent signals remain omitted per pair.
  2. Identifies "niche neighbors": games whose similarity is >= `similarityThreshold`.
  3. If the game has fewer niche neighbors than `minNeighbors`, the game receives zero penalty.
  4. Among niche neighbors, counts how many have a higher fitness score than this game. This count is `betterNeighbors`.
  5. Computes `coverageRatio = betterNeighbors / nicheNeighborCount`.
  6. Computes `penalty = coverageRatio * maxPenalty`.
  7. The adjusted score is `max(1.0, originalScore - penalty)`. The penalty never pushes a score below 1.0.

- REQ-REDUN-8a (current corrected target): For each eligible pair, the caller supplies factual cosine F and whichever positive-weight C/D signals are valid, current, and permitted for that pair; the engine composes the final value as `(F*factualCosine + Cw*descriptionScore + Dw*noteScore) / sum(weights of included components)`, omitting every unavailable component and its weight. The engine validates supplied factual values against current feature-vector cosine. Factual cosine is available for an eligible pair; C/D with zero weight are disabled. A missing, stale, failed, malformed, or permission-blocked C/D cache result is omitted for that pair, not scored as zero and not a reason to suppress valid signals on other pairs. A valid cached score of zero is present and its positive weight remains in the denominator. F+D and F-only are valid blends. Omit a pair only when no positive-weight component is available. Renormalize per pair; report honest aggregate signal coverage and partial status when availability differs across pairs. Semantic mode off or both Cw and Dw zero means factual-only similarity and requires no semantic state or request. C requires two usable current BGG descriptions; D requires two current `present` notes and current cached-D-use permission. Note text is sent only under fresh one-execution authorization. D is one validated Score judgment over the two notes, with no separate relevance/firsthand gate; its rubric must not invent experiences absent from the notes. Similarities are normalized to [0,1] under versioned owner-reviewed rubrics. Validate and retain confidence as metadata, but do not use it to filter or downweight valid scores. The pure engine consumes no note text and never performs inference.

- REQ-REDUN-8b (approved target): Semantic mode is off by default. Semantic judgments are computed only by a single explicit, disclosed daemon **Run** operation, never by reads/status, settings changes, the scoring engine, owner-note edits, prediction, cache misses, startup recovery, or background work. C-only requests contain descriptions and no note fields; D-only requests contain names and notes but no descriptions. Combined C+D preserves the approved shared-state request and all sent fields are dependencies of both judgments. One Run discloses aggregate scope/counts, provider/model, note-bearing count, possible provider retention, budget/limits, and potential integrated-fitness effect; it authorizes note transmission for that execution without requiring full-manifest download, pair-by-pair browsing, or acknowledgement. Cached-D use remains separate permission. Do not inspect note content to prefilter requests. A rubric/question version change bumps its identity and invalidates cached results from the prior version before reuse/publication. See the current owner-note privacy and daemon inference-boundary references for the governing consent and provider contract.

- REQ-REDUN-8c (historical contract, superseded by the 2026-10-01 owner correction): The former contract required a collection-owned, atomically published full pair generation and exact pair-set authorization. The current contract uses daemon-owned SQLite per-pair judgments, reusable independently, with compact advisory activation/run state and no mandatory pair manifest. Coverage follows enabled positive-weight signals and is reported in aggregate, but complete coverage is not a readiness gate for scoring. Each eligible pair uses F plus its individually valid/current/permitted positive-weight C/D signals, renormalized by included weights. Missing, stale, failed, or blocked signals are omitted for that pair, not treated as zero; a cached zero is present. Valid pairs may receive semantic blends while others use F-only. Activation does not gate scoring. Missing/cleared sources are genuinely unavailable and require no inference. A source/eligibility/policy change invalidates affected cache rows and blocks stale data; it does not suppress unrelated valid rows. Disabling cached-D-use makes D-dependent rows unavailable immediately; valid current independent C-only rows can still contribute. Full-generation and complete-coverage-only scoring language in the original design is historical and not normative.

- REQ-REDUN-8d (approved target): Migrate saved factual binary:continuous settings preserving their ratio. If both are zero, migrate to the existing 4:3 ratio and show a visible notice. Existing enabled annotation/integrated stage remains enabled but becomes factual-only; disclose that removal of personal axes can change neighbors and integrated scores even offline. Do not reinterpret the old personal-axis weight as D. Semantic mode remains off, C/D weights are zero, and F=7 is inert until explicit opt-in. This is an intentional scoring change, not evidence that the migration or semantic feature has shipped.

- REQ-REDUN-9: The game with the highest fitness score among its niche neighbors always receives zero penalty. It has zero `betterNeighbors`, so `coverageRatio` is 0. This is not a special case; it falls out of the formula. This game is the "niche champion" for pairwise redundancy purposes (distinct from the cluster-based niche champion in the niche champion display).

- REQ-REDUN-10: When two or more niche neighbors have identical fitness scores (equal to two decimal places, the computation precision), they are treated as tied. A tied game does not count as "better" than another game at the same score. For example: if games A, B, C are all niche neighbors and A scores 8.0, B scores 8.0, C scores 7.5, then A and B each have 0 `betterNeighbors` (the tie doesn't count) and C has 2 `betterNeighbors`.

- REQ-REDUN-11: Vetoed games (fitness score 0, `vetoed === true`) are excluded from all redundancy computations. They are not considered as niche neighbors, they do not receive penalties, and they do not count toward `betterNeighbors` for other games. A vetoed game's `redundancyAdjustment` is null.

- REQ-REDUN-12: Games with only predicted scores (`predictionMeta !== null` and `predictionMeta.actualAxisCount === 0`) participate in redundancy on the receiving side (they can be penalized) but carry reduced authority as niche references. When a fully-predicted game appears as a niche neighbor of an actual-scored game, it does not count toward `betterNeighbors` even if its predicted score is higher. Rationale: a game the user hasn't rated shouldn't have authority to make a rated game "redundant." A predicted game's own penalty is computed normally (actual-scored neighbors do count against it).

- REQ-REDUN-13: A game's niche neighbors are all games above the similarity threshold, regardless of how many niches (mechanics, categories, families) they share. The penalty reflects the total pairwise landscape, not individual cluster memberships. A game similar to 6 different games across different mechanic groupings has 6 niche neighbors, not one neighbor per cluster.

### RedundancyAdjustment Data Model

- REQ-REDUN-14: A `RedundancyAdjustment` type is defined in `packages/shared/src/types.ts`:

```typescript
interface RedundancyAdjustment {
  /** Penalty amount subtracted from original score. 0 when game is best in niche. */
  penalty: number;
  /** Fitness score before redundancy adjustment. */
  originalScore: number;
  /** Score after adjustment: max(1.0, originalScore - penalty). */
  adjustedScore: number;
  /** Games above the similarity threshold, sorted by similarity descending. */
  nicheNeighbors: RedundancyNeighbor[];
  /** This game's rank among its niche neighbors by fitness (1 = best). */
  nicheRank: number;
  /** Total number of niche neighbors (same as nicheNeighbors.length). */
  nicheSize: number;
}

/** Present on every scored result, including when no adjustment exists. */
interface RedundancySimilarityInfo {
  mode: "disabled" | "factual-only" | "semantic";
  status: "ready" | "partial" | "not-ready" | "stale" | "disabled";
  /** Opaque semantic activation identifier, null when semantic output is not active. */
  generationId: string | null;
  /** Effective signal names; never contains note presence, text, or per-game D availability. */
  signals: Array<"C" | "D">;
  /** Identity of factual cosine inputs (binary/continuous weights/encoding), not stage/threshold. */
  factualSettingsIdentity: string;
}

interface RedundancyNeighbor {
  gameId: string;
  gameName: string;
  /** Factual or published blended similarity, with mode/generation provenance. */
  similarity: number;
  /** The neighbor's fitness score (before its own redundancy adjustment). */
  fitnessScore: number;
  /** Whether this neighbor's score is entirely predicted. */
  isPredicted: boolean;
}
```

- REQ-REDUN-15: `RedundancyAdjustment` and `RedundancyNeighbor` are shared types consumed by daemon, web, and CLI. The `nicheNeighbors` array is sorted by similarity descending (most similar first). It includes all neighbors above threshold, not a truncated subset. For display purposes, the UI may truncate, but the data is complete.

### FitnessResult Extension

- REQ-REDUN-16: `FitnessResult` gains a new nullable field:

```typescript
interface FitnessResult {
  // ... existing fields unchanged ...
  /** Similarity mode and publication provenance, even when no adjustment exists. */
  redundancySimilarityInfo: RedundancySimilarityInfo;
  /** Redundancy adjustment data. Null when redundancy is disabled, game is vetoed, or game has no niche neighbors. */
  redundancyAdjustment: RedundancyAdjustment | null;
}
```

`redundancySimilarityInfo` is always present in a scored `FitnessResult`, including when `redundancyAdjustment` is null because redundancy is disabled, the game is vetoed, or it has no qualifying neighbor. It reports effective mode, safe generation/status provenance, and factual-settings identity; it must not reveal whether any particular game's note is missing/present/cleared, pair-level D availability, note content, consent details, fingerprints, or provider payload. `redundancyAdjustment` remains null when redundancy is disabled, the game is vetoed, or it has no qualifying neighbor.

### Stage 2: Annotation Mode

- REQ-REDUN-17: When `settings.stage` is `"annotation"`, the `FitnessResult.score` field is **unchanged**. The `redundancyAdjustment` field is populated with the computed penalty, but the penalty is not applied to the primary score. The `adjustedScore` field in `RedundancyAdjustment` shows what the score would be if the penalty were applied. The user sees the primary score as before, with the redundancy annotation as supplemental information.

- REQ-REDUN-18: In annotation mode, the `FitnessResult.score` returned by the daemon is the same value it would be if redundancy were disabled. No downstream consumer (web sorting by fitness, CLI score display, prediction engine reading scores) sees a different primary score. The annotation is advisory.

### Stage 3: Integrated Mode

- REQ-REDUN-19: When `settings.stage` is `"integrated"`, the `FitnessResult.score` field reflects the adjusted score: `max(1.0, originalScore - penalty)`. The `redundancyAdjustment.originalScore` preserves the pre-penalty score. All downstream consumers (sorting, ranking, display) see the adjusted score as the primary fitness score.

- REQ-REDUN-20: In integrated mode, the penalty is applied after all other fitness computations (axis weighting, utility curves, veto checks). The computation order is:
  1. Compute per-game fitness scores (existing pipeline, unchanged).
  2. Run the redundancy pass over all scored games.
  3. Apply penalties to `FitnessResult.score` for each game.
  4. Return results.

  The redundancy pass happens in `game-service.ts`'s `listGames()` method (and `getGame()` for single-game requests) after scores are computed but before results are returned. The `listGames()` method already iterates all games; the redundancy pass is a post-processing step on the collected `GameWithScore[]` array.

- REQ-REDUN-21: For single-game requests (`getGame(id)`), the redundancy penalty still requires computing fitness scores for all games in the collection, because the penalty depends on pairwise comparison with every other game. The game service computes all scores, runs the redundancy pass, then returns the single requested game's result. This is more expensive than the current single-game path but necessary for correctness. If performance becomes a concern, caching behind the profile dirty flag is the upgrade path, but this spec does not require caching.

### Interaction with Predictions

- REQ-REDUN-22: The prediction endpoint `GET /predictions/bgg/:bggId` gains a `redundancyPreview` field on `PredictedGameResponse`:

```typescript
interface PredictedGameResponse {
  // ... existing fields ...
  redundancyPreview: RedundancyAdjustment | null;
}
```

When redundancy is enabled, this field remains the saved factual-only preview against current pre-redundancy collection scores and is refreshed only by explicit wishlist factual Refresh. It does not inherit collection semantic snapshots and remains unchanged by Jev runs/cache changes. The separate approved wishlist Jev scope described above returns current candidate-to-owned redundancy in a non-persisted result projection; that projection is not the search prediction response and does not rewrite this field. When redundancy is disabled, this snapshot field is null.

- REQ-REDUN-23: The candidate game's redundancy preview is computed against the current collection's pre-redundancy scores. Adding the candidate does not change existing games' penalties in the preview. The preview answers "what penalty would this game receive?" not "how would adding this game change every other game's penalty?" The latter is a more complex computation deferred to a future interaction (see Exit Points).

- REQ-REDUN-24: The prediction engine's computations (`prediction-engine.ts`) do not read or depend on redundancy adjustments. The prediction engine predicts per-game fitness scores; redundancy acts on those scores. The dependency is one-way: redundancy consumes prediction output, predictions do not consume redundancy.

### Interaction with Niche Champion Display

- REQ-REDUN-25: Niche champion display (Stage 1) and redundancy scoring (this spec) are independent features that coexist. Niche champion display uses cluster-based grouping (BGG mechanics, categories, families) and does not modify scores. Redundancy scoring uses pairwise cosine similarity and optionally modifies scores. Neither depends on the other's output.

- REQ-REDUN-26: `NichePosition` (from the niche champion display spec) is unchanged by this spec. The `nichePosition` field on `GameWithScore` continues to reflect cluster-based niche rankings using unmodified fitness scores. In integrated mode (Stage 3), `NichePosition` rankings use pre-redundancy scores to avoid circular dependency: redundancy reads scores to compute penalties, so scores read by niche ranking must be pre-penalty.

### Interaction with Utility Curves and Veto Axes

- REQ-REDUN-27: Redundancy is orthogonal to veto and utility curves. A game that passes all veto thresholds can still be redundant. A game that is unique can still be vetoed. Utility curves shape the fitness score that redundancy reads (the curve's effect is baked into the score before the redundancy pass). These systems compose independently without interaction.

### Daemon API

- REQ-REDUN-28: `GET /games/:id` includes `redundancySimilarityInfo` on every scored result, even if `redundancyAdjustment` is null. The info is limited to effective mode, ready/not-ready/stale/disabled status, opaque published generation ID when active, enabled signal names, and factual-settings identity; it omits note-state and pair-level D details. `redundancyAdjustment` is included when applicable and null when disabled or when the game has no niche neighbors.

- REQ-REDUN-29: `GET /games` includes `redundancySimilarityInfo` on each scored result even when its adjustment is null, under the same note-safe projection as REQ-REDUN-28. The redundancy pass and its validated pair table are prepared once for all games, not per-game.

- REQ-REDUN-30: The aggregate `GET /redundancy/settings`, factual-only `PATCH /redundancy/settings`, and collection-owned `PATCH /redundancy/semantic-settings` endpoints are defined in REQ-REDUN-4. No PATCH writes both stores.

### Web UI: Game Detail

- REQ-REDUN-31: The game detail result exposes the note-safe `redundancySimilarityInfo` mode/status/generation provenance from the API even if `redundancyAdjustment` is null or there are no neighbors. When an adjustment exists, the score breakdown gains a "Redundancy" section that displays:
  - Original score and adjusted score (e.g., "Fitness: 6.4 (was 7.9, -1.5 redundancy)")
  - Niche rank (e.g., "3rd of 5 similar games")
  - A list of niche neighbors with name, similarity percentage, and fitness score. Each neighbor name links to that game's detail page.
  - When in annotation mode, the section is labeled "Redundancy (preview)" and the primary displayed score is unchanged. The adjusted score is shown as supplemental: "Would be 6.4 with redundancy applied."

- REQ-REDUN-32: When the game receives zero penalty (niche champion by pairwise similarity), the redundancy section shows "Best among similar games" with the neighbor list but no penalty annotation.

- REQ-REDUN-33: When redundancy is disabled, the adjustment section is omitted entirely (not shown empty); the separate result-level `redundancySimilarityInfo` still identifies disabled status.

### Web UI: Collection List

- REQ-REDUN-34: When redundancy is enabled in annotation or integrated mode, the collection list gains a "Redundancy-Adjusted" sort option. In annotation mode, this sorts by `redundancyAdjustment.adjustedScore` (the what-if score). In integrated mode, the default fitness sort already uses the adjusted score, but the sort option remains available for clarity.

- REQ-REDUN-35: Each game row in the collection list exposes the note-safe similarity mode/status/generation provenance even if that game has no adjustment. When an adjustment exists, the row also shows a compact redundancy indicator: a small penalty badge (e.g., "-1.5") next to the fitness score. In annotation mode, the badge is advisory; in integrated mode it is shown as part of the score breakdown. No row or broad list response reveals per-game note state or D availability.

### Web UI: Search Preview

- REQ-REDUN-36: The BGG search prediction preview panel shows the factual-only `redundancyPreview` from REQ-REDUN-22 when redundancy is enabled. Ordinary search prediction does not trigger inference. The separately approved wishlist Jev Run is the only persisted candidate-to-owned comparison scope described by this amendment; its current result is distinct from the search preview and saved wishlist snapshot. When no niche neighbors exist above threshold, show: "No similar games in collection."

### CLI

- REQ-REDUN-37: `shelf-judge game <id>` always includes safe mode/status/generation provenance, including when no `redundancyAdjustment` exists. Text mode identifies disabled, factual-only, semantic-ready, not-ready, or stale state; when applicable it also shows penalty, adjusted score, niche rank, and neighbor names. In `--json` mode, `redundancySimilarityInfo` and the optional full `RedundancyAdjustment` are included in the `FitnessResult` object.

- REQ-REDUN-38: `shelf-judge scores` reflects the current stage and displays safe similarity mode/status/generation provenance even when adjustments are null. In annotation mode, scores are primary (unadjusted) with an optional `--show-redundancy` flag that appends adjusted scores. In integrated mode, scores are adjusted by default. In `--json` mode, the full `FitnessResult` (including `redundancySimilarityInfo` and optional `redundancyAdjustment`) is always included.

- REQ-REDUN-39: `shelf-judge predict bgg <bgg-id>` includes redundancy preview data in output. Text mode shows the penalty and top 3 similar games. In `--json` mode, the full `RedundancyAdjustment` is included.

- REQ-REDUN-40: The CLI gains `shelf-judge redundancy` subcommands:
  - `shelf-judge redundancy settings` displays current `RedundancySettings` (text or `--json`).
  - `shelf-judge redundancy enable` sets `enabled: true` and returns updated settings.
  - `shelf-judge redundancy disable` sets `enabled: false` and returns updated settings.
  - `shelf-judge redundancy stage <annotation|integrated>` sets the active stage.
  - `shelf-judge redundancy set <key> <value>` updates a single setting (e.g., `shelf-judge redundancy set similarityThreshold 0.7`).
  - `shelf-judge redundancy status` reports semantic mode, active-run state, freshness, and aggregate per-signal coverage without inference. Status can be refreshed while a run is active; it never exposes note text, prompt content, or per-game note state.
  - `shelf-judge redundancy run` (or the user-facing **Run** action) first presents the direct aggregate preview—provider/model, eligible pair and note-bearing pair counts, signal scope, budget/limits or defensible estimate, retention caveat, and possible integrated-fitness effect—and then starts one explicit execution. Note transmission is authorized for that execution; cached-D use is separately configured. No pair manifest download, inspection, or pair-by-pair acknowledgement is required. The active run reports aggregate progress and failures and can be canceled; cancellation prevents subsequent submissions and activation, while already transmitted text cannot be recalled. Settings/status/read commands never initiate inference. **SUPERSEDED:** the former `refresh` requirement to disclose a frozen pair set for pair-by-pair inspection is not current.
  - Semantic opt-in and C/D weights are separately settable. The approved proposed opt-in starting values are F=7, C=5, D=10; these are not calibrated and do not enable semantic mode automatically.

### Web UI: Settings

- REQ-REDUN-41: The web UI provides a redundancy settings panel (location to be determined by the implementer, likely the settings or preferences area). The panel includes:
  - Master enable/disable toggle
  - Stage selector (annotation / integrated) with a description of what each stage does
  - Similarity threshold slider (0.0 to 1.0, default 0.6)
  - Max penalty slider (0.5 to 5.0, default 2.0)
  - Factual binary/continuous ratio controls (`personalAxes` is not a redundancy setting)
  - Separate semantic opt-in and F/C/D weight controls, visible generation/status and coverage
  - Provider/model disclosure and direct aggregate preview before **Run**, one-execution note authorization/revocation, active-run progress/cancel, refreshable status, and honest aggregate partial-coverage status explaining that each pair uses its currently valid signals and otherwise falls back to factual-only
  - Minimum neighbors input (1+)
  - A "Reset to defaults" action

  Semantic controls keep opt-in distinct from master redundancy/stage controls. Explain F as the factual-cosine weight and C/D as description/note weights; provide the approved proposed opt-in values F=7, C=5, D=10 without presenting them as calibrated. Expose activation status/aggregate coverage, direct aggregate preview followed by explicit **Run**, active-run progress/cancel and refreshable status, and cached-D-use/revocation separately. Provider/model, aggregate scope/counts including note-bearing count, budget/limits or defensible estimate, provider retention caveat, and possible integrated-fitness effect must be disclosed before note-bearing Run. No full pair manifest is required. Ordinary settings changes and reads do not start inference.

  Factual controls are persisted via `PATCH /redundancy/settings`; semantic controls are persisted via `PATCH /redundancy/semantic-settings`. The UI keeps the separate transaction/authority boundary visible, and does not present the aggregate GET as a combined write. The panel is always visible regardless of whether redundancy is enabled, so the user can configure before enabling.

## Scope Exclusions

- **Niche champion display changes.** This spec does not modify the niche champion display feature, its types, or its cluster-based niche computation. The two features coexist independently.
- **Ripple effect preview.** The search preview shows the candidate game's own penalty but does not show how adding the game would change existing games' penalties. The brainstorm's interaction map mentions this possibility but the computation is O(N^2) per candidate and the UX for "your collection's scores would shift by these amounts" is undefined. Deferred.
- **Tournament interaction.** The brainstorm notes that a game redundant by fitness but highly-ranked in tournaments is interesting. This spec does not surface tournament-redundancy divergence.
- **LLM narration.** Rich natural-language interpretation of redundancy patterns is deferred to the LLM narration layer.
- **Per-niche penalty caps.** The penalty is global (`maxPenalty`), not per-cluster or per-neighbor. A per-niche cap would require defining niches, which conflicts with the pairwise approach. If users find the global cap too blunt, a future iteration could weight penalty by similarity magnitude (higher similarity = more penalty contribution per neighbor).
- **Factual-cosine caching.** The factual pairwise cosine remains computed on demand and is not durably cached. This exclusion does not prohibit the approved durable cache of versioned numeric C/D judgments and their minimal source/model/rubric provenance in daemon-owned SQLite. **SUPERSEDED:** the former requirement that pair judgments reside in the revisioned collection and only an atomically published collection generation be read is replaced by SQLite-backed pair-scoped reuse; activation is advisory and inert for scoring, and partial current rows are usable. Note text, prompts, and free-form explanations are never cached.

## Exit Points

| Exit                             | Triggers When                                                                             | Target                              |
| -------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------- |
| Ripple effect preview            | User wants to see how adding a game changes existing games' penalties                     | [STUB: redundancy-ripple-preview]   |
| Tournament-redundancy divergence | User wants to see when tournament results contradict redundancy penalties                 | [STUB: tournament-niche-divergence] |
| LLM narration of redundancy      | Deferred LLM layer interprets redundancy patterns                                         | Extends [DEFERRED: REQ-PROFILE-18]  |
| Factual-cosine caching           | Performance concern with large collections                                                | [STUB: redundancy-caching]          |
| Similarity-weighted penalty      | Global maxPenalty feels too blunt, users want penalty proportional to similarity strength | [STUB: similarity-weighted-penalty] |

## Success Criteria

### Automated Tests (bun test)

- [ ] `computeRedundancyAdjustments` skips pair scoring when factual settings.enabled is false while result construction retains disabled `redundancySimilarityInfo`
- [ ] A game with no neighbors above threshold gets null adjustment
- [ ] A game with fewer neighbors than `minNeighbors` gets null adjustment
- [ ] The highest-scoring game among its neighbors receives zero penalty
- [ ] Penalty is proportional to coverageRatio: 0 betterNeighbors = 0 penalty, all better = maxPenalty
- [ ] Penalty never pushes score below 1.0
- [ ] Tied games (within 0.01) do not count as "better" than each other
- [ ] Vetoed games are excluded from neighbor lists and do not receive adjustments
- [ ] Fully-predicted games do not count toward `betterNeighbors` for actual-scored games
- [ ] Fully-predicted games are penalized normally by actual-scored neighbors
- [ ] `factualComponentWeights` correctly influence the factual cosine (binary-heavy weights group mechanic-similar games; continuous-heavy weights group weight/player-count-similar games)
- [ ] Migration removes personalAxes from redundancy settings while preserving factual binary:continuous ratio; 0/0 becomes 4:3 with notice and semantic mode remains off
- [ ] F/C/D validation rejects non-finite or out-of-range weights; zero-weight signals require no inference
- [ ] Per-pair weighted blend renormalizes over F and only individually valid/current positive-weight C/D components; missing/stale/blocked components are omitted rather than zero, and a cached zero remains present
- [ ] C-only request omits note fields; D-only coverage does not send descriptions; C+D coverage includes both eligible signal sets
- [ ] Partial cache scores pairs with valid current signals immediately and leaves other pairs factual-only; aggregate coverage/status is honest and no complete-coverage activation gate is required
- [ ] Direct aggregate preview and one-click Run, active-run progress/cancel/refresh-status, cached-D revocation, source invalidation, and stale in-flight result fencing are verified; no pair manifest or pair-by-pair acknowledgement is required
- [ ] Wishlist persisted previews remain factual-only when semantic collection scoring is active
- [ ] Changing `similarityThreshold` changes which games are niche neighbors
- [ ] In annotation mode, `FitnessResult.score` is unchanged; `redundancyAdjustment.adjustedScore` reflects penalty
- [ ] In integrated mode, `FitnessResult.score` equals `redundancyAdjustment.adjustedScore`
- [ ] `redundancyAdjustment.originalScore` always equals the pre-penalty fitness score regardless of stage
- [ ] Niche neighbors are sorted by similarity descending
- [ ] Redundancy adjustments are deterministic (identical input produces identical output)
- [ ] `redundancySimilarityInfo` remains observable when `redundancyAdjustment` is null and exposes no per-game note state
- [ ] Aggregate `GET /redundancy/settings` composes factual file values and collection-owned semantic values without exposing note text/state
- [ ] Factual and semantic PATCH endpoints reject fields from the other authority and commit only their own store; failures preserve that store
- [ ] Binary/continuous weight change advances the durable semantic/source fence and withdraws activation before settings-file persistence; failure to advance the collection leaves settings untouched
- [ ] If factual settings-file persistence fails after fence advancement, the PATCH fails, prior settings remain unchanged, and prior activation stays withdrawn
- [ ] An A→B→A binary/continuous weight sequence cannot resurrect prior activation; this remains true after restart and readers validate the durable fence plus factual identity
- [ ] An in-flight Run captured before a factual-weight PATCH cannot activate results after the fence advances
- [ ] PATCHes changing only unrelated factual settings do not advance the semantic/source fence or withdraw activation
- [ ] Factual and semantic PATCH endpoints validate their respective ranges and return 400 for invalid values
- [ ] Each PATCH merges partial updates only within its own authority
- [ ] Pure engine receives complete factual pair coverage plus independently available semantic values/weights; it validates factual cosine and pair identity, composes per-pair blends, and performs no cache, provider, storage, source, or text reads
- [ ] `GET /games/:id` includes safe `redundancySimilarityInfo` when adjustment is null, disabled, or there are no neighbors
- [ ] `GET /games` includes safe `redundancySimilarityInfo` on all scored results regardless of adjustment availability
- [ ] `GET /predictions/bgg/:bggId` includes redundancyPreview when enabled
- [ ] Redundancy preview for a candidate game computes against pre-redundancy collection scores
- [ ] NichePosition rankings use pre-redundancy scores even in integrated mode

### Manual Verification

- [ ] Game detail page shows "Redundancy (preview)" section in annotation mode with correct penalty, neighbors, and niche rank
- [ ] Game detail page shows "Redundancy" section in integrated mode with adjusted primary score
- [ ] Toggling redundancy off removes the redundancy section entirely
- [ ] Collection list "Redundancy-Adjusted" sort orders games by adjusted score
- [ ] Penalty badges on collection list distinguish between annotation (advisory) and integrated (applied) modes
- [ ] Search preview shows redundancy impact for a candidate game with 3+ similar games in collection
- [ ] Redundancy settings panel allows configuring all settings and persists on change
- [ ] Changing stage from annotation to integrated visibly changes primary scores in collection list
- [ ] CLI `shelf-judge redundancy settings` displays current settings
- [ ] CLI `shelf-judge redundancy enable` / `disable` toggles the feature
- [ ] CLI `shelf-judge game <id>` includes redundancy data in text and JSON output

## AI Validation

**Defaults** (apply unless overridden):

- Unit tests with mocked time/network/filesystem
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom:**

- Redundancy engine tested against a hand-constructed collection (6-8 games, known feature vectors, known fitness scores) with expected penalties computed manually
- Test case: 3 games with identical fitness scores and high mutual similarity, verifying all receive zero penalty (no game is "better")
- Test case: a fully-predicted game scoring higher than an actual-scored game in the same niche, verifying the actual-scored game is not penalized by the predicted game
- Test case: a game with 5 neighbors where 3 score higher, verifying penalty is `(3/5) * maxPenalty`
- Test case: annotation mode returns unmodified `FitnessResult.score` and populated `redundancyAdjustment`
- Test case: integrated mode returns modified `FitnessResult.score` equal to `adjustedScore`
- When adding redundancy routes to the daemon, verify that both web proxy route and CLI client helper are updated in the same change (per tournament retro lesson)
- Verify that `NichePosition` rankings are computed from pre-redundancy scores, not post-penalty scores, to avoid circular dependency
- Verify that disabling redundancy returns null for adjustment fields and `redundancySimilarityInfo.status: "disabled"` without computing pairwise similarities (performance short-circuit)

## Constraints

- The fitness formula (`sum(effective_rating * weight) / sum(weights)`) does not change. Redundancy is a post-processing step on the computed score, not a modification to the per-axis formula.
- `FitnessResult` gains `redundancyAdjustment: RedundancyAdjustment | null` and the note-safe `redundancySimilarityInfo` field. The latter is present even when there is no adjustment and contains no owner-note text or per-game note-state details.
- The redundancy engine is a pure-function module. No service-layer dependencies, no storage access, no state.
- `NichePosition` (niche champion display) is unchanged. Cluster-based niche rankings and pairwise redundancy penalties are independent systems.
- The `CollectionProfile` type and profile computation are not modified. The redundancy engine receives complete validated pair similarities from its caller, not from storage, feature-vector services, or the profile.
- Performance: factual pairwise similarity is O(N^2) where N is collection size and remains an offline computation. A collection-wide explicit Run may enumerate up to 19,900 unordered pairs for 200 eligible games; this is a scope upper bound, not a normal-read network workload or usage estimate. The aggregate preview and Run disclose scope/counts and configured limits; active-run status reports progress, cancellation, and failures. Numeric semantic judgments are durably cached in daemon-owned SQLite; factual cosine is not.
- Redundancy computation requires all games' fitness scores. `getGame()` for a single game must compute all scores to determine the penalty. This is a known cost of collection-aware scoring.

## Open Questions

1. **Weight UX.** F/C/D and the within-factual binary:continuous ratio need clear explanations. `personalAxes` is not a redundancy weight. Approved opt-in starting values F=7, C=5, D=10 are proposed, not calibration evidence.

2. **Annotation mode sort stability.** In annotation mode, sorting by "redundancy-adjusted fitness" creates a different ordering than the primary fitness sort. If the user is accustomed to the primary sort and switches to redundancy-adjusted, games shuffle. This is correct behavior (the feature's purpose is to reveal a different ranking) but could be surprising. Consider whether the sort toggle needs a confirmation or explanation tooltip.

## Context

- [Brainstorm: Redundancy and Collection-Awareness Scoring](.lore/work/brainstorm/redundancy-scoring.md): Proposal 1 (pairwise penalty), Proposal 4 (settings), and Proposal 6 (graduated engagement) are the direct sources. The brainstorm recommends pairwise over cluster-based because it captures the gradient of similarity.
- [Spec: Niche Champion Display](.lore/reference/specs/fitness/niche-champion-display.md): Stage 1 of the graduated approach. This spec is Stages 2 and 3. The niche champion display's cluster-based niches and this spec's pairwise penalties are complementary, not competing.
- [Vision](.lore/reference/vision.md): Principle 5 ("The shelf has a carrying capacity") is the driver. Principle 2 (the penalty is fully transparent: original score, penalty amount, neighbors, rank). Principle 1 (the user controls whether and how redundancy affects scores). Tension table: "Collection-aware fitness vs simplicity" defaults to simplicity; the `enabled` toggle respects this.
- [Spec: Prediction Engine](.lore/reference/specs/fitness/prediction-engine.md): Establishes the `PredictionSettings` pattern (REQ-PRED-25a) that `RedundancySettings` follows. Prediction output is consumed by redundancy (one-way dependency).
- [Approved design: Jev-backed redundancy similarity](.lore/work/design/jev-redundancy-similarity.md): Approved design basis for optional C/D signals, consent, migration, cache, and generation policy. Implementation remains pending unless separately verified.
- [Design: MVP Fitness Model](.lore/reference/designs/mvp-fitness-model.md): Defines `FitnessResult` and the scoring formula. This spec adds redundancy adjustment and safe similarity-provenance fields but does not modify the formula.
- [Issue: Deferred Redundancy Scoring](.lore/work/issues/deferred-redundancy-scoring.md): The issue that triggered the brainstorm and this spec.
