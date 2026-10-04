/**
 * Pure, inert P/R/U0 planning for the future unified predictor. This module is deliberately
 * not imported by any production run controller. Phase 3 injects fitness; Phase 4 supplies
 * the sole real predictor behind the same target/reference contract.
 */
import { isEnabledScoringAxis } from "@shelf-judge/shared";
import type { Axis, DurableGame } from "@shelf-judge/shared";
import { normalizeElo, shouldDisplayRanking } from "./elo-engine.js";
import type { StagedSimilarityCapture } from "./staged-similarity-capture.js";
import type { StagedSimilarityPair } from "./prepared-similarity.js";
import type { createPreparedSimilarity } from "./prepared-similarity.js";

type PreparedSimilarity = ReturnType<typeof createPreparedSimilarity>;

export type StagedPredictionRequest =
  | { readonly scope: "collection-all" }
  | { readonly scope: "collection-targets"; readonly targetIds: readonly string[] }
  | { readonly scope: "predict-game"; readonly gameId: string }
  | { readonly scope: "wishlist"; readonly selectedBggIds: readonly number[] };

export interface StagedRunBudget {
  readonly maxProviderAttempts: number;
  /** Positive safe-integer stop threshold, not a provider billing/token ceiling. */
  readonly reportedTokenStopThreshold: number;
  readonly maxRunDurationMs: number;
}

export interface StagedRunAuthorizationState {
  /** Monotonic source mutation generation; this is a live fence, never durable proof identity. */
  readonly mutationGeneration: number;
  /** Current caller/config/consent policy identity, read from authoritative state. */
  readonly policyIdentity: string;
  /** Current exact caller selection identity. */
  readonly selectionIdentity: string;
  /** Identity of the authoritative effective run-budget configuration. */
  readonly budgetIdentity: string;
}

export interface StagedRunAuthorizationReader {
  readCurrent(): StagedRunAuthorizationState | null;
}

export interface StagedRatedReference {
  readonly gameId: string;
  readonly axisIds: readonly string[];
}

export interface StagedPredictionReadiness {
  readonly ratedGameCount: number;
  readonly stage: 0 | 1 | 2 | 3;
  readonly stageThresholds: readonly [number, number, number];
}

export interface StagedActualAxisContext {
  readonly axes: readonly Axis[];
  readonly references: readonly StagedRatedReference[];
  readonly ratingValues: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly readiness: StagedPredictionReadiness;
}

export interface StagedPredictionTarget {
  readonly id: string;
  readonly kind: "collection" | "wishlist";
  readonly missingAxisIds: readonly string[];
  /** Wishlist candidate identity is domain-typed and never confused with a local game ID. */
  readonly bggId?: number;
}

export interface StagedAxisPairInput {
  readonly targetId: string;
  readonly axisId: string;
  readonly referenceGameId: string;
  readonly pair: Readonly<StagedSimilarityPair>;
}

export interface InjectedFitnessResult {
  readonly score: number | null;
  readonly vetoed: boolean;
}

export interface InjectedFitnessInput {
  readonly targets: readonly StagedPredictionTarget[];
  readonly actualAxisContext: StagedActualAxisContext;
  readonly actualReferences: readonly StagedRatedReference[];
  readonly readiness: StagedPredictionReadiness;
  /** Prediction demands within the caller-authorized P set. */
  readonly axisPairs: readonly StagedAxisPairInput[];
  /** Scores are the cache-only pair values resolved for P; null remains unavailable. */
  readonly pairSimilarities: ReadonlyMap<string, number | null>;
  /** Cache-only owned-fitness inputs used to derive wishlist R; never run-authorized P. */
  readonly calculationDependencyPairs: readonly StagedScopePair[];
  readonly calculationDependencySimilarities: ReadonlyMap<string, number | null>;
}

/** A deterministic scope-only seam. It is not the production prediction algorithm. */
export type InjectedFitness = (
  input: InjectedFitnessInput,
) => ReadonlyMap<string, InjectedFitnessResult>;

export interface StagedSimilarityScopeOptions {
  readonly capture: StagedSimilarityCapture;
  readonly prepared: PreparedSimilarity;
  readonly request: StagedPredictionRequest;
  readonly budget: StagedRunBudget;
  readonly authorizationReader: StagedRunAuthorizationReader;
  readonly evaluateFitness: InjectedFitness;
  /** Wishlist calculation needs owned-target evidence to derive R, without authorizing collection P. */
  readonly includeOwnedPredictionDependenciesForWishlist?: boolean;
  readonly observer?: StagedSimilarityScopeObserver;
}

export interface StagedSimilarityScopeObserver {
  onAxisReferenceIndexBuilt?(axisCount: number, membershipCount: number): void;
  onAxisReferenceIndexLookup?(axisId: string, matchingReferenceCount: number): void;
}

export interface StagedScopePair {
  readonly pair: Readonly<StagedSimilarityPair>;
  readonly key: string;
  readonly targetIds: readonly string[];
  readonly axisIds: readonly string[];
  readonly axisReferences: readonly StagedAxisPairInput[];
  readonly requiredSignals: readonly ("C" | "D")[];
}

export interface StagedScopeDisclosure {
  readonly requestKind: StagedPredictionRequest["scope"];
  readonly requestedTargetIds: readonly string[];
  readonly targetIds: readonly string[];
  readonly unavailableTargetIds: readonly string[];
  readonly actualRatedReferenceIds: readonly string[];
  readonly previousOwnedReferenceIds: readonly string[];
  readonly actualRatedReferenceCount: number;
  readonly pPairCount: number;
  readonly rPairCount: number;
  readonly overlapPairCount: number;
  readonly authorizedPairCount: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly requiredSignals: readonly ("C" | "D")[];
  readonly budget: StagedRunBudget;
  /** Opaque source/policy/selection identity; never contains owner-note text. */
  readonly authorizationIdentity: string;
}

export type StagedSimilarityScopeResult =
  | { readonly ok: true; readonly run: FrozenStagedSimilarityRun }
  | { readonly ok: false; readonly reason: string };

export interface FrozenStagedSimilarityRun {
  readonly targets: readonly StagedPredictionTarget[];
  readonly actualReferences: readonly StagedRatedReference[];
  readonly readiness: StagedPredictionReadiness;
  readonly predictionPairs: readonly StagedScopePair[];
  readonly redundancyPairs: readonly StagedScopePair[];
  readonly authorizedPairs: readonly StagedScopePair[];
  readonly disclosure: StagedScopeDisclosure;
  readonly isAuthorized: () => boolean;
  /** Resolver/cache proof freshness is intentionally separate from scope authorization. */
  readonly isCalculationCurrent: () => boolean;
  readonly assertAuthorized: () => void;
  /** One-use internal execution authorization. This performs no provider work. */
  readonly beginExecution: () => void;
  readonly isExecutionStarted: () => boolean;
}

function sortedUnique<T extends string | number>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function stableKey(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableKey(child)}`).join(",")}}`;
}

function validateBudget(budget: StagedRunBudget): void {
  if (
    !Number.isSafeInteger(budget.maxProviderAttempts) ||
    budget.maxProviderAttempts < 1 ||
    budget.maxProviderAttempts > 75_000 ||
    !Number.isSafeInteger(budget.reportedTokenStopThreshold) ||
    budget.reportedTokenStopThreshold < 1 ||
    !Number.isSafeInteger(budget.maxRunDurationMs) ||
    budget.maxRunDurationMs < 60_000 ||
    budget.maxRunDurationMs > 720 * 60_000
  ) {
    throw new TypeError("Invalid frozen run budget");
  }
}

function actualRating(
  game: DurableGame,
  axis: Axis,
  capture: StagedSimilarityCapture,
  canDisplayTournamentRanking: boolean,
): number | null {
  if (axis.source === "personal") {
    const value = game.ratings?.[axis.id];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  if (axis.source === "tournament") {
    const stats = capture.sources.tournament.gameStats[game.id];
    if (!canDisplayTournamentRanking || !stats || stats.comparisonCount <= 0) return null;
    return normalizeElo(
      stats.eloRating ?? 1500,
      capture.sources.tournament.settings.normalizationHalfWidth,
    );
  }
  return null;
}

function actualReferences(
  capture: StagedSimilarityCapture,
  axes: readonly Axis[],
): { references: readonly StagedRatedReference[]; values: Map<string, Map<string, number>> } {
  const references: StagedRatedReference[] = [];
  const values = new Map<string, Map<string, number>>();
  const tournamentData = capture.sources.tournament;
  const tournamentGamesWithComparisons = Object.values(tournamentData.gameStats).filter(
    (stats) => stats.comparisonCount > 0,
  ).length;
  const canDisplayTournamentRanking = shouldDisplayRanking(tournamentGamesWithComparisons);
  for (const game of capture.sources.collection.games) {
    const byAxis = new Map<string, number>();
    for (const axis of axes) {
      const value = actualRating(game, axis, capture, canDisplayTournamentRanking);
      if (value !== null) byAxis.set(axis.id, value);
    }
    if (byAxis.size > 0) {
      values.set(game.id, byAxis);
      references.push(
        Object.freeze({ gameId: game.id, axisIds: Object.freeze([...byAxis.keys()].sort()) }),
      );
    }
  }
  return { references: Object.freeze(references), values };
}

/** One actual-label/readiness derivation shared by scope planning and unavailable projections. */
export function deriveStagedActualAxisContext(
  capture: StagedSimilarityCapture,
): StagedActualAxisContext | null {
  const axes = Object.freeze(
    capture.sources.collection.axes
      .filter(isEnabledScoringAxis)
      .filter((axis) => axis.source === "personal" || axis.source === "tournament"),
  );
  const { references, values } = actualReferences(capture, axes);
  const thresholds = capture.sources.predictionSettings.stageThresholds;
  if (
    !Array.isArray(thresholds) ||
    thresholds.length !== 3 ||
    thresholds.some((threshold) => !Number.isSafeInteger(threshold) || threshold < 1)
  ) {
    return null;
  }
  const ratedGameCount = references.length;
  const readiness: StagedPredictionReadiness = Object.freeze({
    ratedGameCount,
    stage:
      ratedGameCount >= thresholds[2]
        ? 3
        : ratedGameCount >= thresholds[1]
          ? 2
          : ratedGameCount >= thresholds[0]
            ? 1
            : 0,
    stageThresholds: Object.freeze([thresholds[0], thresholds[1], thresholds[2]] as const),
  });
  return Object.freeze({ axes, references, ratingValues: values, readiness });
}

function pairKey(pair: StagedSimilarityPair): string {
  return pair.domain === "collection"
    ? JSON.stringify(["collection", ...sortedUnique([pair.gameAId, pair.gameBId])])
    : JSON.stringify(["wishlist-candidate", pair.candidateBggId, pair.ownedGameId]);
}

function freezePair(pair: StagedSimilarityPair): Readonly<StagedSimilarityPair> {
  return Object.freeze({ ...pair });
}

function pairSignalRequirements(
  capture: StagedSimilarityCapture,
  pair: StagedSimilarityPair,
): readonly ("C" | "D")[] {
  const semantic = capture.sources.similaritySettings.semantic;
  if (pair.domain === "wishlist-candidate") {
    return semantic.enabled && semantic.description > 0 ? Object.freeze(["C"]) : Object.freeze([]);
  }
  const signals: ("C" | "D")[] = [];
  if (semantic.enabled && semantic.description > 0) signals.push("C");
  if (semantic.enabled && semantic.ownerNote > 0) signals.push("D");
  return Object.freeze(signals);
}

function freezePairMap(pairs: Map<string, MutablePair>): readonly StagedScopePair[] {
  return Object.freeze(
    [...pairs.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((item) => {
        const frozenPair = freezePair(item.pair);
        const axisReferences = [...item.axisReferences.values()].map((reference) =>
          Object.freeze({
            targetId: reference.targetId,
            axisId: reference.axisId,
            referenceGameId: reference.referenceGameId,
            pair: frozenPair,
          }),
        );
        return Object.freeze({
          pair: frozenPair,
          key: item.key,
          targetIds: Object.freeze([...item.targetIds].sort()),
          axisIds: Object.freeze([...item.axisIds].sort()),
          axisReferences: Object.freeze(
            axisReferences.sort((a, b) =>
              `${a.targetId}\0${a.axisId}\0${a.referenceGameId}`.localeCompare(
                `${b.targetId}\0${b.axisId}\0${b.referenceGameId}`,
              ),
            ),
          ),
          requiredSignals: Object.freeze([...item.requiredSignals]),
        });
      }),
  );
}

interface MutablePair {
  pair: StagedSimilarityPair;
  key: string;
  targetIds: Set<string>;
  axisIds: Set<string>;
  axisReferences: Map<string, StagedAxisPairInput>;
  requiredSignals: readonly ("C" | "D")[];
}

function addPair(
  map: Map<string, MutablePair>,
  capture: StagedSimilarityCapture,
  pair: StagedSimilarityPair,
  targetId: string,
  axisId: string,
  referenceGameId?: string,
): void {
  const key = pairKey(pair);
  const existing = map.get(key);
  if (existing) {
    existing.targetIds.add(targetId);
    existing.axisIds.add(axisId);
    if (referenceGameId !== undefined) {
      existing.axisReferences.set(
        `${targetId}\0${axisId}\0${referenceGameId}`,
        Object.freeze({ targetId, axisId, referenceGameId, pair }),
      );
    }
    return;
  }
  const axisReferences = new Map<string, StagedAxisPairInput>();
  if (referenceGameId !== undefined) {
    axisReferences.set(
      `${targetId}\0${axisId}\0${referenceGameId}`,
      Object.freeze({ targetId, axisId, referenceGameId, pair }),
    );
  }
  map.set(key, {
    pair,
    key,
    targetIds: new Set([targetId]),
    axisIds: new Set([axisId]),
    axisReferences,
    requiredSignals: pairSignalRequirements(capture, pair),
  });
}

function resolvePairFor(
  kind: StagedPredictionTarget["kind"],
  target: StagedPredictionTarget,
  referenceGameId: string,
): StagedSimilarityPair {
  if (kind === "wishlist") {
    if (target.bggId === undefined) throw new TypeError("Wishlist target lacks BGG identity");
    return {
      domain: "wishlist-candidate",
      candidateBggId: target.bggId,
      ownedGameId: referenceGameId,
    };
  }
  if (target.id === referenceGameId)
    throw new TypeError("Self references are not prediction pairs");
  return { domain: "collection", gameAId: target.id, gameBId: referenceGameId };
}

export function stagedRunSelectionIdentity(request: StagedPredictionRequest): string {
  switch (request.scope) {
    case "collection-all":
      return "collection-all";
    case "collection-targets":
      return stableKey({ scope: request.scope, targetIds: sortedUnique(request.targetIds) });
    case "predict-game":
      return stableKey({ scope: request.scope, gameId: request.gameId });
    case "wishlist":
      return stableKey({
        scope: request.scope,
        selectedBggIds: sortedUnique(request.selectedBggIds),
      });
  }
}

export function stagedRunBudgetIdentity(budget: StagedRunBudget): string {
  return stableKey(budget);
}

function freezeRequest(request: StagedPredictionRequest): StagedPredictionRequest {
  switch (request.scope) {
    case "collection-all":
      return Object.freeze({ scope: request.scope });
    case "collection-targets":
      return Object.freeze({
        scope: request.scope,
        targetIds: Object.freeze(sortedUnique(request.targetIds)),
      });
    case "predict-game":
      return Object.freeze({ ...request });
    case "wishlist":
      return Object.freeze({
        scope: request.scope,
        selectedBggIds: Object.freeze(sortedUnique(request.selectedBggIds)),
      });
  }
}

/** Derive P, resolve P cache-only, run an injected fitness seam, derive R, then seal U0. */
export function prepareStagedSimilarityScope(
  options: StagedSimilarityScopeOptions,
): StagedSimilarityScopeResult {
  const { capture, prepared, evaluateFitness, authorizationReader } = options;
  validateBudget(options.budget);
  const budget = Object.freeze({ ...options.budget });
  if (!capture.isSourceCurrent()) return { ok: false, reason: "source-not-current" };
  if (!authorizationReader || typeof authorizationReader.readCurrent !== "function") {
    return { ok: false, reason: "authorization-reader-unavailable" };
  }
  let initialAuthorization: StagedRunAuthorizationState | null;
  try {
    initialAuthorization = authorizationReader.readCurrent();
  } catch {
    initialAuthorization = null;
  }
  if (
    !initialAuthorization ||
    !Number.isSafeInteger(initialAuthorization.mutationGeneration) ||
    initialAuthorization.mutationGeneration < 0 ||
    !initialAuthorization.policyIdentity ||
    !initialAuthorization.selectionIdentity ||
    !initialAuthorization.budgetIdentity
  ) {
    return { ok: false, reason: "authorization-state-unavailable" };
  }
  const frozenAuthorizationState: StagedRunAuthorizationState = Object.freeze({
    mutationGeneration: initialAuthorization.mutationGeneration,
    policyIdentity: initialAuthorization.policyIdentity,
    selectionIdentity: initialAuthorization.selectionIdentity,
    budgetIdentity: initialAuthorization.budgetIdentity,
  });

  const request = freezeRequest(options.request);
  const requestIdentity = stagedRunSelectionIdentity(request);
  if (frozenAuthorizationState.selectionIdentity !== requestIdentity) {
    return { ok: false, reason: "selection-identity-mismatch" };
  }
  if (frozenAuthorizationState.budgetIdentity !== stagedRunBudgetIdentity(budget)) {
    return { ok: false, reason: "budget-identity-mismatch" };
  }
  const collection = capture.sources.collection;
  const gameById = new Map(collection.games.map((game) => [game.id, game]));
  if (gameById.size !== collection.games.length) return { ok: false, reason: "duplicate-game-id" };
  const actualContext = deriveStagedActualAxisContext(capture);
  if (!actualContext) return { ok: false, reason: "prediction-readiness-settings-invalid" };
  const { axes, references, ratingValues, readiness } = actualContext;
  const referenceIdsByAxis = new Map<string, string[]>();
  let axisReferenceMembershipCount = 0;
  for (const reference of references) {
    for (const axisId of reference.axisIds) {
      axisReferenceMembershipCount++;
      const ids = referenceIdsByAxis.get(axisId);
      if (ids) ids.push(reference.gameId);
      else referenceIdsByAxis.set(axisId, [reference.gameId]);
    }
  }
  options.observer?.onAxisReferenceIndexBuilt?.(axes.length, axisReferenceMembershipCount);
  const referencesForAxis = (axisId: string): readonly string[] => {
    const referenceIds = referenceIdsByAxis.get(axisId) ?? [];
    options.observer?.onAxisReferenceIndexLookup?.(axisId, referenceIds.length);
    return referenceIds;
  };
  const unavailableTargetIds: string[] = [];
  const targets: StagedPredictionTarget[] = [];
  const pMap = new Map<string, MutablePair>();
  const calculationDependencyMap = new Map<string, MutablePair>();
  const previousOwnedReferenceIds = references
    .filter((reference) => gameById.get(reference.gameId)?.ownership === "previously-owned")
    .map((reference) => reference.gameId)
    .sort();

  if (request.scope === "wishlist") {
    const selected = sortedUnique(request.selectedBggIds);
    if (selected.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      return { ok: false, reason: "invalid-wishlist-selection" };
    }
    const candidates = new Map(
      (capture.sources.wishlistCandidates ?? []).map((candidate) => [candidate.bggId, candidate]),
    );
    for (const bggId of selected) {
      const candidate = candidates.get(bggId);
      if (!candidate) {
        unavailableTargetIds.push(String(bggId));
        continue;
      }
      const target: StagedPredictionTarget = Object.freeze({
        id: `wishlist:${bggId}`,
        kind: "wishlist",
        bggId,
        missingAxisIds: Object.freeze(axes.map((axis) => axis.id).sort()),
      });
      targets.push(target);
      for (const axis of axes) {
        for (const referenceGameId of referencesForAxis(axis.id)) {
          const pair = resolvePairFor("wishlist", target, referenceGameId);
          addPair(pMap, capture, pair, target.id, axis.id, referenceGameId);
        }
      }
    }
    if (options.includeOwnedPredictionDependenciesForWishlist && targets.length > 0) {
      for (const game of collection.games) {
        if (game.ownership !== "owned" || !game.bggData) continue;
        const missingAxisIds = axes
          .filter((axis) => !ratingValues.get(game.id)?.has(axis.id))
          .map((axis) => axis.id);
        for (const axisId of missingAxisIds) {
          for (const referenceGameId of referencesForAxis(axisId)) {
            if (referenceGameId === game.id) continue;
            addPair(
              calculationDependencyMap,
              capture,
              { domain: "collection", gameAId: game.id, gameBId: referenceGameId },
              game.id,
              axisId,
              referenceGameId,
            );
          }
        }
      }
    }
  } else {
    let requestedIds: string[];
    if (request.scope === "collection-all") {
      requestedIds = collection.games
        .filter((game) => game.ownership !== "previously-owned")
        .map((game) => game.id);
    } else if (request.scope === "collection-targets") {
      requestedIds = sortedUnique(request.targetIds);
    } else {
      requestedIds = [request.gameId];
    }
    for (const gameId of requestedIds) {
      const game = gameById.get(gameId);
      if (!game) {
        unavailableTargetIds.push(gameId);
        continue;
      }
      if (request.scope === "collection-targets" && game.ownership === "previously-owned") {
        unavailableTargetIds.push(gameId);
        continue;
      }
      const missingAxisIds = axes
        .filter((axis) => !ratingValues.get(gameId)?.has(axis.id))
        .map((axis) => axis.id)
        .sort();
      if (missingAxisIds.length === 0) continue;
      if (!game.bggData) {
        unavailableTargetIds.push(gameId);
        continue;
      }
      const target: StagedPredictionTarget = Object.freeze({
        id: game.id,
        kind: "collection",
        missingAxisIds: Object.freeze(missingAxisIds),
      });
      targets.push(target);
      for (const axisId of missingAxisIds) {
        for (const referenceGameId of referencesForAxis(axisId)) {
          if (referenceGameId === gameId) continue;
          addPair(
            pMap,
            capture,
            resolvePairFor("collection", target, referenceGameId),
            gameId,
            axisId,
            referenceGameId,
          );
        }
      }
    }
  }

  const pPairs = freezePairMap(pMap);
  const calculationDependencyPairs = freezePairMap(calculationDependencyMap);
  prepared.resolvePairs([...pPairs, ...calculationDependencyPairs].map((entry) => entry.pair));
  const pSimilarities = new Map<string, number | null>();
  for (const entry of pPairs) pSimilarities.set(entry.key, prepared.similarity(entry.pair));
  const calculationDependencySimilarities = new Map<string, number | null>();
  for (const entry of calculationDependencyPairs) {
    calculationDependencySimilarities.set(entry.key, prepared.similarity(entry.pair));
  }
  const injected = evaluateFitness(
    Object.freeze({
      targets: Object.freeze([...targets]),
      actualAxisContext: actualContext,
      actualReferences: references,
      readiness,
      axisPairs: Object.freeze(pPairs.flatMap((entry) => entry.axisReferences)),
      pairSimilarities: pSimilarities,
      calculationDependencyPairs,
      calculationDependencySimilarities,
    }),
  );
  if (
    !injected ||
    typeof injected.get !== "function" ||
    typeof injected.entries !== "function" ||
    [...injected.entries()].some(
      ([id, value]) =>
        typeof id !== "string" ||
        value === null ||
        typeof value !== "object" ||
        typeof value.vetoed !== "boolean" ||
        (value.score !== null &&
          (typeof value.score !== "number" || !Number.isFinite(value.score))),
    )
  ) {
    return { ok: false, reason: "fitness-fixture-invalid" };
  }

  // The injected fixture must report current post-prediction fitness for every owned member
  // that participates in redundancy; missing/unavailable scores are deliberately not eligible.
  const ownedEligible = collection.games
    .filter((game) => game.ownership === "owned")
    .filter((game) => {
      const fitness = injected.get(game.id);
      return (
        fitness !== undefined &&
        typeof fitness.vetoed === "boolean" &&
        fitness.vetoed === false &&
        typeof fitness.score === "number" &&
        Number.isFinite(fitness.score) &&
        fitness.score > 0
      );
    })
    .map((game) => game.id)
    .sort();
  const rMap = new Map<string, MutablePair>();
  if (request.scope === "wishlist") {
    for (const target of targets) {
      for (const ownedId of ownedEligible) {
        if (target.bggId === undefined) continue;
        // Wishlist-owned fitness is eligibility only. Pair authorization remains wishlist-domain C_ONLY.
        const pair: StagedSimilarityPair = {
          domain: "wishlist-candidate",
          candidateBggId: target.bggId,
          ownedGameId: ownedId,
        };
        addPair(rMap, capture, pair, target.id, "redundancy");
      }
    }
  } else {
    for (let i = 0; i < ownedEligible.length; i++) {
      const gameAId = ownedEligible[i];
      if (gameAId === undefined) continue;
      for (let j = i + 1; j < ownedEligible.length; j++) {
        const gameBId = ownedEligible[j];
        if (gameBId === undefined) continue;
        addPair(
          rMap,
          capture,
          { domain: "collection", gameAId, gameBId },
          `${gameAId},${gameBId}`,
          "redundancy",
        );
      }
    }
  }
  const rPairs = freezePairMap(rMap);
  const pKeys = new Set(pPairs.map((entry) => entry.key));
  const overlapPairCount = rPairs.filter((entry) => pKeys.has(entry.key)).length;
  const rOnly = rPairs.filter((entry) => !pKeys.has(entry.key));
  prepared.resolvePairs(rOnly.map((entry) => entry.pair));
  const authorizedMap = new Map<string, MutablePair>();
  for (const entry of [...pPairs, ...rPairs]) {
    const existing = authorizedMap.get(entry.key);
    if (existing) {
      entry.targetIds.forEach((id) => existing.targetIds.add(id));
      entry.axisIds.forEach((id) => existing.axisIds.add(id));
      for (const value of entry.axisReferences) {
        existing.axisReferences.set(
          `${value.targetId}\0${value.axisId}\0${value.referenceGameId}`,
          value,
        );
      }
    } else {
      authorizedMap.set(entry.key, {
        pair: entry.pair,
        key: entry.key,
        targetIds: new Set(entry.targetIds),
        axisIds: new Set(entry.axisIds),
        axisReferences: new Map(
          entry.axisReferences.map((value) => [
            `${value.targetId}\0${value.axisId}\0${value.referenceGameId}`,
            value,
          ]),
        ),
        requiredSignals: entry.requiredSignals,
      });
    }
  }
  const authorizedPairs = freezePairMap(authorizedMap);
  prepared.sealProof();
  if (!prepared.isCurrent()) return { ok: false, reason: "cache-or-source-changed-during-preview" };
  const initialAuthKey = stableKey(frozenAuthorizationState);
  const frozenAuthorizationIdentity = stableKey({
    source: capture.durableIdentity,
    requestIdentity,
    selectionIdentity: frozenAuthorizationState.selectionIdentity,
    budgetIdentity: frozenAuthorizationState.budgetIdentity,
    policyIdentity: frozenAuthorizationState.policyIdentity,
    mutationGeneration: frozenAuthorizationState.mutationGeneration,
    budget,
    authorizedPairs: authorizedPairs.map(({ key, requiredSignals }) => ({ key, requiredSignals })),
  });

  const currentAuthorization = (): StagedRunAuthorizationState | null => {
    try {
      return authorizationReader.readCurrent();
    } catch {
      return null;
    }
  };
  const isAuthorized = (): boolean => {
    if (!capture.isSourceCurrent()) return false;
    const current = currentAuthorization();
    return current !== null && stableKey(current) === initialAuthKey;
  };
  let executionStarted = false;
  const cacheCounts = { hits: 0, misses: 0 };
  for (const entry of authorizedPairs) {
    const evidence = prepared.evidence(entry.pair);
    for (const signal of entry.requiredSignals) {
      const state = signal === "C" ? evidence?.description.state : evidence?.ownerNote.state;
      if (state === "available") cacheCounts.hits++;
      else cacheCounts.misses++;
    }
  }
  const disclosure: StagedScopeDisclosure = Object.freeze({
    requestKind: request.scope,
    requestedTargetIds: Object.freeze(
      request.scope === "collection-all"
        ? collection.games
            .filter((game) => game.ownership !== "previously-owned")
            .map((game) => game.id)
            .sort()
        : request.scope === "collection-targets"
          ? [...request.targetIds]
          : request.scope === "predict-game"
            ? [request.gameId]
            : request.selectedBggIds.map(String),
    ),
    targetIds: Object.freeze(targets.map((target) => target.id).sort()),
    unavailableTargetIds: Object.freeze(sortedUnique(unavailableTargetIds.map(String))),
    actualRatedReferenceIds: Object.freeze(references.map((reference) => reference.gameId).sort()),
    previousOwnedReferenceIds: Object.freeze(previousOwnedReferenceIds),
    actualRatedReferenceCount: references.length,
    pPairCount: pPairs.length,
    rPairCount: rPairs.length,
    overlapPairCount,
    authorizedPairCount: authorizedPairs.length,
    cacheHits: cacheCounts.hits,
    cacheMisses: cacheCounts.misses,
    requiredSignals: Object.freeze(
      sortedUnique(authorizedPairs.flatMap((entry) => entry.requiredSignals)),
    ),
    budget,
    authorizationIdentity: frozenAuthorizationIdentity,
  });
  if (!isAuthorized()) return { ok: false, reason: "authorization-changed-during-preview" };
  const run: FrozenStagedSimilarityRun = Object.freeze({
    targets: Object.freeze([...targets]),
    actualReferences: references,
    readiness,
    predictionPairs: pPairs,
    redundancyPairs: rPairs,
    authorizedPairs,
    disclosure,
    isAuthorized,
    isCalculationCurrent: () => prepared.isCurrent(),
    assertAuthorized(): void {
      if (!isAuthorized()) throw new Error("Frozen similarity run authorization is stale");
    },
    beginExecution(): void {
      if (executionStarted) throw new Error("Frozen similarity run is one-use");
      if (!isAuthorized()) throw new Error("Frozen similarity run authorization is stale");
      executionStarted = true;
    },
    isExecutionStarted: () => executionStarted,
  });
  return { ok: true, run };
}
