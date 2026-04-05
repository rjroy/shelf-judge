import { describe, test, expect } from "bun:test";
import {
  gameSearch,
  gameAdd,
  gameList,
  gameRate,
  gameRemove,
  parseRateArgs,
} from "../../src/commands/game.js";
import { createMockClient } from "../helpers/mock-client.js";

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
    const parsed = JSON.parse(output);
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
    const parsed = JSON.parse(output);
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
    const parsed = JSON.parse(output);
    expect(parsed.game.name).toBe("Custom Game");
    expect(parsed.bggImported).toBe(false);
  });
});

describe("game list", () => {
  const listData = [
    { game: { id: "abc-123", name: "Wingspan", yearPublished: 2019 }, score: { score: 7.9 } },
    { game: { id: "def-456", name: "Unrated Game", yearPublished: null }, score: null },
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
    expect(output).toContain("7.9");
  });

  test("--json outputs parseable JSON array", async () => {
    const output = await gameList(client, [], { json: true });
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].game.name).toBe("Wingspan");
    expect(parsed[1].score).toBeNull();
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
    const parsed = JSON.parse(output);
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
    const parsed = JSON.parse(output);
    expect(parsed.removed).toBe(true);
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
