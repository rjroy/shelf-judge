import { describe, expect, test } from "bun:test";
import type { Game, PlayIntention } from "@shelf-judge/shared";
import { canonicalIntentionMutationCases } from "../../shared/tests/fixtures/intention-mutation";
import {
  changeOwnership,
  correctPlayCount,
  createIntention,
  refreshGameBgg,
  removeGameFromCollection,
  resolveIntention,
} from "@/lib/browser-mutations";

function jsonResponse(body: object, status = 200): Response {
  return Response.json(body, { status });
}

function requestBody(init?: RequestInit): Record<string, string | number> {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
  return JSON.parse(init.body) as Record<string, string | number>;
}

const observedAt = "2026-08-28T10:00:00.000Z";

function game(id = "game-1", ownership: Game["ownership"] = "owned"): Game {
  const metadata = {
    state: "unrefreshable" as const,
    entities: [],
    observedAt: null,
    refreshFailure: null,
    correctionDestination: null,
    explanation: "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata." as const,
  };
  return {
    id,
    bggId: null,
    name: "Mutation Game",
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: 0,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "valid", value: 0, source: "manual", observedAt },
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
    entityMetadata: { mechanic: metadata, designer: metadata, artist: metadata },
    latestPlayCountCheck: null,
    ownership,
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: observedAt,
    updatedAt: observedAt,
  };
}

function intention(overrides: Partial<PlayIntention> = {}): PlayIntention {
  return {
    intentionId: "intention-1",
    gameId: "game-1",
    kind: "first-play",
    baseline: { playCount: 0, evidenceSource: "manual", observedAt },
    createdAt: "2026-08-28T10:01:00.000Z",
    version: 1,
    resolution: null,
    ...overrides,
  };
}

async function rejection(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to reject");
}

describe("browser mutation boundaries", () => {
  test.each([...canonicalIntentionMutationCases])(
    "preserves canonical $label through browser request validation",
    async ({ command, result: fixture, status }) => {
      const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
      const fetcher = (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ input, init });
        return Promise.resolve(jsonResponse(structuredClone(fixture), status));
      };
      const result =
        command.type === "create"
          ? await createIntention(command.gameId, command.kind, fetcher, () => command.commandId)
          : await resolveIntention(
              command.gameId,
              command.intentionId,
              command.expectedVersion,
              command.type,
              fetcher,
              () => command.commandId,
            );

      expect(result).toEqual(fixture);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.input).toBe(
        command.type === "create"
          ? `/api/daemon/games/${command.gameId}/intention`
          : `/api/daemon/games/${command.gameId}/intention/${command.intentionId}/${command.type}`,
      );
      expect(requestBody(requests[0]?.init)).toEqual(
        command.type === "create"
          ? {
              commandId: command.commandId,
              kind: command.kind,
              expectedActiveIntention: command.expectedActiveIntention,
            }
          : { commandId: command.commandId, expectedVersion: command.expectedVersion },
      );
    },
  );

  test("sends one create request and runtime-validates the shared result", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, init });
      const request = requestBody(init);
      return Promise.resolve(
        jsonResponse(
          {
            ok: false,
            commandId: request.commandId,
            error: {
              code: "ineligible-game",
              gameId: "game-1",
              reason: "stale-play-evidence",
            },
          },
          400,
        ),
      );
    };
    const result = await createIntention("game-1", "first-play", fetcher);
    expect(result.ok).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe("/api/daemon/games/game-1/intention");
    expect(requestBody(requests[0]?.init)).toMatchObject({
      kind: "first-play",
      expectedActiveIntention: "absent",
    });
  });

  test("sends intention identity and expected version once for resolution", async () => {
    const requests: RequestInit[] = [];
    const fetcher = (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init !== undefined) requests.push(init);
      const request = requestBody(init);
      return Promise.resolve(
        jsonResponse(
          {
            ok: false,
            commandId: request.commandId,
            error: {
              code: "stale-version",
              gameId: "game-1",
              intentionId: "intention-1",
              expectedVersion: 3,
              current: {
                intentionId: "intention-1",
                gameId: "game-1",
                kind: "replay",
                baseline: {
                  playCount: 2,
                  evidenceSource: "manual",
                  observedAt: "2026-08-28T09:00:00.000Z",
                },
                createdAt: "2026-08-28T10:00:00.000Z",
                version: 1,
                resolution: null,
              },
            },
          },
          409,
        ),
      );
    };
    await resolveIntention("game-1", "intention-1", 3, "retire", fetcher);
    expect(requests).toHaveLength(1);
    expect(requestBody(requests[0])).toMatchObject({ expectedVersion: 3 });
  });

  test("parses play field errors and does not issue a validation probe", async () => {
    let calls = 0;
    const result = await correctPlayCount("game-1", 4, () => {
      calls += 1;
      return Promise.resolve(
        jsonResponse(
          {
            code: "validation",
            issues: [{ field: "playCount", message: "Must be a safe integer" }],
          },
          400,
        ),
      );
    });
    expect(calls).toBe(1);
    expect("code" in result && result.code).toBe("validation");
  });

  test("renders the shared deletion history conflict without another request", async () => {
    let calls = 0;
    const result = await removeGameFromCollection("game-1", () => {
      calls += 1;
      return Promise.resolve(
        jsonResponse(
          {
            code: "history-conflict",
            gameId: "game-1",
            intentionIds: ["intention-1"],
          },
          409,
        ),
      );
    });
    expect(calls).toBe(1);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "history-conflict",
        gameId: "game-1",
        intentionIds: ["intention-1"],
      },
    });
  });

  test("rejects malformed ownership results after exactly one request", async () => {
    let calls = 0;
    expect(
      await rejection(() =>
        changeOwnership("game-1", "previously-owned", () => {
          calls += 1;
          return Promise.resolve(
            jsonResponse({ game: { id: "game-1" }, linkedIntentionTransition: null }),
          );
        }),
      ),
    ).toBeInstanceOf(Error);
    expect(calls).toBe(1);
  });

  test("rejects schema-valid intention results that do not match the exact command", async () => {
    let calls = 0;
    const mismatchedCreate = await rejection(() =>
      createIntention("game-1", "first-play", () => {
        calls += 1;
        return Promise.resolve(
          jsonResponse({
            ok: true,
            commandId: "30000000-0000-4000-8000-000000000099",
            intention: intention(),
            linkedOwnershipTransition: null,
          }),
        );
      }),
    );
    expect(mismatchedCreate).toBeInstanceOf(Error);
    expect(calls).toBe(1);

    calls = 0;
    const mismatchedCreatedIntention = await rejection(() =>
      createIntention("game-1", "first-play", (_input, init) => {
        calls += 1;
        const request = requestBody(init);
        return Promise.resolve(
          jsonResponse({
            ok: true,
            commandId: request.commandId,
            intention: intention({
              gameId: "game-2",
              kind: "replay",
              baseline: { playCount: 2, evidenceSource: "manual", observedAt },
            }),
            linkedOwnershipTransition: null,
          }),
        );
      }),
    );
    expect(mismatchedCreatedIntention).toBeInstanceOf(Error);
    expect(calls).toBe(1);

    calls = 0;
    const mismatchedConflict = await rejection(() =>
      resolveIntention("game-1", "intention-1", 1, "retire", (_input, init) => {
        calls += 1;
        const request = requestBody(init);
        return Promise.resolve(
          jsonResponse(
            {
              ok: false,
              commandId: request.commandId,
              error: {
                code: "stale-version",
                gameId: "game-1",
                intentionId: "other-intention",
                expectedVersion: 1,
                current: intention({ intentionId: "other-intention" }),
              },
            },
            409,
          ),
        );
      }),
    );
    expect(mismatchedConflict).toBeInstanceOf(Error);
    expect(calls).toBe(1);

    calls = 0;
    const wrongOutcome = await rejection(() =>
      resolveIntention("game-1", "intention-1", 1, "complete", (_input, init) => {
        calls += 1;
        const request = requestBody(init);
        return Promise.resolve(
          jsonResponse({
            ok: true,
            commandId: request.commandId,
            intention: intention({
              version: 2,
              resolution: {
                outcome: "retired",
                source: "owner-retired",
                resolvedAt: "2026-08-28T10:02:00.000Z",
              },
            }),
            linkedOwnershipTransition: null,
          }),
        );
      }),
    );
    expect(wrongOutcome).toBeInstanceOf(Error);
    expect(calls).toBe(1);
  });

  test("rejects schema-valid game mutation results for another request", async () => {
    let calls = 0;
    expect(
      await rejection(() =>
        changeOwnership("game-1", "previously-owned", () => {
          calls += 1;
          return Promise.resolve(
            jsonResponse({
              game: game("game-2", "previously-owned"),
              linkedIntentionTransition: null,
            }),
          );
        }),
      ),
    ).toBeInstanceOf(Error);
    expect(calls).toBe(1);

    calls = 0;
    expect(
      await rejection(() =>
        refreshGameBgg("game-1", () => {
          calls += 1;
          return Promise.resolve(
            jsonResponse({ game: game("game-2"), linkedIntentionTransition: null }),
          );
        }),
      ),
    ).toBeInstanceOf(Error);
    expect(calls).toBe(1);

    calls = 0;
    expect(
      await rejection(() =>
        correctPlayCount("game-1", 0, () => {
          calls += 1;
          return Promise.resolve(
            jsonResponse({
              ok: false,
              error: {
                code: "non-monotonic-observation",
                gameId: "game-2",
                attemptedObservedAt: "2026-08-28T10:00:00.000Z",
                latestAcceptedAt: "2026-08-28T11:00:00.000Z",
              },
            }),
          );
        }),
      ),
    ).toBeInstanceOf(Error);
    expect(calls).toBe(1);

    calls = 0;
    expect(
      await rejection(() =>
        removeGameFromCollection("game-1", () => {
          calls += 1;
          return Promise.resolve(
            jsonResponse(
              { code: "history-conflict", gameId: "game-2", intentionIds: ["intention-1"] },
              409,
            ),
          );
        }),
      ),
    ).toBeInstanceOf(Error);
    expect(calls).toBe(1);
  });

  test("accepts coherent ownership, refresh, and play results after one request each", async () => {
    let ownershipCalls = 0;
    const ownership = await changeOwnership("game-1", "previously-owned", () => {
      ownershipCalls += 1;
      return Promise.resolve(
        jsonResponse({ game: game("game-1", "previously-owned"), linkedIntentionTransition: null }),
      );
    });
    expect(ownership.game.id).toBe("game-1");
    expect(ownershipCalls).toBe(1);

    let refreshCalls = 0;
    const refresh = await refreshGameBgg("game-1", () => {
      refreshCalls += 1;
      return Promise.resolve(jsonResponse({ game: game(), linkedIntentionTransition: null }));
    });
    expect(refresh.game.id).toBe("game-1");
    expect(refreshCalls).toBe(1);

    let playCalls = 0;
    const play = await correctPlayCount("game-1", 0, () => {
      playCalls += 1;
      return Promise.resolve(
        jsonResponse({ ok: true, game: game(), linkedIntentionTransition: null }),
      );
    });
    expect("ok" in play && play.ok).toBe(true);
    expect(playCalls).toBe(1);
  });
});
