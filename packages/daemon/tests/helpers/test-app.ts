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
import {
  createPurchaseUtilizationService,
  type PurchaseUtilizationService,
} from "../../src/services/purchase-utilization-service.js";
import { createCollectionSnapshotService } from "../../src/services/collection-snapshot-service.js";
import { createCollectionSnapshotCacheService } from "../../src/services/collection-snapshot-cache-service.js";
import { createJevProductionSemanticRead } from "../../src/services/jev-production-read.js";
import type { JevPairCache } from "../../src/services/jev-pair-cache-service.js";
import { createApp, type AppResult } from "../../src/app.js";
import { createInitialSemanticRedundancyStateV10 } from "@shelf-judge/shared";
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
import {
  createOwnerGameNoteService,
  type OwnerGameNoteService,
} from "../../src/services/owner-game-note-service.js";
import type { FileOps } from "../../src/services/file-ops.js";
import {
  createGroundedAnalysisProvider,
  type GroundedAnalysisProvider,
} from "../../src/services/grounded-analysis/provider.js";
import type { GroundedProviderStartupConfiguration } from "../../src/services/grounded-analysis/provider-configuration.js";
import type { GroundedAnalysisTransportController } from "../../src/services/grounded-analysis/transport-controller.js";
import {
  createReflectionRuntime,
  type ReflectionRuntime,
} from "../../src/services/reflection-runtime.js";
import {
  attentionCandidateStorageFor,
  createAttentionCandidateOracle,
  createAttentionCandidateService,
  createAttentionCandidateProductionSourceLoader,
  productionAttentionCandidateDependenciesForGame,
  type AttentionCandidateService,
} from "../../src/services/attention-candidate-service.js";
import { profileSourceCoordinatorFor } from "../../src/services/profile-source-coordinator.js";
import { createUnifiedScoringService } from "../../src/services/unified-scoring-service.js";
import type { UnifiedScoringService } from "../../src/services/unified-scoring-service.js";
import type { PreparedSimilarityObserver } from "../../src/services/prepared-similarity.js";
import {
  createAttentionCandidateMaintenanceRecovery,
  createAttentionDispositionGlobalMaintenance,
  type AttentionCandidateMaintenanceRecovery,
  type AttentionDispositionGlobalMaintenance,
} from "../../src/services/attention-disposition-maintenance.js";
import type { AttentionDispositionWinner } from "../../src/services/attention-disposition-compatibility.js";
import type { AttentionDisposition } from "@shelf-judge/shared";
import type { SemanticRedundancyStateService } from "../../src/services/semantic-redundancy-state-service.js";
import {
  createAttentionDispositionService,
  type AttentionDispositionService,
} from "../../src/services/attention-disposition-service.js";

type MockFileOps = ReturnType<typeof createMockFileOps>;

export interface TestAppContext<TFileOps extends FileOps = MockFileOps> {
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
  unifiedScoringService: UnifiedScoringService;
  intentionService: IntentionService;
  ownerGameNoteService: OwnerGameNoteService;
  attentionCandidateService: AttentionCandidateService;
  attentionCandidateMaintenanceRecovery: AttentionCandidateMaintenanceRecovery;
  attentionDispositionGlobalMaintenance: AttentionDispositionGlobalMaintenance;
  attentionDispositionService: AttentionDispositionService;
  bggClient: BggClient | undefined;
  groundedAnalysisProvider: GroundedAnalysisProvider;
  groundedAnalysisTransportController: GroundedAnalysisTransportController;
  reflectionRuntime: ReflectionRuntime;
  fileOps: TFileOps;
}

export interface TestAppOptions<TFileOps extends FileOps = MockFileOps> {
  bggClient?: BggClient;
  fileOps?: TFileOps;
  dataDir?: string;
  configPath?: string;
  now?: () => string;
  createIntentionId?: () => string;
  intentionService?: IntentionService;
  ownerGameNoteService?: OwnerGameNoteService;
  groundedAnalysisProvider?: GroundedAnalysisProvider;
  onShutdown?: () => void | Promise<void>;
  storedRuleMatches?: (
    dispositions: readonly AttentionDisposition[],
  ) => Promise<readonly AttentionDispositionWinner[]>;
  semanticRedundancyStateService?: SemanticRedundancyStateService;
  /** Opt-in production semantic read wiring for SQLite-backed integration tests. */
  jevPairCache?: JevPairCache;
  /** Test instrumentation for proving mutation branches that must skip scoring. */
  preparedObserver?: PreparedSimilarityObserver;
}

export function createTestPurchaseUtilizationService(
  storageService?: StorageService,
): PurchaseUtilizationService {
  const fallbackStorage = {
    loadCollection: () =>
      Promise.resolve({
        schemaVersion: 10 as const,
        revision: 0,
        id: "test-collection",
        name: "Test Collection",
        axes: [],
        games: [],
        intentions: [],
        attentionDispositions: [],
        commandReceipts: [],
        entertainmentBenchmark: null,
        semanticRedundancy: createInitialSemanticRedundancyStateV10(),
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

export function createTestApp<TFileOps extends FileOps = MockFileOps>(
  options?: TestAppOptions<TFileOps>,
): TestAppContext<TFileOps> {
  const fileOps = options?.fileOps ?? (createMockFileOps() as unknown as TFileOps);
  const dataDir = options?.dataDir ?? "/test/data";
  const configPath = options?.configPath ?? "/test/config.json";

  const storageService = createStorageService({
    dataDir,
    configPath,
    fileOps,
  });
  let attentionCandidateService: AttentionCandidateService | null = null;
  let attentionDispositionGlobalMaintenance: AttentionDispositionGlobalMaintenance | null = null;
  const collectionMutationService = createCollectionMutationService({
    storageService,
    ...(options?.jevPairCache ? { jevPairCache: options.jevPairCache } : {}),
    async postCommitObserver(event) {
      if (
        attentionCandidateService === null ||
        event.impact === null ||
        event.context.trigger.startsWith("attention:")
      )
        return;
      await attentionCandidateService.maintainAfterCollectionCommit(event.impact);
    },
  });
  const reflectionRuntime = createReflectionRuntime({
    dataDir,
    fileOps,
    storageService,
    now: options?.now,
    providerIdentity:
      options?.groundedAnalysisProvider?.configurationStatus.status === "configured"
        ? options.groundedAnalysisProvider.configurationStatus.identity
        : null,
  });
  const fitnessService = createFitnessService();
  const jevPairCache = options?.jevPairCache ?? null;
  const unifiedScoringService = createUnifiedScoringService({
    storageService,
    cache: jevPairCache,
    fitnessService,
    coordinator: profileSourceCoordinatorFor(storageService),
    ...(options?.preparedObserver ? { preparedObserver: options.preparedObserver } : {}),
  });
  const bggClient = options?.bggClient;

  const axisService = createAxisService({ storageService, collectionMutationService });
  const maintainCandidateSource = async (
    impact: import("../../src/services/attention-candidate-service.js").AttentionMutationImpact,
  ) => {
    if (attentionDispositionGlobalMaintenance === null)
      throw new Error("Attention disposition global maintenance is unavailable");
    await attentionDispositionGlobalMaintenance(impact);
  };
  const tournamentService = createTournamentService({
    storageService,
    afterSourceSave: maintainCandidateSource,
  });
  const gameService = createGameService({
    storageService,
    collectionMutationService,
    fitnessService,
    bggClient,
    now: options?.now,
    onGameDeleted: (gameId) => tournamentService.onGameDeleted(gameId),
    deletionLifecycle: reflectionRuntime.gameDeletionLifecycle,
  });

  const predictionService = createPredictionService({
    storageService,
    fitnessService,
    tournamentService,
    bggClient,
    afterSourceSave: maintainCandidateSource,
    unifiedScoringService,
  });
  const resolveSemanticRead = jevPairCache
    ? createJevProductionSemanticRead(jevPairCache)
    : undefined;
  const displayedFitnessService = createDisplayedFitnessService({
    gameService,
    predictionService,
    storageService,
    resolveSemanticRead,
    unifiedScoringService,
  });
  attentionCandidateService = createAttentionCandidateService({
    coordinator: profileSourceCoordinatorFor(storageService),
    storage: attentionCandidateStorageFor(storageService),
    productionStorage: storageService,
    clock: { now: () => new Date(options?.now?.() ?? "2026-01-01T00:00:00.000Z") },
    oracle: createAttentionCandidateOracle(displayedFitnessService),
    dependenciesForGame: productionAttentionCandidateDependenciesForGame,
    recoveryRequired: () => attentionDispositionGlobalMaintenance?.recoveryRequired() ?? false,
  });
  const dispositionOracle = createAttentionCandidateOracle(displayedFitnessService);
  const dispositionSource = createAttentionCandidateProductionSourceLoader(storageService);
  attentionDispositionGlobalMaintenance = createAttentionDispositionGlobalMaintenance({
    collectionMutations: collectionMutationService,
    storedRuleMatches: async (dispositions) => {
      if (options?.storedRuleMatches !== undefined) return options.storedRuleMatches(dispositions);
      const source = await dispositionSource();
      const proposal = await unifiedScoringService.prepareProposedCollection({
        prior: source.collection,
        proposed: { ...source.collection, attentionDispositions: [] },
      });
      const evaluation = await dispositionOracle.evaluateStoredRulesForProposedCollection?.(
        source,
        proposal,
        options?.now?.() ?? "2026-01-01T00:00:00.000Z",
        dispositions.map((disposition) => ({
          gameId: disposition.gameId,
          ruleId: disposition.ruleId,
        })),
      );
      if (!evaluation) throw new Error("Proposed stored-rule evaluation is unavailable");
      const matches = await evaluation.accept(() => evaluation.matches);
      if (!matches) throw new Error("Proposed stored-rule scoring became stale");
      return matches;
    },
    maintainCandidates: async (impact) => {
      await attentionCandidateService?.maintain(impact);
    },
    invalidateCandidates: async () => {
      await attentionCandidateService?.invalidate();
    },
  });
  const attentionCandidateMaintenanceRecovery = createAttentionCandidateMaintenanceRecovery({
    recoverCompatibility: () => {
      if (attentionDispositionGlobalMaintenance === null)
        throw new Error("Attention disposition global maintenance is unavailable");
      return attentionDispositionGlobalMaintenance.recover();
    },
    ensureFresh: () => {
      if (attentionCandidateService === null)
        throw new Error("Attention candidates are unavailable");
      return attentionCandidateService.ensureFresh();
    },
  });
  const attentionDispositionService = createAttentionDispositionService({
    collectionMutations: collectionMutationService,
    clock: { now: () => new Date(options?.now?.() ?? "2026-01-01T00:00:00.000Z") },
    currentSelection: async (collection, gameId) => {
      const source = await dispositionSource();
      const evaluation = await dispositionOracle.evaluate(
        { ...source, collection },
        options?.now?.() ?? "2026-01-01T00:00:00.000Z",
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
        if (attentionCandidateService === null) return { state: "unavailable" };
        return attentionCandidateService.maintainAfterCollectionCommit(impact);
      },
    },
  });
  collectionMutationService.setDispositionWinners(async (prior, collection, _context, gameIds) => {
    const source = await dispositionSource();
    const proposal = await unifiedScoringService.prepareProposedCollection({
      prior,
      proposed: collection,
    });
    const storedRules = collection.attentionDispositions
      .filter((disposition) => gameIds.includes(disposition.gameId))
      .map((disposition) => ({ gameId: disposition.gameId, ruleId: disposition.ruleId }));
    if (storedRules.length === 0) {
      return { winners: [], assertBaseCurrent: () => proposal.assertBaseCurrent() };
    }
    const evaluation = await dispositionOracle.evaluateStoredRulesForProposedCollection?.(
      source,
      proposal,
      options?.now?.() ?? "2026-01-01T00:00:00.000Z",
      storedRules,
    );
    if (!evaluation) throw new Error("Proposed stored-rule evaluation is unavailable");
    const accepted = await evaluation.accept(() => ({
      winners: evaluation.matches,
      assertBaseCurrent: () => evaluation.assertBaseCurrent(),
    }));
    if (!accepted) throw new Error("Proposed stored-rule scoring became stale");
    return accepted;
  });
  const intentionService =
    options?.intentionService ??
    createIntentionService({
      collectionMutationService,
      now: options?.now,
      createId: options?.createIntentionId,
    });
  const ownerGameNoteService =
    options?.ownerGameNoteService ??
    createOwnerGameNoteService({
      collectionMutationService,
      now: options?.now,
      invalidationLifecycle: reflectionRuntime.noteInvalidationLifecycle,
    });
  const profileService = createProfileService({
    storageService,
    displayedFitnessService,
    attentionCandidates: attentionCandidateService,
    now: options?.now,
  });
  const unavailableGroundedConfiguration: GroundedProviderStartupConfiguration = {
    status: "unavailable",
    reason: "model-configuration",
    safeDetail: "test-not-configured",
    correctionDestination: {
      operationId: "shelf.grounded-analysis.configuration.get",
    },
  };
  const groundedAnalysisProvider =
    options?.groundedAnalysisProvider ??
    createGroundedAnalysisProvider({ configuration: unavailableGroundedConfiguration });

  const collectionSnapshotService = resolveSemanticRead
    ? createCollectionSnapshotCacheService({
        builder: createCollectionSnapshotService({
          storageService,
          gameService,
          predictionService,
          purchaseUtilizationService: createPurchaseUtilizationService({
            storageService,
            collectionMutationService,
          }),
          resolveSemanticRead,
        }),
        storageService,
        coordinator: profileSourceCoordinatorFor(storageService),
      })
    : undefined;

  const { app, operations, groundedAnalysisTransportController } = createApp({
    storageService,
    collectionMutationService,
    axisService,
    gameService,
    tournamentService,
    profileService,
    predictionService,
    unifiedScoringService,
    displayedFitnessService,
    intentionService,
    attentionDispositionService,
    ownerGameNoteService,
    groundedAnalysisProvider,
    reflectionRuntime,
    collectionSnapshotService,
    semanticRedundancyStateService: options?.semanticRedundancyStateService,
    bggClient,
    profileSourceCoordinator: profileSourceCoordinatorFor(storageService),
    afterCandidateSourceSave: maintainCandidateSource,
    onShutdown: options?.onShutdown,
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
    unifiedScoringService,
    intentionService,
    ownerGameNoteService,
    attentionCandidateService: attentionCandidateService,
    attentionCandidateMaintenanceRecovery,
    attentionDispositionGlobalMaintenance,
    attentionDispositionService,
    bggClient,
    groundedAnalysisProvider,
    groundedAnalysisTransportController,
    reflectionRuntime,
    fileOps,
  };
}

/** Create a test app with persisted source-vector state loaded before proof-dependent reads. */
export async function createHydratedTestApp<TFileOps extends FileOps = MockFileOps>(
  options?: TestAppOptions<TFileOps>,
): Promise<TestAppContext<TFileOps>> {
  const context = createTestApp(options);
  await context.storageService.hydrateSourceVector?.();
  return context;
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
    getPlayCount: () => Promise.reject(new Error("Not implemented in mock")),
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
