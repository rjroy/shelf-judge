import { afterEach, describe, expect, test } from "bun:test";
import { createGroundedAnalysisProvider } from "../src/services/grounded-analysis/provider.js";
import { createAnalystTurnService } from "../src/services/analyst-turn-service.js";
import { createAnalystEvidenceService } from "../src/services/analyst-evidence-service.js";
import type { AnalystProjectionSnapshot } from "../src/services/analyst-evidence-projections.js";
import { createOllamaProviderExtension } from "../src/services/grounded-analysis/ollama-provider-extension.js";
import { createPiGroundedAnalysisSessionFactory } from "../src/services/grounded-analysis/session-factory.js";

const audit = {
  operationId: "operation-1",
  batchId: "batch-1",
  requestId: "request-1",
  feature: "collection-analyst" as const,
  trigger: "owner-request" as const,
  evidenceManifestId: "collection-analyst-manifest",
  evidenceManifestVersion: "v1",
  evidenceClassCounts: [{ evidenceClass: "game-identity-ownership", count: 2 }],
  evidenceIdentityHash: "d".repeat(64),
};

type ExpectedRequest = {
  readonly tools?: readonly string[];
  readonly contains?: readonly string[];
  readonly excludes?: readonly string[];
};

type ScriptStep = {
  readonly expected: ExpectedRequest;
  readonly response: string | { readonly status: number; readonly body: string };
};

type RequestFact = { readonly pathname: string; readonly toolNames: readonly string[] };

const activeSignals = new Set<AbortController>();
const activeFixtures = new Set<ReturnType<typeof scriptedOpenAiServer>>();

afterEach(async () => {
  for (const controller of activeSignals) controller.abort();
  for (const fixture of activeFixtures) await fixture.stop();
});

function toolCall(name: string, args: object, id: string): string {
  return [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
}

function finalText(text: string, finishReason: "stop" | "length" = "stop"): string {
  return [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
}

/**
 * A finite protocol fixture, not an agent simulator. Each HTTP request consumes
 * exactly one declared step. It retains only request facts needed by assertions.
 */
function scriptedOpenAiServer(script: readonly ScriptStep[]) {
  let cursor = 0;
  const failures: string[] = [];
  const requestFacts: RequestFact[] = [];
  let stopped = false;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const step = script[cursor];
      cursor += 1;
      if (step === undefined) {
        if (failures.length === 0) {
          failures.push(`step ${cursor}: unexpected request after script completion`);
          requestFacts.push({ pathname: new URL(request.url).pathname, toolNames: [] });
        }
        return new Response("script mismatch", { status: 400 });
      }
      const body = await request.text();
      const toolNames = [...body.matchAll(/"name":"([^"]+)"/g)].map((match) => match[1] ?? "");
      requestFacts.push({ pathname: new URL(request.url).pathname, toolNames });
      const mismatch =
        [
          ...(step.expected.tools ?? []).filter((name) => !toolNames.includes(name)).map((name) => `missing tool ${name}`),
          ...(step.expected.contains ?? []).filter((value) => !body.includes(value)).map((value) => `missing ${value}`),
          ...(step.expected.excludes ?? []).filter((value) => body.includes(value)).map((value) => `unexpected ${value}`),
        ][0];
      if (mismatch !== undefined) {
        failures.push(`step ${cursor}: ${mismatch}`);
        return new Response("script mismatch", { status: 400 });
      }
      const response = typeof step.response === "string" ? { status: 200, body: step.response } : step.response;
      return new Response(response.body, {
        status: response.status,
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    failures,
    requestFacts,
    async stop() {
      if (stopped) return;
      stopped = true;
      await server.stop(true);
    },
    assertConsumed() {
      expect(failures).toEqual([]);
      expect(cursor).toBe(script.length);
    },
  };
}

function snapshot(): AnalystProjectionSnapshot {
  const source = (suffix: "a" | "b") => ({
    evidenceClass: "game-identity-ownership" as const,
    sourceId: `game-${suffix}`,
    sourceVersion: "1",
    citationId: `citation-${suffix}`,
    payload: { gameId: `game-${suffix}`, displayName: `Game ${suffix.toUpperCase()}`, bggId: null, ownershipState: "owned" },
    canonicalSummary: `Current game ${suffix.toUpperCase()} identity`,
    destination: { operationId: "shelf.game.get" as const, parameters: { gameId: `game-${suffix}` } },
  });
  return { collectionId: "collection", collectionRevision: 1, snapshotFingerprint: "analyst-snapshot", sources: [source("a"), source("b")], page: () => ({ sources: [], nextCursor: null, totalSourceCount: 2 }) };
}

async function runAnalyst(
  script: readonly ScriptStep[],
  after?: (fixture: ReturnType<typeof scriptedOpenAiServer>) => void,
) {
  const fixture = scriptedOpenAiServer(script);
  const controller = new AbortController();
  activeFixtures.add(fixture);
  activeSignals.add(controller);
  try {
    const provider = createGroundedAnalysisProvider({
      configuration: { status: "configured", providerId: "ollama", modelId: "analyst-scripted-test", extensionIds: ["analyst-scripted-test"] },
      sessionFactory: createPiGroundedAnalysisSessionFactory({
        cwd: process.cwd(),
        extensionIds: [],
        extensionFactories: [createOllamaProviderExtension("analyst-scripted-test", 123, fixture.baseUrl)],
      }),
    });
    const result = await createAnalystTurnService({
      provider,
      evidenceService: createAnalystEvidenceService({ storageService: {}, projectionSnapshotService: { capture: () => Promise.resolve(snapshot()) } }),
      log: () => undefined,
    }).run({ systemPrompt: "EXACT POLICY", prompt: "EXACT EVIDENCE", signal: controller.signal, audit });
    return { result, requestFacts: fixture.requestFacts };
  } finally {
    try {
      if (after === undefined) fixture.assertConsumed();
      else after(fixture);
    } finally {
      controller.abort();
      await fixture.stop();
      activeSignals.delete(controller);
      activeFixtures.delete(fixture);
    }
  }
}

describe("Analyst freeform provider protocol", () => {
  test("retrieves evidence then accepts a plain terminal answer without the submission tool", async () => {
    const { result, requestFacts } = await runAnalyst([
      { expected: { tools: ["readGames"] }, response: toolCall("readGames", { gameIds: ["game-a"], fields: ["game-identity-ownership"] }, "read-a") },
      { expected: { excludes: ["submit_grounded_analysis"], contains: ["Game A"] }, response: finalText("analyst-evidence-selected") },
    ]);
    expect(result).toMatchObject({ output: { blocks: [{ text: "analyst-evidence-selected", citationIds: [] }], citations: [] }, usage: { inferenceRoundTrips: 2 } });
    expect(requestFacts).toHaveLength(2);
  });

  test("accepts a direct plain terminal answer without retrieval", async () => {
    const { result } = await runAnalyst([{ expected: { tools: ["readGames"], excludes: ["submit_grounded_analysis"] }, response: finalText("direct-answer") }]);
    expect(result).toMatchObject({ output: { blocks: [{ text: "direct-answer", citationIds: [] }], citations: [] } });
  });

  test("follows two explicit game reads before the terminal answer", async () => {
    const { result } = await runAnalyst([
      { expected: { tools: ["readGames"] }, response: toolCall("readGames", { gameIds: ["game-a"], fields: ["game-identity-ownership"] }, "read-a") },
      { expected: { contains: ["Game A"] }, response: toolCall("readGames", { gameIds: ["game-b"], fields: ["game-identity-ownership"] }, "read-b") },
      { expected: { contains: ["Game B"], excludes: ["submit_grounded_analysis"] }, response: finalText("multipage-answer") },
    ]);
    expect(result).toMatchObject({ output: { blocks: [{ text: "multipage-answer" }] }, retrieved: [{ scope: { matchingSourceCount: 2, exhaustive: true } }] });
  });

  test("returns one finite transport failure for a terminal server error", async () => {
    await expect(runAnalyst([{ expected: {}, response: { status: 400, body: "terminal script error" } }])).rejects.toMatchObject({ reason: "transport" });
  });

  test("turns an unexpected third request into one terminal transport failure", async () => {
    await expect(
      runAnalyst(
        [
          { expected: { tools: ["readGames"] }, response: toolCall("readGames", { gameIds: ["game-a"], fields: ["game-identity-ownership"] }, "read-a") },
          { expected: { contains: ["Game A"] }, response: toolCall("readGames", { gameIds: ["game-b"], fields: ["game-identity-ownership"] }, "read-b") },
        ],
        (fixture) => {
          expect(fixture.failures).toEqual(["step 3: unexpected request after script completion"]);
          expect(fixture.requestFacts).toHaveLength(3);
        },
      ),
    ).rejects.toMatchObject({ reason: "transport" });
  });

  test("rejects an empty terminal answer as no freeform response", async () => {
    await expect(runAnalyst([{ expected: { excludes: ["submit_grounded_analysis"] }, response: finalText("") }])).rejects.toMatchObject({ reason: "output-validation" });
  });

  test("normalizes a length-limited terminal narrative as the final freeform response", async () => {
    const { result } = await runAnalyst([{ expected: { excludes: ["submit_grounded_analysis"] }, response: finalText("partial narrative", "length") }]);
    expect(result).toMatchObject({ output: { blocks: [{ text: "partial narrative", citationIds: [] }] }, usage: { inferenceRoundTrips: 1 } });
  });
});
