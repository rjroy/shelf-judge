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
import { createCollectionArtifactContext } from "./services/collection-artifacts.js";
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
import { createPurchaseUtilizationService } from "./services/purchase-utilization-service.js";
import { createCollectionSnapshotService } from "./services/collection-snapshot-service.js";
import { createCollectionSnapshotCacheService } from "./services/collection-snapshot-cache-service.js";
import { createSemanticRedundancyStateService } from "./services/semantic-redundancy-state-service.js";
import { openJevPairCacheLifecycle } from "./services/jev-pair-cache-lifecycle.js";
import { purgeRevokedOwnerNoteCache } from "./services/jev-owner-note-revocation.js";
import { createJevProductionSemanticRead } from "./services/jev-production-read.js";
import { createJevGateway } from "./services/jev/jev-gateway.js";
import type { JevGatewayOptions } from "./services/jev/jev-gateway.js";
import { JevRunService } from "./services/jev-run-service.js";
import { createJevRunSourceAdapter } from "./services/jev-run-source-adapter.js";
import { createJevStatusService } from "./services/jev-status-service.js";
import type { JevPairCache } from "./services/jev-pair-cache-service.js";
import type { StorageService } from "./services/storage-service.js";
import type { PredictionService } from "./services/prediction-service.js";

const logger = createLogger("daemon");

/** Creates an explicit-run worker only around the lifecycle-owned usable cache. */
export function createJevRunWorker(options: {
  storageService: StorageService;
  predictionService: PredictionService;
  cache: JevPairCache | null;
  /** Test transport seam only; production uses global fetch and the gateway's configured environment key. */
  fetch?: JevGatewayOptions["fetch"];
  gatewayLogger?: Pick<typeof logger, "log" | "warn" | "error">;
}): JevRunService | null {
  const { storageService, predictionService, cache } = options;
  if (!cache?.available) return null;
  if (!predictionService.listGamesWithPredictionsFromSnapshot)
    throw new Error("Complete snapshot prediction is unavailable");
  const snapshotPrediction =
    predictionService.listGamesWithPredictionsFromSnapshot.bind(predictionService);
  const sourceAdapter = createJevRunSourceAdapter({
    storageService,
    predictionService: {
      listGamesWithPredictionsFromSnapshot: (collection, tournament, settings, targetGameIds) =>
        snapshotPrediction(collection, tournament, settings, targetGameIds),
    },
  });
  return new JevRunService({
    storageService,
    cache,
    ...sourceAdapter,
    // This factory runs once per explicit startRun, so the gateway's request and
    // reported-token budgets are fresh for each separately authorized execution.
    createGateway: (admitAndDispatch) =>
      createJevGateway({
        admitAndDispatch,
        ...(options.fetch ? { fetch: options.fetch } : {}),
        logger: options.gatewayLogger ?? createLogger("jev-gateway"),
      }),
  });
}

/** Startup reconciliation is cache-only and deliberately never starts or constructs a gateway. */
export async function recoverJevRunOnStartup(
  service: Pick<JevRunService, "reconcileInterruptedProgress"> | null,
  startupLogger: Pick<typeof logger, "log" | "error"> = logger,
): Promise<void> {
  startupLogger.log("Jev run recovery started", { trigger: "startup" });
  if (!service) {
    startupLogger.log("Jev run recovery skipped", {
      trigger: "startup",
      outcome: "no-usable-cache-worker",
    });
    return;
  }
  try {
    const progress = await service.reconcileInterruptedProgress();
    startupLogger.log("Jev run recovery completed", {
      trigger: "startup",
      state: progress?.state ?? "none",
      outcome: "reconciled",
    });
  } catch (error) {
    startupLogger.error("Jev run recovery failed", {
      trigger: "startup",
      outcome: "failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

/** Composes only the read-only status dependency; cache absence remains reportable. */
export function composeJevStatusService(options: {
  storageService: StorageService;
  predictionService: PredictionService;
  cache: JevPairCache | null;
}): ReturnType<typeof createJevStatusService> | null {
  if (!options.predictionService.listGamesWithPredictionsFromSnapshot) return null;
  const sourceAdapter = createJevRunSourceAdapter({
    storageService: options.storageService,
    predictionService: {
      listGamesWithPredictionsFromSnapshot: (collection, tournament, settings, targetGameIds) =>
        options.predictionService.listGamesWithPredictionsFromSnapshot!(
          collection,
          tournament,
          settings,
          targetGameIds,
        ),
    },
  });
  return createJevStatusService({
    storageService: options.storageService,
    sourceAdapter,
    cache: options.cache,
  });
}

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
  const jevPairCacheLifecycle = await openJevPairCacheLifecycle(envConfig.dataDir, logger);
  // Mutations/revocation and the read adapter share the lifecycle-owned cache instance.
  const jevPairCache = jevPairCacheLifecycle.cache;
  try {
    const collection = await storageService.loadCollection();
    if (!collection.semanticRedundancy.settings.cachedOwnerNoteUse) {
      purgeRevokedOwnerNoteCache(jevPairCache, logger, { trigger: "daemon-startup" });
    }
  } catch (error) {
    // The durable permission=false fence remains authoritative; each startup retries cleanup.
    logger.error("JEV owner-note revocation recovery failed", {
      reason: error instanceof Error ? error.message : String(error),
      outcome: "cleanup-pending",
    });
  }
  try {
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
      jevPairCache,
      semanticDisplayArtifactContext: createCollectionArtifactContext(
        envConfig.dataDir,
        fileOps,
        logger,
      ),
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
    const resolveSemanticRead = createJevProductionSemanticRead(jevPairCache);
    displayedFitnessService = createDisplayedFitnessService({
      gameService,
      predictionService,
      storageService,
      resolveSemanticRead,
    });
    const purchaseUtilizationService = createPurchaseUtilizationService({
      storageService,
      collectionMutationService,
    });
    const collectionSnapshotBuilder = createCollectionSnapshotService({
      storageService,
      gameService,
      predictionService,
      purchaseUtilizationService,
      resolveSemanticRead,
    });
    const collectionSnapshotService = createCollectionSnapshotCacheService({
      builder: collectionSnapshotBuilder,
      storageService,
      coordinator: profileSourceCoordinatorFor(storageService),
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
    logger.log("source vector hydration started", { trigger: "startup" });
    try {
      const vector = await storageService.hydrateSourceVector?.();
      logger.log("source vector hydration completed", {
        trigger: "startup",
        available: vector?.available ?? false,
        changeToken: vector?.changeToken ?? null,
      });
    } catch (error) {
      logger.error("source vector hydration failed", {
        trigger: "startup",
        error: toErrorMessage(error),
      });
    }
    let jevRunWorker: JevRunService | null = null;
    try {
      jevRunWorker = createJevRunWorker({
        storageService,
        predictionService,
        cache: jevPairCache,
      });
    } catch (error) {
      // Jev is derived and optional; a missing source adapter must not block
      // factual daemon reads. No gateway is created until an explicit Run.
      logger.error("Jev run worker composition failed", {
        trigger: "startup",
        outcome: "unavailable",
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    await recoverJevRunOnStartup(jevRunWorker, logger);
    // Kept intentionally inactive until an approved explicit Run route is wired.
    void jevRunWorker;
    await recoverAttentionCandidatesOnStartup(attentionCandidateRecovery, logger);

    const profileService = createProfileService({
      storageService,
      displayedFitnessService,
      attentionCandidates,
    });

    const semanticStateService = createSemanticRedundancyStateService({
      collectionMutationService,
    });

    // Forward-declared so the shutdown route can reference the server.
    // Using a wrapper object so the reference can be updated after Bun.serve()
    // while keeping the variable const.
    const serverRef: { current: ReturnType<typeof Bun.serve> | null } = { current: null };
    let jevStatusService: ReturnType<typeof createJevStatusService> | null = null;
    try {
      jevStatusService = composeJevStatusService({
        storageService,
        predictionService,
        cache: jevPairCache,
      });
    } catch (error) {
      logger.error("Jev status service composition failed", {
        trigger: "startup",
        outcome: "unavailable",
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }

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
      collectionSnapshotService,
      semanticRedundancyStateService: semanticStateService,
      jevStatusService: jevStatusService ?? undefined,
      ownerGameNoteService,
      groundedAnalysisProvider,
      reflectionRuntime,
      bggClient,
      profileSourceCoordinator: profileSourceCoordinatorFor(storageService),
      afterCandidateSourceSave: maintainCandidateSource,
      onShutdown() {
        logger.log("Shutting down via API...");
        void serverRef.current?.stop();
        jevPairCacheLifecycle.close();
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
      jevPairCacheLifecycle.close();
      process.exit(0);
    }

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    jevPairCacheLifecycle.close();
    throw error;
  }
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error("Failed to start daemon:", err);
    process.exit(1);
  });
}
