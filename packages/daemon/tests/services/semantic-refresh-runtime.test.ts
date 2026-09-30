import { describe, expect, test } from "bun:test";
import {
  createInitialEntityMetadata,
  type Collection,
  type DurableGame,
  type SemanticDisclosureManifest,
} from "@shelf-judge/shared";
import type { SemanticRedundancyStateService } from "../../src/services/semantic-redundancy-state-service.js";
import type { SemanticRefreshCaptureService } from "../../src/services/semantic-refresh-capture-service.js";
import type { SemanticRefreshService } from "../../src/services/semantic-refresh-service.js";
import { SEMANTIC_CAPTURE_POLICY } from "../../src/services/semantic-refresh-capture-service.js";
import { createSemanticRefreshRuntime } from "../../src/services/semantic-refresh-runtime.js";
import { profileSourceCoordinatorFor } from "../../src/services/profile-source-coordinator.js";
import { JEV_MODEL_ID, JEV_RUBRIC_VERSION } from "../../src/services/jev/jev-gateway.js";
import { resolveSemanticRedundancyPairTable } from "../../src/services/semantic-redundancy-pair-resolver.js";
import {
  semanticDescriptionSourceFingerprint,
  semanticOwnerNoteSourceFingerprint,
} from "../../src/services/semantic-redundancy-state-service.js";
import {
  semanticGenerationFixture,
  semanticSourceIdentityFixture,
} from "../helpers/semantic-redundancy-fixtures.js";

const identity = semanticSourceIdentityFixture({ collectionId: "runtime" });
const manifest = {
  id: "manifest-1",
  digest: "d".repeat(64),
  sourceIdentity: identity,
  scoringVersion: 1,
  signalScope: "description-only",
  providerId: "fake",
  modelId: JEV_MODEL_ID,
  rubricVersion: JEV_RUBRIC_VERSION,
  budget: { maxRequests: 1, maxTokens: 10, maxDurationMs: 60_000 },
  expiresAt: "2027-01-01T00:00:00.000Z",
  eligibleGameIds: [],
  pairs: [],
} as unknown as SemanticDisclosureManifest;

function harness(
  options: { running?: boolean; workerGate?: Promise<void>; expiresAt?: string } = {},
) {
  let coordinatorHeld = false;
  let currentGames: DurableGame[] = [];
  let state: Record<string, unknown> = {
    settings: { enabled: true },
    publishedGeneration: null,
    disclosureManifest: manifest,
    manifestDelivery: { complete: true },
    authorization: { state: "active" },
    execution: options.running
      ? {
          commandId: manifest.id,
          manifestDigest: manifest.digest,
          status: "running",
          sourceIdentity: identity,
          signalScope: "description-only",
          noteTransmissionAuthorized: false,
          cachedOwnerNoteUseAuthorized: false,
          attemptCount: 0,
          completedPairCount: 0,
          failedPairCount: 0,
          startedAt: new Date().toISOString(),
          deadlineAt: "2027-01-01T00:00:00.000Z",
        }
      : null,
  };
  let currentIdentity = identity;
  const starts: unknown[] = [];
  const captureRequests: unknown[] = [];
  const workers: string[] = [];
  const finishes: unknown[] = [];
  let cancelCalls = 0;
  let durableCancelCalls = 0;
  let workerAborted = false;
  const workerController = new AbortController();
  let workerResolve!: () => void;
  const workerSettled =
    options.workerGate ??
    new Promise<void>((resolve) => {
      workerResolve = resolve;
    });
  const stateService = {
    startExecution(input: Parameters<SemanticRedundancyStateService["startExecution"]>[0]) {
      starts.push(input);
      if (Date.parse(input.deadlineAt) <= Date.parse("2026-01-01T00:00:00.000Z"))
        return Promise.resolve({
          outcome: "stale" as const,
          current: { evidenceEpoch: 0, consentEpoch: 0 },
        });
      if (starts.length > 1)
        return Promise.resolve({
          outcome: "accepted" as const,
          value: { disposition: "REPLAYED" as const },
        });
      state.execution = {
        ...(typeof state.execution === "object" && state.execution !== null ? state.execution : {}),
        commandId: manifest.id,
        manifestDigest: manifest.digest,
        status: "running",
        deadlineAt: input.deadlineAt,
      };
      return Promise.resolve({
        outcome: "accepted" as const,
        value: { disposition: "CREATED" as const },
      });
    },
    deliverDisclosurePage(
      input: Parameters<SemanticRedundancyStateService["deliverDisclosurePage"]>[0],
    ) {
      return Promise.resolve({ outcome: "accepted" as const, value: input });
    },
    cancelExecution(id: string) {
      durableCancelCalls += 1;
      return Promise.resolve({ outcome: "accepted" as const, value: id });
    },
    finishExecution(input: Parameters<SemanticRedundancyStateService["finishExecution"]>[0]) {
      finishes.push(input);
      return Promise.resolve({ outcome: "accepted" as const });
    },
  } as unknown as SemanticRedundancyStateService;
  const captureService = {
    captureAndDisclose(
      request: Parameters<SemanticRefreshCaptureService["captureAndDisclose"]>[0],
    ) {
      captureRequests.push(request);
      return Promise.resolve({
        outcome: "accepted" as const,
        value: { id: manifest.id, digest: manifest.digest },
      });
    },
    async withCurrentManifest(input: { operation: () => Promise<unknown> }) {
      coordinatorHeld = true;
      try {
        return await input.operation();
      } finally {
        coordinatorHeld = false;
      }
    },
    validateSourceIdentity(_collection: Collection, expected: typeof identity) {
      return Promise.resolve(JSON.stringify(expected) === JSON.stringify(currentIdentity));
    },
  } as unknown as SemanticRefreshCaptureService;
  const worker = {
    async run(id: string) {
      expect(coordinatorHeld).toBe(false);
      workers.push(id);
      await Promise.race([
        workerSettled,
        new Promise<void>((resolve) =>
          workerController.signal.addEventListener(
            "abort",
            () => {
              workerAborted = true;
              resolve();
            },
            { once: true },
          ),
        ),
      ]);
      return { outcome: "accepted" };
    },
    cancel() {
      cancelCalls += 1;
      workerController.abort();
      return Promise.resolve({ outcome: "accepted" as const });
    },
  } as unknown as SemanticRefreshService;
  const runtime = createSemanticRefreshRuntime({
    stateService,
    captureService,
    worker,
    storageService: {
      loadCollection() {
        return Promise.resolve({
          id: "runtime",
          schemaVersion: 9,
          games: currentGames,
          semanticRedundancy: options.expiresAt
            ? { ...state, disclosureManifest: { ...manifest, expiresAt: options.expiresAt } }
            : state,
        } as unknown as Collection);
      },
    },
    now: () => Date.parse("2026-01-01T00:00:00.000Z"),
  });
  return {
    runtime,
    starts,
    captureRequests,
    workers,
    finishes,
    get cancelCalls() {
      return cancelCalls;
    },
    get durableCancelCalls() {
      return durableCancelCalls;
    },
    get workerAborted() {
      return workerAborted;
    },
    finishWorker: () => workerResolve?.(),
    setState: (value: Record<string, unknown>) => {
      state = value;
    },
    setGames: (value: readonly unknown[]) => {
      currentGames = value as DurableGame[];
    },
    setCurrentIdentity: (value: typeof identity) => {
      currentIdentity = value;
    },
    restart: () =>
      createSemanticRefreshRuntime({
        stateService,
        captureService,
        worker,
        storageService: {
          loadCollection() {
            return Promise.resolve({
              id: "runtime",
              schemaVersion: 9,
              games: currentGames,
              semanticRedundancy: options.expiresAt
                ? { ...state, disclosureManifest: { ...manifest, expiresAt: options.expiresAt } }
                : state,
            } as unknown as Collection);
          },
        },
        now: () => Date.parse("2026-01-01T00:00:00.000Z"),
      }),
  };
}

function makeGame(id: string, description: string, note: string): DurableGame {
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
    ownerNote: { state: "present", version: 1, updatedAt: "2026-01-01T00:00:00Z", text: note },
  };
}

function requiredFingerprint(value: string | null): string {
  if (value === null) throw new Error("Expected a source fingerprint");
  return value;
}

function startInput() {
  return {
    manifestId: manifest.id,
    manifestDigest: manifest.digest,
    sourceIdentity: identity,
    pairCount: 0,
    transmissionAuthorized: true,
    noteTransmissionAuthorized: false,
    cachedOwnerNoteUseAuthorized: false,
  };
}

describe("semantic refresh runtime", () => {
  test("publication readiness tracks each authoritative source component across restart", async () => {
    const h = harness();
    const generation = semanticGenerationFixture({
      sourceIdentity: identity,
      evidenceEpoch: identity.evidenceEpoch,
      consentEpoch: identity.consentEpoch,
      manifestDigest: manifest.digest,
      modelId: JEV_MODEL_ID,
      rubricVersion: JEV_RUBRIC_VERSION,
      scoringVersion: 1,
    });
    h.setState({
      settings: { enabled: true, weights: { factual: 7, description: 5, ownerNote: 0 } },
      evidenceEpoch: identity.evidenceEpoch,
      consentEpoch: identity.consentEpoch,
      publishedGeneration: generation,
      disclosureManifest: manifest,
      manifestDelivery: { complete: true },
      authorization: { state: "active" },
      execution: { manifestDigest: manifest.digest, status: "completed" },
    });
    expect((await h.runtime.status()).publicationStatus).toBe("ready");

    for (const changedSource of [
      "tournamentHash",
      "predictionSettingsHash",
      "factualWeightsFingerprint",
    ] as const) {
      const changed = { ...identity, [changedSource]: `${identity[changedSource]}-changed` };
      h.setCurrentIdentity(changed);
      const restarted = h.restart();
      const status = await restarted.status();
      expect(status.publicationStatus).toBe("stale");
      expect(status.status).toBe("completed");
      h.setCurrentIdentity(identity);
    }
  });

  test("old model or rubric, changed weights, and incomplete pair coverage remain stale after restart", async () => {
    const h = harness();
    const currentGeneration = semanticGenerationFixture({
      sourceIdentity: identity,
      manifestDigest: manifest.digest,
      modelId: JEV_MODEL_ID,
      rubricVersion: JEV_RUBRIC_VERSION,
      scoringVersion: 1,
    });
    const baseState = {
      settings: { enabled: true, weights: { factual: 7, description: 5, ownerNote: 0 } },
      evidenceEpoch: identity.evidenceEpoch,
      consentEpoch: identity.consentEpoch,
      publishedGeneration: currentGeneration,
      disclosureManifest: manifest,
      execution: { manifestDigest: manifest.digest, status: "completed" },
    };
    for (const invalidState of [
      { ...baseState, publishedGeneration: { ...currentGeneration, modelId: "old-model" } },
      { ...baseState, publishedGeneration: { ...currentGeneration, rubricVersion: 0 } },
      {
        ...baseState,
        settings: { enabled: true, weights: { factual: 6, description: 5, ownerNote: 0 } },
      },
    ]) {
      h.setState(invalidState);
      const status = await h.restart().status();
      expect(status.publicationStatus).toBe("stale");
      expect(status.status).toBe("completed");
    }
    h.setState(baseState);
    const current = await h.restart().status();
    expect(current.publicationStatus).toBe("ready");
    expect(current.status).toBe("completed");
    for (const executionStatus of ["cancelled", "failed"] as const) {
      h.setState({
        ...baseState,
        disclosureManifest: {
          ...manifest,
          digest: "b".repeat(64),
          expiresAt: "2025-01-01T00:00:00.000Z",
        },
        execution: { manifestDigest: "b".repeat(64), status: executionStatus },
      });
      expect((await h.restart().status()).publicationStatus).toBe("ready");
    }
  });

  test("D-only and C+D provenance matches the pair resolver and becomes stale on note changes", async () => {
    const sourceVector = {
      collectionId: "runtime",
      collectionSchemaVersion: 9,
      evidenceEpoch: 0,
      consentEpoch: 0,
      tournamentRevision: 0,
      predictionSettingsRevision: 0,
      factualWeightsEpoch: 0,
      fencedFactualWeightsFingerprint: null,
      currentFactualWeightsFingerprint: "factual-fingerprint",
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

    for (const mode of ["D", "CD"] as const) {
      const games = [
        makeGame("g1", "alpha rules", "note one"),
        makeGame("g2", "beta rules", "note two"),
      ];
      const descriptionA = semanticDescriptionSourceFingerprint(games[0]);
      const descriptionB = semanticDescriptionSourceFingerprint(games[1]);
      const ownerNoteA = semanticOwnerNoteSourceFingerprint(games[0]);
      const ownerNoteB = semanticOwnerNoteSourceFingerprint(games[1]);
      const requiredDescriptionA = requiredFingerprint(descriptionA);
      const requiredDescriptionB = requiredFingerprint(descriptionB);
      const requiredOwnerNoteA = requiredFingerprint(ownerNoteA);
      const requiredOwnerNoteB = requiredFingerprint(ownerNoteB);
      const combined = mode === "CD";
      const disclosure = {
        ...manifest,
        signalScope: combined ? "description-and-owner-notes" : "owner-notes-only",
        eligibleGameIds: ["g1", "g2"],
        pairs: [
          {
            gameA: "g1",
            gameB: "g2",
            hasDescriptionA: true,
            hasDescriptionB: true,
            hasOwnerNoteA: true,
            hasOwnerNoteB: true,
            descriptionFingerprintA: descriptionA,
            descriptionFingerprintB: descriptionB,
            noteVersionA: 1,
            noteVersionB: 1,
          },
        ],
      } as SemanticDisclosureManifest;
      const generation = semanticGenerationFixture({
        id: `generation-${mode}`,
        eligibleGameIds: ["g1", "g2"],
        manifestDigest: disclosure.digest,
        sourceIdentity: identity,
        modelId: JEV_MODEL_ID,
        rubricVersion: JEV_RUBRIC_VERSION,
        scoringVersion: 1,
        signalScope: disclosure.signalScope,
        weights: combined
          ? { factual: 7, description: 5, ownerNote: 3 }
          : { factual: 7, description: 0, ownerNote: 5 },
        pairOutcomes: [
          {
            gameA: "g1",
            gameB: "g2",
            description: combined
              ? {
                  status: "scored",
                  score: 0.7,
                  confidence: null,
                  modelId: JEV_MODEL_ID,
                  rubricVersion: JEV_RUBRIC_VERSION,
                  sourceFingerprintA: requiredDescriptionA,
                  sourceFingerprintB: requiredDescriptionB,
                  noteVersionA: 1,
                  noteVersionB: 1,
                  requestContext: {
                    kind: "description-and-owner-notes",
                    descriptionRepresentationVersion: 1,
                    ownerNoteRepresentationVersion: 1,
                    descriptionFingerprintA: requiredDescriptionA,
                    descriptionFingerprintB: requiredDescriptionB,
                  },
                }
              : null,
            ownerNote: {
              status: "scored",
              score: 0.3,
              confidence: null,
              modelId: JEV_MODEL_ID,
              rubricVersion: JEV_RUBRIC_VERSION,
              sourceFingerprintA: requiredOwnerNoteA,
              sourceFingerprintB: requiredOwnerNoteB,
              noteVersionA: 1,
              noteVersionB: 1,
              requestContext: combined
                ? {
                    kind: "description-and-owner-notes",
                    descriptionRepresentationVersion: 1,
                    ownerNoteRepresentationVersion: 1,
                    descriptionFingerprintA: requiredDescriptionA,
                    descriptionFingerprintB: requiredDescriptionB,
                  }
                : { kind: "owner-notes-only", ownerNoteRepresentationVersion: 1 },
            },
          },
        ],
      });
      const settings = {
        enabled: true,
        cachedOwnerNoteUse: true,
        weights: generation.weights,
      };
      const semanticState = {
        settings,
        evidenceEpoch: 0,
        consentEpoch: 0,
        factualWeightsEpoch: 0,
        factualWeightsFingerprint: null,
        publishedGeneration: generation,
        disclosureManifest: disclosure,
        execution: { manifestDigest: disclosure.digest, status: "completed" },
      };
      const h = harness();
      h.setGames(games);
      h.setState(semanticState);
      const runtimeResult = await h.restart().status();
      const collection = {
        id: "runtime",
        schemaVersion: 9,
        games,
        semanticRedundancy: semanticState,
      } as unknown as Collection;
      const pairResolverResult = resolveSemanticRedundancyPairTable({
        collection,
        universe: games.map((game) => ({
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
        })),
        generation,
        factualSettings,
        sourceIdentity: sourceVector,
        support: {
          modelId: JEV_MODEL_ID,
          rubricVersion: JEV_RUBRIC_VERSION,
          scoringVersion: 1,
          sourceIdentity: identity,
        },
      });
      expect(runtimeResult.publicationStatus).toBe("ready");
      expect(pairResolverResult.status).toBe("ready");
      expect(runtimeResult.status).toBe("completed");

      for (const changedGames of [
        [makeGame("g1", "alpha rules", "edited note"), games[1]],
        [{ ...games[0], ownerNote: { state: "missing", version: 0, updatedAt: null } }, games[1]],
      ]) {
        h.setGames(changedGames);
        expect((await h.restart().status()).publicationStatus).toBe("stale");
      }
      h.setGames(games);

      const revokedState = {
        ...semanticState,
        settings: { ...settings, cachedOwnerNoteUse: false },
      };
      h.setState(revokedState);
      expect((await h.restart().status()).publicationStatus).toBe("stale");

      h.setState({
        ...semanticState,
        publishedGeneration: {
          ...generation,
          pairOutcomes: [
            {
              ...generation.pairOutcomes[0],
              ownerNote: { ...generation.pairOutcomes[0].ownerNote!, sourceFingerprintA: "bad" },
            },
          ],
        },
      });
      expect((await h.restart().status()).publicationStatus).toBe("stale");
    }
  });

  test("capture creates a fresh scoped disclosure without client collection or deadline data", async () => {
    const h = harness();
    await h.runtime.capture({ signalScope: "description-only" });
    await h.runtime.capture({ signalScope: "description-only" });
    expect(h.captureRequests).toHaveLength(2);
    const [first, second] = h.captureRequests as Array<Record<string, unknown>>;
    expect(first).toEqual({
      signalScope: "description-only",
      budget: {
        maxRequests: SEMANTIC_CAPTURE_POLICY.defaultBudget.maxRequests,
        maxTokens: SEMANTIC_CAPTURE_POLICY.defaultBudget.maxTokens,
        maxDurationMs: SEMANTIC_CAPTURE_POLICY.defaultBudget.maxDurationMs,
      },
      expiresAt: new Date(
        Date.parse("2026-01-01T00:00:00.000Z") +
          SEMANTIC_CAPTURE_POLICY.defaultBudget.maxDurationMs,
      ).toISOString(),
      id: expect.any(String),
    });
    expect(second.id).not.toBe(first.id);
    expect(first).not.toHaveProperty("collection");
    expect(first).not.toHaveProperty("deadlineAt");
  });

  test("capture permits configured budget reductions but rejects increases", async () => {
    const h = harness();
    await h.runtime.capture({
      signalScope: "owner-notes-only",
      budget: { maxRequests: 7, maxTokens: 900, maxDurationMs: 12_000 },
    });
    expect(h.captureRequests[0]).toMatchObject({
      budget: { maxRequests: 7, maxTokens: 900, maxDurationMs: 12_000 },
    });
    expect(
      h.runtime.capture({ signalScope: "description-only", budget: { maxRequests: 19_901 } }),
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(h.captureRequests).toHaveLength(1);
  });

  test("expired disclosed manifest yields a stale server-derived deadline", async () => {
    const h = harness({ expiresAt: "2025-12-31T23:59:00.000Z" });
    const result = await h.runtime.start(startInput());
    expect(result).toMatchObject({ outcome: "stale" });
    expect(h.starts[0]).toMatchObject({ deadlineAt: "2025-12-31T23:59:00.000Z" });
  });

  test("durably starts before asynchronously launching once; replay cannot relaunch", async () => {
    const h = harness();
    expect(h.workers).toHaveLength(0);
    const created = await h.runtime.start(startInput());
    expect(created).toMatchObject({ outcome: "accepted", value: { disposition: "CREATED" } });
    expect(h.starts).toHaveLength(1);
    expect(h.starts[0]).toMatchObject({ deadlineAt: "2026-01-01T00:01:00.000Z" });
    const replay = await h.runtime.start(startInput());
    expect(replay).toMatchObject({ outcome: "accepted", value: { disposition: "REPLAYED" } });
    expect(h.starts[1]).toMatchObject({ deadlineAt: "2026-01-01T00:01:00.000Z" });
    await Promise.resolve();
    expect(h.workers).toEqual([manifest.id]);
    expect(h.runtime.isStartReceiptCurrentProcess(manifest.id)).toBe(true);
    h.finishWorker();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.runtime.isStartReceiptCurrentProcess(manifest.id)).toBe(false);
  });

  test("holds the single launch slot until worker settles", async () => {
    const h = harness();
    await h.runtime.start(startInput());
    await Promise.resolve();
    const second = await h.runtime.start({ ...startInput(), manifestId: "other" });
    expect(second).toEqual({ outcome: "not-authorized" });
    expect(h.workers).toHaveLength(1);
    h.finishWorker();
  });

  test("startup recovery interrupts orphaned running work and does not launch it", async () => {
    const h = harness({ running: true, workerGate: Promise.resolve() });
    await h.runtime.recoverOrphanedRun();
    expect(h.finishes).toEqual([{ commandId: manifest.id, status: "interrupted" }]);
    expect(h.workers).toHaveLength(0);
    expect(h.runtime.isStartReceiptCurrentProcess(manifest.id)).toBe(false);
  });

  test("cancellation delegates exactly once to worker durable-cancel-and-abort", async () => {
    const h = harness();
    await h.runtime.start(startInput());
    await Promise.resolve();
    await h.runtime.cancel(manifest.id);
    expect(h.cancelCalls).toBe(1);
    expect(h.durableCancelCalls).toBe(0);
    expect(h.workerAborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.runtime.isStartReceiptCurrentProcess(manifest.id)).toBe(false);
  });

  test("manifest page is refused after current source authority changes", async () => {
    let sourceCurrent = true;
    const runtime = createSemanticRefreshRuntime({
      stateService: {
        deliverDisclosurePage() {
          return Promise.resolve({ outcome: "accepted" as const });
        },
      } as unknown as SemanticRedundancyStateService,
      captureService: {
        async withCurrentManifest(input: { operation: () => Promise<unknown> }) {
          if (!sourceCurrent) throw new Error("disclosure source changed");
          return input.operation();
        },
      } as unknown as SemanticRefreshCaptureService,
      worker: {} as SemanticRefreshService,
      storageService: {
        loadCollection() {
          return Promise.resolve({
            semanticRedundancy: { disclosureManifest: manifest },
          } as unknown as Collection);
        },
      },
    });
    expect(
      await runtime.deliverPage({
        manifestId: manifest.id,
        manifestDigest: manifest.digest,
        offset: 0,
        limit: 100,
      }),
    ).toMatchObject({ outcome: "accepted" });
    sourceCurrent = false;
    expect(
      runtime.deliverPage({
        manifestId: manifest.id,
        manifestDigest: manifest.digest,
        offset: 100,
        limit: 100,
      }),
    ).rejects.toThrow("disclosure source changed");
  });

  test("worker starts outside inherited coordinator context and queues behind source mutation", async () => {
    const storage = {};
    const coordinator = profileSourceCoordinatorFor(storage);
    let releaseInitial!: () => void;
    const initialGate = new Promise<void>((resolve) => {
      releaseInitial = resolve;
    });
    let releaseMutation!: () => void;
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    let mutationEntered!: () => void;
    const enteredMutation = new Promise<void>((resolve) => {
      mutationEntered = resolve;
    });
    let loadStarted!: () => void;
    const firstLoad = new Promise<void>((resolve) => {
      loadStarted = resolve;
    });
    let loadCount = 0;
    let workerEntered = false;
    let launchResolve!: () => void;
    const launchSettled = new Promise<void>((resolve) => {
      launchResolve = resolve;
    });
    const state: { disclosureManifest: SemanticDisclosureManifest; execution: unknown } = {
      disclosureManifest: manifest,
      execution: null,
    };
    const worker = {
      async run() {
        await coordinator.runExclusive(() =>
          Promise.resolve().then(() => {
            workerEntered = true;
          }),
        );
        launchResolve();
        return { outcome: "accepted" };
      },
      cancel() {
        return Promise.resolve({ outcome: "accepted" as const });
      },
    } as unknown as SemanticRefreshService;
    const runtime = createSemanticRefreshRuntime({
      stateService: {
        startExecution(input: Parameters<SemanticRedundancyStateService["startExecution"]>[0]) {
          state.execution = { commandId: input.commandId, deadlineAt: input.deadlineAt };
          return Promise.resolve({
            outcome: "accepted" as const,
            value: { disposition: "CREATED" as const },
          });
        },
      } as unknown as SemanticRedundancyStateService,
      captureService: {
        async withCurrentManifest(input: { operation: () => Promise<unknown> }) {
          return coordinator.runExclusive(input.operation);
        },
      } as unknown as SemanticRefreshCaptureService,
      worker,
      storageService: {
        loadCollection() {
          loadCount += 1;
          if (loadCount === 1) loadStarted();
          return Promise.resolve({ semanticRedundancy: state } as unknown as Collection);
        },
      },
    });
    const initial = coordinator.runExclusive(async () => initialGate);
    await Promise.resolve();
    const starting = runtime.start(startInput());
    await firstLoad;
    const queuedMutation = coordinator.runExclusive(async () => {
      mutationEntered();
      await mutationGate;
    });
    releaseInitial();
    await starting;
    await enteredMutation;
    await Promise.resolve();
    expect(workerEntered).toBe(false);
    releaseMutation();
    await Promise.all([initial, queuedMutation, launchSettled]);
    expect(workerEntered).toBe(true);
  });
});
