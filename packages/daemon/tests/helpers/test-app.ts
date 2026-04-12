import { createMockFileOps } from "./mock-file-ops.js";
import { createStorageService, type StorageService } from "../../src/services/storage-service.js";
import { createFitnessService, type FitnessService } from "../../src/services/fitness-service.js";
import { createAxisService, type AxisService } from "../../src/services/axis-service.js";
import { createGameService, type GameService } from "../../src/services/game-service.js";
import {
  createTournamentService,
  type TournamentService,
} from "../../src/services/tournament-service.js";
import { createProfileService, type ProfileService } from "../../src/services/profile-service.js";
import {
  createPredictionService,
  type PredictionService,
} from "../../src/services/prediction-service.js";
import type { BggClient } from "../../src/services/bgg-client.js";
import type { NarrationService } from "../../src/services/narration-service.js";
import { createApp, type AppResult } from "../../src/app.js";

export interface TestAppContext {
  app: AppResult["app"];
  operations: AppResult["operations"];
  storageService: StorageService;
  fitnessService: FitnessService;
  axisService: AxisService;
  gameService: GameService;
  tournamentService: TournamentService;
  profileService: ProfileService;
  predictionService: PredictionService;
  bggClient: BggClient | undefined;
  fileOps: ReturnType<typeof createMockFileOps>;
}

export interface TestAppOptions {
  bggClient?: BggClient;
  narrationService?: NarrationService;
}

export function createTestApp(options?: TestAppOptions): TestAppContext {
  const fileOps = createMockFileOps();
  const dataDir = "/test/data";
  const configPath = "/test/config.json";

  const storageService = createStorageService({ dataDir, configPath, fileOps });
  const fitnessService = createFitnessService();
  const bggClient = options?.bggClient;
  const narrationService = options?.narrationService;

  const axisService = createAxisService({ storageService });
  const tournamentService = createTournamentService({ storageService });
  const gameService = createGameService({
    storageService,
    fitnessService,
    bggClient,
    onGameDeleted: (gameId) => tournamentService.onGameDeleted(gameId),
  });

  const profileService = createProfileService({
    storageService,
    gameService,
    tournamentService,
    narrationService,
  });

  const predictionService = createPredictionService({
    storageService,
    fitnessService,
    tournamentService,
    bggClient,
  });

  const { app, operations } = createApp({
    storageService,
    axisService,
    gameService,
    tournamentService,
    profileService,
    predictionService,
    narrationService,
    bggClient,
  });

  return {
    app,
    operations,
    storageService,
    fitnessService,
    axisService,
    gameService,
    tournamentService,
    profileService,
    predictionService,
    bggClient,
    fileOps,
  };
}

export function createMockBggClient(overrides?: Partial<BggClient>): BggClient {
  return {
    isConfigured: () => true,
    searchGames: () => Promise.resolve([]),
    getGame: () => Promise.reject(new Error("Not implemented in mock")),
    getGames: async (_ids, onBatch) => {
      await onBatch?.({ batchIds: _ids, results: new Map() });
      return new Map();
    },
    getUserCollection: () => Promise.resolve([]),
    ...overrides,
  };
}

export async function jsonRequest(
  app: TestAppContext["app"],
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return app.request(new Request(`http://localhost${path}`, init));
}
