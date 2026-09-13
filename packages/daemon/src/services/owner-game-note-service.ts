import { createHash } from "node:crypto";
import { z } from "zod";
import {
  canonicalizeOwnerGameNoteRequest,
  NotFoundError,
  OwnerGameNoteClearRequestSchema,
  OwnerGameNoteSetRequestSchema,
  type OwnerGameNoteAcceptedMetadata,
  type OwnerGameNoteCommandReceipt,
  type OwnerGameNoteMutationResult,
  type OwnerGameNoteOperation,
  type OwnerGameNoteReadResult,
  type OwnerGameNoteSetRequest,
  type CommandReceipt,
} from "@shelf-judge/shared";
import {
  collectionDurableIdentity,
  type CollectionDurableIdentity,
  type CollectionMutationService,
} from "./collection-mutation-service.js";
import { createLogger, type Logger } from "./logger.js";

const INVALID_COMMAND_ID = "00000000-0000-0000-0000-000000000000";
const GameIdSchema = z.string().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

type StoredAcceptedMetadata = Omit<OwnerGameNoteAcceptedMetadata, "replayed">;

export interface OwnerGameNoteInvalidationContext {
  operation: OwnerGameNoteOperation;
  trigger: "owner-command";
  commandId: string;
  gameId: string;
  expectedVersion: number;
  priorVersion: number;
  resultingVersion: number;
  alreadyClear: boolean;
  priorCollectionRevision: number;
  resultingCollectionRevision: number;
  priorSourceIdentity: CollectionDurableIdentity;
  targetSourceIdentity: CollectionDurableIdentity;
}

export interface OwnerGameNoteInvalidationLifecycle {
  beforePersistence(context: OwnerGameNoteInvalidationContext): Promise<void> | void;
  onPersistenceFailure(
    context: OwnerGameNoteInvalidationContext,
    error: unknown,
  ): Promise<void> | void;
  onPersistenceSuccess?(context: OwnerGameNoteInvalidationContext): Promise<void> | void;
}

export interface OwnerGameNoteService {
  get(gameId: unknown): Promise<OwnerGameNoteReadResult>;
  set(gameId: unknown, request: unknown): Promise<OwnerGameNoteMutationResult>;
  clear(gameId: unknown, request: unknown): Promise<OwnerGameNoteMutationResult>;
}

export interface OwnerGameNoteServiceDeps {
  collectionMutationService: CollectionMutationService;
  now?: () => string;
  logger?: Logger;
  hashExactString?: (value: string) => string;
  invalidationLifecycle?: OwnerGameNoteInvalidationLifecycle;
}

function commandIdFrom(value: unknown): string {
  if (typeof value !== "object" || value === null || !("commandId" in value)) {
    return INVALID_COMMAND_ID;
  }
  const parsed = z.string().uuid().safeParse(value.commandId);
  return parsed.success ? parsed.data : INVALID_COMMAND_ID;
}

function safeLogString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function safeExpectedVersion(value: unknown): number | null {
  if (typeof value !== "object" || value === null || !("expectedVersion" in value)) return null;
  return typeof value.expectedVersion === "number" ? value.expectedVersion : null;
}

function validationResult(
  commandId: string,
  issues: readonly z.ZodIssue[],
): OwnerGameNoteMutationResult {
  return {
    ok: false,
    commandId,
    error: {
      code: "validation",
      issues: issues.map((issue) => ({
        field: issue.path.join(".") || "request",
        message: issue.message,
      })),
    },
  };
}

function isNoteReceipt(receipt: CommandReceipt): receipt is OwnerGameNoteCommandReceipt {
  return "receiptType" in receipt && receipt.receiptType === "owner-game-note";
}

function exactSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createOwnerGameNoteService(deps: OwnerGameNoteServiceDeps): OwnerGameNoteService {
  const now = deps.now ?? (() => new Date().toISOString());
  const logger = deps.logger ?? createLogger("owner-game-note");
  const hashExactString = deps.hashExactString ?? exactSha256;
  const lifecycle = deps.invalidationLifecycle;

  async function get(gameIdInput: unknown): Promise<OwnerGameNoteReadResult> {
    const fields = {
      operation: "get",
      trigger: "owner-read",
      gameId: safeLogString(gameIdInput),
    };
    logger.log("owner game note attempt", fields);
    const gameIdResult = GameIdSchema.safeParse(gameIdInput);
    if (!gameIdResult.success) {
      logger.warn("owner game note outcome", {
        ...fields,
        result: "validation",
        collectionRevision: null,
        persisted: false,
      });
      throw gameIdResult.error;
    }
    const gameId = gameIdResult.data;
    try {
      const { value, collection } = await deps.collectionMutationService.mutate(
        { operation: "shelf.game.note.get", trigger: "owner-read", gameIds: [gameId] },
        (candidate) => {
          const game = candidate.games.find(({ id }) => id === gameId);
          if (game === undefined) throw new NotFoundError(`Game not found: ${gameId}`);
          return {
            changed: false,
            value: { gameId, note: structuredClone(game.ownerNote) },
          };
        },
      );
      logger.log("owner game note outcome", {
        ...fields,
        result: "read",
        resultingVersion: value.note.version,
        collectionRevision: collection.revision,
        persisted: false,
      });
      return structuredClone(value);
    } catch (error) {
      logger.error("owner game note outcome", {
        ...fields,
        result: error instanceof NotFoundError ? "game-not-found" : "read-failure",
        persisted: false,
      });
      throw error;
    }
  }

  async function mutate(
    operation: OwnerGameNoteOperation,
    gameIdInput: unknown,
    requestInput: unknown,
  ): Promise<OwnerGameNoteMutationResult> {
    const commandId = commandIdFrom(requestInput);
    const attemptFields = {
      operation,
      trigger: "owner-command",
      commandId,
      gameId: safeLogString(gameIdInput),
      expectedVersion: safeExpectedVersion(requestInput),
    };
    logger.log("owner game note attempt", attemptFields);

    const gameIdResult = GameIdSchema.safeParse(gameIdInput);
    const requestResult =
      operation === "set"
        ? OwnerGameNoteSetRequestSchema.safeParse(requestInput)
        : OwnerGameNoteClearRequestSchema.safeParse(requestInput);
    if (!gameIdResult.success || !requestResult.success) {
      const issues = [
        ...(gameIdResult.success
          ? []
          : gameIdResult.error.issues.map((issue) => ({
              ...issue,
              path: ["gameId", ...issue.path],
            }))),
        ...(requestResult.success ? [] : requestResult.error.issues),
      ];
      const result = validationResult(commandId, issues);
      logger.warn("owner game note outcome", {
        ...attemptFields,
        result: "validation",
        persisted: false,
      });
      return result;
    }

    const gameId = gameIdResult.data;
    const request = requestResult.data;
    const canonical = canonicalizeOwnerGameNoteRequest(
      operation === "set"
        ? { operation, gameId, ...(request as OwnerGameNoteSetRequest) }
        : { operation, gameId, ...request },
    );
    let fingerprint: string;
    try {
      fingerprint = Sha256Schema.parse(hashExactString(canonical));
    } catch {
      logger.error("owner game note outcome", {
        ...attemptFields,
        result: "persistence-failure",
        persisted: false,
      });
      return {
        ok: false,
        commandId: request.commandId,
        error: {
          code: "persistence-failure",
          operation: `shelf.game.note.${operation}`,
          message: "Owner game note request fingerprinting failed",
        },
      };
    }

    let priorVersion: number | null = null;
    let resultingVersion: number | null = null;
    let replayed = false;
    let alreadyClear = false;
    try {
      const outcome = await deps.collectionMutationService.mutate<OwnerGameNoteMutationResult>(
        {
          operation: `shelf.game.note.${operation}`,
          trigger: "owner-command",
          gameIds: [gameId],
        },
        (collection) => {
          const existing = collection.commandReceipts.find(
            (receipt) => receipt.commandId === request.commandId,
          );
          if (existing !== undefined) {
            if (
              !isNoteReceipt(existing) ||
              existing.operation !== operation ||
              existing.gameId !== gameId ||
              existing.expectedVersion !== request.expectedVersion ||
              existing.requestFingerprint !== fingerprint
            ) {
              return {
                changed: false,
                value: {
                  ok: false,
                  commandId: request.commandId,
                  error: { code: "command-reuse", commandId: request.commandId },
                } satisfies OwnerGameNoteMutationResult,
              };
            }
            replayed = true;
            priorVersion = existing.expectedVersion;
            resultingVersion = existing.accepted.version;
            alreadyClear = existing.accepted.alreadyClear;
            return {
              changed: false,
              value: {
                ok: true,
                accepted: { ...structuredClone(existing.accepted), replayed: true },
              } satisfies OwnerGameNoteMutationResult,
            };
          }

          const game = collection.games.find(({ id }) => id === gameId);
          if (game === undefined) {
            return {
              changed: false,
              value: {
                ok: false,
                commandId: request.commandId,
                error: { code: "game-not-found", gameId },
              } satisfies OwnerGameNoteMutationResult,
            };
          }
          const priorSourceIdentity = collectionDurableIdentity(collection);
          priorVersion = game.ownerNote.version;
          if (game.ownerNote.version !== request.expectedVersion) {
            return {
              changed: false,
              value: {
                ok: false,
                commandId: request.commandId,
                error: {
                  code: "stale-version",
                  gameId,
                  expectedVersion: request.expectedVersion,
                  current: structuredClone(game.ownerNote),
                },
              } satisfies OwnerGameNoteMutationResult,
            };
          }
          if (collection.revision >= Number.MAX_SAFE_INTEGER) {
            return {
              changed: false,
              value: {
                ok: false,
                commandId: request.commandId,
                error: { code: "version-overflow", target: "collection" },
              } satisfies OwnerGameNoteMutationResult,
            };
          }

          alreadyClear = operation === "clear" && game.ownerNote.state !== "present";
          if (!alreadyClear && game.ownerNote.version >= Number.MAX_SAFE_INTEGER) {
            return {
              changed: false,
              value: {
                ok: false,
                commandId: request.commandId,
                error: { code: "version-overflow", target: "note" },
              } satisfies OwnerGameNoteMutationResult,
            };
          }

          const acceptedAt = now();
          const priorCollectionRevision = collection.revision;
          const acceptedCollectionRevision = priorCollectionRevision + 1;
          if (!alreadyClear) {
            const nextVersion = game.ownerNote.version + 1;
            game.ownerNote =
              operation === "set"
                ? {
                    state: "present",
                    version: nextVersion,
                    updatedAt: acceptedAt,
                    text: (request as OwnerGameNoteSetRequest).text,
                  }
                : { state: "cleared", version: nextVersion, updatedAt: acceptedAt };
            game.updatedAt = acceptedAt;
          }
          collection.updatedAt = acceptedAt;
          resultingVersion = game.ownerNote.version;
          const accepted: StoredAcceptedMetadata = {
            commandId: request.commandId,
            gameId,
            operation,
            state: game.ownerNote.state,
            version: game.ownerNote.version,
            updatedAt: game.ownerNote.updatedAt,
            collectionRevision: acceptedCollectionRevision,
            alreadyClear,
          };
          collection.commandReceipts.push({
            receiptType: "owner-game-note",
            commandId: request.commandId,
            operation,
            gameId,
            expectedVersion: request.expectedVersion,
            requestFingerprint: fingerprint,
            accepted: structuredClone(accepted),
          });
          const lifecycleContext: OwnerGameNoteInvalidationContext = {
            operation,
            trigger: "owner-command",
            commandId: request.commandId,
            gameId,
            expectedVersion: request.expectedVersion,
            priorVersion: request.expectedVersion,
            resultingVersion: game.ownerNote.version,
            alreadyClear,
            priorCollectionRevision,
            resultingCollectionRevision: acceptedCollectionRevision,
            priorSourceIdentity,
            targetSourceIdentity: collectionDurableIdentity({
              ...collection,
              revision: acceptedCollectionRevision,
            }),
          };
          let invalidationAttempted = false;
          return {
            changed: true,
            value: {
              ok: true,
              accepted: { ...structuredClone(accepted), replayed: false },
            } satisfies OwnerGameNoteMutationResult,
            beforePersistence: lifecycle
              ? () => {
                  invalidationAttempted = true;
                  return lifecycle.beforePersistence(lifecycleContext);
                }
              : undefined,
            onPersistenceFailure: lifecycle
              ? (error: unknown) =>
                  invalidationAttempted
                    ? lifecycle.onPersistenceFailure(lifecycleContext, error)
                    : undefined
              : undefined,
            onPersistenceSuccess: lifecycle?.onPersistenceSuccess
              ? () => lifecycle.onPersistenceSuccess?.(lifecycleContext)
              : undefined,
            classifyPersistenceOutcome: lifecycle !== undefined,
          };
        },
      );
      const result = outcome.value;
      const resultVersion = result.ok
        ? result.accepted.version
        : result.error.code === "stale-version"
          ? result.error.current.version
          : priorVersion;
      logger.log("owner game note outcome", {
        operation,
        trigger: "owner-command",
        commandId: request.commandId,
        gameId,
        expectedVersion: request.expectedVersion,
        priorVersion,
        resultingVersion: resultVersion,
        replayed,
        alreadyClear,
        collectionRevision: result.ok
          ? result.accepted.collectionRevision
          : outcome.collection.revision,
        result: result.ok ? "accepted" : result.error.code,
        persisted: outcome.changed,
      });
      return result;
    } catch {
      logger.error("owner game note outcome", {
        operation,
        trigger: "owner-command",
        commandId: request.commandId,
        gameId,
        expectedVersion: request.expectedVersion,
        priorVersion,
        resultingVersion,
        replayed: false,
        alreadyClear,
        collectionRevision: null,
        result: "persistence-failure",
        persisted: false,
      });
      return {
        ok: false,
        commandId: request.commandId,
        error: {
          code: "persistence-failure",
          operation: `shelf.game.note.${operation}`,
          message: "Owner game note mutation failed",
        },
      };
    }
  }

  return {
    get,
    set: (gameId, request) => mutate("set", gameId, request),
    clear: (gameId, request) => mutate("clear", gameId, request),
  };
}
