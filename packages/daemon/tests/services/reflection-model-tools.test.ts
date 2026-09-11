import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ReflectionGetResultSchema } from "@shelf-judge/shared";
import type { GroundedAnalysisProvider } from "../../src/services/grounded-analysis/provider.js";
import { createGroundedAnalysisProvider } from "../../src/services/grounded-analysis/provider.js";
import { createOllamaProviderExtension } from "../../src/services/grounded-analysis/ollama-provider-extension.js";
import { createPiGroundedAnalysisSessionFactory } from "../../src/services/grounded-analysis/session-factory.js";
import { GROUNDED_SUBMISSION_TOOL_NAME } from "../../src/services/grounded-analysis/structured-submission.js";
import { createTestApp } from "../helpers/test-app.js";

const NOW = "2026-09-10T12:00:00.000Z";
const CAPABILITY = "a".repeat(64);
const unusedContext = new Proxy({} as ExtensionContext, {
  get() {
    throw new Error("Unexpected extension context access");
  },
});

function noteText(index: number): string {
  const prefix = `note-${String(index).padStart(3, "0")}: `;
  return `${prefix}${"x".repeat(200 - Buffer.byteLength(prefix))}`;
}

function request(path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("Reflection model collection tools", () => {
  test("keeps 200 private 200-byte notes lazy until the model selects authorized games", async () => {
    const providerCalls: unknown[] = [];
    let selectedGameIds: string[] = [];
    const provider: GroundedAnalysisProvider = {
      configurationStatus: {
        status: "configured",
        identity: { providerId: "test-provider", modelId: "test-model", extensionIds: [] },
      },
      async analyze(request) {
        providerCalls.push(request);
        expect(request.prompt).not.toContain("note-000");
        const top = request.retrievalTools?.find((tool) => tool.name === "top");
        const summarize = request.retrievalTools?.find((tool) => tool.name === "summarize");
        const readGames = request.retrievalTools?.find((tool) => tool.name === "readGames");
        expect(top).toBeDefined();
        expect(summarize).toBeDefined();
        expect(readGames).toBeDefined();

        await top?.execute(
          "top",
          { rankBy: "fitness", limit: 1 },
          undefined,
          undefined,
          unusedContext,
        );
        await summarize?.execute(
          "summarize",
          { groupBy: "metadata.mechanics", measures: ["gameCount"] },
          undefined,
          undefined,
          unusedContext,
        );
        await readGames?.execute(
          "read",
          { gameIds: selectedGameIds, fields: ["owner-game-note"] },
          undefined,
          undefined,
          unusedContext,
        );
        return {
          output: request.submissionSchema.parse({
            result: {
              outcome: "abstained",
              reason: "incomplete-scope",
              explanation: "The selected evidence does not establish a pattern.",
              supportingBlocks: [],
              noteExcerpts: [],
            },
          }),
          usage: { state: "reported", inferenceRoundTrips: 1, inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const context = createTestApp({ now: () => NOW, groundedAnalysisProvider: provider });
    const originalGet = context.ownerGameNoteService.get.bind(context.ownerGameNoteService);
    const noteReads: string[] = [];
    context.ownerGameNoteService.get = async (gameId: unknown) => {
      if (typeof gameId !== "string") throw new Error("Expected a string game ID");
      noteReads.push(gameId);
      return originalGet(gameId);
    };

    const seed = (await context.gameService.addGame({ name: "Lazy note game 0" })).game;
    const seedText = noteText(0);
    expect(Buffer.byteLength(seedText)).toBe(200);
    expect(
      await context.ownerGameNoteService.set(seed.id, {
        commandId: "32000000-0000-4000-8000-000000000000",
        expectedVersion: 0,
        text: seedText,
      }),
    ).toMatchObject({ ok: true });
    const collection = await context.storageService.loadCollection();
    const template = collection.games[0];
    if (template === undefined) throw new Error("Seed game was not stored");
    const games = Array.from({ length: 200 }, (_, index) => {
      const text = noteText(index);
      expect(Buffer.byteLength(text)).toBe(200);
      return index === 0
        ? template
        : {
            ...template,
            id: crypto.randomUUID(),
            name: `Lazy note game ${index}`,
            ownerNote: { ...template.ownerNote, text },
          };
    });
    await context.storageService.saveCollection({
      ...collection,
      games,
      revision: collection.revision + 1,
    });
    const secondGameId = games[1]?.id;
    if (secondGameId === undefined) throw new Error("Second game was not created");
    expect(
      await context.ownerGameNoteService.set(secondGameId, {
        commandId: "32000000-0000-4000-8000-000000000001",
        expectedVersion: 1,
        text: noteText(1),
      }),
    ).toMatchObject({ ok: true });
    selectedGameIds = [seed.id, secondGameId];

    await context.reflectionRuntime.recover();
    expect(noteReads).toEqual([]);
    expect(providerCalls).toEqual([]);

    const originalLoadCollection = context.storageService.loadCollection.bind(
      context.storageService,
    );
    let projectionCollectionLoads = 0;
    context.storageService.loadCollection = async () => {
      projectionCollectionLoads += 1;
      return originalLoadCollection();
    };

    projectionCollectionLoads = 0;
    const rootStartedAt = performance.now();
    const rootProfile = await context.app.request(request("/api/profile"));
    const rootProfileDurationMs = performance.now() - rootStartedAt;
    const rootProfileCollectionLoads = projectionCollectionLoads;
    expect(rootProfile.status).toBe(200);
    expect(noteReads).toEqual([]);
    expect(providerCalls).toEqual([]);

    projectionCollectionLoads = 0;
    const firstReflectionsStartedAt = performance.now();
    const state = await context.app.request(request("/api/profile/reflections"));
    const firstReflectionsDurationMs = performance.now() - firstReflectionsStartedAt;
    expect(state.status).toBe(200);
    expect(projectionCollectionLoads).toBe(1);
    expect(noteReads).toEqual([]);
    expect(providerCalls).toEqual([]);

    const refresh = await context.app.request(
      request("/api/profile/reflections/refresh", {
        batchId: "32000000-0000-4000-8000-000000000201",
        requestId: "32000000-0000-4000-8000-000000000202",
        cancellationCapability: CAPABILITY,
        questionId: "repeated-values",
        disclosure: {
          version: 1,
          providerId: "test-provider",
          modelId: "test-model",
          acknowledged: true,
        },
      }),
    );
    expect(refresh.status).toBe(200);
    const refreshEvents = await refresh.text();
    expect(refreshEvents).toContain("event: accepted");
    expect(refreshEvents).toContain("event: question-started");
    expect(refreshEvents).toContain("event: question-completed");
    expect(providerCalls).toHaveLength(1);
    expect([...new Set(noteReads)].sort()).toEqual([...selectedGameIds].sort());

    projectionCollectionLoads = 0;
    const readsBeforeCachedState = [...noteReads];
    const cachedReflectionsStartedAt = performance.now();
    const cachedState = await context.app.request(request("/api/profile/reflections"));
    const cachedReflectionsDurationMs = performance.now() - cachedReflectionsStartedAt;
    expect(cachedState.status).toBe(200);
    const cachedQuestions = ReflectionGetResultSchema.parse(await cachedState.json()).questions;
    expect(projectionCollectionLoads).toBe(1);
    expect(noteReads).toEqual(readsBeforeCachedState);
    expect(providerCalls).toHaveLength(1);
    expect(
      cachedQuestions.find(({ questionId }) => questionId === "repeated-values")?.cache.state,
    ).toBe("current");
    console.info(
      "[profile-navigation-fixture]",
      JSON.stringify({
        rootProfileDurationMs,
        firstReflectionsDurationMs,
        cachedReflectionsDurationMs,
        rootProfileCollectionLoads,
        firstReflectionsCollectionLoads: 1,
        cachedReflectionsCollectionLoads: projectionCollectionLoads,
        passiveOwnerNoteReads: noteReads.length - readsBeforeCachedState.length,
        providerCalls: providerCalls.length,
      }),
    );
  });

  test("persists an explicit Reflection refresh after its real evidence result returns through the provider loop", async () => {
    let requests = 0;
    let returnedCitationId: string | undefined;
    const response = (name: string, argumentsValue: object) =>
      [
        `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: `call-${requests}`,
                    type: "function",
                    function: { name, arguments: JSON.stringify(argumentsValue) },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`,
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        })}\n\n`,
        "data: [DONE]\n\n",
      ].join("");
    const server = Bun.serve({
      port: 0,
      async fetch(networkRequest) {
        requests += 1;
        const payload = await networkRequest.text();
        if (requests === 1) {
          expect(payload).toContain('"top"');
          return new Response(response("top", { rankBy: "fitness", limit: 1 }), {
            headers: { "content-type": "text/event-stream" },
          });
        }
        const match = /\\"citationId\\":\\"([^\\]+)\\"/.exec(payload);
        if (match?.[1] === undefined)
          throw new Error("Expected the Reflection tool result citation");
        returnedCitationId = match[1];
        return new Response(
          response(GROUNDED_SUBMISSION_TOOL_NAME, {
            submission: {
              result: {
                outcome: "abstained",
                reason: "incomplete-scope",
                explanation: "The selected collection evidence is insufficient for a pattern.",
                supportingBlocks: [
                  {
                    text: "The selected collection evidence was reviewed.",
                    citationIds: [returnedCitationId],
                  },
                ],
                noteExcerpts: [],
              },
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    try {
      const provider = createGroundedAnalysisProvider({
        configuration: {
          status: "configured",
          providerId: "ollama",
          modelId: "ollama-test",
          extensionIds: ["ollama-test"],
        },
        sessionFactory: createPiGroundedAnalysisSessionFactory({
          cwd: process.cwd(),
          extensionIds: [],
          extensionFactories: [
            createOllamaProviderExtension("ollama-test", 123, `http://127.0.0.1:${server.port}/v1`),
          ],
        }),
      });
      const context = createTestApp({ now: () => NOW, groundedAnalysisProvider: provider });
      await context.gameService.addGame({ name: "Reflection evidence game" });
      await context.reflectionRuntime.recover();

      const refresh = await context.app.request(
        request("/api/profile/reflections/refresh", {
          batchId: "32000000-0000-4000-8000-000000000301",
          requestId: "32000000-0000-4000-8000-000000000302",
          cancellationCapability: CAPABILITY,
          questionId: "repeated-values",
          disclosure: {
            version: 1,
            providerId: "ollama",
            modelId: "ollama-test",
            acknowledged: true,
          },
        }),
      );

      expect(refresh.status).toBe(200);
      expect(await refresh.text()).toContain("event: question-completed");
      expect(requests).toBe(2);
      expect(returnedCitationId).toBeDefined();
      const persisted = await context.reflectionRuntime.storage.loadState();
      const question = persisted.questions.find(
        ({ questionId }) => questionId === "repeated-values",
      );
      expect(question?.cache).not.toBeNull();
      expect(question?.cache).toMatchObject({
        outcome: "abstained",
        supportingBlocks: [{ citationIds: [returnedCitationId] }],
        citations: [{ citationId: returnedCitationId }],
      });
    } finally {
      await server.stop(true);
    }
  });
});
