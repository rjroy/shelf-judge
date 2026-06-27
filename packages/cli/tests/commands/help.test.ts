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
        "assign-shelf": {
          operationId: "shelf.game.shelf-assignment",
          name: "assign-shelf",
          description:
            "Set or clear a game's manual shelf assignment; assigning requires an owned game with complete box dimensions",
          invocation: { method: "PUT", path: "/api/games/:id/shelf-assignment" },
        },
      },
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
});
