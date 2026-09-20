import { z } from "zod";

export const CanonicalSourceTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    const time = Date.parse(value);
    return Number.isFinite(time) && new Date(time).toISOString() === value;
  }, "Expected a canonical UTC millisecond timestamp");
export const SourceRecordIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
const CountSchema = z.number().int().safe().nonnegative();
const GameIdSchema = z
  .string()
  .min(1)
  .refine(
    (id) =>
      id.trim() === id &&
      [...id].every((character) => {
        const point = character.codePointAt(0) ?? 0;
        return point > 31 && point !== 127;
      }),
    "Expected a stable game ID",
  );

export const ACCEPTED_PLAY_SOURCE_REGISTRY = [
  {
    sourceId: "bgg-collection-aggregate",
    sourceVersion: 1,
    checkDefinitionId: "bgg.aggregate.total.v1",
    sourceClass: "bgg",
    semantics: "aggregate-total",
  },
  {
    sourceId: "bgg-play-sessions",
    sourceVersion: 1,
    checkDefinitionId: "bgg.plays.snapshot.v1",
    sourceClass: "bgg",
    semantics: "complete-session-snapshot",
  },
  {
    sourceId: "owner-manual-correction",
    sourceVersion: 1,
    checkDefinitionId: "owner.manual-correction.v1",
    sourceClass: "owner",
    semantics: "current-count-correction",
  },
] as const;

export const AcceptedPlaySourceTupleSchema = z
  .object({
    sourceId: z.enum(["bgg-collection-aggregate", "bgg-play-sessions", "owner-manual-correction"]),
    sourceVersion: z.literal(1),
    checkDefinitionId: z.enum([
      "bgg.aggregate.total.v1",
      "bgg.plays.snapshot.v1",
      "owner.manual-correction.v1",
    ]),
  })
  .strict()
  .refine(
    (tuple) =>
      ACCEPTED_PLAY_SOURCE_REGISTRY.some(
        (entry) =>
          entry.sourceId === tuple.sourceId &&
          entry.sourceVersion === tuple.sourceVersion &&
          entry.checkDefinitionId === tuple.checkDefinitionId,
      ),
    "Unregistered source/check tuple",
  );

export type AcceptedPlaySourceTuple = z.infer<typeof AcceptedPlaySourceTupleSchema>;
const StreamFields = {
  gameId: GameIdSchema,
  sourceId: z.enum(["bgg-collection-aggregate", "bgg-play-sessions", "owner-manual-correction"]),
  sourceVersion: z.literal(1),
  checkDefinitionId: z.enum([
    "bgg.aggregate.total.v1",
    "bgg.plays.snapshot.v1",
    "owner.manual-correction.v1",
  ]),
};
type Stream = AcceptedPlaySourceTuple & { gameId: string };
export function acceptedPlayStreamIdentity(stream: Stream): string {
  return JSON.stringify([
    stream.gameId,
    stream.sourceId,
    stream.sourceVersion,
    stream.checkDefinitionId,
  ]);
}
export function acceptedPlayObservationIdentity(
  observation: Stream & { observedAt: string; receivedAt: string; checkId: string },
): string {
  return JSON.stringify([
    observation.gameId,
    observation.sourceId,
    observation.sourceVersion,
    observation.checkDefinitionId,
    observation.observedAt,
    observation.receivedAt,
    observation.checkId,
  ]);
}
function registered(stream: Stream): boolean {
  return AcceptedPlaySourceTupleSchema.safeParse({
    sourceId: stream.sourceId,
    sourceVersion: stream.sourceVersion,
    checkDefinitionId: stream.checkDefinitionId,
  }).success;
}

const SnapshotSessionSchema = z
  .object({
    playId: z.number().int().safe().positive(),
    bggId: z.number().int().safe().positive(),
    quantity: z.number().int().safe().positive(),
    playedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((date) => {
        const time = Date.parse(`${date}T00:00:00.000Z`);
        return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date;
      }),
  })
  .strict();

export const AcceptedPlayObservationSchema = z
  .object({
    ...StreamFields,
    observationId: z.string().min(1),
    checkId: SourceRecordIdSchema,
    observedAt: CanonicalSourceTimestampSchema,
    receivedAt: CanonicalSourceTimestampSchema,
    count: CountSchema,
    payloadIdentity: z.string().regex(/^[a-f0-9]{64}$/),
    /** Retain this additive snapshot independently of legacy bggPlaySessions. */
    sessions: z.array(SnapshotSessionSchema).optional(),
  })
  .strict()
  .superRefine((observation, context) => {
    if (!registered(observation))
      context.addIssue({ code: "custom", message: "Unregistered observation stream" });
    if (observation.observationId !== acceptedPlayObservationIdentity(observation))
      context.addIssue({
        code: "custom",
        path: ["observationId"],
        message: "Observation identity must be canonical",
      });
    if (observation.sourceId === "bgg-play-sessions") {
      const sessions = observation.sessions;
      if (
        sessions === undefined ||
        new Set(sessions.map((s) => s.playId)).size !== sessions.length ||
        sessions.reduce((sum, s) => sum + s.quantity, 0) !== observation.count
      )
        context.addIssue({
          code: "custom",
          path: ["sessions"],
          message: "Complete deduplicated snapshot quantity must equal the observation count",
        });
    } else if (observation.sessions !== undefined)
      context.addIssue({
        code: "custom",
        path: ["sessions"],
        message: "Only a plays snapshot may contain sessions",
      });
  });
export type AcceptedPlayObservation = z.infer<typeof AcceptedPlayObservationSchema>;

const CheckFields = {
  ...StreamFields,
  checkId: SourceRecordIdSchema,
  receivedAt: CanonicalSourceTimestampSchema,
};
export const AcceptedPlayCheckSchema = z
  .discriminatedUnion("outcome", [
    z
      .object({
        ...CheckFields,
        outcome: z.literal("valid"),
        observationId: z.string().min(1),
        count: CountSchema,
      })
      .strict(),
    z
      .object({
        ...CheckFields,
        outcome: z.literal("missing"),
        reason: z.enum(["no-data", "not-found"]),
      })
      .strict(),
    z
      .object({
        ...CheckFields,
        outcome: z.literal("invalid"),
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
  .refine(registered, "Unregistered check stream");
export type AcceptedPlayCheck = z.infer<typeof AcceptedPlayCheckSchema>;

export const AcceptedPlayEvaluatorPolicySchema = z
  .object({
    gameId: GameIdSchema,
    evaluatorId: z.literal("profile-attention"),
    evaluatorVersion: z.number().int().safe().positive(),
    requiredSourceSet: z.array(AcceptedPlaySourceTupleSchema).nonempty(),
  })
  .strict()
  .superRefine((policy, context) => {
    const keys = policy.requiredSourceSet.map((s) =>
      acceptedPlayStreamIdentity({ ...s, gameId: policy.gameId }),
    );
    if (new Set(keys).size !== keys.length)
      context.addIssue({ code: "custom", message: "Required sources must be unique" });
    if (
      policy.evaluatorVersion === 1 &&
      (policy.requiredSourceSet.length !== 1 ||
        policy.requiredSourceSet[0]?.sourceId !== "bgg-collection-aggregate")
    )
      context.addIssue({
        code: "custom",
        message: "Evaluator v1 requires exactly the linked aggregate tuple",
      });
  });
export type AcceptedPlayEvaluatorPolicy = z.infer<typeof AcceptedPlayEvaluatorPolicySchema>;

export const AcceptedPlayFreshnessBoundarySchema = z
  .object({
    ...StreamFields,
    evaluatorId: z.literal("profile-attention"),
    evaluatorVersion: z.number().int().safe().positive(),
    boundaryId: SourceRecordIdSchema,
    refreshedAt: CanonicalSourceTimestampSchema,
    checkId: SourceRecordIdSchema,
  })
  .strict()
  .refine(registered, "Unregistered boundary stream");
export type AcceptedPlayFreshnessBoundary = z.infer<typeof AcceptedPlayFreshnessBoundarySchema>;

export const AcceptedPlaySourceDataSchema = z
  .object({
    representationVersion: z.literal(1),
    registry: z.array(
      z
        .object({
          ...StreamFields,
          sourceClass: z.enum(["bgg", "owner"]),
          semantics: z.enum([
            "aggregate-total",
            "complete-session-snapshot",
            "current-count-correction",
          ]),
        })
        .omit({ gameId: true })
        .strict(),
    ),
    observations: z.array(AcceptedPlayObservationSchema),
    checks: z.array(AcceptedPlayCheckSchema),
    evaluatorPolicies: z.array(AcceptedPlayEvaluatorPolicySchema),
    freshnessBoundaries: z.array(AcceptedPlayFreshnessBoundarySchema),
    legacyGameIds: z.array(GameIdSchema),
  })
  .strict()
  .superRefine((data, context) => {
    const issue = (message: string) => context.addIssue({ code: "custom", message });
    if (
      data.registry.length !== ACCEPTED_PLAY_SOURCE_REGISTRY.length ||
      data.registry.some((entry, index) => {
        const expected = ACCEPTED_PLAY_SOURCE_REGISTRY[index];
        return (
          !expected ||
          Object.entries(expected).some(([key, value]) => Reflect.get(entry, key) !== value)
        );
      })
    )
      issue("Registry must contain the closed v1 definitions in canonical order");
    const unique = (keys: string[], message: string) => {
      if (new Set(keys).size !== keys.length) issue(message);
    };
    unique(data.legacyGameIds, "Duplicate migration-origin game");
    unique(
      data.observations.map((o) => o.observationId),
      "Duplicate canonical observation identity",
    );
    const checkKey = (c: Stream & { checkId: string }) =>
      `${acceptedPlayStreamIdentity(c)}:${c.checkId}`;
    unique(
      data.checks.map(checkKey),
      "Duplicate canonical check identity; replay must be deduplicated before persistence",
    );
    const policyKey = (p: { gameId: string; evaluatorId: string; evaluatorVersion: number }) =>
      JSON.stringify([p.gameId, p.evaluatorId, p.evaluatorVersion]);
    unique(data.evaluatorPolicies.map(policyKey), "Duplicate evaluator policy snapshot");
    unique(
      data.freshnessBoundaries.map((b) =>
        JSON.stringify([
          acceptedPlayStreamIdentity(b),
          b.evaluatorId,
          b.evaluatorVersion,
          b.boundaryId,
        ]),
      ),
      "Duplicate boundary identity",
    );
    const observations = new Map(data.observations.map((o) => [o.observationId, o]));
    const checks = new Map(data.checks.map((c) => [checkKey(c), c]));
    for (const check of data.checks) {
      if (check.outcome !== "valid") continue;
      const observation = observations.get(check.observationId);
      if (
        !observation ||
        checkKey(observation) !== checkKey(check) ||
        observation.receivedAt !== check.receivedAt ||
        observation.count !== check.count
      )
        issue("Valid check must reference its exact observation, time, and count");
    }
    for (const observation of data.observations) {
      const check = checks.get(checkKey(observation));
      if (check?.outcome !== "valid" || check.observationId !== observation.observationId)
        issue("Observation must belong to exactly one valid check");
    }
    for (const boundary of data.freshnessBoundaries) {
      const check = checks.get(checkKey(boundary));
      const policy = data.evaluatorPolicies.find((p) => policyKey(p) === policyKey(boundary));
      if (
        !check ||
        boundary.refreshedAt > check.receivedAt ||
        !policy?.requiredSourceSet.some(
          (s) =>
            acceptedPlayStreamIdentity({ ...s, gameId: boundary.gameId }) ===
            acceptedPlayStreamIdentity(boundary),
        )
      )
        issue(
          "Boundary must reference an establishing check and required source in its evaluator scope",
        );
    }
  });
export type AcceptedPlaySourceData = z.infer<typeof AcceptedPlaySourceDataSchema>;

/** Empty new streams never borrow legacy evidence or fabricate source actions. */
export function createAcceptedPlaySourceData(
  games: readonly { id: string; bggId: number | null }[] = [],
  legacy = false,
): AcceptedPlaySourceData {
  return {
    representationVersion: 1,
    registry: ACCEPTED_PLAY_SOURCE_REGISTRY.map((s) => ({ ...s })),
    observations: [],
    checks: [],
    freshnessBoundaries: [],
    evaluatorPolicies: games
      .filter((g) => g.bggId !== null)
      .map((g) => ({
        gameId: g.id,
        evaluatorId: "profile-attention",
        evaluatorVersion: 1,
        requiredSourceSet: [
          {
            sourceId: "bgg-collection-aggregate",
            sourceVersion: 1,
            checkDefinitionId: "bgg.aggregate.total.v1",
          },
        ],
      })),
    legacyGameIds: legacy ? games.map((g) => g.id) : [],
  };
}
