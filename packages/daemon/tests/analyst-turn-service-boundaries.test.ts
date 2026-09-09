import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  AnalystEvidenceService,
  AnalystRetrievedEvidence,
} from "../src/services/analyst-evidence-service.js";
import type { AnalystProjectionSnapshot } from "../src/services/analyst-evidence-projections.js";
import { createAnalystTurnService } from "../src/services/analyst-turn-service.js";
import type {
  GroundedAnalysisProvider,
  GroundedAnalysisRequest,
} from "../src/services/grounded-analysis/provider.js";

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
  run: (request: GroundedAnalysisRequest<never>) => Promise<never>,
): GroundedAnalysisProvider {
  return {
    configurationStatus: {
      status: "unavailable",
      reason: "model-configuration",
      correctionDestination: { operationId: "shelf.grounded-analysis.configuration.get" },
    },
    analyze: run,
  };
}

function evidenceService(overrides: Partial<AnalystEvidenceService>): AnalystEvidenceService {
  return {
    capture: () => Promise.resolve(snapshot),
    top: () => Promise.reject(new Error("top was not configured")),
    withTopEvidence: () => Promise.reject(new Error("top evidence was not configured")),
    retrieve: () => Promise.reject(new Error("retrieve was not configured")),
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

  test("cancels while a non-abortable evidence retrieval is pending", async () => {
    const retrieval = deferred<AnalystRetrievedEvidence>();
    const started = deferred<void>();
    const controller = new AbortController();
    const service = createAnalystTurnService({
      provider: unavailableProvider(async (analysisRequest) => {
        const tool = analysisRequest.retrievalTools?.[0];
        if (tool === undefined) throw new Error("retrieval tool missing");
        await tool.execute(
          "retrieval",
          { evidenceClasses: ["game-identity-ownership"] },
          undefined,
          undefined,
          unusedContext,
        );
        throw new Error("provider must not receive retrieval data after cancellation");
      }),
      evidenceService: evidenceService({
        retrieve: () => {
          started.resolve();
          return retrieval.promise;
        },
      }),
    });

    const running = service.run(request(controller.signal));
    await started.promise;
    controller.abort();
    expect(await failure(running)).toMatchObject({ name: "AbortError" });
  });

  test("fails closed without exposing oversized retrieved evidence to the model", async () => {
    const secret = "OWNER-NOTE-SECRET".repeat(8_000);
    const logs: string[] = [];
    let retrievalCalls = 0;
    const retrieved: AnalystRetrievedEvidence = {
      snapshotFingerprint: snapshot.snapshotFingerprint,
      evidence: {
        manifestId: "test",
        manifestVersion: "1",
        evidenceClasses: [],
        examinedSources: [],
        entries: [],
        hasSource: () => false,
        resolve: () => undefined,
      },
      citations: [
        {
          citationId: "citation",
          sourceId: "game",
          sourceVersion: "1",
          evidenceClass: "owner-game-note",
          canonicalSummary: secret,
          testimony: true,
          destination: { operationId: "shelf.game.get", parameters: { gameId: "game" } },
        },
      ],
      noteDependencies: [],
      scope: {
        totalSourceCount: 1,
        matchingSourceCount: 1,
        examinedSourceCount: 1,
        exhaustive: true,
      },
      nextCursor: null,
    };
    const service = createAnalystTurnService({
      provider: unavailableProvider(async (analysisRequest) => {
        const tool = analysisRequest.retrievalTools?.[0];
        if (tool === undefined) throw new Error("retrieval tool missing");
        const results = await Promise.all(
          ["retrieval-0", "retrieval-1", "retrieval-2"].map((toolCallId) =>
            tool.execute(
              toolCallId,
              { evidenceClasses: ["owner-game-note"] },
              undefined,
              undefined,
              unusedContext,
            ),
          ),
        );
        throw new Error(JSON.stringify(results));
      }),
      evidenceService: evidenceService({
        retrieve: (_captured, retrievalRequest) => {
          expect(retrievalRequest).toMatchObject({
            snapshotFingerprint: snapshot.snapshotFingerprint,
          });
          return Promise.resolve({
            ...retrieved,
            scope: { ...retrieved.scope, matchingSourceCount: ++retrievalCalls },
          });
        },
      }),
      log: (record) => logs.push(JSON.stringify(record)),
    });

    const error = await failure(service.run(request(new AbortController().signal)));
    expect(String(error)).toContain("Analyst context limit was reached");
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(logs)).not.toContain(secret);
    const serializedLogs = logs.join("\n");
    expect(serializedLogs).toContain('"stage":"retrieval","outcome":"attempt","pageIndex":0');
    expect(serializedLogs).toContain('"stage":"retrieval","outcome":"attempt","pageIndex":1');
    expect(serializedLogs).toContain('"stage":"retrieval","outcome":"attempt","pageIndex":2');
    expect(serializedLogs).toContain('"outcome":"rejected","durationMs":');
    expect(serializedLogs).toContain('"pageIndex":2,"sourceCount":3');
    expect(serializedLogs).toContain('"rejection":"context-limit"');
    expect(serializedLogs).toContain('"stage":"provider","outcome":"failed"');
  });
});
