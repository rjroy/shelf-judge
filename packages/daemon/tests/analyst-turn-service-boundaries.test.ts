import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AnalystEvidenceService } from "../src/services/analyst-evidence-service.js";
import type { AnalystTopResult } from "@shelf-judge/shared";
import type { AnalystProjectionSnapshot } from "../src/services/analyst-evidence-projections.js";
import {
  createAnalystTurnService,
  projectFitnessPreview,
} from "../src/services/analyst-turn-service.js";
import type { GroundedAnalysisProvider } from "../src/services/grounded-analysis/provider.js";
import { BggClientError } from "../src/services/bgg-client.js";

// These tools must not use session context; fail if an implementation starts doing so.
const unusedContext = new Proxy({} as ExtensionContext, {
  get() {
    throw new Error("Unexpected extension context access");
  },
});

async function failure(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to fail");
}

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const snapshot: AnalystProjectionSnapshot = {
  collectionId: "collection",
  collectionRevision: 1,
  snapshotFingerprint: "server-captured-fingerprint",
  sources: [],
  page: () => ({ sources: [], nextCursor: null, totalSourceCount: 0 }),
};

function unavailableProvider(
  run: (
    request: Parameters<NonNullable<GroundedAnalysisProvider["analyzeFreeform"]>>[0],
  ) => Promise<never>,
): GroundedAnalysisProvider {
  return {
    configurationStatus: {
      status: "unavailable",
      reason: "model-configuration",
      correctionDestination: { operationId: "shelf.grounded-analysis.configuration.get" },
    },
    analyze: (analysisRequest) => run(analysisRequest),
    analyzeFreeform: run,
  };
}

function evidenceService(overrides: Partial<AnalystEvidenceService>): AnalystEvidenceService {
  return {
    capture: () => Promise.resolve(snapshot),
    top: () => Promise.reject(new Error("top was not configured")),
    withTopEvidence: () => Promise.reject(new Error("top evidence was not configured")),
    accumulatedEvidence: () => Promise.reject(new Error("accumulated evidence was not configured")),
    retrieve: () => Promise.reject(new Error("retrieve was not configured")),
    grep: () => Promise.reject(new Error("grep was not configured")),
    compareNoteDependencies: () => Promise.resolve("current"),
    withCurrentNoteDependencies: (_dependencies, operation) => operation(),
    handoff: (_snapshot, retrieved, deliver) => deliver(retrieved),
    revalidate: () => Promise.resolve({ valid: true }),
    inspectCitation: () => Promise.reject(new Error("inspect was not configured")),
    ...overrides,
  };
}

function request(signal: AbortSignal) {
  return {
    systemPrompt: "policy",
    prompt: "question",
    signal,
    audit: {
      operationId: "operation",
      batchId: "batch",
      requestId: "request",
      trigger: "test",
      feature: "collection-analyst" as const,
      evidenceClassCounts: [],
      evidenceManifestId: "manifest",
      evidenceManifestVersion: "1",
      evidenceIdentityHash: "hash",
    },
  };
}

describe("Analyst turn service boundaries", () => {
  test("uses verified Thing facts, not imported collection metadata, for BGG preview claims", () => {
    const staged: Array<{ evidenceClass: string; payload: unknown }> = [];
    const registry = {
      stage(record: { evidenceClass: string; payload: unknown }) {
        staged.push(record);
        return `citation-${staged.length}`;
      },
      commit() {},
      discard() {},
    };
    const fact = {
      bggId: 42,
      primaryName: "Verified BGG Name",
      yearPublished: 2024,
      yearMissing: false,
      mechanics: [{ id: 7, name: "Verified mechanic" }],
      mechanicsMissing: false,
      mechanicsComplete: true,
      warnings: [],
      observedAt: "2025-02-03T04:05:06.000Z",
    };
    const preview = projectFitnessPreview(
      {
        kind: "calculated",
        result: {
          game: {
            id: "imported-game",
            name: "Imported Local Name",
            yearPublished: 1999,
            bggData: { mechanics: [{ id: 99, name: "Imported mechanic" }] },
            ownership: "owned",
          },
          score: { score: 81, breakdown: [], predictionMeta: null },
          predictionUnavailable: null,
          previewIdentity: {
            calculationVersion: "bgg-fitness-preview-v2",
            source: "local-unverified",
            calculatedAt: "2025-02-03T04:06:00.000Z",
            bggObservedAt: fact.observedAt,
            collectionRevision: 1,
            predictionSettingsVersion: "settings",
            tournamentDataVersion: "tournament",
          },
          bggVerification: { status: "verified" },
        },
      },
      42,
      registry,
      fact,
    );

    expect(preview).toMatchObject({
      status: "ok",
      state: "existing",
      primaryName: "Verified BGG Name",
      collectionGameId: "imported-game",
      score: { value: 81 },
    });
    expect(
      staged.find(({ evidenceClass }) => evidenceClass === "bgg-thing-facts")?.payload,
    ).toMatchObject({
      bggId: 42,
      primaryName: "Verified BGG Name",
      yearPublished: 2024,
      mechanics: [{ id: 7, name: "Verified mechanic" }],
    });
    expect(
      staged.find(({ evidenceClass }) => evidenceClass === "current-scoring")?.payload,
    ).toMatchObject({
      gameId: "imported-game",
      name: "Imported Local Name",
      score: 81,
      ownership: "owned",
    });
  });

  test("does not make a BGG claim from local metadata when Thing facts are unavailable", () => {
    const staged: Array<{ evidenceClass: string }> = [];
    const registry = {
      stage(record: { evidenceClass: string }) {
        staged.push(record);
        return `citation-${staged.length}`;
      },
      commit() {},
      discard() {},
    };
    const preview = projectFitnessPreview(
      {
        kind: "calculated",
        result: {
          game: {
            id: "imported-game",
            name: "Imported Local Name",
            yearPublished: 1999,
            bggData: { mechanics: [] },
            ownership: "owned",
          },
          score: { score: 81, breakdown: [], predictionMeta: null },
          predictionUnavailable: null,
          previewIdentity: {
            calculationVersion: "bgg-fitness-preview-v2",
            source: "local-unverified",
            calculatedAt: "2025-02-03T04:06:00.000Z",
            bggObservedAt: "2025-02-03T04:05:06.000Z",
            collectionRevision: 1,
            predictionSettingsVersion: "settings",
            tournamentDataVersion: "tournament",
          },
          bggVerification: { status: "verified" },
        },
      },
      42,
      registry,
    );

    expect(preview).toMatchObject({
      status: "partial",
      state: "existing-local-unverified",
      collectionName: "Imported Local Name",
      bggLookup: { status: "failed", code: "BggParse" },
      score: { value: 81 },
    });
    expect(staged.some(({ evidenceClass }) => evidenceClass === "bgg-thing-facts")).toBe(false);
  });

  test("registers the complete Analyst collection and BGG tool set", async () => {
    const service = createAnalystTurnService({
      provider: unavailableProvider((analysisRequest) => {
        expect(analysisRequest.allowedTools.toolNames).toEqual([
          "top",
          "grep",
          "readGames",
          "summarize",
          "searchBggTitles",
          "reviewBggHot",
          "readBggFacts",
          "previewBggFitness",
          "submit_grounded_analysis",
        ]);
        expect(analysisRequest.retrievalTools?.map(({ name }) => name)).toEqual([
          "top",
          "grep",
          "readGames",
          "summarize",
          "searchBggTitles",
          "reviewBggHot",
          "readBggFacts",
          "previewBggFitness",
        ]);
        return Promise.reject(new Error("stop after manifest inspection"));
      }),
      evidenceService: evidenceService({}),
    });

    expect(await failure(service.run(request(new AbortController().signal)))).toMatchObject({
      message: "stop after manifest inspection",
    });
  });

  test("keeps BGG 429 tool-local and accepts a valid abstention without fabricated evidence", async () => {
    let providerCalls = 0;
    let observedToolResult: unknown;
    const provider = unavailableProvider(async (analysisRequest) => {
      providerCalls++;
      const search = analysisRequest.retrievalTools?.find(({ name }) => name === "searchBggTitles");
      const preview = analysisRequest.retrievalTools?.find(
        ({ name }) => name === "previewBggFitness",
      );
      if (search === undefined || preview === undefined) throw new Error("BGG tools missing");
      const response = await search.execute(
        "search",
        { ownerMessageIndex: 0, start: 14, end: 18 },
        undefined,
        undefined,
        unusedContext,
      );
      const content = response.content[0];
      if (content.type !== "text") throw new Error("Expected JSON BGG tool result");
      observedToolResult = JSON.parse(content.text) as unknown;
      await preview.execute("preview", { bggId: 174430 }, undefined, undefined, unusedContext);
      return {
        output: {
          outcome: "answered",
          blocks: [{ text: "Azul is the best result.", citationIds: [] }],
        },
        usage: { state: "unavailable" },
      } as never;
    });
    const service = createAnalystTurnService({
      provider,
      bggClient: {
        isConfigured: () => true,
        searchBoardgameTitles: () => Promise.reject(new BggClientError("rate-limited", 429)),
      } as never,
      previewFitness: () => Promise.resolve({ kind: "failed", code: "BggThrottled" }),
      evidenceService: evidenceService({
        accumulatedEvidence: () =>
          Promise.resolve({
            snapshotFingerprint: snapshot.snapshotFingerprint,
            evidence: {} as never,
            citations: [],
            noteDependencies: [],
            scope: {
              totalSourceCount: 0,
              matchingSourceCount: 0,
              examinedSourceCount: 0,
              exhaustive: true,
            },
            nextCursor: null,
          }),
      }),
    });

    const result = await service.run({
      ...request(new AbortController().signal),
      ownerMessages: ["Please search Azul and BGG ID 174430"],
      conversationId: "conversation",
      turnIndex: 0,
    });

    expect(providerCalls).toBe(1);
    expect(observedToolResult).toEqual({
      status: "error",
      code: "BggThrottled",
      retryable: true,
    });
    expect(result).toMatchObject({
      output: {
        outcome: "abstained",
        reason: "insufficient-evidence",
        blocks: [
          {
            text: "I cannot provide a grounded answer because the evidence checks failed. BGG discovery or game-detail information could not be verified during this turn.",
            citationIds: [],
          },
        ],
      },
      discoveryIds: [],
      discovery: [{ status: "error", code: "BggThrottled", retryable: true }],
      fitnessPreview: [
        {
          status: "unavailable",
          state: "unavailable",
          bggId: 174430,
          code: "BggThrottled",
          retryable: true,
          predictionUnavailable: null,
        },
      ],
    });
    if (!("inspectionRecords" in result)) throw new Error("Expected finalized turn result");
    expect(result.inspectionRecords).toEqual([]);
    expect(result.retrieved.flatMap(({ citations }) => citations)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("Azul is the best result.");
    expect(JSON.stringify(result)).not.toContain("BggClientError");
    expect(JSON.stringify(result)).not.toContain("observationCitationId");
    expect(JSON.stringify(result)).not.toContain("score");
  });

  test("preserves a qualified partial answer when collection evidence succeeds despite BGG 429", async () => {
    const citation = {
      citationId: "collection-citation",
      sourceId: "game-1",
      sourceVersion: "collection-revision-1",
      evidenceClass: "game-identity-ownership",
      canonicalSummary: "Collection game evidence",
      testimony: false,
      destination: { operationId: "shelf.game.get", parameters: { gameId: "game-1" } },
    } as const;
    const provider = unavailableProvider(async (analysisRequest) => {
      const top = analysisRequest.retrievalTools?.find(({ name }) => name === "top");
      const search = analysisRequest.retrievalTools?.find(({ name }) => name === "searchBggTitles");
      if (top === undefined || search === undefined) throw new Error("Expected evidence tools");
      await top.execute("top", { rankBy: "fitness" }, undefined, undefined, unusedContext);
      const response = await search.execute(
        "search",
        { ownerMessageIndex: 0, start: 14, end: 18 },
        undefined,
        undefined,
        unusedContext,
      );
      const content = response.content[0];
      if (content.type !== "text") throw new Error("Expected JSON BGG tool result");
      expect(JSON.parse(content.text)).toEqual({
        status: "error",
        code: "BggThrottled",
        retryable: true,
      });
      return {
        output: {
          outcome: "partial",
          blocks: [
            {
              text: "This collection includes Game. I could not verify BGG information because the lookup was rate limited.",
              citationIds: [citation.citationId],
              uncertainty: "BGG identity could not be verified.",
            },
          ],
        },
        usage: { state: "unavailable" },
      } as never;
    });
    const service = createAnalystTurnService({
      provider,
      bggClient: {
        isConfigured: () => true,
        searchBoardgameTitles: () => Promise.reject(new BggClientError("rate-limited", 429)),
      } as never,
      evidenceService: evidenceService({
        top: () =>
          Promise.resolve({
            snapshotFingerprint: snapshot.snapshotFingerprint,
            entries: [
              {
                gameId: "game-1",
                name: "Game",
                fitness: 8,
                breakdown: [],
                citations: [citation, { ...citation, citationId: "collection-citation-2" }],
              },
            ],
            scope: {
              totalGameCount: 1,
              matchingGameCount: 1,
              examinedGameCount: 1,
              exhaustive: true,
            },
            nextCursor: null,
            truncated: false,
          }),
        accumulatedEvidence: () =>
          Promise.resolve({
            snapshotFingerprint: snapshot.snapshotFingerprint,
            evidence: {} as never,
            citations: [citation, { ...citation, citationId: "collection-citation-2" }],
            noteDependencies: [],
            scope: {
              totalSourceCount: 1,
              matchingSourceCount: 1,
              examinedSourceCount: 1,
              exhaustive: true,
            },
            nextCursor: null,
          }),
      }),
    });

    const result = await service.run({
      ...request(new AbortController().signal),
      ownerMessages: ["Please search Azul"],
      conversationId: "conversation",
      turnIndex: 0,
    });

    expect(result).toMatchObject({
      output: {
        outcome: "partial",
        blocks: [
          {
            text: "This collection includes Game. I could not verify BGG information because the lookup was rate limited.",
            citationIds: [citation.citationId],
            uncertainty: "BGG identity could not be verified.",
          },
        ],
        citations: [citation],
      },
      discovery: [{ status: "error", code: "BggThrottled", retryable: true }],
      discoveryIds: [],
      fitnessPreview: [],
    });
  });

  test("cancels while a non-abortable snapshot capture is pending", async () => {
    const capture = deferred<AnalystProjectionSnapshot>();
    const controller = new AbortController();
    const service = createAnalystTurnService({
      provider: unavailableProvider(() => Promise.reject(new Error("provider must not run"))),
      evidenceService: evidenceService({ capture: () => capture.promise }),
    });

    const running = service.run(request(controller.signal));
    controller.abort();
    expect(await failure(running)).toMatchObject({ name: "AbortError" });
    capture.resolve(snapshot);
  });

  test("cancels while a non-abortable top operation is pending", async () => {
    const top = deferred<AnalystTopResult>();
    const started = deferred<void>();
    const controller = new AbortController();
    const service = createAnalystTurnService({
      provider: unavailableProvider(async (analysisRequest) => {
        const tool = analysisRequest.retrievalTools?.find(({ name }) => name === "top");
        if (tool === undefined) throw new Error("top tool missing");
        await tool.execute("top", { rankBy: "fitness" }, undefined, undefined, unusedContext);
        throw new Error("provider must not receive retrieval data after cancellation");
      }),
      evidenceService: evidenceService({
        top: () => {
          started.resolve();
          return top.promise;
        },
      }),
    });

    const running = service.run(request(controller.signal));
    await started.promise;
    controller.abort();
    expect(await failure(running)).toMatchObject({ name: "AbortError" });
  });

  test("rejects model-created citation IDs that are absent from the turn registry", () => {
    const provider: GroundedAnalysisProvider = {
      configurationStatus: unavailableProvider(() => Promise.reject(new Error()))
        .configurationStatus,
      analyze: () =>
        Promise.resolve({
          output: {
            outcome: "answered",
            blocks: [{ text: "Unsupported claim", citationIds: ["forged-citation"] }],
          },
          usage: { state: "unavailable" },
        } as never),
    };
    const service = createAnalystTurnService({
      provider,
      evidenceService: evidenceService({
        accumulatedEvidence: () =>
          Promise.resolve({
            snapshotFingerprint: snapshot.snapshotFingerprint,
            evidence: {} as never,
            citations: [],
            noteDependencies: [],
            scope: {
              totalSourceCount: 0,
              matchingSourceCount: 0,
              examinedSourceCount: 0,
              exhaustive: true,
            },
            nextCursor: null,
          }),
      }),
    });

    expect(service.run(request(new AbortController().signal))).resolves.toMatchObject({
      valid: false,
      reason: "handoff-failed",
    });
  });

  test("inspects the Hot observation and all 20 candidate identity citations", async () => {
    const provider = unavailableProvider(async (analysisRequest) => {
      const tool = analysisRequest.retrievalTools?.find(({ name }) => name === "reviewBggHot");
      if (!tool) throw new Error("hot review tool missing");
      await tool.execute("hot-review", {}, undefined, undefined, unusedContext);
      return {
        output: { outcome: "answered", blocks: [{ text: "No BGG results", citationIds: [] }] },
        usage: { state: "unavailable" },
      } as never;
    });
    const service = createAnalystTurnService({
      provider,
      bggClient: {
        isConfigured: () => true,
        reviewBoardgameHot: () =>
          Promise.resolve({
            observedAt: "2025-02-03T04:05:06.000Z",
            returnedCount: 20,
            emittedCount: 20,
            truncated: false,
            candidates: Array.from({ length: 20 }, (_, index) => ({
              bggId: index + 1,
              primaryName: `Hot game ${index + 1}`,
              yearPublished: 2020,
            })),
          }),
      } as never,
      evidenceService: evidenceService({
        accumulatedEvidence: () =>
          Promise.resolve({
            snapshotFingerprint: snapshot.snapshotFingerprint,
            evidence: {} as never,
            citations: [],
            noteDependencies: [],
            scope: {
              totalSourceCount: 0,
              matchingSourceCount: 0,
              examinedSourceCount: 0,
              exhaustive: true,
            },
            nextCursor: null,
          }),
      }),
    });
    const result = await service.run({
      ...request(new AbortController().signal),
      conversationId: "conversation",
      turnIndex: 0,
    });

    expect(result).toMatchObject({ output: { outcome: "answered" } });
    if (!("inspectionRecords" in result)) throw new Error("Expected successful turn result");
    expect(result.inspectionRecords).toHaveLength(21);
    expect(
      result.inspectionRecords.filter(
        ({ citation }) => citation.evidenceClass === "bgg-candidate-identity",
      ),
    ).toHaveLength(20);
    expect(
      result.inspectionRecords.find(
        ({ citation }) => citation.evidenceClass === "bgg-hot-observation",
      ),
    ).toMatchObject({
      citation: { evidenceClass: "bgg-hot-observation" },
      view: { kind: "discovery", result: { status: "ok", source: "hot", emittedCount: 20 } },
    });
    expect(
      result.inspectionRecords.every(
        (record) => !("authenticationToken" in record) && !("attestationDigest" in record),
      ),
    ).toBe(true);
  });

  test("materializes candidate identities, Thing facts, and preview calculation source versions", async () => {
    const provider = unavailableProvider(async (analysisRequest) => {
      const search = analysisRequest.retrievalTools?.find(({ name }) => name === "searchBggTitles");
      const preview = analysisRequest.retrievalTools?.find(
        ({ name }) => name === "previewBggFitness",
      );
      if (!search || !preview) throw new Error("BGG tools missing");
      await search.execute(
        "search",
        { ownerMessageIndex: 0, start: 7, end: 11 },
        undefined,
        undefined,
        unusedContext,
      );
      await preview.execute("preview", { bggId: 42 }, undefined, undefined, unusedContext);
      return {
        output: { outcome: "answered", blocks: [{ text: "Azul", citationIds: [] }] },
        usage: { state: "unavailable" },
      } as never;
    });
    const service = createAnalystTurnService({
      provider,
      bggClient: {
        isConfigured: () => true,
        searchBoardgameTitles: () =>
          Promise.resolve({
            observedAt: "2025-02-03T04:05:06.000Z",
            returnedCount: 1,
            emittedCount: 1,
            truncated: false,
            candidates: [{ bggId: 42, primaryName: "Azul", yearPublished: 2017 }],
          }),
      } as never,
      previewFitness: () =>
        Promise.resolve({
          kind: "calculated",
          result: {
            game: { id: "preview-42", name: "Azul", yearPublished: 2017 },
            score: { score: 81, breakdown: [], predictionMeta: null, ratedAxisCount: 0 },
            predictionUnavailable: null,
            previewIdentity: {
              calculationVersion: "bgg-fitness-preview-v2",
              source: "bgg-verified",
              calculatedAt: "2025-02-03T04:06:00.000Z",
              bggObservedAt: "2025-02-03T04:05:06.000Z",
              collectionRevision: 3,
              predictionSettingsVersion: "settings-2",
              tournamentDataVersion: "tournament-4",
            },
            verifiedFact: {
              bggId: 42,
              primaryName: "Azul",
              yearPublished: null,
              yearMissing: true,
              mechanics: [],
              mechanicsMissing: false,
              mechanicsComplete: true,
              warnings: [],
              observedAt: "2025-02-03T04:05:06.000Z",
            },
            bggVerification: { status: "verified" },
          },
        }),
      evidenceService: evidenceService({
        accumulatedEvidence: () =>
          Promise.resolve({
            snapshotFingerprint: snapshot.snapshotFingerprint,
            evidence: {} as never,
            citations: [],
            noteDependencies: [],
            scope: {
              totalSourceCount: 0,
              matchingSourceCount: 0,
              examinedSourceCount: 0,
              exhaustive: true,
            },
            nextCursor: null,
          }),
      }),
    });
    const result = await service.run({
      ...request(new AbortController().signal),
      ownerMessages: ["I like Azul"],
      conversationId: "conversation",
      turnIndex: 2,
    });

    if (!("inspectionRecords" in result)) throw new Error("Expected successful turn result");
    const candidateRecord = result.inspectionRecords.find(
      ({ citation }) => citation.evidenceClass === "bgg-candidate-identity",
    );
    const factsRecord = result.inspectionRecords.find(
      ({ citation }) => citation.evidenceClass === "bgg-thing-facts",
    );
    const calculationRecord = result.inspectionRecords.find(
      ({ citation }) => citation.evidenceClass === "bgg-preview-calculation",
    );
    expect(candidateRecord).toMatchObject({
      citation: { sourceId: "42" },
      view: { kind: "discovery" },
    });
    expect(factsRecord).toMatchObject({ citation: { sourceId: "42" }, view: { kind: "item" } });
    expect(factsRecord).toMatchObject({
      view: { kind: "item", result: { facts: [{ yearPublished: null, missingFields: ["year"] }] } },
    });
    expect(calculationRecord).toMatchObject({
      citation: { sourceId: "42" },
      view: { kind: "calculation" },
    });
    if (calculationRecord?.view.kind !== "calculation")
      throw new Error("Expected calculation inspection record");
    if (!("sourceVersion" in calculationRecord.view.result))
      throw new Error("Expected calculation source version");
    expect(calculationRecord.view.result.sourceVersion).toContain("bgg-fitness-preview-v2:");
  });

  test("discards staged BGG inspections when the provider turn is aborted", async () => {
    const providerStarted = deferred<void>();
    const finishProvider = deferred<never>();
    const controller = new AbortController();
    const service = createAnalystTurnService({
      provider: unavailableProvider(async (analysisRequest) => {
        const tool = analysisRequest.retrievalTools?.find(({ name }) => name === "reviewBggHot");
        if (!tool) throw new Error("hot review tool missing");
        await tool.execute("hot-review", {}, undefined, undefined, unusedContext);
        providerStarted.resolve();
        return finishProvider.promise;
      }),
      bggClient: {
        isConfigured: () => true,
        reviewBoardgameHot: () =>
          Promise.resolve({
            observedAt: "2025-02-03T04:05:06.000Z",
            returnedCount: 0,
            emittedCount: 0,
            truncated: false,
            candidates: [],
          }),
      } as never,
      evidenceService: evidenceService({}),
    });

    const running = service.run({
      ...request(controller.signal),
      conversationId: "conversation",
      turnIndex: 3,
    });
    await providerStarted.promise;
    controller.abort();
    finishProvider.resolve(Promise.reject(new DOMException("aborted", "AbortError")) as never);
    expect(await failure(running)).toMatchObject({ name: "AbortError" });
  });

  test("shares the 24-call reservation across collection, BGG, and submission dispatch", async () => {
    const service = createAnalystTurnService({
      provider: unavailableProvider(async (analysisRequest) => {
        const collectionTool = analysisRequest.retrievalTools?.find(({ name }) => name === "top");
        if (collectionTool === undefined) throw new Error("top tool missing");
        await collectionTool.execute(
          "top",
          { rankBy: "fitness" },
          undefined,
          undefined,
          unusedContext,
        );
        const bggTool = analysisRequest.retrievalTools?.find(
          ({ name }) => name === "previewBggFitness",
        );
        if (bggTool === undefined) throw new Error("preview tool missing");
        for (let index = 0; index < 22; index++)
          await bggTool.execute("preview", { bggId: 999 }, undefined, undefined, unusedContext);
        analysisRequest.toolLifecycle?.dispatch("submit_grounded_analysis", "submission");
        expect(() =>
          analysisRequest.toolLifecycle?.dispatch("submit_grounded_analysis", "submission"),
        ).toThrow(/budget exhausted/u);
        const denied = await bggTool.execute(
          "preview",
          { bggId: 999 },
          undefined,
          undefined,
          unusedContext,
        );
        expect((denied.content[0] as { text: string }).text).toContain("BudgetExhausted");
        return Promise.reject(new Error("stop after shared invocation budget check"));
      }),
      evidenceService: evidenceService({
        top: () =>
          Promise.resolve({
            snapshotFingerprint: snapshot.snapshotFingerprint,
            entries: [],
            scope: {
              totalGameCount: 0,
              matchingGameCount: 0,
              examinedGameCount: 0,
              exhaustive: true,
            },
            nextCursor: null,
            truncated: false,
          }),
      }),
    });
    expect(await failure(service.run(request(new AbortController().signal)))).toMatchObject({
      message: "stop after shared invocation budget check",
    });
  });

  test("returns repeated retrieval pages", async () => {
    const secret = "OWNER-NOTE-SECRET".repeat(8_000);
    const logs: string[] = [];
    let retrievalCalls = 0;
    const top: AnalystTopResult = {
      snapshotFingerprint: snapshot.snapshotFingerprint,
      entries: [
        {
          gameId: "game",
          name: "Game",
          fitness: 1,
          breakdown: [],
          citations: [
            {
              citationId: "identity",
              sourceId: "game",
              sourceVersion: "1",
              evidenceClass: "game-identity-ownership",
              canonicalSummary: secret,
              testimony: false,
              destination: { operationId: "shelf.game.get", parameters: { gameId: "game" } },
            },
            {
              citationId: "score",
              sourceId: "score",
              sourceVersion: "1",
              evidenceClass: "current-scoring",
              canonicalSummary: "Current score",
              testimony: false,
              destination: { operationId: "shelf.game.get", parameters: { gameId: "game" } },
            },
          ],
        },
      ],
      scope: {
        totalGameCount: 1,
        matchingGameCount: 1,
        examinedGameCount: 1,
        exhaustive: true,
      },
      nextCursor: null,
      truncated: false,
    };
    const service = createAnalystTurnService({
      provider: unavailableProvider(async (analysisRequest) => {
        const tool = analysisRequest.retrievalTools?.find(({ name }) => name === "top");
        if (tool === undefined) throw new Error("top tool missing");
        const results = await Promise.all(
          ["retrieval-0", "retrieval-1", "retrieval-2"].map((toolCallId) =>
            tool.execute(toolCallId, { rankBy: "fitness" }, undefined, undefined, unusedContext),
          ),
        );
        throw new Error(JSON.stringify(results));
      }),
      evidenceService: evidenceService({
        top: (_captured, topRequest) => {
          expect(topRequest).toMatchObject({
            snapshotFingerprint: snapshot.snapshotFingerprint,
          });
          return Promise.resolve({
            ...top,
            scope: { ...top.scope, matchingGameCount: ++retrievalCalls },
          });
        },
      }),
      log: (record) => logs.push(JSON.stringify(record)),
    });

    const error = await failure(service.run(request(new AbortController().signal)));
    expect(String(error)).toContain("content");
    expect(JSON.stringify(logs)).not.toContain(secret);
    const parsedLogs = logs.map((record): Record<string, unknown> => {
      const parsed: unknown = JSON.parse(record);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        throw new Error("Expected a structured Analyst log record");
      return Object.fromEntries(Object.entries(parsed));
    });
    for (const callIndex of [0, 1, 2]) {
      expect(
        parsedLogs.some(
          (record) =>
            record.stage === "top" &&
            record.outcome === "attempt" &&
            record.callIndex === callIndex,
        ),
      ).toBe(true);
    }
    expect(
      parsedLogs.some(
        (record) =>
          record.stage === "top" &&
          record.outcome === "success" &&
          record.callIndex === 2 &&
          typeof record.durationMs === "number",
      ),
    ).toBe(true);
    expect(
      parsedLogs.some((record) => record.stage === "provider" && record.outcome === "failed"),
    ).toBe(true);
  });
});
