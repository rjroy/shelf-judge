import type { DurableGame } from "@shelf-judge/shared";
import {
  SemanticScoringInputProofV2Schema,
  type SemanticScoringInputProofV2,
} from "../../../shared/src/semantic-scoring-input-proof-v2.js";
import {
  buildVocabulary,
  computeContinuousRanges,
  encodeGame,
  type FactualScoringGame,
  type FeatureVector,
} from "./feature-vector.js";
import type {
  JevPairCache,
  JevPairDomain,
  JevPairJudgment,
  JevPairKey,
  JevSignal,
} from "./jev-pair-cache-service.js";
import { encodeOwnedLocalMember, encodeWishlistBggMember } from "./jev-pair-identity.js";
import { validateJevCachedRow } from "./jev-pair-read-proof.js";
import {
  validateWishlistCandidateCOnlyRow,
  type WishlistDescriptionPairRequest,
} from "./wishlist-candidate-read-proof.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";
import type {
  StagedSimilarityCapture,
  StagedWishlistCandidateSource,
} from "./staged-similarity-capture.js";
import { factualSimilarity, unifiedSimilarity } from "./unified-similarity.js";

export type StagedSimilarityPair =
  | { domain: "collection"; gameAId: string; gameBId: string }
  | { domain: "wishlist-candidate"; candidateBggId: number; ownedGameId: string };

export interface PreparedSimilarityObserver {
  onFactualContextBuilt?(): void;
  onVectorEncoded?(memberKey: string): void;
  onCachePointRead?(pairKey: string, signal: JevSignal): void;
  onWishlistCandidateIndexed?(bggId: number): void;
  onWishlistCandidateIndexBuilt?(candidateCount: number): void;
  onWishlistCandidateLookup?(bggId: number): void;
}

export type StagedComponentEvidence =
  | {
      readonly state: "available";
      readonly rowIdentity: string;
      readonly value: number;
      readonly noteDependent: boolean;
    }
  | {
      readonly state:
        | "not-requested"
        | "missing-source"
        | "missing-row"
        | "invalid-row"
        | "cache-unavailable";
    };

export interface StagedSimilarityEvidence {
  readonly factual: "available" | "missing-source";
  readonly description: StagedComponentEvidence;
  readonly ownerNote: StagedComponentEvidence;
}

interface ResolvedPair {
  readonly key: string;
  readonly components: Parameters<typeof unifiedSimilarity>[0];
  readonly similarity: number | null;
  readonly evidence: StagedSimilarityEvidence;
}

interface CanonicalPair {
  readonly identity: { key: string; memberA: string; memberB: string };
  readonly domain: JevPairDomain;
  readonly vectorKeyA: string;
  readonly vectorKeyB: string;
  readonly gameA: FactualScoringGame;
  readonly gameB: FactualScoringGame;
  readonly collectionGameA: DurableGame | null;
  readonly collectionGameB: DurableGame | null;
  readonly wishlistPair: WishlistDescriptionPairRequest | null;
}

const MISSING: StagedComponentEvidence = Object.freeze({ state: "missing-source" });
const NOT_REQUESTED: StagedComponentEvidence = Object.freeze({ state: "not-requested" });

function freezeEvidenceComponent(evidence: StagedComponentEvidence): StagedComponentEvidence {
  return Object.freeze({ ...evidence });
}

function canonicalMembers(left: string, right: string): [string, string] {
  if (!left.trim() || !right.trim() || left === right) {
    throw new TypeError("Similarity pair requires two distinct nonempty members");
  }
  return left < right ? [left, right] : [right, left];
}

function pairIdentity(collectionId: string, domain: JevPairDomain, left: string, right: string) {
  const [memberA, memberB] = canonicalMembers(left, right);
  return {
    key: JSON.stringify([collectionId, domain, memberA, memberB]),
    memberA,
    memberB,
  };
}

function localVectorKey(collectionId: string, localId: string): string {
  return JSON.stringify([collectionId, "local-game", localId]);
}

function wishlistCandidateVectorKey(collectionId: string, bggId: number): string {
  return JSON.stringify([collectionId, "wishlist-bgg-candidate", bggId]);
}

function factualGame(game: DurableGame): FactualScoringGame {
  return {
    id: game.id,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    bestPlayers: game.bestPlayers,
    playingTime: game.playingTime,
    bggData: game.bggData
      ? {
          weight: game.bggData.weight,
          communityRating: game.bggData.communityRating,
          mechanics: game.bggData.mechanics,
          categories: game.bggData.categories,
        }
      : null,
  };
}

function factualCandidate(
  collectionId: string,
  candidate: StagedWishlistCandidateSource,
): FactualScoringGame {
  return {
    id: encodeWishlistBggMember(collectionId, String(candidate.bggId)),
    cacheIdentity: candidate,
    minPlayers: candidate.bggSource.minPlayers,
    maxPlayers: candidate.bggSource.maxPlayers,
    bestPlayers: candidate.bggSource.bestPlayers,
    playingTime: candidate.bggSource.playingTime,
    bggData: {
      weight: candidate.bggSource.weight,
      communityRating: candidate.bggSource.communityRating,
      mechanics: candidate.bggSource.mechanics.map((name) => ({ name })),
      categories: candidate.bggSource.categories.map((name) => ({ name })),
    },
  };
}

function validationStatus(
  row: JevPairJudgment | null,
  reason: "missing-source" | "missing-row" | "invalid-row",
): StagedComponentEvidence {
  if (row === null) return { state: "missing-row" };
  return { state: reason === "missing-source" ? "missing-source" : "invalid-row" };
}

export interface PreparedSimilarityOptions {
  capture: StagedSimilarityCapture;
  cache: Pick<JevPairCache, "available" | "mutationRevision" | "lookup">;
  observer?: PreparedSimilarityObserver;
}

interface PreparedFactualContext {
  readonly vocabulary: ReturnType<typeof buildVocabulary>;
  readonly ranges: ReturnType<typeof computeContinuousRanges>;
  readonly vectorBySource: Map<string, FeatureVector>;
  readonly collectionById: ReadonlyMap<string, DurableGame>;
  readonly candidateByBggId: ReadonlyMap<number, StagedWishlistCandidateSource>;
}

const factualContextByCapture = new WeakMap<StagedSimilarityCapture, PreparedFactualContext>();

/**
 * One immutable, source-authorized, cache-only resolver for demanded pair evidence.
 * It never enumerates the cache or derives pair eligibility from predicted fitness.
 */
export function createPreparedSimilarity(options: PreparedSimilarityOptions) {
  const { capture, cache, observer } = options;
  const sources = capture.sources;
  const collection = sources.collection;
  let factualContext = factualContextByCapture.get(capture);
  if (!factualContext) {
    const collectionById = new Map(collection.games.map((game) => [game.id, game]));
    if (collectionById.size !== collection.games.length) {
      throw new TypeError("Captured collection contains duplicate local game IDs");
    }
    const candidateByBggId = new Map<number, StagedWishlistCandidateSource>();
    for (const candidate of sources.wishlistCandidates ?? []) {
      observer?.onWishlistCandidateIndexed?.(candidate.bggId);
      if (candidateByBggId.has(candidate.bggId)) {
        throw new TypeError("Captured wishlist candidates contain duplicate BGG IDs");
      }
      candidateByBggId.set(candidate.bggId, candidate);
    }
    observer?.onWishlistCandidateIndexBuilt?.(candidateByBggId.size);
    const factualGames = collection.games.filter((game) => game.bggData).map(factualGame);
    factualContext = {
      vocabulary: buildVocabulary(factualGames),
      ranges: computeContinuousRanges(factualGames),
      vectorBySource: new Map<string, FeatureVector>(),
      collectionById,
      candidateByBggId,
    };
    factualContextByCapture.set(capture, factualContext);
    observer?.onFactualContextBuilt?.();
  }
  const { vocabulary, ranges, vectorBySource, collectionById, candidateByBggId } = factualContext;
  const pairResults = new Map<string, ResolvedPair>();
  const examined = new Map<
    string,
    {
      key: string;
      factual: "available" | "missing-source";
      description: StagedComponentEvidence;
      ownerNote: StagedComponentEvidence;
    }
  >();

  let cacheRevision: number | null = null;
  let cacheWasReadable = false;
  let cacheLookupAttempted = false;
  let cacheFenceKind: "unavailable" | "unrevisioned" | "revisioned" = "unavailable";
  try {
    if (cache.available) {
      cacheFenceKind = "unrevisioned";
      const revision = cache.mutationRevision();
      if (Number.isSafeInteger(revision) && revision !== null && revision >= 0) {
        cacheRevision = revision;
        cacheWasReadable = true;
        cacheFenceKind = "revisioned";
      }
    }
  } catch {
    cacheWasReadable = false;
  }

  let sealedProof: SemanticScoringInputProofV2 | null = null;

  const encode = (memberKey: string, game: FactualScoringGame): FeatureVector | null => {
    if (!game.bggData) return null;
    let vector = vectorBySource.get(memberKey);
    if (!vector) {
      vector = encodeGame(game, vocabulary, [], {}, ranges);
      vectorBySource.set(memberKey, vector);
      observer?.onVectorEncoded?.(memberKey);
    }
    return vector;
  };

  function resolvePair(pair: StagedSimilarityPair): CanonicalPair {
    if (pair.domain === "collection") {
      const gameA = collectionById.get(pair.gameAId);
      const gameB = collectionById.get(pair.gameBId);
      if (!gameA || !gameB)
        throw new TypeError("Requested collection pair is not source-authorized");
      const identity = pairIdentity(collection.id, "collection", pair.gameAId, pair.gameBId);
      const canonicalGameA = collectionById.get(identity.memberA);
      const canonicalGameB = collectionById.get(identity.memberB);
      if (!canonicalGameA || !canonicalGameB)
        throw new TypeError("Canonical collection pair is not source-authorized");
      return {
        domain: "collection",
        identity,
        vectorKeyA: localVectorKey(collection.id, canonicalGameA.id),
        vectorKeyB: localVectorKey(collection.id, canonicalGameB.id),
        collectionGameA: canonicalGameA,
        collectionGameB: canonicalGameB,
        gameA: factualGame(canonicalGameA),
        gameB: factualGame(canonicalGameB),
        wishlistPair: null,
      };
    }

    observer?.onWishlistCandidateLookup?.(pair.candidateBggId);
    const candidate = candidateByBggId.get(pair.candidateBggId);
    const owned = collectionById.get(pair.ownedGameId);
    if (
      !candidate ||
      !owned ||
      !Number.isSafeInteger(pair.candidateBggId) ||
      pair.candidateBggId <= 0
    ) {
      throw new TypeError("Requested wishlist pair is not source-authorized");
    }
    const capturedCandidate = {
      bggId: candidate.bggId,
      name: candidate.name,
      bggSource: candidate.bggSource,
    };
    const wishlistPair: WishlistDescriptionPairRequest = {
      candidate: capturedCandidate,
      ownedGame: {
        id: owned.id,
        bggId: owned.bggId,
        name: owned.name,
        description: owned.bggData?.description ?? null,
      },
    };
    const candidateMember = encodeWishlistBggMember(collection.id, String(pair.candidateBggId));
    const ownedMember = encodeOwnedLocalMember(collection.id, owned.id);
    const identity = pairIdentity(
      collection.id,
      "wishlist-candidate",
      candidateMember,
      ownedMember,
    );
    const candidateIsA = identity.memberA === candidateMember;
    return {
      identity,
      domain: "wishlist-candidate",
      vectorKeyA: candidateIsA
        ? wishlistCandidateVectorKey(collection.id, candidate.bggId)
        : localVectorKey(collection.id, owned.id),
      vectorKeyB: candidateIsA
        ? localVectorKey(collection.id, owned.id)
        : wishlistCandidateVectorKey(collection.id, candidate.bggId),
      collectionGameA: candidateIsA ? null : owned,
      collectionGameB: candidateIsA ? owned : null,
      gameA: candidateIsA ? factualCandidate(collection.id, candidate) : factualGame(owned),
      gameB: candidateIsA ? factualGame(owned) : factualCandidate(collection.id, candidate),
      wishlistPair,
    };
  }

  function validatedSignal(pair: CanonicalPair, signal: JevSignal): StagedComponentEvidence {
    if (pair.domain === "wishlist-candidate" && signal !== "C") return NOT_REQUESTED;
    if (signal === "C" && sources.similaritySettings.semantic.description <= 0)
      return NOT_REQUESTED;
    if (signal === "D" && sources.similaritySettings.semantic.ownerNote <= 0) return NOT_REQUESTED;
    const descriptionA =
      pair.domain === "wishlist-candidate"
        ? pair.wishlistPair?.candidate.bggSource.description
        : pair.collectionGameA?.bggData?.description;
    const descriptionB =
      pair.domain === "wishlist-candidate"
        ? pair.wishlistPair?.ownedGame.description
        : pair.collectionGameB?.bggData?.description;
    if (signal === "C" && (!descriptionA?.trim() || !descriptionB?.trim())) {
      return MISSING;
    }
    if (signal === "D") {
      const semantic = collection.semanticRedundancy;
      if (!semantic?.settings.cachedOwnerNoteUse) return MISSING;
      const a = pair.collectionGameA;
      const b = pair.collectionGameB;
      if (
        !a ||
        !b ||
        a.ownerNote.state !== "present" ||
        b.ownerNote.state !== "present" ||
        !Number.isSafeInteger(a.ownerNote.version) ||
        !Number.isSafeInteger(b.ownerNote.version) ||
        a.ownerNote.version <= 0 ||
        b.ownerNote.version <= 0 ||
        !a.ownerNote.text.trim() ||
        !b.ownerNote.text.trim()
      ) {
        return MISSING;
      }
    }
    if (pair.domain === "wishlist-candidate" && !pair.wishlistPair) return MISSING;
    if (!cacheWasReadable) return { state: "cache-unavailable" };

    const left = pair.identity.memberA;
    const right = pair.identity.memberB;
    const key: JevPairKey = {
      gameAId: left,
      gameBId: right,
      signal,
      ...(pair.domain === "wishlist-candidate" ? { pairDomain: "wishlist-candidate" } : {}),
    };
    let row: JevPairJudgment | null;
    try {
      cacheLookupAttempted = true;
      observer?.onCachePointRead?.(pair.identity.key, signal);
      row = cache.lookup(key);
    } catch {
      cacheWasReadable = false;
      return { state: "cache-unavailable" };
    }
    if (pair.domain === "wishlist-candidate") {
      const request = pair.wishlistPair;
      if (!request) return MISSING;
      const checked = validateWishlistCandidateCOnlyRow(row, collection.id, request, {
        // These indexes are request membership/source checks, not prediction-score eligibility.
        candidateBggIds: new Set([request.candidate.bggId]),
        eligibleOwnedIds: new Set([request.ownedGame.id]),
      });
      return checked.valid
        ? {
            state: "available",
            rowIdentity: checked.identity,
            value: checked.value,
            noteDependent: false,
          }
        : validationStatus(row, row === null ? "missing-row" : "invalid-row");
    }

    const gameA = pair.collectionGameA;
    const gameB = pair.collectionGameB;
    if (!gameA || !gameB) return validationStatus(row, "invalid-row");

    const checked = validateJevCachedRow(
      row,
      collection,
      {
        id: gameA.id,
        name: gameA.name,
        bggData: gameA.bggData ? { description: gameA.bggData.description } : null,
        ownerNote: gameA.ownerNote,
      },
      {
        id: gameB.id,
        name: gameB.name,
        bggData: gameB.bggData ? { description: gameB.bggData.description } : null,
        ownerNote: gameB.ownerNote,
      },
      signal,
    );
    return checked.valid
      ? {
          state: "available",
          rowIdentity: checked.identity,
          value: checked.value,
          noteDependent: row?.dependencyKind === "SHARED_CD" || signal === "D",
        }
      : validationStatus(row, checked.reason);
  }

  function resolveOne(request: StagedSimilarityPair): ResolvedPair {
    const pair = resolvePair(request);
    const cached = pairResults.get(pair.identity.key);
    if (cached) return cached;
    if (sealedProof) throw new Error("Prepared similarity is sealed; new pairs are not permitted");

    const vectorA = encode(pair.vectorKeyA, pair.gameA);
    const vectorB = encode(pair.vectorKeyB, pair.gameB);
    const factualAvailable = vectorA !== null && vectorB !== null;
    const factualValue = factualAvailable
      ? factualSimilarity(vectorA, vectorB, sources.similaritySettings.factual)
      : null;
    const description = validatedSignal(pair, "C");
    const ownerNote = validatedSignal(pair, "D");
    const components = {
      factual:
        factualValue === null
          ? ({ availability: "unavailable" } as const)
          : ({ availability: "available", value: factualValue } as const),
      description:
        description.state === "available"
          ? ({ availability: "available", value: description.value } as const)
          : ({ availability: "unavailable" } as const),
      ownerNote:
        ownerNote.state === "available"
          ? ({ availability: "available", value: ownerNote.value } as const)
          : ({ availability: "unavailable" } as const),
    };
    const immutableComponents = Object.freeze({
      factual: Object.freeze({ ...components.factual }),
      description: Object.freeze({ ...components.description }),
      ownerNote: Object.freeze({ ...components.ownerNote }),
    });
    const immutableEvidence: StagedSimilarityEvidence = Object.freeze({
      factual: factualAvailable ? "available" : "missing-source",
      description: freezeEvidenceComponent(description),
      ownerNote: freezeEvidenceComponent(ownerNote),
    });
    const result: ResolvedPair = Object.freeze({
      key: pair.identity.key,
      components: immutableComponents,
      similarity: unifiedSimilarity(immutableComponents, sources.similaritySettings),
      evidence: immutableEvidence,
    });
    pairResults.set(result.key, result);
    examined.set(result.key, {
      key: result.key,
      factual: result.evidence.factual,
      description: result.evidence.description,
      ownerNote: result.evidence.ownerNote,
    });
    return result;
  }

  function resolvePairs(requests: readonly StagedSimilarityPair[]): void {
    for (const request of requests) {
      resolveOne(request);
    }
  }

  function resultFor(pair: StagedSimilarityPair): ResolvedPair | undefined {
    const identity = resolvePair(pair).identity;
    const result = pairResults.get(identity.key);
    if (!result && sealedProof) {
      throw new Error("Prepared similarity is sealed; new pairs are not permitted");
    }
    return result;
  }

  function sealProof(): SemanticScoringInputProofV2 {
    if (sealedProof) return sealedProof;
    const ordered = [...examined.values()].sort((left, right) => left.key.localeCompare(right.key));
    const demandedPairsIdentity = canonicalSha256(ordered.map((entry) => entry.key));
    const examinedComponentsIdentity = canonicalSha256(
      ordered.map(({ key, ...components }) => ({ key, ...components })),
    );
    const proof = SemanticScoringInputProofV2Schema.parse({
      version: 2,
      mode: "unified-similarity",
      algorithmVersion: "unified-jaccard-manhattan-jev-v1",
      identity: canonicalSha256({
        domain: "staged-semantic-scoring-input-proof-v2",
        sourceIdentity: capture.durableIdentity,
        demandedPairsIdentity,
        examinedComponentsIdentity,
      }),
      demandedPairsIdentity,
      examinedComponentsIdentity,
    });
    sealedProof = Object.freeze(proof);
    return sealedProof;
  }

  function isCurrent(): boolean {
    try {
      if (sealedProof === null) return false;
      if (!capture.isSourceCurrent()) return false;
      if (cacheFenceKind === "unavailable") return !cache.available;
      if (!cache.available) return false;
      if (cacheFenceKind === "unrevisioned") {
        if (cacheLookupAttempted) return false;
        try {
          return cache.mutationRevision() === null;
        } catch {
          // No rows were read without a stable initial revision; a factual-only result
          // remains fenceable by its authoritative sources, not by unread cache evidence.
          return true;
        }
      }
      const currentRevision = cache.mutationRevision();
      return currentRevision !== null && currentRevision === cacheRevision;
    } catch {
      return false;
    }
  }

  return Object.freeze({
    resolvePairs,
    similarity(pair: StagedSimilarityPair): number | null {
      return resultFor(pair)?.similarity ?? null;
    },
    evidence(pair: StagedSimilarityPair): StagedSimilarityEvidence | null {
      return resultFor(pair)?.evidence ?? null;
    },
    sealProof,
    isCurrent,
    get isSealed() {
      return sealedProof !== null;
    },
    get resolvedPairCount() {
      return pairResults.size;
    },
    hasNoteDependentEvidence(): boolean {
      return [...pairResults.values()].some(
        (result) =>
          (result.evidence.description.state === "available" &&
            result.evidence.description.noteDependent) ||
          (result.evidence.ownerNote.state === "available" &&
            result.evidence.ownerNote.noteDependent),
      );
    },
  });
}
