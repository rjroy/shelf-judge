import { describe, test, expect } from "bun:test";
import { canonicalIntentionMutationCases } from "../../../shared/tests/fixtures/intention-mutation.js";
import {
  gameSearch,
  gameAdd,
  gameList,
  gameRate,
  gameRemove,
  parseRateArgs,
  gameAssignShelf,
  gameClearShelf,
  gameAcquisition,
  gameValue,
  gameIntentionSet,
  gameIntentionResolve,
  gamePlaysSet,
  gameNoteGet,
  gameNoteSet,
  gameNoteClear,
} from "../../src/commands/game.js";
import {
  calculatePurchaseUtilization,
  createInitialEntityMetadata,
  type Acquisition,
  type Game,
  type IntentionMutationResult,
  type PlayIntention,
  type PurchaseUtilizationInput,
} from "@shelf-judge/shared";
import { createMockClient } from "../helpers/mock-client.js";
import { StructuredCliError, formatCliError } from "../../src/errors.js";

async function expectThrows(fn: () => Promise<unknown>, match: string): Promise<void> {
  const noError = Symbol("no error");
  let caught: unknown = noError;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  if (caught === noError) {
    throw new Error(`Expected function to throw matching "${match}" but it did not throw`);
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toContain(match);
}

describe("game search", () => {
  const searchData = [{ id: 266192, name: "Wingspan", yearPublished: 2019 }];
  const client = createMockClient({
    routes: {
      "GET /api/games/search?q=wingspan": {
        response: { ok: true, status: 200, data: searchData },
      },
    },
  });

  test("human-readable output has headers and data", async () => {
    const output = await gameSearch(client, ["wingspan"], { json: false });
    expect(output).toContain("BGG ID");
    expect(output).toContain("Name");
    expect(output).toContain("Year");
    expect(output).toContain("266192");
    expect(output).toContain("Wingspan");
    expect(output).toContain("2019");
  });

  test("--json outputs parseable JSON array", async () => {
    const output = await gameSearch(client, ["wingspan"], { json: true });
    const parsed = JSON.parse(output) as Array<{ id: number; name: string }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe(266192);
  });
});

describe("game add (by bggId)", () => {
  const addData = {
    game: { id: "abc-123", name: "Wingspan", bggId: 266192 },
    bggImported: true,
  };
  const client = createMockClient({
    routes: {
      "POST /api/games": {
        response: { ok: true, status: 201, data: addData },
      },
    },
  });

  test("human-readable output shows Added: Wingspan", async () => {
    const output = await gameAdd(client, [], { json: false, bggId: 266192 });
    expect(output).toContain("Added: Wingspan");
  });

  test("--json outputs parseable JSON", async () => {
    const output = await gameAdd(client, [], { json: true, bggId: 266192 });
    const parsed = JSON.parse(output) as { game: { name: string }; bggImported: boolean };
    expect(parsed.game.name).toBe("Wingspan");
    expect(parsed.bggImported).toBe(true);
  });
});

describe("game add (by name)", () => {
  const addData = {
    game: { id: "def-456", name: "Custom Game", bggId: null },
    bggImported: false,
  };
  const client = createMockClient({
    routes: {
      "POST /api/games": {
        response: { ok: true, status: 201, data: addData },
      },
    },
  });

  test("human-readable output shows Added: Custom Game", async () => {
    const output = await gameAdd(client, [], { json: false, name: "Custom Game" });
    expect(output).toContain("Added: Custom Game");
  });

  test("--json outputs parseable JSON", async () => {
    const output = await gameAdd(client, [], { json: true, name: "Custom Game" });
    const parsed = JSON.parse(output) as { game: { name: string }; bggImported: boolean };
    expect(parsed.game.name).toBe("Custom Game");
    expect(parsed.bggImported).toBe(false);
  });
});

describe("game list", () => {
  const listData = [
    {
      game: { id: "abc-123", name: "Wingspan", yearPublished: 2019 },
      score: { score: 7.95 },
      displayScore: "8.0",
    },
    {
      game: { id: "def-456", name: "Unrated Game", yearPublished: null },
      score: null,
      displayScore: null,
    },
  ];
  const client = createMockClient({
    routes: {
      "GET /api/games": {
        response: { ok: true, status: 200, data: listData },
      },
    },
  });

  test("human-readable table has ID, Name, Year, Score columns", async () => {
    const output = await gameList(client, [], { json: false });
    expect(output).toContain("ID");
    expect(output).toContain("Name");
    expect(output).toContain("Year");
    expect(output).toContain("Score");
    expect(output).toContain("Wingspan");
    expect(output).toContain("Unrated Game");
    expect(output).toContain("8.0");
    expect(output).not.toContain("7.95");
  });

  test("--json outputs parseable JSON array", async () => {
    const output = await gameList(client, [], { json: true });
    const parsed = JSON.parse(output) as Array<{
      game: { name: string };
      score: { score: number } | null;
    }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].game.name).toBe("Wingspan");
    expect(parsed[1].score).toBeNull();
  });
});

describe("game acquisition", () => {
  const cases: Array<[string, string | undefined, Acquisition, string]> = [
    ["unknown", undefined, { state: "unknown" }, "acquisition is unknown"],
    ["gift", undefined, { state: "gift" }, "gift with no owner cost"],
    [
      "purchase",
      "0.00",
      {
        state: "purchase",
        amount: { hundredths: 0, source: "manual", confirmedAt: "2026-08-26T12:00:00Z" },
      },
      "zero-cost purchase",
    ],
    [
      "purchase",
      "060.00",
      {
        state: "purchase",
        amount: { hundredths: 6000, source: "manual", confirmedAt: "2026-08-26T12:00:00Z" },
      },
      "lifetime landed cost recorded as $60.00",
    ],
  ];
  test.each(cases)("sends and renders %s", async (state, amount, acquisition, expected) => {
    const response = { game: { id: "game/1", name: "Example", acquisition } };
    const client = createMockClient({
      routes: {
        "PUT /api/games/game%2F1/acquisition": {
          response: { ok: true, status: 200, data: response },
        },
      },
    });
    const originalPut = client.put.bind(client);
    let sentBody: unknown;
    client.put = <T>(path: string, body?: unknown) => {
      sentBody = body;
      return originalPut<T>(path, body);
    };
    const args = amount === undefined ? ["game/1", state] : ["game/1", state, amount];
    const output = await gameAcquisition(client, args, { json: false });
    expect(sentBody).toEqual(amount === undefined ? { state } : { state, amount });
    expect(output).toContain(expected);
    expect(JSON.parse(await gameAcquisition(client, args, { json: true }))).toEqual(response);
  });

  const invalidArgumentCases: Array<[string[]]> = [
    [[]],
    [["game-1"]],
    [["game-1", "other"]],
    [["game-1", "purchase"]],
    [["game-1", "unknown", "1"]],
    [["game-1", "gift", "1"]],
    [["game-1", "purchase", "1", "extra"]],
  ];
  test.each(invalidArgumentCases)("rejects invalid local argument shape %#", async (args) => {
    await expectThrows(() => gameAcquisition(createMockClient(), args, { json: false }), "Usage");
  });

  test.each(["1.234", "-1", "not-an-amount"])(
    "passes daemon-invalid amount %s through unchanged and surfaces its error",
    async (amount) => {
      const client = createMockClient({
        routes: {
          "PUT /api/games/game-1/acquisition": {
            response: { ok: false, status: 400, data: { error: `Invalid amount: ${amount}` } },
          },
        },
      });
      const originalPut = client.put.bind(client);
      let body: unknown;
      client.put = <T>(path: string, nextBody?: unknown) => {
        body = nextBody;
        return originalPut<T>(path, nextBody);
      };
      await expectThrows(
        () => gameAcquisition(client, ["game-1", "purchase", amount], { json: false }),
        `Invalid amount: ${amount}`,
      );
      expect(body).toEqual({ state: "purchase", amount });
    },
  );

  test.each([
    [404, "Game not found"],
    [500, "Internal server error"],
  ])("surfaces daemon error %s", async (status, message) => {
    const client = createMockClient({
      routes: {
        "PUT /api/games/missing/acquisition": {
          response: { ok: false, status, data: { error: message } },
        },
      },
    });
    await expectThrows(
      () => gameAcquisition(client, ["missing", "gift"], { json: false }),
      message,
    );
  });
});

const observedAt = "2026-08-26T12:00:00Z";
function utilizationInput(
  overrides: Partial<PurchaseUtilizationInput> = {},
): PurchaseUtilizationInput {
  return {
    acquisition: {
      state: "purchase",
      amount: { hundredths: 6000, source: "manual", confirmedAt: observedAt },
    },
    entertainmentBenchmark: {
      state: "configured",
      amount: { hundredths: 800, source: "manual", confirmedAt: observedAt },
    },
    playCount: { status: "valid", value: 10, source: "bgg-collection", observedAt },
    duration: { status: "valid", value: 90, source: "bgg-thing", observedAt },
    playerRange: {
      status: "valid",
      value: { minPlayers: 4, maxPlayers: 4 },
      source: "bgg-player-range",
      observedAt,
    },
    suggestedPlayerPoll: {
      status: "valid",
      state: "usable",
      buckets: [{ playerCount: "4", best: 10, recommended: 2, notRecommended: 1 }],
      source: "bgg-suggested-player-poll",
      observedAt,
    },
    fitness: "6.0",
    ...overrides,
  };
}

function valueResponse(input: PurchaseUtilizationInput, ownership = "owned") {
  return {
    game: {
      ...correctionGame(),
      id: "game/1",
      name: "Canonical Example",
      ownership,
      ownerNote: {
        state: "present" as const,
        version: 1,
        updatedAt: observedAt,
        text: "PRIVATE OWNER NOTE",
      },
    },
    score: null,
    displayScore: input.fitness,
    purchaseUtilization: calculatePurchaseUtilization(input),
    intentions: { activeIntention: null, resolvedHistory: [] },
  };
}

describe("game value", () => {
  test("requests predicted enriched detail, renders the canonical $60 example, and retains full JSON", async () => {
    const response = valueResponse(utilizationInput());
    const client = createMockClient({
      routes: {
        "GET /api/games/game%2F1?includePredicted=true": {
          response: { ok: true, status: 200, data: response },
        },
      },
    });
    const human = await gameValue(client, ["game/1"], { json: false });
    expect(human).toContain("Value threshold met");
    expect(human).toContain("Fitness: 6.0");
    expect(human).toContain("60 player-hours");
    expect(human).toContain("$1.00");
    expect(human).toContain("8.00x");
    expect(human).toContain("$0.00");
    expect(human).toContain(
      "Value remaining is the purchase cost not yet justified by modeled entertainment use; it is not cash value.",
    );
    expect(human).toContain("The estimate rounds up to a whole play.");
    expect(human).toContain(`source=bgg-collection; observedAt=${observedAt}`);
    expect(human).toContain(`confirmedAt=${observedAt}`);
    expect(human).toContain(response.purchaseUtilization.assumptions.futurePlays);
    const json = JSON.parse(await gameValue(client, ["game/1"], { json: true })) as Record<
      string,
      unknown
    >;
    expect(json).not.toHaveProperty("intentions");
    expect(json.game).not.toHaveProperty("ownerNote");
    expect(JSON.stringify(json)).not.toContain("PRIVATE OWNER NOTE");
  });

  test("renders the canonical $20 example without recalculating daemon displays", async () => {
    const response = valueResponse(
      utilizationInput({
        acquisition: {
          state: "purchase",
          amount: { hundredths: 2000, source: "manual", confirmedAt: observedAt },
        },
        playCount: { status: "valid", value: 2, source: "bgg-collection", observedAt },
        duration: { status: "valid", value: 30, source: "bgg-thing", observedAt },
        playerRange: {
          status: "valid",
          value: { minPlayers: 2, maxPlayers: 2 },
          source: "bgg-player-range",
          observedAt,
        },
        suggestedPlayerPoll: {
          status: "valid",
          state: "usable",
          buckets: [{ playerCount: "2", best: 3, recommended: 0, notRecommended: 0 }],
          source: "bgg-suggested-player-poll",
          observedAt,
        },
      }),
    );
    const client = createMockClient({
      routes: {
        "GET /api/games/game-1?includePredicted=true": {
          response: { ok: true, status: 200, data: response },
        },
      },
    });
    const output = await gameValue(client, ["game-1"], { json: false });
    expect(output).toContain("Value threshold not yet met");
    expect(output).toContain("0.80x");
    expect(output).toContain("$4.00");
    expect(output).toMatch(/Estimated additional plays[^\n]*1/);
  });

  test.each([
    ["unknown acquisition", { acquisition: { state: "unknown" } }, "missing-acquisition"],
    [
      "invalid acquisition",
      {
        acquisition: {
          state: "invalid",
          evidence: { presence: "present", value: { amount: "bad" } },
        },
      },
      "invalid-acquisition",
    ],
    ["gift", { acquisition: { state: "gift" } }, "no-owner-cost"],
    [
      "zero-cost purchase",
      {
        acquisition: {
          state: "purchase",
          amount: { hundredths: 0, source: "manual", confirmedAt: observedAt },
        },
      },
      "no-owner-cost",
    ],
    ["missing benchmark", { entertainmentBenchmark: null }, "missing-benchmark"],
    [
      "invalid benchmark",
      {
        entertainmentBenchmark: {
          state: "invalid",
          evidence: { presence: "present", value: "bad" },
        },
      },
      "invalid-benchmark",
    ],
    [
      "zero plays",
      { playCount: { status: "valid", value: 0, source: "bgg-collection", observedAt } },
      "Recorded plays are exactly zero",
    ],
    ["fitness zero", { fitness: "0.0" }, "Current fitness is 0"],
    ["missing fitness", { fitness: null }, "missing-fitness"],
    ["invalid fitness", { fitness: "invalid" }, "invalid-fitness"],
    [
      "missing duration",
      { duration: { status: "missing", source: "legacy-unknown", observedAt: null } },
      "missing-modeled-duration",
    ],
    [
      "invalid duration",
      {
        duration: {
          status: "invalid",
          evidence: { presence: "present", value: -1 },
          source: "legacy-unknown",
          observedAt: null,
        },
      },
      "invalid-modeled-duration",
    ],
    [
      "missing player count",
      {
        playerRange: { status: "missing", source: "legacy-unknown", observedAt: null },
        suggestedPlayerPoll: {
          status: "valid",
          state: "absent",
          buckets: [],
          source: "bgg-suggested-player-poll",
          observedAt,
        },
      },
      "missing-modeled-player-count",
    ],
  ])("explains %s", async (_name, overrides, expected) => {
    const response = valueResponse(
      utilizationInput(overrides as Partial<PurchaseUtilizationInput>),
    );
    const client = createMockClient({
      routes: {
        "GET /api/games/game-1?includePredicted=true": {
          response: { ok: true, status: 200, data: response },
        },
      },
    });
    expect(await gameValue(client, ["game-1"], { json: false })).toContain(expected);
  });

  const evidenceCases: Array<[string, Partial<PurchaseUtilizationInput>, string[]]> = [
    [
      "missing play count",
      {
        playCount: { status: "missing", source: "bgg-collection", observedAt },
      },
      [
        "Recorded play count is unavailable. [missing-play-count]",
        `Recorded plays: missing; source=bgg-collection; observedAt=${observedAt}`,
      ],
    ],
    [
      "invalid play count",
      {
        playCount: {
          status: "invalid",
          evidence: { presence: "present", value: "not-a-count" },
          source: "bgg-collection",
          observedAt,
        },
      },
      [
        "Recorded play count is invalid. [invalid-play-count]",
        `Recorded plays: invalid, evidence={"presence":"present","value":"not-a-count"}; source=bgg-collection; observedAt=${observedAt}`,
      ],
    ],
    [
      "invalid modeled player count",
      {
        playerRange: {
          status: "invalid",
          evidence: {
            minPlayers: { presence: "present", value: 4 },
            maxPlayers: { presence: "present", value: 2 },
          },
          source: "bgg-player-range",
          observedAt,
        },
        suggestedPlayerPoll: {
          status: "valid",
          state: "absent",
          buckets: [],
          source: "bgg-suggested-player-poll",
          observedAt,
        },
      },
      [
        "Modeled player-count evidence is invalid. [invalid-modeled-player-count]",
        `Published player range: invalid, evidence={"minPlayers":{"presence":"present","value":4},"maxPlayers":{"presence":"present","value":2}}; source=bgg-player-range; observedAt=${observedAt}`,
      ],
    ],
  ];
  test.each(evidenceCases)(
    "renders factual evidence and reasons for %s",
    async (_name, overrides, expectedLines) => {
      const response = valueResponse(utilizationInput(overrides));
      const client = createMockClient({
        routes: {
          "GET /api/games/game-1?includePredicted=true": {
            response: { ok: true, status: 200, data: response },
          },
        },
      });

      const output = await gameValue(client, ["game-1"], { json: false });
      for (const expectedLine of expectedLines) {
        expect(output).toContain(expectedLine);
      }
    },
  );

  test("renders fitness-zero additional plays as unreachable", async () => {
    const response = valueResponse(utilizationInput({ fitness: "0.0" }));
    const client = createMockClient({
      routes: {
        "GET /api/games/game-1?includePredicted=true": {
          response: { ok: true, status: 200, data: response },
        },
      },
    });
    const output = await gameValue(client, ["game-1"], { json: false });
    expect(output).toContain("Unreachable at current fitness");
    expect(output).toContain("unreachable-at-current-fitness");
  });

  test("explains previous ownership factually", async () => {
    const response = valueResponse(utilizationInput(), "previously-owned");
    const client = createMockClient({
      routes: {
        "GET /api/games/game-1?includePredicted=true": {
          response: { ok: true, status: 200, data: response },
        },
      },
    });
    const output = await gameValue(client, ["game-1"], { json: false });
    expect(output).toContain("historical cost and plays");
    expect(output).not.toMatch(/investment|resale|buy|sell/i);
  });

  test("rejects missing/extra IDs and surfaces daemon errors", async () => {
    await expectThrows(() => gameValue(createMockClient(), [], { json: false }), "Usage");
    await expectThrows(
      () => gameValue(createMockClient(), ["one", "two"], { json: false }),
      "Usage",
    );
    const client = createMockClient({
      routes: {
        "GET /api/games/missing?includePredicted=true": {
          response: { ok: false, status: 404, data: { error: "Game not found" } },
        },
      },
    });
    await expectThrows(() => gameValue(client, ["missing"], { json: false }), "Game not found");
    const failingClient = createMockClient({
      routes: {
        "GET /api/games/game-1?includePredicted=true": {
          response: { ok: false, status: 500, data: { error: "Internal server error" } },
        },
      },
    });
    await expectThrows(
      () => gameValue(failingClient, ["game-1"], { json: false }),
      "Internal server error",
    );
  });
});

describe("game rate", () => {
  const rateData = {
    game: { name: "Wingspan" },
    score: { score: 7.9 },
  };
  const client = createMockClient({
    routes: {
      "PUT /api/games/abc-123/ratings": {
        response: { ok: true, status: 200, data: rateData },
      },
    },
  });

  test("human-readable output shows Rated Wingspan", async () => {
    const output = await gameRate(client, ["abc-123"], {
      json: false,
      axisFlags: ["axis-1", "8", "axis-2", "9"],
    });
    expect(output).toContain("Rated Wingspan");
  });

  test("--json outputs parseable JSON", async () => {
    const output = await gameRate(client, ["abc-123"], {
      json: true,
      axisFlags: ["axis-1", "8", "axis-2", "9"],
    });
    const parsed = JSON.parse(output) as { game: { name: string }; score: { score: number } };
    expect(parsed.game.name).toBe("Wingspan");
    expect(parsed.score.score).toBe(7.9);
  });
});

describe("game remove", () => {
  const client = createMockClient({
    routes: {
      "DELETE /api/games/abc-123": {
        response: { ok: true, status: 204, data: null },
      },
    },
  });

  test("human-readable output shows Removed game", async () => {
    const output = await gameRemove(client, ["abc-123"], { json: false });
    expect(output).toContain("Removed game");
  });

  test("--json outputs parseable JSON with removed: true", async () => {
    const output = await gameRemove(client, ["abc-123"], { json: true });
    const parsed = JSON.parse(output) as { removed: boolean };
    expect(parsed.removed).toBe(true);
  });

  test("preserves a structured intention-history conflict", async () => {
    const failure = {
      code: "history-conflict" as const,
      gameId: "abc-123",
      intentionIds: ["intention-1"],
    };
    const conflictClient = createMockClient({
      routes: {
        "DELETE /api/games/abc-123": {
          response: { ok: false, status: 409, data: failure },
        },
      },
    });
    try {
      await gameRemove(conflictClient, ["abc-123"], { json: true });
      throw new Error("Expected removal to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(StructuredCliError);
      expect(JSON.parse(formatCliError(error))).toEqual(failure);
    }
  });
});

describe("parseRateArgs", () => {
  test("parses game id and axis pairs", () => {
    const result = parseRateArgs(["abc-123"], ["axis-1", "8", "axis-2", "9"]);
    expect(result.gameId).toBe("abc-123");
    expect(result.ratings["axis-1"]).toBe(8);
    expect(result.ratings["axis-2"]).toBe(9);
  });

  test("throws when no gameId provided", () => {
    expect(() => parseRateArgs([], ["axis-1", "8"])).toThrow();
  });

  test("throws when no axis pairs provided", () => {
    expect(() => parseRateArgs(["abc-123"], [])).toThrow();
  });
});

const noteCommandIds = {
  set: "40000000-0000-4000-8000-000000000001",
  clear: "40000000-0000-4000-8000-000000000002",
};

function acceptedNote(
  operation: "set" | "clear",
  commandId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    ok: true as const,
    accepted: {
      commandId,
      gameId: "game/1",
      operation,
      state: operation === "set" ? ("present" as const) : ("cleared" as const),
      version: 1,
      updatedAt: "2026-08-30T12:00:00.000Z",
      collectionRevision: 2,
      replayed: false,
      alreadyClear: false,
      ...overrides,
    },
  };
}

describe("owner game notes", () => {
  test.each([
    [{ state: "missing", version: 0, updatedAt: null }, "never authored"],
    [
      {
        state: "present",
        version: 2,
        updatedAt: "2026-08-30T12:00:00.000Z",
        text: "First line\n<script>alert(1)</script>",
      },
      "First line\n<script>alert(1)</script>",
    ],
    [{ state: "cleared", version: 3, updatedAt: "2026-08-30T12:00:00.000Z" }, "explicitly cleared"],
  ] as const)("renders the complete %s note state as inert text", async (note, expected) => {
    const response = { gameId: "game/1", note };
    const client = createMockClient({
      routes: {
        "GET /api/games/game%2F1/note": {
          response: { ok: true, status: 200, data: response },
        },
      },
    });
    expect(await gameNoteGet(client, ["game/1"], { json: false })).toContain(expected);
    expect(JSON.parse(await gameNoteGet(client, ["game/1"], { json: true }))).toEqual(response);
  });

  test("validates and preserves a structured missing-game read error", async () => {
    const failure = { code: "game-not-found" as const, gameId: "missing" };
    const client = createMockClient({
      routes: {
        "GET /api/games/missing/note": {
          response: { ok: false, status: 404, data: failure },
        },
      },
    });
    try {
      await gameNoteGet(client, ["missing"], { json: true });
      throw new Error("Expected read to fail");
    } catch (caught) {
      expect(caught).toBeInstanceOf(StructuredCliError);
      expect(JSON.parse(formatCliError(caught))).toEqual(failure);
    }
  });

  test("sets multiline text with expected version zero and prints a generated ID before sending", async () => {
    const commandId = noteCommandIds.set;
    const result = acceptedNote("set", commandId);
    const client = createMockClient({
      routes: {
        "PUT /api/games/game%2F1/note": { response: { ok: true, status: 200, data: result } },
      },
    });
    const originalPut = client.put.bind(client);
    const events: string[] = [];
    let body: unknown;
    client.put = <T>(path: string, nextBody?: unknown) => {
      events.push("request");
      body = nextBody;
      return originalPut<T>(path, nextBody);
    };
    const output = await gameNoteSet(
      client,
      ["game/1", "--expected-version", "0", "--text", "line one\r\nline two"],
      { json: false },
      {
        createCommandId: () => commandId,
        writeStderr: (message) => events.push(message),
      },
    );
    expect(events).toEqual([`Command ID: ${commandId}`, "request"]);
    expect(body).toEqual({ commandId, expectedVersion: 0, text: "line one\nline two" });
    expect(output).toContain("saved");
    expect(output).not.toContain("line one");
  });

  test("preserves explicit IDs, emits no preflight line, and keeps mutation JSON text-free", async () => {
    const result = acceptedNote("set", noteCommandIds.set, { replayed: true });
    const client = createMockClient({
      routes: {
        "PUT /api/games/game%2F1/note": { response: { ok: true, status: 200, data: result } },
      },
    });
    const stderr: string[] = [];
    const output = await gameNoteSet(
      client,
      [
        "game/1",
        "--text",
        "private text",
        "--command-id",
        noteCommandIds.set,
        "--expected-version",
        "0",
      ],
      { json: true },
      { writeStderr: (message) => stderr.push(message) },
    );
    expect(stderr).toEqual([]);
    expect(JSON.parse(output)).toEqual(result);
    expect(output).not.toContain("private text");
  });

  test("accepts flag-shaped note text verbatim", async () => {
    const result = acceptedNote("set", noteCommandIds.set);
    const client = createMockClient({
      routes: {
        "PUT /api/games/game%2F1/note": { response: { ok: true, status: 200, data: result } },
      },
    });
    const originalPut = client.put.bind(client);
    let body: unknown;
    client.put = <T>(path: string, nextBody?: unknown) => {
      body = nextBody;
      return originalPut<T>(path, nextBody);
    };
    await gameNoteSet(
      client,
      [
        "game/1",
        "--expected-version",
        "0",
        "--text",
        "--keep-for-conventions",
        "--command-id",
        noteCommandIds.set,
      ],
      { json: false },
    );
    expect(body).toMatchObject({ text: "--keep-for-conventions" });
  });

  test.each([
    [acceptedNote("clear", noteCommandIds.clear), "cleared"],
    [
      acceptedNote("clear", noteCommandIds.clear, {
        state: "missing",
        version: 0,
        updatedAt: null,
        alreadyClear: true,
      }),
      "already clear",
    ],
  ] as const)("renders clear result without note text", async (result, expected) => {
    const client = createMockClient({
      routes: {
        "DELETE /api/games/game%2F1/note": {
          response: { ok: true, status: 200, data: result },
        },
      },
    });
    const output = await gameNoteClear(
      client,
      ["game/1", "--expected-version", "0", "--command-id", noteCommandIds.clear],
      { json: false },
    );
    expect(output).toContain(expected);
  });

  test.each([
    { code: "validation", issues: [{ field: "text", message: "Note is too long" }] },
    {
      code: "stale-version",
      gameId: "game/1",
      expectedVersion: 0,
      current: {
        state: "present",
        version: 1,
        updatedAt: "2026-08-30T12:00:00.000Z",
        text: "current private text",
      },
    },
    { code: "command-reuse", commandId: noteCommandIds.set },
    { code: "version-overflow", target: "note" },
    { code: "version-overflow", target: "collection" },
    { code: "persistence-failure", operation: "shelf.game.note.set", message: "disk full" },
  ] as const)("preserves structured daemon failure %#", async (error) => {
    const failure = { ok: false as const, commandId: noteCommandIds.set, error };
    const status =
      error.code === "stale-version" || error.code === "command-reuse"
        ? 409
        : error.code === "version-overflow"
          ? 422
          : error.code === "persistence-failure"
            ? 500
            : 400;
    const client = createMockClient({
      routes: {
        "PUT /api/games/game%2F1/note": {
          response: { ok: false, status, data: failure },
        },
      },
    });
    try {
      await gameNoteSet(
        client,
        [
          "game/1",
          "--expected-version",
          "0",
          "--text",
          "draft",
          "--command-id",
          noteCommandIds.set,
        ],
        { json: true },
      );
      throw new Error("Expected note mutation to fail");
    } catch (caught) {
      expect(caught).toBeInstanceOf(StructuredCliError);
      expect(JSON.parse(formatCliError(caught))).toEqual(failure);
    }
  });

  test.each(
    [
      [],
      ["game-1"],
      ["game-1", "--expected-version", "-1", "--text", "note"],
      ["game-1", "--expected-version", "1.5", "--text", "note"],
      ["game-1", "--expected-version", String(Number.MAX_SAFE_INTEGER + 1), "--text", "note"],
      ["game-1", "--expected-version", "0", "--text", "   "],
      ["game-1", "--expected-version", "0", "--text", "note", "--unknown", "value"],
    ].map((args) => [args] as [string[]]),
  )("rejects malformed set arguments %#", async (args) => {
    await expectThrows(() => gameNoteSet(createMockClient(), args, { json: false }), "Usage");
  });

  test("rejects malformed and cross-game responses", async () => {
    for (const response of [
      { ok: true, status: 200, data: { ok: true, accepted: { commandId: noteCommandIds.set } } },
      {
        ok: true,
        status: 200,
        data: acceptedNote("set", noteCommandIds.set, { gameId: "other-game" }),
      },
      {
        ok: true,
        status: 200,
        data: acceptedNote("set", noteCommandIds.set, { version: 2 }),
      },
      {
        ok: false,
        status: 409,
        data: {
          ok: false,
          commandId: noteCommandIds.set,
          error: {
            code: "stale-version",
            gameId: "other-game",
            expectedVersion: 0,
            current: {
              state: "present",
              version: 1,
              updatedAt: "2026-08-30T12:00:00.000Z",
              text: "must not be disclosed",
            },
          },
        },
      },
      { ok: false, status: 500, data: acceptedNote("set", noteCommandIds.set) },
    ]) {
      const client = createMockClient({
        routes: {
          "PUT /api/games/game-1/note": {
            response,
          },
        },
      });
      await expectThrows(
        () =>
          gameNoteSet(
            client,
            [
              "game-1",
              "--expected-version",
              "0",
              "--text",
              "draft",
              "--command-id",
              noteCommandIds.set,
            ],
            { json: true },
          ),
        "Invalid owner-note response",
      );
    }
  });
});

describe("game shelf assignment", () => {
  test("error assertion helper rejects when the command resolves", async () => {
    let helperRejected = false;
    try {
      await expectThrows(() => Promise.resolve(), "expected failure");
    } catch {
      helperRejected = true;
    }
    expect(helperRejected).toBe(true);
  });

  test("assigns a measured owned game and preserves JSON output", async () => {
    const response = { game: { name: "Wingspan", manualShelfId: "shelf/a" } };
    const client = createMockClient({
      routes: {
        "PUT /api/games/game%2F1/shelf-assignment": {
          response: { ok: true, status: 200, data: response },
        },
      },
    });
    const originalPut = client.put.bind(client);
    const bodies: unknown[] = [];
    client.put = <T>(path: string, body?: unknown) => {
      bodies.push(body);
      return originalPut<T>(path, body);
    };

    const human = await gameAssignShelf(client, ["game/1", "shelf/a"], { json: false });
    expect(human).toContain('Assigned "Wingspan" to shelf shelf/a');
    expect(bodies[0]).toEqual({ shelfId: "shelf/a" });

    const json = await gameAssignShelf(client, ["game/1", "shelf/a"], { json: true });
    expect(JSON.parse(json)).toEqual(response);
  });

  test("assignment usage explains dimension precondition", async () => {
    const client = createMockClient();
    await expectThrows(
      () => gameAssignShelf(client, ["game-1"], { json: false }),
      "must be owned and have box dimensions",
    );
  });

  test("surfaces assignment API errors", async () => {
    const client = createMockClient({
      routes: {
        "PUT /api/games/game-1/shelf-assignment": {
          response: { ok: false, status: 400, data: { error: "Game must have box dimensions" } },
        },
      },
    });
    await expectThrows(
      () => gameAssignShelf(client, ["game-1", "shelf-1"], { json: false }),
      "Game must have box dimensions",
    );
  });

  test("clears an assignment with a null shelf ID", async () => {
    const response = { game: { name: "Wingspan", manualShelfId: null } };
    const client = createMockClient({
      routes: {
        "PUT /api/games/game-1/shelf-assignment": {
          response: { ok: true, status: 200, data: response },
        },
      },
    });
    const originalPut = client.put.bind(client);
    let body: unknown;
    client.put = <T>(path: string, nextBody?: unknown) => {
      body = nextBody;
      return originalPut<T>(path, nextBody);
    };
    const output = await gameClearShelf(client, ["game-1"], { json: false });
    expect(output).toContain("Cleared manual shelf assignment");
    expect(output).toContain("Wingspan");
    expect(body).toEqual({ shelfId: null });
  });

  test("clear requires exactly one game ID", async () => {
    const client = createMockClient();
    await expectThrows(() => gameClearShelf(client, [], { json: false }), "Usage");
    await expectThrows(() => gameClearShelf(client, ["one", "two"], { json: false }), "Usage");
  });
});

const commandIds = {
  create: "30000000-0000-4000-8000-000000000001",
  complete: "30000000-0000-4000-8000-000000000002",
  retire: "30000000-0000-4000-8000-000000000003",
};
const activeIntention = {
  intentionId: "intention-1",
  gameId: "game/1",
  kind: "first-play" as const,
  baseline: {
    playCount: 0,
    evidenceSource: "manual" as const,
    observedAt: "2026-08-28T10:00:00.000Z",
  },
  createdAt: "2026-08-28T10:01:00.000Z",
  version: 1,
  resolution: null,
};

function acceptedIntention(
  commandId: string,
  intention: PlayIntention = activeIntention,
): IntentionMutationResult {
  return { ok: true, commandId, intention, linkedOwnershipTransition: null };
}

function correctionGame(): Game {
  const observedAt = "2026-08-28T10:02:00.000Z";
  return {
    id: "game/1",
    bggId: null,
    name: "Game",
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: 1,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "valid", value: 1, source: "manual", observedAt },
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
    entityMetadata: createInitialEntityMetadata(null),
    latestPlayCountCheck: null,
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: "2026-08-28T09:00:00.000Z",
    updatedAt: observedAt,
  };
}

describe("game intentions", () => {
  test.each([...canonicalIntentionMutationCases])(
    "preserves canonical $label through CLI stdout, stderr, and exit behavior",
    async ({ command, result, status }) => {
      const route =
        command.type === "create"
          ? `POST /api/games/${command.gameId}/intention`
          : `POST /api/games/${command.gameId}/intention/${command.intentionId}/${command.type}`;
      const client = createMockClient({
        routes: { [route]: { response: { ok: status === 200, status, data: result } } },
      });
      let stdout = "";
      let stderr = "";
      let exitCode = 0;
      try {
        stdout =
          command.type === "create"
            ? await gameIntentionSet(
                client,
                [command.gameId, command.kind, "--command-id", command.commandId],
                { json: true },
                { writeStderr: (message) => (stderr += message) },
              )
            : await gameIntentionResolve(
                client,
                command.type,
                [
                  command.gameId,
                  command.intentionId,
                  "--expected-version",
                  String(command.expectedVersion),
                  "--command-id",
                  command.commandId,
                ],
                { json: true },
                { writeStderr: (message) => (stderr += message) },
              );
      } catch (error) {
        exitCode = 1;
        stderr = formatCliError(error);
      }

      if (result.ok) {
        expect(exitCode).toBe(0);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(result);
      } else {
        expect(exitCode).toBe(1);
        expect(stdout).toBe("");
        const rendered = JSON.parse(stderr) as IntentionMutationResult & { guidance?: string };
        expect(rendered).toMatchObject(result);
        expect(rendered.guidance !== undefined).toBe(result.error.code === "stale-version");
      }
    },
  );

  test("set sends the strict create body and preserves a supplied command ID", async () => {
    const result = acceptedIntention(commandIds.create);
    const client = createMockClient({
      routes: {
        "POST /api/games/game%2F1/intention": {
          response: { ok: true, status: 200, data: result },
        },
      },
    });
    const originalPost = client.post.bind(client);
    let body: unknown;
    client.post = <T>(path: string, nextBody?: unknown) => {
      body = nextBody;
      return originalPost<T>(path, nextBody);
    };

    const output = await gameIntentionSet(
      client,
      ["game/1", "first-play", "--command-id", commandIds.create],
      { json: false },
    );
    expect(body).toEqual({
      commandId: commandIds.create,
      kind: "first-play",
      expectedActiveIntention: "absent",
    });
    expect(JSON.parse(output)).toEqual(result);
  });

  test.each(["complete", "retire"] as const)(
    "%s sends only commandId and expectedVersion and preserves owner resolution evidence",
    async (type) => {
      const commandId = commandIds[type];
      const intention = {
        ...activeIntention,
        version: 2,
        resolution:
          type === "complete"
            ? {
                outcome: "completed" as const,
                source: "owner-confirmed" as const,
                resolvedAt: "2026-08-28T10:02:00.000Z",
              }
            : {
                outcome: "retired" as const,
                source: "owner-retired" as const,
                resolvedAt: "2026-08-28T10:02:00.000Z",
              },
      };
      const result = acceptedIntention(commandId, intention);
      const path = `/api/games/game%2F1/intention/intention-1/${type}`;
      const client = createMockClient({
        routes: { [`POST ${path}`]: { response: { ok: true, status: 200, data: result } } },
      });
      const originalPost = client.post.bind(client);
      let body: unknown;
      client.post = <T>(requestPath: string, nextBody?: unknown) => {
        body = nextBody;
        return originalPost<T>(requestPath, nextBody);
      };

      const output = await gameIntentionResolve(
        client,
        type,
        ["game/1", "intention-1", "--expected-version", "1", "--command-id", commandId],
        { json: true },
      );
      expect(body).toEqual({ commandId, expectedVersion: 1 });
      expect(JSON.parse(output)).toEqual(result);
      expect(JSON.parse(output)).not.toHaveProperty("game");
    },
  );

  test("preserves stale current state and adds refresh-and-review guidance", async () => {
    const stale = {
      ok: false as const,
      commandId: commandIds.complete,
      error: {
        code: "stale-version" as const,
        gameId: "game/1",
        intentionId: "intention-1",
        expectedVersion: 1,
        current: {
          ...activeIntention,
          version: 2,
          resolution: {
            outcome: "completed" as const,
            source: "owner-confirmed" as const,
            resolvedAt: "2026-08-28T10:02:00.000Z",
          },
        },
      },
    };
    const client = createMockClient({
      routes: {
        "POST /api/games/game%2F1/intention/intention-1/complete": {
          response: { ok: false, status: 409, data: stale },
        },
      },
    });
    try {
      await gameIntentionResolve(
        client,
        "complete",
        ["game/1", "intention-1", "--expected-version", "1", "--command-id", commandIds.complete],
        { json: true },
      );
      throw new Error("Expected stale command to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(StructuredCliError);
      const rendered = JSON.parse(formatCliError(error)) as {
        error: typeof stale.error;
        guidance: string;
      };
      expect(rendered.error.current).toEqual(stale.error.current);
      expect(rendered.guidance).toMatch(/Refresh.*review.*Do not retry/i);
    }
  });

  test.each([
    { code: "validation", issues: [{ field: "kind", message: "Invalid kind" }] },
    { code: "game-not-found", gameId: "game/1" },
    { code: "intention-not-found", gameId: "game/1", intentionId: "intention-1" },
    { code: "ineligible-game", gameId: "game/1", reason: "not-owned" },
    { code: "active-intention-conflict", gameId: "game/1", current: activeIntention },
    { code: "command-reuse", commandId: commandIds.create },
    { code: "history-conflict", gameId: "game/1", intentionIds: ["intention-1"] },
    { code: "persistence-failure", operation: "game.intention.create", message: "disk full" },
  ] as const)("validates and preserves structured intention failure %#", async (error) => {
    const failure = { ok: false as const, commandId: commandIds.create, error };
    const client = createMockClient({
      routes: {
        "POST /api/games/game%2F1/intention": {
          response: { ok: false, status: 400, data: failure },
        },
      },
    });
    try {
      await gameIntentionSet(client, ["game/1", "first-play", "--command-id", commandIds.create], {
        json: true,
      });
      throw new Error("Expected command to fail");
    } catch (caught) {
      expect(caught).toBeInstanceOf(StructuredCliError);
      expect(JSON.parse(formatCliError(caught))).toEqual(failure);
    }
  });

  test.each(
    (
      [
        [],
        ["game-1"],
        ["game-1", "invalid-kind"],
        ["game-1", "first-play", "extra"],
        ["game-1", "first-play", "--unknown", "value"],
        ["game-1", "first-play", "--command-id"],
        ["game-1", "first-play", "--command-id", "not-a-uuid"],
        [
          "game-1",
          "first-play",
          "--command-id",
          commandIds.create,
          "--command-id",
          commandIds.create,
        ],
      ] as string[][]
    ).map((args) => [args] as [string[]]),
  )("set rejects malformed arguments %#", async (args) => {
    await expectThrows(() => gameIntentionSet(createMockClient(), args, { json: false }), "Usage");
  });

  test.each(
    (
      [
        [],
        ["game-1", "intention-1"],
        ["game-1", "intention-1", "--expected-version"],
        ["game-1", "intention-1", "--expected-version", "0"],
        ["game-1", "intention-1", "--expected-version", "1.5"],
        ["game-1", "intention-1", "--expected-version", "1", "extra"],
        ["game-1", "intention-1", "--other", "1"],
      ] as string[][]
    ).map((args) => [args] as [string[]]),
  )("resolve rejects malformed arguments %#", async (args) => {
    await expectThrows(
      () => gameIntentionResolve(createMockClient(), "complete", args, { json: false }),
      "Usage",
    );
  });

  test("rejects malformed success and failure responses", async () => {
    for (const data of [
      { ok: true, commandId: commandIds.create },
      { ok: false, commandId: commandIds.create, error: { code: "unknown" } },
    ]) {
      const client = createMockClient({
        routes: {
          "POST /api/games/game-1/intention": {
            response: { ok: data.ok, status: data.ok ? 200 : 400, data },
          },
        },
      });
      await expectThrows(
        () =>
          gameIntentionSet(client, ["game-1", "first-play", "--command-id", commandIds.create], {
            json: true,
          }),
        "Invalid intention response",
      );
    }
  });
});

describe("manual play correction", () => {
  test("sends an exact count and renders updated evidence plus automatic completion", async () => {
    const game = correctionGame();
    const linkedIntentionTransition = {
      ...activeIntention,
      version: 2,
      resolution: {
        outcome: "completed" as const,
        source: "observed-play-increase" as const,
        resolvedAt: game.updatedAt,
      },
    };
    const result = { ok: true as const, game, linkedIntentionTransition };
    const client = createMockClient({
      routes: {
        "PUT /api/games/game%2F1/plays": { response: { ok: true, status: 200, data: result } },
      },
    });
    const originalPut = client.put.bind(client);
    let body: unknown;
    client.put = <T>(path: string, nextBody?: unknown) => {
      body = nextBody;
      return originalPut<T>(path, nextBody);
    };
    const output = await gamePlaysSet(client, ["game/1", "1"], { json: false });
    expect(body).toEqual({ playCount: 1 });
    expect(JSON.parse(output)).toEqual(result);
  });

  test.each(
    (
      [
        [],
        ["game-1"],
        ["game-1", "-1"],
        ["game-1", "1.5"],
        ["game-1", "NaN"],
        ["game-1", String(Number.MAX_SAFE_INTEGER + 1)],
        ["game-1", "1", "extra"],
      ] as string[][]
    ).map((args) => [args] as [string[]]),
  )("rejects malformed arguments %#", async (args) => {
    await expectThrows(() => gamePlaysSet(createMockClient(), args, { json: false }), "Usage");
  });

  test.each([
    { code: "validation", issues: [{ field: "playCount", message: "Required" }] },
    { code: "game_not_found", error: "Game not found: missing" },
    { code: "persistence-failure", operation: "shelf.game.plays.set", message: "disk full" },
    {
      ok: false,
      error: {
        code: "non-monotonic-observation",
        gameId: "game-1",
        attemptedObservedAt: "2026-08-28T10:00:00.000Z",
        latestAcceptedAt: "2026-08-28T10:00:00.000Z",
      },
    },
  ])("validates and preserves structured daemon failure %#", async (failure) => {
    const client = createMockClient({
      routes: {
        "PUT /api/games/game-1/plays": {
          response: { ok: false, status: 400, data: failure },
        },
      },
    });
    try {
      await gamePlaysSet(client, ["game-1", "1"], { json: true });
      throw new Error("Expected correction to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(StructuredCliError);
      expect(JSON.parse(formatCliError(error))).toEqual(failure);
    }
  });

  test("rejects an unvalidated manual-play error shape", async () => {
    const client = createMockClient({
      routes: {
        "PUT /api/games/game-1/plays": {
          response: { ok: false, status: 409, data: { code: "stale-version", current: {} } },
        },
      },
    });
    await expectThrows(
      () => gamePlaysSet(client, ["game-1", "1"], { json: true }),
      "Invalid play-correction response",
    );
  });
});
