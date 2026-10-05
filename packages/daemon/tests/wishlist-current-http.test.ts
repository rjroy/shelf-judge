import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Axis, DurableGame, WishlistEntry } from "@shelf-judge/shared";
import { createInitialEntityMetadata } from "@shelf-judge/shared";
import type { BggClient } from "../src/services/bgg-client.js";
import { createFileOps } from "../src/services/file-ops.js";
import { createJevPairCache } from "../src/services/jev-pair-cache-service.js";
import type { JevPairJudgment } from "../src/services/jev-pair-cache-service.js";
import { JEV_JUDGMENT_CONTRACT } from "../src/services/jev/jev-judgment-contract.js";
import {
  buildJevPairDependencies,
  encodeOwnedLocalMember,
  encodeWishlistBggMember,
} from "../src/services/jev-pair-identity.js";
import { WishlistEntryReadResultSchemaV2 } from "../../shared/src/wishlist-current-projection-v2.js";
import { createTestApp } from "./helpers/test-app.js";

const dirs: string[] = [];
const observedAt = "2026-10-04T00:00:00.000Z";

function ratedGame(id: string, rating?: number): DurableGame {
  const bggId = Number(id.replace(/\D/g, "")) || 100;
  return {
    id,
    bggId,
    entityMetadata: createInitialEntityMetadata(bggId),
    name: id,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: 3,
    playingTime: 60,
    imageUrl: null,
    numPlays: null,
    latestPlayCountCheck: null,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
    durationEvidence: { status: "missing", source: "manual", observedAt: null },
    playerRangeEvidence: { status: "missing", source: "manual", observedAt: null },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    bggData: {
      communityRating: 7,
      bayesAverage: 7,
      weight: 2.5,
      numWeightVotes: 1,
      description: `Private test description for ${id}`,
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: observedAt,
    },
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: rating === undefined ? {} : { personal: rating },
    createdAt: observedAt,
    updatedAt: observedAt,
    ownerNote: { state: "missing", version: 0, updatedAt: null },
  };
}

function personalAxis(): Axis {
  return {
    id: "personal",
    name: "Personal",
    description: null,
    weight: 1,
    enabled: true,
    source: "personal",
    createdAt: observedAt,
    updatedAt: observedAt,
  };
}

function communityAxis(): Axis {
  return {
    id: "community",
    name: "Community Rating",
    description: null,
    weight: 50,
    enabled: true,
    source: "derived",
    derivedField: "communityRating",
    configuration: {},
    createdAt: observedAt,
    updatedAt: observedAt,
  };
}
afterEach(async () =>
  Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))),
);

describe("production wishlist current HTTP projection", () => {
  test("serves cache-updated wishlist scoring through the real app composition", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wishlist-current-cache-http-"));
    dirs.push(dir);
    const cache = await createJevPairCache(join(dir, "cache"));
    let bggReads = 0;
    const context = createTestApp({
      dataDir: join(dir, "data"),
      configPath: join(dir, "config.json"),
      fileOps: createFileOps(),
      jevPairCache: cache,
      bggClient: {
        getGame: () => {
          bggReads++;
          return Promise.reject(new Error("ordinary read attempted BGG hydration"));
        },
      } as unknown as BggClient,
    });
    try {
      const collection = await context.storageService.loadCollection();
      collection.axes = [
        { ...personalAxis(), weight: 100 },
        { ...communityAxis(), weight: 1 },
      ];
      collection.games = [
        ratedGame("target"),
        ratedGame("reference-four", 2),
        ratedGame("reference-eight", 8),
      ];
      collection.semanticRedundancy.settings = {
        ...collection.semanticRedundancy.settings,
        enabled: true,
        weights: { factual: 1, description: 2, ownerNote: 0 },
      };
      await context.storageService.saveCollection(collection);
      await context.storageService.savePredictionSettings({
        ...(await context.storageService.loadPredictionSettings()),
        stageThresholds: [1, 2, 3],
      });
      const candidate: WishlistEntry = {
        id: "cached-entry",
        bggId: 93003,
        name: "Cached candidate",
        yearPublished: 2024,
        thumbnailUrl: null,
        predictedScore: 9.5,
        predictionConfidence: "strong",
        predictedBreakdown: [{ axisName: "Community Rating", rating: 1, confidence: "strong" }],
        nicheImpact: null,
        redundancyPreview: null,
        addedAt: observedAt,
        bggSource: {
          observedAt,
          description: "Candidate private description",
          mechanics: [],
          categories: [],
          weight: null,
          communityRating: 8.347,
          minPlayers: null,
          maxPlayers: null,
          bestPlayers: null,
          playingTime: null,
        },
      };
      await context.storageService.saveWishlist([candidate]);
      const frame = await context.unifiedScoringService.capture({ includeWishlist: true });
      const wishlistCandidate = frame.sources.wishlistCandidates?.[0];
      const references = frame.sources.collection.games.filter((game) => game.id !== "target");
      if (!wishlistCandidate || references.length !== 2)
        throw new Error("Captured fixture incomplete");
      const candidateMember = encodeWishlistBggMember(
        frame.sources.collection.id,
        String(candidate.bggId),
      );
      const judgments: JevPairJudgment[] = [];
      for (const [index, reference] of references.entries()) {
        const left = {
          id: candidateMember,
          name: wishlistCandidate.name,
          description: wishlistCandidate.bggSource.description ?? "",
        };
        const right = {
          id: encodeOwnedLocalMember(frame.sources.collection.id, reference.id),
          name: reference.name,
          description: reference.bggData?.description ?? "",
        };
        const [gameA, gameB] = [left, right].sort((a, b) => a.id.localeCompare(b.id));
        const judgment: JevPairJudgment = {
          pairDomain: "wishlist-candidate",
          collectionId: frame.sources.collection.id,
          gameAId: gameA.id,
          gameBId: gameB.id,
          signal: "C",
          dependencyKind: "C_ONLY",
          value: index === 0 ? 0 : 1,
          confidence: 1,
          ...JEV_JUDGMENT_CONTRACT,
          completedAt: observedAt,
          dependencies: buildJevPairDependencies(
            "C_ONLY",
            { gameId: gameA.id, name: gameA.name, description: gameA.description },
            { gameId: gameB.id, name: gameB.name, description: gameB.description },
          ),
        };
        cache.upsert(judgment);
        judgments.push(judgment);
      }

      const firstResponse = await context.app.request("/api/wishlist/redundancy");
      expect(firstResponse.status).toBe(200);
      const [first] = (await firstResponse.json()) as Array<{
        entry: {
          predictedScore: number | null;
          predictedBreakdown: Array<{
            axisName: string;
            rating: number;
            confidence: string;
          }> | null;
        };
        prediction: { availability: string; result: { score: number } | null };
      }>;
      if (!first?.prediction.result) throw new Error("Current cached prediction unavailable");
      const firstScore = first.prediction.result.score;
      expect(first.entry.predictedScore).toBe(firstScore);
      expect(firstScore).not.toBe(9.5);
      expect(first.entry.predictedBreakdown).toContainEqual({
        axisName: "Community Rating",
        rating: 8.3,
        confidence: "actual",
      });
      expect(first.entry.predictedBreakdown).not.toContainEqual({
        axisName: "Community Rating",
        rating: 1,
        confidence: "strong",
      });
      expect((await context.storageService.loadWishlist())[0]?.bggSource?.communityRating).toBe(
        8.347,
      );

      for (const row of judgments) {
        cache.upsert({ ...row, value: 0, completedAt: "2026-10-04T00:01:00.000Z" });
      }
      const secondResponse = await context.app.request("/api/wishlist/redundancy");
      const [second] = (await secondResponse.json()) as Array<{
        entry: { predictedScore: number | null };
        prediction: { result: { score: number } | null };
      }>;
      if (!second?.prediction.result) throw new Error("Updated current prediction unavailable");
      expect(second.prediction.result.score).not.toBe(firstScore);
      expect(second.entry.predictedScore).toBe(second.prediction.result.score);
      expect(bggReads).toBe(0);
    } finally {
      cache.close();
    }
  });

  test("reads V2 unavailable state without saved-score fallback or BGG hydration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wishlist-current-http-"));
    dirs.push(dir);
    const cache = await createJevPairCache(join(dir, "cache"));
    let bggReads = 0;
    const context = createTestApp({
      dataDir: join(dir, "data"),
      configPath: join(dir, "config.json"),
      fileOps: createFileOps(),
      jevPairCache: cache,
      bggClient: {
        getGame: () => {
          bggReads++;
          return Promise.reject(new Error("ordinary read attempted BGG hydration"));
        },
      } as unknown as BggClient,
    });
    try {
      const historic: WishlistEntry = {
        id: "old-entry",
        bggId: 93001,
        name: "Historic candidate",
        yearPublished: 2020,
        thumbnailUrl: null,
        predictedScore: 8.6,
        predictionConfidence: "strong",
        predictedBreakdown: [{ axisName: "Old axis", rating: 9, confidence: "strong" }],
        nicheImpact: null,
        redundancyPreview: null,
        addedAt: "2026-01-01T00:00:00.000Z",
      };
      const factual: WishlistEntry = {
        ...historic,
        id: "factual-entry",
        bggId: 93002,
        name: "Verified candidate",
        predictedScore: 9.4,
        predictionConfidence: "strong",
        predictedBreakdown: [{ axisName: "Old axis", rating: 9, confidence: "strong" }],
        bggSource: {
          observedAt: "2026-01-01T00:00:00.000Z",
          description: null,
          mechanics: [],
          categories: [],
          weight: null,
          communityRating: 7,
          minPlayers: null,
          maxPlayers: null,
          bestPlayers: null,
          playingTime: null,
        },
      };
      await context.storageService.saveWishlist([historic, factual]);

      const response = await context.app.request("/api/wishlist/redundancy");
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const body = (await response.json()) as unknown[];
      expect(body).toHaveLength(2);
      const parsed = body.map((result) => WishlistEntryReadResultSchemaV2.parse(result));
      expect(parsed[0]).toMatchObject({
        entry: { id: "old-entry", predictedScore: null, predictionConfidence: null },
        prediction: {
          availability: "unavailable",
          source: "current",
          result: null,
          reason: "missing-source",
        },
        redundancy: { source: "unavailable", orderingScore: null },
      });
      expect(parsed[1]).toMatchObject({
        entry: { id: "factual-entry", predictedScore: 7 },
        prediction: {
          availability: "available",
          source: "current",
          result: { score: 7, ratedAxisCount: 1 },
          predictionUnavailable: { reason: "stage-0", ratedGameCount: 0 },
        },
        redundancy: { source: "base-prediction", orderingScore: 7 },
      });
      expect(JSON.stringify(body)).not.toContain("8.6");
      expect(JSON.stringify(body)).not.toContain("bggSource");
      expect(JSON.stringify(body)).not.toContain("ownerNote");
      expect(bggReads).toBe(0);

      const flat = (await (await context.app.request("/api/wishlist")).json()) as Array<{
        predictedScore: number | null;
      }>;
      expect(flat.map((entry) => entry.predictedScore)).toEqual([null, 7]);
      expect(bggReads).toBe(0);
    } finally {
      cache.close();
    }
  });
});
