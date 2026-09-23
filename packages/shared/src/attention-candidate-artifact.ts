import { z } from "zod";
import { AttentionCandidateEvaluationSchema } from "./validation";

export const ATTENTION_CANDIDATE_ARTIFACT_SCHEMA_VERSION = 1;
export const ATTENTION_CANDIDATE_ARTIFACT_INDEX_VERSION = 1;
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const StrictInstantSchema = z.string().datetime({ offset: true });
const PositiveSafeInteger = z.number().int().safe().positive();
const AttentionCatalogRuleVersionSchema = z
  .object({
    ruleId: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    ruleVersion: PositiveSafeInteger,
    scoringVersion: PositiveSafeInteger,
  })
  .strict();

export const AttentionCandidateArtifactIdentitySchema = z
  .object({
    collectionId: z.string().min(1),
    collectionSchemaVersion: PositiveSafeInteger,
    collectionRevision: z.number().int().safe().nonnegative(),
    tournamentHash: Sha256Schema,
    predictionSettingsHash: Sha256Schema,
    redundancySettingsHash: Sha256Schema,
    calculationVersion: PositiveSafeInteger,
    ruleCatalogVersion: PositiveSafeInteger,
    dependencyVersion: PositiveSafeInteger,
    projectionVersion: PositiveSafeInteger,
    catalogRuleVersions: z.array(AttentionCatalogRuleVersionSchema),
  })
  .strict()
  .superRefine((identity, context) => {
    for (let index = 1; index < identity.catalogRuleVersions.length; index += 1) {
      const prior = identity.catalogRuleVersions[index - 1];
      const current = identity.catalogRuleVersions[index];
      if (prior === undefined || current === undefined || prior.ruleId < current.ruleId) continue;
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["catalogRuleVersions", index, "ruleId"],
        message: "Catalog rule versions must be unique and sorted by rule ID",
      });
    }
  });

export const AttentionCandidateArtifactRowSchema = z
  .object({
    gameId: z.string().min(1),
    nameOrderingKey: z
      .string()
      .min(1)
      .refine((value) => value === value.normalize("NFC")),
    evaluation: AttentionCandidateEvaluationSchema,
    winnerPresentation: z
      .object({
        reason: z.string().min(1),
        question: z.string().min(1),
        actions: z.array(z.string().min(1)),
        correctionDestination: z.string().min(1).nullable(),
      })
      .strict()
      .nullable(),
    nonClockFingerprint: Sha256Schema.nullable(),
    localDependencyGameIds: z.array(z.string().min(1)),
    sourceDependencyKeys: z.array(z.string().min(1)),
    bggIds: z.array(z.number().int().safe().positive()),
  })
  .strict()
  .superRefine((row, context) => {
    if (row.evaluation.gameId !== row.gameId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "gameId"],
        message: "Evaluation game ID must match row game ID",
      });
    if (
      row.evaluation.disposition !== null &&
      (row.evaluation.disposition.gameId !== row.gameId ||
        row.evaluation.disposition.gameId !== row.evaluation.gameId)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "disposition", "gameId"],
        message: "Disposition game ID must match row and evaluation game IDs",
      });
    if ((row.evaluation.winner === null) !== (row.winnerPresentation === null))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Winner presentation must match winner",
      });
    if (row.nonClockFingerprint !== (row.evaluation.winner?.fingerprint ?? null))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Non-clock fingerprint must match winner",
      });
  });

const IdArraySchema = z.array(z.string().min(1));
export const AttentionCandidateArtifactSchema = z
  .object({
    schemaVersion: z.literal(ATTENTION_CANDIDATE_ARTIFACT_SCHEMA_VERSION),
    indexVersion: z.literal(ATTENTION_CANDIDATE_ARTIFACT_INDEX_VERSION),
    identity: AttentionCandidateArtifactIdentitySchema,
    evaluatedAt: StrictInstantSchema,
    rows: z.array(AttentionCandidateArtifactRowSchema),
    dueBuckets: z.array(
      z.object({ boundary: StrictInstantSchema, gameIds: IdArraySchema }).strict(),
    ),
    earliestBoundary: StrictInstantSchema.nullable(),
    localDependencyIndex: z.array(
      z.object({ gameId: z.string().min(1), dependentGameIds: IdArraySchema }).strict(),
    ),
    sourceDependencyIndex: z.array(
      z.object({ key: z.string().min(1), gameIds: IdArraySchema }).strict(),
    ),
    bggIdentityIndex: z.array(
      z.object({ bggId: z.number().int().safe().positive(), gameIds: IdArraySchema }).strict(),
    ),
  })
  .strict()
  .superRefine((artifact, context) => {
    for (let index = 0; index < artifact.rows.length; index += 1) {
      const row = artifact.rows[index];
      if (row === undefined) continue;
      if (row.evaluation.dependencyVersion !== artifact.identity.dependencyVersion)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", index, "evaluation", "dependencyVersion"],
          message: "Evaluation dependency version must match artifact identity",
        });
      if (row.evaluation.ruleCatalogVersion !== artifact.identity.ruleCatalogVersion)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", index, "evaluation", "ruleCatalogVersion"],
          message: "Evaluation rule catalog version must match artifact identity",
        });
      const winner = row.evaluation.winner;
      const disposition = row.evaluation.disposition;
      const catalogRule =
        winner === null
          ? undefined
          : artifact.identity.catalogRuleVersions.find((rule) => rule.ruleId === winner.ruleId);
      if (winner !== null && catalogRule === undefined)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", index, "evaluation", "winner", "ruleId"],
          message: "Winner rule ID must exist in artifact catalog",
        });
      if (
        winner !== null &&
        catalogRule !== undefined &&
        winner.ruleVersion !== catalogRule.ruleVersion
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", index, "evaluation", "winner", "ruleVersion"],
          message: "Winner rule version must match artifact catalog",
        });
      if (disposition?.kind === "intentional") {
        const dispositionRule = artifact.identity.catalogRuleVersions.find(
          (rule) => rule.ruleId === disposition.ruleId,
        );
        if (
          dispositionRule === undefined ||
          disposition.ruleVersion !== dispositionRule.ruleVersion
        )
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["rows", index, "evaluation", "disposition", "ruleVersion"],
            message: "Intentional disposition rule version must match artifact catalog",
          });
      }
    }
    const rowIds = artifact.rows.map((row) => row.gameId);
    const rowSet = new Set(rowIds);
    if (rowSet.size !== rowIds.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rows"],
        message: "Rows must be unique by game ID",
      });
    const expected = new Map<string, string[]>();
    for (const row of artifact.rows)
      if (row.evaluation.nextEvaluationBoundary !== null)
        expected.set(row.evaluation.nextEvaluationBoundary, [
          ...(expected.get(row.evaluation.nextEvaluationBoundary) ?? []),
          row.gameId,
        ]);
    const actual = new Map(artifact.dueBuckets.map((bucket) => [bucket.boundary, bucket.gameIds]));
    if (actual.size !== artifact.dueBuckets.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueBuckets"],
        message: "Due buckets must be unique",
      });
    const canon = (values: readonly string[]) => [...values].sort().join("\u0000");
    for (const [boundary, ids] of expected)
      if (canon(ids) !== canon(actual.get(boundary) ?? []))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dueBuckets"],
          message: "Due buckets must exactly correspond to rows",
        });
    if (expected.size !== actual.size)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueBuckets"],
        message: "Due buckets must exactly correspond to rows",
      });
    const earliest =
      [...expected.keys()].sort(
        (a, b) => Date.parse(a) - Date.parse(b) || (a < b ? -1 : a > b ? 1 : 0),
      )[0] ?? null;
    if (artifact.earliestBoundary !== earliest)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["earliestBoundary"],
        message: "Earliest boundary must match due buckets",
      });
    const expectedLocal = new Map<string, string[]>();
    const expectedSource = new Map<string, string[]>();
    const expectedBgg = new Map<number, string[]>();
    for (const row of artifact.rows) {
      for (const id of row.localDependencyGameIds)
        expectedLocal.set(id, [...(expectedLocal.get(id) ?? []), row.gameId]);
      for (const key of row.sourceDependencyKeys)
        expectedSource.set(key, [...(expectedSource.get(key) ?? []), row.gameId]);
      for (const id of row.bggIds)
        expectedBgg.set(id, [...(expectedBgg.get(id) ?? []), row.gameId]);
    }
    const exactIndex = <Key extends string | number>(
      expectedIndex: Map<Key, string[]>,
      entries: readonly {
        readonly gameIds?: readonly string[];
        readonly dependentGameIds?: readonly string[];
        readonly key?: Key;
        readonly gameId?: Key;
        readonly bggId?: Key;
      }[],
    ): boolean => {
      const actualIndex = new Map<Key, readonly string[]>();
      for (const entry of entries) {
        const key = entry.key ?? entry.gameId ?? entry.bggId;
        const ids = entry.gameIds ?? entry.dependentGameIds;
        if (key === undefined || ids === undefined || actualIndex.has(key)) return false;
        actualIndex.set(key, ids);
      }
      return (
        actualIndex.size === expectedIndex.size &&
        [...expectedIndex].every(([key, ids]) => canon(ids) === canon(actualIndex.get(key) ?? []))
      );
    };
    if (!exactIndex(expectedLocal, artifact.localDependencyIndex))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["localDependencyIndex"],
        message: "Local dependency index must exactly correspond to rows",
      });
    if (!exactIndex(expectedSource, artifact.sourceDependencyIndex))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceDependencyIndex"],
        message: "Source dependency index must exactly correspond to rows",
      });
    if (!exactIndex(expectedBgg, artifact.bggIdentityIndex))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bggIdentityIndex"],
        message: "BGG identity index must exactly correspond to rows",
      });
    for (const entry of artifact.localDependencyIndex)
      for (const gameId of entry.dependentGameIds)
        if (!rowSet.has(gameId))
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Index references missing row",
          });
    for (const entry of artifact.sourceDependencyIndex)
      for (const gameId of entry.gameIds)
        if (!rowSet.has(gameId))
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Index references missing row",
          });
    for (const entry of artifact.bggIdentityIndex)
      for (const gameId of entry.gameIds)
        if (!rowSet.has(gameId))
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Index references missing row",
          });
  });
export type AttentionCandidateArtifact = z.infer<typeof AttentionCandidateArtifactSchema>;
export type AttentionCandidateArtifactIdentity = z.infer<
  typeof AttentionCandidateArtifactIdentitySchema
>;
