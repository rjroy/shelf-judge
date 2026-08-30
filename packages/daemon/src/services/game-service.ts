import { v4 as uuidv4 } from "uuid";
import {
  AddGameSchema,
  axisAcceptsScoreOverride,
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
  type Collection,
  type TournamentData,
  type BggRequestObservation,
  type FieldEvidence,
  type PlayerRangeEvidence,
  type PlayEvidenceMutationResult,
  type OwnershipMutationResult,
  ManualGameValuesMutationRequestSchema,
} from "@shelf-judge/shared";
import type { CollectionPersistence, StorageService } from "./storage-service.js";
import {
  collectionMutationServiceFor,
  type CollectionMutationService,
} from "./collection-mutation-service.js";
import { profileSourceCoordinatorFor } from "./profile-source-coordinator.js";
import type { FitnessService } from "./fitness-service.js";
import type { BggClient, BggGameResult } from "./bgg-client.js";
import type { BggCollectionItem } from "./bgg-xml-parser.js";
import { createLogger, type Logger } from "./logger.js";
import { canonicalSuggestedPlayerPoll } from "./suggested-player-poll.js";
import {
  completeIntentionFromPlayEvidence,
  logAutomaticTransitionAttempt,
  logAutomaticTransitionOutcome,
  retireIntentionForOwnership,
  type AutomaticTransitionLogContext,
} from "./intention-service.js";

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
  refreshBggData(gameId: string): Promise<PlayEvidenceMutationResult>;
  refreshAllBggData(): Promise<RefreshSummary>;
  setOwnership(id: string, ownership: OwnershipStatus): Promise<OwnershipMutationResult>;
  setBoxDimensions(id: string, dimensions: BoxDimensions | null): Promise<Game>;
  setManualShelf(id: string, shelfId: string | null): Promise<Game>;
  setManualValues(id: string, values: unknown): Promise<Game>;
  setAdditionalBggIds(id: string, bggIds: number[]): Promise<Game>;
  importBggCollection(
    onProgress?: (event: ImportProgressEvent) => Promise<void> | void,
  ): Promise<ImportSummary>;
}

interface BatchAutomaticTransitionOutcome {
  result: string;
  version: number | null;
  persisted: boolean;
}

export class GameHistoryConflictError extends Error {
  readonly error: { code: "history-conflict"; gameId: string; intentionIds: string[] };

  constructor(gameId: string, intentionIds: string[]) {
    super("Games with intention history cannot be permanently deleted");
    this.name = "GameHistoryConflictError";
    this.error = { code: "history-conflict", gameId, intentionIds };
  }
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

function acceptedIntentionVersion(
  collection: Pick<Collection, "intentions">,
  context: AutomaticTransitionLogContext,
): number | null {
  if (context.intentionId === null) return null;
  return (
    collection.intentions.find(
      (intention) =>
        intention.gameId === context.gameId && intention.intentionId === context.intentionId,
    )?.version ?? null
  );
}

function automaticTransitionContext(
  collection: Pick<Collection, "intentions">,
  trigger: AutomaticTransitionLogContext["trigger"],
  gameId: string,
): AutomaticTransitionLogContext {
  const active = collection.intentions.find(
    (intention) => intention.gameId === gameId && intention.resolution === null,
  );
  return {
    trigger,
    gameId,
    intentionId: active?.intentionId ?? null,
    priorState: active === undefined ? "none" : "active",
    priorVersion: active?.version ?? null,
  };
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
): boolean {
  let acceptedCurrentPlayEvidence = false;
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
  game.entityMetadata = structuredClone(result.entityMetadata);
  const playObservation = result.collectionData?.observation;
  const playSource =
    playObservation?.sourceRequest === "bgg-plays"
      ? ("bgg-plays" as const)
      : ("bgg-collection" as const);
  if (
    playObservation !== undefined &&
    (game.latestPlayCountCheck === null ||
      Date.parse(playObservation.observedAt) > Date.parse(game.latestPlayCountCheck.observedAt))
  ) {
    const playCount = result.collectionData?.numPlays ?? null;
    const replacesCurrentEvidence =
      game.playCountEvidence.observedAt === null ||
      Date.parse(playObservation.observedAt) > Date.parse(game.playCountEvidence.observedAt);
    if (!playObservation.fieldsReturned.includes("numPlays")) {
      game.latestPlayCountCheck = { status: "missing", observedAt: playObservation.observedAt };
      if (game.playCountEvidence.status !== "valid" && replacesCurrentEvidence) {
        game.playCountEvidence = {
          status: "missing",
          source: playSource,
          observedAt: playObservation.observedAt,
        };
        game.numPlays = null;
      }
    } else if (Number.isSafeInteger(playCount) && playCount !== null && playCount >= 0) {
      game.latestPlayCountCheck = {
        status: "valid",
        value: playCount,
        observedAt: playObservation.observedAt,
      };
      if (replacesCurrentEvidence) {
        game.playCountEvidence = {
          status: "valid",
          value: playCount,
          source: playSource,
          observedAt: playObservation.observedAt,
        };
        game.numPlays = playCount;
        acceptedCurrentPlayEvidence = true;
      }
    } else {
      const evidence = { presence: "present" as const, value: playCount ?? null };
      game.latestPlayCountCheck = {
        status: "invalid",
        observedAt: playObservation.observedAt,
        evidence,
      };
      if (game.playCountEvidence.status !== "valid" && replacesCurrentEvidence) {
        game.playCountEvidence = {
          status: "invalid",
          evidence,
          source: playSource,
          observedAt: playObservation.observedAt,
        };
        game.numPlays = null;
      }
    }
  }
  const poll = canonicalSuggestedPlayerPoll(result.suggestedPlayerPoll);
  if (poll !== null && !(retainPollOnRefreshOmission && poll.state === "absent")) {
    game.suggestedPlayerPoll = poll;
  }
  logger.log("applied BGG result", {
    gameId: game.id,
    bggId: game.bggId,
    additionalBggIds: game.additionalBggIds ?? [],
    thingFieldsReturned: result.metadataObservation?.fieldsReturned ?? [],
    thingObservedAt: result.metadataObservation?.observedAt ?? null,
    playerRangeState: result.playerRangeObservation?.state ?? "absent",
    pollState: result.suggestedPlayerPoll?.state ?? "absent",
    collectionFieldsReturned: result.collectionData?.observation?.fieldsReturned ?? [],
    collectionObservedAt: result.collectionData?.observation?.observedAt ?? null,
    collectionState: result.collectionData?.observation?.state ?? "absent",
  });
  return acceptedCurrentPlayEvidence;
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
  const entityMetadata = structuredClone(game.entityMetadata);
  for (const metadata of Object.values(entityMetadata)) metadata.refreshFailure = null;
  return JSON.stringify({
    bggId: game.bggId,
    additionalBggIds: game.additionalBggIds ?? [],
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
    latestPlayCountCheck: game.latestPlayCountCheck,
    durationEvidence: game.durationEvidence,
    playerRangeEvidence: game.playerRangeEvidence,
    suggestedPlayerPoll: game.suggestedPlayerPoll,
    entityMetadata,
  });
}

function recordEntityRefreshFailure(game: Game, attemptedAt: string, message: string): void {
  for (const entityClass of ["mechanic", "designer", "artist"] as const) {
    const metadata = game.entityMetadata[entityClass];
    if (metadata.state === "unrefreshable") continue;
    metadata.refreshFailure = { attemptedAt, message };
  }
}

const acceptedBggSuccessGenerations = new WeakMap<CollectionMutationService, Map<string, number>>();

function successGenerationsFor(
  collectionMutationService: CollectionMutationService,
): Map<string, number> {
  const existing = acceptedBggSuccessGenerations.get(collectionMutationService);
  if (existing !== undefined) return existing;
  const created = new Map<string, number>();
  acceptedBggSuccessGenerations.set(collectionMutationService, created);
  return created;
}

export function createGameService(deps: GameServiceDeps): GameService {
  const { storageService, fitnessService, bggClient } = deps;
  const collectionMutationService =
    deps.collectionMutationService ?? collectionMutationServiceFor(storageService);
  const profileSourceCoordinator = profileSourceCoordinatorFor(storageService);
  const successGenerations = successGenerationsFor(collectionMutationService);
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
        additionalBggIds: [],
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
        manualValues: { playingTime: null, playerCount: null },
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
          const message = toErrorMessage(err);
          recordEntityRefreshFailure(game, now(), message);
          warning = `Game added but BGG data could not be fetched: ${message}`;
        }
      }

      const { value: acceptedGame } = await collectionMutationService.mutate(
        { operation: "game.add", trigger: "owner", gameIds: [game.id] },
        (collection) => {
          if (game.bggId !== null) {
            const bggId = game.bggId;
            const existing = collection.games.find(
              (candidate) =>
                candidate.bggId === bggId || (candidate.additionalBggIds ?? []).includes(bggId),
            );
            if (existing) {
              throw new Error(`A game with BGG ID ${bggId} already exists: "${existing.name}"`);
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
            if (!axisAcceptsScoreOverride(axis)) {
              throw new Error(`${axis.name} accepts native game values, not 1-10 score overrides`);
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

    async setManualValues(id, values) {
      const parsed = ManualGameValuesMutationRequestSchema.parse(values);
      const requestedFields = Object.keys(parsed);
      logger.log("manual game values mutation attempt", { gameId: id, requestedFields });
      const result = await collectionMutationService.mutate(
        { operation: "game.manual-values.set", trigger: "owner", gameIds: [id] },
        (collection) => {
          const game = collection.games.find((candidate) => candidate.id === id);
          if (!game) throw new Error(`Game not found: ${id}`);
          const changed = requestedFields.some((field) => {
            const key = field as keyof typeof parsed;
            return (game.manualValues[key]?.value ?? null) !== parsed[key];
          });
          if (!changed) return { changed: false, value: game };
          const changedAt = now();
          for (const field of ["playingTime", "playerCount"] as const) {
            const value = parsed[field];
            if (value === undefined) continue;
            game.manualValues[field] =
              value === null ? null : { value, source: "manual", confirmedAt: changedAt };
          }
          game.updatedAt = changedAt;
          collection.updatedAt = changedAt;
          return { changed: true, value: game };
        },
      );
      logger.log("manual game values mutation completed", {
        gameId: id,
        requestedFields,
        changed: result.changed,
        outcome: result.outcome,
      });
      return result.value;
    },

    async removeGame(id: string): Promise<void> {
      await profileSourceCoordinator.runExclusive(async () => {
        await collectionMutationService.mutate(
          { operation: "game.remove", trigger: "owner", gameIds: [id] },
          (collection) => {
            const index = collection.games.findIndex((game) => game.id === id);
            if (index === -1) throw new Error(`Game not found: ${id}`);
            const intentionIds = collection.intentions
              .filter((intention) => intention.gameId === id)
              .map((intention) => intention.intentionId);
            if (intentionIds.length > 0) throw new GameHistoryConflictError(id, intentionIds);
            collection.games.splice(index, 1);
            collection.updatedAt = now();
            return { changed: true, value: undefined };
          },
        );
        await deps.onGameDeleted?.(id);
      });
    },

    async setOwnership(id: string, ownership: OwnershipStatus): Promise<OwnershipMutationResult> {
      let transitionContext: AutomaticTransitionLogContext | null = null;
      try {
        const { value } = await collectionMutationService.mutate(
          { operation: "game.ownership.set", trigger: "owner", gameIds: [id] },
          (collection) => {
            const game = collection.games.find((candidate) => candidate.id === id);
            if (!game) throw new Error(`Game not found: ${id}`);
            const clearsManualShelf =
              ownership === "previously-owned" && game.manualShelfId !== null;
            if (game.ownership === ownership && !clearsManualShelf) {
              return {
                changed: false,
                value: { game, linkedIntentionTransition: null },
              };
            }
            const changedAt = now();
            const active = collection.intentions.find(
              (intention) => intention.gameId === id && intention.resolution === null,
            );
            transitionContext = {
              trigger: "ownership-change",
              gameId: id,
              intentionId: active?.intentionId ?? null,
              priorState: active === undefined ? "none" : "active",
              priorVersion: active?.version ?? null,
            };
            logAutomaticTransitionAttempt(logger, transitionContext);
            const linkedIntentionTransition =
              game.ownership === "owned" && ownership === "previously-owned"
                ? retireIntentionForOwnership(collection, id, changedAt)
                : null;
            game.ownership = ownership;
            if (ownership === "previously-owned") game.manualShelfId = null;
            game.updatedAt = changedAt;
            collection.updatedAt = game.updatedAt;
            return {
              changed: true,
              value: { game, linkedIntentionTransition },
            };
          },
        );
        const acceptedTransitionContext = transitionContext as AutomaticTransitionLogContext | null;
        if (acceptedTransitionContext !== null) {
          logAutomaticTransitionOutcome(
            logger,
            acceptedTransitionContext,
            value.linkedIntentionTransition?.resolution?.outcome ?? "unchanged",
            value.linkedIntentionTransition?.version ?? acceptedTransitionContext.priorVersion,
            true,
          );
        }
        return value;
      } catch (error) {
        const failedTransitionContext = transitionContext as AutomaticTransitionLogContext | null;
        if (failedTransitionContext !== null) {
          logAutomaticTransitionOutcome(
            logger,
            failedTransitionContext,
            "mutation-failed",
            failedTransitionContext.priorVersion,
            false,
          );
        }
        throw error;
      }
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

    async setAdditionalBggIds(id: string, bggIds: number[]): Promise<Game> {
      const uniqueIds = new Set(bggIds);
      if (
        uniqueIds.size !== bggIds.length ||
        bggIds.some((bggId) => !Number.isSafeInteger(bggId) || bggId <= 0)
      ) {
        throw new Error("Additional BGG IDs must be unique positive safe integers");
      }
      const { value } = await collectionMutationService.mutate(
        { operation: "game.additional-bgg-ids.set", trigger: "owner", gameIds: [id] },
        (collection) => {
          const game = collection.games.find((candidate) => candidate.id === id);
          if (!game) throw new Error(`Game not found: ${id}`);
          if (game.bggId === null && bggIds.length > 0) {
            throw new Error("Additional BGG IDs require a primary BGG ID");
          }
          if (game.bggId !== null && uniqueIds.has(game.bggId)) {
            throw new Error("Additional BGG IDs cannot include the game's primary BGG ID");
          }
          const conflictingGame = collection.games.find(
            (candidate) =>
              candidate.id !== id &&
              ((candidate.bggId !== null && uniqueIds.has(candidate.bggId)) ||
                (candidate.additionalBggIds ?? []).some((bggId) => uniqueIds.has(bggId))),
          );
          if (conflictingGame) {
            throw new Error(`BGG ID is already associated with "${conflictingGame.name}"`);
          }
          if (
            (game.additionalBggIds ?? []).length === bggIds.length &&
            (game.additionalBggIds ?? []).every((bggId, index) => bggId === bggIds[index])
          ) {
            return { changed: false, value: game };
          }
          game.additionalBggIds = [...bggIds];
          game.updatedAt = now();
          collection.updatedAt = game.updatedAt;
          return { changed: true, value: game };
        },
      );
      return value;
    },

    async refreshBggData(gameId: string): Promise<PlayEvidenceMutationResult> {
      assertBggConfigured();
      const expectedSuccessGeneration = successGenerations.get(gameId) ?? 0;
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

      const expectedBggId = game.bggId;
      const expectedBggState = bggStateIdentity(game);
      let transitionContext: AutomaticTransitionLogContext | null = null;
      let result: BggGameResult;
      try {
        result = await configuredBggClient().getGame(game.bggId);
        if ((game.additionalBggIds ?? []).length > 0) {
          result.collectionData = await configuredBggClient().getPlayCount([
            game.bggId,
            ...(game.additionalBggIds ?? []),
          ]);
        }
      } catch (error) {
        const attemptedAt = now();
        const message = toErrorMessage(error);
        let failureChanged = false;
        try {
          const failureOutcome = await collectionMutationService.mutate(
            { operation: "game.bgg.refresh-failed", trigger: "owner", gameIds: [gameId] },
            (latest) => {
              const context = automaticTransitionContext(latest, "bgg-play-check", gameId);
              transitionContext = context;
              logAutomaticTransitionAttempt(logger, context);
              const acceptedGame = latest.games.find((candidate) => candidate.id === gameId);
              if (!acceptedGame) throw new Error(`Game not found: ${gameId}`);
              if (
                acceptedGame.bggId !== expectedBggId ||
                (successGenerations.get(gameId) ?? 0) !== expectedSuccessGeneration ||
                bggStateIdentity(acceptedGame) !== expectedBggState
              ) {
                return { changed: false, value: { game: acceptedGame, context } };
              }
              recordEntityRefreshFailure(acceptedGame, attemptedAt, message);
              acceptedGame.updatedAt = attemptedAt;
              latest.updatedAt = attemptedAt;
              return { changed: true, value: { game: acceptedGame, context } };
            },
          );
          failureChanged = failureOutcome.changed;
          logAutomaticTransitionOutcome(
            logger,
            failureOutcome.value.context,
            failureChanged ? "evidence-unavailable" : "superseded",
            failureOutcome.value.context.priorVersion,
            failureChanged,
          );
        } catch (persistenceError) {
          const failedContext = transitionContext as AutomaticTransitionLogContext | null;
          if (failedContext !== null)
            logAutomaticTransitionOutcome(
              logger,
              failedContext,
              "mutation-failed",
              failedContext.priorVersion,
              false,
            );
          throw persistenceError;
        }
        throw error;
      }
      try {
        const { value } = await collectionMutationService.mutate(
          { operation: "game.bgg.refresh", trigger: "owner", gameIds: [gameId] },
          (latest) => {
            const context = automaticTransitionContext(latest, "bgg-play-check", gameId);
            transitionContext = context;
            logAutomaticTransitionAttempt(logger, context);
            const acceptedGame = latest.games.find((candidate) => candidate.id === gameId);
            if (!acceptedGame) throw new Error(`Game not found: ${gameId}`);
            if (acceptedGame.bggId !== expectedBggId) {
              throw new Error(`Game BGG identity changed during refresh: ${gameId}`);
            }
            if (
              (successGenerations.get(gameId) ?? 0) !== expectedSuccessGeneration ||
              bggStateIdentity(acceptedGame) !== expectedBggState
            ) {
              throw new Error(`Newer BGG data was accepted during refresh: ${gameId}`);
            }
            const acceptedCurrentPlayEvidence = applyBggResult(acceptedGame, result, logger, true);
            acceptedGame.updatedAt = now();
            const transition = acceptedCurrentPlayEvidence
              ? completeIntentionFromPlayEvidence(latest, acceptedGame, acceptedGame.updatedAt)
              : null;
            latest.updatedAt = acceptedGame.updatedAt;
            return {
              changed: true,
              value: {
                result: {
                  game: structuredClone(acceptedGame),
                  linkedIntentionTransition: transition,
                },
                context,
              },
              onPersistenceSuccess: () => {
                successGenerations.set(gameId, expectedSuccessGeneration + 1);
              },
            };
          },
        );
        logAutomaticTransitionOutcome(
          logger,
          value.context,
          value.result.linkedIntentionTransition?.resolution?.outcome ?? "unchanged",
          value.result.linkedIntentionTransition?.version ?? value.context.priorVersion,
          true,
        );
        return value.result;
      } catch (error) {
        const failedContext = transitionContext as AutomaticTransitionLogContext | null;
        if (failedContext !== null)
          logAutomaticTransitionOutcome(
            logger,
            failedContext,
            "mutation-failed",
            failedContext.priorVersion,
            false,
          );
        throw error;
      }
    },

    async refreshAllBggData(): Promise<RefreshSummary> {
      assertBggConfigured();
      const successGenerationsAtStart = new Map(successGenerations);
      const collection = await storageService.loadCollection();
      const bggGames = collection.games.filter(
        (game): game is Game & { bggId: number } => game.bggId !== null,
      );
      const requestedGames = new Map(
        bggGames.map((game) => [
          game.id,
          {
            bggId: game.bggId,
            state: bggStateIdentity(game),
            successGeneration: successGenerationsAtStart.get(game.id) ?? 0,
            name: game.name,
          },
        ]),
      );

      let refreshed = 0;
      const errors: string[] = [];

      // Batch fetch all BGG IDs
      const bggIds = bggGames.map((game) => game.bggId);
      let bggResults: Map<number, BggGameResult>;
      const batchFailures = new Map<number, string>();
      let batchCallFailure: string | undefined;
      try {
        bggResults = await configuredBggClient().getGames(
          bggIds,
          ({ batchIds, failures, error }) => {
            if (error !== undefined) {
              for (const bggId of batchIds) batchFailures.set(bggId, error);
            }
            for (const [bggId, failure] of failures) batchFailures.set(bggId, failure);
          },
        );
        for (const game of bggGames) {
          if ((game.additionalBggIds ?? []).length === 0) continue;
          const result = bggResults.get(game.bggId);
          if (!result) continue;
          try {
            result.collectionData = await configuredBggClient().getPlayCount([
              game.bggId,
              ...(game.additionalBggIds ?? []),
            ]);
          } catch (error) {
            const message = toErrorMessage(error);
            result.collectionData = undefined;
            errors.push(`Play import failed for "${game.name}": ${message}`);
          }
        }
      } catch (err) {
        const message = toErrorMessage(err);
        batchCallFailure = message;
        bggResults = new Map();
        errors.push(`Batch fetch failed: ${message}`);
        for (const bggId of bggIds) batchFailures.set(bggId, message);
      }

      for (const game of bggGames) {
        if (!bggResults.has(game.bggId) && batchCallFailure === undefined) {
          const failure = batchFailures.get(game.bggId);
          errors.push(
            failure === undefined
              ? `No BGG data returned for "${game.name}" (BGG ID ${game.bggId})`
              : `Batch fetch failed for "${game.name}" (BGG ID ${game.bggId}): ${failure}`,
          );
        }
      }

      if (bggGames.length > 0) {
        const failureVersions = new Map<string, number | null>();
        const actualContexts = new Map<string, AutomaticTransitionLogContext>();
        try {
          const outcome = await collectionMutationService.mutate(
            {
              operation: "game.bgg.refresh-all",
              trigger: "owner",
              gameIds: bggGames.map((game) => game.id),
            },
            (latest) => {
              const changedAt = now();
              let accepted = 0;
              let changed = false;
              const transitionOutcomes = new Map<string, BatchAutomaticTransitionOutcome>();
              const acceptedGenerations: Array<readonly [string, number]> = [];
              for (const [gameId, requested] of requestedGames) {
                const context = automaticTransitionContext(latest, "bgg-play-check-batch", gameId);
                actualContexts.set(gameId, context);
                failureVersions.set(gameId, acceptedIntentionVersion(latest, context));
                logAutomaticTransitionAttempt(logger, context);
                const priorAcceptedVersion = acceptedIntentionVersion(latest, context);
                const game = latest.games.find((candidate) => candidate.id === gameId);
                if (!game) {
                  errors.push(`Game removed during BGG refresh: "${requested.name}"`);
                  transitionOutcomes.set(gameId, {
                    result: "game-removed",
                    version: priorAcceptedVersion,
                    persisted: false,
                  });
                  continue;
                }
                if (
                  game.bggId !== requested.bggId ||
                  (successGenerations.get(gameId) ?? 0) !== requested.successGeneration ||
                  bggStateIdentity(game) !== requested.state
                ) {
                  errors.push(`Newer BGG data was accepted during refresh for "${game.name}"`);
                  transitionOutcomes.set(gameId, {
                    result: "superseded",
                    version: priorAcceptedVersion,
                    persisted: false,
                  });
                  continue;
                }
                const result = bggResults.get(requested.bggId);
                if (!result) {
                  const message =
                    batchFailures.get(requested.bggId) ??
                    `No BGG data returned for "${game.name}" (BGG ID ${requested.bggId})`;
                  recordEntityRefreshFailure(game, changedAt, message);
                  game.updatedAt = changedAt;
                  changed = true;
                  transitionOutcomes.set(gameId, {
                    result: "evidence-unavailable",
                    version: priorAcceptedVersion,
                    persisted: true,
                  });
                  continue;
                }
                const acceptedCurrentPlayEvidence = applyBggResult(game, result, logger, true);
                const transition = acceptedCurrentPlayEvidence
                  ? completeIntentionFromPlayEvidence(latest, game, changedAt)
                  : null;
                transitionOutcomes.set(gameId, {
                  result: transition?.resolution?.outcome ?? "unchanged",
                  version: transition?.version ?? acceptedIntentionVersion(latest, context),
                  persisted: true,
                });
                acceptedGenerations.push([gameId, requested.successGeneration + 1]);
                game.updatedAt = changedAt;
                accepted++;
                changed = true;
              }
              if (!changed) {
                return {
                  changed: false,
                  value: { accepted: 0, transitionOutcomes, transitionContexts: actualContexts },
                };
              }
              latest.updatedAt = changedAt;
              return {
                changed: true,
                value: { accepted, transitionOutcomes, transitionContexts: actualContexts },
                onPersistenceSuccess: () => {
                  for (const [gameId, generation] of acceptedGenerations) {
                    successGenerations.set(gameId, generation);
                  }
                },
              };
            },
          );
          refreshed = outcome.value.accepted;
          for (const [gameId, context] of outcome.value.transitionContexts) {
            const transitionOutcome = outcome.value.transitionOutcomes.get(gameId) ?? {
              result: "unchanged",
              version: context.priorVersion,
              persisted: false,
            };
            logAutomaticTransitionOutcome(
              logger,
              context,
              transitionOutcome.result,
              transitionOutcome.version,
              transitionOutcome.persisted,
            );
          }
        } catch (error) {
          for (const context of actualContexts.values()) {
            logAutomaticTransitionOutcome(
              logger,
              context,
              "mutation-failed",
              failureVersions.get(context.gameId) ?? context.priorVersion,
              false,
            );
          }
          throw error;
        }
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
        collection.games.flatMap((game) => [
          ...(game.bggId === null ? [] : [game.bggId]),
          ...(game.additionalBggIds ?? []),
        ]),
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
              const latestPlayCountCheck =
                collectionData?.observation === undefined
                  ? null
                  : !collectionData.observation.fieldsReturned.includes("numPlays")
                    ? {
                        status: "missing" as const,
                        observedAt: collectionData.observation.observedAt,
                      }
                    : collectionData.numPlays !== null &&
                        Number.isSafeInteger(collectionData.numPlays) &&
                        collectionData.numPlays >= 0
                      ? {
                          status: "valid" as const,
                          value: collectionData.numPlays,
                          observedAt: collectionData.observation.observedAt,
                        }
                      : {
                          status: "invalid" as const,
                          observedAt: collectionData.observation.observedAt,
                          evidence: {
                            presence: "present" as const,
                            value: collectionData.numPlays,
                          },
                        };
              const bestPlayerCount = strictSafeBestPlayerCount(result.bggData.bestPlayerCount);
              const game: Game = {
                id: uuidv4(),
                bggId,
                additionalBggIds: [],
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
                manualValues: { playingTime: null, playerCount: null },
                entityMetadata: structuredClone(result.entityMetadata),
                latestPlayCountCheck,
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
                const provenance = batch.failures.get(id) ?? batch.error;
                logger.warn("BGG import item failed", {
                  bggId: id,
                  name,
                  error: provenance ?? "No BGG data returned",
                });
                errors.push(
                  provenance === undefined
                    ? `Failed to fetch full data for "${name}" (BGG ID ${id})`
                    : `Failed to fetch full data for "${name}" (BGG ID ${id}): ${provenance}`,
                );
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
