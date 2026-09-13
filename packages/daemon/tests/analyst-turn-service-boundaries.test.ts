import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AnalystEvidenceService } from "../src/services/analyst-evidence-service.js";
import type { AnalystTopResult } from "@shelf-judge/shared";
import type { AnalystProjectionSnapshot } from "../src/services/analyst-evidence-projections.js";
import { createAnalystTurnService } from "../src/services/analyst-turn-service.js";
import type { GroundedAnalysisProvider } from "../src/services/grounded-analysis/provider.js";

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
  run: (request: Parameters<NonNullable<GroundedAnalysisProvider["analyzeFreeform"]>>[0]) => Promise<never>,
): GroundedAnalysisProvider {
  return {
    configurationStatus: {
      status: "unavailable",
      reason: "model-configuration",
      correctionDestination: { operationId: "shelf.grounded-analysis.configuration.get" },
    },
    analyze: () => Promise.reject(new Error("structured analysis is not configured")),
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
    withRetrievedEvidence: (retrieved, operation) => operation(retrieved),
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
  test("registers only the four model-directed collection tools", async () => {
    const service = createAnalystTurnService({
      provider: unavailableProvider((analysisRequest) => {
        expect(analysisRequest.allowedTools.toolNames).toEqual([
          "top",
          "grep",
          "readGames",
          "summarize",
        ]);
        expect(analysisRequest.retrievalTools?.map(({ name }) => name)).toEqual([
          "top",
          "grep",
          "readGames",
          "summarize",
        ]);
        return Promise.reject(new Error("stop after manifest inspection"));
      }),
      evidenceService: evidenceService({}),
    });

    expect(await failure(service.run(request(new AbortController().signal)))).toMatchObject({
      message: "stop after manifest inspection",
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
