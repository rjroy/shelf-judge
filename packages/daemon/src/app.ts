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
import { createGroundedAnalysisRoutes } from "./routes/grounded-analysis.js";
import { createShutdownRoutes } from "./routes/shutdown.js";
import { createTournamentRoutes } from "./routes/tournament.js";
import { createProfileRoutes } from "./routes/profile.js";
import { createPredictionRoutes } from "./routes/prediction.js";
import { createNicheRoutes } from "./routes/niche.js";
import { createRedundancyRoutes } from "./routes/redundancy.js";
import { createWishlistRoutes } from "./routes/wishlist.js";
import { createShelfRoutes } from "./routes/shelf.js";
import { createCollectionRoutes } from "./routes/collection.js";
import { createWishlistService } from "./services/wishlist-service.js";
import { createShelfService } from "./services/shelf-service.js";
import { createCapacityService } from "./services/capacity-service.js";
import type { TournamentService } from "./services/tournament-service.js";
import type { ProfileService } from "./services/profile-service.js";
import type { PredictionService } from "./services/prediction-service.js";
import type { OperationDefinition } from "./operations.js";
import { createPurchaseUtilizationService } from "./services/purchase-utilization-service.js";
import type { CollectionMutationService } from "./services/collection-mutation-service.js";
import type { DisplayedFitnessService } from "./services/displayed-fitness-service.js";
import type { IntentionService } from "./services/intention-service.js";
import type { OwnerGameNoteService } from "./services/owner-game-note-service.js";
import type { GroundedAnalysisProvider } from "./services/grounded-analysis/provider.js";
import {
  createGroundedAnalysisTransportController,
  type GroundedAnalysisTransportController,
} from "./services/grounded-analysis/transport-controller.js";
import {
  createGroundedFeatureAnalyzerRegistry,
  type GroundedFeatureAnalyzer,
} from "./services/grounded-analysis/feature-policy.js";
import { REFLECTION_MANIFEST_VERSION } from "@shelf-judge/shared";
import { createProfileReflectionRoutes } from "./routes/profile-reflections.js";
import { createReflectionEvidenceService } from "./services/reflection-evidence-service.js";
import { createReflectionProjectionSnapshotService } from "./services/reflection-evidence-projections.js";
import {
  createReflectionRefreshService,
  type ReflectionRefreshService,
} from "./services/reflection-refresh-service.js";
import { createReflectionResultValidator } from "./services/reflection-result-validator.js";
import type { ReflectionRuntime } from "./services/reflection-runtime.js";

export interface AppDeps {
  storageService: StorageService;
  collectionMutationService: CollectionMutationService;
  axisService: AxisService;
  gameService: GameService;
  tournamentService: TournamentService;
  profileService: ProfileService;
  predictionService: PredictionService;
  displayedFitnessService: DisplayedFitnessService;
  intentionService: IntentionService;
  ownerGameNoteService: OwnerGameNoteService;
  groundedAnalysisProvider: GroundedAnalysisProvider;
  reflectionRuntime: ReflectionRuntime;
  groundedFeatureAnalyzers?: readonly GroundedFeatureAnalyzer<unknown>[];
  bggClient?: BggClient;
  onShutdown?: () => void;
}

export interface AppResult {
  app: Hono;
  operations: OperationDefinition[];
  groundedAnalysisProvider: GroundedAnalysisProvider;
  groundedAnalysisTransportController: GroundedAnalysisTransportController;
  reflectionRefreshService: ReflectionRefreshService;
}

export function createApp(deps: AppDeps): AppResult {
  const {
    storageService,
    collectionMutationService,
    axisService,
    gameService,
    tournamentService,
    profileService,
    predictionService,
    displayedFitnessService,
    intentionService,
    ownerGameNoteService,
    groundedAnalysisProvider,
    reflectionRuntime,
    bggClient,
    onShutdown,
  } = deps;

  // Build wishlist service (used by both wishlist routes and game routes for auto-removal)
  const wishlistService = createWishlistService({
    storageService,
    predictionService,
    gameService,
  });
  const purchaseUtilizationService = createPurchaseUtilizationService({
    storageService,
    collectionMutationService,
  });

  // Build routes
  const gameRouteModule = createGameRoutes({
    gameService,
    bggClient,
    predictionService,
    storageService,
    wishlistService,
    purchaseUtilizationService,
    displayedFitnessService,
    intentionService,
    ownerGameNoteService,
  });
  const collectionRouteModule = createCollectionRoutes({ purchaseUtilizationService });
  const axisRouteModule = createAxisRoutes({ axisService });
  const scoreRouteModule = createScoreRoutes({ gameService });
  const importRouteModule = createImportRoutes({ gameService, bggClient });
  const tournamentRouteModule = createTournamentRoutes({ tournamentService, gameService });
  const profileRouteModule = createProfileRoutes({ profileService });
  const predictionRouteModule = createPredictionRoutes({ predictionService, storageService });
  const nicheRouteModule = createNicheRoutes({ storageService });
  const redundancyRouteModule = createRedundancyRoutes({ storageService });
  const shelfService = createShelfService({ storageService, collectionMutationService });
  const capacityService = createCapacityService({ storageService, gameService });
  const shelfRouteModule = createShelfRoutes({ shelfService, capacityService });
  const wishlistRouteModule = createWishlistRoutes({ wishlistService });
  const groundedAnalysisRouteModule = createGroundedAnalysisRoutes({
    configurationStatus: groundedAnalysisProvider.configurationStatus,
  });
  const groundedAnalysisTransportController = createGroundedAnalysisTransportController({
    analyzers: createGroundedFeatureAnalyzerRegistry(deps.groundedFeatureAnalyzers ?? []),
  });
  const reflectionProjectionSnapshotService = createReflectionProjectionSnapshotService({
    storageService,
    displayedFitnessService,
  });
  const reflectionEvidenceService = createReflectionEvidenceService({
    storageService,
    projectionSnapshotService: reflectionProjectionSnapshotService,
    ownerGameNoteService,
  });
  const reflectionRefreshService = createReflectionRefreshService({
    provider: groundedAnalysisProvider,
    evidence: reflectionEvidenceService,
    state: reflectionRuntime.state,
    validator: createReflectionResultValidator(),
  });
  const reflectionRouteModule = createProfileReflectionRoutes({
    configurationStatus: groundedAnalysisProvider.configurationStatus,
    state: reflectionRuntime.state,
    refresh: reflectionRefreshService,
    async loadCurrentSources() {
      const provider =
        groundedAnalysisProvider.configurationStatus.status === "configured"
          ? groundedAnalysisProvider.configurationStatus.identity
          : { providerId: "unavailable", modelId: "unavailable", extensionIds: [] };
      const [repeatedValues, patternExceptions, recurringTradeOffs] = await Promise.all([
        reflectionEvidenceService.assemble("repeated-values", provider),
        reflectionEvidenceService.assemble("pattern-exceptions", provider),
        reflectionEvidenceService.assemble("recurring-trade-offs", provider),
      ]);
      const packages = [repeatedValues, patternExceptions, recurringTradeOffs] as const;
      const identity = repeatedValues.evidenceIdentity;
      return {
        collectionId: identity.collectionId,
        collectionSchemaVersion: identity.collectionSchemaVersion,
        collectionRevision: identity.collectionRevision,
        profileContractVersion: identity.profileContractVersion,
        profileAlgorithmVersion: identity.profileAlgorithmVersion,
        providerId: provider.providerId,
        modelId: provider.modelId,
        manifestVersion: REFLECTION_MANIFEST_VERSION,
        questionVersions: Object.fromEntries(
          packages.map(({ evidenceIdentity }) => [
            evidenceIdentity.questionId,
            evidenceIdentity.questionVersion,
          ]),
        ),
        dependenciesByQuestion: {
          "repeated-values": repeatedValues.dependencies,
          "pattern-exceptions": patternExceptions.dependencies,
          "recurring-trade-offs": recurringTradeOffs.dependencies,
        },
      };
    },
  });

  // Collect all operations
  const allOperations: OperationDefinition[] = [
    ...gameRouteModule.operations,
    ...axisRouteModule.operations,
    ...scoreRouteModule.operations,
    ...importRouteModule.operations,
    ...tournamentRouteModule.operations,
    ...profileRouteModule.operations,
    ...predictionRouteModule.operations,
    ...nicheRouteModule.operations,
    ...redundancyRouteModule.operations,
    ...wishlistRouteModule.operations,
    ...shelfRouteModule.operations,
    ...collectionRouteModule.operations,
    ...groundedAnalysisRouteModule.operations,
    ...reflectionRouteModule.operations,
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
  app.route("/api", tournamentRouteModule.routes);
  app.route("/api", profileRouteModule.routes);
  app.route("/api", predictionRouteModule.routes);
  app.route("/api", nicheRouteModule.routes);
  app.route("/api", redundancyRouteModule.routes);
  app.route("/api", wishlistRouteModule.routes);
  app.route("/api", shelfRouteModule.routes);
  app.route("/api", collectionRouteModule.routes);
  app.route("/api", groundedAnalysisRouteModule.routes);
  app.route("/api", reflectionRouteModule.routes);
  app.route("/api", helpRouteModule.routes);
  app.route("/api", configRouteModule.routes);
  app.route("/api", shutdownRouteModule.routes);

  return {
    app,
    operations: allOperations,
    groundedAnalysisProvider,
    groundedAnalysisTransportController,
    reflectionRefreshService,
  };
}
