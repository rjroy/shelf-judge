import { resolveConfig, resolveSocketPath } from "./config.js";
import { createFileOps } from "./services/file-ops.js";
import { createStorageService } from "./services/storage-service.js";
import { createFitnessService } from "./services/fitness-service.js";
import { createAxisService } from "./services/axis-service.js";
import { createGameService } from "./services/game-service.js";
import { createBggClient } from "./services/bgg-client.js";
import { createApp } from "./app.js";

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
    config: { bggAuthToken: appConfig.bggAuthToken },
  });

  const axisService = createAxisService({ storageService });
  const gameService = createGameService({
    storageService,
    fitnessService,
    bggClient,
  });

  const { app } = createApp({
    storageService,
    axisService,
    gameService,
    bggClient,
  });

  const socketPath = resolveSocketPath(appConfig, envConfig);

  const server = Bun.serve({
    fetch: app.fetch,
    unix: socketPath,
    idleTimeout: 0 as never,
  });

  console.log(`shelf-judge daemon listening on ${socketPath}`);
  console.log(`BGG integration: ${bggClient.isConfigured() ? "configured" : "not configured (set bgg-token to enable)"}`);

  process.on("SIGINT", () => {
    console.log("Shutting down...");
    server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("Shutting down...");
    server.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Failed to start daemon:", err);
  process.exit(1);
});
