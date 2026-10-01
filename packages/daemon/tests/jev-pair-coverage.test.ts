import { describe, expect, test } from "bun:test";
import type { Collection, DurableGame, GameWithScore } from "@shelf-judge/shared";
import { createInitialEntityMetadata } from "@shelf-judge/shared";
import { JEV_JUDGMENT_CONTRACT } from "../src/services/jev/jev-judgment-contract";
import { computeJevPairCoverage } from "../src/services/jev-pair-coverage";
import { buildJevPairDependencies } from "../src/services/jev-pair-identity";
import type { JevPairJudgment, JevPairKey } from "../src/services/jev-pair-cache-service";

function game(
  id: string,
  options: {
    description?: string | null;
    note?: string | null;
    ownership?: "owned" | "previously-owned";
    mechanics?: string[];
    playingTime?: number;
  } = {},
): DurableGame {
  const description = options.description === undefined ? `Description ${id}` : options.description;
  return {
    id,
    bggId: null,
    name: `Game ${id}`,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: null,
    playingTime: options.playingTime ?? 60,
    imageUrl: null,
    bggData: {
      communityRating: 5,
      bayesAverage: 5,
      weight: null,
      numWeightVotes: 0,
      description,
      mechanics: (options.mechanics ?? []).map((name, index) => ({ id: index + 1, name })),
      categories: [],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: "2026-01-01T00:00:00Z",
    },
    numPlays: null,
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
    entityMetadata: createInitialEntityMetadata(null),
    latestPlayCountCheck: null,
    ownership: options.ownership ?? "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ownerNote:
      options.note === null
        ? { state: "missing", version: 0, updatedAt: null }
        : {
            state: "present",
            version: 1,
            updatedAt: "2026-01-01T00:00:00Z",
            text: options.note ?? `Private note ${id}`,
          },
  };
}

function predicted(source: DurableGame, score: number | null = 3, vetoed = false): GameWithScore {
  // Public scored rows carry no authoritative owner note. Tests may add stale enrichment to ensure
  // the kernel never uses it for source proof.
  const publicGame = { ...source };
  delete (publicGame as Partial<DurableGame>).ownerNote;
  return {
    game: publicGame,
    score:
      score === null
        ? null
        : {
            score: vetoed ? 0 : score,
            ratedAxisCount: 0,
            totalAxisCount: 1,
            breakdown: [],
            vetoed,
            vetoedBy: null,
            hypotheticalScore: null,
            predictionMeta: null,
            redundancyAdjustment: null,
          },
  };
}

function collection(
  games: DurableGame[],
  overrides: Partial<Collection["semanticRedundancy"]["settings"]> = {},
): Collection {
  return {
    id: "collection-1",
    name: "Fixture",
    schemaVersion: 10,
    revision: 1,
    axes: [],
    games,
    intentions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    attentionDispositions: [],
    semanticRedundancy: {
      settings: {
        enabled: true,
        weights: { factual: 0.5, description: 1, ownerNote: 1 },
        cachedOwnerNoteUse: true,
        ...overrides,
      },
      evidenceEpoch: 3,
      consentEpoch: 4,
      factualWeightsEpoch: 2,
      factualWeightsFingerprint: "factual-v2",
      firstOptInInitialized: true,
    },
  } as unknown as Collection;
}

const captureIdentity = {
  sourceVectorIdentity: "durable-source-vector",
  tournamentIdentity: "tournament-capture",
  predictionCaptureIdentity: "full-prediction-capture",
};
const factualWeights = { binary: 1, continuous: 1 };
function compute(
  c: Collection,
  rows: JevPairJudgment[] = [],
  capture = c.games.map((g) => predicted(g)),
) {
  const cache = new Map(rows.map((row) => [`${row.gameAId}:${row.gameBId}:${row.signal}`, row]));
  return computeJevPairCoverage({
    collection: c,
    predictionCapture: capture,
    captureIdentity,
    factualWeights,
    cache: {
      lookup: (key: JevPairKey) => cache.get(`${key.gameAId}:${key.gameBId}:${key.signal}`) ?? null,
    },
  });
}
function judgment(
  c: Collection,
  a: DurableGame,
  b: DurableGame,
  signal: "C" | "D",
  kind: "C_ONLY" | "D_ONLY" | "SHARED_CD",
): JevPairJudgment {
  const deps = buildJevPairDependencies(
    kind,
    {
      gameId: a.id,
      name: a.name,
      ...(kind === "D_ONLY" ? {} : { description: a.bggData!.description! }),
      ...(kind === "C_ONLY"
        ? {}
        : {
            note: {
              text: a.ownerNote.state === "present" ? a.ownerNote.text : "",
              version: String(a.ownerNote.version),
            },
          }),
    },
    {
      gameId: b.id,
      name: b.name,
      ...(kind === "D_ONLY" ? {} : { description: b.bggData!.description! }),
      ...(kind === "C_ONLY"
        ? {}
        : {
            note: {
              text: b.ownerNote.state === "present" ? b.ownerNote.text : "",
              version: String(b.ownerNote.version),
            },
          }),
    },
  );
  return {
    collectionId: c.id,
    gameAId: a.id,
    gameBId: b.id,
    signal,
    dependencyKind: kind,
    value: signal === "C" ? 0.7 : 0.4,
    modelId: JEV_JUDGMENT_CONTRACT.modelId,
    rubricVersion: JEV_JUDGMENT_CONTRACT.rubricVersion,
    questionVersion: JEV_JUDGMENT_CONTRACT.questionVersion,
    requestSchemaVersion: JEV_JUDGMENT_CONTRACT.requestSchemaVersion,
    scoreMappingVersion: JEV_JUDGMENT_CONTRACT.scoreMappingVersion,
    semanticPolicyId: JEV_JUDGMENT_CONTRACT.semanticPolicyId,
    ...(kind === "C_ONLY" ? {} : { consentEpoch: String(c.semanticRedundancy.consentEpoch) }),
    completedAt: "excluded-from-identity",
    dependencies: deps,
  };
}

describe("Jev pair coverage kernel", () => {
  test("uses semantic weights independently of factual weights and proves mixed row kinds", () => {
    const a = game("a"),
      b = game("b"),
      c = game("c");
    const col = collection([a, b, c]);
    const rows = [
      judgment(col, a, b, "C", "C_ONLY"),
      judgment(col, a, b, "D", "D_ONLY"),
      judgment(col, a, c, "C", "SHARED_CD"),
      judgment(col, a, c, "D", "SHARED_CD"),
      judgment(col, b, c, "C", "C_ONLY"),
      judgment(col, b, c, "D", "D_ONLY"),
    ];
    expect(compute(col, rows).complete).toBe(true);
    const noDescriptions = collection([a, b], {
      weights: { factual: 1, description: 0, ownerNote: 1 },
    });
    expect(
      compute(noDescriptions, [judgment(noDescriptions, a, b, "D", "D_ONLY")]).pairs[0]?.C,
    ).toEqual({ state: "unavailable", reason: "zero-weight" });
    const onlyDescription = collection([a, b], {
      weights: { factual: 1, description: 1, ownerNote: 0 },
    });
    expect(
      compute(onlyDescription, [judgment(onlyDescription, a, b, "C", "C_ONLY")]).pairs[0]?.D,
    ).toEqual({ state: "unavailable", reason: "zero-weight" });
    const semanticDisabled = collection([a, b], { enabled: false });
    expect(compute(semanticDisabled).pairs[0]?.C).toEqual({
      state: "unavailable",
      reason: "disabled",
    });
  });

  test("uses collection owner notes, not absent or stale public prediction notes", () => {
    const a = game("a"),
      b = game("b");
    const col = collection([a, b]);
    const d = judgment(col, a, b, "D", "D_ONLY");
    const publicCapture = [predicted(a), predicted(b)];
    expect(compute(col, [d], publicCapture).pairs[0]?.D.state).toBe("covered");
    const stale = publicCapture.map((entry) => ({
      ...entry,
      game: { ...entry.game, ownerNote: { state: "present", version: 99, text: "stale note" } },
    })) as GameWithScore[];
    expect(compute(col, [d], stale).identity).toBe(compute(col, [d], publicCapture).identity);
    expect(
      compute(collection([game("a", { note: null }), b]), [d], publicCapture).pairs[0]?.D,
    ).toEqual({ state: "unavailable", reason: "missing-source" });
  });

  test("rejects partial captures including omitted null/vetoed owned games", () => {
    const games = [game("a"), game("b"), game("c")];
    const col = collection(games);
    expect(() => compute(col, [], [predicted(games[0]), predicted(games[1])])).toThrow(
      /incomplete/,
    );
    const completeCapture = [
      predicted(games[0]),
      predicted(games[1], null),
      predicted(games[2], 0, true),
    ];
    expect(compute(col, [], completeCapture).eligibleGameIds).toEqual(["a"]);
  });

  test("uses all collection BGG data for factual normalization and digests policy changes", () => {
    const a = game("a", { playingTime: 60 }),
      b = game("b", { playingTime: 120 });
    const other = game("other", { ownership: "previously-owned", playingTime: 400 });
    const col = collection([a, b]);
    const base = compute(col);
    const expanded = compute(collection([a, b, other]));
    expect(expanded.pairs[0]?.factualScore).not.toBe(base.pairs[0]?.factualScore);
    expect(
      compute(collection([a, b], { weights: { factual: 0.5, description: 0.2, ownerNote: 1 } }))
        .identity,
    ).not.toBe(base.identity);
    expect(compute(collection([a, b], { enabled: false })).identity).not.toBe(base.identity);
  });

  test("a required DB miss is incomplete; truly absent required source does not look up cache", () => {
    const a = game("a"),
      b = game("b");
    const col = collection([a, b]);
    let lookups = 0;
    const miss = computeJevPairCoverage({
      collection: col,
      predictionCapture: [predicted(a), predicted(b)],
      captureIdentity,
      factualWeights,
      cache: {
        lookup: () => {
          lookups++;
          return null;
        },
      },
    });
    expect(miss.complete).toBe(false);
    const noDescriptionCollection = collection([game("a", { description: null }), b]);
    const absentSource = computeJevPairCoverage({
      collection: noDescriptionCollection,
      predictionCapture: noDescriptionCollection.games.map((g) => predicted(g)),
      captureIdentity,
      factualWeights,
      cache: {
        lookup: () => {
          lookups++;
          return null;
        },
      },
    });
    expect(absentSource.pairs[0]?.C).toEqual({ state: "unavailable", reason: "missing-source" });
    expect(lookups).toBe(3); // two lookups for miss (C,D), only D for absent-description pair.
  });
});
