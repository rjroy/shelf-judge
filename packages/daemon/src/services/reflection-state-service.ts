import {
  REFLECTION_EVIDENCE_CATEGORIES,
  REFLECTION_MANIFEST_VERSION,
  REFLECTION_QUESTION_IDS,
  REFLECTION_QUESTION_POLICIES,
  ReflectionCompletedSchema,
  ReflectionQuestionStateCollectionSchema,
  type ReflectionAttemptState,
  type ReflectionCompleted,
  type ReflectionDependency,
  type ReflectionEvidenceCategory,
  type ReflectionQuestionId,
  type ReflectionQuestionState,
  type ReflectionSettings,
  type ReflectionUnavailableReason,
} from "@shelf-judge/shared";
import type { ReflectionDurableState, ReflectionStorage } from "./reflection-storage.js";
import type { ProfileSourceCoordinator } from "./profile-source-coordinator.js";

export interface ReflectionCurrentSources {
  collectionId: string;
  collectionSchemaVersion: number;
  collectionRevision: number;
  profileContractVersion: number;
  profileAlgorithmVersion: number;
  providerId: string;
  modelId: string;
  manifestVersion?: number;
  questionVersions?: Partial<Record<ReflectionQuestionId, number>>;
  dependenciesByQuestion: Record<ReflectionQuestionId, readonly ReflectionDependency[]>;
}

export interface ReflectionAttemptFence {
  questionId: ReflectionQuestionId;
  batchId: string;
  attemptId: string;
  deletionGeneration: string;
}

export interface ReflectionAttemptPublication {
  readonly fence: ReflectionAttemptFence;
  readonly priorCache: ReflectionCompleted | null;
  readonly replacementCache: ReflectionCompleted;
}

export type ReflectionAttemptInterruption =
  | { readonly state: "cancelled" }
  | {
      readonly state: "unavailable";
      readonly reason: ReflectionUnavailableReason;
      readonly safeDetail?: string;
    };

export interface ReflectionCompensationResult {
  readonly outcome: "restored" | "superseded";
  readonly cacheTransition: "none" | "written" | "invalidated";
}

export class ReflectionCompensationPersistenceError extends Error {
  constructor(
    readonly result: ReflectionCompensationResult,
    options?: ErrorOptions,
  ) {
    super("reflection-compensation-persistence-failed", options);
    this.name = "ReflectionCompensationPersistenceError";
  }
}

export interface ReflectionStateService {
  getSettings(): Promise<ReflectionSettings>;
  getDeletionGeneration(): Promise<string>;
  read(sources: ReflectionCurrentSources): Promise<readonly ReflectionQuestionState[]>;
  readSnapshot(
    loadCurrentSources: () => ReflectionCurrentSources | Promise<ReflectionCurrentSources>,
  ): Promise<{
    settings: ReflectionSettings;
    questions: readonly ReflectionQuestionState[];
  }>;
  setEnabled(questionId: ReflectionQuestionId, enabled: boolean): Promise<void>;
  startAttempt(questionId: ReflectionQuestionId, batchId: string): Promise<ReflectionAttemptFence>;
  completeAttempt(
    fence: ReflectionAttemptFence,
    result: ReflectionCompleted,
    loadCurrentSources: () => ReflectionCurrentSources | Promise<ReflectionCurrentSources>,
  ): Promise<ReflectionAttemptPublication | false>;
  compensateAttempt(
    publication: ReflectionAttemptPublication,
    interruption: ReflectionAttemptInterruption,
  ): Promise<ReflectionCompensationResult>;
  cancelAttempt(fence: ReflectionAttemptFence): Promise<boolean>;
  failAttempt(
    fence: ReflectionAttemptFence,
    reason: ReflectionUnavailableReason,
    safeDetail?: string,
  ): Promise<boolean>;
  purge(
    questionIds: readonly ReflectionQuestionId[],
    reason: "note-changed" | "game-deleted" | "owner-deleted",
  ): Promise<string>;
}

export interface ReflectionStateServiceDeps {
  storage: ReflectionStorage;
  now?: () => string;
  createGeneration?: () => string;
  createAttemptId?: () => string;
  coordinator: ProfileSourceCoordinator;
  recoverBeforeUse?: () => Promise<void>;
  publishSettingsChange?: (questionId: ReflectionQuestionId, enabled: boolean) => Promise<void>;
}

function dependencyKey(dependency: ReflectionDependency): string {
  return dependency.category === "note"
    ? `note\u0000${dependency.gameId}`
    : `${dependency.category}\u0000${dependency.sourceId}`;
}

function changedCategories(
  result: ReflectionCompleted,
  current: ReflectionCurrentSources,
): ReflectionEvidenceCategory[] {
  const changed = new Set<ReflectionEvidenceCategory>();
  const identity = result.evidenceIdentity;
  if (
    identity.collectionId !== current.collectionId ||
    identity.collectionSchemaVersion !== current.collectionSchemaVersion ||
    identity.collectionRevision !== current.collectionRevision
  ) {
    changed.add("collection");
  }
  if (
    identity.profileContractVersion !== current.profileContractVersion ||
    identity.profileAlgorithmVersion !== current.profileAlgorithmVersion
  ) {
    changed.add("profile");
  }
  if (identity.providerId !== current.providerId || identity.modelId !== current.modelId) {
    changed.add("provider-configuration");
  }
  if (
    identity.manifestVersion !== (current.manifestVersion ?? REFLECTION_MANIFEST_VERSION) ||
    identity.questionVersion !==
      (current.questionVersions?.[identity.questionId] ??
        REFLECTION_QUESTION_POLICIES[identity.questionId].questionVersion)
  ) {
    changed.add("question-policy");
  }

  const currentDependencies = new Map(
    current.dependenciesByQuestion[identity.questionId].map((item) => [dependencyKey(item), item]),
  );
  const recordedDependencies = new Map(
    result.dependencies.map((item) => [dependencyKey(item), item]),
  );
  for (const dependency of result.dependencies) {
    const replacement = currentDependencies.get(dependencyKey(dependency));
    if (replacement === undefined || JSON.stringify(replacement) !== JSON.stringify(dependency)) {
      changed.add(dependency.category);
    }
  }
  for (const dependency of currentDependencies.values()) {
    if (!recordedDependencies.has(dependencyKey(dependency))) changed.add(dependency.category);
  }
  return REFLECTION_EVIDENCE_CATEGORIES.filter((category) => changed.has(category));
}

function noteDependencyChanged(
  result: ReflectionCompleted,
  current: ReflectionCurrentSources,
): boolean {
  const currentNotes = new Map(
    current.dependenciesByQuestion[result.evidenceIdentity.questionId]
      .filter((dependency) => dependency.category === "note")
      .map((dependency) => [dependencyKey(dependency), dependency]),
  );
  return result.dependencies
    .filter((dependency) => dependency.category === "note")
    .some((dependency) => {
      const replacement = currentNotes.get(dependencyKey(dependency));
      return replacement === undefined || replacement.noteVersion !== dependency.noteVersion;
    });
}

export function createReflectionStateService(
  deps: ReflectionStateServiceDeps,
): ReflectionStateService {
  const now = deps.now ?? (() => new Date().toISOString());
  const createGeneration = deps.createGeneration ?? (() => crypto.randomUUID());
  const createAttemptId = deps.createAttemptId ?? (() => crypto.randomUUID());
  const issuedPublications = new WeakSet<ReflectionAttemptPublication>();
  let initialized: Promise<{ settings: ReflectionSettings; state: ReflectionDurableState }> | null =
    null;

  function initialize(): Promise<{ settings: ReflectionSettings; state: ReflectionDurableState }> {
    if (initialized !== null) return initialized;
    initialized = (async () => {
      const [settings, loadedState] = await Promise.all([
        deps.storage.loadSettings(),
        deps.storage.loadState(),
      ]);
      let state = loadedState;
      let reconciled = false;
      const questions = state.questions.map((question) => {
        if (question.attempt.state !== "refreshing") return question;
        reconciled = true;
        return {
          ...question,
          attempt: {
            state: "unavailable" as const,
            reason: "internal" as const,
            safeDetail: "daemon-restarted",
            occurredAt: now(),
          },
        };
      }) as ReflectionDurableState["questions"];
      if (reconciled) {
        state = { ...state, questions };
        await deps.storage.saveState(state);
      }
      return { settings, state };
    })();
    return initialized;
  }

  function runExclusive<Value>(operation: () => Promise<Value>): Promise<Value> {
    return deps.coordinator.runExclusive(async () => {
      await deps.recoverBeforeUse?.();
      if (deps.recoverBeforeUse !== undefined) initialized = null;
      return operation();
    });
  }

  async function updateState(
    update: (current: ReflectionDurableState) => ReflectionDurableState,
  ): Promise<ReflectionDurableState> {
    const context = await initialize();
    const next = update(context.state);
    await deps.storage.saveState(next);
    context.state = next;
    return next;
  }

  function questionIndex(questionId: ReflectionQuestionId): number {
    return REFLECTION_QUESTION_IDS.indexOf(questionId);
  }

  function compensationResult(
    state: ReflectionDurableState,
    settings: ReflectionSettings,
    publication: ReflectionAttemptPublication,
    compensated?: ReflectionDurableState,
  ): ReflectionCompensationResult {
    if (
      compensated !== undefined &&
      deps.storage.stateIdentity(state) === deps.storage.stateIdentity(compensated)
    ) {
      return { outcome: "restored", cacheTransition: "none" };
    }
    const index = questionIndex(publication.fence.questionId);
    const question = state.questions[index];
    if (
      state.deletionGeneration !== publication.fence.deletionGeneration ||
      !settings.questions[index].enabled ||
      question.attempt.state === "purged"
    ) {
      return {
        outcome: "superseded",
        cacheTransition: question.cache === null ? "invalidated" : "written",
      };
    }
    if (JSON.stringify(question.cache) === JSON.stringify(publication.priorCache)) {
      return { outcome: "superseded", cacheTransition: "none" };
    }
    return {
      outcome: "superseded",
      cacheTransition: question.cache === null ? "invalidated" : "written",
    };
  }

  function replaceQuestion(
    state: ReflectionDurableState,
    questionId: ReflectionQuestionId,
    update: (
      question: ReflectionDurableState["questions"][number],
    ) => ReflectionDurableState["questions"][number],
  ): ReflectionDurableState {
    const index = questionIndex(questionId);
    const questions = state.questions.map((question, candidateIndex) =>
      candidateIndex === index ? update(question) : question,
    ) as ReflectionDurableState["questions"];
    return { ...state, questions };
  }

  async function setAttempt(
    questionId: ReflectionQuestionId,
    attempt: Exclude<ReflectionAttemptState, { state: "refreshing" }>,
  ): Promise<void> {
    await updateState((state) =>
      replaceQuestion(state, questionId, (question) => ({ ...question, attempt })),
    );
  }

  async function projectQuestions(
    context: { settings: ReflectionSettings; state: ReflectionDurableState },
    sources: ReflectionCurrentSources,
  ): Promise<readonly ReflectionQuestionState[]> {
    const noteChangedQuestionIds = context.state.questions
      .filter(
        (question) => question.cache !== null && noteDependencyChanged(question.cache, sources),
      )
      .map(({ questionId }) => questionId);
    if (noteChangedQuestionIds.length > 0) {
      const selected = new Set(noteChangedQuestionIds);
      await updateState((state) => ({
        ...state,
        deletionGeneration: createGeneration(),
        questions: state.questions.map((question) =>
          selected.has(question.questionId)
            ? {
                ...question,
                cache: null,
                attempt: { state: "purged", reason: "note-changed", occurredAt: now() },
              }
            : question,
        ) as ReflectionDurableState["questions"],
      }));
    }
    const { settings, state } = context;
    const questions = state.questions.map((question, index) => {
      const enabled = settings.questions[index].enabled;
      if (!enabled) {
        return {
          questionId: question.questionId,
          enabled,
          cache: { state: "none" },
          attempt: { state: "idle" },
        };
      }
      if (question.cache === null) {
        return {
          questionId: question.questionId,
          enabled,
          cache: { state: "none" },
          attempt:
            question.attempt.state === "refreshing"
              ? {
                  state: question.attempt.state,
                  batchId: question.attempt.batchId,
                  startedAt: question.attempt.startedAt,
                }
              : question.attempt,
        };
      }
      const categories = changedCategories(question.cache, sources);
      return {
        questionId: question.questionId,
        enabled,
        cache:
          categories.length === 0
            ? { state: "current" as const, result: question.cache }
            : {
                state: "stale" as const,
                changedCategories: categories,
                result: question.cache,
              },
        attempt:
          question.attempt.state === "refreshing"
            ? {
                state: question.attempt.state,
                batchId: question.attempt.batchId,
                startedAt: question.attempt.startedAt,
              }
            : question.attempt,
      };
    });
    return ReflectionQuestionStateCollectionSchema.parse(questions);
  }

  return {
    getSettings(): Promise<ReflectionSettings> {
      return runExclusive(async () => structuredClone((await initialize()).settings));
    },

    getDeletionGeneration(): Promise<string> {
      return runExclusive(async () => (await initialize()).state.deletionGeneration);
    },

    read(sources): Promise<readonly ReflectionQuestionState[]> {
      return runExclusive(async () => projectQuestions(await initialize(), sources));
    },

    readSnapshot(loadCurrentSources) {
      return runExclusive(async () => {
        const context = await initialize();
        const sources = await loadCurrentSources();
        const questions = await projectQuestions(context, sources);
        return { settings: structuredClone(context.settings), questions };
      });
    },

    setEnabled(questionId, enabled): Promise<void> {
      return runExclusive(async () => {
        if (deps.publishSettingsChange !== undefined) {
          await deps.publishSettingsChange(questionId, enabled);
          initialized = null;
          return;
        }
        const context = await initialize();
        const index = questionIndex(questionId);
        const settings = structuredClone(context.settings);
        settings.questions[index].enabled = enabled;
        if (!enabled) {
          const generation = createGeneration();
          await updateState((state) => ({
            ...replaceQuestion(state, questionId, (question) => ({
              ...question,
              cache: null,
              attempt: { state: "idle" },
            })),
            deletionGeneration: generation,
          }));
        } else {
          await updateState((state) =>
            replaceQuestion(state, questionId, (question) => ({
              ...question,
              cache: null,
              attempt: { state: "idle" },
            })),
          );
        }
        await deps.storage.saveSettings(settings);
        context.settings = settings;
      });
    },

    startAttempt(questionId, batchId): Promise<ReflectionAttemptFence> {
      return runExclusive(async () => {
        const context = await initialize();
        if (!context.settings.questions[questionIndex(questionId)].enabled) {
          throw new Error(`Reflection question ${questionId} is disabled`);
        }
        const attemptId = createAttemptId();
        await updateState((state) =>
          replaceQuestion(state, questionId, (question) => ({
            ...question,
            attempt: { state: "refreshing", batchId, attemptId, startedAt: now() },
          })),
        );
        return {
          questionId,
          batchId,
          attemptId,
          deletionGeneration: context.state.deletionGeneration,
        };
      });
    },

    completeAttempt(
      fence,
      result,
      loadCurrentSources,
    ): Promise<ReflectionAttemptPublication | false> {
      return runExclusive(async () => {
        const validated = ReflectionCompletedSchema.parse(result);
        if (validated.evidenceIdentity.questionId !== fence.questionId) {
          throw new Error("Reflection result question does not match its attempt fence");
        }
        const context = await initialize();
        const sources = await loadCurrentSources();
        const index = questionIndex(fence.questionId);
        if (
          context.state.deletionGeneration !== fence.deletionGeneration ||
          changedCategories(validated, sources).length > 0 ||
          !context.settings.questions[index].enabled ||
          context.state.questions[index].attempt.state !== "refreshing" ||
          context.state.questions[index].attempt.batchId !== fence.batchId ||
          context.state.questions[index].attempt.attemptId !== fence.attemptId
        ) {
          return false;
        }
        const priorCache = context.state.questions[index].cache;
        await updateState((state) =>
          replaceQuestion(state, fence.questionId, (question) => ({
            ...question,
            cache: validated,
            attempt: { state: "idle" },
          })),
        );
        const publication: ReflectionAttemptPublication = Object.freeze({
          fence: Object.freeze({ ...fence }),
          priorCache: priorCache === null ? null : structuredClone(priorCache),
          replacementCache: structuredClone(validated),
        });
        issuedPublications.add(publication);
        return publication;
      });
    },

    compensateAttempt(publication, interruption): Promise<ReflectionCompensationResult> {
      return runExclusive(async () => {
        if (!issuedPublications.has(publication)) {
          const context = await initialize();
          return compensationResult(context.state, context.settings, publication);
        }
        const context = await initialize();
        const { fence } = publication;
        const index = questionIndex(fence.questionId);
        const question = context.state.questions[index];
        if (
          context.state.deletionGeneration !== fence.deletionGeneration ||
          !context.settings.questions[index].enabled ||
          question.attempt.state !== "idle" ||
          JSON.stringify(question.cache) !== JSON.stringify(publication.replacementCache)
        ) {
          issuedPublications.delete(publication);
          return compensationResult(context.state, context.settings, publication);
        }
        const attempt: Exclude<ReflectionAttemptState, { state: "refreshing" }> =
          interruption.state === "cancelled"
            ? { state: "cancelled", occurredAt: now() }
            : {
                state: "unavailable",
                reason: interruption.reason,
                ...(interruption.safeDetail === undefined
                  ? {}
                  : { safeDetail: interruption.safeDetail }),
                occurredAt: now(),
              };
        const compensated = replaceQuestion(context.state, fence.questionId, (current) => ({
          ...current,
          cache: publication.priorCache === null ? null : structuredClone(publication.priorCache),
          attempt,
        }));
        try {
          await deps.storage.saveState(compensated);
          context.state = compensated;
        } catch (error) {
          let persisted: ReflectionDurableState;
          try {
            persisted = await deps.storage.loadState();
          } catch {
            throw error;
          }
          const result = compensationResult(persisted, context.settings, publication, compensated);
          if (result.outcome !== "restored") {
            const persistedQuestion = persisted.questions[index];
            if (
              result.cacheTransition === "written" &&
              persisted.deletionGeneration === fence.deletionGeneration &&
              context.settings.questions[index].enabled &&
              persistedQuestion.attempt.state === "idle" &&
              JSON.stringify(persistedQuestion.cache) ===
                JSON.stringify(publication.replacementCache)
            ) {
              const failed = replaceQuestion(persisted, fence.questionId, (current) => ({
                ...current,
                attempt: {
                  state: "unavailable",
                  reason: "persistence",
                  safeDetail: "reflection-compensation-persistence-failed",
                  occurredAt: now(),
                },
              }));
              try {
                await deps.storage.saveState(failed);
                persisted = failed;
              } catch {
                try {
                  const reloaded = await deps.storage.loadState();
                  if (deps.storage.stateIdentity(reloaded) === deps.storage.stateIdentity(failed)) {
                    persisted = reloaded;
                  }
                } catch {
                  // Keep the confirmed durable image and the original compensation failure.
                }
              }
            }
            context.state = persisted;
            issuedPublications.delete(publication);
            throw new ReflectionCompensationPersistenceError(result, { cause: error });
          }
          context.state = persisted;
        }
        issuedPublications.delete(publication);
        return { outcome: "restored", cacheTransition: "none" };
      });
    },

    cancelAttempt(fence): Promise<boolean> {
      return runExclusive(async () => {
        const context = await initialize();
        const attempt = context.state.questions[questionIndex(fence.questionId)].attempt;
        if (
          context.state.deletionGeneration !== fence.deletionGeneration ||
          attempt.state !== "refreshing" ||
          attempt.batchId !== fence.batchId ||
          attempt.attemptId !== fence.attemptId
        ) {
          return false;
        }
        await setAttempt(fence.questionId, { state: "cancelled", occurredAt: now() });
        return true;
      });
    },

    failAttempt(fence, reason, safeDetail): Promise<boolean> {
      return runExclusive(async () => {
        const context = await initialize();
        const attempt = context.state.questions[questionIndex(fence.questionId)].attempt;
        if (
          context.state.deletionGeneration !== fence.deletionGeneration ||
          attempt.state !== "refreshing" ||
          attempt.batchId !== fence.batchId ||
          attempt.attemptId !== fence.attemptId
        ) {
          return false;
        }
        await setAttempt(fence.questionId, {
          state: "unavailable",
          reason,
          ...(safeDetail === undefined ? {} : { safeDetail }),
          occurredAt: now(),
        });
        return true;
      });
    },

    purge(questionIds, reason): Promise<string> {
      return runExclusive(async () => {
        const selected = new Set(questionIds);
        const deletionGeneration = createGeneration();
        await updateState((state) => ({
          ...state,
          deletionGeneration,
          questions: state.questions.map((question) =>
            selected.has(question.questionId)
              ? {
                  ...question,
                  cache: null,
                  attempt: { state: "purged", reason, occurredAt: now() },
                }
              : question,
          ) as ReflectionDurableState["questions"],
        }));
        return deletionGeneration;
      });
    },
  };
}
