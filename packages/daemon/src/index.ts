import { resolveConfig } from "./config.js";
import { createFileOps } from "./services/file-ops.js";
import { createStorageService } from "./services/storage-service.js";
import { createFitnessService } from "./services/fitness-service.js";
import { createAxisService } from "./services/axis-service.js";
import { createGameService } from "./services/game-service.js";
import { createBggClient } from "./services/bgg-client.js";
import { createTournamentService } from "./services/tournament-service.js";
import { createProfileService } from "./services/profile-service.js";
import { createPredictionService } from "./services/prediction-service.js";
import { createNarrationService } from "./services/narration-service.js";
import { createApp } from "./app.js";
import { createLogger } from "./services/logger.js";
import { createCollectionMutationService } from "./services/collection-mutation-service.js";
import { createDisplayedFitnessService } from "./services/displayed-fitness-service.js";

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

  // Run versioned collection migration and artifact invalidation before routes can fire.
  // The first request therefore sees only a validated current collection and clean caches.
  await storageService.loadCollection();
  const collectionMutationService = createCollectionMutationService({ storageService });

  const fitnessService = createFitnessService();

  const bggClient = createBggClient({
    config: { bggAuthToken: appConfig.bggAuthToken, username: appConfig.username },
  });

  const axisService = createAxisService({ storageService, collectionMutationService });
  const tournamentService = createTournamentService({ storageService });
  const gameService = createGameService({
    storageService,
    collectionMutationService,
    fitnessService,
    bggClient,
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

  const narrationService = createNarrationService();
  const profileService = createProfileService({
    storageService,
    displayedFitnessService,
    tournamentService,
    narrationService,
  });

  // Forward-declared so the shutdown route can reference the server.
  // Using a wrapper object so the reference can be updated after Bun.serve()
  // while keeping the variable const.
  const serverRef: { current: ReturnType<typeof Bun.serve> | null } = { current: null };

  const { app } = createApp({
    storageService,
    collectionMutationService,
    axisService,
    gameService,
    tournamentService,
    profileService,
    predictionService,
    displayedFitnessService,
    bggClient,
    onShutdown() {
      logger.log("Shutting down via API...");
      void serverRef.current?.stop();
      process.exit(0);
    },
  });

  serverRef.current = Bun.serve({
    fetch: app.fetch,
    unix: envConfig.socketPath,
    idleTimeout: 0 as never,
  });

  logger.log(`shelf-judge daemon listening on ${envConfig.socketPath}`);
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
