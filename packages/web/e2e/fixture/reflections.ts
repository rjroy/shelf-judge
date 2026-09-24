import {
  REFLECTION_CONTRACT_VERSION,
  REFLECTION_QUESTION_IDS,
  REFLECTION_QUESTION_POLICIES,
  ReflectionGetResultSchema,
  type ReflectionGetResult,
  type ReflectionQuestionId,
} from "@shelf-judge/shared";
import { observedAt } from "./data";

export function isReflectionQuestionId(value: unknown): value is ReflectionQuestionId {
  return (
    typeof value === "string" && REFLECTION_QUESTION_IDS.some((questionId) => questionId === value)
  );
}

export function createReflectionState(): ReflectionGetResult {
  return ReflectionGetResultSchema.parse({
    contractVersion: REFLECTION_CONTRACT_VERSION,
    configuration: {
      status: "configured",
      identity: { providerId: "fixture-provider", modelId: "fixture-model", extensionIds: [] },
    },
    settings: {
      version: 1,
      questions: REFLECTION_QUESTION_IDS.map((questionId) => ({ questionId, enabled: true })),
    },
    questions: REFLECTION_QUESTION_IDS.map((questionId) => ({
      questionId,
      enabled: true,
      cache: { state: "none" },
      attempt: { state: "idle" },
    })),
  });
}

export function reflectionResult(
  questionId: ReflectionQuestionId,
  outcome: "answered" | "abstained",
) {
  const base = {
    supportingBlocks:
      outcome === "answered"
        ? [
            {
              text: "Two independent notes support this bounded pattern.",
              citationIds: ["note-1", "note-2", "score-1"],
            },
          ]
        : [],
    citations:
      outcome === "answered"
        ? [
            {
              citationId: "note-1",
              sourceId: "game-1",
              sourceVersion: "1",
              canonicalSummary: "Owner note for Atlas Equal",
              destination: { operationId: "shelf.game.get", parameters: { gameId: "game-1" } },
              sourceDisplayContext: { kind: "game", gameTitle: "Atlas Equal" },
              evidenceClass: "owner-game-note",
              testimony: true,
            },
            {
              citationId: "note-2",
              sourceId: "game-2",
              sourceVersion: "1",
              canonicalSummary: "Owner note for Borealis",
              destination: { operationId: "shelf.game.get", parameters: { gameId: "game-2" } },
              sourceDisplayContext: { kind: "game", gameTitle: "Borealis" },
              evidenceClass: "owner-game-note",
              testimony: true,
            },
            {
              citationId: "score-1",
              sourceId: "game-1-score",
              sourceVersion: "1",
              canonicalSummary: "Current fitness score",
              destination: { operationId: "shelf.game.get", parameters: { gameId: "game-1" } },
              sourceDisplayContext: { kind: "game", gameTitle: "Atlas Equal" },
              evidenceClass: "current-scoring",
              testimony: false,
            },
          ]
        : [],
    scope: {
      examinedPresentNoteCount: outcome === "answered" ? 2 : 0,
      totalPresentNoteCount: outcome === "answered" ? 2 : 0,
      examinedGameCount: outcome === "answered" ? 2 : 0,
      relevantEligibleGameCount: outcome === "answered" ? 2 : 0,
      excludedGameCount: 0,
      exhaustiveNotes: true,
      ...(questionId === "pattern-exceptions" ? { patternCandidateIds: [] } : {}),
    },
    evidenceIdentity: {
      manifestVersion: 2,
      questionId,
      questionVersion: REFLECTION_QUESTION_POLICIES[questionId].questionVersion,
      collectionId: "fixture-collection",
      collectionSchemaVersion: 7,
      collectionRevision: 1,
      profileContractVersion: 1,
      profileAlgorithmVersion: 1,
      providerId: "fixture-provider",
      modelId: "fixture-model",
    },
    dependencies:
      outcome === "answered"
        ? [
            { category: "note", gameId: "game-1", noteVersion: 1 },
            { category: "note", gameId: "game-2", noteVersion: 1 },
          ]
        : [],
    generatedAt: observedAt,
    usage: { state: "unavailable" },
  };
  return outcome === "answered"
    ? {
        ...base,
        outcome,
        centralSynthesis: {
          text: "Quick setup recurs in owner testimony while current scores provide context.",
          citationIds: ["note-1", "note-2", "score-1"],
        },
      }
    : {
        ...base,
        outcome,
        reason: "no-owner-testimony",
        explanation: "No current owner testimony is available for this question.",
      };
}

export function guidedAbstention(
  questionId: ReflectionQuestionId,
  kind: "missing-current-testimony" | "existing-notes-not-examined" | "non-note-blocker",
) {
  const result = reflectionResult(questionId, "abstained");
  const guidance = {
    "missing-current-testimony": {
      reason: "no-owner-testimony" as const,
      message:
        "No current owner testimony was available among the games considered. Relevant notes could help only when they bear on this question, and do not guarantee an answer.",
    },
    "existing-notes-not-examined": {
      reason: "no-owner-testimony" as const,
      message:
        "Current notes are present but were not examined in this attempt. Adding more notes may not help.",
    },
    "non-note-blocker": {
      reason: "no-material-synthesis" as const,
      message:
        "The evidence did not support a meaningful synthesis. More notes may not produce an answer.",
    },
  }[kind];
  return {
    ...result,
    reason: guidance.reason,
    abstentionGuidance: {
      kind,
      message: guidance.message,
      refreshInstruction:
        "After editing, select Refresh this question to check the updated evidence.",
    },
  };
}
