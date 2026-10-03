/**
 * Version identity for the row-level judgment produced by the Jev gateway.
 * These identifiers describe the current provider request and interpretation;
 * they are not collection activation or rollout settings.
 */
export const JEV_JUDGMENT_CONTRACT = Object.freeze({
  modelId: "jev-1.13.0",
  rubricVersion: "2",
  questionVersion: "2",
  requestSchemaVersion: "typesafe-systemone-game-pair-v1",
  scoreMappingVersion: "score-distribution-expected-level-0-through-3-normalized-v1",
  semanticPolicyId: "game-description-and-owner-note-similarity-v1",
} as const);

// Numeric compatibility exports retained for callers persisting the existing result shape.
export const JEV_RUBRIC_VERSION = Number(JEV_JUDGMENT_CONTRACT.rubricVersion) as 2;
export const JEV_QUESTION_VERSION = Number(JEV_JUDGMENT_CONTRACT.questionVersion) as 2;
