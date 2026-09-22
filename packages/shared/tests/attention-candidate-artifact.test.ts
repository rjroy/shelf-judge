import { describe, expect, test } from "bun:test";
import {
  ATTENTION_CANDIDATE_ARTIFACT_INDEX_VERSION,
  ATTENTION_CANDIDATE_ARTIFACT_SCHEMA_VERSION,
  AttentionCandidateArtifactSchema,
  AttentionCandidateArtifactRowSchema,
} from "../src/index.js";

const hash = "a".repeat(64);
function artifact() {
  return {
    schemaVersion: ATTENTION_CANDIDATE_ARTIFACT_SCHEMA_VERSION,
    indexVersion: ATTENTION_CANDIDATE_ARTIFACT_INDEX_VERSION,
    identity: {
      collectionId: "collection",
      collectionSchemaVersion: 8,
      collectionRevision: 1,
      tournamentHash: hash,
      predictionSettingsHash: hash,
      redundancySettingsHash: hash,
      calculationVersion: 1,
      ruleCatalogVersion: 1,
      dependencyVersion: 1,
      projectionVersion: 1,
      catalogRuleVersions: [{ ruleId: "never-played", ruleVersion: 1, scoringVersion: 1 }],
    },
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    rows: [
      {
        gameId: "game",
        nameOrderingKey: "Gáme",
        evaluation: {
          gameId: "game",
          winner: {
            ruleId: "never-played",
            ruleVersion: 1,
            signalStrength: { numerator: "1", denominator: "1" },
            categoryWeight: { numerator: "1", denominator: "1" },
            attentionScore: { numerator: "1", denominator: "1" },
            fingerprint: hash,
          },
          disposition: null,
          nextEvaluationBoundary: "2026-02-01T00:00:00.000Z",
          dependencyVersion: 1,
          ruleCatalogVersion: 1,
        },
        winnerPresentation: {
          reason: "Reason",
          question: "Question",
          actions: ["action"],
          correctionDestination: null,
        },
        nonClockFingerprint: hash,
        localDependencyGameIds: ["game"],
        sourceDependencyKeys: ["plays"],
        bggIds: [1],
      },
    ],
    dueBuckets: [{ boundary: "2026-02-01T00:00:00.000Z", gameIds: ["game"] }],
    earliestBoundary: "2026-02-01T00:00:00.000Z",
    localDependencyIndex: [{ gameId: "game", dependentGameIds: ["game"] }],
    sourceDependencyIndex: [{ key: "plays", gameIds: ["game"] }],
    bggIdentityIndex: [{ bggId: 1, gameIds: ["game"] }],
  };
}

describe("attention candidate artifact contract", () => {
  test("accepts complete canonical rows and exact indexes", () => {
    expect(AttentionCandidateArtifactSchema.safeParse(artifact()).success).toBe(true);
  });
  test("requires the evaluation identity to match its row independently of indexes", () => {
    const row = artifact().rows[0];
    if (row === undefined) throw new Error("fixture row missing");

    const matching = AttentionCandidateArtifactRowSchema.safeParse(row);
    expect(matching.success).toBe(true);

    const mismatching = AttentionCandidateArtifactRowSchema.safeParse({
      ...row,
      evaluation: { ...row.evaluation, gameId: "other-game" },
    });
    expect(mismatching.success).toBe(false);
    if (mismatching.success) throw new Error("mismatched row unexpectedly accepted");
    expect(
      mismatching.error.issues.some(
        (issue) =>
          issue.path.join(".") === "evaluation.gameId" &&
          issue.message === "Evaluation game ID must match row game ID",
      ),
    ).toBe(true);
  });
  test("requires each disposition identity to match its row and evaluation", () => {
    const row = artifact().rows[0];
    if (row === undefined) throw new Error("fixture row missing");
    const dispositions = [
      {
        gameId: "game",
        kind: "snoozed",
        ruleId: "never-played",
        ruleVersion: 1,
        fingerprint: hash,
        responseAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-31T00:00:00.000Z",
        version: 1,
      },
      {
        gameId: "game",
        kind: "intentional",
        ruleId: "never-played",
        ruleVersion: 1,
        fingerprint: hash,
        version: 1,
      },
    ] as const;
    for (const disposition of dispositions) {
      expect(
        AttentionCandidateArtifactRowSchema.safeParse({
          ...row,
          evaluation: { ...row.evaluation, disposition },
        }).success,
      ).toBe(true);

      const mismatching = AttentionCandidateArtifactRowSchema.safeParse({
        ...row,
        evaluation: {
          ...row.evaluation,
          disposition: { ...disposition, gameId: "other-game" },
        },
      });
      expect(mismatching.success).toBe(false);
      if (mismatching.success) throw new Error("mismatched disposition unexpectedly accepted");
      expect(
        mismatching.error.issues.some(
          (issue) =>
            issue.path.join(".") === "evaluation.disposition.gameId" &&
            issue.message === "Disposition game ID must match row and evaluation game IDs",
        ),
      ).toBe(true);
    }
  });
  test("rejects version, hash, timestamp, exact-score, duplicate, and index defects", () => {
    const cases = [
      { ...artifact(), schemaVersion: 2 },
      { ...artifact(), identity: { ...artifact().identity, tournamentHash: "not-a-hash" } },
      { ...artifact(), evaluatedAt: "tomorrow" },
      (() => {
        const value = artifact();
        const row = value.rows[0];
        if (row === undefined || row.evaluation.winner === null)
          throw new Error("fixture winner missing");
        return {
          ...value,
          rows: [
            {
              ...row,
              evaluation: {
                ...row.evaluation,
                winner: {
                  ...row.evaluation.winner,
                  attentionScore: { numerator: "0", denominator: "1" },
                },
              },
            },
          ],
        };
      })(),
      { ...artifact(), rows: [artifact().rows[0], artifact().rows[0]] },
      { ...artifact(), dueBuckets: [] },
      { ...artifact(), sourceDependencyIndex: [] },
      { ...artifact(), bggIdentityIndex: [{ bggId: 1, gameIds: ["missing"] }] },
    ];
    for (const value of cases)
      expect(AttentionCandidateArtifactSchema.safeParse(value).success).toBe(false);
  });
  test("rejects row versions mixed with the artifact identity, including null-winner rows", () => {
    const matching = artifact();
    expect(AttentionCandidateArtifactSchema.safeParse(matching).success).toBe(true);
    for (const field of ["dependencyVersion", "ruleCatalogVersion"] as const) {
      const value = artifact();
      const row = value.rows[0];
      if (row === undefined) throw new Error("fixture row missing");
      expect(
        AttentionCandidateArtifactSchema.safeParse({
          ...value,
          rows: [
            {
              ...row,
              winnerPresentation: null,
              nonClockFingerprint: null,
              evaluation: { ...row.evaluation, winner: null, [field]: 2 },
            },
          ],
        }).success,
        field,
      ).toBe(false);
    }
    const value = artifact();
    const row = value.rows[0];
    if (row === undefined || row.evaluation.winner === null)
      throw new Error("fixture winner missing");
    expect(
      AttentionCandidateArtifactSchema.safeParse({
        ...value,
        rows: [
          {
            ...row,
            evaluation: {
              ...row.evaluation,
              disposition: {
                gameId: "game",
                kind: "intentional",
                ruleId: row.evaluation.winner.ruleId,
                ruleVersion: 2,
                fingerprint: hash,
                version: 1,
              },
            },
          },
        ],
      }).success,
    ).toBe(false);
  });
  test("enforces the sorted catalog manifest for winners and active intentional dispositions", () => {
    const base = artifact();
    const row = base.rows[0];
    if (row === undefined || row.evaluation.winner === null)
      throw new Error("fixture winner missing");
    const cases: readonly { readonly name: string; readonly value: unknown }[] = [
      {
        name: "unknown winner rule",
        value: {
          ...base,
          rows: [
            {
              ...row,
              evaluation: {
                ...row.evaluation,
                winner: { ...row.evaluation.winner, ruleId: "unknown-rule" },
              },
            },
          ],
        },
      },
      {
        name: "wrong winner version",
        value: {
          ...base,
          rows: [
            {
              ...row,
              evaluation: {
                ...row.evaluation,
                winner: { ...row.evaluation.winner, ruleVersion: 2 },
              },
            },
          ],
        },
      },
      {
        name: "duplicate manifest",
        value: {
          ...base,
          identity: {
            ...base.identity,
            catalogRuleVersions: [
              ...base.identity.catalogRuleVersions,
              base.identity.catalogRuleVersions[0],
            ],
          },
        },
      },
      {
        name: "unsorted manifest",
        value: {
          ...base,
          identity: {
            ...base.identity,
            catalogRuleVersions: [
              { ruleId: "z-rule", ruleVersion: 1, scoringVersion: 1 },
              ...base.identity.catalogRuleVersions,
            ],
          },
        },
      },
      {
        name: "stale intentional disposition",
        value: {
          ...base,
          rows: [
            {
              ...row,
              winnerPresentation: null,
              nonClockFingerprint: null,
              evaluation: {
                ...row.evaluation,
                winner: null,
                disposition: {
                  gameId: "game",
                  kind: "intentional",
                  ruleId: "never-played",
                  ruleVersion: 2,
                  fingerprint: hash,
                  version: 1,
                },
              },
            },
          ],
        },
      },
    ];
    for (const fixture of cases)
      expect(AttentionCandidateArtifactSchema.safeParse(fixture.value).success, fixture.name).toBe(
        false,
      );

    const snoozed = AttentionCandidateArtifactSchema.safeParse({
      ...base,
      rows: [
        {
          ...row,
          winnerPresentation: null,
          nonClockFingerprint: null,
          evaluation: {
            ...row.evaluation,
            winner: null,
            nextEvaluationBoundary: "2026-01-31T00:00:00.000Z",
            disposition: {
              gameId: "game",
              kind: "snoozed",
              ruleId: "never-played",
              ruleVersion: 99,
              fingerprint: hash,
              responseAt: "2026-01-01T00:00:00.000Z",
              expiresAt: "2026-01-31T00:00:00.000Z",
              version: 1,
            },
          },
        },
      ],
      dueBuckets: [{ boundary: "2026-01-31T00:00:00.000Z", gameIds: ["game"] }],
      earliestBoundary: "2026-01-31T00:00:00.000Z",
    });
    expect(snoozed.success).toBe(true);
  });
});
