import type { FileOps, TemporaryPathForAttempt } from "./file-ops.js";
import type { Logger } from "./logger.js";
import {
  createReflectionGameDeletionLifecycle,
  createReflectionNoteInvalidationLifecycle,
  createReflectionTransactionService,
  type ReflectionTransactionService,
} from "./reflection-transaction-service.js";
import {
  createReflectionStateService,
  type ReflectionStateService,
} from "./reflection-state-service.js";
import { createReflectionStorage, type ReflectionStorage } from "./reflection-storage.js";
import { profileSourceCoordinatorFor } from "./profile-source-coordinator.js";
import type { StorageService } from "./storage-service.js";
import type { OwnerGameNoteInvalidationLifecycle } from "./owner-game-note-service.js";
import type { PermanentGameDeletionLifecycle } from "./game-service.js";
import {
  createReflectionStartupValidator,
  type ReflectionStartupProviderIdentity,
} from "./reflection-startup-validation.js";

export interface ReflectionRuntime {
  storage: ReflectionStorage;
  state: ReflectionStateService;
  transactions: ReflectionTransactionService;
  noteInvalidationLifecycle: OwnerGameNoteInvalidationLifecycle;
  gameDeletionLifecycle: PermanentGameDeletionLifecycle;
  recover(): Promise<void>;
}

export interface ReflectionRuntimeDeps {
  dataDir: string;
  fileOps: FileOps;
  storageService: StorageService;
  logger?: Logger;
  createTransactionId?: () => string;
  createGeneration?: () => string;
  createAttemptId?: () => string;
  now?: () => string;
  temporaryPathForAttempt?: TemporaryPathForAttempt;
  providerIdentity?: ReflectionStartupProviderIdentity | null;
}

export function createReflectionRuntime(deps: ReflectionRuntimeDeps): ReflectionRuntime {
  const coordinator = profileSourceCoordinatorFor(deps.storageService);
  const storage = createReflectionStorage({
    dataDir: deps.dataDir,
    fileOps: deps.fileOps,
    logger: deps.logger,
    createGeneration: deps.createGeneration,
    temporaryPathForAttempt: deps.temporaryPathForAttempt,
  });
  const validateStartup = createReflectionStartupValidator({
    storage,
    collectionReader: deps.storageService,
    providerIdentity: deps.providerIdentity ?? null,
    createGeneration: deps.createGeneration,
    now: deps.now,
    logger: deps.logger,
  });
  let startupValidated = false;
  const validateAfterRecovery = async () => {
    if (startupValidated) return;
    await validateStartup();
    startupValidated = true;
  };
  const transactions = createReflectionTransactionService({
    dataDir: deps.dataDir,
    fileOps: deps.fileOps,
    storage,
    collectionReader: deps.storageService,
    coordinator,
    logger: deps.logger,
    createTransactionId: deps.createTransactionId,
    createGeneration: deps.createGeneration,
    now: deps.now,
    temporaryPathForAttempt: deps.temporaryPathForAttempt,
    validateAfterRecovery,
  });
  const state = createReflectionStateService({
    storage,
    coordinator,
    recoverBeforeUse: () => transactions.recover(),
    publishSettingsChange: (questionId, enabled) =>
      transactions.publishSettingsChange(questionId, enabled),
    createGeneration: deps.createGeneration,
    createAttemptId: deps.createAttemptId,
    now: deps.now,
  });

  return {
    storage,
    state,
    transactions,
    noteInvalidationLifecycle: createReflectionNoteInvalidationLifecycle(transactions),
    gameDeletionLifecycle: createReflectionGameDeletionLifecycle(transactions),
    recover: () => transactions.recover(),
  };
}
