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
import {
  createPurchaseUtilizationService,
  type PurchaseUtilizationService,
} from "../../src/services/purchase-utilization-service.js";
import { createApp, type AppResult } from "../../src/app.js";
import {
  createCollectionMutationService,
  type CollectionMutationService,
} from "../../src/services/collection-mutation-service.js";
import {
  createDisplayedFitnessService,
  type DisplayedFitnessService,
} from "../../src/services/displayed-fitness-service.js";
import {
  createIntentionService,
  type IntentionService,
} from "../../src/services/intention-service.js";

export interface TestAppContext {
  app: AppResult["app"];
  operations: AppResult["operations"];
  storageService: StorageService;
  collectionMutationService: CollectionMutationService;
  fitnessService: FitnessService;
  axisService: AxisService;
  gameService: GameService;
  tournamentService: TournamentService;
  profileService: ProfileService;
  predictionService: PredictionService;
  displayedFitnessService: DisplayedFitnessService;
  intentionService: IntentionService;
  bggClient: BggClient | undefined;
  fileOps: ReturnType<typeof createMockFileOps>;
}

export interface TestAppOptions {
  bggClient?: BggClient;
  narrationService?: NarrationService;
  fileOps?: ReturnType<typeof createMockFileOps>;
  now?: () => string;
  intentionService?: IntentionService;
}

export function createTestPurchaseUtilizationService(
  storageService?: StorageService,
): PurchaseUtilizationService {
  const fallbackStorage = {
    loadCollection: () =>
      Promise.resolve({
        schemaVersion: 4 as const,
        revision: 0,
        id: "test-collection",
        name: "Test Collection",
        axes: [],
        games: [],
        intentions: [],
        commandReceipts: [],
        entertainmentBenchmark: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    saveCollection: () => Promise.resolve(),
  } as unknown as StorageService;
  const selectedStorage = storageService ?? fallbackStorage;
  const collectionMutationService = createCollectionMutationService({
    storageService: selectedStorage,
  });
  return createPurchaseUtilizationService({
    storageService: selectedStorage,
    collectionMutationService,
  });
}

export function createTestApp(options?: TestAppOptions): TestAppContext {
  const fileOps = options?.fileOps ?? createMockFileOps();
  const dataDir = "/test/data";
  const configPath = "/test/config.json";

  const storageService = createStorageService({
    dataDir,
    configPath,
    fileOps,
  });
  const collectionMutationService = createCollectionMutationService({ storageService });
  const fitnessService = createFitnessService();
  const bggClient = options?.bggClient;
  const narrationService = options?.narrationService;

  const axisService = createAxisService({ storageService, collectionMutationService });
  const tournamentService = createTournamentService({ storageService });
  const gameService = createGameService({
    storageService,
    collectionMutationService,
    fitnessService,
    bggClient,
    now: options?.now,
    onGameDeleted: (gameId) => tournamentService.onGameDeleted(gameId),
  });

  const predictionService = createPredictionService({
    storageService,
    fitnessService,
    tournamentService,
    bggClient,
  });
  const displayedFitnessService = createDisplayedFitnessService({
    gameService,
    predictionService,
    storageService,
  });
  const intentionService =
    options?.intentionService ??
    createIntentionService({
      collectionMutationService,
      now: options?.now,
    });
  const profileService = createProfileService({
    storageService,
    displayedFitnessService,
    tournamentService,
    narrationService,
  });

  const { app, operations } = createApp({
    storageService,
    collectionMutationService,
    axisService,
    gameService,
    tournamentService,
    profileService,
    predictionService,
    displayedFitnessService,
    intentionService,
    bggClient,
  });

  return {
    app,
    operations,
    storageService,
    collectionMutationService,
    fitnessService,
    axisService,
    gameService,
    tournamentService,
    profileService,
    predictionService,
    displayedFitnessService,
    intentionService,
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
      await onBatch?.({ batchIds: _ids, results: new Map(), failures: new Map() });
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
