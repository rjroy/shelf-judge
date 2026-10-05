import { describe, expect, test } from "bun:test";
import type { WishlistBggSourceSnapshot } from "@shelf-judge/shared";
import { JEV_JUDGMENT_CONTRACT } from "../src/services/jev/jev-judgment-contract.js";
import {
  buildJevPairDependencies,
  encodeOwnedLocalMember,
  encodeWishlistBggMember,
} from "../src/services/jev-pair-identity.js";
import type { JevPairJudgment } from "../src/services/jev-pair-cache-service.js";
import { validateWishlistCandidateCOnlyRow } from "../src/services/wishlist-candidate-read-proof.js";
import type { WishlistDescriptionPairRequest } from "../src/services/wishlist-candidate-read-proof.js";

const collectionId = "collection-1";

function candidateSource(description: string): WishlistBggSourceSnapshot {
  return {
    observedAt: "2026-10-03T00:00:00.000Z",
    description,
    mechanics: ["Mechanic"],
    categories: ["Category"],
    weight: 2.5,
    communityRating: 7.1,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: 3,
    playingTime: 60,
  };
}

function pair(
  candidateBggId: number,
  ownedId: string,
  descriptions: { candidate?: string; owned?: string } = {},
): WishlistDescriptionPairRequest {
  return {
    candidate: {
      bggId: candidateBggId,
      name: `Candidate ${candidateBggId}`,
      bggSource: candidateSource(descriptions.candidate ?? `Candidate prose ${candidateBggId}`),
    },
    ownedGame: {
      id: ownedId,
      bggId: null,
      name: `Owned ${ownedId}`,
      description: descriptions.owned ?? `Owned prose ${ownedId}`,
    },
  };
}

function membership(item: WishlistDescriptionPairRequest) {
  return {
    candidateBggIds: new Set([item.candidate.bggId]),
    eligibleOwnedIds: new Set([item.ownedGame.id]),
  };
}

function candidateRow(item: WishlistDescriptionPairRequest, value: number): JevPairJudgment {
  const candidateId = encodeWishlistBggMember(collectionId, String(item.candidate.bggId));
  const ownedId = encodeOwnedLocalMember(collectionId, item.ownedGame.id);
  return {
    pairDomain: "wishlist-candidate",
    collectionId,
    gameAId: candidateId,
    gameBId: ownedId,
    signal: "C",
    dependencyKind: "C_ONLY",
    value,
    ...JEV_JUDGMENT_CONTRACT,
    completedAt: "2026-10-03T00:01:00.000Z",
    dependencies: buildJevPairDependencies(
      "C_ONLY",
      {
        gameId: candidateId,
        name: item.candidate.name,
        description: item.candidate.bggSource.description ?? undefined,
      },
      {
        gameId: ownedId,
        name: item.ownedGame.name,
        description: item.ownedGame.description ?? undefined,
      },
    ),
  };
}

describe("wishlist candidate C-only row validation", () => {
  test("accepts C_ONLY without note permission and rejects stale sources or contract provenance", () => {
    const item = pair(103, "local-a");
    const row = candidateRow(item, 0);
    expect(
      validateWishlistCandidateCOnlyRow(row, collectionId, item, {
        candidateBggIds: new Set([item.candidate.bggId]),
        eligibleOwnedIds: new Set(["local-a"]),
      }),
    ).toMatchObject({ valid: true, value: 0 });
    expect("ownerNote" in item.ownedGame).toBe(false);
    for (const field of [
      "modelId",
      "rubricVersion",
      "questionVersion",
      "requestSchemaVersion",
      "scoreMappingVersion",
      "semanticPolicyId",
    ] as const) {
      expect(
        validateWishlistCandidateCOnlyRow(
          { ...row, [field]: "stale-provenance" },
          collectionId,
          item,
          membership(item),
        ).valid,
      ).toBe(false);
    }
    expect(
      validateWishlistCandidateCOnlyRow(
        row,
        collectionId,
        pair(103, "local-a", { candidate: "changed candidate prose" }),
        membership(item),
      ).valid,
    ).toBe(false);
    expect(
      validateWishlistCandidateCOnlyRow(
        row,
        collectionId,
        { ...item, candidate: { ...item.candidate, name: "Renamed candidate" } },
        membership(item),
      ).valid,
    ).toBe(false);
    expect(
      validateWishlistCandidateCOnlyRow(
        row,
        collectionId,
        { ...item, ownedGame: { ...item.ownedGame, name: "Renamed owned game" } },
        membership(item),
      ).valid,
    ).toBe(false);
    expect(
      validateWishlistCandidateCOnlyRow(
        row,
        collectionId,
        pair(103, "local-a", { owned: "changed owned prose" }),
        membership(item),
      ).valid,
    ).toBe(false);
    expect(
      validateWishlistCandidateCOnlyRow(
        { ...row, pairDomain: "collection" },
        collectionId,
        item,
        membership(item),
      ).valid,
    ).toBe(false);
    expect(
      validateWishlistCandidateCOnlyRow(
        { ...row, dependencyKind: "SHARED_CD" },
        collectionId,
        item,
        membership(item),
      ).valid,
    ).toBe(false);
    expect(
      validateWishlistCandidateCOnlyRow(
        {
          ...row,
          dependencies: row.dependencies.map((dependency) => ({
            ...dependency,
            noteFingerprint: "a".repeat(64),
          })),
        },
        collectionId,
        item,
        membership(item),
      ).valid,
    ).toBe(false);
  });

  test("membership proof probes stay constant as the full eligible set grows", () => {
    const pairs = [pair(105, "local-a"), pair(105, "local-b"), pair(106, "local-a")];
    const candidateBggIds = new Set(pairs.map(({ candidate }) => candidate.bggId));
    const eligibleOwnedIds = new Set([
      ...pairs.map(({ ownedGame }) => ownedGame.id),
      ...Array.from({ length: 122 }, (_, index) => `unrelated-owned-${index}`),
    ]);
    const probes = { candidate: 0, owned: 0 };

    for (const item of pairs) {
      const result = validateWishlistCandidateCOnlyRow(
        candidateRow(item, 0.5),
        collectionId,
        item,
        {
          candidateBggIds,
          eligibleOwnedIds,
          onProbe: (domain) => probes[domain]++,
        },
      );
      expect(result.valid).toBe(true);
    }

    expect(eligibleOwnedIds.size).toBe(124);
    expect(probes).toEqual({ candidate: 3, owned: 3 });
  });
});
