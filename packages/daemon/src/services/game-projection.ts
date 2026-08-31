import {
  AddGameResultSchema,
  CollectionProfileCollectionSourceSchema,
  CollectionProfileCollectionSourceV6Schema,
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
  type CollectionProfileCollectionSourceV6,
  type CollectionV6,
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
    score: entry.score,
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
    game: projectPublicGame(detail.game),
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
): CollectionProfileCollectionSource;
export function projectProfileCollectionSource(
  collection: CollectionV6,
): CollectionProfileCollectionSourceV6;
export function projectProfileCollectionSource(
  collection: Collection | CollectionV6,
): CollectionProfileCollectionSource | CollectionProfileCollectionSourceV6 {
  const projected = {
    ...collection,
    games: collection.games.map(projectPublicGame),
  };
  return collection.schemaVersion === 5
    ? CollectionProfileCollectionSourceSchema.parse(projected)
    : CollectionProfileCollectionSourceV6Schema.parse(projected);
}

export interface DormantGameDetailSnapshot {
  collectionRevision: number;
  game: GameDetailGame;
  collection: CollectionProfileCollectionSourceV6;
}

export function createDormantGameDetailSnapshot(
  collection: CollectionV6,
  gameId: string,
): DormantGameDetailSnapshot {
  const game = collection.games.find(({ id }) => id === gameId);
  if (game === undefined) throw new Error(`Game not found: ${gameId}`);
  return {
    collectionRevision: collection.revision,
    game: projectGameDetail(game),
    collection: projectProfileCollectionSource(collection),
  };
}

export interface DormantGameDetailSnapshotService {
  capture(gameId: string): Promise<DormantGameDetailSnapshot>;
}

export function createDormantGameDetailSnapshotService(collectionReader: {
  loadCollection(): Promise<CollectionV6>;
}): DormantGameDetailSnapshotService {
  const coordinator = profileSourceCoordinatorFor(collectionReader);
  return {
    capture(gameId) {
      return coordinator.runExclusive(async () =>
        createDormantGameDetailSnapshot(await collectionReader.loadCollection(), gameId),
      );
    },
  };
}
