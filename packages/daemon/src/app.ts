import { Hono } from "hono";
import type { StorageService } from "./services/storage-service.js";
import type { AxisService } from "./services/axis-service.js";
import type { GameService } from "./services/game-service.js";
import type { BggClient } from "./services/bgg-client.js";
import { createGameRoutes } from "./routes/games.js";
import { createAxisRoutes } from "./routes/axes.js";
import { createScoreRoutes } from "./routes/scores.js";
import { createImportRoutes } from "./routes/import.js";
import { createHelpRoutes } from "./routes/help.js";
import { createConfigRoutes } from "./routes/config.js";
import { createShutdownRoutes } from "./routes/shutdown.js";
import type { OperationDefinition } from "./operations.js";

export interface AppDeps {
  storageService: StorageService;
  axisService: AxisService;
  gameService: GameService;
  bggClient?: BggClient;
  onShutdown?: () => void;
}

export interface AppResult {
  app: Hono;
  operations: OperationDefinition[];
}

export function createApp(deps: AppDeps): AppResult {
  const { storageService, axisService, gameService, bggClient, onShutdown } = deps;

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
  const shutdownRouteModule = createShutdownRoutes({
    onShutdown: onShutdown ?? (() => process.exit(0)),
  });

  allOperations.push(
    ...helpRouteModule.operations,
    ...configRouteModule.operations,
    ...shutdownRouteModule.operations,
  );

  // Wire Hono app
  const app = new Hono();
  app.route("/api", gameRouteModule.routes);
  app.route("/api", axisRouteModule.routes);
  app.route("/api", scoreRouteModule.routes);
  app.route("/api", importRouteModule.routes);
  app.route("/api", helpRouteModule.routes);
  app.route("/api", configRouteModule.routes);
  app.route("/api", shutdownRouteModule.routes);

  return { app, operations: allOperations };
}
