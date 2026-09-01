import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  DEFAULT_REFLECTION_SETTINGS,
  REFLECTION_QUESTION_IDS,
  ReflectionAttemptStateSchema,
  ReflectionCompletedSchema,
  ReflectionSettingsSchema,
  type ReflectionAttemptState,
  type ReflectionCompleted,
  type ReflectionQuestionId,
  type ReflectionSettings,
} from "@shelf-judge/shared";
import { z } from "zod";
import { atomicWrite, type FileOps, type TemporaryPathForAttempt } from "./file-ops.js";
import { createLogger, type Logger } from "./logger.js";

export const REFLECTION_STATE_VERSION = 1 as const;
export const REFLECTION_SETTINGS_FILE = "profile-reflection-settings.json";
export const REFLECTION_STATE_FILE = "profile-reflections.json";
export const REFLECTION_STAGE_PREFIX = ".profile-reflections.stage.";
export const REFLECTION_SETTINGS_STAGE_PREFIX = ".profile-reflection-settings.stage.";

const UuidSchema = z.string().uuid();
const RandomUuidSchema = z
  .string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

function isBareFileName(fileName: string): boolean {
  return fileName === path.posix.basename(fileName) && fileName === path.win32.basename(fileName);
}

function isStableStageName(fileName: string): boolean {
  const prefix = [REFLECTION_STAGE_PREFIX, REFLECTION_SETTINGS_STAGE_PREFIX].find((candidate) =>
    fileName.startsWith(candidate),
  );
  if (prefix === undefined) return false;

  const parts = fileName.slice(prefix.length).split(".");
  return (
    parts.length === 3 &&
    UuidSchema.safeParse(parts[0]).success &&
    Sha256Schema.safeParse(parts[1]).success &&
    parts[2] === "json"
  );
}

function isAtomicTemporary(fileName: string): boolean {
  if (!fileName.startsWith(".") || !fileName.endsWith(".tmp")) return false;

  const withoutWrapper = fileName.slice(1, -4);
  const tokenSeparator = withoutWrapper.lastIndexOf(".");
  if (tokenSeparator < 0) return false;

  const targetName = withoutWrapper.slice(0, tokenSeparator);
  const token = withoutWrapper.slice(tokenSeparator + 1);
  return (
    RandomUuidSchema.safeParse(token).success &&
    (targetName === REFLECTION_STATE_FILE ||
      targetName === REFLECTION_SETTINGS_FILE ||
      isStableStageName(targetName))
  );
}

export function isReflectionOrphanArtifact(fileName: string): boolean {
  return isBareFileName(fileName) && (isStableStageName(fileName) || isAtomicTemporary(fileName));
}

export interface ReflectionStagedState {
  fileName: string;
  identity: string;
}
export type ReflectionStagedSettings = ReflectionStagedState;

const DurableAttemptStateSchema = z.union([
  z
    .object({
      state: z.literal("refreshing"),
      batchId: z.string().min(1),
      attemptId: z.string().uuid(),
      startedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  ReflectionAttemptStateSchema.refine(
    (attempt): attempt is Exclude<ReflectionAttemptState, { state: "refreshing" }> =>
      attempt.state !== "refreshing",
  ),
]);

const DurableQuestionStateSchema = z
  .object({
    questionId: z.enum(REFLECTION_QUESTION_IDS),
    cache: ReflectionCompletedSchema.nullable(),
    attempt: DurableAttemptStateSchema,
  })
  .strict();

export const ReflectionDurableStateSchema = z
  .object({
    version: z.literal(REFLECTION_STATE_VERSION),
    deletionGeneration: z.string().uuid(),
    questions: z.tuple([
      DurableQuestionStateSchema.refine(({ questionId }) => questionId === "repeated-values"),
      DurableQuestionStateSchema.refine(({ questionId }) => questionId === "pattern-exceptions"),
      DurableQuestionStateSchema.refine(({ questionId }) => questionId === "recurring-trade-offs"),
    ]),
  })
  .strict()
  .superRefine(({ questions }, context) => {
    for (const [index, question] of questions.entries()) {
      if (
        question.cache !== null &&
        question.cache.evidenceIdentity.questionId !== question.questionId
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["questions", index, "cache", "evidenceIdentity", "questionId"],
          message: "Durable Reflection cache must match its question",
        });
      }
      if (question.attempt.state === "purged" && question.cache !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["questions", index, "attempt"],
          message: "A purged durable Reflection question cannot retain a cache",
        });
      }
    }
  });

export type ReflectionDurableState = z.infer<typeof ReflectionDurableStateSchema>;

export interface ReflectionStorage {
  loadSettings(): Promise<ReflectionSettings>;
  saveSettings(settings: ReflectionSettings): Promise<void>;
  loadState(): Promise<ReflectionDurableState>;
  saveState(state: ReflectionDurableState): Promise<void>;
  stateIdentity(state: ReflectionDurableState): string;
  stageState(transactionId: string, state: ReflectionDurableState): Promise<ReflectionStagedState>;
  loadStagedState(stage: ReflectionStagedState): Promise<ReflectionDurableState | null>;
  promoteStagedState(stage: ReflectionStagedState): Promise<void>;
  removeStagedState(stage: ReflectionStagedState): Promise<void>;
  removeOrphanStages(retainedFileName?: string): Promise<void>;
  resetState(): Promise<ReflectionDurableState>;
  settingsIdentity(settings: ReflectionSettings): string;
  stageSettings(
    transactionId: string,
    settings: ReflectionSettings,
  ): Promise<ReflectionStagedSettings>;
  loadStagedSettings(stage: ReflectionStagedSettings): Promise<ReflectionSettings | null>;
  promoteStagedSettings(stage: ReflectionStagedSettings): Promise<void>;
  removeStagedSettings(stage: ReflectionStagedSettings): Promise<void>;
}

export interface ReflectionStorageDeps {
  dataDir: string;
  fileOps: FileOps;
  logger?: Logger;
  createGeneration?: () => string;
  temporaryPathForAttempt?: TemporaryPathForAttempt;
}

function createEmptyState(createGeneration: () => string): ReflectionDurableState {
  return ReflectionDurableStateSchema.parse({
    version: REFLECTION_STATE_VERSION,
    deletionGeneration: createGeneration(),
    questions: REFLECTION_QUESTION_IDS.map((questionId) => ({
      questionId,
      cache: null,
      attempt: { state: "idle" },
    })),
  });
}

function stateIdentity(state: ReflectionDurableState): string {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

function settingsIdentity(settings: ReflectionSettings): string {
  return createHash("sha256").update(JSON.stringify(settings)).digest("hex");
}

export function createReflectionStorage(deps: ReflectionStorageDeps): ReflectionStorage {
  const logger = deps.logger ?? createLogger("reflection-storage");
  const createGeneration = deps.createGeneration ?? (() => crypto.randomUUID());
  const settingsPath = path.join(deps.dataDir, REFLECTION_SETTINGS_FILE);
  const statePath = path.join(deps.dataDir, REFLECTION_STATE_FILE);
  let operations: Promise<void> = Promise.resolve();

  function runExclusive<Value>(operation: () => Promise<Value>): Promise<Value> {
    const result = operations.then(operation, operation);
    operations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function persist(filePath: string, value: unknown, artifact: string): Promise<void> {
    await deps.fileOps.mkdir(deps.dataDir);
    logger.log(`reflection ${artifact} persistence attempt path=${filePath}`);
    try {
      await atomicWrite(
        filePath,
        JSON.stringify(value, null, 2),
        deps.fileOps,
        deps.temporaryPathForAttempt,
      );
      logger.log(`reflection ${artifact} persistence completed path=${filePath}`);
    } catch (error) {
      logger.error(`reflection ${artifact} persistence failed path=${filePath}`, error);
      throw error;
    }
  }

  async function replaceInvalid<Value>(
    filePath: string,
    artifact: string,
    replacement: Value,
  ): Promise<Value> {
    logger.warn(`reflection ${artifact} invalid; destroying path=${filePath}`);
    await deps.fileOps.unlink(filePath);
    logger.log(`reflection ${artifact} destroyed path=${filePath}`);
    await persist(filePath, replacement, artifact);
    return replacement;
  }

  return {
    loadSettings(): Promise<ReflectionSettings> {
      return runExclusive(async () => {
        if (!(await deps.fileOps.exists(settingsPath))) {
          const defaults = ReflectionSettingsSchema.parse(
            structuredClone(DEFAULT_REFLECTION_SETTINGS),
          );
          await persist(settingsPath, defaults, "settings");
          return defaults;
        }
        const raw = await deps.fileOps.readFile(settingsPath);
        try {
          const settings = ReflectionSettingsSchema.parse(JSON.parse(raw));
          logger.log(`reflection settings validation completed path=${settingsPath}`);
          return settings;
        } catch {
          logger.warn(`reflection settings validation failed path=${settingsPath}`);
          const defaults = ReflectionSettingsSchema.parse(
            structuredClone(DEFAULT_REFLECTION_SETTINGS),
          );
          return replaceInvalid(settingsPath, "settings", defaults);
        }
      });
    },

    saveSettings(settings): Promise<void> {
      return runExclusive(async () => {
        const validated = ReflectionSettingsSchema.parse(settings);
        await persist(settingsPath, validated, "settings");
      });
    },

    loadState(): Promise<ReflectionDurableState> {
      return runExclusive(async () => {
        if (!(await deps.fileOps.exists(statePath))) {
          const empty = createEmptyState(createGeneration);
          await persist(statePath, empty, "state");
          return empty;
        }
        const raw = await deps.fileOps.readFile(statePath);
        try {
          const state = ReflectionDurableStateSchema.parse(JSON.parse(raw));
          logger.log(
            `reflection state validation completed path=${statePath} generation=${state.deletionGeneration}`,
          );
          return state;
        } catch {
          logger.warn(`reflection state validation failed path=${statePath}`);
          return replaceInvalid(statePath, "state", createEmptyState(createGeneration));
        }
      });
    },

    saveState(state): Promise<void> {
      return runExclusive(async () => {
        const validated = ReflectionDurableStateSchema.parse(state);
        await persist(statePath, validated, "state");
      });
    },

    stateIdentity,

    stageState(transactionId, state): Promise<ReflectionStagedState> {
      return runExclusive(async () => {
        const validated = ReflectionDurableStateSchema.parse(state);
        const identity = stateIdentity(validated);
        const fileName = `${REFLECTION_STAGE_PREFIX}${transactionId}.${identity}.json`;
        await persist(path.join(deps.dataDir, fileName), validated, "stage");
        return { fileName, identity };
      });
    },

    loadStagedState(stage): Promise<ReflectionDurableState | null> {
      return runExclusive(async () => {
        const stagePath = path.join(deps.dataDir, stage.fileName);
        if (!(await deps.fileOps.exists(stagePath))) return null;
        try {
          const state = ReflectionDurableStateSchema.parse(
            JSON.parse(await deps.fileOps.readFile(stagePath)),
          );
          return stateIdentity(state) === stage.identity ? state : null;
        } catch {
          return null;
        }
      });
    },

    promoteStagedState(stage): Promise<void> {
      return runExclusive(async () => {
        const stagePath = path.join(deps.dataDir, stage.fileName);
        const staged = await deps.fileOps.readFile(stagePath);
        const validated = ReflectionDurableStateSchema.parse(JSON.parse(staged));
        if (stateIdentity(validated) !== stage.identity)
          throw new Error("Reflection stage identity mismatch");
        await deps.fileOps.rename(stagePath, statePath);
      });
    },

    removeStagedState(stage): Promise<void> {
      return runExclusive(() => deps.fileOps.unlink(path.join(deps.dataDir, stage.fileName)));
    },

    removeOrphanStages(retainedFileName): Promise<void> {
      return runExclusive(async () => {
        for (const fileName of await deps.fileOps.listFiles(deps.dataDir)) {
          if (isReflectionOrphanArtifact(fileName) && fileName !== retainedFileName) {
            await deps.fileOps.unlink(path.join(deps.dataDir, fileName));
          }
        }
      });
    },

    resetState(): Promise<ReflectionDurableState> {
      return runExclusive(async () => {
        const state = createEmptyState(createGeneration);
        await persist(statePath, state, "state");
        return state;
      });
    },

    settingsIdentity,

    stageSettings(transactionId, settings): Promise<ReflectionStagedSettings> {
      return runExclusive(async () => {
        const validated = ReflectionSettingsSchema.parse(settings);
        const identity = settingsIdentity(validated);
        const fileName = `${REFLECTION_SETTINGS_STAGE_PREFIX}${transactionId}.${identity}.json`;
        await persist(path.join(deps.dataDir, fileName), validated, "settings-stage");
        return { fileName, identity };
      });
    },

    loadStagedSettings(stage): Promise<ReflectionSettings | null> {
      return runExclusive(async () => {
        const stagePath = path.join(deps.dataDir, stage.fileName);
        if (!(await deps.fileOps.exists(stagePath))) return null;
        try {
          const settings = ReflectionSettingsSchema.parse(
            JSON.parse(await deps.fileOps.readFile(stagePath)),
          );
          return settingsIdentity(settings) === stage.identity ? settings : null;
        } catch {
          return null;
        }
      });
    },

    promoteStagedSettings(stage): Promise<void> {
      return runExclusive(async () => {
        const stagePath = path.join(deps.dataDir, stage.fileName);
        const staged = await deps.fileOps.readFile(stagePath);
        const validated = ReflectionSettingsSchema.parse(JSON.parse(staged));
        if (settingsIdentity(validated) !== stage.identity) {
          throw new Error("Reflection settings stage identity mismatch");
        }
        await deps.fileOps.rename(stagePath, settingsPath);
      });
    },

    removeStagedSettings(stage): Promise<void> {
      return runExclusive(() => deps.fileOps.unlink(path.join(deps.dataDir, stage.fileName)));
    },
  };
}

export type DurableReflectionQuestionState = {
  questionId: ReflectionQuestionId;
  cache: ReflectionCompleted | null;
  attempt:
    | Exclude<ReflectionAttemptState, { state: "refreshing" }>
    | (Extract<ReflectionAttemptState, { state: "refreshing" }> & { attemptId: string });
};
