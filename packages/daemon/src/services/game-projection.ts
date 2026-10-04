import {
  AddGameResultSchema,
  CollectionProfileCollectionSourceSchema,
  GameDetailGameSchema,
  GameDetailWithPurchaseUtilizationSchema,
  GameListResponseSchema,
  GameSchema,
  GameWithScoreSchema,
  ManualPlayCorrectionResultSchema,
  OwnershipMutationResultSchema,
  PlayEvidenceMutationResultSchema,
  PredictedGameResponseSchema,
  PublicGameMutationResultSchema,
  TournamentNextPairResponseSchema,
  type AddGameResult,
  type Collection,
  type CollectionProfileCollectionSource,
  type NicheSettings,
  type PredictionSettings,
  type RedundancySettings,
  type TournamentData,
  type DurableGame,
  type Game,
  type GameDetailGame,
  type GameDetailWithPurchaseUtilization,
  type GameWithPurchaseUtilization,
  type GameWithScore,
  type ManualPlayCorrectionResult,
  type OwnershipMutationResult,
  type PlayEvidenceMutationResult,
  type PredictedGameResponse,
  type TournamentNextPairResponse,
} from "@shelf-judge/shared";
import { profileSourceCoordinatorFor } from "./profile-source-coordinator.js";
import type { DisplayedFitnessSnapshot } from "./displayed-fitness-service.js";
import type { SourceVector } from "./source-vector.js";

type ProjectableGame = Game & Partial<Pick<DurableGame, "ownerNote">>;

export function projectPublicGame(game: ProjectableGame): Game {
  const { ownerNote, ...publicGame } = game;
  void ownerNote;
  return GameSchema.parse(publicGame);
}

export function projectGameDetail(game: DurableGame): GameDetailGame {
  return GameDetailGameSchema.parse(game);
}

export function projectGameWithScore(entry: GameWithScore): GameWithScore {
  return GameWithScoreSchema.parse({
    game: projectPublicGame(entry.game),
    score:
      entry.score === null
        ? null
        : {
            ...entry.score,
            redundancySimilarityInfo: entry.score.redundancySimilarityInfo ?? {
              status: "disabled",
              generationId: null,
            },
          },
    bggDataStale: entry.bggDataStale,
    nichePosition: entry.nichePosition,
  });
}

export function projectGameList(
  entries: readonly GameWithPurchaseUtilization[],
): GameWithPurchaseUtilization[] {
  return GameListResponseSchema.parse(
    entries.map((entry) => ({
      ...projectGameWithScore(entry),
      displayScore: entry.displayScore,
      purchaseUtilization: entry.purchaseUtilization,
    })),
  );
}

export function projectGameDetailResponse(
  detail: GameDetailWithPurchaseUtilization,
): GameDetailWithPurchaseUtilization {
  return GameDetailWithPurchaseUtilizationSchema.parse({
    ...detail,
    game: projectGameDetail(detail.game),
  });
}

export function projectAddGameResult(result: AddGameResult): AddGameResult {
  return AddGameResultSchema.parse({ ...result, game: projectPublicGame(result.game) });
}

export function projectPublicGameMutation(game: ProjectableGame): { game: Game } {
  return PublicGameMutationResultSchema.parse({ game: projectPublicGame(game) });
}

export function projectPlayEvidenceMutation(
  result: PlayEvidenceMutationResult,
): PlayEvidenceMutationResult {
  return PlayEvidenceMutationResultSchema.parse({
    ...result,
    game: projectPublicGame(result.game),
  });
}

export function projectManualPlayCorrection(
  result: ManualPlayCorrectionResult,
): ManualPlayCorrectionResult {
  return ManualPlayCorrectionResultSchema.parse(
    result.ok ? { ...result, game: projectPublicGame(result.game) } : result,
  );
}

export function projectOwnershipMutation(result: OwnershipMutationResult): OwnershipMutationResult {
  return OwnershipMutationResultSchema.parse({
    ...result,
    game: projectPublicGame(result.game),
  });
}

export function projectPredictedGameResponse(
  response: PredictedGameResponse,
): PredictedGameResponse {
  return PredictedGameResponseSchema.parse({
    game: projectPublicGame(response.game),
    score: response.score,
    predictionUnavailable: response.predictionUnavailable,
    nicheImpact: response.nicheImpact,
    redundancyPreview: response.redundancyPreview,
  });
}

export function projectTournamentNextPair(
  response: TournamentNextPairResponse,
): TournamentNextPairResponse {
  return TournamentNextPairResponseSchema.parse(
    "done" in response
      ? response
      : {
          ...response,
          gameA: projectPublicGame(response.gameA),
          gameB: projectPublicGame(response.gameB),
        },
  );
}

export function projectProfileCollectionSource(
  collection: Collection,
): CollectionProfileCollectionSource {
  const { semanticRedundancy, ...publicCollection } = collection;
  void semanticRedundancy;
  const projected = {
    ...publicCollection,
    games: collection.games.map(projectPublicGame),
  };
  return CollectionProfileCollectionSourceSchema.parse(projected);
}

export interface GameDetailSnapshot {
  collectionRevision: number;
  game: GameDetailGame;
  collection: CollectionProfileCollectionSource;
  /** Captured note-free semantic mode status; private semantic state is not projected. */
  redundancySimilarityStatus: "not-ready" | "stale" | null;
  /** Private immutable scoring input; never serialize this as part of the response. */
  fitnessSnapshot?: Extract<DisplayedFitnessSnapshot, { kind: "private-capture" }>;
}

export function createGameDetailSnapshot(
  collection: Collection,
  gameId: string,
  sources?: {
    tournament: TournamentData;
    predictionSettings: PredictionSettings;
    redundancySettings: RedundancySettings;
    nicheSettings: NicheSettings;
    sourceVector: SourceVector;
  },
): GameDetailSnapshot {
  const game = collection.games.find(({ id }) => id === gameId);
  if (game === undefined) throw new Error(`Game not found: ${gameId}`);
  return {
    collectionRevision: collection.revision,
    game: projectGameDetail(game),
    collection: projectProfileCollectionSource(collection),
    // Legacy v9 published generations are quarantined during the v10 cutover.
    redundancySimilarityStatus: collection.semanticRedundancy.settings.enabled ? "not-ready" : null,
    ...(sources === undefined
      ? {}
      : {
          fitnessSnapshot: {
            kind: "private-capture" as const,
            collection,
            ...sources,
          },
        }),
  };
}

export interface GameDetailSnapshotService {
  capture(gameId: string): Promise<GameDetailSnapshot>;
}

export function createGameDetailSnapshotService(collectionReader: {
  loadCollection(): Promise<Collection>;
  loadTournament?(): Promise<TournamentData>;
  loadPredictionSettings?(): Promise<PredictionSettings>;
  loadRedundancySettings?(): Promise<RedundancySettings>;
  loadNicheSettings?(): Promise<NicheSettings>;
  sourceVector?(): SourceVector;
  hydrateSourceVector?(): Promise<SourceVector>;
}): GameDetailSnapshotService {
  const coordinator = profileSourceCoordinatorFor(collectionReader);
  return {
    capture(gameId) {
      return coordinator.runExclusive(async () => {
        const collection = await collectionReader.loadCollection();
        const [tournament, predictionSettings, redundancySettings, nicheSettings] =
          collectionReader.loadTournament !== undefined &&
          collectionReader.loadPredictionSettings !== undefined &&
          collectionReader.loadRedundancySettings !== undefined &&
          collectionReader.loadNicheSettings !== undefined
            ? await Promise.all([
                collectionReader.loadTournament(),
                collectionReader.loadPredictionSettings(),
                collectionReader.loadRedundancySettings(),
                collectionReader.loadNicheSettings(),
              ])
            : [];
        if (
          tournament === undefined ||
          predictionSettings === undefined ||
          redundancySettings === undefined ||
          nicheSettings === undefined
        ) {
          return createGameDetailSnapshot(collection, gameId);
        }
        const sourceVector =
          (await collectionReader.hydrateSourceVector?.()) ??
          collectionReader.sourceVector?.() ??
          unavailableSourceVector(collection);
        return createGameDetailSnapshot(collection, gameId, {
          tournament,
          predictionSettings,
          redundancySettings,
          nicheSettings,
          sourceVector,
        });
      });
    },
  };
}

function unavailableSourceVector(collection: Collection): SourceVector {
  return {
    available: false,
    unavailableSources: ["source-vector"],
    processEpoch: "unavailable",
    changeToken: -1,
    collectionId: collection.id,
    collectionSchemaVersion: collection.schemaVersion,
    collectionRevision: collection.revision,
    tournamentRevision: null,
    predictionSettingsRevision: null,
    nicheSettingsRevision: null,
    redundancySettingsRevision: null,
    shelfConfigRevision: null,
    representationVersion: 1,
    algorithmVersion: 1,
  };
}
