import { describe, expect, test } from "bun:test";
import {
  semanticDisclosureManifestDigest,
  type SemanticDisclosureManifest,
  type SemanticPairJudgment,
  type SemanticSignalScope,
} from "@shelf-judge/shared";
import type { JevPairRequest, JevPairResult } from "../../src/services/jev/jev-gateway.js";
import { JEV_MODEL_ID } from "../../src/services/jev/jev-gateway.js";
import type { SemanticRedundancyStateService } from "../../src/services/semantic-redundancy-state-service.js";
import type { SemanticPairSource } from "../../src/services/semantic-refresh-contracts.js";
import {
  createSemanticRefreshService,
  type SemanticRefreshExecutionSnapshot,
} from "../../src/services/semantic-refresh-service.js";
import { semanticSourceIdentityFixture } from "../helpers/semantic-redundancy-fixtures.js";

const identity = semanticSourceIdentityFixture({ collectionId: "refresh-collection" });
const now = Date.parse("2026-01-01T00:00:00.000Z");

function pair(gameA: string, gameB: string): SemanticDisclosureManifest["pairs"][number] {
  return {
    gameA,
    gameB,
    hasDescriptionA: true,
    hasDescriptionB: true,
    hasOwnerNoteA: true,
    hasOwnerNoteB: true,
    descriptionFingerprintA: "a".repeat(64),
    descriptionFingerprintB: "b".repeat(64),
    noteVersionA: 1,
    noteVersionB: 1,
  };
}

function manifest(
  scope: SemanticSignalScope = "description-and-owner-notes",
  pairs = [pair("a", "b")],
) {
  const unsigned = {
    sourceIdentity: identity,
    scoringVersion: 1,
    signalScope: scope,
    providerId: "fake-provider",
    modelId: JEV_MODEL_ID,
    rubricVersion: 2,
    budget: { maxRequests: 10, maxTokens: 10_000, maxDurationMs: 600_000 },
    expiresAt: "2026-01-02T00:00:00.000Z",
    eligibleGameIds: [...new Set(pairs.flatMap(({ gameA, gameB }) => [gameA, gameB]))].sort(),
    pairs,
  };
  return {
    id: "execution-1",
    digest: semanticDisclosureManifestDigest(unsigned),
    ...unsigned,
  } satisfies SemanticDisclosureManifest;
}

function sourceFor(value: SemanticDisclosureManifest): SemanticPairSource {
  return {
    sourceIdentity: value.sourceIdentity,
    descriptionA: { name: "Game A", text: "Description A", fingerprint: "a".repeat(64) },
    descriptionB: { name: "Game B", text: "Description B", fingerprint: "b".repeat(64) },
    ownerNoteA: { name: "Game A", text: "Note A", fingerprint: "c".repeat(64), version: 1 },
    ownerNoteB: { name: "Game B", text: "Note B", fingerprint: "d".repeat(64), version: 1 },
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setup(
  options: {
    scope?: SemanticSignalScope;
    pairs?: ReturnType<typeof pair>[];
    noteTransmissionAuthorized?: boolean;
    source?: SemanticPairSource;
    reserve?: () => boolean;
    afterCheckpoint?: () => void;
    clock?: () => number;
    reservationGate?: Promise<void>;
    reservationEntered?: () => void;
    gateway?: (
      request: JevPairRequest,
      signal: AbortSignal | undefined,
      retry: () => Promise<void>,
    ) => Promise<JevPairResult>;
  } = {},
) {
  const currentManifest = manifest(options.scope, options.pairs);
  let currentSource = options.source ?? sourceFor(currentManifest);
  const executionSnapshot: SemanticRefreshExecutionSnapshot = {
    execution: {
      commandId: currentManifest.id,
      manifestDigest: currentManifest.digest,
      sourceIdentity: currentManifest.sourceIdentity,
      signalScope: currentManifest.signalScope,
      noteTransmissionAuthorized: options.noteTransmissionAuthorized ?? false,
      cachedOwnerNoteUseAuthorized: false,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      deadlineAt: "2026-01-01T00:10:00.000Z",
    },
    manifest: currentManifest,
    authorizationId: currentManifest.id,
    deliveryComplete: true,
    authorizationActive: true,
  };
  const reservations: number[] = [];
  let reservationAttempts = 0;
  const checkpoints: unknown[] = [];
  let finished: string | null = null;
  let cancelled = false;
  let publishedGenerationId: string | null = "prior-valid-generation";
  let publicationCalls = 0;
  let posts = 0;
  let factoryCalls = 0;
  let deadlineCallback: (() => void) | null = null;
  const requests: JevPairRequest[] = [];
  const stateService = {
    async reserveExecutionAttempt() {
      reservationAttempts += 1;
      options.reservationEntered?.();
      await options.reservationGate;
      if (options.reserve?.() === false) return { outcome: "invalid-state" as const };
      reservations.push(reservations.length + 1);
      return {
        outcome: "accepted" as const,
        value: reservations.length,
        current: { evidenceEpoch: 0, consentEpoch: 0 },
      };
    },
    checkpointJudgments(input: unknown) {
      checkpoints.push(input);
      options.afterCheckpoint?.();
      return Promise.resolve({
        outcome: "accepted" as const,
        value: undefined,
        current: { evidenceEpoch: 0, consentEpoch: 0 },
      });
    },
    finishExecution(input: { status: string }) {
      finished = input.status;
      return Promise.resolve({
        outcome: "accepted" as const,
        value: undefined,
        current: { evidenceEpoch: 0, consentEpoch: 0 },
      });
    },
    cancelExecution() {
      cancelled = true;
      return Promise.resolve({
        outcome: "accepted" as const,
        value: undefined,
        current: { evidenceEpoch: 0, consentEpoch: 0 },
      });
    },
    publishGeneration(input: { generation: { id: string } }) {
      publicationCalls += 1;
      publishedGenerationId = input.generation.id;
      return Promise.resolve({
        outcome: "accepted" as const,
        value: undefined,
        current: { evidenceEpoch: 0, consentEpoch: 0 },
      });
    },
  } as unknown as SemanticRedundancyStateService;
  const service = createSemanticRefreshService({
    stateService,
    isExecutionStartCurrentProcess: () => true,
    loadExecution: (executionId) =>
      Promise.resolve(executionId === currentManifest.id ? executionSnapshot : null),
    pairAuthority: {
      async withCurrentPair({ pair: frozenPair, operation }) {
        const currentPair = currentManifest.pairs.find(
          ({ gameA, gameB }) => gameA === frozenPair.gameA && gameB === frozenPair.gameB,
        );
        if (!currentPair) throw new Error("pair absent");
        return operation(currentSource);
      },
    },
    generationAuthority: {
      async withCurrentGeneration({ manifest, operation }) {
        return operation({
          sourceIdentity: manifest.sourceIdentity,
          eligibleGameIds: manifest.eligibleGameIds,
        });
      },
    },
    gatewayFactory(optionsForGateway) {
      factoryCalls += 1;
      return {
        async evaluatePair(request, signal) {
          const dispatch = (attemptId: string) =>
            optionsForGateway.admitAndDispatch({
              mode: request.mode,
              attemptId,
              start: () => {
                posts += 1;
                requests.push(request);
                return { response: Promise.resolve(new Response()) };
              },
            });
          await dispatch("fake-attempt");
          if (options.gateway) {
            return options.gateway(request, signal, async () => {
              await dispatch("fake-retry");
            });
          }
          return {
            description:
              request.mode === "owner-notes-only"
                ? null
                : {
                    score: 0.7,
                    confidence: 0.9,
                    modelId: JEV_MODEL_ID,
                    rubricVersion: 2,
                    questionVersion: 2,
                  },
            ownerNote:
              request.mode === "description-only"
                ? null
                : {
                    score: 0.6,
                    confidence: 0.8,
                    modelId: JEV_MODEL_ID,
                    rubricVersion: 2,
                    questionVersion: 2,
                  },
            usage: { inputTokens: 12, outputTokens: 2 },
          };
        },
      };
    },
    now: options.clock ?? (() => now),
    setTimer: (callback: () => void, delay: number) => {
      deadlineCallback = callback;
      return setTimeout(callback, delay);
    },
    clearTimer: (handle) => clearTimeout(handle),
  });
  return {
    service,
    manifest: currentManifest,
    setSource(source: SemanticPairSource) {
      currentSource = source;
    },
    reservations,
    get reservationAttempts() {
      return reservationAttempts;
    },
    checkpoints,
    get finished() {
      return finished;
    },
    get cancelled() {
      return cancelled;
    },
    get publishedGenerationId() {
      return publishedGenerationId;
    },
    get publicationCalls() {
      return publicationCalls;
    },
    get posts() {
      return posts;
    },
    get factoryCalls() {
      return factoryCalls;
    },
    requests,
    fireDeadline() {
      deadlineCallback?.();
    },
  };
}

describe("semantic refresh worker", () => {
  test("deadline during durable reservation prevents POST and terminalizes interrupted", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let clock = now;
    const h = setup({
      clock: () => clock,
      reservationGate: release.promise,
      reservationEntered: () => entered.resolve(),
    });
    const running = h.service.run(h.manifest.id);
    await entered.promise;
    clock = Date.parse(h.manifest.expiresAt);
    h.fireDeadline();
    release.resolve();
    await running;
    expect(h.posts).toBe(0);
    expect(h.finished).toBe("interrupted");
  });

  test("does no ordinary work until explicitly run and isolates signal payload fields", async () => {
    const descriptionOnly = setup({ scope: "description-and-owner-notes" });
    expect(descriptionOnly.factoryCalls).toBe(0);
    expect(descriptionOnly.posts).toBe(0);
    await descriptionOnly.service.run(descriptionOnly.manifest.id);
    expect(descriptionOnly.posts).toBe(1);
    expect(descriptionOnly.requests[0]).toEqual({
      mode: "description-only",
      gameA: { name: "Game A", bggDescription: "Description A" },
      gameB: { name: "Game B", bggDescription: "Description B" },
    });

    const noteOnly = setup({ scope: "owner-notes-only", noteTransmissionAuthorized: true });
    await noteOnly.service.run(noteOnly.manifest.id);
    expect(noteOnly.posts).toBe(1);
    expect(noteOnly.requests[0]).toEqual({
      mode: "owner-notes-only",
      gameA: { name: "Game A", ownerNote: "Note A" },
      gameB: { name: "Game B", ownerNote: "Note B" },
    });

    const combined = setup({
      scope: "description-and-owner-notes",
      noteTransmissionAuthorized: true,
    });
    await combined.service.run(combined.manifest.id);
    expect(combined.posts).toBe(1);
    expect(combined.requests[0]).toEqual({
      mode: "description-and-owner-notes",
      gameA: { name: "Game A", bggDescription: "Description A", ownerNote: "Note A" },
      gameB: { name: "Game B", bggDescription: "Description B", ownerNote: "Note B" },
    });
  });

  test("missing owner notes keep the authorized request description-only", async () => {
    const noNotesPair = {
      ...pair("a", "b"),
      hasOwnerNoteA: false,
      hasOwnerNoteB: false,
      noteVersionA: null,
      noteVersionB: null,
    };
    const source = {
      ...sourceFor(manifest("description-and-owner-notes", [noNotesPair])),
      ownerNoteA: null,
      ownerNoteB: null,
    };
    const h = setup({
      scope: "description-and-owner-notes",
      noteTransmissionAuthorized: true,
      pairs: [noNotesPair],
      source,
    });
    await h.service.run(h.manifest.id);
    expect(h.requests[0].mode).toBe("description-only");
    expect(h.posts).toBe(1);
  });

  test("stops a 429 retry after owner-note authority changes during backoff", async () => {
    const h = setup({
      scope: "owner-notes-only",
      noteTransmissionAuthorized: true,
      gateway: async (_request, signal, retry) => {
        h.setSource({ ...sourceFor(h.manifest), ownerNoteA: null });
        if (signal?.aborted) throw new Error("aborted");
        await retry();
        return {
          description: null,
          ownerNote: null,
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    });
    await h.service.run(h.manifest.id);
    expect(h.posts).toBe(1);
    expect(h.reservations).toHaveLength(1);
    expect(h.checkpoints).toHaveLength(0);
    expect(h.finished).toBe("failed");
  });

  test("rejects stale completion after note clear and never checkpoints it", async () => {
    const enteredGateway = deferred<void>();
    const finishGateway = deferred<JevPairResult>();
    const h = setup({
      scope: "owner-notes-only",
      noteTransmissionAuthorized: true,
      gateway: async () => {
        enteredGateway.resolve(undefined);
        return finishGateway.promise;
      },
    });
    const run = h.service.run(h.manifest.id);
    const enteredOrFinished = await Promise.race([
      enteredGateway.promise.then(() => "entered" as const),
      run.then(() => "finished" as const),
    ]);
    expect(enteredOrFinished).toBe("entered");
    expect(h.posts).toBeGreaterThan(0);
    h.setSource({ ...sourceFor(h.manifest), ownerNoteA: null });
    finishGateway.resolve({
      description: null,
      ownerNote: {
        score: 0.6,
        confidence: 0.8,
        modelId: JEV_MODEL_ID,
        rubricVersion: 2,
        questionVersion: 2,
      },
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await run;
    expect(h.posts).toBe(1);
    expect(h.checkpoints).toHaveLength(0);
    expect(h.finished).toBe("failed");
  });

  test("persists an independent note score even with low confidence", async () => {
    const h = setup({
      scope: "owner-notes-only",
      noteTransmissionAuthorized: true,
      gateway: () =>
        Promise.resolve({
          description: null,
          ownerNote: {
            score: 0.6,
            confidence: 0.1,
            modelId: JEV_MODEL_ID,
            rubricVersion: 2,
            questionVersion: 2,
          },
          usage: { inputTokens: 3, outputTokens: 1 },
        }),
    });
    await h.service.run(h.manifest.id);
    const judgment = (h.checkpoints[0] as { judgments: SemanticPairJudgment[] }).judgments[0];
    expect(judgment.ownerNote).toMatchObject({
      status: "scored",
      score: 0.6,
      confidence: 0.1,
      sourceFingerprintA: "c".repeat(64),
      sourceFingerprintB: "d".repeat(64),
    });
    expect(JSON.stringify(h.checkpoints)).not.toContain("Note A");
    expect(JSON.stringify(h.checkpoints)).not.toContain("Note B");
  });

  test("checkpoints multiple pairs without self-invalidating source identity", async () => {
    const h = setup({ scope: "description-only", pairs: [pair("a", "b"), pair("a", "c")] });
    await h.service.run(h.manifest.id);
    expect(h.posts).toBe(2);
    expect(h.checkpoints).toHaveLength(2);
    expect(h.publicationCalls).toBe(1);
    expect(h.publishedGenerationId).toBe(h.manifest.id);
  });

  test("publishes an explicit zero-pair execution without creating a provider", async () => {
    const h = setup({ pairs: [] });
    await h.service.run(h.manifest.id);
    expect(h.posts).toBe(0);
    expect(h.factoryCalls).toBe(0);
    expect(h.publicationCalls).toBe(1);
    expect(h.publishedGenerationId).toBe(h.manifest.id);
    expect(h.finished).toBeNull();
  });

  test("stops the next send after a prediction source revision changes", async () => {
    let pairCheckpointed = false;
    const h = setup({
      scope: "description-only",
      pairs: [pair("a", "b"), pair("a", "c")],
      afterCheckpoint() {
        if (!pairCheckpointed) {
          pairCheckpointed = true;
          const source = sourceFor(h.manifest);
          source.sourceIdentity = { ...identity, predictionSettingsHash: "e".repeat(64) };
          h.setSource(source);
        }
      },
    });
    await h.service.run(h.manifest.id);
    expect(h.posts).toBe(1);
    expect(h.checkpoints).toHaveLength(1);
  });

  test("fails closed on attempt-budget exhaustion and cancelled executions do not checkpoint", async () => {
    const exhausted = setup({ reserve: () => false });
    await exhausted.service.run(exhausted.manifest.id);
    expect(exhausted.reservationAttempts).toBe(1);
    expect(exhausted.reservations).toHaveLength(0);
    expect(exhausted.posts).toBe(0);
    expect(exhausted.finished).toBe("failed");

    const enteredGateway = deferred<void>();
    const finishGateway = deferred<JevPairResult>();
    const h = setup({
      scope: "description-only",
      gateway: async (_request, signal) => {
        enteredGateway.resolve(undefined);
        signal?.addEventListener("abort", () => finishGateway.reject(new Error("aborted")), {
          once: true,
        });
        return finishGateway.promise;
      },
    });
    const run = h.service.run(h.manifest.id);
    const enteredOrFinished = await Promise.race([
      enteredGateway.promise.then(() => "entered" as const),
      run.then(() => "finished" as const),
    ]);
    expect(enteredOrFinished).toBe("entered");
    await h.service.cancel(h.manifest.id);
    await run;
    expect(h.cancelled).toBe(true);
    expect(h.checkpoints).toHaveLength(0);
    expect(h.publicationCalls).toBe(0);
    expect(h.publishedGenerationId).toBe("prior-valid-generation");
  });

  test("does not automatically resume an interrupted execution after service recreation", async () => {
    const h = setup();
    const service = createSemanticRefreshService({
      stateService: {} as SemanticRedundancyStateService,
      isExecutionStartCurrentProcess: () => false,
      loadExecution: () =>
        Promise.resolve({
          execution: {
            ...identity,
            commandId: h.manifest.id,
            manifestDigest: h.manifest.digest,
            sourceIdentity: identity,
            signalScope: h.manifest.signalScope,
            noteTransmissionAuthorized: false,
            cachedOwnerNoteUseAuthorized: false,
            status: "interrupted",
            startedAt: "2026-01-01T00:00:00.000Z",
            deadlineAt: "2026-01-01T00:00:30.000Z",
          },
          manifest: h.manifest,
          authorizationId: h.manifest.id,
          deliveryComplete: true,
          authorizationActive: false,
        }),
      pairAuthority: {
        withCurrentPair() {
          throw new Error("unexpected authority read");
        },
      },
      generationAuthority: {
        withCurrentGeneration() {
          throw new Error("unexpected authority read");
        },
      },
      gatewayFactory() {
        throw new Error("unexpected gateway creation");
      },
      now: () => now,
    });
    expect(await service.run(h.manifest.id)).toMatchObject({ outcome: "not-authorized" });
    expect(h.posts).toBe(0);
  });
});
