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
import { createApp } from "./app.js";
import { createLogger } from "./services/logger.js";
import { createCollectionMutationService } from "./services/collection-mutation-service.js";
import { createDisplayedFitnessService } from "./services/displayed-fitness-service.js";
import { createIntentionService } from "./services/intention-service.js";
import { createOwnerGameNoteService } from "./services/owner-game-note-service.js";
import { loadStartupGroundedAnalysis } from "./services/grounded-analysis/startup-provider.js";
import { toErrorMessage } from "@shelf-judge/shared";
import { createReflectionRuntime } from "./services/reflection-runtime.js";
import {
  createAttentionCandidateOracle,
  createAttentionCandidateService,
  createAttentionCandidateProductionSourceLoader,
  productionAttentionCandidateDependenciesForGame,
  attentionCandidateStorageFor,
  type AttentionCandidateService,
} from "./services/attention-candidate-service.js";
import { profileSourceCoordinatorFor } from "./services/profile-source-coordinator.js";
import {
  createAttentionCandidateMaintenanceRecovery,
  createAttentionDispositionGlobalMaintenance,
  type AttentionCandidateMaintenanceRecovery,
} from "./services/attention-disposition-maintenance.js";
import { createAttentionDispositionService } from "./services/attention-disposition-service.js";
import type { DisplayedFitnessService } from "./services/displayed-fitness-service.js";

const logger = createLogger("daemon");

export async function recoverAttentionCandidatesOnStartup(
  attentionCandidates: AttentionCandidateMaintenanceRecovery,
  startupLogger: Pick<typeof logger, "log" | "error"> = logger,
): Promise<void> {
  startupLogger.log("attention candidate recovery started", { trigger: "startup" });
  try {
    await attentionCandidates.recover();
    startupLogger.log("attention candidate recovery completed", { trigger: "startup" });
  } catch (error) {
    // Candidate artifacts are disposable. A bad artifact or transient scorer must
    // not prevent unrelated daemon operations from coming up.
    startupLogger.error("attention candidate recovery failed", {
      trigger: "startup",
      error: toErrorMessage(error),
    });
  }
}

export async function main() {
  const envConfig = resolveConfig();
  const fileOps = createFileOps();

  const storageService = createStorageService({
    dataDir: envConfig.dataDir,
    configPath: envConfig.configPath,
    fileOps,
  });

  const { appConfig, provider: groundedAnalysisProvider } = await loadStartupGroundedAnalysis({
    storageService,
    cwd: process.cwd(),
  });

  // Run versioned collection migration and artifact invalidation before routes can fire.
  // The first request therefore sees only a validated current collection and clean caches.
  await storageService.loadCollection();
  let displayedFitnessService: DisplayedFitnessService | null = null;
  const dispositionOracle = createAttentionCandidateOracle(() => {
    if (displayedFitnessService === null)
      throw new Error("Displayed fitness is unavailable during attention initialization");
    return displayedFitnessService;
  });
  const dispositionSource = createAttentionCandidateProductionSourceLoader(storageService);
  const dispositionWinners = async (
    _prior: import("@shelf-judge/shared").Collection,
    collection: import("@shelf-judge/shared").Collection,
    _context: import("./services/collection-mutation-service.js").CollectionMutationContext,
    gameIds: readonly string[],
  ) => {
    const source = await dispositionSource();
    return dispositionOracle.evaluateStoredRules(
      { ...source, collection: { ...collection, attentionDispositions: [] } },
      new Date().toISOString(),
      collection.attentionDispositions
        .filter((disposition) => gameIds.includes(disposition.gameId))
        .map((disposition) => ({ gameId: disposition.gameId, ruleId: disposition.ruleId })),
    );
  };
  let attentionCandidates: AttentionCandidateService | null = null;
  let dispositionMaintenance: ReturnType<
    typeof createAttentionDispositionGlobalMaintenance
  > | null = null;
  const collectionMutationService = createCollectionMutationService({
    storageService,
    dispositionWinners,
    async postCommitObserver(event) {
      // Disposition commands report their own post-commit availability to the
      // caller, so their maintenance must not be repeated by this observer.
      if (
        attentionCandidates === null ||
        event.impact === null ||
        event.context.trigger.startsWith("attention:")
      )
        return;
      await attentionCandidates.maintainAfterCollectionCommit(event.impact);
    },
  });
  const reflectionRuntime = createReflectionRuntime({
    dataDir: envConfig.dataDir,
    fileOps,
    storageService,
    providerIdentity:
      groundedAnalysisProvider.configurationStatus.status === "configured"
        ? groundedAnalysisProvider.configurationStatus.identity
        : null,
  });
  logger.log("reflection recovery started", { trigger: "startup" });
  try {
    await reflectionRuntime.recover();
    logger.log("reflection recovery completed", { trigger: "startup" });
  } catch (error) {
    logger.error("reflection recovery failed", {
      trigger: "startup",
      error: toErrorMessage(error),
    });
    throw error;
  }

  const fitnessService = createFitnessService();

  const bggClient = createBggClient({
    config: { bggAuthToken: appConfig.bggAuthToken, username: appConfig.username },
  });

  const axisService = createAxisService({ storageService, collectionMutationService });
  attentionCandidates = createAttentionCandidateService({
    coordinator: profileSourceCoordinatorFor(storageService),
    storage: attentionCandidateStorageFor(storageService),
    productionStorage: storageService,
    clock: { now: () => new Date() },
    oracle: dispositionOracle,
    dependenciesForGame: productionAttentionCandidateDependenciesForGame,
    recoveryRequired: () => dispositionMaintenance?.recoveryRequired() ?? false,
  });
  const maintainCandidateSource = (dispositionMaintenance =
    createAttentionDispositionGlobalMaintenance({
      collectionMutations: collectionMutationService,
      storedRuleMatches: async (dispositions) => {
        const source = await dispositionSource();
        return dispositionOracle.evaluateStoredRules(
          { ...source, collection: { ...source.collection, attentionDispositions: [] } },
          new Date().toISOString(),
          dispositions.map((disposition) => ({
            gameId: disposition.gameId,
            ruleId: disposition.ruleId,
          })),
        );
      },
      maintainCandidates: async (impact) => {
        await attentionCandidates?.maintain(impact);
      },
      invalidateCandidates: async () => {
        await attentionCandidates?.invalidate();
      },
    }));
  const attentionCandidateRecovery = createAttentionCandidateMaintenanceRecovery({
    recoverCompatibility: () => maintainCandidateSource.recover(),
    ensureFresh: () => {
      if (attentionCandidates === null) throw new Error("Attention candidates are unavailable");
      return attentionCandidates.ensureFresh();
    },
  });
  const attentionDispositionService = createAttentionDispositionService({
    collectionMutations: collectionMutationService,
    clock: { now: () => new Date() },
    currentSelection: async (collection, gameId) => {
      const source = await dispositionSource();
      const evaluation = await dispositionOracle.evaluate(
        { ...source, collection },
        new Date().toISOString(),
        [gameId],
      );
      const winner = evaluation.evaluations.find(
        (candidate) => candidate.gameId === gameId,
      )?.winner;
      return winner === null || winner === undefined
        ? null
        : {
            gameId,
            ruleId: winner.ruleId,
            ruleVersion: winner.ruleVersion,
            fingerprint: winner.fingerprint,
          };
    },
    maintenance: {
      async maintainAfterCollectionCommit(impact) {
        if (attentionCandidates === null) return { state: "unavailable" };
        return attentionCandidates.maintainAfterCollectionCommit(impact);
      },
    },
  });
  const tournamentService = createTournamentService({
    storageService,
    afterSourceSave: maintainCandidateSource,
  });
  const gameService = createGameService({
    storageService,
    collectionMutationService,
    fitnessService,
    bggClient,
    onGameDeleted: (gameId) => tournamentService.onGameDeleted(gameId),
    deletionLifecycle: reflectionRuntime.gameDeletionLifecycle,
  });
  const intentionService = createIntentionService({ collectionMutationService });
  const ownerGameNoteService = createOwnerGameNoteService({
    collectionMutationService,
    invalidationLifecycle: reflectionRuntime.noteInvalidationLifecycle,
  });

  const predictionService = createPredictionService({
    storageService,
    fitnessService,
    tournamentService,
    bggClient,
    afterSourceSave: maintainCandidateSource,
  });
  displayedFitnessService = createDisplayedFitnessService({
    gameService,
    predictionService,
    storageService,
  });
  let tournamentReconciliationChanged = false;
  logger.log("tournament reconciliation started", { trigger: "startup" });
  try {
    const result = await tournamentService.reconcileWithCollection();
    tournamentReconciliationChanged = result.changed;
    logger.log("tournament reconciliation completed", { trigger: "startup", ...result });
  } catch (error) {
    logger.error("tournament reconciliation failed", {
      trigger: "startup",
      error: toErrorMessage(error),
    });
    throw error;
  }
  if (!tournamentReconciliationChanged)
    await maintainCandidateSource({ kind: "global", reason: "tournament" });
  await recoverAttentionCandidatesOnStartup(attentionCandidateRecovery, logger);

  const profileService = createProfileService({
    storageService,
    displayedFitnessService,
    attentionCandidates,
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
    intentionService,
    attentionDispositionService,
    ownerGameNoteService,
    groundedAnalysisProvider,
    reflectionRuntime,
    bggClient,
    profileSourceCoordinator: profileSourceCoordinatorFor(storageService),
    afterCandidateSourceSave: maintainCandidateSource,
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
  logger.log(
    `Grounded analysis: ${groundedAnalysisProvider.configurationStatus.status === "configured" ? "configured" : "not configured"}`,
  );

  function shutdown() {
    logger.log("Shutting down...");
    void serverRef.current?.stop();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error("Failed to start daemon:", err);
    process.exit(1);
  });
}
