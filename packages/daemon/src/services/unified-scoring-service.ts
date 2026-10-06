import type {
  Collection,
  FitnessResult,
  RedundancySettings,
  RedundancyAdjustment,
  RedundancySimilarityInfo,
  WishlistEntry,
} from "@shelf-judge/shared";
import { CollectionSchema } from "@shelf-judge/shared";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { JevPairCache } from "./jev-pair-cache-service.js";
import type { StagedSimilarityPair, StagedSimilarityEvidence } from "./prepared-similarity.js";
import type { PreparedSimilarityObserver } from "./prepared-similarity.js";
import type { FitnessService } from "./fitness-service.js";
import type { StorageService, JevSourceSnapshot } from "./storage-service.js";
import {
  captureProposedStagedSimilaritySources,
  captureStagedSimilaritySources,
  type StagedSimilarityCapture,
  type StagedSimilaritySources,
  type StagedWishlistCandidateSource,
  type VerifiedWishlistRefreshOverlay,
  isVerifiedWishlistRefreshOverlay,
} from "./staged-similarity-capture.js";
import type { ProposedStagedSimilarityCapture } from "./staged-similarity-capture.js";
import { captureSimilaritySettings } from "./unified-similarity.js";
import {
  prepareUnifiedCollectionPipeline,
  type UnifiedCollectionPipelineObserver,
  type UnifiedCollectionPipelineResult,
} from "./unified-collection-pipeline.js";
import {
  computeUnifiedWishlistProjectionWithCalculation,
  type UnifiedWishlistProjectionObserver,
} from "./unified-wishlist-projection.js";
import type {
  StagedPredictionRequest,
  StagedRunBudget,
  StagedScopePair,
  StagedPredictionReadiness,
  StagedRunAuthorizationReader,
} from "./staged-similarity-scope.js";
import type { SemanticScoringInputProofV2 } from "../../../shared/src/semantic-scoring-input-proof-v2.js";
import {
  canonicalSha256,
  profileSourceCoordinatorFor,
  wishlistMutationGenerationFor,
} from "./profile-source-coordinator.js";
import type { SourceVector } from "./source-vector.js";
import { createLogger } from "./logger.js";

const DEFAULT_BUDGET: StagedRunBudget = Object.freeze({
  maxProviderAttempts: 1_000,
  reportedTokenStopThreshold: 2_000_000,
  maxRunDurationMs: 30 * 60_000,
});

export interface UnifiedSourceFrame {
  readonly kind: "current" | "proposed-collection";
  /** Private and immutable. Never serialize or attach this to a public/profile projection. */
  readonly sources: StagedSimilaritySources;
  readonly capture: StagedSimilarityCapture;
  readonly redundancySettings: RedundancySettings;
  readonly wishlistEntries: readonly WishlistEntry[];
  readonly wishlistCandidateBggIds: readonly number[];
  readonly freshnessEpoch: string;
  readonly externalEpoch: string;
  readonly wishlistGeneration: string;
  readonly sourceVector: SourceVector;
}

export interface ProposedCollectionInput {
  readonly prior: Collection;
  readonly proposed: Collection;
}

export interface ProposedCollectionEvaluation {
  readonly kind: "proposed-collection";
  readonly collection: Collection;
  readonly redundancySettings: RedundancySettings;
  calculate(
    request: StagedPredictionRequest,
    requestOptions: UnifiedScoringRequestOptions,
  ): UnifiedCalculation;
  accept<Value>(calculation: UnifiedCalculation, acceptSync: () => Value): Promise<Value | null>;
  /** Refreshed persisted-source fence; intentionally independent of cache revision. */
  assertBaseCurrent(): Promise<boolean>;
}

export interface UnifiedScoringServiceOptions {
  readonly storageService: StorageService;
  readonly cache: JevPairCache | null;
  readonly fitnessService: FitnessService;
  readonly coordinator?: ReturnType<typeof profileSourceCoordinatorFor>;
  readonly budget?: StagedRunBudget;
  readonly collectionObserver?: UnifiedCollectionPipelineObserver;
  readonly preparedObserver?: PreparedSimilarityObserver;
  readonly wishlistObserver?: UnifiedWishlistProjectionObserver;
}

export interface UnifiedCalculation {
  readonly request: StagedPredictionRequest;
  readonly collectionFitness: ReadonlyMap<string, FitnessResult | null>;
  readonly actualFitness: ReadonlyMap<string, FitnessResult | null>;
  readonly targetFitness: ReadonlyMap<string, FitnessResult | null>;
  readonly redundancyAdjustments: ReadonlyMap<string, RedundancyAdjustment>;
  readonly wishlistResults: readonly import("../../../shared/src/wishlist-current-projection-v2.js").WishlistEntryReadResultV2[];
  readonly unavailableSelectionIds: readonly string[];
  readonly unavailableTargetIds: readonly string[];
  readonly readiness: StagedPredictionReadiness;
  readonly proof: SemanticScoringInputProofV2;
  readonly predictionPairs: readonly StagedScopePair[];
  readonly redundancyPairs: readonly StagedScopePair[];
  readonly calculationDependencyPairs: readonly StagedScopePair[];
  similarity(pair: StagedSimilarityPair): number | null;
  evidence(pair: StagedSimilarityPair): StagedSimilarityEvidence | null;
  redundancySimilarityStatus(gameId: string): RedundancySimilarityInfo["status"];
  isCurrent(): boolean;
  isReusable(): boolean;
}

export type UnifiedScoringRequestOptions = {
  readonly includeRedundancy: boolean;
};

export interface UnifiedScoringService {
  capture(input?: {
    readonly includeWishlist?: boolean;
    readonly verifiedRefreshOverlays?: readonly VerifiedWishlistRefreshOverlay[];
  }): Promise<UnifiedSourceFrame>;
  prepareProposedCollection(input: ProposedCollectionInput): Promise<ProposedCollectionEvaluation>;
  calculate(
    frame: UnifiedSourceFrame,
    request: StagedPredictionRequest,
    requestOptions: UnifiedScoringRequestOptions,
  ): UnifiedCalculation;
  prepareRun(
    frame: UnifiedSourceFrame,
    request: StagedPredictionRequest,
    budget: StagedRunBudget,
    authorizationReader: StagedRunAuthorizationReader,
  ): UnifiedCollectionPipelineResult;
  isSourceCurrent(frame: UnifiedSourceFrame): Promise<boolean>;
  publishCurrent<Value>(
    calculation: UnifiedCalculation,
    publishSync: () => Value,
  ): Promise<Value | null>;
}

const unavailableCache = Object.freeze({
  available: false,
  mutationRevision: () => null,
  lookup: () => null,
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function readonlyMap<K, V>(map: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const copy = new Map(
    [...map].map(([key, value]) => [
      key,
      value !== null && typeof value === "object" ? deepFreeze(structuredClone(value)) : value,
    ]),
  );
  return Object.freeze({
    get size() {
      return copy.size;
    },
    get(key: K) {
      return copy.get(key);
    },
    has(key: K) {
      return copy.has(key);
    },
    entries() {
      return copy.entries();
    },
    keys() {
      return copy.keys();
    },
    values() {
      return copy.values();
    },
    forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) {
      for (const [key, value] of copy) callback.call(thisArg, value, key, this);
    },
    [Symbol.iterator]() {
      return copy[Symbol.iterator]();
    },
  });
}

function sameLiveVector(left: SourceVector, right: SourceVector): boolean {
  return (
    left.available === right.available &&
    left.processEpoch === right.processEpoch &&
    left.changeToken === right.changeToken
  );
}

function normalizeRequest(request: StagedPredictionRequest): StagedPredictionRequest {
  switch (request.scope) {
    case "collection-all":
      return Object.freeze({ scope: request.scope });
    case "collection-targets":
      return Object.freeze({
        scope: request.scope,
        targetIds: Object.freeze([...new Set(request.targetIds)].sort()),
      });
    case "predict-game":
      return Object.freeze({ ...request });
    case "wishlist":
      return Object.freeze({
        scope: request.scope,
        selectedBggIds: Object.freeze(
          [...new Set(request.selectedBggIds)].sort((left, right) => left - right),
        ),
      });
  }
}

function createSimilarityStatusResolver(
  frame: UnifiedSourceFrame,
  pairs: readonly StagedScopePair[],
  evidenceFor: (pair: StagedSimilarityPair) => StagedSimilarityEvidence | null,
): (gameId: string) => RedundancySimilarityInfo["status"] {
  const semantic = frame.capture.sources.similaritySettings.semantic;
  const requiredComponents = [
    ...(semantic.enabled && semantic.description > 0 ? (["description"] as const) : []),
    ...(semantic.enabled && semantic.ownerNote > 0 ? (["ownerNote"] as const) : []),
  ];
  const pairsByGame = new Map<string, StagedSimilarityPair[]>();
  for (const { pair } of pairs) {
    if (pair.domain !== "collection") continue;
    for (const gameId of [pair.gameAId, pair.gameBId]) {
      const indexed = pairsByGame.get(gameId) ?? [];
      indexed.push(pair);
      pairsByGame.set(gameId, indexed);
    }
  }
  return (gameId) => {
    if (!frame.redundancySettings.enabled) return "disabled";
    if (requiredComponents.length === 0) return "factual";
    const gamePairs = pairsByGame.get(gameId) ?? [];
    if (gamePairs.length === 0) return "factual";
    let available = 0;
    let missing = 0;
    for (const pair of gamePairs) {
      const evidence = evidenceFor(pair);
      for (const component of requiredComponents) {
        if (evidence?.[component].state === "available") available += 1;
        else missing += 1;
      }
    }
    if (available === 0) return "factual";
    return missing === 0 ? "ready" : "partial";
  };
}

function candidateSources(
  entries: readonly WishlistEntry[],
): readonly StagedWishlistCandidateSource[] {
  return entries.flatMap((entry) =>
    entry.bggSource
      ? [{ bggId: entry.bggId, name: entry.name, bggSource: structuredClone(entry.bggSource) }]
      : [],
  );
}

function selectCandidateSources(
  entries: readonly WishlistEntry[],
  overlays: readonly VerifiedWishlistRefreshOverlay[] = [],
): readonly StagedWishlistCandidateSource[] {
  const overlayById = new Map(
    overlays.map(({ candidate }) => [candidate.bggId, candidate] as const),
  );
  const available = new Map(
    candidateSources(entries)
      .filter((candidate) => !overlayById.has(candidate.bggId))
      .map((candidate) => [candidate.bggId, candidate] as const),
  );
  for (const [bggId, candidate] of overlayById) available.set(bggId, candidate);
  return Object.freeze([...available.values()].sort((left, right) => left.bggId - right.bggId));
}

function wishlistIdentity(entries: readonly WishlistEntry[]): string {
  return canonicalSha256(
    entries
      .map((entry) => ({
        id: entry.id,
        bggId: entry.bggId,
        name: entry.name,
        yearPublished: entry.yearPublished,
        thumbnailUrl: entry.thumbnailUrl,
        addedAt: entry.addedAt,
        bggSource: entry.bggSource ?? null,
      }))
      .sort((left, right) => left.bggId - right.bggId || left.id.localeCompare(right.id)),
  );
}

function verifiedOverlays(
  overlays: readonly VerifiedWishlistRefreshOverlay[] | undefined,
): readonly VerifiedWishlistRefreshOverlay[] {
  if (!overlays) return Object.freeze([]);
  const seen = new Set<number>();
  return Object.freeze(
    overlays.map((overlay) => {
      if (
        !overlay ||
        overlay.kind !== "verified-wishlist-refresh-overlay" ||
        !isVerifiedWishlistRefreshOverlay(overlay)
      ) {
        throw new TypeError("Wishlist candidate overlay is not a verified BGG refresh");
      }
      const { bggId } = overlay.candidate;
      if (seen.has(bggId)) throw new TypeError("Duplicate wishlist candidate overlay ID");
      seen.add(bggId);
      return overlay;
    }),
  );
}

function withUnpersistedCandidates(
  entries: readonly WishlistEntry[],
  candidates: readonly StagedWishlistCandidateSource[],
): readonly WishlistEntry[] {
  const byId = new Map(candidates.map((candidate) => [candidate.bggId, candidate]));
  const refreshed = entries.map((entry) => {
    const candidate = byId.get(entry.bggId);
    return candidate ? { ...entry, name: candidate.name, bggSource: candidate.bggSource } : entry;
  });
  const existingIds = new Set(entries.map((entry) => entry.bggId));
  const additions = candidates.flatMap((candidate) =>
    existingIds.has(candidate.bggId)
      ? []
      : [
          {
            id: randomUUID(),
            bggId: candidate.bggId,
            name: candidate.name,
            yearPublished: null,
            thumbnailUrl: null,
            predictedScore: null,
            predictionConfidence: null,
            predictedBreakdown: null,
            nicheImpact: null,
            redundancyPreview: null,
            bggSource: candidate.bggSource,
            addedAt: candidate.bggSource.observedAt,
          } satisfies WishlistEntry,
        ],
  );
  return Object.freeze([...refreshed, ...additions]);
}

export function createUnifiedScoringService(
  options: UnifiedScoringServiceOptions,
): UnifiedScoringService {
  const coordinator = options.coordinator ?? profileSourceCoordinatorFor(options.storageService);
  const logger = createLogger("unified-scoring");
  const cache = options.cache ?? unavailableCache;
  const budget = deepFreeze(structuredClone(options.budget ?? DEFAULT_BUDGET));
  const calculationMemo = new Map<string, UnifiedCalculation>();
  const calculationMemoLimit = 32;
  const captureFlights = new Map<string, Promise<UnifiedSourceFrame>>();
  const captureFlightIds = new WeakMap<Promise<UnifiedSourceFrame>, string>();
  const captureFlightLimit = 16;
  let captureCallSequence = 0;
  let captureFlightSequence = 0;
  const privateCalculationFrames = new WeakMap<UnifiedCalculation, UnifiedSourceFrame>();
  const privateWishlistIdentities = new WeakMap<object, string>();

  async function capture(
    input: {
      readonly includeWishlist?: boolean;
      readonly verifiedRefreshOverlays?: readonly VerifiedWishlistRefreshOverlay[];
    } = {},
  ): Promise<UnifiedSourceFrame> {
    if (!options.storageService.loadJevSourceSnapshot || !options.storageService.sourceVector) {
      throw new Error("Unified scoring source snapshot is unavailable");
    }
    const includeWishlist = input.includeWishlist === true;
    const overlays = verifiedOverlays(input.verifiedRefreshOverlays);
    const flightKey = canonicalSha256({
      includeWishlist,
      verifiedRefreshOverlays: overlays.map(({ candidate }) => candidate),
    });
    // Owner-local captures must execute in the current ALS frame. Joining an external
    // promise here can make the coordinator owner await work queued behind itself.
    const shareFlight = !coordinator.isHeldByCurrentContext();
    const callId = `capture-${++captureCallSequence}`;
    const startedAt = performance.now();
    const existingFlight = shareFlight ? captureFlights.get(flightKey) : undefined;
    if (existingFlight) {
      const existingFlightId = captureFlightIds.get(existingFlight) ?? "unlabeled-flight";
      logger.debug?.("unified source capture join", {
        callId,
        flightId: existingFlightId,
        includeWishlist,
        outcome: "joined",
      });
      try {
        const frame = await existingFlight;
        logger.debug?.("unified source capture completed", {
          callId,
          flightId: existingFlightId,
          elapsedMs: Math.max(0, performance.now() - startedAt),
          outcome: "joined",
        });
        return frame;
      } catch (error) {
        logger.error("unified source capture failed", {
          callId,
          flightId: existingFlightId,
          elapsedMs: Math.max(0, performance.now() - startedAt),
          errorClass: error instanceof Error ? error.name : "UnknownError",
        });
        throw error;
      }
    }
    const flightId = shareFlight ? `unified-capture-flight-${++captureFlightSequence}` : null;
    logger.debug?.("unified source capture attempt", {
      callId,
      flightId,
      includeWishlist,
      phase: "capture",
      captureMode: shareFlight ? "shareable" : "owner-local-bypass",
    });
    const enqueuedAt = performance.now();
    logger.debug?.("unified source capture coordinator queued", {
      callId,
      flightId,
      captureMode: shareFlight ? "shareable" : "owner-local-bypass",
    });
    const work = coordinator.runExclusive(async () => {
      logger.debug?.("unified source capture coordinator entered", {
        callId,
        flightId,
        waitMs: Math.max(0, performance.now() - enqueuedAt),
        captureMode: shareFlight ? "shareable" : "owner-local-bypass",
      });
      const before = options.storageService.sourceVector?.();
      if (before && !before.available) {
        await options.storageService.hydrateSourceVector?.();
      }
      const snapshot = await options.storageService.loadJevSourceSnapshot?.();
      if (!snapshot) throw new Error("Unified scoring source snapshot is unavailable");
      const wishlistEntries = includeWishlist ? await options.storageService.loadWishlist() : [];
      const wishlistGeneration = wishlistMutationGenerationFor(options.storageService);
      const sourceVector = structuredClone(options.storageService.sourceVector?.());
      if (!sourceVector) throw new Error("Unified scoring source vector is unavailable");
      const selectedCandidates = selectCandidateSources(wishlistEntries, overlays);
      const durableWishlistIdentity = wishlistIdentity(wishlistEntries);
      const frameWishlistEntries = withUnpersistedCandidates(wishlistEntries, selectedCandidates);
      const sources = sourceSources(snapshot, sourceVector, wishlistEntries, selectedCandidates);
      const captureToken = Object.freeze({
        sourceVector,
        wishlistGeneration,
        freshnessEpoch: snapshot.freshnessEpoch,
        externalEpoch: snapshot.externalEpoch,
      });
      const captured = captureStagedSimilaritySources(sources, {
        readCurrent() {
          const currentVector = options.storageService.sourceVector?.();
          if (
            !currentVector ||
            !sameLiveVector(captureToken.sourceVector, currentVector) ||
            wishlistMutationGenerationFor(options.storageService) !==
              captureToken.wishlistGeneration
          ) {
            return null;
          }
          // The storage metadata snapshot was read under the coordinator. Its currentness is
          // bounded by the live vector and wishlist generation; publishCurrent refreshes the
          // asynchronous external-file epochs before accepting output.
          return sources;
        },
      });
      const frame: UnifiedSourceFrame = Object.freeze({
        kind: "current" as const,
        sources: captured.sources,
        capture: captured,
        redundancySettings: deepFreeze(structuredClone(snapshot.redundancySettings)),
        wishlistEntries: deepFreeze(structuredClone(frameWishlistEntries)),
        wishlistCandidateBggIds: Object.freeze(
          selectedCandidates.map((candidate) => candidate.bggId),
        ),
        freshnessEpoch: snapshot.freshnessEpoch,
        externalEpoch: snapshot.externalEpoch,
        wishlistGeneration,
        sourceVector: captured.sources.sourceVector,
      });
      if (includeWishlist) privateWishlistIdentities.set(frame, durableWishlistIdentity);
      logger.debug?.("unified source capture frame prepared", {
        callId,
        flightId,
        gameCount: frame.sources.collection.games.length,
        wishlistCount: frame.wishlistEntries.length,
        outcome: "captured",
      });
      return frame;
    });
    if (shareFlight && captureFlights.size < captureFlightLimit) {
      const registeredFlightId = flightId ?? `unified-capture-flight-${++captureFlightSequence}`;
      captureFlightIds.set(work, registeredFlightId);
      captureFlights.set(flightKey, work);
      logger.debug?.("unified source capture flight registered", {
        callId,
        flightId: registeredFlightId,
        flightCount: captureFlights.size,
        outcome: "new",
      });
    }
    try {
      const frame = await work;
      logger.debug?.("unified source capture completed", {
        callId,
        flightId: flightId ?? `owner-local-${callId}`,
        elapsedMs: Math.max(0, performance.now() - startedAt),
        outcome: "new",
      });
      return frame;
    } catch (error) {
      logger.error("unified source capture failed", {
        callId,
        flightId: flightId ?? `owner-local-${callId}`,
        elapsedMs: Math.max(0, performance.now() - startedAt),
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    } finally {
      if (shareFlight && captureFlights.get(flightKey) === work) captureFlights.delete(flightKey);
    }
  }

  async function prepareProposedCollection(
    input: ProposedCollectionInput,
  ): Promise<ProposedCollectionEvaluation> {
    const proposal = await coordinator.runExclusive(async () => {
      const storage = options.storageService;
      if (!storage.loadJevSourceSnapshot || !storage.sourceVector)
        throw new Error("Unified scoring source snapshot is unavailable");
      const before = storage.sourceVector();
      if (
        before.unavailableSources.some(
          (source) => source === "startup" || source === "startup-hydration",
        )
      ) {
        await storage.hydrateSourceVector?.();
      }
      const snapshot = await storage.loadJevSourceSnapshot();
      const vector = structuredClone(storage.sourceVector());
      const persistedCollection = CollectionSchema.parse(snapshot.collection);
      const priorCollection = CollectionSchema.parse(input.prior);
      if (canonicalSha256(persistedCollection) !== canonicalSha256(priorCollection))
        throw new Error("Proposed collection prior does not match full persisted collection");
      if (
        input.proposed.id !== priorCollection.id ||
        input.proposed.schemaVersion !== priorCollection.schemaVersion ||
        input.proposed.revision !== priorCollection.revision
      )
        throw new Error("Proposed collection must retain the persisted identity and revision");
      if (
        !vector.available ||
        vector.collectionId !== priorCollection.id ||
        vector.collectionSchemaVersion !== priorCollection.schemaVersion ||
        vector.collectionRevision !== priorCollection.revision
      )
        throw new Error("Proposed collection baseline source vector is unavailable or stale");

      const baselineSources = sourceSources(snapshot, vector, []);
      const proposedCollection = structuredClone(input.proposed);
      const baselineNotePermission =
        priorCollection.semanticRedundancy.settings.cachedOwnerNoteUse === true;
      const proposalNotePermission =
        proposedCollection.semanticRedundancy.settings.cachedOwnerNoteUse === true;
      proposedCollection.semanticRedundancy.settings.cachedOwnerNoteUse =
        baselineNotePermission && proposalNotePermission;
      const proposedSources = sourceSources(snapshot, vector, [], [], proposedCollection);
      const proposedCapture: ProposedStagedSimilarityCapture =
        captureProposedStagedSimilaritySources(proposedSources, baselineSources, {
          readCurrent() {
            const currentVector = storage.sourceVector?.();
            if (!currentVector || !sameLiveVector(vector, currentVector)) return null;
            return { ...baselineSources, sourceVector: structuredClone(currentVector) };
          },
        });
      const frame: UnifiedSourceFrame = Object.freeze({
        kind: "proposed-collection",
        sources: proposedCapture.sources,
        capture: proposedCapture,
        redundancySettings: deepFreeze(structuredClone(snapshot.redundancySettings)),
        wishlistEntries: Object.freeze([]),
        wishlistCandidateBggIds: Object.freeze([]),
        freshnessEpoch: snapshot.freshnessEpoch,
        externalEpoch: snapshot.externalEpoch,
        wishlistGeneration: wishlistMutationGenerationFor(storage),
        sourceVector: proposedCapture.sources.sourceVector,
      });
      return {
        frame,
        baselineSources,
        baselineIdentity: canonicalSha256(persistedCollection),
        baselineFreshnessEpoch: snapshot.freshnessEpoch,
        baselineExternalEpoch: snapshot.externalEpoch,
        collection: frame.sources.collection,
      };
    });

    async function assertBaseCurrent(): Promise<boolean> {
      return coordinator.runExclusive(async () => {
        try {
          const snapshot = await options.storageService.loadJevSourceSnapshot?.();
          const vector = options.storageService.sourceVector?.();
          if (!snapshot || !vector) return false;
          const live = sourceSources(snapshot, structuredClone(vector), []);
          return (
            canonicalSha256(CollectionSchema.parse(snapshot.collection)) ===
              proposal.baselineIdentity &&
            snapshot.freshnessEpoch === proposal.baselineFreshnessEpoch &&
            snapshot.externalEpoch === proposal.baselineExternalEpoch &&
            sameLiveVector(vector, proposal.frame.sourceVector) &&
            canonicalSha256(live) === canonicalSha256(proposal.baselineSources)
          );
        } catch {
          return false;
        }
      });
    }

    const proposalCalculations = new WeakSet<UnifiedCalculation>();
    return Object.freeze({
      kind: "proposed-collection" as const,
      collection: proposal.collection,
      redundancySettings: proposal.frame.redundancySettings,
      calculate(request: StagedPredictionRequest, requestOptions: UnifiedScoringRequestOptions) {
        if (request.scope === "wishlist")
          throw new TypeError("Proposed collection evaluation does not accept wishlist scope");
        const result = calculate(proposal.frame, request, requestOptions);
        proposalCalculations.add(result);
        return result;
      },
      async accept<Value>(calculation: UnifiedCalculation, acceptSync: () => Value) {
        if (!proposalCalculations.has(calculation)) return null;
        return coordinator.runExclusive(async () => {
          const baseCurrent = await assertBaseCurrent();
          const calcCurrent = calculation.isCurrent();
          if (!baseCurrent || !calcCurrent) return null;
          // Acceptance is a synchronous private handoff; no result/proof is published or saved.
          return calculation.isCurrent() ? acceptSync() : null;
        });
      },
      assertBaseCurrent,
    });
  }

  function calculate(
    frame: UnifiedSourceFrame,
    request: StagedPredictionRequest,
    requestOptions: UnifiedScoringRequestOptions,
  ): UnifiedCalculation {
    if (!frame.capture.isSourceCurrent()) throw new Error("Unified scoring source changed");
    const frozenRequest = deepFreeze(normalizeRequest(request));
    let cacheRevision: number | null | "unreadable";
    try {
      cacheRevision = cache.mutationRevision();
    } catch {
      cacheRevision = "unreadable";
    }
    const memoKey = canonicalSha256({
      frameKind: frame.kind,
      source: frame.capture.durableIdentity,
      // Wishlist durability is verified outside the source vector. Keep private baseline
      // membership/content in the memo identity so a fresh capture after an external edit
      // cannot inherit the previous frame's calculation.
      wishlistBaseline: privateWishlistIdentities.get(frame) ?? null,
      processEpoch: frame.sourceVector.processEpoch,
      changeToken: frame.sourceVector.changeToken,
      wishlistGeneration: frame.wishlistGeneration,
      cacheAvailable: cache.available,
      cacheRevision,
      request: frozenRequest,
      includeRedundancy: requestOptions.includeRedundancy,
    });
    const previous = calculationMemo.get(memoKey);
    if (previous?.isCurrent()) {
      return previous;
    }
    const penaltySettings = requestOptions.includeRedundancy
      ? frame.redundancySettings
      : { ...frame.redundancySettings, enabled: false };
    const cacheReader = cache;
    if (frozenRequest.scope !== "wishlist") {
      const exactFitnessIds = !requestOptions.includeRedundancy
        ? frozenRequest.scope === "predict-game"
          ? new Set([frozenRequest.gameId])
          : frozenRequest.scope === "collection-targets"
            ? new Set(frozenRequest.targetIds)
            : undefined
        : undefined;
      const result = prepareUnifiedCollectionPipeline({
        capture: frame.capture,
        cache: cacheReader,
        request: frozenRequest,
        budget,
        calculationOnly: true,
        redundancySettings: penaltySettings,
        fitnessService: options.fitnessService,
        fitnessCollectionIds: exactFitnessIds,
        observer: options.collectionObserver,
        preparedObserver: options.preparedObserver,
      });
      if (!result.ok) throw new Error(`Unified scoring calculation unavailable: ${result.reason}`);
      const {
        calculation: stagedCalculation,
        fitness,
        redundancyAdjustments,
        proof,
      } = result.value;
      const prepared = stagedCalculation.prepared;
      const targetFitness = new Map<string, FitnessResult | null>();
      for (const target of stagedCalculation.targets) {
        targetFitness.set(target.id, fitness.get(target.id) ?? null);
      }
      const evidence = (pair: StagedSimilarityPair) => prepared.evidence(pair);
      const redundancySimilarityStatus = createSimilarityStatusResolver(
        frame,
        stagedCalculation.redundancyPairs,
        evidence,
      );
      const calculation = Object.freeze({
        request: frozenRequest,
        collectionFitness: readonlyMap(fitness),
        actualFitness: readonlyMap(result.value.actualFitness),
        targetFitness: readonlyMap(targetFitness),
        redundancyAdjustments: readonlyMap(redundancyAdjustments),
        wishlistResults: Object.freeze([]),
        unavailableSelectionIds: Object.freeze([]),
        unavailableTargetIds: stagedCalculation.unavailableTargetIds,
        readiness: stagedCalculation.readiness,
        proof,
        predictionPairs: stagedCalculation.predictionPairs,
        redundancyPairs: stagedCalculation.redundancyPairs,
        calculationDependencyPairs: stagedCalculation.calculationDependencyPairs,
        similarity: (pair: StagedSimilarityPair) => prepared.similarity(pair),
        evidence,
        redundancySimilarityStatus,
        isCurrent: () => frame.capture.isSourceCurrent() && prepared.isCurrent(),
        isReusable: () => frame.capture.isSourceCurrent() && prepared.isReusable(),
      });
      rememberCalculation(memoKey, calculation, frame);
      return calculation;
    }

    const selectedIds = new Set(frozenRequest.selectedBggIds);
    const capturedCandidateIds = new Set(frame.wishlistCandidateBggIds);
    const entries = frame.wishlistEntries.filter((entry) => selectedIds.has(entry.bggId));
    const capturedEntries = entries.filter(
      (entry) => !entry.bggSource || capturedCandidateIds.has(entry.bggId),
    );
    const unavailableSelectionIds = [...selectedIds]
      .filter((id) => !capturedEntries.some((entry) => entry.bggId === id))
      .map(String)
      .sort();
    const projection = computeUnifiedWishlistProjectionWithCalculation({
      capture: frame.capture,
      cache: cacheReader,
      entries: capturedEntries,
      budget,
      calculationOnly: true,
      redundancySettings: penaltySettings,
      preparedObserver: options.preparedObserver,
      observer: options.wishlistObserver,
    });
    const results = projection.results;
    const details = projection.calculation;
    if (!details) throw new Error("Unified wishlist calculation did not produce a current proof");
    if ("beginExecution" in details.scope) {
      throw new Error("Ordinary wishlist calculation unexpectedly created run authority");
    }
    const wishlistScope = details.scope;
    const collectionFitness = details.collectionFitness;
    const actualFitness = details.actualFitness;
    const targetFitness = new Map<string, FitnessResult | null>();
    for (const item of results) {
      const bggId = item.entry.bggId;
      if (item.prediction.availability === "available") {
        targetFitness.set(`wishlist:${bggId}`, item.prediction.result);
      } else {
        targetFitness.set(`wishlist:${bggId}`, null);
      }
    }
    const result = Object.freeze({
      request: frozenRequest,
      collectionFitness: readonlyMap(collectionFitness),
      actualFitness: readonlyMap(actualFitness),
      targetFitness: readonlyMap(targetFitness),
      redundancyAdjustments: readonlyMap(
        new Map(
          results.flatMap((item) =>
            item.redundancy.adjustment
              ? [[`wishlist:${item.entry.bggId}`, item.redundancy.adjustment] as const]
              : [],
          ),
        ),
      ),
      wishlistResults: Object.freeze([...results]),
      unavailableSelectionIds: Object.freeze(unavailableSelectionIds),
      unavailableTargetIds: wishlistScope.unavailableTargetIds,
      readiness: wishlistScope.readiness,
      proof: details.proof,
      predictionPairs: wishlistScope.predictionPairs,
      redundancyPairs: wishlistScope.redundancyPairs,
      calculationDependencyPairs: details.calculationDependencyPairs,
      similarity: (pair: StagedSimilarityPair) => wishlistScope.prepared.similarity(pair),
      evidence: (pair: StagedSimilarityPair) => wishlistScope.prepared.evidence(pair),
      redundancySimilarityStatus: createSimilarityStatusResolver(
        frame,
        wishlistScope.redundancyPairs,
        (pair) => wishlistScope.prepared.evidence(pair),
      ),
      isCurrent: () => frame.capture.isSourceCurrent() && wishlistScope.prepared.isCurrent(),
      isReusable: () => frame.capture.isSourceCurrent() && wishlistScope.prepared.isReusable(),
    });
    rememberCalculation(memoKey, result, frame);
    return result;
  }

  function rememberCalculation(
    key: string,
    result: UnifiedCalculation,
    frame: UnifiedSourceFrame,
  ): void {
    calculationMemo.delete(key);
    calculationMemo.set(key, result);
    if (frame.kind === "current") privateCalculationFrames.set(result, frame);
    while (calculationMemo.size > calculationMemoLimit) {
      const oldest = calculationMemo.keys().next().value;
      if (oldest === undefined) break;
      calculationMemo.delete(oldest);
    }
  }

  function prepareRun(
    frame: UnifiedSourceFrame,
    request: StagedPredictionRequest,
    runBudget: StagedRunBudget,
    authorizationReader: StagedRunAuthorizationReader,
  ): UnifiedCollectionPipelineResult {
    if (frame.kind !== "current" || !frame.capture.isSourceCurrent())
      throw new Error("Unified run source changed");
    const result = prepareUnifiedCollectionPipeline({
      capture: frame.capture,
      cache,
      request: normalizeRequest(request),
      budget: deepFreeze(structuredClone(runBudget)),
      authorizationReader,
      calculationOnly: false,
      redundancySettings: frame.redundancySettings,
      fitnessService: options.fitnessService,
      preparedObserver: options.preparedObserver,
      observer: options.collectionObserver,
    });
    if (!result.ok) throw new Error(`Unified run preparation unavailable: ${result.reason}`);
    return result.value;
  }

  async function isSourceCurrent(frame: UnifiedSourceFrame): Promise<boolean> {
    if (frame.kind !== "current" || !options.storageService.loadJevSourceSnapshot) return false;
    return coordinator.runExclusive(async () => {
      try {
        const snapshot = await options.storageService.loadJevSourceSnapshot?.();
        const vector = options.storageService.sourceVector?.();
        if (
          !snapshot ||
          !vector ||
          snapshot.freshnessEpoch !== frame.freshnessEpoch ||
          snapshot.externalEpoch !== frame.externalEpoch ||
          wishlistMutationGenerationFor(options.storageService) !== frame.wishlistGeneration ||
          !sameLiveVector(vector, frame.sourceVector)
        )
          return false;
        const baseline = privateWishlistIdentities.get(frame);
        const entries = baseline === undefined ? [] : await options.storageService.loadWishlist();
        if (baseline !== undefined && wishlistIdentity(entries) !== baseline) return false;
        const candidates = frame.sources.wishlistCandidates ?? [];
        return (
          canonicalSha256(sourceSources(snapshot, structuredClone(vector), entries, candidates)) ===
          canonicalSha256(frame.sources)
        );
      } catch {
        return false;
      }
    });
  }

  async function publishCurrent<Value>(
    calculation: UnifiedCalculation,
    publishSync: () => Value,
  ): Promise<Value | null> {
    const frame = privateCalculationFrames.get(calculation);
    if (!frame) return null;
    return coordinator.runExclusive(async () => {
      const storage = options.storageService;
      if (!storage.loadJevSourceSnapshot || !storage.sourceVector) return null;
      let snapshot: JevSourceSnapshot;
      let vector: SourceVector;
      let entries: readonly WishlistEntry[];
      try {
        snapshot = await storage.loadJevSourceSnapshot();
        vector = structuredClone(storage.sourceVector());
        entries = privateWishlistIdentities.has(frame) ? await storage.loadWishlist() : [];
      } catch {
        return null;
      }
      if (
        snapshot.freshnessEpoch !== frame.freshnessEpoch ||
        snapshot.externalEpoch !== frame.externalEpoch ||
        wishlistMutationGenerationFor(storage) !== frame.wishlistGeneration ||
        !sameLiveVector(vector, frame.sourceVector) ||
        !calculation.isCurrent()
      )
        return null;
      const baseline = privateWishlistIdentities.get(frame);
      if (
        privateWishlistIdentities.has(frame) &&
        (baseline === undefined || wishlistIdentity(entries) !== baseline)
      )
        return null;
      const currentSources = sourceSources(
        snapshot,
        vector,
        entries,
        frame.sources.wishlistCandidates ?? [],
      );
      if (canonicalSha256(currentSources) !== canonicalSha256(frame.sources)) return null;
      // No await may be introduced between the final live checks and synchronous acceptance.
      return calculation.isCurrent() ? publishSync() : null;
    });
  }

  return Object.freeze({
    capture,
    prepareProposedCollection,
    calculate,
    prepareRun,
    isSourceCurrent,
    publishCurrent,
  });
}

function sourceSources(
  snapshot: JevSourceSnapshot,
  sourceVector: SourceVector,
  wishlistEntries: readonly WishlistEntry[],
  selectedCandidates: readonly StagedWishlistCandidateSource[] = candidateSources(wishlistEntries),
  collectionOverride?: Collection,
): StagedSimilaritySources {
  const collection = collectionOverride ?? snapshot.collection;
  const semanticSettings = collection.semanticRedundancy?.settings;
  if (!semanticSettings) throw new Error("Unified scoring semantic settings are unavailable");
  return deepFreeze(
    structuredClone({
      collection,
      tournament: snapshot.tournament,
      predictionSettings: snapshot.predictionSettings,
      similaritySettings: captureSimilaritySettings(snapshot.redundancySettings, semanticSettings),
      sourceVector,
      ...(selectedCandidates.length > 0 ? { wishlistCandidates: selectedCandidates } : {}),
    }),
  );
}
