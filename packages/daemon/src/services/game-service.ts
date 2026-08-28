import { v4 as uuidv4 } from "uuid";
import {
  AddGameSchema,
  createInitialEntityMetadata,
  AXIS_VALIDATION_CODES,
  CodedAxisValidationError,
  toErrorMessage,
  type Game,
  type OwnershipStatus,
  type AddGameInput,
  type Axis,
  type FitnessResult,
  type GameWithScore,
  type AddGameResult,
  type BggSearchResult,
  type BoxDimensions,
  type TournamentData,
  type BggRequestObservation,
  type FieldEvidence,
  type PlayerRangeEvidence,
} from "@shelf-judge/shared";
import type { CollectionPersistence, StorageService } from "./storage-service.js";
import {
  collectionMutationServiceFor,
  type CollectionMutationService,
} from "./collection-mutation-service.js";
import type { FitnessService } from "./fitness-service.js";
import type { BggClient, BggGameResult } from "./bgg-client.js";
import type { BggCollectionItem } from "./bgg-xml-parser.js";
import { createLogger, type Logger } from "./logger.js";
import { canonicalSuggestedPlayerPoll } from "./suggested-player-poll.js";

const STALE_THRESHOLD_DAYS = 7;
const STALE_THRESHOLD_MS = STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

export interface RefreshSummary {
  refreshed: number;
  errors: string[];
}

export interface ImportProgressEvent {
  phase: "fetching-collection" | "importing-games";
  current: number;
  total: number;
  importedSoFar: number;
  gameName?: string;
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface GameService {
  addGame(input: AddGameInput): Promise<AddGameResult>;
  getGame(id: string): Promise<GameWithScore>;
  listGames(): Promise<GameWithScore[]>;
  rateGame(id: string, ratings: Record<string, number | null>): Promise<GameWithScore>;
  removeGame(id: string): Promise<void>;
  searchGames(query: string): Promise<BggSearchResult[]>;
  refreshBggData(gameId: string): Promise<Game>;
  refreshAllBggData(): Promise<RefreshSummary>;
  setOwnership(id: string, ownership: OwnershipStatus): Promise<Game>;
  setBoxDimensions(id: string, dimensions: BoxDimensions | null): Promise<Game>;
  setManualShelf(id: string, shelfId: string | null): Promise<Game>;
  importBggCollection(
    onProgress?: (event: ImportProgressEvent) => Promise<void> | void,
  ): Promise<ImportSummary>;
}

type GameStorage = Pick<StorageService, "loadCollection" | "loadTournament" | "loadShelfConfig">;

export type GameServiceDeps = {
  fitnessService: FitnessService;
  bggClient?: BggClient;
  onGameDeleted?: (gameId: string) => Promise<void>;
  now?: () => string;
  logger?: Logger;
} & (
  | { storageService: GameStorage; collectionMutationService: CollectionMutationService }
  | {
      storageService: GameStorage & CollectionPersistence;
      collectionMutationService?: undefined;
    }
);

function observedField(
  observation: BggRequestObservation | undefined,
  field: string,
): observation is BggRequestObservation {
  return observation?.fieldsReturned.includes(field) === true;
}

function fieldEvidence(
  value: number | null,
  observation: BggRequestObservation,
  source: "bgg-thing" | "bgg-collection",
  valid: (candidate: number) => boolean,
): FieldEvidence<number> {
  if (value === null) {
    return {
      status: "invalid",
      evidence: { presence: "present", value: null },
      source,
      observedAt: observation.observedAt,
    };
  }
  if (!valid(value)) {
    return {
      status: "invalid",
      evidence: { presence: "present", value },
      source,
      observedAt: observation.observedAt,
    };
  }
  return { status: "valid", value, source, observedAt: observation.observedAt };
}

function playerRangeEvidence(result: BggGameResult): PlayerRangeEvidence | null {
  const observation = result.playerRangeObservation;
  if (observation === undefined || observation.fieldsReturned.length === 0) return null;
  const minPresent = observation.fieldsReturned.includes("minPlayers");
  const maxPresent = observation.fieldsReturned.includes("maxPlayers");
  const min = result.metadata.minPlayers;
  const max = result.metadata.maxPlayers;
  if (
    minPresent &&
    maxPresent &&
    min !== null &&
    max !== null &&
    Number.isSafeInteger(min) &&
    Number.isSafeInteger(max) &&
    min > 0 &&
    min <= max
  ) {
    return {
      status: "valid",
      value: { minPlayers: min, maxPlayers: max },
      source: "bgg-player-range",
      observedAt: observation.observedAt,
    };
  }
  return {
    status: "invalid",
    evidence: {
      minPlayers: minPresent ? { presence: "present", value: min } : { presence: "missing" },
      maxPlayers: maxPresent ? { presence: "present", value: max } : { presence: "missing" },
    },
    source: "bgg-player-range",
    observedAt: observation.observedAt,
  };
}

function applyBggResult(
  game: Game,
  result: BggGameResult,
  logger: Logger,
  retainPollOnRefreshOmission: boolean,
): void {
  game.name = result.metadata.name;
  game.yearPublished = result.metadata.yearPublished;
  const rangeEvidence = playerRangeEvidence(result);
  if (rangeEvidence !== null) {
    game.playerRangeEvidence = rangeEvidence;
    if (rangeEvidence.status === "valid") {
      game.minPlayers = rangeEvidence.value.minPlayers;
      game.maxPlayers = rangeEvidence.value.maxPlayers;
    } else {
      game.minPlayers = null;
      game.maxPlayers = null;
    }
  }
  const bestPlayerCount = strictSafeBestPlayerCount(result.bggData.bestPlayerCount);
  game.bestPlayers = bestPlayerCount;
  if (observedField(result.metadataObservation, "playingTime")) {
    game.durationEvidence = fieldEvidence(
      result.metadata.playingTime,
      result.metadataObservation,
      "bgg-thing",
      (value) => Number.isSafeInteger(value) && value > 0,
    );
    game.playingTime =
      game.durationEvidence.status === "valid" ? game.durationEvidence.value : null;
  }
  game.imageUrl = result.metadata.imageUrl;
  game.bggData = { ...result.bggData, bestPlayerCount };
  if (observedField(result.collectionData?.observation, "numPlays")) {
    game.playCountEvidence = fieldEvidence(
      result.collectionData?.numPlays ?? null,
      result.collectionData.observation,
      "bgg-collection",
      (value) => Number.isSafeInteger(value) && value >= 0,
    );
    game.numPlays = game.playCountEvidence.status === "valid" ? game.playCountEvidence.value : null;
  }
  const poll = canonicalSuggestedPlayerPoll(result.suggestedPlayerPoll);
  if (poll !== null && !(retainPollOnRefreshOmission && poll.state === "absent")) {
    game.suggestedPlayerPoll = poll;
  }
  logger.log("applied BGG result", {
    gameId: game.id,
    bggId: game.bggId,
    thingFieldsReturned: result.metadataObservation?.fieldsReturned ?? [],
    thingObservedAt: result.metadataObservation?.observedAt ?? null,
    playerRangeState: result.playerRangeObservation?.state ?? "absent",
    pollState: result.suggestedPlayerPoll?.state ?? "absent",
    collectionFieldsReturned: result.collectionData?.observation?.fieldsReturned ?? [],
    collectionObservedAt: result.collectionData?.observation?.observedAt ?? null,
    collectionState: result.collectionData?.observation?.state ?? "absent",
  });
}

function strictSafeBestPlayerCount(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isBggDataStale(game: Game): boolean | undefined {
  if (!game.bggData?.fetchedAt) return undefined;
  const fetchedAt = new Date(game.bggData.fetchedAt).getTime();
  return Date.now() - fetchedAt > STALE_THRESHOLD_MS;
}

function bggStateIdentity(game: Game): string {
  return JSON.stringify({
    bggId: game.bggId,
    name: game.name,
    yearPublished: game.yearPublished,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    bestPlayers: game.bestPlayers,
    playingTime: game.playingTime,
    imageUrl: game.imageUrl,
    numPlays: game.numPlays,
    bggData: game.bggData,
    playCountEvidence: game.playCountEvidence,
    durationEvidence: game.durationEvidence,
    playerRangeEvidence: game.playerRangeEvidence,
    suggestedPlayerPoll: game.suggestedPlayerPoll,
  });
}

export function createGameService(deps: GameServiceDeps): GameService {
  const { storageService, fitnessService, bggClient } = deps;
  const collectionMutationService =
    deps.collectionMutationService ?? collectionMutationServiceFor(storageService);
  const now = deps.now ?? (() => new Date().toISOString());
  const logger = deps.logger ?? createLogger("import");

  function computeScore(
    game: Game,
    axes: Axis[],
    tournamentData: TournamentData | null,
  ): FitnessResult | null {
    return fitnessService.calculateScore(game, axes, tournamentData);
  }

  function assertBggConfigured(): void {
    if (!bggClient || !bggClient.isConfigured()) {
      throw new Error(
        "BGG integration is not configured. Register at https://boardgamegeek.com/using_the_xml_api and run `shelf-judge config set bgg-token YOUR_TOKEN`.",
      );
    }
  }

  function configuredBggClient(): BggClient {
    assertBggConfigured();
    if (!bggClient) throw new Error("BGG integration is not configured");
    return bggClient;
  }

  return {
    async addGame(input: AddGameInput): Promise<AddGameResult> {
      const parsed = AddGameSchema.parse(input);
      const createdAt = now();
      const initialDuration = parsed.playingTime ?? null;
      const initialRange =
        parsed.minPlayers !== null &&
        parsed.maxPlayers !== null &&
        parsed.minPlayers <= parsed.maxPlayers
          ? { minPlayers: parsed.minPlayers, maxPlayers: parsed.maxPlayers }
          : null;
      const partialRange =
        initialRange === null && (parsed.minPlayers !== null || parsed.maxPlayers !== null);
      const game: Game = {
        id: uuidv4(),
        bggId: parsed.bggId ?? null,
        name: parsed.name ?? "",
        yearPublished: parsed.yearPublished ?? null,
        minPlayers: initialRange?.minPlayers ?? null,
        maxPlayers: initialRange?.maxPlayers ?? null,
        bestPlayers: parsed.bestPlayers ?? null,
        playingTime: initialDuration !== null && initialDuration > 0 ? initialDuration : null,
        imageUrl: parsed.imageUrl ?? null,
        numPlays: parsed.numPlays ?? null,
        bggData: null,
        acquisition: { state: "unknown" },
        playCountEvidence:
          parsed.numPlays === null
            ? { status: "missing", source: "manual", observedAt: null }
            : { status: "valid", value: parsed.numPlays, source: "manual", observedAt: createdAt },
        durationEvidence:
          initialDuration === null
            ? { status: "missing", source: "manual", observedAt: null }
            : initialDuration > 0
              ? {
                  status: "valid",
                  value: initialDuration,
                  source: "manual",
                  observedAt: createdAt,
                }
              : {
                  status: "invalid",
                  evidence: { presence: "present", value: initialDuration },
                  source: "manual",
                  observedAt: createdAt,
                },
        playerRangeEvidence: initialRange
          ? {
              status: "valid",
              value: initialRange,
              source: "manual",
              observedAt: createdAt,
            }
          : partialRange
            ? {
                status: "invalid",
                evidence: {
                  minPlayers:
                    parsed.minPlayers === null
                      ? { presence: "missing" }
                      : { presence: "present", value: parsed.minPlayers },
                  maxPlayers:
                    parsed.maxPlayers === null
                      ? { presence: "missing" }
                      : { presence: "present", value: parsed.maxPlayers },
                },
                source: "manual",
                observedAt: createdAt,
              }
            : { status: "missing", source: "manual", observedAt: null },
        suggestedPlayerPoll: {
          status: "valid",
          state: "absent",
          buckets: [],
          source: "manual",
          observedAt: null,
        },
        bestPlayersInvalidEvidence: null,
        entityMetadata: createInitialEntityMetadata(parsed.bggId ?? null),
        latestPlayCountCheck: null,
        ownership: "owned",
        boxDimensions: null,
        manualShelfId: null,
        ratings: {},
        createdAt,
        updatedAt: createdAt,
      };

      // Fetch BGG data if bggId is provided and client is available
      let warning: string | undefined;
      let bggImported = false;
      if (game.bggId !== null && bggClient?.isConfigured()) {
        try {
          const result = await bggClient.getGame(game.bggId);
          applyBggResult(game, result, logger, false);
          bggImported = true;
        } catch (err) {
          warning = `Game added but BGG data could not be fetched: ${toErrorMessage(err)}`;
        }
      }

      const { value: acceptedGame } = await collectionMutationService.mutate(
        { operation: "game.add", trigger: "owner", gameIds: [game.id] },
        (collection) => {
          if (game.bggId !== null) {
            const existing = collection.games.find((candidate) => candidate.bggId === game.bggId);
            if (existing) {
              throw new Error(
                `A game with BGG ID ${game.bggId} already exists: "${existing.name}"`,
              );
            }
          }
          const accepted = structuredClone(game);
          collection.games.push(accepted);
          collection.updatedAt = createdAt;
          return { changed: true, value: accepted };
        },
      );

      return { game: acceptedGame, bggImported, warning };
    },

    async getGame(id: string): Promise<GameWithScore> {
      const [collection, tournamentData] = await Promise.all([
        storageService.loadCollection(),
        storageService.loadTournament(),
      ]);
      const game = collection.games.find((g) => g.id === id);

      if (!game) {
        throw new Error(`Game not found: ${id}`);
      }

      const score = computeScore(game, collection.axes, tournamentData);
      return { game, score, bggDataStale: isBggDataStale(game) };
    },

    async listGames(): Promise<GameWithScore[]> {
      const [collection, tournamentData] = await Promise.all([
        storageService.loadCollection(),
        storageService.loadTournament(),
      ]);
      const results: GameWithScore[] = collection.games.map((game) => ({
        game,
        score: computeScore(game, collection.axes, tournamentData),
        bggDataStale: isBggDataStale(game),
      }));

      // Sort by fitness descending, unscored at end
      results.sort((a, b) => {
        if (a.score !== null && b.score !== null) {
          return b.score.score - a.score.score;
        }
        if (a.score !== null) return -1;
        if (b.score !== null) return 1;
        return 0;
      });

      return results;
    },

    async rateGame(id: string, ratings: Record<string, number | null>): Promise<GameWithScore> {
      const { value: game, collection } = await collectionMutationService.mutate(
        { operation: "game.rate", trigger: "owner", gameIds: [id] },
        (collection) => {
          const game = collection.games.find((candidate) => candidate.id === id);
          if (!game) throw new Error(`Game not found: ${id}`);
          for (const [axisId, rating] of Object.entries(ratings)) {
            const axis = collection.axes.find((candidate) => candidate.id === axisId);
            if (!axis) throw new Error(`Axis not found: ${axisId}`);
            if (!axis.enabled) {
              throw new CodedAxisValidationError(
                `Axis is disabled and cannot be rated: ${axisId}`,
                AXIS_VALIDATION_CODES.DISABLED_LEGACY_AXIS,
                [{ field: "axisId", path: ["ratings", axisId] }],
              );
            }
            if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 10)) {
              throw new Error(
                `Rating must be an integer between 1 and 10, got ${rating} for axis "${axis.name}"`,
              );
            }
          }
          for (const [axisId, rating] of Object.entries(ratings)) {
            if (rating === null) delete game.ratings[axisId];
            else game.ratings[axisId] = rating;
          }
          game.updatedAt = now();
          collection.updatedAt = game.updatedAt;
          return { changed: true, value: game };
        },
      );
      const tournamentData = await storageService.loadTournament();
      const score = computeScore(game, collection.axes, tournamentData);
      return { game, score, bggDataStale: isBggDataStale(game) };
    },

    async removeGame(id: string): Promise<void> {
      await collectionMutationService.mutate(
        { operation: "game.remove", trigger: "owner", gameIds: [id] },
        (collection) => {
          const index = collection.games.findIndex((game) => game.id === id);
          if (index === -1) throw new Error(`Game not found: ${id}`);
          collection.games.splice(index, 1);
          collection.updatedAt = now();
          return { changed: true, value: undefined };
        },
      );
      await deps.onGameDeleted?.(id);
    },

    async setOwnership(id: string, ownership: OwnershipStatus): Promise<Game> {
      const { value } = await collectionMutationService.mutate(
        { operation: "game.ownership.set", trigger: "owner", gameIds: [id] },
        (collection) => {
          const game = collection.games.find((candidate) => candidate.id === id);
          if (!game) throw new Error(`Game not found: ${id}`);
          const clearsManualShelf = ownership === "previously-owned" && game.manualShelfId !== null;
          if (game.ownership === ownership && !clearsManualShelf) {
            return { changed: false, value: game };
          }
          game.ownership = ownership;
          if (ownership === "previously-owned") game.manualShelfId = null;
          game.updatedAt = now();
          collection.updatedAt = game.updatedAt;
          return { changed: true, value: game };
        },
      );
      return value;
    },

    async setBoxDimensions(id: string, dimensions: BoxDimensions | null): Promise<Game> {
      const { value } = await collectionMutationService.mutate(
        { operation: "game.dimensions.set", trigger: "owner", gameIds: [id] },
        (collection) => {
          const game = collection.games.find((candidate) => candidate.id === id);
          if (!game) throw new Error(`Game not found: ${id}`);
          game.boxDimensions = dimensions;
          game.updatedAt = now();
          collection.updatedAt = game.updatedAt;
          return { changed: true, value: game };
        },
      );
      return value;
    },

    async setManualShelf(id: string, shelfId: string | null): Promise<Game> {
      const { value } = await collectionMutationService.mutate(
        { operation: "game.shelf.set", trigger: "owner", gameIds: [id] },
        async (collection) => {
          const game = collection.games.find((candidate) => candidate.id === id);
          if (!game) throw new Error(`Game not found: ${id}`);
          if (shelfId !== null) {
            if (game.ownership === "previously-owned") {
              throw new Error("Manual shelf assignment requires an owned game");
            }
            const shelfConfig = await storageService.loadShelfConfig();
            const targetShelf = shelfConfig.units
              .flatMap((unit) => unit.shelves)
              .find((shelf) => shelf.id === shelfId);
            if (!targetShelf) throw new Error(`Shelf not found: ${shelfId}`);
            // Dimensionless shelves are assignment-only buckets.
            if (!targetShelf.dimensionless && game.boxDimensions === null) {
              throw new Error("Box dimensions are required before assigning a shelf");
            }
          }
          if (game.manualShelfId === shelfId) return { changed: false, value: game };
          game.manualShelfId = shelfId;
          game.updatedAt = now();
          collection.updatedAt = game.updatedAt;
          return { changed: true, value: game };
        },
      );
      return value;
    },

    async searchGames(query: string): Promise<BggSearchResult[]> {
      return configuredBggClient().searchGames(query);
    },

    async refreshBggData(gameId: string): Promise<Game> {
      assertBggConfigured();
      const collection = await storageService.loadCollection();
      const game = collection.games.find((g) => g.id === gameId);

      if (!game) {
        throw new Error(`Game not found: ${gameId}`);
      }

      if (game.bggId === null) {
        throw new Error(
          `Game "${game.name}" has no BGG ID. Cannot refresh BGG data for manual games.`,
        );
      }

      const result = await configuredBggClient().getGame(game.bggId);
      const expectedBggId = game.bggId;
      const expectedBggState = bggStateIdentity(game);
      const { value } = await collectionMutationService.mutate(
        { operation: "game.bgg.refresh", trigger: "owner", gameIds: [gameId] },
        (latest) => {
          const acceptedGame = latest.games.find((candidate) => candidate.id === gameId);
          if (!acceptedGame) throw new Error(`Game not found: ${gameId}`);
          if (acceptedGame.bggId !== expectedBggId) {
            throw new Error(`Game BGG identity changed during refresh: ${gameId}`);
          }
          if (bggStateIdentity(acceptedGame) !== expectedBggState) {
            throw new Error(`Newer BGG data was accepted during refresh: ${gameId}`);
          }
          applyBggResult(acceptedGame, result, logger, true);
          acceptedGame.updatedAt = now();
          latest.updatedAt = acceptedGame.updatedAt;
          return { changed: true, value: acceptedGame };
        },
      );
      return value;
    },

    async refreshAllBggData(): Promise<RefreshSummary> {
      assertBggConfigured();
      const collection = await storageService.loadCollection();
      const bggGames = collection.games.filter(
        (game): game is Game & { bggId: number } => game.bggId !== null,
      );
      const requestedGames = new Map(
        bggGames.map((game) => [
          game.id,
          { bggId: game.bggId, state: bggStateIdentity(game), name: game.name },
        ]),
      );

      let refreshed = 0;
      const errors: string[] = [];

      // Batch fetch all BGG IDs
      const bggIds = bggGames.map((game) => game.bggId);
      let bggResults: Map<number, BggGameResult>;
      try {
        bggResults = await configuredBggClient().getGames(bggIds);
      } catch (err) {
        return {
          refreshed: 0,
          errors: [`Batch fetch failed: ${toErrorMessage(err)}`],
        };
      }

      for (const game of bggGames) {
        if (!bggResults.has(game.bggId)) {
          errors.push(`No BGG data returned for "${game.name}" (BGG ID ${game.bggId})`);
        }
      }

      if (bggResults.size > 0) {
        const outcome = await collectionMutationService.mutate(
          {
            operation: "game.bgg.refresh-all",
            trigger: "owner",
            gameIds: bggGames.map((game) => game.id),
          },
          (latest) => {
            const changedAt = now();
            let accepted = 0;
            for (const [gameId, requested] of requestedGames) {
              const game = latest.games.find((candidate) => candidate.id === gameId);
              if (!game) {
                errors.push(`Game removed during BGG refresh: "${requested.name}"`);
                continue;
              }
              if (game.bggId !== requested.bggId || bggStateIdentity(game) !== requested.state) {
                errors.push(`Newer BGG data was accepted during refresh for "${game.name}"`);
                continue;
              }
              const result = bggResults.get(requested.bggId);
              if (!result) continue;
              applyBggResult(game, result, logger, true);
              game.updatedAt = changedAt;
              accepted++;
            }
            if (accepted === 0) return { changed: false, value: 0 };
            latest.updatedAt = changedAt;
            return { changed: true, value: accepted };
          },
        );
        refreshed = outcome.value;
      }

      return { refreshed, errors };
    },

    async importBggCollection(
      onProgress?: (event: ImportProgressEvent) => Promise<void> | void,
    ): Promise<ImportSummary> {
      assertBggConfigured();
      logger.log("starting BGG import...");

      await onProgress?.({
        phase: "fetching-collection",
        current: 0,
        total: 0,
        importedSoFar: 0,
      });

      let collectionItems: BggCollectionItem[];
      try {
        collectionItems = await configuredBggClient().getUserCollection();
      } catch (err) {
        logger.error(`failed to fetch collection: ${toErrorMessage(err)}`);
        throw new Error(`Failed to fetch BGG collection: ${toErrorMessage(err)}`);
      }

      const collection = await storageService.loadCollection();
      const existingBggIds = new Set(
        collection.games
          .filter((game): game is Game & { bggId: number } => game.bggId !== null)
          .map((game) => game.bggId),
      );

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];
      const candidates: Game[] = [];
      const total = collectionItems.length;

      const newItems = collectionItems.filter((item) => !existingBggIds.has(item.bggId));
      skipped = collectionItems.length - newItems.length;
      logger.log(`collection: ${total} total, ${newItems.length} new, ${skipped} already exist`);

      // Signal the total before batch fetch starts so the UI can show "0 / N"
      // during the slow BGG API calls instead of "0 / 0".
      await onProgress?.({
        phase: "importing-games",
        current: skipped,
        total,
        importedSoFar: 0,
      });

      const itemsByBggId = new Map(newItems.map((item) => [item.bggId, item]));

      // Process each batch as it arrives so progress events are paced by
      // actual network requests instead of firing all at once.
      if (newItems.length > 0) {
        const newBggIds = newItems.map((item) => item.bggId);
        try {
          await configuredBggClient().getGames(newBggIds, async (batch) => {
            for (const [bggId, result] of batch.results) {
              const item = itemsByBggId.get(bggId);
              const gameName = item?.name ?? result.metadata.name;

              await onProgress?.({
                phase: "importing-games",
                current: skipped + imported + errors.length + 1,
                total,
                importedSoFar: imported,
                gameName,
              });

              const initialCollectionData = item
                ? {
                    numPlays: item.numplays,
                    observation: item.playCountObservation,
                  }
                : undefined;
              const secondaryCollectionComplete =
                result.collectionData !== undefined &&
                result.collectionData.numPlays !== null &&
                result.collectionData.observation?.sourceRequest === "bgg-collection" &&
                result.collectionData.observation.observedAt.length > 0 &&
                result.collectionData.observation.state === "complete" &&
                result.collectionData.observation.fieldsReturned.includes("numPlays");
              const collectionData = secondaryCollectionComplete
                ? result.collectionData
                : (initialCollectionData ?? result.collectionData);
              const createdAt = now();
              const rangeEvidence = playerRangeEvidence(result);
              const poll = canonicalSuggestedPlayerPoll(result.suggestedPlayerPoll);
              const durationObserved = observedField(result.metadataObservation, "playingTime");
              const playObserved = observedField(collectionData?.observation, "numPlays");
              const playCountEvidence =
                playObserved && collectionData?.observation
                  ? fieldEvidence(
                      collectionData.numPlays,
                      collectionData.observation,
                      "bgg-collection",
                      (value) => Number.isSafeInteger(value) && value >= 0,
                    )
                  : {
                      status: "missing" as const,
                      source: "bgg-collection" as const,
                      observedAt: null,
                    };
              const bestPlayerCount = strictSafeBestPlayerCount(result.bggData.bestPlayerCount);
              const game: Game = {
                id: uuidv4(),
                bggId,
                name: result.metadata.name,
                yearPublished: result.metadata.yearPublished,
                minPlayers:
                  rangeEvidence?.status === "valid" ? rangeEvidence.value.minPlayers : null,
                maxPlayers:
                  rangeEvidence?.status === "valid" ? rangeEvidence.value.maxPlayers : null,
                bestPlayers: bestPlayerCount,
                playingTime:
                  durationObserved &&
                  result.metadata.playingTime !== null &&
                  Number.isSafeInteger(result.metadata.playingTime) &&
                  result.metadata.playingTime > 0
                    ? result.metadata.playingTime
                    : null,
                imageUrl: result.metadata.imageUrl,
                numPlays: playCountEvidence.status === "valid" ? playCountEvidence.value : null,
                bggData: { ...result.bggData, bestPlayerCount },
                acquisition: { state: "unknown" },
                playCountEvidence,
                durationEvidence:
                  durationObserved && result.metadataObservation
                    ? fieldEvidence(
                        result.metadata.playingTime,
                        result.metadataObservation,
                        "bgg-thing",
                        (value) => Number.isSafeInteger(value) && value > 0,
                      )
                    : { status: "missing", source: "bgg-thing", observedAt: null },
                playerRangeEvidence: rangeEvidence ?? {
                  status: "missing",
                  source: "bgg-player-range",
                  observedAt: null,
                },
                suggestedPlayerPoll: poll ?? {
                  status: "valid",
                  state: "absent",
                  buckets: [],
                  source: "bgg-suggested-player-poll",
                  observedAt: null,
                },
                bestPlayersInvalidEvidence: null,
                entityMetadata: createInitialEntityMetadata(bggId),
                latestPlayCountCheck: null,
                ownership: "owned",
                boxDimensions: null,
                manualShelfId: null,
                ratings: {},
                createdAt,
                updatedAt: createdAt,
              };

              candidates.push(game);
              logger.log("imported BGG result", {
                gameId: game.id,
                bggId,
                thingFieldsReturned: result.metadataObservation?.fieldsReturned ?? [],
                thingObservedAt: result.metadataObservation?.observedAt ?? null,
                playerRangeState: result.playerRangeObservation?.state ?? "absent",
                pollState: result.suggestedPlayerPoll?.state ?? "absent",
                collectionFieldsReturned: collectionData?.observation?.fieldsReturned ?? [],
                collectionObservedAt: collectionData?.observation?.observedAt ?? null,
                collectionState: collectionData?.observation?.state ?? "absent",
                collectionSource:
                  collectionData === result.collectionData ? "secondary-batch" : "initial-import",
              });
              imported++;
            }

            for (const id of batch.batchIds) {
              if (!batch.results.has(id)) {
                const item = itemsByBggId.get(id);
                const name = item?.name ?? `BGG ID ${id}`;
                logger.warn(`no BGG data for "${name}" (BGG ID ${id})`);
                errors.push(`Failed to fetch full data for "${name}" (BGG ID ${id})`);
              }
            }
          });
        } catch (err) {
          logger.error(`batch fetch failed: ${toErrorMessage(err)}`);
          errors.push(`Batch fetch failed: ${toErrorMessage(err)}`);
        }
      }

      if (imported > 0) {
        const fetched = imported;
        const outcome = await collectionMutationService.mutate(
          {
            operation: "game.import",
            trigger: "bgg-collection",
            gameIds: candidates.map((game) => game.id),
          },
          (latest) => {
            const existingIds = new Set(
              latest.games
                .filter((game): game is Game & { bggId: number } => game.bggId !== null)
                .map((game) => game.bggId),
            );
            const accepted: Array<Game & { bggId: number }> = [];
            for (const game of candidates) {
              if (game.bggId === null || existingIds.has(game.bggId)) continue;
              existingIds.add(game.bggId);
              accepted.push(game as Game & { bggId: number });
            }
            if (accepted.length === 0) return { changed: false, value: 0 };
            latest.games.push(...accepted.map((game) => structuredClone(game)));
            latest.updatedAt = now();
            return { changed: true, value: accepted.length };
          },
        );
        imported = outcome.value;
        skipped += fetched - imported;
      }
      logger.log(`complete: ${imported} imported, ${skipped} skipped, ${errors.length} errors`);

      return { imported, skipped, errors };
    },
  };
}
