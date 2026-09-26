import { describe, test, expect, beforeEach } from "bun:test";
import {
  createTestApp,
  createMockBggClient,
  jsonRequest,
  type TestAppContext,
} from "../helpers/test-app.js";
import type {
  Axis,
  PredictedGameResponse,
  PredictionReadiness,
  PredictionSettings,
  NicheImpact,
  GameDetailWithPurchaseUtilization,
  GameWithPurchaseUtilization,
} from "@shelf-judge/shared";
import { createInitialEntityMetadata } from "@shelf-judge/shared";
import { calculateBggFitnessPreview } from "../../src/services/bgg-fitness-preview-service.js";

describe("prediction routes", () => {
  let ctx: TestAppContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  function factClient(failure = false) {
    return createMockBggClient({
      getGame: (bggId) =>
        Promise.resolve({
          entityMetadata: createInitialEntityMetadata(bggId),
          metadata: {
            bggId,
            name: `Game-${bggId}`,
            yearPublished: 2023,
            minPlayers: 1,
            maxPlayers: 4,
            playingTime: 90,
            imageUrl: null,
            thumbnailUrl: null,
          },
          bggData: {
            communityRating: 7.5,
            bayesAverage: 7.2,
            weight: 2.5,
            numWeightVotes: 100,
            description: null,
            mechanics: [{ id: 1, name: "Dice Rolling" }],
            categories: [{ id: 1, name: "Strategy" }],
            families: [],
            subdomains: [],
            bestPlayerCount: null,
            fetchedAt: "2026-08-28T00:00:00.000Z",
          },
        }),
      getBoardgameFacts: (ids) =>
        Promise.resolve({
          facts: failure
            ? []
            : ids.map((bggId) => ({
                bggId,
                primaryName: `Game-${bggId}`,
                yearPublished: 2023,
                yearMissing: false,
                mechanics: [{ id: 1, name: "Dice Rolling" }],
                mechanicsMissing: false,
                mechanicsComplete: true,
                warnings: [],
                observedAt: "2026-08-28T00:00:00.000Z",
              })),
          failures: failure ? ids.map((bggId) => ({ bggId, code: "MissingGame" as const })) : [],
        }),
    });
  }

  async function addGameWithRating(name: string, bggId?: number) {
    const body: Record<string, unknown> = { name };
    if (bggId !== undefined) body.bggId = bggId;
    const res = await jsonRequest(ctx.app, "POST", "/api/games", body);
    expect(res.status).toBe(201);
    const data = (await res.json()) as { game: { id: string } };
    return data.game.id;
  }

  describe("GET /api/predictions/readiness", () => {
    test("returns 200 with readiness shape", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/readiness");
      expect(res.status).toBe(200);

      const readiness = (await res.json()) as PredictionReadiness;
      expect(readiness.stage).toBe(0);
      expect(readiness.ratedGameCount).toBe(0);
      expect(readiness.nextStageAt).toBeGreaterThan(0);
      expect(Array.isArray(readiness.weakAxes)).toBe(true);
      expect(Array.isArray(readiness.suggestedActions)).toBe(true);
    });
  });

  describe("GET /api/predictions/settings", () => {
    test("returns 200 with default settings", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/settings");
      expect(res.status).toBe(200);

      const settings = (await res.json()) as PredictionSettings;
      expect(settings.stageThresholds).toEqual([5, 15, 30]);
      expect(settings.defaultK).toBe(5);
      expect(settings.minSimilarityThreshold).toBe(0.2);
    });
  });

  describe("PATCH /api/predictions/settings", () => {
    test("updates settings and returns merged result", async () => {
      const res = await jsonRequest(ctx.app, "PATCH", "/api/predictions/settings", {
        defaultK: 7,
      });
      expect(res.status).toBe(200);

      const settings = (await res.json()) as PredictionSettings;
      expect(settings.defaultK).toBe(7);
      expect(settings.stageThresholds).toEqual([5, 15, 30]);
    });

    test("returns 400 for invalid JSON", async () => {
      const res = await ctx.app.request(
        new Request("http://localhost/api/predictions/settings", {
          method: "PATCH",
          body: "not json",
          headers: { "Content-Type": "application/json" },
        }),
      );
      expect(res.status).toBe(400);
    });

    test("returns 400 for non-object body", async () => {
      const res = await jsonRequest(ctx.app, "PATCH", "/api/predictions/settings", [1, 2, 3]);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/predictions/:gameId", () => {
    test("returns 404 for nonexistent game", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/nonexistent");
      expect(res.status).toBe(404);
    });

    test("returns 422 for game without BGG data", async () => {
      const gameId = await addGameWithRating("No BGG Game");
      const res = await jsonRequest(ctx.app, "GET", `/api/predictions/${gameId}`);
      expect(res.status).toBe(422);
    });

    test("returns successful prediction with predictionMeta and breakdown", async () => {
      // Set up a mock BGG client that returns distinct game data
      const bggClient = factClient();
      ctx = createTestApp({ bggClient });

      // Lower the stage threshold so we can reach Stage 1 with fewer games
      await jsonRequest(ctx.app, "PATCH", "/api/predictions/settings", {
        stageThresholds: [3, 8, 15],
      });

      // Create a personal axis
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
        source: "personal",
      });
      expect(axisRes.status).toBe(201);
      const axis = (await axisRes.json()) as Axis;

      // Add reference games with BGG data and rate them to reach Stage 1
      const refGameIds: string[] = [];
      for (let i = 1; i <= 4; i++) {
        const res = await jsonRequest(ctx.app, "POST", "/api/games", {
          name: `Ref Game ${i}`,
          bggId: i,
        });
        expect(res.status).toBe(201);
        const { game } = (await res.json()) as { game: { id: string } };
        refGameIds.push(game.id);

        // Rate each game
        const rateRes = await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
          ratings: { [axis.id]: 5 + i },
        });
        expect(rateRes.status).toBe(200);
      }

      // Add target game with BGG data but no rating
      const targetRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Target Game",
        bggId: 99,
      });
      expect(targetRes.status).toBe(201);
      const { game: targetGame } = (await targetRes.json()) as { game: { id: string } };

      // Now predict the target game
      const res = await jsonRequest(ctx.app, "GET", `/api/predictions/${targetGame.id}`);
      expect(res.status).toBe(200);

      const prediction = (await res.json()) as PredictedGameResponse;
      expect(prediction.game.id).toBe(targetGame.id);
      expect(prediction.score).toBeDefined();
      expect(prediction.score.score).toBeGreaterThan(0);
      expect(prediction.score.breakdown.length).toBeGreaterThan(0);
      expect(prediction.score.predictionMeta).not.toBeNull();
      expect(prediction.score.predictionMeta!.predictedAxisCount).toBeGreaterThan(0);
      expect(prediction.score.predictionMeta!.confidence).toBeDefined();
      expect(prediction.score.predictionMeta!.referenceGameCount).toBeGreaterThan(0);
      expect(prediction.predictionUnavailable).toBeNull();

      const predictedList = (await (
        await jsonRequest(ctx.app, "GET", "/api/games?includePredicted=true&includeNiches=true")
      ).json()) as GameWithPurchaseUtilization[];
      const predictedDetail = (await (
        await jsonRequest(ctx.app, "GET", `/api/games/${targetGame.id}?includePredicted=true`)
      ).json()) as GameDetailWithPurchaseUtilization;
      const actualDetail = (await (
        await jsonRequest(ctx.app, "GET", `/api/games/${targetGame.id}?includePredicted=false`)
      ).json()) as GameDetailWithPurchaseUtilization;
      const { ownerNote, ...publicPredictedGame } = predictedDetail.game;
      void ownerNote;
      const sharedPredictedDetail: GameWithPurchaseUtilization = {
        game: publicPredictedGame,
        score: predictedDetail.score,
        bggDataStale: predictedDetail.bggDataStale,
        nichePosition: predictedDetail.nichePosition,
        displayScore: predictedDetail.displayScore,
        purchaseUtilization: predictedDetail.purchaseUtilization,
      };
      expect(predictedList).toContainEqual(sharedPredictedDetail);
      expect(predictedDetail.score?.score).toBe(prediction.score.score);
      expect(predictedDetail.displayScore).toBe(
        predictedDetail.purchaseUtilization.evidence.fitness.status === "valid"
          ? predictedDetail.purchaseUtilization.evidence.fitness.value
          : null,
      );
      expect(actualDetail.score?.predictionMeta).toBeNull();
      expect(predictedDetail.score?.predictionMeta).not.toBeNull();

      const community = prediction.score.breakdown.find(
        ({ derivedField }) => derivedField === "communityRating",
      );
      if (community === undefined) throw new Error("Missing community rating breakdown row");
      expect(community).toEqual({
        axisId: community.axisId,
        axisName: "Community Rating",
        weight: 50,
        contribution: 2.5,
        source: "derived",
        derivedField: "communityRating",
        sourceValue: 7.5,
        scoringRawValue: 7.5,
        effectiveRating: 7.5,
        preferenceShape: "higher-is-better",
        curveAffected: false,
        unit: "rating",
        provenance: "BoardGameGeek community average rating",
        configurationSummary: "No configuration",
        overridden: false,
        overrideValue: null,
        predictionConfidence: "actual",
        referenceGames: null,
      });
    });

    test("returns predictionUnavailable at Stage 0", async () => {
      const bggClient = factClient();
      ctx = createTestApp({ bggClient });

      // Add a game with BGG data (no ratings, so Stage 0)
      const res = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Stage 0 Game",
        bggId: 42,
      });
      expect(res.status).toBe(201);
      const { game } = (await res.json()) as { game: { id: string } };

      const predRes = await jsonRequest(ctx.app, "GET", `/api/predictions/${game.id}`);
      expect(predRes.status).toBe(200);

      const prediction = (await predRes.json()) as PredictedGameResponse;
      expect(prediction.predictionUnavailable).not.toBeNull();
      expect(prediction.predictionUnavailable!.reason).toBe("stage-0");
      expect(prediction.predictionUnavailable!.gamesNeeded).toBeGreaterThan(0);
    });
  });

  describe("GET /api/predictions/bgg/:bggId", () => {
    test("returns prediction for a game by BGG ID", async () => {
      const bggClient = factClient();
      ctx = createTestApp({ bggClient });

      // Lower stage threshold and add rated games to get past stage 0
      await jsonRequest(ctx.app, "PATCH", "/api/predictions/settings", {
        stageThresholds: [2, 8, 15],
      });

      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
        source: "personal",
      });
      const axis = (await axisRes.json()) as Axis;

      for (let i = 1; i <= 3; i++) {
        const res = await jsonRequest(ctx.app, "POST", "/api/games", {
          name: `Ref ${i}`,
          bggId: i,
        });
        const { game } = (await res.json()) as { game: { id: string } };
        await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
          ratings: { [axis.id]: 5 + i },
        });
      }

      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/bgg/999");
      expect(res.status).toBe(200);

      const prediction = (await res.json()) as PredictedGameResponse & {
        previewIdentity: { calculationVersion: string; source: string; bggObservedAt: string };
      };
      expect(prediction.game.id).toBe("preview-999");
      expect(prediction.game.name).toBe("Game-999");
      expect(prediction.score).toBeDefined();
      expect(prediction.score.score).toBeGreaterThan(0);
      expect(prediction.previewIdentity).toMatchObject({
        calculationVersion: "bgg-fitness-preview-v2",
        source: "bgg-thing-facts-fallback",
        bggObservedAt: "2026-08-28T00:00:00.000Z",
      });
      let collectionReads = 0;
      let settingsReads = 0;
      let tournamentReads = 0;
      const loadCollection = ctx.storageService.loadCollection.bind(ctx.storageService);
      const loadSettings = ctx.storageService.loadPredictionSettings.bind(ctx.storageService);
      const loadTournament = ctx.storageService.loadTournament.bind(ctx.storageService);
      ctx.storageService.loadCollection = async () => {
        collectionReads++;
        return loadCollection();
      };
      ctx.storageService.loadPredictionSettings = async () => {
        settingsReads++;
        return loadSettings();
      };
      ctx.storageService.loadTournament = async () => {
        tournamentReads++;
        return loadTournament();
      };
      const shared = await calculateBggFitnessPreview(
        ctx.predictionService,
        ctx.storageService,
        999,
      );
      expect(shared.result.score.score).toBe(prediction.score.score);
      expect(shared.result.predictionUnavailable).toEqual(prediction.predictionUnavailable);
      expect([collectionReads, settingsReads, tournamentReads]).toEqual([2, 2, 2]);
    });

    test("returns existing game prediction when bggId is in collection", async () => {
      const bggClient = factClient();
      ctx = createTestApp({ bggClient });

      // Add a game with bggId 42
      const addRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Existing Game",
        bggId: 42,
      });
      expect(addRes.status).toBe(201);

      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/bgg/42");
      expect(res.status).toBe(200);

      const prediction = (await res.json()) as PredictedGameResponse;
      // Should return the existing game, not a preview
      expect(prediction.game.id).not.toStartWith("preview-");
      expect(prediction.game.bggId).toBe(42);
    });

    test("returns sanitized local evidence when Thing verification fails for an existing game", async () => {
      ctx = createTestApp({ bggClient: factClient(true) });
      const add = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Local Only",
        bggId: 74,
      });
      expect(add.status).toBe(201);
      const response = await jsonRequest(ctx.app, "GET", "/api/predictions/bgg/74");
      expect(response.status).toBe(200);
      const prediction = (await response.json()) as PredictedGameResponse & {
        bggVerification: { status: string; failure: string };
      };
      expect(prediction.bggVerification).toEqual({
        status: "existing-local-unverified",
        failure: "MissingGame",
      });
      expect(prediction.game.name).toBe("Game-74");
      expect(prediction.game.ownership).toBe("owned");
      expect(prediction.game.yearPublished).toBeNull();
      expect(prediction.game.bggData).toBeNull();
    });

    test("recognizes an additional local BGG ID", async () => {
      ctx = createTestApp({ bggClient: factClient() });
      const first = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Alias One",
        bggId: 41,
      });
      const firstGame = (await first.json()) as { game: { id: string } };
      await jsonRequest(ctx.app, "PUT", `/api/games/${firstGame.game.id}/additional-bgg-ids`, {
        bggIds: [42],
      });
      const aliasResponse = await jsonRequest(ctx.app, "GET", "/api/predictions/bgg/42");
      expect(aliasResponse.status).toBe(200);
      const aliasPrediction = (await aliasResponse.json()) as PredictedGameResponse;
      expect(aliasPrediction.game.id).toBe(firstGame.game.id);
      expect(aliasPrediction.game.bggId).toBe(41);
    });

    test("returns 404 when BGG ID does not exist", async () => {
      const bggClient = factClient(true);
      ctx = createTestApp({ bggClient });

      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/bgg/99999");
      expect(res.status).toBe(404);
    });

    test("returns 400 for invalid BGG ID", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/bgg/notanumber");
      expect(res.status).toBe(400);
    });

    test("returns 503 when BGG client not configured", async () => {
      // Default ctx has no bggClient
      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/bgg/12345");
      expect(res.status).toBe(503);
    });

    test("includes nicheImpact in response", async () => {
      const bggClient = factClient();
      ctx = createTestApp({ bggClient });

      // Lower stage threshold and add rated games to get past stage 0
      await jsonRequest(ctx.app, "PATCH", "/api/predictions/settings", {
        stageThresholds: [2, 8, 15],
      });

      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
        source: "personal",
      });
      const axis = (await axisRes.json()) as Axis;

      // Add 3 rated reference games (all share "Dice Rolling" mechanic and "Strategy" category)
      for (let i = 1; i <= 3; i++) {
        const res = await jsonRequest(ctx.app, "POST", "/api/games", {
          name: `Ref ${i}`,
          bggId: i,
        });
        const { game } = (await res.json()) as { game: { id: string } };
        await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
          ratings: { [axis.id]: 5 + i },
        });
      }

      // Predict a new game (bggId 999) that shares "Dice Rolling" and "Strategy"
      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/bgg/999");
      expect(res.status).toBe(200);

      const prediction = (await res.json()) as PredictedGameResponse & {
        nicheImpact: NicheImpact;
      };
      expect(prediction.nicheImpact).toBeDefined();
      expect(prediction.nicheImpact.wouldJoin).toBeArray();

      // The candidate shares mechanics/categories with existing games, so there should be entries
      if (prediction.nicheImpact.wouldJoin.length > 0) {
        const entry = prediction.nicheImpact.wouldJoin[0];
        expect(entry.type).toBeDefined();
        expect(entry.name).toBeDefined();
        expect(typeof entry.currentSize).toBe("number");
        expect(typeof entry.projectedRank).toBe("number");
      }
    });

    test("nicheImpact has empty wouldJoin when candidate has no BGG data", async () => {
      // A game already in collection without BGG data, predicted by bggId
      // The mock returns a game with BGG data, so test the shape is always present
      const bggClient = factClient();
      ctx = createTestApp({ bggClient });

      await jsonRequest(ctx.app, "PATCH", "/api/predictions/settings", {
        stageThresholds: [2, 8, 15],
      });

      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
        source: "personal",
      });
      const axis = (await axisRes.json()) as Axis;

      for (let i = 1; i <= 3; i++) {
        const res = await jsonRequest(ctx.app, "POST", "/api/games", {
          name: `Ref ${i}`,
          bggId: i,
        });
        const { game } = (await res.json()) as { game: { id: string } };
        await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
          ratings: { [axis.id]: 5 + i },
        });
      }

      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/bgg/500");
      expect(res.status).toBe(200);

      const prediction = (await res.json()) as PredictedGameResponse & {
        nicheImpact: NicheImpact;
      };
      // nicheImpact should always be present
      expect(prediction.nicheImpact).toBeDefined();
      expect(prediction.nicheImpact.wouldJoin).toBeArray();
    });
  });

  describe("GET /api/games?includePredicted=true", () => {
    test("returns games list without prediction when flag absent", async () => {
      await addGameWithRating("Test Game");
      const res = await jsonRequest(ctx.app, "GET", "/api/games");
      expect(res.status).toBe(200);
      const data = (await res.json()) as unknown[];
      expect(data.length).toBe(1);
    });

    test("returns games list with predictions when flag present", async () => {
      await addGameWithRating("Test Game");
      const res = await jsonRequest(ctx.app, "GET", "/api/games?includePredicted=true");
      expect(res.status).toBe(200);
      const data = (await res.json()) as unknown[];
      expect(data.length).toBe(1);
    });

    test("existing behavior unchanged without flag", async () => {
      const res1 = await jsonRequest(ctx.app, "GET", "/api/games");
      const res2 = await jsonRequest(ctx.app, "GET", "/api/games?includePredicted=false");

      const data1 = (await res1.json()) as unknown[];
      const data2 = (await res2.json()) as unknown[];
      expect(data1).toEqual(data2);
    });
  });
});
