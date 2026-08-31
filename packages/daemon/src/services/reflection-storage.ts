import * as path from "node:path";
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
  };
}

export type DurableReflectionQuestionState = {
  questionId: ReflectionQuestionId;
  cache: ReflectionCompleted | null;
  attempt:
    | Exclude<ReflectionAttemptState, { state: "refreshing" }>
    | (Extract<ReflectionAttemptState, { state: "refreshing" }> & { attemptId: string });
};
