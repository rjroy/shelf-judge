import { afterEach, describe, expect, test } from "bun:test";
import type { Collection, DurableGame, GameWithScore } from "@shelf-judge/shared";
import { createInitialEntityMetadata } from "@shelf-judge/shared";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInitialSemanticRedundancyStateV10 } from "@shelf-judge/shared";
import { JEV_JUDGMENT_CONTRACT } from "../../src/services/jev/jev-judgment-contract.js";
import {
  computeJevPairCoverage,
  type JevPredictionCaptureIdentity,
} from "../../src/services/jev-pair-coverage.js";
import { buildJevPairDependencies } from "../../src/services/jev-pair-identity.js";
import {
  createJevPairCache,
  type JevPairJudgment,
} from "../../src/services/jev-pair-cache-service.js";
import { createJevPairReadService } from "../../src/services/jev-pair-read-service.js";
import {
  computeRedundancyAnalysis,
  DEFAULT_REDUNDANCY_SETTINGS,
} from "../../src/services/redundancy-engine.js";
import { createRedundancyFactualContext } from "../../src/services/redundancy-factual.js";

const dirs: string[] = [];
afterEach(async () =>
  Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))),
);

function game(id: string): DurableGame {
  return {
    id,
    bggId: null,
    name: `Game ${id}`,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: null,
    playingTime: 60,
    imageUrl: null,
    bggData: {
      communityRating: 5,
      bayesAverage: 5,
      weight: null,
      numWeightVotes: 0,
      description: `Description ${id}`,
      mechanics: [],
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
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ownerNote: {
      state: "present",
      version: 1,
      updatedAt: "2026-01-01T00:00:00Z",
      text: `PRIVATE NOTE ${id}`,
    },
  };
}
function fixture() {
  const games = [game("a"), game("b"), game("c")];
  const initial = createInitialSemanticRedundancyStateV10();
  const collection = {
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
      ...initial,
      settings: {
        enabled: true,
        weights: { factual: 0.5, description: 1, ownerNote: 1 },
        cachedOwnerNoteUse: true,
      },
      evidenceEpoch: 3,
      consentEpoch: 4,
      ownerNoteConsentEpoch: 4,
      factualWeightsEpoch: 2,
      factualWeightsFingerprint: "factual-v2",
    },
  } as unknown as Collection;
  const capture = games.map((g) => ({
    game: { ...g, ownerNote: undefined },
    score: {
      score: 3,
      ratedAxisCount: 1,
      totalAxisCount: 1,
      breakdown: [],
      vetoed: false,
      vetoedBy: null,
      hypotheticalScore: null,
      predictionMeta: null,
      redundancyAdjustment: null,
    },
  })) as unknown as GameWithScore[];
  const captureIdentity: JevPredictionCaptureIdentity = {
    sourceVectorIdentity: "source-vector",
    tournamentIdentity: "tournament",
    predictionCaptureIdentity: "prediction-capture",
  };
  const factualWeights = { binary: 1, continuous: 1 };
  return { collection, games, predictionCapture: capture, captureIdentity, factualWeights };
}
function row(c: Collection, a: DurableGame, b: DurableGame, signal: "C" | "D"): JevPairJudgment {
  const kind = signal === "C" ? "SHARED_CD" : "D_ONLY";
  const source = (g: DurableGame) => ({
    gameId: g.id,
    name: g.name,
    ...(signal === "C" ? { description: g.bggData?.description ?? "" } : {}),
    note: {
      text: g.ownerNote.state === "present" ? g.ownerNote.text : "",
      version: String(g.ownerNote.version),
    },
  });
  return {
    collectionId: c.id,
    consentEpoch: String(
      c.semanticRedundancy.ownerNoteConsentEpoch ?? c.semanticRedundancy.consentEpoch,
    ),
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
    completedAt: "2026-01-01T00:00:00Z",
    dependencies: buildJevPairDependencies(kind, source(a), source(b)),
  };
}

describe("Jev pair read adapter", () => {
  test("proof fence rechecks a captured read against SQLite without exposing source text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-read-proof-"));
    dirs.push(dir);
    const cache = await createJevPairCache(dir);
    const f = fixture();
    const rows: JevPairJudgment[] = [];
    for (let i = 0; i < f.games.length; i++)
      for (let j = i + 1; j < f.games.length; j++) {
        rows.push(
          row(f.collection, f.games[i], f.games[j], "C"),
          row(f.collection, f.games[i], f.games[j], "D"),
        );
      }
    rows.forEach((item) => cache.upsert(item));
    const reader = createJevPairReadService(cache);

    const identity = computeJevPairCoverage({ ...f, cache }).identity;
    const ready = reader.resolveWithProof(f);
    expect(ready.result.status).toBe("ready");
    expect(ready.proof).toEqual({ status: "ready", identity });
    expect(ready.isCurrent()).toBe(true);
    expect(JSON.stringify(ready.proof)).not.toContain("PRIVATE NOTE");
    expect(JSON.stringify(ready.proof)).not.toContain("Description");
    f.games[0].name = "mutated after capture";
    expect(ready.isCurrent()).toBe(true);

    cache.upsert({ ...rows[0], value: 0.8 });
    expect(ready.isCurrent()).toBe(false);

    const missingDatabase = createJevPairReadService({ ...cache, available: false });
    const unavailable = missingDatabase.resolveWithProof(f);
    expect(unavailable.result.status).toBe("not-ready");
    expect(unavailable.isCurrent()).toBe(true);
    cache.close();
  });

  test("returns usable per-pair signals from real SQLite and fails closed for invalid reads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-read-"));
    dirs.push(dir);
    const cache = await createJevPairCache(dir);
    const f = fixture();
    const rows: JevPairJudgment[] = [];
    for (let i = 0; i < f.games.length; i++)
      for (let j = i + 1; j < f.games.length; j++) {
        rows.push(
          row(f.collection, f.games[i], f.games[j], "C"),
          row(f.collection, f.games[i], f.games[j], "D"),
        );
      }
    rows.forEach((item) => cache.upsert(item));
    const reader = createJevPairReadService(cache);
    const ready = reader.resolve(f);
    expect(ready.status).toBe("ready");
    if (ready.status !== "ready") throw new Error("expected ready table");
    expect(ready.table.pairs).toHaveLength(3);
    expect(typeof ready.table.pairs[0]?.factual).toBe("number");
    expect(ready.table.pairs[0]).toMatchObject({ description: 0.7, ownerNote: 0.4 });
    expect(JSON.stringify(ready)).not.toContain("PRIVATE NOTE");
    expect(JSON.stringify(ready)).not.toContain("Description a");
    expect(Object.keys(reader)).toEqual(["resolve", "resolveWithProof"]);

    const revoked = {
      ...f,
      collection: {
        ...f.collection,
        semanticRedundancy: {
          ...f.collection.semanticRedundancy,
          settings: { ...f.collection.semanticRedundancy.settings, cachedOwnerNoteUse: false },
        },
      },
    };
    expect(reader.resolve(revoked).status).toBe("factual");
    expect("table" in reader.resolve(revoked)).toBe(true);
    expect(reader.resolve(f).status).toBe("ready");

    cache.purgePair("a", "b", "C");
    expect(reader.resolve(f).status).toBe("partial");
    rows.forEach((item) => cache.upsert(item));
    cache.upsert({ ...rows[0], value: 0.8 });
    expect(reader.resolve(f).status).toBe("ready");
    expect(createJevPairReadService({ ...cache, available: false }).resolve(f).status).toBe(
      "not-ready",
    );
    expect(
      createJevPairReadService({
        available: true,
        lookup: () => {
          throw new Error("PRIVATE NOTE failure");
        },
      }).resolve(f).status,
    ).toBe("not-ready");
    expect(
      createJevPairReadService({
        available: true,
        lookup: () => null,
      }).resolve(f).status,
    ).toBe("factual");
    const factualOnly = createJevPairReadService({ available: true, lookup: () => null }).resolve(
      f,
    );
    expect("table" in factualOnly ? (factualOnly.table?.pairs ?? []) : []).toHaveLength(3);
    expect(
      createJevPairReadService({
        available: true,
        lookup: () => null,
      }).resolve({ ...f, predictionCapture: [] }).status,
    ).toBe("not-ready");
    expect(JSON.stringify(reader.resolve(f))).not.toContain("PRIVATE NOTE");
    cache.close();
  });

  test("respects settings and note permission while exposing usable description signals", () => {
    const f = fixture();
    const cache = { available: true, lookup: () => null };
    const reader = createJevPairReadService(cache);
    expect(reader.resolve({ ...f, factualEnabled: false }).status).toBe("disabled");
    expect(
      reader.resolve({
        ...f,
        collection: {
          ...f.collection,
          semanticRedundancy: {
            ...f.collection.semanticRedundancy,
            settings: { ...f.collection.semanticRedundancy.settings, enabled: false },
          },
        },
      }).status,
    ).toBe("factual");
    expect(reader.resolve(f).status).toBe("factual");
    expect("table" in reader.resolve(f)).toBe(true);
  });

  test("uses factual-only when both semantic weights are zero despite a matching activation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-read-zero-"));
    dirs.push(dir);
    const cache = await createJevPairCache(dir);
    const f = fixture();
    const zero = {
      ...f,
      collection: {
        ...f.collection,
        semanticRedundancy: {
          ...f.collection.semanticRedundancy,
          settings: {
            ...f.collection.semanticRedundancy.settings,
            weights: { factual: 1, description: 0, ownerNote: 0 },
          },
        },
      },
    };
    const identity = computeJevPairCoverage({ ...zero, cache }).identity;
    cache.setActivation({ identity, activatedAt: "2026-01-01T00:00:00Z" });
    const result = createJevPairReadService(cache).resolve(zero);
    expect(result.status).toBe("factual");
    expect("table" in result).toBe(true);
    cache.close();
  });

  test("zero factual weight keeps a coherent empty-signal pair table and fences row arrival", () => {
    const f = fixture();
    const zero = {
      ...f,
      collection: {
        ...f.collection,
        semanticRedundancy: {
          ...f.collection.semanticRedundancy,
          settings: {
            ...f.collection.semanticRedundancy.settings,
            weights: { factual: 0, description: 1, ownerNote: 1 },
          },
        },
      },
    };
    let present = false;
    const reader = createJevPairReadService({
      available: true,
      lookup: (key) =>
        present && key.gameAId === "a" && key.gameBId === "b" && key.signal === "C"
          ? row(zero.collection, zero.games[0], zero.games[1], "C")
          : null,
    });
    const before = reader.resolveWithProof(zero);
    expect(before.result.status).toBe("not-ready");
    expect("table" in before.result ? before.result.table?.pairs : []).toHaveLength(3);
    expect(before.isCurrent()).toBe(true);
    present = true;
    expect(before.isCurrent()).toBe(false);
    const after = reader.resolveWithProof(zero);
    expect(after.result.status).toBe("partial");
    expect(after.proof).not.toEqual(before.proof);

    if (!("table" in before.result) || !before.result.table) throw new Error("expected pair table");
    const context = createRedundancyFactualContext(
      zero.collection.games,
      DEFAULT_REDUNDANCY_SETTINGS.componentWeights,
    );
    const analysis = computeRedundancyAnalysis(
      zero.predictionCapture,
      { ...DEFAULT_REDUNDANCY_SETTINGS, enabled: true, similarityThreshold: 0 },
      (game) => context.getFeatureVector(game),
      before.result.table,
    );
    expect(analysis.adjustments.size).toBe(0);
    expect(analysis.defaultSimilarityInfo).toEqual({ status: "not-ready", generationId: null });

    const unavailable = createJevPairReadService({ available: false, lookup: () => null }).resolve(
      zero,
    );
    expect(unavailable.status).toBe("not-ready");
    expect("table" in unavailable).toBe(false);
  });
});
