import { describe, expect, test } from "bun:test";
import type {
  Collection,
  DurableGame,
  GameWithScore,
  SemanticRedundancyGeneration,
} from "@shelf-judge/shared";
import { createInitialEntityMetadata } from "@shelf-judge/shared";
import { resolveSemanticRedundancyPairTable } from "../../src/services/semantic-redundancy-pair-resolver.js";
import { computeRedundancyAnalysis } from "../../src/services/redundancy-engine.js";
import { createRedundancyFactualContext } from "../../src/services/redundancy-factual.js";
import { canonicalSha256 } from "../../src/services/profile-source-coordinator.js";
import {
  semanticDescriptionSourceFingerprint,
  semanticOwnerNoteSourceFingerprint,
} from "../../src/services/semantic-redundancy-state-service.js";
import type { SemanticGenerationSourceIdentity } from "../../src/services/source-vector.js";
import {
  semanticGenerationFixture,
  semanticSourceIdentityFixture,
} from "../helpers/semantic-redundancy-fixtures.js";

const source: SemanticGenerationSourceIdentity = {
  collectionId: "fixture-collection",
  collectionSchemaVersion: 9,
  evidenceEpoch: 0,
  consentEpoch: 0,
  tournamentRevision: 1,
  predictionSettingsRevision: 1,
  factualWeightsEpoch: 0,
  fencedFactualWeightsFingerprint: null,
  currentFactualWeightsFingerprint: "fingerprint",
};
const expectedSource = semanticSourceIdentityFixture();
const support = {
  modelId: "jev-pinned",
  rubricVersion: 1,
  scoringVersion: 1,
  sourceIdentity: expectedSource,
};
const factualSettings = {
  enabled: true,
  stage: "annotation" as const,
  similarityThreshold: 0.6,
  maxPenalty: 2,
  componentWeights: { binary: 4 / 7, continuous: 3 / 7 },
  minNeighbors: 1,
  expectedNeighbors: 5,
};

type CapturedGame = DurableGame;

function makeGame(id: string, description: string, note?: string): CapturedGame {
  return {
    id,
    name: id,
    bggId: Number(id.slice(1)),
    entityMetadata: createInitialEntityMetadata(Number(id.slice(1))),
    latestPlayCountCheck: null,
    additionalBggIds: [],
    yearPublished: null,
    minPlayers: 1,
    maxPlayers: 4,
    bestPlayers: 2,
    playingTime: 30,
    bggData: {
      communityRating: 6,
      bayesAverage: 6,
      weight: 2,
      numWeightVotes: 10,
      description,
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: "2026-01-01T00:00:00Z",
    },
    numPlays: 0,
    imageUrl: null,
    lastPlayedAt: null,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
    durationEvidence: { status: "missing", source: "manual", observedAt: null },
    playerRangeEvidence: { status: "missing", source: "manual", observedAt: null },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ownerNote:
      note === undefined
        ? { state: "missing", version: 0, updatedAt: null }
        : { state: "present", version: 1, updatedAt: "2026-01-01T00:00:00Z", text: note },
  };
}

function capturedCollection(games: CapturedGame[]): Collection {
  return {
    id: "fixture-collection",
    schemaVersion: 9,
    revision: 1,
    name: "test",
    axes: [],
    games,
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    semanticRedundancy: {
      settings: {
        enabled: true,
        cachedOwnerNoteUse: false,
        weights: { factual: 7, description: 5, ownerNote: 0 },
      },
      evidenceEpoch: 0,
      consentEpoch: 0,
      factualWeightsEpoch: 0,
      factualWeightsFingerprint: null,
      firstOptInInitialized: true,
      disclosure: null,
      disclosureManifest: null,
      manifestDelivery: null,
      authorization: null,
      execution: null,
      pairJudgments: [],
      publishedGeneration: null,
    },
  } as unknown as Collection;
}

function universe(games: CapturedGame[]): GameWithScore[] {
  return games.map((game) => ({
    game,
    score: {
      score: 5,
      ratedAxisCount: 0,
      totalAxisCount: 0,
      breakdown: [],
      vetoed: false,
      vetoedBy: null,
      hypotheticalScore: null,
      predictionMeta: null,
      redundancyAdjustment: null,
    },
  }));
}

function generation(
  games: CapturedGame[],
  overrides: Partial<SemanticRedundancyGeneration> = {},
  mode: "C" | "D" | "CD" = "C",
) {
  const pairOutcomes: Array<SemanticRedundancyGeneration["pairOutcomes"][number]> = [];
  for (let i = 0; i < games.length; i++)
    for (let j = i + 1; j < games.length; j++) {
      const a = games[i];
      const b = games[j];
      pairOutcomes.push({
        gameA: a.id,
        gameB: b.id,
        description:
          mode === "D"
            ? null
            : {
                status: "scored",
                score: 0.75,
                confidence: null,
                modelId: "jev-pinned",
                rubricVersion: 1,
                sourceFingerprintA: semanticDescriptionSourceFingerprint(a)!,
                sourceFingerprintB: semanticDescriptionSourceFingerprint(b)!,
                noteVersionA: mode === "CD" ? 1 : null,
                noteVersionB: mode === "CD" ? 1 : null,
                requestContext:
                  mode === "CD"
                    ? {
                        kind: "description-and-owner-notes",
                        descriptionRepresentationVersion: 1,
                        ownerNoteRepresentationVersion: 1,
                        descriptionFingerprintA: semanticDescriptionSourceFingerprint(a)!,
                        descriptionFingerprintB: semanticDescriptionSourceFingerprint(b)!,
                      }
                    : { kind: "description-only", descriptionRepresentationVersion: 1 },
              },
        ownerNote:
          mode === "C"
            ? null
            : {
                status: "scored",
                score: 0.25,
                confidence: null,
                modelId: "jev-pinned",
                rubricVersion: 1,
                sourceFingerprintA: semanticOwnerNoteSourceFingerprint(a)!,
                sourceFingerprintB: semanticOwnerNoteSourceFingerprint(b)!,
                noteVersionA: 1,
                noteVersionB: 1,
                requestContext:
                  mode === "D"
                    ? { kind: "owner-notes-only", ownerNoteRepresentationVersion: 1 }
                    : {
                        kind: "description-and-owner-notes",
                        descriptionRepresentationVersion: 1,
                        ownerNoteRepresentationVersion: 1,
                        descriptionFingerprintA: semanticDescriptionSourceFingerprint(a)!,
                        descriptionFingerprintB: semanticDescriptionSourceFingerprint(b)!,
                      },
              },
      });
    }
  return semanticGenerationFixture({
    eligibleGameIds: games.map(({ id }) => id),
    signalScope:
      mode === "C"
        ? "description-only"
        : mode === "D"
          ? "owner-notes-only"
          : "description-and-owner-notes",
    weights:
      mode === "C"
        ? { factual: 7, description: 5, ownerNote: 0 }
        : mode === "D"
          ? { factual: 7, description: 0, ownerNote: 5 }
          : { factual: 7, description: 5, ownerNote: 3 },
    pairOutcomes,
    ...overrides,
  });
}

function setMode(collection: Collection, mode: "C" | "D" | "CD") {
  collection.semanticRedundancy.settings.weights =
    mode === "C"
      ? { factual: 7, description: 5, ownerNote: 0 }
      : mode === "D"
        ? { factual: 7, description: 0, ownerNote: 5 }
        : { factual: 7, description: 5, ownerNote: 3 };
  collection.semanticRedundancy.settings.cachedOwnerNoteUse = mode !== "C";
}

describe("semantic redundancy pair resolver", () => {
  test("resolves immutable C outcomes with fresh factual cosine across all captured games", () => {
    const games = [makeGame("g1", "alpha"), makeGame("g2", "beta"), makeGame("g3", "gamma")];
    games[1].minPlayers = 2;
    const collection = capturedCollection(games);
    const result = resolveSemanticRedundancyPairTable({
      collection,
      sourceIdentity: source,
      factualSettings,
      universe: universe(games),
      generation: generation(games),
      support,
    });
    expect(result.status).toBe("ready");
    expect(result.pairs).toHaveLength(3);
    expect(result.pairs.every((pair) => pair.description === 0.75)).toBe(true);
    expect(result.pairs.every((pair) => pair.factual >= 0 && pair.factual <= 1)).toBe(true);
  });

  test("fails closed on missing pair coverage and consent revocation", () => {
    const games = [makeGame("g1", "alpha"), makeGame("g2", "beta"), makeGame("g3", "gamma")];
    const collection = capturedCollection(games);
    const incomplete = generation(games, { pairOutcomes: [] });
    expect(
      resolveSemanticRedundancyPairTable({
        collection,
        sourceIdentity: source,
        factualSettings,
        universe: universe(games),
        generation: incomplete,
        support,
      }).status,
    ).toBe("stale");
    const mismatchedEligibleIds = generation(games, { eligibleGameIds: ["g1", "g2"] });
    expect(
      resolveSemanticRedundancyPairTable({
        collection,
        sourceIdentity: source,
        factualSettings,
        universe: universe(games),
        generation: mismatchedEligibleIds,
        support,
      }).status,
    ).toBe("stale");
    collection.semanticRedundancy.consentEpoch += 1;
    expect(
      resolveSemanticRedundancyPairTable({
        collection,
        sourceIdentity: source,
        factualSettings,
        universe: universe(games),
        generation: generation(games),
        support,
      }).status,
    ).toBe("stale");
  });

  test("resolves D-only and combined C+D outcomes without renormalizing unavailable signals", () => {
    const games = [makeGame("g1", "alpha", "note one"), makeGame("g2", "beta", "note two")];
    for (const mode of ["D", "CD"] as const) {
      const collection = capturedCollection(games);
      setMode(collection, mode);
      const result = resolveSemanticRedundancyPairTable({
        collection,
        sourceIdentity: source,
        factualSettings,
        universe: universe(games),
        generation: generation(games, {}, mode),
        support,
      });
      expect(result.status).toBe("ready");
      expect(result.pairs[0]?.description).toBe(mode === "D" ? undefined : 0.75);
      expect(result.pairs[0]?.ownerNote).toBe(0.25);
    }
  });

  test("rebuilds factual scores from all captured games and ignores working-cache edits", () => {
    const games = [makeGame("g1", "alpha"), makeGame("g2", "beta"), makeGame("g3", "gamma")];
    games[1].minPlayers = 2;
    const collection = capturedCollection(games);
    const published = generation(games);
    const input = {
      collection,
      sourceIdentity: source,
      factualSettings,
      universe: universe(games),
      generation: published,
      support,
    };
    const before = resolveSemanticRedundancyPairTable(input);
    collection.semanticRedundancy.pairJudgments = [
      { gameA: "g1", gameB: "g2", description: null, ownerNote: null },
    ];
    expect(resolveSemanticRedundancyPairTable(input).pairs).toEqual(before.pairs);

    const outlier = makeGame("g4", "outlier");
    outlier.minPlayers = 100;
    const withOutlier = resolveSemanticRedundancyPairTable({
      ...input,
      collection: capturedCollection([...games, outlier]),
    });
    expect(withOutlier.status).toBe("ready");
    expect(withOutlier.pairs[0]?.factual).not.toBe(before.pairs[0]?.factual);

    const manualOutlier = makeGame("g5", "manual outlier");
    manualOutlier.bggData = null;
    manualOutlier.minPlayers = -100_000;
    manualOutlier.maxPlayers = 100_000;
    manualOutlier.playingTime = 1_000_000;
    const withoutBggOutlier = resolveSemanticRedundancyPairTable({
      ...input,
      collection: capturedCollection([...games, manualOutlier]),
    });
    expect(withoutBggOutlier.status).toBe("ready");
    expect(withoutBggOutlier.pairs).toEqual(before.pairs);
  });

  test("marks independently revisioned A→B→A source identities stale across resolver instances", () => {
    const games = [makeGame("g1", "alpha"), makeGame("g2", "beta")];
    const collection = capturedCollection(games);
    const published = generation(games);
    const input = {
      collection,
      sourceIdentity: source,
      factualSettings,
      universe: universe(games),
      generation: published,
      support,
    };
    const resolveAfterRestart = (
      tournamentHash: string,
      predictionSettingsHash: string,
      redundancySettingsHash: string,
    ) =>
      resolveSemanticRedundancyPairTable({
        ...input,
        support: {
          ...support,
          sourceIdentity: {
            ...expectedSource,
            tournamentHash,
            predictionSettingsHash,
            redundancySettingsHash,
          },
        },
      }).status;
    expect(
      resolveAfterRestart(
        expectedSource.tournamentHash,
        expectedSource.predictionSettingsHash,
        expectedSource.redundancySettingsHash,
      ),
    ).toBe("ready");
    expect(
      resolveAfterRestart(
        "d".repeat(64),
        expectedSource.predictionSettingsHash,
        expectedSource.redundancySettingsHash,
      ),
    ).toBe("stale");
    expect(
      resolveAfterRestart(
        expectedSource.tournamentHash,
        "e".repeat(64),
        expectedSource.redundancySettingsHash,
      ),
    ).toBe("stale");
    expect(
      resolveAfterRestart(
        expectedSource.tournamentHash,
        expectedSource.predictionSettingsHash,
        "f".repeat(64),
      ),
    ).toBe("stale");
    expect(
      resolveAfterRestart(
        expectedSource.tournamentHash,
        expectedSource.predictionSettingsHash,
        expectedSource.redundancySettingsHash,
      ),
    ).toBe("ready");
  });

  test("cached-D-use revocation invalidates the generation", () => {
    const games = [makeGame("g1", "alpha", "note one"), makeGame("g2", "beta", "note two")];
    const collection = capturedCollection(games);
    setMode(collection, "D");
    const published = generation(games, {}, "D");
    collection.semanticRedundancy.settings.cachedOwnerNoteUse = false;
    expect(
      resolveSemanticRedundancyPairTable({
        collection,
        sourceIdentity: source,
        factualSettings,
        universe: universe(games),
        generation: published,
        support,
      }).status,
    ).toBe("stale");
  });

  test("preserves insufficient-evidence D as unavailable rather than imputing a score", () => {
    const games = [makeGame("g1", "alpha", "note one"), makeGame("g2", "beta", "note two")];
    const collection = capturedCollection(games);
    setMode(collection, "D");
    const published = generation(games, {}, "D");
    const terminal = published.pairOutcomes[0];
    published.pairOutcomes = [
      {
        ...terminal,
        ownerNote: {
          status: "unavailable",
          reason: "insufficient-evidence",
          modelId: "jev-pinned",
          rubricVersion: 1,
          sourceFingerprintA: semanticOwnerNoteSourceFingerprint(games[0])!,
          sourceFingerprintB: semanticOwnerNoteSourceFingerprint(games[1])!,
          requestContext: { kind: "owner-notes-only", ownerNoteRepresentationVersion: 1 },
        },
      },
    ];
    const result = resolveSemanticRedundancyPairTable({
      collection,
      sourceIdentity: source,
      factualSettings,
      universe: universe(games),
      generation: published,
      support,
    });
    expect(result.status).toBe("ready");
    expect(result.pairs[0]?.ownerNote).toBeNull();
  });

  test("accepts a terminal missing-source D result only with its manifest-bound fingerprint", () => {
    const games = [makeGame("g1", "alpha"), makeGame("g2", "beta", "note two")];
    const collection = capturedCollection(games);
    setMode(collection, "D");
    const published = generation(games, {}, "D");
    const terminal = published.pairOutcomes[0];
    published.pairOutcomes = [
      {
        ...terminal,
        ownerNote: {
          status: "unavailable",
          reason: "missing-source",
          modelId: "jev-pinned",
          rubricVersion: 1,
          sourceFingerprintA: canonicalSha256({
            manifestDigest: published.manifestDigest,
            gameId: "g1",
            signal: "D",
            status: "missing-source",
          }),
          sourceFingerprintB: semanticOwnerNoteSourceFingerprint(games[1])!,
          requestContext: { kind: "owner-notes-only", ownerNoteRepresentationVersion: 1 },
        },
      },
    ];
    const result = resolveSemanticRedundancyPairTable({
      collection,
      sourceIdentity: source,
      factualSettings,
      universe: universe(games),
      generation: published,
      support,
    });
    expect(result.status).toBe("ready");
    expect(result.pairs[0]?.ownerNote).toBeNull();
  });

  test("allows D-positive C-only publication when both notes are genuinely absent", () => {
    const games = [makeGame("g1", "alpha"), makeGame("g2", "beta")];
    const collection = capturedCollection(games);
    collection.semanticRedundancy.settings.weights = { factual: 7, description: 5, ownerNote: 3 };
    const published = generation(
      games,
      {
        signalScope: "description-only",
        weights: { factual: 7, description: 5, ownerNote: 3 },
      },
      "C",
    );
    const terminal = published.pairOutcomes[0];
    published.pairOutcomes = [
      {
        ...terminal,
        ownerNote: {
          status: "unavailable",
          reason: "missing-source",
          modelId: "jev-pinned",
          rubricVersion: 1,
          sourceFingerprintA: canonicalSha256({
            manifestDigest: published.manifestDigest,
            gameId: "g1",
            signal: "D",
            status: "missing-source",
          }),
          sourceFingerprintB: canonicalSha256({
            manifestDigest: published.manifestDigest,
            gameId: "g2",
            signal: "D",
            status: "missing-source",
          }),
          requestContext: { kind: "owner-notes-only", ownerNoteRepresentationVersion: 1 },
        },
      },
    ];
    expect(
      resolveSemanticRedundancyPairTable({
        collection,
        sourceIdentity: source,
        factualSettings,
        universe: universe(games),
        generation: published,
        support,
      }).status,
    ).toBe("ready");
  });

  test("accepts compatible cached D without requiring note retransmission", () => {
    const games = [makeGame("g1", "alpha", "note one"), makeGame("g2", "beta", "note two")];
    const collection = capturedCollection(games);
    collection.semanticRedundancy.settings.weights = { factual: 7, description: 5, ownerNote: 3 };
    collection.semanticRedundancy.settings.cachedOwnerNoteUse = true;
    const published = generation(
      games,
      {
        signalScope: "description-only",
        weights: { factual: 7, description: 5, ownerNote: 3 },
      },
      "CD",
    );
    expect(
      resolveSemanticRedundancyPairTable({
        collection,
        sourceIdentity: source,
        factualSettings,
        universe: universe(games),
        generation: published,
        support,
      }).status,
    ).toBe("ready");
  });

  test("refuses a note-bearing description-only D outcome without cached-use permission", () => {
    const games = [makeGame("g1", "alpha", "note one"), makeGame("g2", "beta", "note two")];
    const collection = capturedCollection(games);
    collection.semanticRedundancy.settings.weights = { factual: 7, description: 5, ownerNote: 3 };
    collection.semanticRedundancy.settings.cachedOwnerNoteUse = false;
    const published = generation(
      games,
      {
        signalScope: "description-only",
        weights: { factual: 7, description: 5, ownerNote: 3 },
      },
      "CD",
    );
    expect(
      resolveSemanticRedundancyPairTable({
        collection,
        sourceIdentity: source,
        factualSettings,
        universe: universe(games),
        generation: published,
        support,
      }).status,
    ).toBe("stale");
  });

  test("reports ready similarity info when there are no neighbors", () => {
    const games = [makeGame("g1", "alpha"), makeGame("g2", "beta")];
    const collection = capturedCollection(games);
    const table = resolveSemanticRedundancyPairTable({
      collection,
      sourceIdentity: source,
      factualSettings,
      universe: universe(games),
      generation: generation(games),
      support,
    });
    const context = createRedundancyFactualContext(games, factualSettings.componentWeights);
    const analysis = computeRedundancyAnalysis(
      universe(games),
      { ...factualSettings, similarityThreshold: 1.1 },
      (game) => context.getFeatureVector(game),
      table,
    );
    expect(analysis.adjustments.size).toBe(0);
    expect(analysis.similarityInfo.get("g1")).toEqual({
      status: "ready",
      generationId: table.identity.generationId,
    });
  });
});
