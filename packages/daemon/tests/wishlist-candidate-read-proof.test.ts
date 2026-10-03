import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WishlistBggSourceSnapshot } from "@shelf-judge/shared";
import { JEV_JUDGMENT_CONTRACT } from "../src/services/jev/jev-judgment-contract.js";
import {
  buildJevPairDependencies,
  encodeOwnedLocalMember,
  encodeWishlistBggMember,
} from "../src/services/jev-pair-identity.js";
import {
  createJevPairCache,
  type JevPairJudgment,
} from "../src/services/jev-pair-cache-service.js";
import {
  createWishlistCandidateDescriptionResolver,
  validateWishlistCandidateCOnlyRow,
} from "../src/services/wishlist-candidate-read-proof.js";
import type {
  WishlistDescriptionPairRequest,
  WishlistDescriptionSignalCaptureRequest,
} from "../src/services/wishlist-redundancy-scoring.js";

const dirs: string[] = [];
afterEach(async () =>
  Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))),
);

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

function capture(
  pairs: readonly WishlistDescriptionPairRequest[],
): WishlistDescriptionSignalCaptureRequest {
  return {
    collectionId,
    candidateBggIds: [...new Set(pairs.map((item) => item.candidate.bggId))].sort((a, b) => a - b),
    eligibleOwnedIds: [...new Set(pairs.map((item) => item.ownedGame.id))].sort(),
    semanticPolicy: { enabled: true, weights: { factual: 0.4, description: 0.6 } },
    pairs,
  };
}

function membership(request: WishlistDescriptionSignalCaptureRequest) {
  return {
    candidateBggIds: new Set(request.candidateBggIds),
    eligibleOwnedIds: new Set(request.eligibleOwnedIds),
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

describe("wishlist candidate C-only read proof", () => {
  test("uses only typed candidate-domain point lookups and reuses an unchanged proof without queries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wishlist-candidate-proof-"));
    dirs.push(dir);
    const cache = await createJevPairCache(dir);
    const pairs = [pair(101, "local-1"), pair(101, "local-2"), pair(102, "local-1")];
    pairs.forEach((item, index) => cache.upsert(candidateRow(item, index / 2)));
    // An ordinary collection-domain C row with the same encoded members is not candidate evidence.
    cache.upsert({ ...candidateRow(pairs[0], 0.99), pairDomain: undefined });
    let lookups = 0;
    const resolver = createWishlistCandidateDescriptionResolver({
      available: cache.available,
      mutationRevision: () => cache.mutationRevision(),
      lookup: (key) => {
        lookups++;
        return cache.lookup(key);
      },
    });
    const request = capture(pairs);
    expect(await resolver(request)).toEqual([0, 0.5, 1]);
    expect(lookups).toBe(3);
    expect(resolver.isCurrent(request)).toBe(true);
    expect(resolver.isCurrent(request)).toBe(true);
    expect(lookups).toBe(3);
    expect(await resolver(request)).toEqual([0, 0.5, 1]);
    expect(lookups).toBe(3);

    const changed = capture([pairs[0], pairs[1]]);
    expect(resolver.isCurrent(changed)).toBe(false);
    expect(await resolver(changed)).toEqual([0, 0.5]);
    expect(lookups).toBe(5);
    cache.close();
  });

  test("accepts C_ONLY without note permission and rejects stale sources or contract provenance", () => {
    const item = pair(103, "local-a");
    const row = candidateRow(item, 0);
    const request = capture([item]);
    expect(
      validateWishlistCandidateCOnlyRow(row, collectionId, item, {
        candidateBggIds: new Set(request.candidateBggIds),
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
          membership(request),
        ).valid,
      ).toBe(false);
    }
    expect(
      validateWishlistCandidateCOnlyRow(
        row,
        collectionId,
        pair(103, "local-a", { candidate: "changed candidate prose" }),
        membership(request),
      ).valid,
    ).toBe(false);
    expect(
      validateWishlistCandidateCOnlyRow(
        row,
        collectionId,
        { ...item, candidate: { ...item.candidate, name: "Renamed candidate" } },
        membership(request),
      ).valid,
    ).toBe(false);
    expect(
      validateWishlistCandidateCOnlyRow(
        row,
        collectionId,
        { ...item, ownedGame: { ...item.ownedGame, name: "Renamed owned game" } },
        membership(request),
      ).valid,
    ).toBe(false);
    expect(
      validateWishlistCandidateCOnlyRow(
        row,
        collectionId,
        pair(103, "local-a", { owned: "changed owned prose" }),
        membership(request),
      ).valid,
    ).toBe(false);
    expect(
      validateWishlistCandidateCOnlyRow(
        { ...row, pairDomain: "collection" },
        collectionId,
        item,
        membership(request),
      ).valid,
    ).toBe(false);
    expect(
      validateWishlistCandidateCOnlyRow(
        { ...row, dependencyKind: "SHARED_CD" },
        collectionId,
        item,
        membership(request),
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
        membership(request),
      ).valid,
    ).toBe(false);
  });

  test("membership proof probes stay constant as the full eligible set grows", () => {
    const pairs = [pair(105, "local-a"), pair(105, "local-b"), pair(106, "local-a")];
    const requests = capture(pairs);
    const candidateBggIds = new Set(requests.candidateBggIds);
    const eligibleOwnedIds = new Set([
      ...requests.eligibleOwnedIds,
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

  test("source, membership, policy, and cache revisions invalidate currentness without a lookup", async () => {
    const item = pair(104, "local-b");
    const row = candidateRow(item, 0.7);
    let revision: number | null = 3;
    let lookups = 0;
    const resolver = createWishlistCandidateDescriptionResolver({
      available: true,
      mutationRevision: () => revision,
      lookup: () => {
        lookups++;
        return row;
      },
    });
    const original = capture([item]);
    expect(await resolver(original)).toEqual([0.7]);
    const count = lookups;
    expect(resolver.isCurrent(original)).toBe(true);
    const changedSource = capture([pair(104, "local-b", { candidate: "new source" })]);
    expect(resolver.isCurrent(changedSource)).toBe(false);
    expect(await resolver(changedSource)).toEqual([null]);
    expect(lookups).toBe(count + 1);
    expect(
      resolver.isCurrent({
        ...original,
        eligibleOwnedIds: ["local-b", "local-c"],
      }),
    ).toBe(false);
    expect(
      resolver.isCurrent({
        ...original,
        semanticPolicy: { enabled: true, weights: { factual: 0.8, description: 0.2 } },
      }),
    ).toBe(false);
    revision++;
    expect(resolver.isCurrent(original)).toBe(false);
    expect(lookups).toBe(count + 1);
    expect(await resolver(original)).toEqual([0.7]);
    expect(lookups).toBe(count + 2);
  });

  test("fails closed when revision changes during reads or a lookup fails", async () => {
    const item = pair(105, "local-c");
    const row = candidateRow(item, 0.8);
    let revision = 1;
    let lookups = 0;
    const changing = createWishlistCandidateDescriptionResolver({
      available: true,
      mutationRevision: () => revision,
      lookup: () => {
        lookups++;
        revision++;
        return row;
      },
    });
    expect(await changing(capture([item]))).toEqual([null]);
    expect(changing.isCurrent(capture([item]))).toBe(false);
    expect(lookups).toBe(1);

    const failing = createWishlistCandidateDescriptionResolver({
      available: true,
      mutationRevision: () => 1,
      lookup: () => {
        throw new Error("cache read failed");
      },
    });
    expect(await failing(capture([item]))).toEqual([null]);
    expect(failing.isCurrent(capture([item]))).toBe(false);

    const unknownRevision = createWishlistCandidateDescriptionResolver({
      available: true,
      mutationRevision: () => null,
      lookup: () => row,
    });
    expect(await unknownRevision(capture([item]))).toEqual([null]);
  });
});
