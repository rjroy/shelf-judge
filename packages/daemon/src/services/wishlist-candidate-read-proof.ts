import type { WishlistBggSourceSnapshot } from "@shelf-judge/shared";
import { JEV_JUDGMENT_CONTRACT } from "./jev/jev-judgment-contract.js";
import type { JevPairJudgment } from "./jev-pair-cache-service.js";
import {
  buildJevPairDependencies,
  encodeOwnedLocalMember,
  encodeWishlistBggMember,
} from "./jev-pair-identity.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";

export interface WishlistDescriptionPairRequest {
  candidate: {
    bggId: number;
    name: string;
    bggSource: WishlistBggSourceSnapshot;
  };
  ownedGame: {
    id: string;
    bggId: number | null;
    name: string;
    description: string | null;
  };
}

export interface WishlistCandidateDescriptionProof {
  valid: true;
  value: number;
  identity: string;
  dependencies: JevPairJudgment["dependencies"];
}

export type WishlistCandidateDescriptionValidation =
  | WishlistCandidateDescriptionProof
  | { valid: false };

export interface WishlistCandidateMembershipIndex {
  candidateBggIds: ReadonlySet<number>;
  eligibleOwnedIds: ReadonlySet<string>;
  onProbe?: (domain: "candidate" | "owned") => void;
}

function usableSource(value: string | null): value is string {
  return value !== null && value.trim().length > 0 && value.length <= 12_000;
}

function validName(value: string): boolean {
  return value.length > 0 && value.length <= 200 && value.trim().length > 0;
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
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
  membership: WishlistCandidateMembershipIndex,
): WishlistCandidateDescriptionValidation {
  membership.onProbe?.("candidate");
  const candidateIsRequested = membership.candidateBggIds.has(pair.candidate.bggId);
  membership.onProbe?.("owned");
  const ownedIsEligible = membership.eligibleOwnedIds.has(pair.ownedGame.id);
  if (
    !row ||
    !collectionId.trim() ||
    !Number.isSafeInteger(pair.candidate.bggId) ||
    pair.candidate.bggId <= 0 ||
    pair.ownedGame.bggId === pair.candidate.bggId ||
    !candidateIsRequested ||
    !ownedIsEligible ||
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
