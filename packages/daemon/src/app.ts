import { Hono } from "hono";
import { resolveConfig } from "./config.js";
import { createFileOps } from "./services/file-ops.js";
import { createStorageService, type StorageService } from "./services/storage-service.js";
import { createFitnessService, type FitnessService } from "./services/fitness-service.js";
import { createAxisService, type AxisService } from "./services/axis-service.js";
import { createGameService, type GameService } from "./services/game-service.js";
import { createBggClient, type BggClient } from "./services/bgg-client.js";
import { createGameRoutes } from "./routes/games.js";
import { createAxisRoutes } from "./routes/axes.js";
import { createScoreRoutes } from "./routes/scores.js";
import { createImportRoutes } from "./routes/import.js";
import { createHelpRoutes } from "./routes/help.js";
import { createConfigRoutes } from "./routes/config.js";
import type { OperationDefinition } from "./operations.js";

export interface AppDeps {
  storageService?: StorageService;
  fitnessService?: FitnessService;
  axisService?: AxisService;
  gameService?: GameService;
  bggClient?: BggClient;
  dataDir?: string;
  configPath?: string;
}

export interface AppResult {
  app: Hono;
  operations: OperationDefinition[];
}

export function createApp(deps?: AppDeps): AppResult {
  // Resolve real deps from env/config only when not injected
  const config = (!deps?.storageService || !deps?.gameService)
    ? resolveConfig()
    : undefined;

  const storageService = deps?.storageService ?? createStorageService({
    dataDir: deps?.dataDir ?? config!.dataDir,
    configPath: deps?.configPath ?? config!.configPath,
    fileOps: createFileOps(),
  });

  const fitnessService = deps?.fitnessService ?? createFitnessService();

  const bggClient = deps?.bggClient;

  const axisService = deps?.axisService ?? createAxisService({ storageService });

  const gameService = deps?.gameService ?? createGameService({
    storageService,
    fitnessService,
    bggClient,
  });

  // Build routes
  const gameRouteModule = createGameRoutes({ gameService, bggClient });
  const axisRouteModule = createAxisRoutes({ axisService });
  const scoreRouteModule = createScoreRoutes({ gameService });
  const importRouteModule = createImportRoutes({ gameService, bggClient });

  // Collect all operations
  const allOperations: OperationDefinition[] = [
    ...gameRouteModule.operations,
    ...axisRouteModule.operations,
    ...scoreRouteModule.operations,
    ...importRouteModule.operations,
  ];

  const helpRouteModule = createHelpRoutes({ operations: allOperations });
  const configRouteModule = createConfigRoutes({ storageService });

  allOperations.push(...helpRouteModule.operations, ...configRouteModule.operations);

  // Wire Hono app
  const app = new Hono();
  app.route("/api", gameRouteModule.routes);
  app.route("/api", axisRouteModule.routes);
  app.route("/api", scoreRouteModule.routes);
  app.route("/api", importRouteModule.routes);
  app.route("/api", helpRouteModule.routes);
  app.route("/api", configRouteModule.routes);

  return { app, operations: allOperations };
}
