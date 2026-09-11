import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ReflectionGetResultSchema } from "@shelf-judge/shared";
import type { GroundedAnalysisProvider } from "../../src/services/grounded-analysis/provider.js";
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
    expect(cachedQuestions.find(({ questionId }) => questionId === "repeated-values")?.cache.state).not.toBe(
      "none",
    );
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
});
