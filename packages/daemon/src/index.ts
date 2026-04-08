import { resolveConfig, resolveSocketPath } from "./config.js";
import { createFileOps } from "./services/file-ops.js";
import { createStorageService } from "./services/storage-service.js";
import { createFitnessService } from "./services/fitness-service.js";
import { createAxisService } from "./services/axis-service.js";
import { createGameService } from "./services/game-service.js";
import { createBggClient } from "./services/bgg-client.js";
import { createTournamentService } from "./services/tournament-service.js";
import { createApp } from "./app.js";
import { createLogger } from "./services/logger.js";

const logger = createLogger("daemon");

async function main() {
  const envConfig = resolveConfig();
  const fileOps = createFileOps();

  const storageService = createStorageService({
    dataDir: envConfig.dataDir,
    configPath: envConfig.configPath,
    fileOps,
  });

  const appConfig = await storageService.loadConfig();
  const fitnessService = createFitnessService();

  const bggClient = createBggClient({
    config: { bggAuthToken: appConfig.bggAuthToken, username: appConfig.username },
  });

  const axisService = createAxisService({ storageService });
  const tournamentService = createTournamentService({ storageService });
  const gameService = createGameService({
    storageService,
    fitnessService,
    bggClient,
    onGameDeleted: (gameId) => tournamentService.onGameDeleted(gameId),
  });

  const socketPath = resolveSocketPath(appConfig, envConfig);

  // Forward-declared so the shutdown route can reference the server.
  // Using a wrapper object so the reference can be updated after Bun.serve()
  // while keeping the variable const.
  const serverRef: { current: ReturnType<typeof Bun.serve> | null } = { current: null };

  const { app } = createApp({
    storageService,
    axisService,
    gameService,
    tournamentService,
    bggClient,
    onShutdown() {
      logger.log("Shutting down via API...");
      void serverRef.current?.stop();
      process.exit(0);
    },
  });

  serverRef.current = Bun.serve({
    fetch: app.fetch,
    unix: socketPath,
    idleTimeout: 0 as never,
  });

  logger.log(`shelf-judge daemon listening on ${socketPath}`);
  logger.log(
    `BGG integration: ${bggClient.isConfigured() ? "configured" : "not configured (set bgg-token to enable)"}`,
  );

  function shutdown() {
    logger.log("Shutting down...");
    void serverRef.current?.stop();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("Failed to start daemon:", err);
  process.exit(1);
});
