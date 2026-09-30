import { describe, expect, test } from "bun:test";
import {
  createInitialSemanticRedundancyState,
  SemanticDisclosureManifestSchema,
  SemanticExecutionSchema,
  SemanticPublishedPairOutcomeSchema,
  SemanticRedundancyGenerationSchema,
  SemanticRedundancyStateSchema,
  semanticDisclosureManifestDigest,
} from "../src/index.js";

const fingerprint = "a".repeat(64);

function manifestFor(ids: string[]) {
  const sorted = [...ids].sort();
  const pairs = sorted.flatMap((gameA, index) =>
    sorted.slice(index + 1).map((gameB) => ({
      gameA,
      gameB,
      hasDescriptionA: false,
      hasDescriptionB: false,
      hasOwnerNoteA: false,
      hasOwnerNoteB: false,
      descriptionFingerprintA: null,
      descriptionFingerprintB: null,
      noteVersionA: null,
      noteVersionB: null,
    })),
  );
  const base = {
    id: "manifest-id",
    sourceIdentity: {
      collectionId: "collection-id",
      collectionSchemaVersion: 9 as const,
      collectionRevision: 4,
      evidenceEpoch: 2,
      consentEpoch: 1,
      factualWeightsEpoch: 0,
      factualWeightsFingerprint: null,
      tournamentHash: fingerprint,
      predictionSettingsHash: fingerprint,
      redundancySettingsHash: fingerprint,
    },
    scoringVersion: 1,
    signalScope: "description-only" as const,
    providerId: "typesafe",
    modelId: "jev-pinned",
    rubricVersion: 1,
    budget: { maxRequests: 19_900, maxTokens: Number.MAX_SAFE_INTEGER, maxDurationMs: 60_000 },
    expiresAt: "2026-09-30T00:00:00.000Z",
    eligibleGameIds: sorted,
    pairs,
  };
  return { ...base, digest: semanticDisclosureManifestDigest(base) };
}

function stateWith(description: unknown, ownerNote: unknown) {
  return {
    ...createInitialSemanticRedundancyState(),
    pairJudgments: [{ gameA: "game-a", gameB: "game-b", description, ownerNote }],
  };
}

const scoredBase = {
  status: "scored" as const,
  score: 0.75,
  confidence: null,
  modelId: "jev-pinned",
  rubricVersion: 1,
  sourceFingerprintA: fingerprint,
  sourceFingerprintB: fingerprint,
};

describe("semantic redundancy provenance schema", () => {
  test("accepts an empty and maximum-size canonical exact manifest, but no extra payload", () => {
    expect(SemanticDisclosureManifestSchema.safeParse(manifestFor([])).success).toBe(true);
    const maximum = manifestFor(
      Array.from({ length: 200 }, (_, index) => `game-${String(index).padStart(3, "0")}`),
    );
    expect(maximum.pairs).toHaveLength(19_900);
    expect(SemanticDisclosureManifestSchema.safeParse(maximum).success).toBe(true);
    expect(
      SemanticDisclosureManifestSchema.safeParse({ ...maximum, pairs: maximum.pairs.slice(0, -1) })
        .success,
    ).toBe(false);
    expect(
      SemanticDisclosureManifestSchema.safeParse({ ...manifestFor([]), prompt: "forbidden" })
        .success,
    ).toBe(false);
    const manifest = manifestFor([]);
    expect(
      SemanticDisclosureManifestSchema.safeParse({ ...manifest, modelId: "another-model" }).success,
    ).toBe(false);
    expect(
      SemanticDisclosureManifestSchema.safeParse({
        ...manifestFor([]),
        eligibleGameIds: ["z", "a"],
      }).success,
    ).toBe(false);
    expect(
      SemanticDisclosureManifestSchema.safeParse({
        ...manifestFor(["a", "b"]),
        budget: { maxRequests: Number.MAX_SAFE_INTEGER + 1, maxTokens: 1, maxDurationMs: 1 },
      }).success,
    ).toBe(false);
    const digestInput = (manifest: ReturnType<typeof manifestFor>) => {
      const input = { ...manifest };
      delete (input as Partial<typeof manifest>).digest;
      delete (input as Partial<typeof manifest>).id;
      return input;
    };
    expect(
      semanticDisclosureManifestDigest({
        ...digestInput(manifest),
        sourceIdentity: { ...manifest.sourceIdentity, collectionRevision: 5 },
      }),
    ).not.toBe(manifest.digest);
    expect(
      semanticDisclosureManifestDigest({
        ...digestInput(manifest),
        signalScope: "owner-notes-only",
      }),
    ).not.toBe(manifest.digest);
    expect(
      semanticDisclosureManifestDigest({ ...digestInput(manifest), modelId: "different-model" }),
    ).not.toBe(manifest.digest);
    expect(
      semanticDisclosureManifestDigest({
        ...digestInput(manifest),
        budget: { ...manifest.budget, maxTokens: manifest.budget.maxTokens - 1 },
      }),
    ).not.toBe(manifest.digest);
  });

  test("validates strict execution and numeric published-generation snapshots", () => {
    const manifest = manifestFor(["game-a", "game-b"]);
    const execution = {
      commandId: "refresh-command",
      manifestDigest: manifest.digest,
      sourceIdentity: manifest.sourceIdentity,
      signalScope: "description-only" as const,
      noteTransmissionAuthorized: false,
      cachedOwnerNoteUseAuthorized: false,
      status: "disclosed" as const,
      attemptCount: 0,
      completedPairCount: 0,
      failedPairCount: 0,
      deadlineAt: "2026-09-30T00:00:00.000Z",
      startedAt: null,
      endedAt: null,
    };
    expect(SemanticExecutionSchema.safeParse(execution).success).toBe(true);
    expect(
      SemanticExecutionSchema.safeParse({
        ...execution,
        signalScope: "owner-notes-only",
        noteTransmissionAuthorized: true,
        cachedOwnerNoteUseAuthorized: false,
      }).success,
    ).toBe(true);
    expect(
      SemanticExecutionSchema.safeParse({ ...execution, transcript: "private text" }).success,
    ).toBe(false);
    expect(
      SemanticExecutionSchema.safeParse({ ...execution, attemptCount: Number.MAX_SAFE_INTEGER + 1 })
        .success,
    ).toBe(false);

    const generation = {
      id: "generation-1",
      evidenceEpoch: manifest.sourceIdentity.evidenceEpoch,
      consentEpoch: manifest.sourceIdentity.consentEpoch,
      manifestDigest: manifest.digest,
      modelId: manifest.modelId,
      rubricVersion: manifest.rubricVersion,
      scoringVersion: manifest.scoringVersion,
      sourceIdentity: manifest.sourceIdentity,
      signalScope: manifest.signalScope,
      eligibleGameIds: manifest.eligibleGameIds,
      weights: { factual: 7, description: 5, ownerNote: 0 },
      pairOutcomes: [{ gameA: "game-a", gameB: "game-b", description: null, ownerNote: null }],
      publishedAt: "2026-09-29T00:00:00.000Z",
    };
    expect(SemanticRedundancyGenerationSchema.safeParse(generation).success).toBe(true);
    expect(
      SemanticRedundancyGenerationSchema.safeParse({
        ...generation,
        pairOutcomes: [{ ...generation.pairOutcomes[0], explanation: "private text" }],
      }).success,
    ).toBe(false);
    expect(
      SemanticRedundancyGenerationSchema.safeParse({
        ...generation,
        pairOutcomes: [{ ...generation.pairOutcomes[0], factualScore: 0.5 }],
      }).success,
    ).toBe(false);
    expect(
      SemanticPublishedPairOutcomeSchema.safeParse({
        ...generation.pairOutcomes[0],
        description: { status: "pending" },
      }).success,
    ).toBe(false);
    expect(
      SemanticPublishedPairOutcomeSchema.safeParse({
        ...generation.pairOutcomes[0],
        ownerNote: { status: "failed", reason: "provider" },
      }).success,
    ).toBe(false);
    const provenanceContext = {
      kind: "description-only" as const,
      descriptionRepresentationVersion: 1 as const,
    };
    const validUnavailable = {
      status: "unavailable" as const,
      reason: "insufficient-evidence" as const,
      modelId: manifest.modelId,
      rubricVersion: manifest.rubricVersion,
      sourceFingerprintA: fingerprint,
      sourceFingerprintB: "b".repeat(64),
      requestContext: provenanceContext,
    };
    expect(
      SemanticPublishedPairOutcomeSchema.safeParse({
        ...generation.pairOutcomes[0],
        description: validUnavailable,
      }).success,
    ).toBe(true);
    const unprovenanced = { ...validUnavailable };
    delete (unprovenanced as Partial<typeof validUnavailable>).sourceFingerprintB;
    expect(
      SemanticPublishedPairOutcomeSchema.safeParse({
        ...generation.pairOutcomes[0],
        description: unprovenanced,
      }).success,
    ).toBe(false);
    expect(
      SemanticPublishedPairOutcomeSchema.safeParse({
        ...generation.pairOutcomes[0],
        description: { ...validUnavailable, prompt: "private text" },
      }).success,
    ).toBe(false);
  });

  test("published pair outcomes require exact manifest coverage when bound to the state", () => {
    const manifest = manifestFor(["game-a", "game-b", "game-c"]);
    const generation = {
      id: "generation-coverage",
      evidenceEpoch: manifest.sourceIdentity.evidenceEpoch,
      consentEpoch: manifest.sourceIdentity.consentEpoch,
      manifestDigest: manifest.digest,
      modelId: manifest.modelId,
      rubricVersion: manifest.rubricVersion,
      scoringVersion: manifest.scoringVersion,
      sourceIdentity: manifest.sourceIdentity,
      signalScope: manifest.signalScope,
      eligibleGameIds: manifest.eligibleGameIds,
      weights: { factual: 7, description: 5, ownerNote: 0 },
      pairOutcomes: manifest.pairs.map(({ gameA, gameB }) => ({
        gameA,
        gameB,
        description: null,
        ownerNote: null,
      })),
      publishedAt: "2026-09-29T00:00:00.000Z",
    };
    const state = {
      ...createInitialSemanticRedundancyState(),
      evidenceEpoch: manifest.sourceIdentity.evidenceEpoch,
      consentEpoch: manifest.sourceIdentity.consentEpoch,
      disclosureManifest: manifest,
      disclosure: {
        id: manifest.id,
        manifestDigest: manifest.digest,
        evidenceEpoch: manifest.sourceIdentity.evidenceEpoch,
        consentEpoch: manifest.sourceIdentity.consentEpoch,
        pairCount: manifest.pairs.length,
        notePairCount: 0,
        expiresAt: manifest.expiresAt,
      },
      publishedGeneration: generation,
    };
    expect(SemanticRedundancyStateSchema.safeParse(state).success).toBe(true);
    expect(
      SemanticRedundancyStateSchema.safeParse({
        ...state,
        publishedGeneration: { ...generation, pairOutcomes: generation.pairOutcomes.slice(1) },
      }).success,
    ).toBe(false);
    expect(
      SemanticRedundancyStateSchema.safeParse({
        ...state,
        publishedGeneration: {
          ...generation,
          pairOutcomes: [
            generation.pairOutcomes[0],
            generation.pairOutcomes[0],
            ...generation.pairOutcomes.slice(2),
          ],
        },
      }).success,
    ).toBe(false);

    // Once mutable disclosure data is replaced, coverage remains verifiable
    // from the published generation's own immutable eligible set.
    const replacedDisclosure = {
      ...state,
      disclosure: null,
      disclosureManifest: null,
      publishedGeneration: generation,
    };
    expect(SemanticRedundancyStateSchema.safeParse(replacedDisclosure).success).toBe(true);
    expect(
      SemanticRedundancyStateSchema.safeParse({
        ...replacedDisclosure,
        publishedGeneration: { ...generation, pairOutcomes: generation.pairOutcomes.slice(1) },
      }).success,
    ).toBe(false);
    expect(
      SemanticRedundancyStateSchema.safeParse({
        ...replacedDisclosure,
        publishedGeneration: {
          ...generation,
          pairOutcomes: [
            generation.pairOutcomes[0],
            { ...generation.pairOutcomes[0], gameA: "game-a", gameB: "game-z" },
            generation.pairOutcomes[2],
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      SemanticRedundancyGenerationSchema.safeParse({
        ...generation,
        eligibleGameIds: ["game-a", "game-a", "game-b"],
      }).success,
    ).toBe(false);

    for (const ids of [[], ["only-game"]]) {
      const emptyManifest = manifestFor(ids);
      const noPairsGeneration = {
        ...generation,
        manifestDigest: emptyManifest.digest,
        sourceIdentity: emptyManifest.sourceIdentity,
        evidenceEpoch: emptyManifest.sourceIdentity.evidenceEpoch,
        consentEpoch: emptyManifest.sourceIdentity.consentEpoch,
        eligibleGameIds: ids,
        pairOutcomes: [],
      };
      expect(SemanticRedundancyGenerationSchema.safeParse(noPairsGeneration).success).toBe(true);
      expect(
        SemanticRedundancyGenerationSchema.safeParse({
          ...noPairsGeneration,
          pairOutcomes: [{ ...generation.pairOutcomes[0], gameA: "only-game", gameB: "z" }],
        }).success,
      ).toBe(false);
    }
  });

  test("requires description-only C requests to be note-free", () => {
    const valid = {
      ...scoredBase,
      noteVersionA: null,
      noteVersionB: null,
      requestContext: { kind: "description-only", descriptionRepresentationVersion: 1 },
    };
    expect(SemanticRedundancyStateSchema.safeParse(stateWith(valid, null)).success).toBe(true);
    expect(
      SemanticRedundancyStateSchema.safeParse(
        stateWith(
          {
            ...valid,
            noteVersionA: 1,
          },
          null,
        ),
      ).success,
    ).toBe(false);
    expect(
      SemanticRedundancyStateSchema.safeParse(
        stateWith(
          {
            ...valid,
            requestContext: {
              kind: "description-only",
              descriptionRepresentationVersion: 1,
              prompt: "not persisted",
            },
          },
          null,
        ),
      ).success,
    ).toBe(false);
  });

  test("requires shared C and D requests to carry versioned note provenance", () => {
    const sharedDescription = {
      ...scoredBase,
      noteVersionA: 1,
      noteVersionB: 2,
      requestContext: {
        kind: "description-and-owner-notes",
        descriptionRepresentationVersion: 1,
        ownerNoteRepresentationVersion: 1,
        descriptionFingerprintA: fingerprint,
        descriptionFingerprintB: fingerprint,
      },
    };
    expect(
      SemanticRedundancyStateSchema.safeParse(stateWith(sharedDescription, null)).success,
    ).toBe(true);
    expect(
      SemanticRedundancyStateSchema.safeParse(
        stateWith(
          {
            ...sharedDescription,
            noteVersionA: 0,
          },
          null,
        ),
      ).success,
    ).toBe(false);

    const ownerNote = {
      ...scoredBase,
      noteVersionA: 1,
      noteVersionB: 2,
      requestContext: { kind: "owner-notes-only", ownerNoteRepresentationVersion: 1 },
    };
    expect(SemanticRedundancyStateSchema.safeParse(stateWith(null, ownerNote)).success).toBe(true);
    expect(
      SemanticRedundancyStateSchema.safeParse(
        stateWith(null, {
          ...ownerNote,
          noteVersionB: 0,
        }),
      ).success,
    ).toBe(false);
    expect(
      SemanticRedundancyStateSchema.safeParse(
        stateWith(null, {
          ...ownerNote,
          requestContext: {
            kind: "owner-notes-only",
            ownerNoteRepresentationVersion: 1,
            providerPayload: {},
          },
        }),
      ).success,
    ).toBe(false);
  });
});
