import { describe, expect, test } from "bun:test";
import type { Collection, GameWithScore } from "@shelf-judge/shared";
import {
  createInitialSemanticRedundancyStateV10,
  DEFAULT_JEV_RUN_BUDGET,
} from "@shelf-judge/shared";
import { JevRunController } from "../../src/services/jev-run-controller.js";
import { JevRunService, type JevRunCapture } from "../../src/services/jev-run-service.js";
import type { PreparedWishlistRun } from "../../src/services/wishlist-run-preparation.js";
import type { JevRunSourceAdapter } from "../../src/services/jev-run-source-adapter.js";
import {
  type JevPairCache,
  type JevPairCheckpoint,
  type JevPairJudgment,
  type JevRunProgress,
} from "../../src/services/jev-pair-cache-service.js";
import {
  JEV_GATEWAY_LIMITS,
  JEV_MODEL_ID,
  JEV_QUESTION_VERSION,
  JEV_RUBRIC_VERSION,
} from "../../src/services/jev/jev-gateway.js";
import { JEV_JUDGMENT_CONTRACT } from "../../src/services/jev/jev-judgment-contract.js";
import { buildJevPairDependencies } from "../../src/services/jev-pair-identity.js";
import { profileSourceCoordinatorFor } from "../../src/services/profile-source-coordinator.js";

function makeCapture(ids = ["a", "b"], notes = false): JevRunCapture {
  const semantic = {
    ...createInitialSemanticRedundancyStateV10(),
    settings: {
      enabled: true,
      weights: { factual: 0, description: 1, ownerNote: notes ? 1 : 0 },
      cachedOwnerNoteUse: true,
    },
  };
  const collection = {
    id: "controller-collection",
    name: "Controller fixture",
    schemaVersion: 10,
    revision: 1,
    axes: [],
    games: ids.map((id) => ({
      id,
      name: `Name ${id}`,
      ownership: "owned",
      bggData: { description: `Description ${id}`, mechanics: [], categories: [] },
      ownerNote: notes
        ? { state: "present", version: 1, updatedAt: "test", text: `Private note ${id}` }
        : { state: "cleared", version: 0, updatedAt: "test" },
    })),
    semanticRedundancy: semantic,
  } as unknown as Collection;
  const predictionCapture = ids.map((id) => ({
    game: { id, ownership: "owned" },
    score: { score: 1, vetoed: false, ratedAxisCount: 1, predictionMeta: null },
  })) as unknown as GameWithScore[];
  return {
    collection,
    predictionCapture,
    captureIdentity: {
      sourceVectorIdentity: "durable-vector",
      tournamentIdentity: "tournament",
      predictionCaptureIdentity: "predictions",
    },
    factualWeights: { binary: 0, continuous: 0 },
    sourceVectorIdentity: "vector-1",
    policyIdentity: "policy-1",
  };
}

function makeResult(mode: string) {
  const score = {
    score: 0.5,
    confidence: null,
    modelId: JEV_MODEL_ID,
    rubricVersion: JEV_RUBRIC_VERSION,
    questionVersion: JEV_QUESTION_VERSION,
  } as const;
  return {
    description: mode === "owner-notes-only" ? null : score,
    ownerNote: mode === "description-only" ? null : score,
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

function fakeCache() {
  const progress: JevRunProgress[] = [];
  const rows = new Map<string, JevPairJudgment>();
  let revision = 0;
  const cache = {
    available: true,
    mutationRevision: () => revision,
    lookup: (key: { gameAId: string; gameBId: string; signal: string }) =>
      rows.get(key.gameAId + key.gameBId + key.signal) ?? null,
    upsert: () => {
      revision++;
    },
    purgePair: () => {
      revision++;
      return 0;
    },
    purgeGame: () => 0,
    invalidateGame: () => 0,
    purgeDDependent: () => 0,
    saveRunProgress: (value: JevRunProgress) => progress.push(value),
    checkpointPair: ({ judgments, progress: value }: JevPairCheckpoint) => {
      for (const row of judgments) rows.set(row.gameAId + row.gameBId + row.signal, row);
      revision++;
      progress.push(value);
    },
    finishRun: ({ progress: value }: { progress: JevRunProgress }) => progress.push(value),
    getRunProgress: () => progress.at(-1) ?? null,
    setActivation: () => {},
    getActivation: () => null,
    compact: () => {},
    reset: () => {},
    close: () => {},
  } as unknown as JevPairCache;
  return { cache, progress, rows };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function harness(
  options: {
    initial?: JevRunCapture;
    pending?: boolean;
    startBarrier?: () => void;
    maxPairs?: number;
    gatewayConfigured?: boolean;
    noteTransmissionPermitted?: boolean;
    wishlistPreparation?: { prepare: () => Promise<PreparedWishlistRun> };
    receiptTtlMs?: number;
    maxReceipts?: number;
  } = {},
) {
  const { cache, rows, progress } = fakeCache();
  const storage = {
    loadRedundancySettings: () =>
      Promise.resolve({
        enabled: true,
        stage: "integrated" as const,
        similarityThreshold: 0.7,
        maxPenalty: 0.2,
        componentWeights: { binary: 0, continuous: 0 },
        minNeighbors: 1,
        expectedNeighbors: 5,
      }),
  };
  let current = options.initial ?? makeCapture();
  let gatewayConstructions = 0;
  let starts = 0;
  let captures = 0;
  let providerConfigured = options.gatewayConfigured ?? true;
  const gatewayRequests: unknown[] = [];
  const approvedBudgets: unknown[] = [];
  const started = deferred<void>();
  const release = deferred<void>();
  let fakeNowMs = Date.now();
  const sourceAdapter: JevRunSourceAdapter = {
    loadCapture: () => {
      captures++;
      return Promise.resolve(structuredClone(current));
    },
    readCurrent: () => {
      options.startBarrier?.();
      return Promise.resolve({
        collection: structuredClone(current.collection),
        sourceVectorIdentity: current.sourceVectorIdentity,
        policyIdentity: current.policyIdentity,
        canTransmitNotes: options.noteTransmissionPermitted ?? true,
      });
    },
  };
  const runService = new JevRunService({
    storageService: storage,
    cache,
    ...(options.maxPairs === undefined ? {} : { maxPairs: options.maxPairs }),
    loadCapture: () => sourceAdapter.loadCapture(),
    readCurrent: () => sourceAdapter.readCurrent(),
    createGateway: (admit, providerBudget) => {
      gatewayConstructions++;
      approvedBudgets.push(providerBudget);
      return {
        evaluatePair: async (request) => {
          gatewayRequests.push(request);
          await admit({
            mode: request.mode,
            attemptId: `fake-${starts + 1}`,
            start: () => {
              starts++;
              started.resolve();
              return { response: Promise.resolve(new Response()) };
            },
          });
          if (options.pending) await release.promise;
          return makeResult(request.mode);
        },
      };
    },
  });
  const controller = new JevRunController({
    storageService: storage,
    sourceAdapter,
    cache,
    runService,
    now: () => new Date(fakeNowMs),
    gatewayConfigured: () => providerConfigured,
    ...(options.receiptTtlMs === undefined ? {} : { receiptTtlMs: options.receiptTtlMs }),
    ...(options.maxReceipts === undefined ? {} : { maxReceipts: options.maxReceipts }),
    ...(options.wishlistPreparation === undefined
      ? {}
      : { wishlistPreparation: options.wishlistPreparation }),
  });
  return {
    controller,
    cache,
    rows,
    progress,
    gatewayRequests,
    approvedBudgets,
    sourceAdapter,
    storage,
    runService,
    started: started.promise,
    release: () => release.resolve(),
    setCurrent: (value: JevRunCapture) => {
      current = value;
    },
    setGatewayConfigured: (value: boolean) => {
      providerConfigured = value;
    },
    advanceTime: (milliseconds: number) => {
      fakeNowMs += milliseconds;
    },
    now: () => new Date(fakeNowMs),
    get current() {
      return current;
    },
    get gatewayConstructions() {
      return gatewayConstructions;
    },
    get starts() {
      return starts;
    },
    get captures() {
      return captures;
    },
  };
}

describe("JevRunController", () => {
  test("wishlist preview binds frozen preparation and start fails closed until executor exists", async () => {
    const capture = makeCapture();
    let current = true;
    const preparation = {
      prepare: () =>
        Promise.resolve({
          scope: "wishlist",
          selection: { kind: "selected", bggIds: [501] },
          selectionIdentity: "selection",
          capture,
          entries: [],
          unavailableCandidateBggIds: [],
          eligibleOwnedIds: ["owned-a"],
          pairs: [],
          disclosure: {
            scope: "wishlist",
            wishlistEntryCount: 1,
            selectedCandidateCount: 1,
            unselectedEntryCount: 0,
            ownedOverlapCandidateCount: 0,
            requestedCandidateCount: 1,
            eligibleCandidateCount: 1,
            unavailableCandidateCount: 0,
            eligibleOwnedGameCount: 1,
            comparisonPairCount: 1,
            cachedHitPairCount: 0,
            sendablePairCount: 1,
          },
          cacheRevision: 0,
          wishlistMutationGeneration: "0",
          identity: "frozen-wishlist-preparation",
          isSourceCurrent: () => Promise.resolve(current),
          isCurrent: () => Promise.resolve(current),
        } as PreparedWishlistRun),
    };
    const h = harness({ wishlistPreparation: preparation });
    const preview = await h.controller.previewWishlist({ kind: "selected", bggIds: [501] });
    expect(preview.status).toBe(200);
    if (preview.status !== 200) throw new Error("Expected wishlist preview");
    expect(preview.body).toMatchObject({
      scope: { scope: "wishlist", selectedCandidateCount: 1, sendablePairCount: 1 },
      selection: { kind: "selected", bggIds: [501] },
    });

    const startInput = {
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    };
    const started = await h.controller.start(startInput);
    expect(started.status).toBe(200);
    expect(h.gatewayConstructions).toBe(0);
    if (started.status === 200) await startedRunCompletion(h);

    const secondPreview = await h.controller.previewWishlist({ kind: "selected", bggIds: [501] });
    if (secondPreview.status !== 200) throw new Error("Expected second wishlist preview");
    current = false;
    const changed = await h.controller.start({
      requestId: secondPreview.body.requestId,
      precondition: secondPreview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(changed).toEqual({ status: 412, body: { error: "precondition-failed" } });
    expect(h.gatewayConstructions).toBe(0);
    expect(h.starts).toBe(0);
  });

  test("preview exposes and binds validated per-run budget through opaque authorization", async () => {
    const h = harness();
    const selected = {
      maxProviderAttempts: 501,
      reportedTokenStopThreshold: 40_000,
      maxRunDurationMs: 60_000,
    };
    const preview = await h.controller.preview(selected);
    expect(preview.status).toBe(200);
    if (preview.status !== 200) throw new Error("Expected budget preview");
    expect(preview.body.limits).toMatchObject(selected);
    const started = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(started.status).toBe(200);
    await startedRunCompletion(h);
    expect(h.approvedBudgets).toEqual([selected]);
  });

  test("rejects invalid per-run budgets without creating authorization", async () => {
    const h = harness();
    const invalid = [
      { maxProviderAttempts: 0, reportedTokenStopThreshold: 1, maxRunDurationMs: 60_000 },
      { maxProviderAttempts: 75_001, reportedTokenStopThreshold: 1, maxRunDurationMs: 60_000 },
      { maxProviderAttempts: 1.5, reportedTokenStopThreshold: 1, maxRunDurationMs: 60_000 },
      { maxProviderAttempts: 1, reportedTokenStopThreshold: 0, maxRunDurationMs: 60_000 },
      { maxProviderAttempts: 1, reportedTokenStopThreshold: 1, maxRunDurationMs: 59_999 },
      { maxProviderAttempts: 1, reportedTokenStopThreshold: 1, maxRunDurationMs: 43_200_001 },
    ];
    for (const budget of invalid) expect((await h.controller.preview(budget)).status).toBe(400);
    expect(h.gatewayConstructions).toBe(0);
  });

  test("preview is aggregate-only, provider-free, and reports enforced limits", async () => {
    const h = harness({ initial: makeCapture(["a", "b", "c"], true) });
    const preview = await h.controller.preview();
    expect(preview.status).toBe(200);
    if (preview.status !== 200) throw new Error("Expected preview");
    expect(preview.body).toMatchObject({
      provider: "TypeSafe",
      modelId: JEV_MODEL_ID,
      eligibleGameCount: 3,
      pairCount: 3,
      noteBearingPairCount: 3,
      descriptionBearingPairCount: 3,
      scoringEffect: "integrated-fitness",
      limits: {
        maxEligiblePairs: h.runService.effectiveLimits.maxEligiblePairs,
        maxProviderAttempts: DEFAULT_JEV_RUN_BUDGET.maxProviderAttempts,
        maxRetriesPerEvaluation: JEV_GATEWAY_LIMITS.maxRetriesPerEvaluation,
        maxRunDurationMs: h.runService.effectiveLimits.maxRunDurationMs,
        reportedTokenStopThreshold: DEFAULT_JEV_RUN_BUDGET.reportedTokenStopThreshold,
        reportedTokenThresholdIsBilledCeiling: false,
      },
    });
    const json = JSON.stringify(preview.body);
    for (const privateValue of ["Name a", "Private note", "vector-1", "policy-1", "game-a"])
      expect(json).not.toContain(privateValue);
    expect(h.gatewayConstructions).toBe(0);
    expect(h.starts).toBe(0);
  });

  test("provider-free preview reports missing provider configuration", async () => {
    const h = harness({ gatewayConfigured: false });
    const preview = await h.controller.preview();
    expect(preview.status).toBe(200);
    if (preview.status !== 200) throw new Error("Expected provider-free preview");
    expect(preview.body.providerConfigured).toBe(false);
    expect(h.captures).toBe(1);
    expect(h.gatewayConstructions).toBe(0);
  });

  test("unavailable cache returns a safe 503 without capture work", async () => {
    const h = harness();
    Object.defineProperty(h.cache, "available", { value: false });
    expect(await h.controller.preview()).toEqual({
      status: 503,
      body: { error: "run-unavailable" },
    });
    expect(h.captures).toBe(0);
  });

  test("expired precondition is rejected", async () => {
    const h = harness();
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    h.advanceTime(120_001);
    expect(
      await h.controller.start({
        requestId: preview.body.requestId,
        precondition: preview.body.precondition,
        noteTransmissionAuthorized: false,
      }),
    ).toEqual({ status: 412, body: { error: "precondition-failed" } });
    expect(h.starts).toBe(0);
  });

  test("invalid request does not reserve its request ID", async () => {
    const h = harness();
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    expect(
      await h.controller.start({
        requestId: preview.body.requestId,
        precondition: "invalid-opaque-token",
        noteTransmissionAuthorized: false,
      }),
    ).toEqual({ status: 412, body: { error: "precondition-failed" } });
    const accepted = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(accepted.status).toBe(200);
    await startedRunCompletion(h);
  });

  test("precondition expiring during final authority read is rejected before reservation", async () => {
    const harnessRef: { current?: ReturnType<typeof harness> } = {};
    let expireDuringRead = false;
    const h = harness({
      startBarrier: () => {
        if (expireDuringRead) {
          expireDuringRead = false;
          harnessRef.current?.advanceTime(120_001);
        }
      },
    });
    harnessRef.current = h;
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    expireDuringRead = true;
    const response = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(response).toEqual({ status: 412, body: { error: "precondition-failed" } });
    expect(h.starts).toBe(0);
    expect(h.gatewayConstructions).toBe(0);
  });

  test("over-limit preview is truthful and start rejects before provider construction", async () => {
    const h = harness({ initial: makeCapture(["a", "b", "c"]), maxPairs: 2 });
    const preview = await h.controller.preview();
    expect(preview.status).toBe(200);
    if (preview.status !== 200) throw new Error("Expected preview");
    expect(preview.body).toMatchObject({ pairCount: 3, withinPairLimit: false });
    const result = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(result).toEqual({ status: 409, body: { error: "scope-over-limit" } });
    expect(h.gatewayConstructions).toBe(0);
    expect(h.starts).toBe(0);
  });

  test("unchanged preview scope starts once and false note authorization sends C-only", async () => {
    const h = harness({ initial: makeCapture(["a", "b"], true) });
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    const started = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(started.status).toBe(200);
    if (started.status !== 200) throw new Error("Expected run start");
    expect(started.body.state).toBe("started");
    await h.started;
    expect(h.starts).toBe(1);
    expect(h.gatewayRequests).toHaveLength(1);
    expect(JSON.stringify(h.gatewayRequests[0])).not.toContain("Private note");
    expect(h.gatewayRequests[0]).toMatchObject({ mode: "description-only" });
    await startedRunCompletion(h);
    const row = h.rows.get("abC");
    expect(row?.dependencyKind).toBe("C_ONLY");
    expect(row?.dependencies.every((dependency) => dependency.noteFingerprint === undefined)).toBe(
      true,
    );
  });

  test("preview reports durable note transmission permission independently of signal settings", async () => {
    const h = harness({ initial: makeCapture(["a", "b"], true), noteTransmissionPermitted: false });
    const preview = await h.controller.preview();
    expect(preview.status).toBe(200);
    if (preview.status !== 200) throw new Error("Expected preview");
    expect(preview.body.signalScope.ownerNotes).toBe(true);
    expect(preview.body.noteTransmissionPermitted).toBe(false);
  });

  test("same-count note edits and membership swaps invalidate the prepared precondition", async () => {
    for (const mutation of ["note", "membership"] as const) {
      const h = harness({ initial: makeCapture(["a", "b"], true) });
      const preview = await h.controller.preview();
      if (preview.status !== 200) throw new Error("Expected preview");
      const changed = structuredClone(h.current);
      if (mutation === "note") {
        changed.collection.games[0].ownerNote = {
          state: "present",
          version: 2,
          updatedAt: "changed",
          text: "changed private note",
        };
      } else {
        changed.collection.games[0].id = "c";
        changed.predictionCapture[0].game.id = "c";
      }
      changed.sourceVectorIdentity = `changed-${mutation}`;
      h.setCurrent(changed);
      const response = await h.controller.start({
        requestId: preview.body.requestId,
        precondition: preview.body.precondition,
        noteTransmissionAuthorized: true,
      });
      expect(response.status).toBe(412);
      expect(h.starts).toBe(0);
      expect(h.gatewayConstructions).toBe(0);
    }
  });

  test("pre-admission source change is rejected under the coordinator", async () => {
    let mutateAfterCapture: (() => void) | null = null;
    const h = harness({
      startBarrier: () => {
        mutateAfterCapture?.();
      },
    });
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    const changed = structuredClone(h.current);
    changed.sourceVectorIdentity = "moved-before-reservation";
    mutateAfterCapture = () => h.setCurrent(changed);
    const response = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(response.status).toBe(412);
    expect(h.gatewayConstructions).toBe(0);
    expect(h.starts).toBe(0);
  });

  test("zero-pair cache-only scope starts without constructing a gateway", async () => {
    const h = harness({ initial: makeCapture(["only-game"]), gatewayConfigured: false });
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    const result = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(result.status).toBe(200);
    if (result.status !== 200) throw new Error("Expected cache-only start");
    await startedRunCompletion(h);
    expect(h.gatewayConstructions).toBe(0);
    expect(h.starts).toBe(0);
  });

  test("a fully cached required scope constructs no gateway", async () => {
    const h = harness({ gatewayConfigured: false });
    const [a, b] = h.current.collection.games;
    if (!a || !b) throw new Error("Expected fixture pair");
    const source = (game: typeof a) => ({
      gameId: game.id,
      name: game.name,
      description: game.bggData!.description!,
    });
    h.rows.set("abC", {
      collectionId: h.current.collection.id,
      gameAId: "a",
      gameBId: "b",
      signal: "C",
      dependencyKind: "C_ONLY",
      value: 0.6,
      modelId: JEV_JUDGMENT_CONTRACT.modelId,
      rubricVersion: JEV_JUDGMENT_CONTRACT.rubricVersion,
      questionVersion: JEV_JUDGMENT_CONTRACT.questionVersion,
      requestSchemaVersion: JEV_JUDGMENT_CONTRACT.requestSchemaVersion,
      scoreMappingVersion: JEV_JUDGMENT_CONTRACT.scoreMappingVersion,
      semanticPolicyId: JEV_JUDGMENT_CONTRACT.semanticPolicyId,
      completedAt: "fixture-time",
      dependencies: buildJevPairDependencies("C_ONLY", source(a), source(b)),
    });
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    const result = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(result.status).toBe(200);
    if (result.status !== 200) throw new Error("Expected cached start");
    await startedRunCompletion(h);
    expect(h.gatewayConstructions).toBe(0);
    expect(h.starts).toBe(0);
  });

  test("keyless cache pre-scan stays outside coordinator and lets queued mutation fence admission", async () => {
    const h = harness({ gatewayConfigured: false });
    const [a, b] = h.current.collection.games;
    if (!a || !b) throw new Error("Expected fixture pair");
    h.rows.set("abC", {
      collectionId: h.current.collection.id,
      gameAId: "a",
      gameBId: "b",
      signal: "C",
      dependencyKind: "C_ONLY",
      value: 0.6,
      modelId: JEV_JUDGMENT_CONTRACT.modelId,
      rubricVersion: JEV_JUDGMENT_CONTRACT.rubricVersion,
      questionVersion: JEV_JUDGMENT_CONTRACT.questionVersion,
      requestSchemaVersion: JEV_JUDGMENT_CONTRACT.requestSchemaVersion,
      scoreMappingVersion: JEV_JUDGMENT_CONTRACT.scoreMappingVersion,
      semanticPolicyId: JEV_JUDGMENT_CONTRACT.semanticPolicyId,
      completedAt: "fixture-time",
      dependencies: buildJevPairDependencies(
        "C_ONLY",
        { gameId: a.id, name: a.name, description: a.bggData!.description! },
        { gameId: b.id, name: b.name, description: b.bggData!.description! },
      ),
    });

    const coordinator = profileSourceCoordinatorFor(h.storage);
    const runExclusive = coordinator.runExclusive.bind(coordinator);
    let exclusiveDepth = 0;
    coordinator.runExclusive = (operation) =>
      runExclusive(async () => {
        exclusiveDepth++;
        try {
          return await operation();
        } finally {
          exclusiveDepth--;
        }
      });
    const lookup = h.cache.lookup.bind(h.cache);
    let mutationPromise: Promise<void> | undefined;
    let mutationCompleted = false;
    h.cache.lookup = (key) => {
      // The keyless cache scan must not keep the shared source coordinator held.
      expect(exclusiveDepth).toBe(0);
      mutationPromise ??= coordinator.runExclusive(() =>
        Promise.resolve().then(() => {
          const changed = structuredClone(h.current);
          changed.sourceVectorIdentity = "changed-during-keyless-prescan";
          h.setCurrent(changed);
          mutationCompleted = true;
        }),
      );
      return lookup(key);
    };

    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    const response = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    await mutationPromise;
    expect(response).toEqual({ status: 412, body: { error: "precondition-failed" } });
    expect(mutationCompleted).toBe(true);
    expect(h.starts).toBe(0);
    expect(h.gatewayConstructions).toBe(0);
  });

  test("unconfigured provider rejects a real cache miss before constructing gateway", async () => {
    const h = harness({ gatewayConfigured: false });
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    expect(preview.body.providerConfigured).toBe(false);
    const response = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(response).toEqual({ status: 503, body: { error: "run-unavailable" } });
    expect(h.starts).toBe(0);
    expect(h.gatewayConstructions).toBe(0);
    expect(h.rows.size).toBe(0);
    h.setGatewayConfigured(true);
    const retried = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(retried.status).toBe(200);
    await startedRunCompletion(h);
  });

  test("concurrent duplicate starts are idempotent; different run conflicts", async () => {
    const h = harness({ pending: true });
    const firstPreview = await h.controller.preview();
    const secondPreview = await h.controller.preview();
    if (firstPreview.status !== 200 || secondPreview.status !== 200)
      throw new Error("Expected previews");
    const request = {
      requestId: firstPreview.body.requestId,
      precondition: firstPreview.body.precondition,
      noteTransmissionAuthorized: false,
    };
    const first = h.controller.start(request);
    const duplicate = h.controller.start(request);
    const [one, two] = await Promise.all([first, duplicate]);
    expect(one).toEqual(two);
    await h.started;
    expect(await h.controller.start({ ...request, noteTransmissionAuthorized: true })).toEqual({
      status: 409,
      body: { error: "run-conflict" },
    });
    const conflicting = await h.controller.start({
      requestId: secondPreview.body.requestId,
      precondition: secondPreview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(conflicting.status).toBe(409);
    expect(h.starts).toBe(1);
    expect(h.gatewayConstructions).toBe(1);
    h.release();
    await startedRunCompletion(h);
  });

  test("active run exposes only its live ID and clears after cancellation completion", async () => {
    const h = harness({ pending: true });
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    const started = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    if (started.status !== 200) throw new Error("Expected run start");
    await h.started;

    expect(h.controller.activeRun()).toEqual({ runId: started.body.runId, scope: "collection" });
    expect(Object.keys(h.controller.activeRun()!)).toEqual(["runId", "scope"]);
    expect(h.controller.cancel({ runId: started.body.runId })).toEqual({
      status: 200,
      body: { state: "cancellation-requested" },
    });
    const internals = h.controller as unknown as {
      activeHandle: { runId: string; completion: Promise<unknown> } | null;
    };
    const acceptedHandle = internals.activeHandle;
    if (!acceptedHandle) throw new Error("Expected controller active handle");
    await acceptedHandle.completion;
    expect(h.controller.activeRun()).toBeNull();

    h.release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.controller.activeRun()).toBeNull();
    expect(h.progress.at(-1)).toMatchObject({ runId: started.body.runId, state: "interrupted" });
    expect(h.rows.size).toBe(0);

    const restarted = new JevRunController({
      storageService: h.storage,
      sourceAdapter: h.sourceAdapter,
      cache: h.cache,
      runService: h.runService,
      gatewayConfigured: () => true,
    });
    expect(restarted.activeRun()).toBeNull();
  });

  test("stale old completion does not clear a replaced active run identity", async () => {
    const h = harness({ pending: true });
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    const started = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    if (started.status !== 200) throw new Error("Expected run start");
    await h.started;

    type Handle = { runId: string; completion: Promise<unknown>; cancel(): void };
    const internals = h.controller as unknown as { activeHandle: Handle | null };
    const oldHandle = internals.activeHandle;
    if (!oldHandle) throw new Error("Expected controller active handle");
    const replacement: Handle = {
      runId: crypto.randomUUID(),
      completion: Promise.resolve(undefined),
      cancel: () => {},
    };
    internals.activeHandle = replacement;

    h.release();
    await oldHandle.completion;
    expect(h.controller.activeRun()).toEqual({ runId: replacement.runId });
    internals.activeHandle = null;
  });

  test("active receipt survives TTL and capacity pressure through run and replay window", async () => {
    const h = harness({ pending: true, receiptTtlMs: 50, maxReceipts: 1 });
    const activePreview = await h.controller.preview();
    if (activePreview.status !== 200) throw new Error("Expected first preview");
    const activeRequest = {
      requestId: activePreview.body.requestId,
      precondition: activePreview.body.precondition,
      noteTransmissionAuthorized: false,
    };
    const activeResponse = await h.controller.start(activeRequest);
    if (activeResponse.status !== 200) throw new Error("Expected active run");
    await h.started;

    h.advanceTime(51);
    const pressurePreview = await h.controller.preview();
    if (pressurePreview.status !== 200) throw new Error("Expected pressure preview");
    expect(
      await h.controller.start({
        requestId: pressurePreview.body.requestId,
        precondition: pressurePreview.body.precondition,
        noteTransmissionAuthorized: false,
      }),
    ).toEqual({ status: 503, body: { error: "run-unavailable" } });
    expect(await h.controller.start(activeRequest)).toEqual(activeResponse);
    expect(h.starts).toBe(1);

    h.release();
    await startedRunCompletion(h);
    expect(await h.controller.start(activeRequest)).toEqual(activeResponse);
    expect(h.starts).toBe(1);
  });

  test("a prior run ID cannot cancel the newer active run", async () => {
    const h = harness({ initial: makeCapture(["only-game"]) });
    const firstPreview = await h.controller.preview();
    if (firstPreview.status !== 200) throw new Error("Expected preview");
    const first = await h.controller.start({
      requestId: firstPreview.body.requestId,
      precondition: firstPreview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    if (first.status !== 200) throw new Error("Expected first run");
    await startedRunCompletion(h);
    await Promise.resolve();
    const secondCapture = makeCapture(["a", "b"]);
    secondCapture.sourceVectorIdentity = "vector-2";
    h.setCurrent(secondCapture);
    const secondPreview = await h.controller.preview();
    if (secondPreview.status !== 200) throw new Error("Expected second preview");
    const second = await h.controller.start({
      requestId: secondPreview.body.requestId,
      precondition: secondPreview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    if (second.status !== 200) throw new Error("Expected second run");
    await h.started;
    expect(h.controller.cancel({ runId: first.body.runId }).status).toBe(409);
    expect(h.controller.cancel({ runId: second.body.runId })).toEqual({
      status: 200,
      body: { state: "cancellation-requested" },
    });
    h.release();
    await startedRunCompletion(h);
  });

  test("a controller restart invalidates process-local preconditions", async () => {
    const h = harness();
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    const restarted = new JevRunController({
      storageService: h.storage,
      sourceAdapter: h.sourceAdapter,
      cache: h.cache,
      runService: h.runService,
      gatewayConfigured: () => true,
    });
    const response = await restarted.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(response.status).toBe(412);
    expect(h.starts).toBe(0);
  });
});

async function startedRunCompletion(h: ReturnType<typeof harness>): Promise<void> {
  // Controller intentionally returns no internal handle; await the persisted terminal marker.
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      h.progress.at(-1)?.state === "completed" ||
      h.progress.at(-1)?.state === "failed" ||
      h.progress.at(-1)?.state === "interrupted"
    )
      return;
    await Promise.resolve();
  }
  throw new Error("Run did not reach a terminal state");
}
