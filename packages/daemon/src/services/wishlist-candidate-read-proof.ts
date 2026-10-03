import type { WishlistBggSourceSnapshot } from "@shelf-judge/shared";
import { JEV_JUDGMENT_CONTRACT } from "./jev/jev-judgment-contract.js";
import type { JevPairCache, JevPairJudgment } from "./jev-pair-cache-service.js";
import {
  buildJevPairDependencies,
  encodeOwnedLocalMember,
  encodeWishlistBggMember,
} from "./jev-pair-identity.js";
import type {
  WishlistDescriptionPairRequest,
  WishlistDescriptionSignalCaptureRequest,
  WishlistDescriptionSignalResolver,
} from "./wishlist-redundancy-scoring.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";

export interface WishlistCandidateDescriptionProof {
  valid: true;
  value: number;
  identity: string;
  dependencies: JevPairJudgment["dependencies"];
}

export type WishlistCandidateDescriptionValidation =
  | WishlistCandidateDescriptionProof
  | { valid: false };

function usableSource(value: string | null): value is string {
  return value !== null && value.trim().length > 0 && value.length <= 12_000;
}

function validName(value: string): boolean {
  return value.length > 0 && value.length <= 200 && value.trim().length > 0;
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function sourceIdentity(source: WishlistBggSourceSnapshot): unknown {
  return {
    observedAt: source.observedAt,
    description: source.description,
    mechanics: source.mechanics,
    categories: source.categories,
    weight: source.weight,
    communityRating: source.communityRating,
    minPlayers: source.minPlayers,
    maxPlayers: source.maxPlayers,
    bestPlayers: source.bestPlayers,
    playingTime: source.playingTime,
  };
}

function dependenciesFor(
  collectionId: string,
  pair: WishlistDescriptionPairRequest,
): JevPairJudgment["dependencies"] {
  return buildJevPairDependencies(
    "C_ONLY",
    {
      gameId: encodeWishlistBggMember(collectionId, String(pair.candidate.bggId)),
      name: pair.candidate.name,
      description: pair.candidate.bggSource.description ?? undefined,
    },
    {
      gameId: encodeOwnedLocalMember(collectionId, pair.ownedGame.id),
      name: pair.ownedGame.name,
      description: pair.ownedGame.description ?? undefined,
    },
  );
}

function sameDependencies(
  actual: JevPairJudgment["dependencies"],
  expected: JevPairJudgment["dependencies"],
): boolean {
  const normalize = (dependencies: JevPairJudgment["dependencies"]) =>
    [...dependencies]
      .sort((left, right) => left.gameId.localeCompare(right.gameId))
      .map((dependency) => ({
        gameId: dependency.gameId,
        nameFingerprint: dependency.nameFingerprint,
        descriptionFingerprint: dependency.descriptionFingerprint ?? null,
        noteFingerprint: dependency.noteFingerprint ?? null,
        noteVersion: dependency.noteVersion ?? null,
      }));
  return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));
}

/** Validate a candidate-domain C_ONLY row against exact current source and contract. */
export function validateWishlistCandidateCOnlyRow(
  row: JevPairJudgment | null,
  collectionId: string,
  pair: WishlistDescriptionPairRequest,
  candidateBggIds: readonly number[],
  eligibleOwnedIds: readonly string[],
): WishlistCandidateDescriptionValidation {
  if (
    !row ||
    !collectionId.trim() ||
    !Number.isSafeInteger(pair.candidate.bggId) ||
    pair.candidate.bggId <= 0 ||
    pair.ownedGame.bggId === pair.candidate.bggId ||
    !candidateBggIds.includes(pair.candidate.bggId) ||
    !eligibleOwnedIds.includes(pair.ownedGame.id) ||
    !validName(pair.candidate.name) ||
    !validName(pair.ownedGame.name) ||
    !usableSource(pair.candidate.bggSource.description) ||
    !usableSource(pair.ownedGame.description) ||
    !Number.isFinite(Date.parse(pair.candidate.bggSource.observedAt))
  )
    return { valid: false };

  let candidateMember: string;
  let ownedMember: string;
  let expected: JevPairJudgment["dependencies"];
  try {
    candidateMember = encodeWishlistBggMember(collectionId, String(pair.candidate.bggId));
    ownedMember = encodeOwnedLocalMember(collectionId, pair.ownedGame.id);
    expected = dependenciesFor(collectionId, pair);
  } catch {
    return { valid: false };
  }

  const rowMembers = [row.gameAId, row.gameBId];
  if (
    row.pairDomain !== "wishlist-candidate" ||
    row.collectionId !== collectionId ||
    row.signal !== "C" ||
    row.dependencyKind !== "C_ONLY" ||
    row.consentEpoch !== undefined ||
    (row.gameAId !== candidateMember && row.gameBId !== candidateMember) ||
    (row.gameAId !== ownedMember && row.gameBId !== ownedMember) ||
    row.gameAId === row.gameBId ||
    rowMembers.some((id) => id !== candidateMember && id !== ownedMember) ||
    !Number.isFinite(row.value) ||
    row.value < 0 ||
    row.value > 1 ||
    (row.confidence !== undefined &&
      (!Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1)) ||
    row.modelId !== JEV_JUDGMENT_CONTRACT.modelId ||
    row.rubricVersion !== JEV_JUDGMENT_CONTRACT.rubricVersion ||
    row.questionVersion !== JEV_JUDGMENT_CONTRACT.questionVersion ||
    row.requestSchemaVersion !== JEV_JUDGMENT_CONTRACT.requestSchemaVersion ||
    row.scoreMappingVersion !== JEV_JUDGMENT_CONTRACT.scoreMappingVersion ||
    row.semanticPolicyId !== JEV_JUDGMENT_CONTRACT.semanticPolicyId ||
    typeof row.completedAt !== "string" ||
    row.completedAt.trim().length === 0 ||
    !hasOnlyKeys(row, [
      "pairDomain",
      "collectionId",
      "consentEpoch",
      "gameAId",
      "gameBId",
      "signal",
      "dependencyKind",
      "value",
      "confidence",
      "modelId",
      "rubricVersion",
      "questionVersion",
      "requestSchemaVersion",
      "scoreMappingVersion",
      "semanticPolicyId",
      "completedAt",
      "dependencies",
    ]) ||
    !Array.isArray(row.dependencies) ||
    row.dependencies.some(
      (dependency) =>
        !hasOnlyKeys(dependency, [
          "gameId",
          "nameFingerprint",
          "descriptionFingerprint",
          "noteFingerprint",
          "noteVersion",
        ]) ||
        dependency.noteFingerprint !== undefined ||
        dependency.noteVersion !== undefined,
    ) ||
    !sameDependencies(row.dependencies, expected)
  )
    return { valid: false };

  return {
    valid: true,
    value: row.value,
    identity: canonicalSha256({
      pairDomain: "wishlist-candidate",
      collectionId,
      pair: [...rowMembers].sort(),
      signal: row.signal,
      dependencyKind: row.dependencyKind,
      value: row.value,
      confidence: row.confidence ?? null,
      modelId: row.modelId,
      rubricVersion: row.rubricVersion,
      questionVersion: row.questionVersion,
      requestSchemaVersion: row.requestSchemaVersion,
      scoreMappingVersion: row.scoreMappingVersion,
      semanticPolicyId: row.semanticPolicyId,
      completedAt: row.completedAt,
      dependencies: expected,
    }),
    dependencies: expected,
  };
}

function requestIdentity(request: WishlistDescriptionSignalCaptureRequest): string {
  return canonicalSha256({
    collectionId: request.collectionId,
    candidateBggIds: [...request.candidateBggIds].sort((a, b) => a - b),
    eligibleOwnedIds: [...request.eligibleOwnedIds].sort(),
    semanticPolicy: request.semanticPolicy,
    contract: JEV_JUDGMENT_CONTRACT,
    pairs: request.pairs
      .map((pair) => ({
        candidateBggId: pair.candidate.bggId,
        candidateName: pair.candidate.name,
        candidateSource: sourceIdentity(pair.candidate.bggSource),
        ownedId: pair.ownedGame.id,
        ownedBggId: pair.ownedGame.bggId,
        ownedName: pair.ownedGame.name,
        ownedDescription: pair.ownedGame.description,
      }))
      .sort(
        (left, right) =>
          left.candidateBggId - right.candidateBggId || left.ownedId.localeCompare(right.ownedId),
      ),
  });
}

function validateCapture(request: WishlistDescriptionSignalCaptureRequest): boolean {
  if (
    !request.collectionId.trim() ||
    request.semanticPolicy.enabled !== true ||
    !Number.isFinite(request.semanticPolicy.weights.factual) ||
    request.semanticPolicy.weights.factual < 0 ||
    !Number.isFinite(request.semanticPolicy.weights.description) ||
    request.semanticPolicy.weights.description <= 0
  )
    return false;
  const candidates = new Set(request.candidateBggIds);
  const owned = new Set(request.eligibleOwnedIds);
  if (
    candidates.size !== request.candidateBggIds.length ||
    owned.size !== request.eligibleOwnedIds.length ||
    request.candidateBggIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    request.eligibleOwnedIds.some((id) => !id.trim())
  )
    return false;
  const seenPairs = new Set<string>();
  for (const pair of request.pairs) {
    const key = JSON.stringify([pair.candidate.bggId, pair.ownedGame.id]);
    if (
      !candidates.has(pair.candidate.bggId) ||
      !owned.has(pair.ownedGame.id) ||
      pair.ownedGame.bggId === pair.candidate.bggId ||
      seenPairs.has(key) ||
      !validName(pair.candidate.name) ||
      !validName(pair.ownedGame.name) ||
      !usableSource(pair.candidate.bggSource.description) ||
      !usableSource(pair.ownedGame.description)
    )
      return false;
    seenPairs.add(key);
  }
  return true;
}

export interface WishlistCandidateDescriptionResolver extends WishlistDescriptionSignalResolver {
  /** Revision/source fence only; never performs pair lookups. */
  isCurrent(request: WishlistDescriptionSignalCaptureRequest): boolean;
}

/** Keyed, bounded candidate proof resolver. It never reads owner-note state or source text from cache rows. */
export function createWishlistCandidateDescriptionResolver(
  cache: Pick<JevPairCache, "available" | "lookup" | "mutationRevision">,
): WishlistCandidateDescriptionResolver {
  let lastProof: { identity: string; revision: number; values: readonly (number | null)[] } | null =
    null;

  const currentRevision = (): number | null => {
    try {
      const revision = cache.mutationRevision();
      return Number.isSafeInteger(revision) && revision !== null && revision >= 0 ? revision : null;
    } catch {
      return null;
    }
  };

  const resolver: WishlistCandidateDescriptionResolver = Object.assign(
    (request: WishlistDescriptionSignalCaptureRequest) => {
      const empty = request.pairs.map(() => null);
      if (!cache.available || !validateCapture(request)) {
        lastProof = null;
        return Promise.resolve(empty);
      }
      let identity: string;
      try {
        identity = requestIdentity(request);
      } catch {
        lastProof = null;
        return Promise.resolve(empty);
      }
      const before = currentRevision();
      if (before === null) {
        lastProof = null;
        return Promise.resolve(empty);
      }
      if (lastProof?.identity === identity && lastProof.revision === before)
        return Promise.resolve([...lastProof.values]);

      try {
        const values = request.pairs.map((pair) => {
          const candidateId = encodeWishlistBggMember(
            request.collectionId,
            String(pair.candidate.bggId),
          );
          const ownedId = encodeOwnedLocalMember(request.collectionId, pair.ownedGame.id);
          const row = cache.lookup({
            gameAId: candidateId,
            gameBId: ownedId,
            signal: "C",
            pairDomain: "wishlist-candidate",
          });
          const checked = validateWishlistCandidateCOnlyRow(
            row,
            request.collectionId,
            pair,
            request.candidateBggIds,
            request.eligibleOwnedIds,
          );
          return checked.valid ? checked.value : null;
        });
        const after = currentRevision();
        if (after === null || after !== before) {
          lastProof = null;
          return Promise.resolve(empty);
        }
        lastProof = { identity, revision: after, values };
        return Promise.resolve([...values]);
      } catch {
        lastProof = null;
        return Promise.resolve(empty);
      }
    },
    {
      isCurrent(request: WishlistDescriptionSignalCaptureRequest): boolean {
        if (!cache.available || !validateCapture(request) || !lastProof) return false;
        try {
          return (
            requestIdentity(request) === lastProof.identity &&
            currentRevision() === lastProof.revision
          );
        } catch {
          return false;
        }
      },
    },
  );
  return resolver;
}
