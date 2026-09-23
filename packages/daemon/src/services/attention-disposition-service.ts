import {
  AttentionCommandReceiptSchema,
  AttentionDispositionCommandSchema,
  attentionDispositionRequestFingerprint,
  CollectionSchema,
  type AttentionCommandReceipt,
  type AttentionDisposition,
  type AttentionDispositionCommand,
  type AttentionDispositionCommandResult,
  type Collection,
} from "@shelf-judge/shared";
import { ZodError } from "zod";
import type { CollectionMutationService } from "./collection-mutation-service.js";

const SNOOZE_HOURS = 720;

export interface AttentionDispositionClock {
  now(): Date;
}

/** The minimal selected-winner view needed to prevent commands addressing stale cards. */
export interface CurrentAttentionSelection {
  readonly gameId: string;
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly fingerprint: string;
}

export interface AttentionDispositionMaintenance {
  maintainAfterCollectionCommit(impact: {
    readonly kind: "games";
    readonly gameIds: readonly string[];
  }): Promise<{ readonly state: "available" | "unavailable" }>;
}

export interface AttentionDispositionServiceDependencies {
  readonly collectionMutations: CollectionMutationService;
  readonly clock: AttentionDispositionClock;
  /** Must evaluate current source state, not read a stale public Profile card. */
  readonly currentSelection: (
    collection: Collection,
    gameId: string,
  ) => Promise<CurrentAttentionSelection | null>;
  readonly maintenance: AttentionDispositionMaintenance;
}

class CommandRejection extends Error {
  constructor(
    readonly result: Extract<AttentionDispositionCommandResult, { outcome: "rejected" }>,
  ) {
    super(result.error.code);
  }
}

function rejection(
  error: Extract<AttentionDispositionCommandResult, { outcome: "rejected" }>["error"],
): never {
  throw new CommandRejection({ outcome: "rejected", error });
}

function sameRequest(
  receipt: AttentionCommandReceipt,
  command: AttentionDispositionCommand,
): boolean {
  return receipt.requestFingerprint === requestFingerprint(command);
}

/**
 * The receipt hashes every command field other than its id. This makes a UUID
 * a durable idempotency key for one semantic request, rather than merely for
 * one selected-rule fingerprint.
 */
function requestFingerprint(command: AttentionDispositionCommand): string {
  return attentionDispositionRequestFingerprint(command);
}

function currentDispositionVersion(collection: Collection, gameId: string): number {
  const active =
    collection.attentionDispositions.find((item) => item.gameId === gameId)?.version ?? 0;
  const historical = collection.commandReceipts.reduce((highest, receipt) => {
    if (
      "receiptType" in receipt &&
      receipt.receiptType === "attention-disposition" &&
      receipt.gameId === gameId
    ) {
      return Math.max(highest, receipt.accepted.version);
    }
    return highest;
  }, 0);
  return Math.max(active, historical);
}

function selectionMatches(
  command: AttentionDispositionCommand,
  selected: CurrentAttentionSelection | null,
): boolean {
  return (
    selected !== null &&
    selected.gameId === command.gameId &&
    selected.ruleId === command.ruleId &&
    selected.ruleVersion === command.ruleVersion &&
    selected.fingerprint === command.fingerprint
  );
}

function acceptedDisposition(
  command: AttentionDispositionCommand,
  now: Date,
): AttentionDisposition {
  const version = command.expectedVersion + 1;
  if (command.operation === "intentional") {
    return {
      gameId: command.gameId,
      kind: "intentional",
      ruleId: command.ruleId,
      ruleVersion: command.ruleVersion,
      fingerprint: command.fingerprint,
      version,
    };
  }
  const responseAt = now.toISOString();
  return {
    gameId: command.gameId,
    kind: "snoozed",
    ruleId: command.ruleId,
    ruleVersion: command.ruleVersion,
    fingerprint: command.fingerprint,
    responseAt,
    expiresAt: new Date(now.getTime() + SNOOZE_HOURS * 60 * 60 * 1000).toISOString(),
    version,
  };
}

export class AttentionDispositionService {
  constructor(private readonly dependencies: AttentionDispositionServiceDependencies) {}

  async execute(input: unknown): Promise<AttentionDispositionCommandResult> {
    const parsed = AttentionDispositionCommandSchema.safeParse(input);
    if (!parsed.success) return { outcome: "rejected", error: { code: "validation" } };
    const command = parsed.data;
    let attentionUnavailable = false;
    try {
      const outcome = await this.dependencies.collectionMutations.mutate<
        | { readonly accepted: AttentionCommandReceipt; readonly replayed?: never }
        | { readonly replayed: AttentionCommandReceipt; readonly accepted?: never }
      >(
        {
          operation: "attention-disposition",
          trigger: `attention:${command.operation}`,
          gameIds: [command.gameId],
        },
        async (collection) => {
          const prior = collection.commandReceipts.find(
            (receipt) => receipt.commandId === command.commandId,
          );
          if (prior !== undefined) {
            if (
              "receiptType" in prior &&
              prior.receiptType === "attention-disposition" &&
              sameRequest(prior, command)
            ) {
              return { changed: false, value: { replayed: prior } };
            }
            return rejection({ code: "command-reuse", commandId: command.commandId });
          }
          const game = collection.games.find((candidate) => candidate.id === command.gameId);
          if (game === undefined)
            return rejection({ code: "game-not-found", gameId: command.gameId });
          if (game.ownership !== "owned")
            return rejection({ code: "ineligible-game", gameId: command.gameId });
          if (currentDispositionVersion(collection, command.gameId) !== command.expectedVersion) {
            return rejection({
              code: "stale-version",
              gameId: command.gameId,
              expectedVersion: command.expectedVersion,
            });
          }
          const selected = await this.dependencies.currentSelection(collection, command.gameId);
          if (!selectionMatches(command, selected))
            return rejection({ code: "candidate-mismatch", gameId: command.gameId });
          const accepted = acceptedDisposition(command, this.dependencies.clock.now());
          const receipt = AttentionCommandReceiptSchema.parse({
            receiptType: "attention-disposition",
            commandId: command.commandId,
            operation: command.operation,
            gameId: command.gameId,
            ruleId: command.ruleId,
            ruleVersion: command.ruleVersion,
            expectedVersion: command.expectedVersion,
            requestFingerprint: requestFingerprint(command),
            requestPayload: command,
            accepted,
          });
          collection.attentionDispositions = [
            ...collection.attentionDispositions.filter((item) => item.gameId !== command.gameId),
            accepted,
          ];
          collection.commandReceipts = [...collection.commandReceipts, receipt];
          CollectionSchema.parse(collection);
          return {
            changed: true,
            value: { accepted: receipt },
            classifyPersistenceOutcome: true,
            onPersistenceSuccess: async () => {
              try {
                const maintenance =
                  await this.dependencies.maintenance.maintainAfterCollectionCommit({
                    kind: "games",
                    gameIds: [command.gameId],
                  });
                attentionUnavailable = maintenance.state === "unavailable";
              } catch {
                attentionUnavailable = true;
              }
            },
          };
        },
      );
      if (outcome.value.replayed !== undefined) {
        return { outcome: "replayed", receipt: outcome.value.replayed };
      }
      const receipt = outcome.value.accepted;
      return attentionUnavailable
        ? { outcome: "accepted", receipt, attentionUnavailable: true }
        : { outcome: "accepted", receipt };
    } catch (error) {
      if (error instanceof CommandRejection) return error.result;
      if (error instanceof ZodError) return { outcome: "rejected", error: { code: "validation" } };
      return { outcome: "rejected", error: { code: "persistence-failure" } };
    }
  }
}

export function createAttentionDispositionService(
  dependencies: AttentionDispositionServiceDependencies,
): AttentionDispositionService {
  return new AttentionDispositionService(dependencies);
}
