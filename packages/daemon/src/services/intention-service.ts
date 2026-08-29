import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  IntentionCommandSchema,
  type AcceptedIntentionMutation,
  type Collection,
  type Game,
  type IntentionCommand,
  type IntentionMutationResult,
  type ManualPlayCorrectionResult,
  type PlayIntention,
  type GameIntentionDetail,
  GameIntentionDetailSchema,
} from "@shelf-judge/shared";
import type { CollectionMutationService } from "./collection-mutation-service.js";
import { createLogger, type Logger } from "./logger.js";

const INVALID_COMMAND_ID = "00000000-0000-0000-0000-000000000000";

export interface IntentionService {
  execute(command: unknown): Promise<IntentionMutationResult>;
  setPlayCount(gameId: string, playCount: number): Promise<ManualPlayCorrectionResult>;
  getGameDetail(gameId: string, gameName: string): Promise<GameIntentionDetail>;
}

export interface IntentionServiceDeps {
  collectionMutationService: CollectionMutationService;
  now?: () => string;
  createId?: () => string;
  logger?: Logger;
}

export interface AutomaticTransitionLogContext {
  trigger: "owner-correction" | "bgg-play-check" | "bgg-play-check-batch" | "ownership-change";
  gameId: string;
  intentionId: string | null;
  priorState: "none" | "active";
  priorVersion: number | null;
}

interface OwnerCommandLogContext {
  intentionId: string | null;
  priorState: "none" | "active" | "resolved";
  priorVersion: number | null;
}

export function logAutomaticTransitionAttempt(
  logger: Logger,
  context: AutomaticTransitionLogContext,
): void {
  logger.log("automatic intention transition attempt", context);
}

export function logAutomaticTransitionOutcome(
  logger: Logger,
  context: AutomaticTransitionLogContext,
  result: string,
  version: number | null,
  persisted: boolean,
): void {
  logger.log("automatic intention transition outcome", {
    ...context,
    result,
    version,
    persisted,
  });
}

export function isPlayEvidenceStale(game: Game): boolean {
  const evidence = game.playCountEvidence;
  const check = game.latestPlayCountCheck;
  return (
    evidence.status === "valid" &&
    check !== null &&
    check.status !== "valid" &&
    (evidence.observedAt === null || Date.parse(check.observedAt) > Date.parse(evidence.observedAt))
  );
}

export function completeIntentionFromPlayEvidence(
  collection: Collection,
  game: Game,
  resolvedAt: string,
): PlayIntention | null {
  const active = collection.intentions.find(
    (intention) => intention.gameId === game.id && intention.resolution === null,
  );
  if (
    active === undefined ||
    game.playCountEvidence.status !== "valid" ||
    game.playCountEvidence.observedAt === null ||
    isPlayEvidenceStale(game) ||
    game.playCountEvidence.value <= active.baseline.playCount ||
    Date.parse(game.playCountEvidence.observedAt) <= Date.parse(active.baseline.observedAt)
  ) {
    return null;
  }
  active.version += 1;
  active.resolution = {
    outcome: "completed",
    source: "observed-play-increase",
    resolvedAt,
  };
  return structuredClone(active);
}

export function retireIntentionForOwnership(
  collection: Collection,
  gameId: string,
  resolvedAt: string,
): PlayIntention | null {
  const active = collection.intentions.find(
    (intention) => intention.gameId === gameId && intention.resolution === null,
  );
  if (active === undefined) return null;
  active.version += 1;
  active.resolution = { outcome: "retired", source: "owner-retired", resolvedAt };
  return structuredClone(active);
}

function commandIdFrom(value: unknown): string {
  if (typeof value !== "object" || value === null || !("commandId" in value)) {
    return INVALID_COMMAND_ID;
  }
  const parsed = z.string().uuid().safeParse(value.commandId);
  return parsed.success ? parsed.data : INVALID_COMMAND_ID;
}

function canonicalCommand(command: IntentionCommand): string {
  if (command.type === "create") {
    return JSON.stringify({
      type: command.type,
      commandId: command.commandId,
      gameId: command.gameId,
      kind: command.kind,
      expectedActiveIntention: command.expectedActiveIntention,
    });
  }
  return JSON.stringify({
    type: command.type,
    commandId: command.commandId,
    gameId: command.gameId,
    intentionId: command.intentionId,
    expectedVersion: command.expectedVersion,
  });
}

export function createIntentionService(deps: IntentionServiceDeps): IntentionService {
  const now = deps.now ?? (() => new Date().toISOString());
  const createId = deps.createId ?? uuidv4;
  const logger = deps.logger ?? createLogger("intention");

  async function getGameDetail(gameId: string, gameName: string): Promise<GameIntentionDetail> {
    const { value } = await deps.collectionMutationService.mutate(
      { operation: "game.intention.detail", trigger: "game-detail-read", gameIds: [gameId] },
      (collection) => {
        const matching = collection.intentions.filter((intention) => intention.gameId === gameId);
        const activeIntention = matching.find(({ resolution }) => resolution === null) ?? null;
        const resolvedHistory = matching
          .filter(
            (
              intention,
            ): intention is PlayIntention & {
              resolution: NonNullable<PlayIntention["resolution"]>;
            } => intention.resolution !== null,
          )
          .map((intention) => ({ ...structuredClone(intention), gameName }))
          .sort(
            (left, right) =>
              Date.parse(right.resolution.resolvedAt) - Date.parse(left.resolution.resolvedAt) ||
              (left.intentionId < right.intentionId
                ? -1
                : left.intentionId > right.intentionId
                  ? 1
                  : 0),
          );
        return {
          changed: false,
          value: GameIntentionDetailSchema.parse({ activeIntention, resolvedHistory }),
        };
      },
    );
    return value;
  }

  async function execute(commandInput: unknown): Promise<IntentionMutationResult> {
    const parsed = IntentionCommandSchema.safeParse(commandInput);
    if (!parsed.success) {
      const commandId = commandIdFrom(commandInput);
      const result: IntentionMutationResult = {
        ok: false,
        commandId,
        error: {
          code: "validation",
          issues: parsed.error.issues.map((issue) => ({
            field: issue.path.join(".") || "request",
            message: issue.message,
          })),
        },
      };
      logger.warn("intention transition rejected", {
        trigger: "owner-command",
        commandId,
        outcome: "validation",
      });
      return result;
    }

    const command = parsed.data;
    const intentionIds = command.type === "create" ? [] : [command.intentionId];
    let commandContext: OwnerCommandLogContext | null = null;
    let replayed = false;

    try {
      const outcome = await deps.collectionMutationService.mutate(
        {
          operation: `game.intention.${command.type}`,
          trigger: "owner-command",
          gameIds: [command.gameId],
          intentionIds,
        },
        (collection) => {
          const existingReceipt = collection.commandReceipts.find(
            (receipt) => receipt.commandId === command.commandId,
          );
          const targetIntention =
            command.type === "create"
              ? existingReceipt === undefined
                ? collection.intentions.find(
                    (candidate) =>
                      candidate.gameId === command.gameId && candidate.resolution === null,
                  )
                : collection.intentions.find(
                    (candidate) =>
                      candidate.gameId === command.gameId &&
                      candidate.intentionId === existingReceipt.result.intention.intentionId,
                  )
              : collection.intentions.find(
                  (candidate) =>
                    candidate.gameId === command.gameId &&
                    candidate.intentionId === command.intentionId,
                );
          commandContext = {
            intentionId: targetIntention?.intentionId ?? null,
            priorState:
              targetIntention === undefined
                ? "none"
                : targetIntention.resolution === null
                  ? "active"
                  : "resolved",
            priorVersion: targetIntention?.version ?? null,
          };
          logger.log("intention transition attempt", {
            trigger: "owner-command",
            commandId: command.commandId,
            commandType: command.type,
            gameId: command.gameId,
            ...commandContext,
          });
          if (existingReceipt !== undefined) {
            const samePayload =
              canonicalCommand(existingReceipt.request) === canonicalCommand(command);
            replayed = samePayload;
            const result: IntentionMutationResult = samePayload
              ? structuredClone(existingReceipt.result)
              : {
                  ok: false,
                  commandId: command.commandId,
                  error: { code: "command-reuse", commandId: command.commandId },
                };
            return { changed: false, value: result };
          }

          const game = collection.games.find((candidate) => candidate.id === command.gameId);
          if (game === undefined) {
            return {
              changed: false,
              value: {
                ok: false,
                commandId: command.commandId,
                error: { code: "game-not-found", gameId: command.gameId },
              } satisfies IntentionMutationResult,
            };
          }

          let intention: PlayIntention;
          if (command.type === "create") {
            const active = collection.intentions.find(
              (candidate) => candidate.gameId === game.id && candidate.resolution === null,
            );
            if (active !== undefined) {
              return {
                changed: false,
                value: {
                  ok: false,
                  commandId: command.commandId,
                  error: {
                    code: "active-intention-conflict",
                    gameId: game.id,
                    current: structuredClone(active),
                  },
                } satisfies IntentionMutationResult,
              };
            }
            const reason =
              game.ownership !== "owned"
                ? "not-owned"
                : game.playCountEvidence.status === "missing"
                  ? "missing-play-evidence"
                  : game.playCountEvidence.status === "invalid"
                    ? "invalid-play-evidence"
                    : game.playCountEvidence.observedAt === null
                      ? "missing-observation-time"
                      : isPlayEvidenceStale(game)
                        ? "stale-play-evidence"
                        : (game.playCountEvidence.value === 0 ? "first-play" : "replay") !==
                            command.kind
                          ? "kind-mismatch"
                          : null;
            if (reason !== null) {
              return {
                changed: false,
                value: {
                  ok: false,
                  commandId: command.commandId,
                  error: { code: "ineligible-game", gameId: game.id, reason },
                } satisfies IntentionMutationResult,
              };
            }
            const evidence = game.playCountEvidence;
            if (evidence.status !== "valid" || evidence.observedAt === null) {
              return {
                changed: false,
                value: {
                  ok: false,
                  commandId: command.commandId,
                  error: {
                    code: "ineligible-game",
                    gameId: game.id,
                    reason:
                      evidence.status === "valid"
                        ? "missing-observation-time"
                        : "invalid-play-evidence",
                  },
                } satisfies IntentionMutationResult,
              };
            }
            const createdAt = now();
            intention = {
              intentionId: createId(),
              gameId: game.id,
              kind: command.kind,
              baseline: {
                playCount: evidence.value,
                evidenceSource: evidence.source,
                observedAt: evidence.observedAt,
              },
              createdAt,
              version: 1,
              resolution: null,
            };
            collection.intentions.push(intention);
            collection.updatedAt = createdAt;
          } else {
            const current = collection.intentions.find(
              (candidate) =>
                candidate.gameId === game.id && candidate.intentionId === command.intentionId,
            );
            if (current === undefined) {
              return {
                changed: false,
                value: {
                  ok: false,
                  commandId: command.commandId,
                  error: {
                    code: "intention-not-found",
                    gameId: game.id,
                    intentionId: command.intentionId,
                  },
                } satisfies IntentionMutationResult,
              };
            }
            if (current.version !== command.expectedVersion || current.resolution !== null) {
              return {
                changed: false,
                value: {
                  ok: false,
                  commandId: command.commandId,
                  error: {
                    code: "stale-version",
                    gameId: game.id,
                    intentionId: current.intentionId,
                    expectedVersion: command.expectedVersion,
                    current: structuredClone(current),
                  },
                } satisfies IntentionMutationResult,
              };
            }
            const resolvedAt = now();
            current.version += 1;
            current.resolution =
              command.type === "complete"
                ? { outcome: "completed", source: "owner-confirmed", resolvedAt }
                : { outcome: "retired", source: "owner-retired", resolvedAt };
            collection.updatedAt = resolvedAt;
            intention = current;
          }

          const result: AcceptedIntentionMutation = {
            ok: true,
            commandId: command.commandId,
            intention: structuredClone(intention),
            linkedOwnershipTransition: null,
          };
          collection.commandReceipts.push({
            commandId: command.commandId,
            request: structuredClone(command),
            result: structuredClone(result),
          });
          return { changed: true, value: result };
        },
      );
      const result = outcome.value;
      const acceptedContext = commandContext as OwnerCommandLogContext | null;
      logger.log("intention transition outcome", {
        trigger: "owner-command",
        commandId: command.commandId,
        commandType: command.type,
        gameId: command.gameId,
        intentionId:
          acceptedContext?.intentionId ??
          (result.ok ? result.intention.intentionId : (intentionIds[0] ?? null)),
        priorState: acceptedContext?.priorState ?? "none",
        priorVersion: acceptedContext?.priorVersion ?? null,
        result: replayed
          ? "replayed"
          : result.ok
            ? (result.intention.resolution?.outcome ?? "active")
            : result.error.code,
        version: result.ok
          ? result.intention.version
          : result.error.code === "active-intention-conflict" ||
              result.error.code === "stale-version"
            ? result.error.current.version
            : (acceptedContext?.priorVersion ?? null),
        persisted: outcome.changed,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedContext = commandContext as OwnerCommandLogContext | null;
      logger.error("intention transition outcome", {
        trigger: "owner-command",
        commandId: command.commandId,
        commandType: command.type,
        gameId: command.gameId,
        intentionId: failedContext?.intentionId ?? intentionIds[0] ?? null,
        priorState: failedContext?.priorState ?? "none",
        priorVersion: failedContext?.priorVersion ?? null,
        result: "persistence-failure",
        version: failedContext?.priorVersion ?? null,
        persisted: false,
      });
      return {
        ok: false,
        commandId: command.commandId,
        error: {
          code: "persistence-failure",
          operation: `game.intention.${command.type}`,
          message,
        },
      };
    }
  }

  async function setPlayCount(
    gameId: string,
    playCount: number,
  ): Promise<ManualPlayCorrectionResult> {
    if (!Number.isSafeInteger(playCount) || playCount < 0) {
      throw new RangeError("Play count must be a nonnegative safe integer");
    }
    logger.log("play evidence mutation attempt", {
      trigger: "owner-correction",
      gameId,
      requestedPlayCount: playCount,
    });
    let transitionContext: AutomaticTransitionLogContext | null = null;
    try {
      const { value } = await deps.collectionMutationService.mutate<ManualPlayCorrectionResult>(
        { operation: "shelf.game.plays.set", trigger: "owner-correction", gameIds: [gameId] },
        (collection) => {
          const game = collection.games.find((candidate) => candidate.id === gameId);
          if (game === undefined) throw new Error(`Game not found: ${gameId}`);
          const active = collection.intentions.find(
            (intention) => intention.gameId === gameId && intention.resolution === null,
          );
          transitionContext = {
            trigger: "owner-correction",
            gameId,
            intentionId: active?.intentionId ?? null,
            priorState: active === undefined ? "none" : "active",
            priorVersion: active?.version ?? null,
          };
          logAutomaticTransitionAttempt(logger, transitionContext);
          const observedAt = now();
          const acceptedTimes = [
            game.updatedAt,
            game.playCountEvidence.observedAt,
            game.latestPlayCountCheck?.observedAt,
          ].filter((value): value is string => value !== null && value !== undefined);
          const latestAcceptedAt = acceptedTimes.reduce((latest, candidate) =>
            Date.parse(candidate) > Date.parse(latest) ? candidate : latest,
          );
          if (Date.parse(observedAt) <= Date.parse(latestAcceptedAt)) {
            return {
              changed: false,
              value: {
                ok: false,
                error: {
                  code: "non-monotonic-observation",
                  gameId,
                  attemptedObservedAt: observedAt,
                  latestAcceptedAt,
                },
              } satisfies ManualPlayCorrectionResult,
            };
          }
          game.numPlays = playCount;
          game.playCountEvidence = {
            status: "valid",
            value: playCount,
            source: "manual",
            observedAt,
          };
          game.updatedAt = observedAt;
          const transition = completeIntentionFromPlayEvidence(collection, game, observedAt);
          collection.updatedAt = observedAt;
          return {
            changed: true,
            value: {
              ok: true,
              game: structuredClone(game),
              linkedIntentionTransition: transition,
            } satisfies ManualPlayCorrectionResult,
          };
        },
      );
      if (!value.ok) {
        const rejectedTransitionContext = transitionContext as AutomaticTransitionLogContext | null;
        if (rejectedTransitionContext !== null) {
          logAutomaticTransitionOutcome(
            logger,
            rejectedTransitionContext,
            value.error.code,
            rejectedTransitionContext.priorVersion,
            false,
          );
        }
        logger.warn("play evidence mutation outcome", {
          trigger: "owner-correction",
          gameId,
          result: value.error.code,
          attemptedObservedAt: value.error.attemptedObservedAt,
          latestAcceptedAt: value.error.latestAcceptedAt,
        });
        return value;
      }
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
      logger.log("play evidence mutation outcome", {
        trigger: "owner-correction",
        gameId,
        result: value.linkedIntentionTransition === null ? "evidence-updated" : "auto-completed",
        intentionId: value.linkedIntentionTransition?.intentionId ?? null,
      });
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
  }

  return { execute, setPlayCount, getGameDetail };
}
