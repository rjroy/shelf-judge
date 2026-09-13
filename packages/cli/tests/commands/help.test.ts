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
        "intention-set": {
          operationId: "shelf.game.intention.set",
          name: "set",
          description: "Create intention",
          invocation: { method: "POST", path: "/api/games/:id/intention" },
        },
        "intention-complete": {
          operationId: "shelf.game.intention.complete",
          name: "complete",
          description: "Complete intention",
          invocation: { method: "POST", path: "/api/games/:id/intention/:intentionId/complete" },
        },
        "intention-retire": {
          operationId: "shelf.game.intention.retire",
          name: "retire",
          description: "Retire intention",
          invocation: { method: "POST", path: "/api/games/:id/intention/:intentionId/retire" },
        },
        "plays-set": {
          operationId: "shelf.game.plays.set",
          name: "set",
          description: "Set play evidence",
          invocation: { method: "PUT", path: "/api/games/:id/plays" },
        },
        "note-get": {
          operationId: "shelf.game.note.get",
          name: "get",
          description: "Read current note state",
          invocation: { method: "GET", path: "/api/games/:id/note" },
        },
        "note-set": {
          operationId: "shelf.game.note.set",
          name: "set",
          description: "Set current note state without examples",
          invocation: { method: "PUT", path: "/api/games/:id/note" },
        },
        "note-clear": {
          operationId: "shelf.game.note.clear",
          name: "clear",
          description: "Clear current note state",
          invocation: { method: "DELETE", path: "/api/games/:id/note" },
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

  test("help game exposes exact intention and play syntax without removed profile language", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/help/game": { response: { ok: true, status: 200, data: mockTree } },
      },
    });
    const result = await helpCommand(client, ["game"], { json: false });
    expect(result).toContain(
      "shelf-judge game intention set <game-id> <first-play|replay> [--command-id <uuid>]",
    );
    expect(result).toContain(
      "shelf-judge game intention complete <game-id> <intention-id> --expected-version <n> [--command-id <uuid>]",
    );
    expect(result).toContain(
      "shelf-judge game intention retire <game-id> <intention-id> --expected-version <n> [--command-id <uuid>]",
    );
    expect(result).toContain("shelf-judge game plays set <game-id> <count>");
    expect(result).toContain("without changing play count");
    expect(result).not.toMatch(/narrat|urgenc|source\s+profile/i);
  });

  test("help game discovers note commands and documents the --text exposure boundary", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/help/game": { response: { ok: true, status: 200, data: mockTree } },
      },
    });
    const result = await helpCommand(client, ["game"], { json: false });
    expect(result).toContain("shelf-judge game note get <game-id> [--json]");
    expect(result).toContain(
      "shelf-judge game note set <game-id> --expected-version <n> --text <text>",
    );
    expect(result).toContain("shelf-judge game note clear <game-id> --expected-version <n>");
    expect(result).toContain("shell history and process arguments");
    expect(result).toContain("Stdin, file input, and editor launching are not supported");
    expect(result).not.toContain("Keep for larger groups");
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
