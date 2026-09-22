import { describe, expect, test } from "bun:test";
import {
  ATTENTION_CANDIDATE_ARTIFACT_INDEX_VERSION,
  ATTENTION_CANDIDATE_ARTIFACT_SCHEMA_VERSION,
  AttentionCandidateArtifactSchema,
  createInitialEntityMetadata,
  type AttentionCandidateArtifact,
  type Collection,
  type DurableGame,
} from "@shelf-judge/shared";
import {
  AttentionCandidateService,
  createAttentionCandidateOracle,
  productionAttentionCandidateDependenciesForGame,
  type AttentionCandidateSource,
  type AttentionCandidateProductionSource,
} from "../../src/services/attention-candidate-service.js";
import type { DisplayedFitnessService } from "../../src/services/displayed-fitness-service.js";
import { DEFAULT_PREDICTION_SETTINGS } from "../../src/services/prediction-engine.js";
import { DEFAULT_REDUNDANCY_SETTINGS } from "../../src/services/redundancy-engine.js";
import { attentionRuleCatalog } from "../../src/services/attention-rule-catalog.js";
import { projectPurchaseUtilization } from "../../src/services/purchase-utilization-projection.js";

const hash = "a".repeat(64);
const observedAt = "2026-01-01T00:00:00.000Z";
const catalogRuleVersions = attentionRuleCatalog
  .map((rule) => ({
    ruleId: rule.id,
    ruleVersion: rule.version,
    scoringVersion: rule.scoringVersion,
  }))
  .sort((left, right) => left.ruleId.localeCompare(right.ruleId));

function ownedGame(id: string): DurableGame {
  return {
    id,
    name: id,
    bggId: null,
    entityMetadata: createInitialEntityMetadata(null),
    latestPlayCountCheck: null,
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: 60,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
    durationEvidence: { status: "valid", value: 60, source: "manual", observedAt },
    playerRangeEvidence: {
      status: "valid",
      value: { minPlayers: 2, maxPlayers: 2 },
      source: "manual",
      observedAt,
    },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    ownerNote: { state: "missing", version: 0, updatedAt: null },
    createdAt: observedAt,
    updatedAt: observedAt,
  };
}

function source(revision = 1, games: DurableGame[] = []): AttentionCandidateSource {
  return {
    collection: {
      schemaVersion: 8,
      revision,
      id: "collection",
      name: "Collection",
      axes: [],
      games,
      intentions: [],
      attentionDispositions: [],
      commandReceipts: [],
      entertainmentBenchmark: null,
      createdAt: observedAt,
      updatedAt: observedAt,
    } satisfies Collection,
    identity: {
      collectionId: "collection",
      collectionSchemaVersion: 8,
      collectionRevision: revision,
      tournamentHash: hash,
      predictionSettingsHash: hash,
      redundancySettingsHash: hash,
      calculationVersion: 1,
      ruleCatalogVersion: 1,
      dependencyVersion: 1,
      projectionVersion: 1,
      catalogRuleVersions,
    },
  };
}

function productionSource(
  revision: number,
  games: DurableGame[],
  attentionDispositions: Collection["attentionDispositions"] = [],
): AttentionCandidateProductionSource {
  const base = source(revision, games);
  return {
    ...base,
    collection: { ...base.collection, attentionDispositions },
    tournament: {
      settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
      sessions: [],
      gameStats: {},
    },
    predictionSettings: DEFAULT_PREDICTION_SETTINGS,
    redundancySettings: DEFAULT_REDUNDANCY_SETTINGS,
  };
}
function artifact(value: AttentionCandidateSource): AttentionCandidateArtifact {
  return {
    schemaVersion: ATTENTION_CANDIDATE_ARTIFACT_SCHEMA_VERSION,
    indexVersion: ATTENTION_CANDIDATE_ARTIFACT_INDEX_VERSION,
    identity: value.identity,
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    rows: [],
    dueBuckets: [],
    earliestBoundary: null,
    localDependencyIndex: [],
    sourceDependencyIndex: [],
    bggIdentityIndex: [],
  };
}

function dueArtifact(value: AttentionCandidateSource): AttentionCandidateArtifact {
  const boundary = "2026-01-02T00:00:00.000Z";
  const row = (gameId: string, nextEvaluationBoundary: string | null) => ({
    gameId,
    nameOrderingKey: gameId,
    evaluation: {
      gameId,
      winner: null,
      disposition: null,
      nextEvaluationBoundary,
      dependencyVersion: 1,
      ruleCatalogVersion: 1,
    },
    winnerPresentation: null,
    nonClockFingerprint: null,
    localDependencyGameIds: [gameId],
    sourceDependencyKeys: [],
    bggIds: [],
  });
  return {
    ...artifact(value),
    rows: [row("due", boundary), row("later", "2026-01-03T00:00:00.000Z")],
    dueBuckets: [
      { boundary, gameIds: ["due"] },
      { boundary: "2026-01-03T00:00:00.000Z", gameIds: ["later"] },
    ],
    earliestBoundary: boundary,
    localDependencyIndex: [
      { gameId: "due", dependentGameIds: ["due"] },
      { gameId: "later", dependentGameIds: ["later"] },
    ],
  };
}
function setup(initial: AttentionCandidateArtifact | null = null) {
  let stored = initial;
  let current = source();
  let oracleCalls = 0;
  let saves = 0;
  const service = new AttentionCandidateService({
    coordinator: { runExclusive: (operation) => operation() },
    clock: { now: () => new Date("2026-01-02T00:00:00.000Z") },
    loadSource: () => Promise.resolve(current),
    storage: {
      loadAttentionCandidates: () => Promise.resolve(stored),
      saveAttentionCandidates: (value) => {
        stored = value;
        saves += 1;
        return Promise.resolve();
      },
      discardAttentionCandidates: () => {
        stored = null;
        return Promise.resolve();
      },
    },
    oracle: {
      evaluate: () => {
        oracleCalls += 1;
        return Promise.resolve({ evaluations: [], presentations: new Map() });
      },
    },
  });
  return {
    service,
    get oracleCalls() {
      return oracleCalls;
    },
    get saves() {
      return saves;
    },
    setSource: (value: AttentionCandidateSource) => {
      current = value;
    },
    get stored() {
      return stored;
    },
  };
}

describe("AttentionCandidateService core", () => {
  test("valid non-due cache hit neither evaluates nor saves", async () => {
    const value = source();
    const fixture = setup(artifact(value));
    expect((await fixture.service.ensureFresh()).state).toBe("available");
    expect(fixture.oracleCalls).toBe(0);
    expect(fixture.saves).toBe(0);
  });
  test("fails closed without reading, evaluating, or publishing while durable recovery is required", async () => {
    let reads = 0;
    let saves = 0;
    let evaluations = 0;
    const service = new AttentionCandidateService({
      coordinator: { runExclusive: (operation) => operation() },
      clock: { now: () => new Date("2026-01-02T00:00:00.000Z") },
      recoveryRequired: () => true,
      loadSource: () => {
        reads += 1;
        return Promise.resolve(source());
      },
      storage: {
        loadAttentionCandidates: () => {
          reads += 1;
          return Promise.resolve(null);
        },
        saveAttentionCandidates: () => {
          saves += 1;
          return Promise.resolve();
        },
        discardAttentionCandidates: () => Promise.resolve(),
      },
      oracle: {
        evaluate: () => {
          evaluations += 1;
          return Promise.resolve({ evaluations: [], presentations: new Map() });
        },
      },
    });
    expect(await service.ensureFresh()).toEqual({ state: "unavailable", retryable: true });
    expect({ reads, saves, evaluations }).toEqual({ reads: 0, saves: 0, evaluations: 0 });
  });
  test("a warmed bounded cache checks only clock and source generation until generation changes", async () => {
    const current = source(1, [ownedGame("due"), ownedGame("later")]);
    let generation = 0;
    let sourceLoads = 0;
    let artifactLoads = 0;
    let clockReads = 0;
    let oracleCalls = 0;
    const service = new AttentionCandidateService({
      coordinator: { runExclusive: (operation) => operation() },
      clock: {
        now: () => {
          clockReads += 1;
          return new Date("2026-01-01T00:00:00.000Z");
        },
      },
      sourceGeneration: () => generation,
      loadSource: () => {
        sourceLoads += 1;
        return Promise.resolve(current);
      },
      storage: {
        loadAttentionCandidates: () => {
          artifactLoads += 1;
          return Promise.resolve(dueArtifact(current));
        },
        saveAttentionCandidates: () => Promise.resolve(),
        discardAttentionCandidates: () => Promise.resolve(),
      },
      oracle: {
        evaluate: () => {
          oracleCalls += 1;
          return Promise.resolve({ evaluations: [], presentations: new Map() });
        },
      },
    });

    expect((await service.ensureFresh()).state).toBe("available");
    expect({ sourceLoads, artifactLoads, oracleCalls }).toEqual({
      sourceLoads: 1,
      artifactLoads: 1,
      oracleCalls: 0,
    });
    const warmClockReads = clockReads;
    expect((await service.ensureFresh()).state).toBe("available");
    expect({ sourceLoads, artifactLoads, oracleCalls, clockReads }).toEqual({
      sourceLoads: 1,
      artifactLoads: 1,
      oracleCalls: 0,
      clockReads: warmClockReads + 1,
    });

    generation += 1;
    expect((await service.ensureFresh()).state).toBe("available");
    expect({ sourceLoads, artifactLoads, oracleCalls }).toEqual({
      sourceLoads: 2,
      artifactLoads: 2,
      oracleCalls: 0,
    });
  });
  test("a warmed null-boundary cache avoids all candidate validation work until generation changes", async () => {
    const current = source(1);
    let generation = 0;
    let sourceLoads = 0;
    let artifactLoads = 0;
    let clockReads = 0;
    let rowAccesses = 0;
    let displayedFitnessCalls = 0;
    let oracleCalls = 0;
    let saves = 0;
    const stored = new Proxy(artifact(current), {
      get(target, property) {
        if (property === "rows") rowAccesses += 1;
        return target[property as keyof AttentionCandidateArtifact];
      },
    });
    const service = new AttentionCandidateService({
      coordinator: { runExclusive: (operation) => operation() },
      clock: {
        now: () => {
          clockReads += 1;
          return new Date("2026-01-01T00:00:00.000Z");
        },
      },
      sourceGeneration: () => generation,
      loadSource: () => {
        sourceLoads += 1;
        return Promise.resolve(current);
      },
      storage: {
        loadAttentionCandidates: () => {
          artifactLoads += 1;
          return Promise.resolve(stored);
        },
        saveAttentionCandidates: () => {
          saves += 1;
          return Promise.resolve();
        },
        discardAttentionCandidates: () => Promise.resolve(),
      },
      oracle: {
        evaluate: () => {
          displayedFitnessCalls += 1;
          oracleCalls += 1;
          return Promise.resolve({ evaluations: [], presentations: new Map() });
        },
      },
    });

    expect((await service.ensureFresh()).state).toBe("available");
    expect({ sourceLoads, artifactLoads, displayedFitnessCalls, oracleCalls, saves }).toEqual({
      sourceLoads: 1,
      artifactLoads: 1,
      displayedFitnessCalls: 0,
      oracleCalls: 0,
      saves: 0,
    });

    const warmClockReads = clockReads;
    const warmRowAccesses = rowAccesses;
    expect((await service.ensureFresh()).state).toBe("available");
    expect({
      sourceLoads,
      artifactLoads,
      rowAccesses,
      displayedFitnessCalls,
      oracleCalls,
      saves,
      clockReads,
    }).toEqual({
      sourceLoads: 1,
      artifactLoads: 1,
      rowAccesses: warmRowAccesses,
      displayedFitnessCalls: 0,
      oracleCalls: 0,
      saves: 0,
      clockReads: warmClockReads + 1,
    });

    generation += 1;
    expect((await service.ensureFresh()).state).toBe("available");
    expect({ sourceLoads, artifactLoads, displayedFitnessCalls, oracleCalls, saves }).toEqual({
      sourceLoads: 2,
      artifactLoads: 2,
      displayedFitnessCalls: 0,
      oracleCalls: 0,
      saves: 0,
    });
  });
  test("targeted maintenance expands persisted local reverse dependencies and rejects incomplete results", async () => {
    const current = source(1, [ownedGame("requested"), ownedGame("dependent")]);
    const existing = {
      ...dueArtifact(current),
      rows: dueArtifact(current).rows.map((row, index) => ({
        ...row,
        gameId: index === 0 ? "requested" : "dependent",
        nameOrderingKey: index === 0 ? "requested" : "dependent",
        evaluation: { ...row.evaluation, gameId: index === 0 ? "requested" : "dependent" },
        localDependencyGameIds: index === 0 ? ["requested"] : ["requested", "dependent"],
      })),
      dueBuckets: [
        { boundary: "2026-01-02T00:00:00.000Z", gameIds: ["requested"] },
        { boundary: "2026-01-03T00:00:00.000Z", gameIds: ["dependent"] },
      ],
      localDependencyIndex: [
        { gameId: "requested", dependentGameIds: ["dependent", "requested"] },
        { gameId: "dependent", dependentGameIds: ["dependent"] },
      ],
    } satisfies AttentionCandidateArtifact;
    const calls: (readonly string[] | undefined)[] = [];
    let saves = 0;
    const service = new AttentionCandidateService({
      coordinator: { runExclusive: (operation) => operation() },
      clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
      loadSource: () => Promise.resolve(current),
      storage: {
        loadAttentionCandidates: () => Promise.resolve(existing),
        saveAttentionCandidates: () => {
          saves += 1;
          return Promise.resolve();
        },
        discardAttentionCandidates: () => Promise.resolve(),
      },
      oracle: {
        evaluate: (_source, _at, targets) => {
          calls.push(targets);
          return Promise.resolve({
            evaluations: [existing.rows[0].evaluation],
            presentations: new Map(),
          });
        },
      },
    });
    expect((await service.maintain({ kind: "games", gameIds: ["requested"] })).state).toBe(
      "unavailable",
    );
    expect(calls).toEqual([["dependent", "requested"]]);
    expect(saves).toBe(0);
  });
  test("at-or-before due maintenance evaluates only due rows and preserves other rows", async () => {
    const current = source(1, [ownedGame("due"), ownedGame("later")]);
    const calls: (readonly string[] | undefined)[] = [];
    const saves: AttentionCandidateArtifact[] = [];
    const service = new AttentionCandidateService({
      coordinator: { runExclusive: (operation) => operation() },
      clock: { now: () => new Date("2026-01-02T00:00:00.000Z") },
      loadSource: () => Promise.resolve(current),
      storage: {
        loadAttentionCandidates: () => Promise.resolve(dueArtifact(current)),
        saveAttentionCandidates: (value) => {
          saves.push(value);
          return Promise.resolve();
        },
        discardAttentionCandidates: () => Promise.resolve(),
      },
      oracle: {
        evaluate: (_source, _evaluatedAt, targetGameIds) => {
          calls.push(targetGameIds);
          return Promise.resolve({
            evaluations: [dueArtifact(current).rows[0]?.evaluation].filter(
              (evaluation): evaluation is NonNullable<typeof evaluation> =>
                evaluation !== undefined,
            ),
            presentations: new Map(),
          });
        },
      },
    });

    expect((await service.ensureFresh()).state).toBe("available");
    expect(calls).toEqual([["due"]]);
    expect(saves[0]?.rows.map((row) => row.gameId)).toEqual(["due", "later"]);
  });
  test("global rebuild uses one UTC instant and publishes only a complete validated artifact", async () => {
    const fixture = setup();
    expect((await fixture.service.maintain({ kind: "global", reason: "recovery" })).state).toBe(
      "available",
    );
    expect(fixture.oracleCalls).toBe(1);
    expect(fixture.saves).toBe(1);
    expect(fixture.stored?.evaluatedAt).toBe("2026-01-02T00:00:00.000Z");
  });
  test("post-commit identity-only rebase saves the new revision without an oracle call", async () => {
    const prior = source(1, [ownedGame("due"), ownedGame("later")]);
    const current = source(2, [ownedGame("due"), ownedGame("later")]);
    let stored: AttentionCandidateArtifact | null = dueArtifact(prior);
    let evaluations = 0;
    const service = new AttentionCandidateService({
      coordinator: { runExclusive: (operation) => operation() },
      clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
      loadSource: () => Promise.resolve(current),
      storage: {
        loadAttentionCandidates: () => Promise.resolve(stored),
        saveAttentionCandidates: (artifact) => {
          stored = artifact;
          return Promise.resolve();
        },
        discardAttentionCandidates: async () => {},
      },
      oracle: {
        evaluate: () => {
          evaluations += 1;
          return Promise.resolve({ evaluations: [], presentations: new Map() });
        },
      },
    });
    expect(
      (await service.maintainAfterCollectionCommit({ kind: "games", gameIds: [] })).state,
    ).toBe("available");
    expect(evaluations).toBe(0);
    expect(stored?.identity.collectionRevision).toBe(2);
    expect(stored?.rows.map((row) => row.gameId)).toEqual(["due", "later"]);
  });
  test("post-commit maintenance exposes the exact swallowed error to its test observer", async () => {
    const initial = source(1, [ownedGame("due"), ownedGame("later")]);
    let sourceReads = 0;
    const errors: unknown[] = [];
    const service = new AttentionCandidateService({
      coordinator: { runExclusive: (operation) => operation() },
      clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
      loadSource: () =>
        Promise.resolve(sourceReads++ === 0 ? initial : source(2, initial.collection.games)),
      storage: {
        loadAttentionCandidates: () => Promise.resolve(dueArtifact(initial)),
        saveAttentionCandidates: () => Promise.resolve(),
        discardAttentionCandidates: () => Promise.resolve(),
      },
      oracle: { evaluate: () => Promise.resolve({ evaluations: [], presentations: new Map() }) },
      onMaintenanceError: (error) => errors.push(error),
    });

    expect(await service.maintainAfterCollectionCommit({ kind: "games", gameIds: [] })).toEqual({
      state: "unavailable",
      retryable: true,
    });
    expect(errors).toHaveLength(1);
    const [error] = errors;
    if (!(error instanceof Error)) throw new Error("Expected observer to receive an Error");
    expect(error.message).toBe("Attention candidate source changed after collection commit");
  });
  test("post-commit local maintenance matches an isolated full rebuild with a hidden row", async () => {
    const evaluatedAt = "2026-01-02T00:00:00.000Z";
    const games = [
      ownedGame("local"),
      {
        ...ownedGame("hidden"),
        latestPlayCountCheck: { status: "valid" as const, value: 0, observedAt },
        playCountEvidence: {
          status: "valid" as const,
          value: 0,
          source: "manual" as const,
          observedAt,
        },
        numPlays: 0,
      },
      ownedGame("other"),
    ];
    const displayedFitness: DisplayedFitnessService = {
      listGames: () => Promise.resolve([]),
      listGamesFromSnapshot: (snapshot) =>
        Promise.resolve(
          snapshot.collection.games.map((game) => ({
            game,
            score: null,
            hasPredictedContribution: false,
            hasScoringContribution: false,
          })),
        ),
    };
    const productionOracle = createAttentionCandidateOracle(displayedFitness);
    const undisposed = productionSource(1, games);
    const hiddenEvaluation = (
      await productionOracle.evaluate(undisposed, evaluatedAt)
    ).evaluations.find((evaluation) => evaluation.gameId === "hidden");
    if (hiddenEvaluation?.winner === null || hiddenEvaluation === undefined)
      throw new Error("Fixture must produce a hidden candidate before disposition");
    const dispositions: Collection["attentionDispositions"] = [
      {
        gameId: "hidden",
        kind: "intentional",
        ruleId: hiddenEvaluation.winner.ruleId,
        ruleVersion: hiddenEvaluation.winner.ruleVersion,
        fingerprint: hiddenEvaluation.winner.fingerprint,
        version: 1,
      },
    ];
    const prior = productionSource(1, games, dispositions);
    const current = productionSource(2, games, dispositions);
    let stored: AttentionCandidateArtifact | null = null;
    const fullBaseline = new AttentionCandidateService<AttentionCandidateProductionSource>({
      coordinator: { runExclusive: (operation) => operation() },
      clock: { now: () => new Date(evaluatedAt) },
      loadSource: () => Promise.resolve(prior),
      storage: {
        loadAttentionCandidates: () => Promise.resolve(stored),
        saveAttentionCandidates: (value) => {
          stored = value;
          return Promise.resolve();
        },
        discardAttentionCandidates: () => Promise.resolve(),
      },
      oracle: productionOracle,
      dependenciesForGame: productionAttentionCandidateDependenciesForGame,
    });
    expect((await fullBaseline.maintain({ kind: "global", reason: "recovery" })).state).toBe(
      "available",
    );
    const baseline = AttentionCandidateArtifactSchema.parse(stored);
    expect(baseline.rows.find((row) => row.gameId === "hidden")?.evaluation.disposition?.kind).toBe(
      "intentional",
    );

    const stages: string[] = ["prior-artifact-compatible"];
    const errors: unknown[] = [];
    const localOracle = {
      evaluate: async (
        snapshot: AttentionCandidateProductionSource,
        at: string,
        targetGameIds?: readonly string[],
      ) => {
        stages.push(`expanded-targets:${targetGameIds?.join(",") ?? "full"}`);
        const result = await productionOracle.evaluate(snapshot, at, targetGameIds);
        stages.push(
          `oracle-output:${result.evaluations.map((evaluation) => evaluation.gameId).join(",")}`,
        );
        return result;
      },
    };
    let sourceReads = 0;
    const incremental = new AttentionCandidateService<AttentionCandidateProductionSource>({
      coordinator: { runExclusive: (operation) => operation() },
      clock: { now: () => new Date(evaluatedAt) },
      loadSource: () => {
        sourceReads += 1;
        stages.push(sourceReads === 1 ? "source-load" : "durable-identity-reread");
        return Promise.resolve(current);
      },
      storage: {
        loadAttentionCandidates: () => Promise.resolve(stored),
        saveAttentionCandidates: (value) => {
          AttentionCandidateArtifactSchema.parse(value);
          stages.push("build-artifact-validation-and-save");
          stored = value;
          return Promise.resolve();
        },
        discardAttentionCandidates: () => Promise.resolve(),
      },
      oracle: localOracle,
      dependenciesForGame: productionAttentionCandidateDependenciesForGame,
      onMaintenanceError: (error) => errors.push(error),
    });
    const incrementalResult = await incremental.maintainAfterCollectionCommit({
      kind: "games",
      gameIds: ["local"],
    });
    expect(incrementalResult.state).toBe("available");
    expect(errors).toEqual([]);
    expect(stages).toEqual([
      "prior-artifact-compatible",
      "source-load",
      "expanded-targets:local",
      "oracle-output:local",
      "durable-identity-reread",
      "build-artifact-validation-and-save",
    ]);
    if (incrementalResult.state !== "available") throw new Error("Expected incremental artifact");

    let rebuilt: AttentionCandidateArtifact | null = null;
    const isolated = new AttentionCandidateService<AttentionCandidateProductionSource>({
      coordinator: { runExclusive: (operation) => operation() },
      clock: { now: () => new Date(evaluatedAt) },
      loadSource: () => Promise.resolve(current),
      storage: {
        loadAttentionCandidates: () => Promise.resolve(null),
        saveAttentionCandidates: (value) => {
          rebuilt = value;
          return Promise.resolve();
        },
        discardAttentionCandidates: () => Promise.resolve(),
      },
      oracle: productionOracle,
      dependenciesForGame: productionAttentionCandidateDependenciesForGame,
    });
    expect((await isolated.maintain({ kind: "global", reason: "recovery" })).state).toBe(
      "available",
    );
    expect(incrementalResult.artifact).toEqual(AttentionCandidateArtifactSchema.parse(rebuilt));
  });
  test("post-commit maintenance evaluates each requested and multi-overdue target once", async () => {
    const prior = source(1, [ownedGame("due"), ownedGame("later")]);
    const current = source(2, prior.collection.games);
    const original = dueArtifact(prior);
    const existing = {
      ...original,
      rows: original.rows.map((row) => ({
        ...row,
        evaluation: { ...row.evaluation, nextEvaluationBoundary: "2026-01-02T00:00:00.000Z" },
      })),
      dueBuckets: [{ boundary: "2026-01-02T00:00:00.000Z", gameIds: ["due", "later"] }],
      earliestBoundary: "2026-01-02T00:00:00.000Z",
    } satisfies AttentionCandidateArtifact;
    const calls: (readonly string[] | undefined)[] = [];
    const oracle = {
      evaluate: (_source: AttentionCandidateSource, _at: string, targets?: readonly string[]) => {
        calls.push(targets);
        return Promise.resolve({
          evaluations: existing.rows
            .map((row) => row.evaluation)
            .filter((evaluation) => targets === undefined || targets.includes(evaluation.gameId)),
          presentations: new Map(),
        });
      },
    };
    let stored: AttentionCandidateArtifact | null = existing;
    const incremental = new AttentionCandidateService({
      coordinator: { runExclusive: (operation) => operation() },
      clock: { now: () => new Date("2026-01-02T00:00:00.000Z") },
      loadSource: () => Promise.resolve(current),
      storage: {
        loadAttentionCandidates: () => Promise.resolve(stored),
        saveAttentionCandidates: (value) => {
          stored = value;
          return Promise.resolve();
        },
        discardAttentionCandidates: () => Promise.resolve(),
      },
      oracle,
    });
    const result = await incremental.maintainAfterCollectionCommit({
      kind: "games",
      gameIds: ["due"],
    });
    expect(result.state).toBe("available");
    expect(calls).toEqual([["due", "later"]]);
    if (result.state !== "available") throw new Error("Expected incremental artifact");

    let rebuilt: AttentionCandidateArtifact | null = null;
    const full = new AttentionCandidateService({
      coordinator: { runExclusive: (operation) => operation() },
      clock: { now: () => new Date("2026-01-02T00:00:00.000Z") },
      loadSource: () => Promise.resolve(current),
      storage: {
        loadAttentionCandidates: () => Promise.resolve(null),
        saveAttentionCandidates: (value) => {
          rebuilt = value;
          return Promise.resolve();
        },
        discardAttentionCandidates: () => Promise.resolve(),
      },
      oracle,
    });
    expect((await full.maintain({ kind: "global", reason: "recovery" })).state).toBe("available");
    expect(result.artifact).toEqual(AttentionCandidateArtifactSchema.parse(rebuilt));
  });
  test("post-commit maintenance rejects every malformed targeted oracle result before publication", async () => {
    const baselineSource = source(1, [
      ownedGame("due"),
      ownedGame("later"),
      { ...ownedGame("not-owned"), ownership: "previously-owned" as const },
    ]);
    const current = source(2, baselineSource.collection.games);
    const baseline = AttentionCandidateArtifactSchema.parse(dueArtifact(baselineSource));
    const [requested, unrequested] = baseline.rows.map((row) => row.evaluation);
    if (requested === undefined || unrequested === undefined)
      throw new Error("Expected schema-valid two-row baseline artifact");
    const cases: readonly {
      readonly name: string;
      readonly evaluations: readonly (typeof requested)[];
    }[] = [
      { name: "missing requested owned target", evaluations: [] },
      { name: "duplicate requested target", evaluations: [requested, requested] },
      { name: "wrong ID replacing requested target", evaluations: [unrequested] },
      {
        name: "non-owned extra evaluation",
        evaluations: [{ ...requested, gameId: "not-owned" }],
      },
      { name: "extra unrequested owned evaluation", evaluations: [requested, unrequested] },
    ];
    for (const fixture of cases) {
      const stored: AttentionCandidateArtifact | null = baseline;
      const priorBytes = JSON.stringify(stored);
      const errors: unknown[] = [];
      let saves = 0;
      let sourceLoads = 0;
      let discards = 0;
      const service = new AttentionCandidateService({
        coordinator: { runExclusive: (operation) => operation() },
        clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
        loadSource: () => {
          sourceLoads += 1;
          return Promise.resolve(current);
        },
        storage: {
          loadAttentionCandidates: () => Promise.resolve(stored),
          saveAttentionCandidates: () => {
            saves += 1;
            return Promise.resolve();
          },
          discardAttentionCandidates: () => {
            discards += 1;
            return Promise.resolve();
          },
        },
        oracle: {
          evaluate: () =>
            Promise.resolve({ evaluations: fixture.evaluations, presentations: new Map() }),
        },
        onMaintenanceError: (error) => errors.push(error),
      });

      expect(
        await service.maintainAfterCollectionCommit({ kind: "games", gameIds: ["due"] }),
        fixture.name,
      ).toEqual({ state: "unavailable", retryable: true });
      expect(errors, fixture.name).toHaveLength(1);
      const [error] = errors;
      if (!(error instanceof Error)) throw new Error(`Expected Error for ${fixture.name}`);
      expect(error.message, fixture.name).toBe(
        "Candidate oracle results must exactly cover owned evaluation targets",
      );
      expect({ saves, discards, sourceLoads }, fixture.name).toEqual({
        saves: 0,
        discards: 1,
        sourceLoads: 1,
      });
      expect(JSON.stringify(stored), fixture.name).toBe(priorBytes);
    }

    let stored: AttentionCandidateArtifact | null = baseline;
    let saves = 0;
    let sourceLoads = 0;
    const updatedRequested = { ...requested, nextEvaluationBoundary: null };
    const valid = new AttentionCandidateService({
      coordinator: { runExclusive: (operation) => operation() },
      clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
      loadSource: () => {
        sourceLoads += 1;
        return Promise.resolve(current);
      },
      storage: {
        loadAttentionCandidates: () => Promise.resolve(stored),
        saveAttentionCandidates: (artifact) => {
          saves += 1;
          stored = artifact;
          return Promise.resolve();
        },
        discardAttentionCandidates: () => Promise.resolve(),
      },
      oracle: {
        evaluate: () =>
          Promise.resolve({ evaluations: [updatedRequested], presentations: new Map() }),
      },
    });
    const result = await valid.maintainAfterCollectionCommit({ kind: "games", gameIds: ["due"] });
    expect(result.state).toBe("available");
    expect({ saves, sourceLoads }).toEqual({ saves: 1, sourceLoads: 2 });
    if (result.state !== "available") throw new Error("Expected exact target result to publish");
    expect(result.artifact.identity.collectionRevision).toBe(2);
    expect(result.artifact.rows.find((row) => row.gameId === "due")?.evaluation).toEqual(
      updatedRequested,
    );
    expect(result.artifact.rows.find((row) => row.gameId === "later")?.evaluation).toEqual(
      unrequested,
    );
  });
  test("production adapter uses the snapshot fitness oracle and projection path", async () => {
    const production: AttentionCandidateProductionSource = {
      ...source(1, [ownedGame("game")]),
      tournament: {
        settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
        sessions: [],
        gameStats: {},
      },
      predictionSettings: DEFAULT_PREDICTION_SETTINGS,
      redundancySettings: DEFAULT_REDUNDANCY_SETTINGS,
    };
    const snapshots: Parameters<DisplayedFitnessService["listGamesFromSnapshot"]>[0][] = [];
    const displayedFitness: DisplayedFitnessService = {
      listGames: () => Promise.resolve([]),
      listGamesFromSnapshot: (snapshot, options) => {
        snapshots.push(snapshot);
        expect(options.targetGameIds).toEqual(["game"]);
        return Promise.resolve([
          {
            game: production.collection.games[0],
            score: null,
            hasPredictedContribution: false,
            hasScoringContribution: false,
          },
        ]);
      },
    };

    const result = await createAttentionCandidateOracle(displayedFitness).evaluate(
      production,
      "2026-01-02T00:00:00.000Z",
      ["game"],
    );

    expect(snapshots).toEqual([production]);
    expect(result.evaluations.map((evaluation) => evaluation.gameId)).toEqual(["game"]);
  });
  test("production adapter projects only target output while preserving full evaluation parity", async () => {
    const production: AttentionCandidateProductionSource = {
      ...productionSource(1, [ownedGame("target"), ownedGame("peer")]),
    };
    const displayedFitness: DisplayedFitnessService = {
      listGames: () => Promise.resolve([]),
      listGamesFromSnapshot: (snapshot, options) =>
        Promise.resolve(
          snapshot.collection.games
            .filter(
              (game) =>
                options.targetGameIds === undefined || options.targetGameIds.includes(game.id),
            )
            .map((game) => ({
              game,
              score: null,
              hasPredictedContribution: false,
              hasScoringContribution: false,
            })),
        ),
    };
    const projected: string[] = [];
    const oracle = createAttentionCandidateOracle(displayedFitness, {
      projectPurchaseUtilization: (entry, benchmark) => {
        projected.push(entry.game.id);
        return projectPurchaseUtilization(entry, benchmark);
      },
    });
    const at = "2026-01-02T00:00:00.000Z";
    const full = await oracle.evaluate(production, at);
    expect(projected).toEqual(["target", "peer"]);
    projected.length = 0;
    const targeted = await oracle.evaluate(production, at, ["target", "target"]);
    expect(projected).toEqual(["target"]);
    expect(targeted.evaluations).toEqual(
      full.evaluations.filter((evaluation) => evaluation.gameId === "target"),
    );
  });
  test("production dependency resolver derives deterministic catalog and BGG indexes", () => {
    const production: AttentionCandidateProductionSource = {
      ...source(1, [{ ...ownedGame("game"), bggId: 7, additionalBggIds: [3, 7, 5] }]),
      tournament: {
        settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
        sessions: [],
        gameStats: {},
      },
      predictionSettings: DEFAULT_PREDICTION_SETTINGS,
      redundancySettings: DEFAULT_REDUNDANCY_SETTINGS,
    };
    expect(productionAttentionCandidateDependenciesForGame("game", production)).toEqual({
      localGameIds: ["game"],
      sourceKeys: ["predictionSettingsHash", "redundancySettingsHash", "tournamentHash"],
      bggIds: [3, 5, 7],
    });
  });
  test("catalog manifest changes invalidate cold artifacts and prior-revision rebases", async () => {
    const current = source();
    const changedManifest = (field: "ruleVersion" | "scoringVersion") => ({
      ...current,
      identity: {
        ...current.identity,
        catalogRuleVersions: current.identity.catalogRuleVersions.map((rule, index) =>
          index === 0 ? { ...rule, [field]: rule[field] + 1 } : rule,
        ),
      },
    });
    for (const field of ["ruleVersion", "scoringVersion"] as const) {
      const stale = changedManifest(field);
      let oracleCalls = 0;
      let saves = 0;
      const service = new AttentionCandidateService({
        coordinator: { runExclusive: (operation) => operation() },
        clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
        loadSource: () => Promise.resolve(current),
        storage: {
          loadAttentionCandidates: () => Promise.resolve(artifact(stale)),
          saveAttentionCandidates: (value) => {
            saves += 1;
            expect(value.identity.catalogRuleVersions).toEqual(
              current.identity.catalogRuleVersions,
            );
            return Promise.resolve();
          },
          discardAttentionCandidates: () => Promise.resolve(),
        },
        oracle: {
          evaluate: (_source, _at, targets) => {
            oracleCalls += 1;
            expect(targets).toBeUndefined();
            return Promise.resolve({ evaluations: [], presentations: new Map() });
          },
        },
      });
      expect((await service.ensureFresh()).state, field).toBe("available");
      expect({ oracleCalls, saves }, field).toEqual({ oracleCalls: 1, saves: 1 });
    }

    const prior = source(1);
    const currentRevision = source(2);
    const stalePrior = changedManifest("ruleVersion");
    let rebaseOracleCalls = 0;
    const rebase = new AttentionCandidateService({
      coordinator: { runExclusive: (operation) => operation() },
      clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
      loadSource: () => Promise.resolve(currentRevision),
      storage: {
        loadAttentionCandidates: () =>
          Promise.resolve(artifact({ ...prior, identity: stalePrior.identity })),
        saveAttentionCandidates: (value) => {
          expect(value.identity.catalogRuleVersions).toEqual(
            currentRevision.identity.catalogRuleVersions,
          );
          return Promise.resolve();
        },
        discardAttentionCandidates: () => Promise.resolve(),
      },
      oracle: {
        evaluate: (_source, _at, targets) => {
          rebaseOracleCalls += 1;
          expect(targets).toBeUndefined();
          return Promise.resolve({ evaluations: [], presentations: new Map() });
        },
      },
    });
    expect((await rebase.maintainAfterCollectionCommit({ kind: "games", gameIds: [] })).state).toBe(
      "available",
    );
    expect(rebaseOracleCalls).toBe(1);
  });
  test("identity race retries before publication", async () => {
    const fixture = setup();
    let reads = 0;
    const raced = new AttentionCandidateService({
      coordinator: { runExclusive: (operation) => operation() },
      clock: { now: () => new Date("2026-01-02T00:00:00.000Z") },
      loadSource: () => {
        reads += 1;
        return Promise.resolve(reads >= 2 ? source(2) : source(1));
      },
      storage: {
        loadAttentionCandidates: () => Promise.resolve(null),
        saveAttentionCandidates: () => Promise.resolve(),
        discardAttentionCandidates: () => Promise.resolve(),
      },
      oracle: { evaluate: () => Promise.resolve({ evaluations: [], presentations: new Map() }) },
    });
    expect((await raced.maintain({ kind: "global", reason: "recovery" })).state).toBe("available");
    void fixture;
  });
  test("oracle or persistence failures are retryable unavailable and publish nothing", async () => {
    const failed = new AttentionCandidateService({
      coordinator: { runExclusive: (operation) => operation() },
      clock: { now: () => new Date() },
      loadSource: () => Promise.resolve(source()),
      storage: {
        loadAttentionCandidates: () => Promise.resolve(null),
        saveAttentionCandidates: () => Promise.reject(new Error("disk failed")),
        discardAttentionCandidates: () => Promise.resolve(),
      },
      oracle: { evaluate: () => Promise.resolve({ evaluations: [], presentations: new Map() }) },
    });
    expect(await failed.maintain({ kind: "global", reason: "recovery" })).toEqual({
      state: "unavailable",
      retryable: true,
    });
  });
});
