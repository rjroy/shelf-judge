import {
  CURRENT_PROFILE_ALGORITHM_VERSION,
  CURRENT_PROFILE_CONTRACT_VERSION,
  REFLECTION_MANIFEST_VERSION,
  REFLECTION_QUESTION_POLICIES,
  type Collection,
  type ReflectionDependency,
  type ReflectionQuestionId,
} from "@shelf-judge/shared";
import type { Logger } from "./logger.js";
import { createLogger } from "./logger.js";
import type { ReflectionDurableState, ReflectionStorage } from "./reflection-storage.js";
import type { CollectionReader } from "./storage-service.js";

export interface ReflectionStartupProviderIdentity {
  providerId: string;
  modelId: string;
}

export interface ReflectionStartupValidationDeps {
  storage: ReflectionStorage;
  collectionReader: CollectionReader;
  providerIdentity: ReflectionStartupProviderIdentity | null;
  createGeneration?: () => string;
  now?: () => string;
  logger?: Logger;
  questionVersions?: Partial<Record<ReflectionQuestionId, number>>;
}

function dependencyGameId(dependency: ReflectionDependency): string | null {
  if (dependency.category === "note") return dependency.gameId;
  const match = /^game:([^:]+)(?::|$)/.exec(dependency.sourceId);
  return match?.[1] ?? null;
}

function sensitiveDriftReason(
  dependency: ReflectionDependency,
  games: Map<string, Collection["games"][number]>,
): "note-changed" | "game-deleted" | null {
  const gameId = dependencyGameId(dependency);
  if (gameId === null) return null;
  const game = games.get(gameId);
  if (game === undefined) return "game-deleted";
  return dependency.category === "note" && game.ownerNote.version !== dependency.noteVersion
    ? "note-changed"
    : null;
}

function questionSensitiveDriftReason(
  dependencies: readonly ReflectionDependency[],
  games: Map<string, Collection["games"][number]>,
): "note-changed" | "game-deleted" | null {
  const reasons = dependencies.map((dependency) => sensitiveDriftReason(dependency, games));
  if (reasons.includes("game-deleted")) return "game-deleted";
  return reasons.includes("note-changed") ? "note-changed" : null;
}

function hasOrdinaryStaleness(
  questionId: ReflectionQuestionId,
  cache: NonNullable<ReflectionDurableState["questions"][number]["cache"]>,
  collection: Collection,
  providerIdentity: ReflectionStartupProviderIdentity | null,
  questionVersions: Partial<Record<ReflectionQuestionId, number>>,
): boolean {
  const identity = cache.evidenceIdentity;
  return (
    identity.collectionId !== collection.id ||
    identity.collectionSchemaVersion !== collection.schemaVersion ||
    identity.collectionRevision !== collection.revision ||
    identity.profileContractVersion !== CURRENT_PROFILE_CONTRACT_VERSION ||
    identity.profileAlgorithmVersion !== CURRENT_PROFILE_ALGORITHM_VERSION ||
    identity.manifestVersion !== REFLECTION_MANIFEST_VERSION ||
    identity.questionVersion !==
      (questionVersions[questionId] ?? REFLECTION_QUESTION_POLICIES[questionId].questionVersion) ||
    providerIdentity === null ||
    identity.providerId !== providerIdentity.providerId ||
    identity.modelId !== providerIdentity.modelId
  );
}

export function createReflectionStartupValidator(deps: ReflectionStartupValidationDeps) {
  const createGeneration = deps.createGeneration ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => new Date().toISOString());
  const logger = deps.logger ?? createLogger("reflection-startup-validation");

  return async function validateReflectionStartup(): Promise<void> {
    logger.log("reflection startup validation attempt");
    const collection = await deps.collectionReader.loadCollection();
    const settings = await deps.storage.loadSettings();
    const state = await deps.storage.loadState();
    const games = new Map(collection.games.map((game) => [game.id, game]));
    let changed = false;
    let sensitivePurges = 0;
    let disabledPurges = 0;
    let interruptedAttempts = 0;
    let staleCaches = 0;

    const questions = state.questions.map((question, index) => {
      const enabled = settings.questions[index].enabled;
      const sensitiveDrift =
        question.cache === null
          ? null
          : questionSensitiveDriftReason(question.cache.dependencies, games);
      if (!enabled && (question.cache !== null || question.attempt.state !== "idle")) {
        changed = true;
        disabledPurges += 1;
        return { ...question, cache: null, attempt: { state: "idle" as const } };
      }
      if (sensitiveDrift !== null) {
        changed = true;
        sensitivePurges += 1;
        return {
          ...question,
          cache: null,
          attempt: { state: "purged" as const, reason: sensitiveDrift, occurredAt: now() },
        };
      }
      if (question.attempt.state === "refreshing") {
        changed = true;
        interruptedAttempts += 1;
        return {
          ...question,
          attempt: {
            state: "unavailable" as const,
            reason: "internal" as const,
            safeDetail: "daemon-restarted",
            occurredAt: now(),
          },
        };
      }
      if (
        question.cache !== null &&
        hasOrdinaryStaleness(
          question.questionId,
          question.cache,
          collection,
          deps.providerIdentity,
          deps.questionVersions ?? {},
        )
      ) {
        staleCaches += 1;
      }
      return question;
    }) as ReflectionDurableState["questions"];

    if (changed) {
      await deps.storage.saveState({
        ...state,
        deletionGeneration:
          sensitivePurges > 0 || disabledPurges > 0 ? createGeneration() : state.deletionGeneration,
        questions,
      });
    }
    logger.log("reflection startup validation completed", {
      sensitivePurges,
      disabledPurges,
      interruptedAttempts,
      staleCaches,
      stateChanged: changed,
    });
  };
}
