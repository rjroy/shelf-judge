import { describe, test, expect } from "bun:test";
import { helpCommand } from "../../src/commands/help.js";
import { createMockClient } from "../helpers/mock-client.js";

const mockTree = {
  name: "shelf",
  children: {
    game: {
      name: "game",
      children: {
        search: {
          operationId: "shelf.game.search",
          name: "search",
          description: "Search BGG for games by name",
          invocation: { method: "GET", path: "/api/games/search" },
        },
        list: {
          operationId: "shelf.game.list",
          name: "list",
          description: "List all games with fitness scores",
          invocation: { method: "GET", path: "/api/games" },
        },
        get: {
          operationId: "shelf.game.get",
          name: "get",
          description: "Get one enriched game",
          invocation: { method: "GET", path: "/api/games/:id" },
        },
        acquisition: {
          operationId: "shelf.game.set-acquisition",
          name: "set-acquisition",
          description: "Set acquisition",
          invocation: { method: "PUT", path: "/api/games/:id/acquisition" },
        },
        "assign-shelf": {
          operationId: "shelf.game.shelf-assignment",
          name: "assign-shelf",
          description:
            "Set or clear a game's manual shelf assignment; assigning requires an owned game with complete box dimensions",
          invocation: { method: "PUT", path: "/api/games/:id/shelf-assignment" },
        },
      },
    },
    collection: {
      name: "collection",
      children: {
        get: {
          operationId: "shelf.collection.get-entertainment-benchmark",
          name: "get-entertainment-benchmark",
          invocation: { method: "GET", path: "/api/collection/entertainment-benchmark" },
        },
        set: {
          operationId: "shelf.collection.set-entertainment-benchmark",
          name: "set-entertainment-benchmark",
          invocation: { method: "PUT", path: "/api/collection/entertainment-benchmark" },
        },
        clear: {
          operationId: "shelf.collection.clear-entertainment-benchmark",
          name: "clear-entertainment-benchmark",
          invocation: { method: "DELETE", path: "/api/collection/entertainment-benchmark" },
        },
      },
    },
  },
};

const mockAxisTree = {
  name: "axis",
  children: {
    create: {
      operationId: "shelf.axis.create",
      name: "create",
      description: "Create an axis",
      invocation: { method: "POST", path: "/api/axes" },
    },
    update: {
      operationId: "shelf.axis.update",
      name: "update",
      description: "Update an axis",
      invocation: { method: "PUT", path: "/api/axes/:id" },
    },
    templates: {
      operationId: "shelf.axis.derived-fields",
      name: "derived-fields",
      description: "List registered derived fields",
      invocation: { method: "GET", path: "/api/axes/derived-fields" },
    },
    repair: {
      operationId: "shelf.axis.repair",
      name: "repair",
      description: "Repair a disabled legacy axis",
      invocation: { method: "PUT", path: "/api/axes/:id/repair" },
    },
  },
};

describe("help command", () => {
  test("displays operation tree", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/help": { response: { ok: true, status: 200, data: mockTree } },
      },
    });

    const result = await helpCommand(client, [], { json: false });
    expect(result).toContain("shelf-judge");
    expect(result).toContain("game:");
    expect(result).toContain("search");
    expect(result).toContain("list");
  });

  test("--json outputs parseable JSON", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/help": { response: { ok: true, status: 200, data: mockTree } },
      },
    });

    const result = await helpCommand(client, [], { json: true });
    const parsed = JSON.parse(result) as { name: string; children: Record<string, unknown> };
    expect(parsed.name).toBe("shelf");
    expect(parsed.children.game).toBeDefined();
  });

  test("help game exposes both assignment commands with usage and preconditions", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/help/game": { response: { ok: true, status: 200, data: mockTree } },
      },
    });

    const result = await helpCommand(client, ["game"], { json: false });
    expect(result).toContain("assign-shelf");
    expect(result).toContain("Usage: shelf-judge game assign-shelf <game-id> <shelf-id>");
    expect(result).toContain("clear-shelf");
    expect(result).toContain("Usage: shelf-judge game clear-shelf <game-id>");
    expect(result).toContain("return it to automatic placement");
    expect(result).toContain("owned game with complete box dimensions");
  });

  test("help axis exposes templates, configuration flags, and repair", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/help/axis": { response: { ok: true, status: 200, data: mockAxisTree } },
      },
    });

    const result = await helpCommand(client, ["axis"], { json: false });
    expect(result).toContain("shelf-judge axis templates");
    expect(result).toContain("shelf-judge axis create [name] [--template <template-id>]");
    expect(result).toContain("shelf-judge axis update <axis-id>");
    expect(result).toContain("shelf-judge axis repair <axis-id> --template <template-id>");
    expect(result).toContain("--target-player-count <count>");
    expect(result).toContain("--maximum-scoring-time <minutes>");
  });

  test("documents purchase utilization commands and semantics without collection sorts", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/help": { response: { ok: true, status: 200, data: mockTree } },
      },
    });
    const result = await helpCommand(client, [], { json: false });
    expect(result).toContain(
      "shelf-judge game acquisition <game-id> unknown|gift|purchase [amount] [--json]",
    );
    expect(result).toContain("shelf-judge game value <game-id> [--json]");
    expect(result).toContain("shelf-judge collection benchmark get [--json]");
    expect(result).toContain("shelf-judge collection benchmark set <amount> [--json]");
    expect(result).toContain("shelf-judge collection benchmark clear [--json]");
    expect(result).toContain("implicit personal currency");
    expect(result).toContain(
      "one or more whole-number digits, optionally followed by a decimal point and one or two digits",
    );
    expect(result).toContain("Signs, leading-dot forms, and trailing decimal points are invalid");
    expect(result).toContain("lifetime landed cost");
    expect(result).toContain("positive acceptable cost per person-hour at fitness 6");
    expect(result).toContain("$16 / 2 hours = $8 per person-hour");
    expect(result).toContain("zero-cost purchase");
    expect(result).toContain("clear");
    expect(result).not.toMatch(
      /collection (sort|order)|value remaining sort|additional plays sort/i,
    );
  });
});
