import { createMockFileOps } from "./mock-file-ops.js";
import { createStorageService, type StorageService } from "../../src/services/storage-service.js";
import { createFitnessService, type FitnessService } from "../../src/services/fitness-service.js";
import { createAxisService, type AxisService } from "../../src/services/axis-service.js";
import { createGameService, type GameService } from "../../src/services/game-service.js";
import type { BggClient } from "../../src/services/bgg-client.js";
import { createApp, type AppResult } from "../../src/app.js";

export interface TestAppContext {
  app: AppResult["app"];
  operations: AppResult["operations"];
  storageService: StorageService;
  fitnessService: FitnessService;
  axisService: AxisService;
  gameService: GameService;
  bggClient: BggClient | undefined;
  fileOps: ReturnType<typeof createMockFileOps>;
}

export interface TestAppOptions {
  bggClient?: BggClient;
}

export function createTestApp(options?: TestAppOptions): TestAppContext {
  const fileOps = createMockFileOps();
  const dataDir = "/test/data";
  const configPath = "/test/config.json";

  const storageService = createStorageService({ dataDir, configPath, fileOps });
  const fitnessService = createFitnessService();
  const bggClient = options?.bggClient;

  const axisService = createAxisService({ storageService });
  const gameService = createGameService({
    storageService,
    fitnessService,
    bggClient,
  });

  const { app, operations } = createApp({
    storageService,
    axisService,
    gameService,
    bggClient,
  });

  return {
    app,
    operations,
    storageService,
    fitnessService,
    axisService,
    gameService,
    bggClient,
    fileOps,
  };
}

export function createMockBggClient(overrides?: Partial<BggClient>): BggClient {
  return {
    isConfigured: () => true,
    searchGames: async () => [],
    getGame: async () => {
      throw new Error("Not implemented in mock");
    },
    getGames: async () => new Map(),
    getUserCollection: async () => [],
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
