import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GroundedAnalysisProvider } from "../../src/services/grounded-analysis/provider.js";
import { createGroundedAnalysisProvider } from "../../src/services/grounded-analysis/provider.js";
import { createOllamaProviderExtension } from "../../src/services/grounded-analysis/ollama-provider-extension.js";
import { createPiGroundedAnalysisSessionFactory } from "../../src/services/grounded-analysis/session-factory.js";
import { GROUNDED_SUBMISSION_TOOL_NAME } from "../../src/services/grounded-analysis/structured-submission.js";
import { createTestApp } from "../helpers/test-app.js";

const NOW = "2026-09-10T12:00:00.000Z";
const CAPABILITY = "a".repeat(64);
const fixtureGameNames = [
  "Selected reflection game",
  "Second selected reflection game",
  "Unselected reflection game",
];
const fixtureOwnerNotes = [
  "Private selected owner note",
  "Private second owner note",
  "Private unselected owner note",
];
const unusedContext = new Proxy({} as ExtensionContext, {
  get() {
    throw new Error("Unexpected extension context access");
  },
});

function request(path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("Reflection model collection tools", () => {
  test("keeps collection and notes private until selected authorized games are retrieved", async () => {
    const providerCalls: unknown[] = [];
    let selectedGameIds: string[] = [];
    const provider: GroundedAnalysisProvider = {
      configurationStatus: {
        status: "configured",
        identity: { providerId: "test-provider", modelId: "test-model", extensionIds: [] },
      },
      async analyze(request) {
        providerCalls.push(request);
        for (const value of [...fixtureGameNames, ...fixtureOwnerNotes])
          expect(request.prompt).not.toContain(value);
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
        expect(noteReads).toEqual([]);
        await summarize?.execute(
          "summarize",
          { groupBy: "metadata.mechanics", measures: ["gameCount"] },
          undefined,
          undefined,
          unusedContext,
        );
        expect(noteReads).toEqual([]);
        const readGamesResult = await readGames?.execute(
          "read",
          { gameIds: selectedGameIds, fields: ["owner-game-note"] },
          undefined,
          undefined,
          unusedContext,
        );
        const readGamesContent = readGamesResult?.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        expect(readGamesContent).toContain(fixtureOwnerNotes[0]);
        expect(readGamesContent).toContain(fixtureOwnerNotes[1]);
        expect(readGamesContent).not.toContain(fixtureOwnerNotes[2]);
        const output = request.submissionSchema.parse({
          result: {
            outcome: "abstained",
            reason: "incomplete-scope",
            explanation: "The selected evidence does not establish a pattern.",
            supportingBlocks: [],
            noteExcerpts: [],
          },
        });
        const usage = {
          state: "reported" as const,
          inferenceRoundTrips: 1,
          inputTokens: 1,
          outputTokens: 1,
        };
        await request.acceptSubmission?.(output, usage);
        return { output, usage };
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

    const seed = (await context.gameService.addGame({ name: fixtureGameNames[0] })).game;
    expect(
      await context.ownerGameNoteService.set(seed.id, {
        commandId: "32000000-0000-4000-8000-000000000000",
        expectedVersion: 0,
        text: fixtureOwnerNotes[0],
      }),
    ).toMatchObject({ ok: true });
    const collection = await context.storageService.loadCollection();
    const template = collection.games[0];
    if (template === undefined) throw new Error("Seed game was not stored");
    const secondGame = {
      ...template,
      id: crypto.randomUUID(),
      name: fixtureGameNames[1],
      ownerNote: { ...template.ownerNote, text: fixtureOwnerNotes[1] },
    };
    const unselectedGame = {
      ...template,
      id: crypto.randomUUID(),
      name: fixtureGameNames[2],
      ownerNote: { ...template.ownerNote, text: fixtureOwnerNotes[2] },
    };
    const games = [template, secondGame, unselectedGame];
    await context.storageService.saveCollection({
      ...collection,
      games,
      revision: collection.revision + 1,
    });
    const secondGameId = secondGame.id;
    expect(
      await context.ownerGameNoteService.set(secondGameId, {
        commandId: "32000000-0000-4000-8000-000000000001",
        expectedVersion: 1,
        text: fixtureOwnerNotes[1],
      }),
    ).toMatchObject({ ok: true });
    selectedGameIds = [seed.id, secondGameId];

    await context.reflectionRuntime.recover();
    expect(noteReads).toEqual([]);
    expect(providerCalls).toEqual([]);

    const rootProfile = await context.app.request(request("/api/profile"));
    expect(rootProfile.status).toBe(200);
    expect(noteReads).toEqual([]);
    expect(providerCalls).toEqual([]);

    const state = await context.app.request(request("/api/profile/reflections"));
    expect(state.status).toBe(200);
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

    const noteReadsAfterRefresh = [...noteReads];
    const providerCallsAfterRefresh = providerCalls.length;
    const cachedState = await context.app.request(request("/api/profile/reflections"));
    expect(cachedState.status).toBe(200);
    expect(noteReads).toEqual(noteReadsAfterRefresh);
    expect(providerCalls).toHaveLength(providerCallsAfterRefresh);
  });

  test.each([
    { outcome: "answered" as const, expectedRequests: 2, expectedRoundTrips: 2 },
    { outcome: "abstained" as const, expectedRequests: 3, expectedRoundTrips: 3 },
  ])(
    "persists an $outcome Reflection from real discovery and submission tools",
    async ({ outcome, expectedRequests, expectedRoundTrips }) => {
      let requests = 0;
      let returnedCitationId: string | undefined;
      const response = (name: string, argumentsValue: object, narration?: string) =>
        [
          `data: ${JSON.stringify({
            choices: [
              {
                index: 0,
                delta: {
                  ...(narration === undefined ? {} : { content: narration }),
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
            expect(payload).toContain("any accompanying assistant narration is ignored");
            expect(payload).toContain("submit_grounded_analysis");
            return new Response(
              response("top", { rankBy: "fitness", limit: 1 }, "Reviewing evidence."),
              { headers: { "content-type": "text/event-stream" } },
            );
          }
          const match = /\\"citationId\\":\\"([^\\]+)\\"/.exec(payload);
          if (match?.[1] === undefined)
            throw new Error("Expected the Reflection tool result citation");
          returnedCitationId = match[1];
          const submission =
            outcome === "abstained" && requests === 2
              ? {
                  result: {
                    outcome: "abstained",
                    reason: "no-owner-testimony",
                    explanation: "The selected evidence contains no owner testimony.",
                    supportingBlocks: [
                      { text: "Invalid first reference.", citationIds: ["unknown-citation"] },
                    ],
                    noteExcerpts: [],
                  },
                }
              : outcome === "answered"
                ? {
                    result: {
                      outcome: "answered",
                      centralSynthesis: {
                        text: "The selected game is the strongest current example.",
                        citationIds: [returnedCitationId],
                      },
                      supportingBlocks: [
                        {
                          text: "The canonical collection record supports the answer.",
                          citationIds: [returnedCitationId],
                        },
                      ],
                      noteExcerpts: [],
                    },
                  }
                : {
                    result: {
                      outcome: "abstained",
                      reason: "no-owner-testimony",
                      explanation: "The selected evidence contains no owner testimony.",
                      supportingBlocks: [
                        {
                          text: "The selected collection evidence was reviewed.",
                          citationIds: [returnedCitationId],
                        },
                      ],
                      noteExcerpts: [],
                    },
                  };
          return new Response(response(GROUNDED_SUBMISSION_TOOL_NAME, { submission }), {
            headers: { "content-type": "text/event-stream" },
          });
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
              createOllamaProviderExtension(
                "ollama-test",
                123,
                `http://127.0.0.1:${server.port}/v1`,
              ),
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
        expect(requests).toBe(expectedRequests);
        expect(returnedCitationId).toBeDefined();
        const persisted = await context.reflectionRuntime.storage.loadState();
        const question = persisted.questions.find(
          ({ questionId }) => questionId === "repeated-values",
        );
        expect(question?.cache).not.toBeNull();
        expect(question?.cache).toMatchObject({
          outcome,
          supportingBlocks: [{ citationIds: [returnedCitationId] }],
          citations: [{ citationId: returnedCitationId }],
          usage: { state: "reported", inferenceRoundTrips: expectedRoundTrips },
        });
        if (outcome === "abstained") {
          expect(question?.cache).toMatchObject({ reason: "no-owner-testimony" });
        }
      } finally {
        await server.stop(true);
      }
    },
  );
});
