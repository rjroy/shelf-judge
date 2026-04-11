import { describe, test, expect, beforeEach } from "bun:test";
import * as path from "node:path";
import { createGameService } from "../../src/services/game-service.js";
import { createFitnessService } from "../../src/services/fitness-service.js";
import { createStorageService } from "../../src/services/storage-service.js";
import { createBggClient } from "../../src/services/bgg-client.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";
import { createMockFetch } from "../helpers/mock-fetch.js";
import type { GameService } from "../../src/services/game-service.js";
import type { StorageService } from "../../src/services/storage-service.js";
import type { BggClient } from "../../src/services/bgg-client.js";
import type { MockFileOps } from "../helpers/mock-file-ops.js";

const fixturesDir = path.join(import.meta.dir, "../fixtures");

async function readFixture(filename: string): Promise<string> {
  return Bun.file(path.join(fixturesDir, filename)).text();
}

let fileOps: MockFileOps;
let storageService: StorageService;
let gameService: GameService;
let bggClient: BggClient;
let mockFetch: ReturnType<typeof createMockFetch>;

beforeEach(() => {
  fileOps = createMockFileOps();
  storageService = createStorageService({
    dataDir: "/data",
    configPath: "/config/config.json",
    fileOps,
  });
  mockFetch = createMockFetch();
  bggClient = createBggClient({
    config: { bggAuthToken: "test-token", username: null },
    fetchFn: mockFetch.fn,
    delayMs: 0,
    delayFn: () => Promise.resolve(),
  });
  const fitnessService = createFitnessService();
  gameService = createGameService({ storageService, fitnessService, bggClient });
});

describe("GameService BGG Integration", () => {
  describe("addGame with bggId", () => {
    test("fetches BGG data when bggId provided", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      mockFetch.enqueue(200, thingXml);

      const { game } = await gameService.addGame({
        name: "Wingspan",
        bggId: 266192,
      });

      expect(game.bggId).toBe(266192);
      expect(game.bggData).not.toBeNull();
      expect(game.bggData!.communityRating).toBe(8.00153);
      expect(game.bggData!.weight).toBe(2.4802);
      expect(game.name).toBe("Wingspan");
      expect(game.yearPublished).toBe(2019);
      expect(game.minPlayers).toBe(1);
      expect(game.maxPlayers).toBe(5);
    });

    test("adds game with warning when BGG unavailable", async () => {
      mockFetch.enqueue(500, "Internal Server Error");
      mockFetch.enqueue(500, "Internal Server Error");
      mockFetch.enqueue(500, "Internal Server Error");

      const { game, warning } = await gameService.addGame({
        name: "Wingspan",
        bggId: 266192,
      });

      expect(game.bggId).toBe(266192);
      expect(game.bggData).toBeNull();
      expect(warning).toBeDefined();
      expect(warning).toContain("BGG data could not be fetched");
    });
  });

  describe("searchGames", () => {
    test("returns search results from BGG", async () => {
      const searchXml = await readFixture("search-wingspan.xml");
      const thingBatchXml = await readFixture("thing-search-batch.xml");
      mockFetch.enqueue(200, searchXml);
      mockFetch.enqueue(200, thingBatchXml);

      const results = await gameService.searchGames("Wingspan");

      expect(results).toHaveLength(14);
      expect(results[1].bggId).toBe(266192);
      expect(results[1].name).toBe("Wingspan");
    });

    test("throws when BGG not configured", async () => {
      const noBggService = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(noBggService.searchGames("Wingspan")).rejects.toThrow(
        "BGG integration is not configured",
      );
    });
  });

  describe("refreshBggData", () => {
    test("updates bggData and preserves user overrides", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      // First fetch for addGame
      mockFetch.enqueue(200, thingXml);

      const { game } = await gameService.addGame({
        name: "Wingspan",
        bggId: 266192,
      });

      // Rate a BGG-derived axis (override)
      const collection = await storageService.loadCollection();
      const complexityAxis = collection.axes.find((a) => a.bggField === "weight");
      expect(complexityAxis).toBeDefined();
      await gameService.rateGame(game.id, { [complexityAxis!.id]: 7 });

      // Refresh: second fetch
      mockFetch.enqueue(200, thingXml);
      const refreshed = await gameService.refreshBggData(game.id);

      // bggData should be updated (fetchedAt changed)
      expect(refreshed.bggData).not.toBeNull();
      expect(refreshed.bggData!.communityRating).toBe(8.00153);

      // User override should be preserved
      expect(refreshed.ratings[complexityAxis!.id]).toBe(7);
    });

    test("throws for manual game without bggId", async () => {
      const { game } = await gameService.addGame({ name: "Manual Game" });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(gameService.refreshBggData(game.id)).rejects.toThrow("no BGG ID");
    });
  });

  describe("refreshAllBggData", () => {
    test("refreshes all games with bggIds", async () => {
      const wingspanXml = await readFixture("thing-wingspan-266192.xml");
      const gloomhavenXml = await readFixture("thing-gloomhaven-174430.xml");

      // Add two BGG games
      mockFetch.enqueue(200, wingspanXml);
      await gameService.addGame({ name: "Wingspan", bggId: 266192 });

      mockFetch.enqueue(200, gloomhavenXml);
      await gameService.addGame({ name: "Gloomhaven", bggId: 174430 });

      // Add a manual game (should be skipped in refresh)
      await gameService.addGame({ name: "Manual Game" });

      // Prepare batch response containing both games
      const batchXml = `<?xml version="1.0" encoding="utf-8"?>
<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  ${wingspanXml.replace(/<\?xml[^?]*\?>/, "").replace(/<\/?items[^>]*>/g, "")}
  ${gloomhavenXml.replace(/<\?xml[^?]*\?>/, "").replace(/<\/?items[^>]*>/g, "")}
</items>`;
      mockFetch.enqueue(200, batchXml);

      const summary = await gameService.refreshAllBggData();

      expect(summary.refreshed).toBe(2);
      expect(summary.errors).toHaveLength(0);
    });
  });

  describe("fitness score with BGG-derived axes", () => {
    test("includes BGG-derived axes when bggData present", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      mockFetch.enqueue(200, thingXml);

      const { game } = await gameService.addGame({
        name: "Wingspan",
        bggId: 266192,
      });

      const result = await gameService.getGame(game.id);

      // Default axes are Community Rating and Complexity, both BGG-derived
      expect(result.score).not.toBeNull();
      expect(result.score!.ratedAxisCount).toBe(2);

      // Community Rating: 8.00153 (1-10 scale, identity)
      // Complexity: 2.4802 on 1-5 scale, higher-is-better: 1 + 9*(2.4802-1)/4 = 4.33
      // Equal weights (50/50): (8.00153 + 4.33) / 2 ≈ 6.17 -> 6.2
      expect(result.score!.score).toBe(6.2);
    });

    test("excludes BGG-derived axes when bggData absent", async () => {
      const { game } = await gameService.addGame({ name: "Manual Game" });

      const result = await gameService.getGame(game.id);

      // No personal ratings, no BGG data -> no score
      expect(result.score).toBeNull();
    });

    test("override of BGG-derived axis shows in breakdown", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      mockFetch.enqueue(200, thingXml);

      const { game } = await gameService.addGame({
        name: "Wingspan",
        bggId: 266192,
      });

      const collection = await storageService.loadCollection();
      const complexityAxis = collection.axes.find((a) => a.bggField === "weight");

      // Override the complexity axis
      await gameService.rateGame(game.id, { [complexityAxis!.id]: 7 });

      const result = await gameService.getGame(game.id);
      expect(result.score).not.toBeNull();

      const complexityBreakdown = result.score!.breakdown.find(
        (b) => b.axisId === complexityAxis!.id,
      );
      expect(complexityBreakdown).toBeDefined();
      expect(complexityBreakdown!.source).toBe("override");
      expect(complexityBreakdown!.rating).toBe(7);
      expect(complexityBreakdown!.bggOriginal).toBe(2.5); // raw BGG weight 2.4802, rounded
    });
  });
});
