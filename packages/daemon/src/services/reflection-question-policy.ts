import {
  REFLECTION_QUESTION_POLICIES,
  type CollectionProfile,
  type ReflectionEvidenceClass,
  type ReflectionQuestionId,
} from "@shelf-judge/shared";

export const REFLECTION_PATTERN_CLASS_ORDER = ["mechanic", "designer", "artist"] as const;
export const DEFAULT_REFLECTION_EVIDENCE_PAGE_SIZE = 25;
export const MAX_REFLECTION_EVIDENCE_PAGE_SIZE = 100;

export interface ReflectionProjectionPolicy {
  readonly questionId: ReflectionQuestionId;
  readonly evidenceClasses: readonly ReflectionEvidenceClass[];
  readonly includesAllOwnedGames: boolean;
  readonly requiresCompletePatternCandidates: boolean;
}

export const REFLECTION_PROJECTION_POLICIES: Readonly<
  Record<ReflectionQuestionId, ReflectionProjectionPolicy>
> = Object.freeze({
  "repeated-values": Object.freeze({
    questionId: "repeated-values",
    evidenceClasses: REFLECTION_QUESTION_POLICIES["repeated-values"].authorizedEvidenceClasses,
    includesAllOwnedGames: true,
    requiresCompletePatternCandidates: false,
  }),
  "pattern-exceptions": Object.freeze({
    questionId: "pattern-exceptions",
    evidenceClasses: REFLECTION_QUESTION_POLICIES["pattern-exceptions"].authorizedEvidenceClasses,
    includesAllOwnedGames: false,
    requiresCompletePatternCandidates: true,
  }),
  "recurring-trade-offs": Object.freeze({
    questionId: "recurring-trade-offs",
    evidenceClasses: REFLECTION_QUESTION_POLICIES["recurring-trade-offs"].authorizedEvidenceClasses,
    includesAllOwnedGames: true,
    requiresCompletePatternCandidates: false,
  }),
});

export function reflectionPatternCandidateIds(profile: CollectionProfile): string[] {
  return REFLECTION_PATTERN_CLASS_ORDER.flatMap((entityClass) =>
    profile.identity.classes[entityClass].overviewEntityIds.map(
      (entityId) => `${entityClass}:${entityId}`,
    ),
  );
}
