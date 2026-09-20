import { z } from "zod";
import {
  AcceptedPlaySourceTupleSchema,
  CanonicalSourceTimestampSchema,
  SourceRecordIdSchema,
  acceptedPlayObservationIdentity,
} from "./accepted-play-sources";

const SourceStatusFields = {
  source: AcceptedPlaySourceTupleSchema,
  currentCheckId: SourceRecordIdSchema.nullable(),
  supersededCheckIds: z.array(SourceRecordIdSchema),
  boundary: z
    .object({
      boundaryId: SourceRecordIdSchema,
      refreshedAt: CanonicalSourceTimestampSchema,
      checkId: SourceRecordIdSchema,
    })
    .strict()
    .nullable(),
};
const ObservationFields = {
  observationId: z.string().min(1),
  count: z.number().int().safe().nonnegative(),
  observedAt: CanonicalSourceTimestampSchema,
  receivedAt: CanonicalSourceTimestampSchema,
};
export const AttentionAcceptedSourceStatusSchema = z
  .discriminatedUnion("status", [
    z.object({ ...SourceStatusFields, status: z.literal("valid"), ...ObservationFields }).strict(),
    z.object({ ...SourceStatusFields, status: z.literal("stale"), ...ObservationFields }).strict(),
    z
      .object({
        ...SourceStatusFields,
        status: z.literal("missing"),
        reason: z.enum(["legacy-unavailable", "not-checked", "no-data", "not-found"]),
      })
      .strict(),
    z
      .object({
        ...SourceStatusFields,
        status: z.literal("invalid"),
        reason: z.enum([
          "missing-observed-at",
          "validation",
          "transport",
          "partial-response",
          "contradiction",
        ]),
      })
      .strict(),
  ])
  .superRefine((source, context) => {
    const issue = (message: string) => context.addIssue({ code: "custom", message });
    if (
      new Set(source.supersededCheckIds).size !== source.supersededCheckIds.length ||
      (source.currentCheckId !== null && source.supersededCheckIds.includes(source.currentCheckId))
    )
      issue("Current and superseded check identities must be disjoint and unique");
    if (source.status === "valid" || source.status === "stale") {
      const fresh = source.boundary === null || source.observedAt > source.boundary.refreshedAt;
      if (source.currentCheckId === null || fresh !== (source.status === "valid"))
        issue("Source freshness must match its scoped boundary and current check");
    } else if (
      (source.status === "missing" &&
        ["legacy-unavailable", "not-checked"].includes(source.reason)) !==
      (source.currentCheckId === null)
    )
      issue("Only an unchecked source may lack a current check");
  });
export type AttentionAcceptedSourceStatus = z.infer<typeof AttentionAcceptedSourceStatusSchema>;

/** Validates daemon-produced evidence; it does not select cards or read durable source state. */
export const AttentionAcceptedPlayEvidenceSchema = z
  .object({
    gameId: z.string().min(1),
    evaluatorId: z.literal("profile-attention"),
    evaluatorVersion: z.number().int().safe().positive(),
    requiredSourceSet: z.array(AcceptedPlaySourceTupleSchema).nonempty(),
    sources: z.array(AttentionAcceptedSourceStatusSchema).nonempty(),
    status: z.enum(["agreement", "invalid", "missing", "stale", "disagreement"]),
    count: z.number().int().safe().nonnegative().nullable(),
    warning: z
      .enum([
        "Current play evidence is missing.",
        "Current play evidence is invalid.",
        "A newer BGG check did not provide a valid play count.",
        "Accepted play sources disagree.",
      ])
      .nullable(),
  })
  .strict()
  .superRefine((evidence, context) => {
    const issue = (message: string) => context.addIssue({ code: "custom", message });
    for (const source of evidence.sources) {
      if (
        (source.status === "valid" || source.status === "stale") &&
        source.currentCheckId !== null &&
        source.observationId !==
          acceptedPlayObservationIdentity({
            ...source.source,
            gameId: evidence.gameId,
            observedAt: source.observedAt,
            receivedAt: source.receivedAt,
            checkId: source.currentCheckId,
          })
      )
        issue(
          "Evidence observation identity must match its game, stream, times, and current check",
        );
      if (
        source.currentCheckId === null &&
        (source.boundary !== null || source.supersededCheckIds.length !== 0)
      )
        issue("An unchecked source cannot have a boundary or superseded checks");
    }
    const tuples = evidence.requiredSourceSet.map((s) => JSON.stringify(s));
    if (
      new Set(tuples).size !== tuples.length ||
      evidence.sources.length !== tuples.length ||
      evidence.sources.some((s, i) => JSON.stringify(s.source) !== tuples[i])
    )
      issue("Evidence must identify exactly the ordered required sources");
    if (
      evidence.evaluatorVersion === 1 &&
      (evidence.requiredSourceSet.length !== 1 ||
        evidence.requiredSourceSet[0]?.sourceId !== "bgg-collection-aggregate")
    )
      issue("Evaluator v1 requires the aggregate singleton");
    const statuses = evidence.sources.map((s) => s.status);
    const counts = evidence.sources.flatMap((s) => (s.status === "valid" ? [s.count] : []));
    const expected = statuses.includes("invalid")
      ? "invalid"
      : statuses.includes("missing")
        ? "missing"
        : statuses.includes("stale")
          ? "stale"
          : new Set(counts).size > 1
            ? "disagreement"
            : "agreement";
    const warnings = {
      invalid: "Current play evidence is invalid.",
      missing: "Current play evidence is missing.",
      stale: "A newer BGG check did not provide a valid play count.",
      disagreement: "Accepted play sources disagree.",
    } as const;
    if (
      evidence.status !== expected ||
      evidence.count !== (expected === "agreement" ? counts[0] : null) ||
      evidence.warning !== (expected === "agreement" ? null : warnings[expected])
    )
      issue("Evidence status, count, and warning must agree with required source statuses");
  });
export type AttentionAcceptedPlayEvidence = z.infer<typeof AttentionAcceptedPlayEvidenceSchema>;
