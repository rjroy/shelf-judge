import * as path from "node:path";
import { z } from "zod";
import {
  REFLECTION_QUESTION_IDS,
  type ReflectionDependency,
  type ReflectionQuestionId,
} from "@shelf-judge/shared";
import { atomicWrite, type FileOps, type TemporaryPathForAttempt } from "./file-ops.js";
import { createLogger, type Logger } from "./logger.js";
import type { ProfileSourceCoordinator } from "./profile-source-coordinator.js";
import { collectionDurableIdentity } from "./collection-mutation-service.js";
import type { ReflectionDurableState, ReflectionStorage } from "./reflection-storage.js";
import type { CollectionReader } from "./storage-service.js";
import type { OwnerGameNoteInvalidationLifecycle } from "./owner-game-note-service.js";
import type { PermanentGameDeletionLifecycle } from "./game-service.js";

export const REFLECTION_TRANSACTION_FILE = "profile-reflection-transaction.json";
export const REFLECTION_RECOVERY_FILE = "profile-reflection-recovery.json";
const TRANSACTION_VERSION = 1 as const;
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const ReflectionCollectionIdentitySchema = z
  .object({
    collectionId: z.string().min(1),
    schemaVersion: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    contentHash: Sha256Schema,
  })
  .strict();

export type ReflectionCollectionIdentity = z.infer<typeof ReflectionCollectionIdentitySchema>;

export const ReflectionTransactionJournalSchema = z
  .object({
    version: z.literal(TRANSACTION_VERSION),
    kind: z.enum(["source-purge", "settings"]),
    transactionId: z.string().uuid(),
    priorSourceIdentity: ReflectionCollectionIdentitySchema,
    targetSourceIdentity: ReflectionCollectionIdentitySchema,
    affectedGameIds: z.array(z.string().min(1)),
    affectedQuestionIds: z.array(z.enum(REFLECTION_QUESTION_IDS)),
    priorActiveArtifactIdentity: Sha256Schema,
    stagedTarget: z.object({ fileName: z.string().min(1), identity: Sha256Schema }).strict(),
    priorSettingsArtifactIdentity: Sha256Schema.nullable(),
    stagedSettingsTarget: z
      .object({ fileName: z.string().min(1), identity: Sha256Schema })
      .strict()
      .nullable(),
  })
  .strict();

export type ReflectionTransactionJournal = z.infer<typeof ReflectionTransactionJournalSchema>;

export interface ReflectionPurgeMutationContext {
  priorSourceIdentity: ReflectionCollectionIdentity;
  targetSourceIdentity: ReflectionCollectionIdentity;
  affectedGameIds: readonly string[];
  reason: "note-changed" | "game-deleted";
}

export interface ReflectionTransactionService {
  recover(): Promise<void>;
  beforeSourcePersistence(context: ReflectionPurgeMutationContext): Promise<void>;
  onSourcePersistenceFailure(): Promise<void>;
  onSourcePersistenceSuccess(): Promise<void>;
  publishSettingsChange(questionId: ReflectionQuestionId, enabled: boolean): Promise<void>;
}

export interface ReflectionTransactionServiceDeps {
  dataDir: string;
  fileOps: FileOps;
  storage: ReflectionStorage;
  collectionReader: CollectionReader;
  coordinator: ProfileSourceCoordinator;
  logger?: Logger;
  createTransactionId?: () => string;
  createGeneration?: () => string;
  now?: () => string;
  temporaryPathForAttempt?: TemporaryPathForAttempt;
  validateAfterRecovery?: () => Promise<void>;
}

function sameIdentity(
  left: ReflectionCollectionIdentity,
  right: ReflectionCollectionIdentity,
): boolean {
  return left.contentHash === right.contentHash;
}

function dependencyIncludesGame(dependency: ReflectionDependency, gameId: string): boolean {
  return dependency.category === "note"
    ? dependency.gameId === gameId
    : dependency.sourceId === gameId || dependency.sourceId.startsWith(`game:${gameId}:`);
}

export function createReflectionTransactionService(
  deps: ReflectionTransactionServiceDeps,
): ReflectionTransactionService {
  const journalPath = path.join(deps.dataDir, REFLECTION_TRANSACTION_FILE);
  const recoveryPath = path.join(deps.dataDir, REFLECTION_RECOVERY_FILE);
  const logger = deps.logger ?? createLogger("reflection-transaction");
  const createTransactionId = deps.createTransactionId ?? (() => crypto.randomUUID());
  const createGeneration = deps.createGeneration ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => new Date().toISOString());

  async function loadJournal(): Promise<ReflectionTransactionJournal | null> {
    if (!(await deps.fileOps.exists(journalPath))) return null;
    return ReflectionTransactionJournalSchema.parse(
      JSON.parse(await deps.fileOps.readFile(journalPath)),
    );
  }

  async function publishJournal(journal: ReflectionTransactionJournal): Promise<void> {
    await atomicWrite(
      journalPath,
      JSON.stringify(journal, null, 2),
      deps.fileOps,
      deps.temporaryPathForAttempt,
    );
  }

  async function cleanup(journal: ReflectionTransactionJournal): Promise<void> {
    await deps.storage.removeStagedState(journal.stagedTarget);
    if (journal.stagedSettingsTarget !== null) {
      await deps.storage.removeStagedSettings(journal.stagedSettingsTarget);
    }
    await deps.fileOps.unlink(journalPath);
    await deps.storage.removeOrphanStages();
  }

  async function failClosed(code: string): Promise<void> {
    await deps.storage.resetState();
    await deps.storage.removeOrphanStages();
    await deps.fileOps.unlink(journalPath);
    await atomicWrite(
      recoveryPath,
      JSON.stringify({ version: 1, code, recoveredAt: now() }),
      deps.fileOps,
      deps.temporaryPathForAttempt,
    );
    logger.warn("reflection transaction recovery failed closed", { code });
  }

  async function recoverTransactionWithinCoordinator(): Promise<void> {
    let journal: ReflectionTransactionJournal | null;
    try {
      journal = await loadJournal();
    } catch {
      await failClosed("invalid-journal");
      return;
    }
    if (journal === null) {
      await deps.storage.removeOrphanStages();
      return;
    }

    if (journal.kind === "settings") {
      const stagedState = await deps.storage.loadStagedState(journal.stagedTarget);
      const activeState = await deps.storage.loadState();
      if (stagedState !== null) {
        await deps.storage.promoteStagedState(journal.stagedTarget);
      } else if (deps.storage.stateIdentity(activeState) !== journal.stagedTarget.identity) {
        await failClosed("settings-state-mismatch");
        return;
      }
      if (journal.stagedSettingsTarget === null) {
        await failClosed("settings-stage-missing");
        return;
      }
      const stagedSettings = await deps.storage.loadStagedSettings(journal.stagedSettingsTarget);
      const activeSettings = await deps.storage.loadSettings();
      if (stagedSettings !== null) {
        await deps.storage.promoteStagedSettings(journal.stagedSettingsTarget);
      } else if (
        deps.storage.settingsIdentity(activeSettings) !== journal.stagedSettingsTarget.identity
      ) {
        await failClosed("settings-artifact-mismatch");
        return;
      }
      await cleanup(journal);
      return;
    }

    let source: ReflectionCollectionIdentity;
    try {
      source = collectionDurableIdentity(await deps.collectionReader.loadCollection());
    } catch {
      await failClosed("unknown-source");
      return;
    }
    const active = await deps.storage.loadState();
    const activeIdentity = deps.storage.stateIdentity(active);
    const staged = await deps.storage.loadStagedState(journal.stagedTarget);
    if (
      sameIdentity(source, journal.priorSourceIdentity) &&
      activeIdentity === journal.priorActiveArtifactIdentity &&
      staged !== null
    ) {
      await cleanup(journal);
      return;
    }
    if (sameIdentity(source, journal.targetSourceIdentity)) {
      if (staged !== null) {
        await deps.storage.promoteStagedState(journal.stagedTarget);
        await cleanup(journal);
        return;
      }
      if (activeIdentity === journal.stagedTarget.identity) {
        await deps.fileOps.unlink(journalPath);
        await deps.storage.removeOrphanStages();
        return;
      }
    }
    await failClosed("identity-mismatch");
  }

  async function recoverWithinCoordinator(): Promise<void> {
    await recoverTransactionWithinCoordinator();
    try {
      await deps.validateAfterRecovery?.();
    } catch {
      await failClosed("startup-validation-failed");
    }
  }

  async function settlePersistenceFailure(): Promise<void> {
    let journal: ReflectionTransactionJournal | null;
    try {
      journal = await loadJournal();
    } catch {
      return;
    }
    if (journal === null) return;
    let source: ReflectionCollectionIdentity;
    try {
      source = collectionDurableIdentity(await deps.collectionReader.loadCollection());
    } catch {
      logger.warn("reflection transaction source outcome remains unknown", {
        transactionId: journal.transactionId,
      });
      return;
    }
    const activeIdentity = deps.storage.stateIdentity(await deps.storage.loadState());
    if (
      sameIdentity(source, journal.priorSourceIdentity) &&
      activeIdentity === journal.priorActiveArtifactIdentity &&
      (await deps.storage.loadStagedState(journal.stagedTarget)) !== null
    ) {
      await cleanup(journal);
      return;
    }
    if (sameIdentity(source, journal.targetSourceIdentity)) {
      const staged = await deps.storage.loadStagedState(journal.stagedTarget);
      if (staged !== null) {
        await deps.storage.promoteStagedState(journal.stagedTarget);
        await cleanup(journal);
      } else if (activeIdentity === journal.stagedTarget.identity) {
        await deps.fileOps.unlink(journalPath);
        await deps.storage.removeOrphanStages();
      }
      return;
    }
    logger.warn("reflection transaction source outcome remains unknown", {
      transactionId: journal.transactionId,
    });
  }

  return {
    recover(): Promise<void> {
      return deps.coordinator.runExclusive(recoverWithinCoordinator);
    },

    beforeSourcePersistence(context): Promise<void> {
      return deps.coordinator.runExclusive(async () => {
        await recoverWithinCoordinator();
        const prior = await deps.storage.loadState();
        const affectedGames = new Set(context.affectedGameIds);
        const affectedQuestionIds = prior.questions
          .filter(
            (question) =>
              question.cache !== null &&
              question.cache.dependencies.some((dependency) =>
                [...affectedGames].some((gameId) => dependencyIncludesGame(dependency, gameId)),
              ),
          )
          .map(({ questionId }) => questionId);
        const selected = new Set<ReflectionQuestionId>(affectedQuestionIds);
        const target: ReflectionDurableState = {
          ...prior,
          deletionGeneration: createGeneration(),
          questions: prior.questions.map((question) =>
            selected.has(question.questionId)
              ? {
                  ...question,
                  cache: null,
                  attempt: { state: "purged", reason: context.reason, occurredAt: now() },
                }
              : question.attempt.state === "refreshing"
                ? {
                    ...question,
                    attempt: {
                      state: "unavailable",
                      reason: "internal",
                      safeDetail: "source-mutated",
                      occurredAt: now(),
                    },
                  }
                : question,
          ) as ReflectionDurableState["questions"],
        };
        const transactionId = createTransactionId();
        const stagedTarget = await deps.storage.stageState(transactionId, target);
        const journal = ReflectionTransactionJournalSchema.parse({
          version: TRANSACTION_VERSION,
          kind: "source-purge",
          transactionId,
          priorSourceIdentity: context.priorSourceIdentity,
          targetSourceIdentity: context.targetSourceIdentity,
          affectedGameIds: [...affectedGames].sort(),
          affectedQuestionIds,
          priorActiveArtifactIdentity: deps.storage.stateIdentity(prior),
          stagedTarget,
          priorSettingsArtifactIdentity: null,
          stagedSettingsTarget: null,
        });
        await publishJournal(journal);
      });
    },

    onSourcePersistenceFailure(): Promise<void> {
      return deps.coordinator.runExclusive(settlePersistenceFailure);
    },

    onSourcePersistenceSuccess(): Promise<void> {
      return deps.coordinator.runExclusive(async () => {
        const journal = await loadJournal();
        if (journal === null) throw new Error("Reflection transaction journal is missing");
        const staged = await deps.storage.loadStagedState(journal.stagedTarget);
        if (staged === null) throw new Error("Reflection transaction stage is missing or invalid");
        await deps.storage.promoteStagedState(journal.stagedTarget);
        await deps.fileOps.unlink(journalPath);
        await deps.storage.removeOrphanStages();
      });
    },

    publishSettingsChange(questionId, enabled): Promise<void> {
      return deps.coordinator.runExclusive(async () => {
        await recoverWithinCoordinator();
        const sourceIdentity = collectionDurableIdentity(
          await deps.collectionReader.loadCollection(),
        );
        const priorState = await deps.storage.loadState();
        const priorSettings = await deps.storage.loadSettings();
        const index = REFLECTION_QUESTION_IDS.indexOf(questionId);
        const targetSettings = structuredClone(priorSettings);
        targetSettings.questions[index].enabled = enabled;
        const targetState: ReflectionDurableState = {
          ...priorState,
          ...(enabled ? {} : { deletionGeneration: createGeneration() }),
          questions: priorState.questions.map((question, questionIndex) =>
            questionIndex === index
              ? { ...question, cache: null, attempt: { state: "idle" } }
              : !enabled && question.attempt.state === "refreshing"
                ? {
                    ...question,
                    attempt: {
                      state: "unavailable",
                      reason: "internal",
                      safeDetail: "settings-mutated",
                      occurredAt: now(),
                    },
                  }
                : question,
          ) as ReflectionDurableState["questions"],
        };
        const transactionId = createTransactionId();
        const stagedTarget = await deps.storage.stageState(transactionId, targetState);
        const stagedSettingsTarget = await deps.storage.stageSettings(
          transactionId,
          targetSettings,
        );
        const journal = ReflectionTransactionJournalSchema.parse({
          version: TRANSACTION_VERSION,
          kind: "settings",
          transactionId,
          priorSourceIdentity: sourceIdentity,
          targetSourceIdentity: sourceIdentity,
          affectedGameIds: [],
          affectedQuestionIds: [questionId],
          priorActiveArtifactIdentity: deps.storage.stateIdentity(priorState),
          stagedTarget,
          priorSettingsArtifactIdentity: deps.storage.settingsIdentity(priorSettings),
          stagedSettingsTarget,
        });
        await publishJournal(journal);
        await deps.storage.promoteStagedState(stagedTarget);
        await deps.storage.promoteStagedSettings(stagedSettingsTarget);
        await cleanup(journal);
      });
    },
  };
}

export function createReflectionNoteInvalidationLifecycle(
  transactions: ReflectionTransactionService,
): OwnerGameNoteInvalidationLifecycle {
  return {
    beforePersistence: (context) =>
      transactions.beforeSourcePersistence({
        priorSourceIdentity: context.priorSourceIdentity,
        targetSourceIdentity: context.targetSourceIdentity,
        affectedGameIds: [context.gameId],
        reason: "note-changed",
      }),
    onPersistenceFailure: () => transactions.onSourcePersistenceFailure(),
    onPersistenceSuccess: () => transactions.onSourcePersistenceSuccess(),
  };
}

export function createReflectionGameDeletionLifecycle(
  transactions: ReflectionTransactionService,
): PermanentGameDeletionLifecycle {
  return {
    beforePersistence: (context) =>
      transactions.beforeSourcePersistence({
        priorSourceIdentity: context.priorSourceIdentity,
        targetSourceIdentity: context.targetSourceIdentity,
        affectedGameIds: [context.gameId],
        reason: "game-deleted",
      }),
    onPersistenceFailure: () => transactions.onSourcePersistenceFailure(),
    onPersistenceSuccess: () => transactions.onSourcePersistenceSuccess(),
  };
}
