import { describe, test, expect, beforeEach } from "bun:test";
import { createTestApp, jsonRequest, type TestAppContext } from "../helpers/test-app.js";

let ctx: TestAppContext;

beforeEach(() => {
  ctx = createTestApp();
});

describe("GET /api/help", () => {
  test("returns all operations in a tree structure with root shelf node", async () => {
    const res = await jsonRequest(ctx.app, "GET", "/api/help");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe("shelf");
    expect(body.children).toBeDefined();
    expect(typeof body.children).toBe("object");
  });

  test("root tree has children for registered features", async () => {
    const res = await jsonRequest(ctx.app, "GET", "/api/help");
    const body = await res.json();

    // The app registers multiple route modules; at minimum help and config exist
    expect(body.children.help).toBeDefined();
    expect(body.children.config).toBeDefined();
  });

  test("operations in tree have correct name, description, and invocation properties", async () => {
    const res = await jsonRequest(ctx.app, "GET", "/api/help");
    const body = await res.json();

    // shelf.help is a two-part operationId, so it lands directly at children.help
    const helpNode = body.children.help;
    expect(helpNode).toBeDefined();
    expect(helpNode.name).toBe("help");
    expect(typeof helpNode.description).toBe("string");
    expect(helpNode.description.length).toBeGreaterThan(0);
    expect(helpNode.invocation).toEqual({
      method: "GET",
      path: "/api/help",
    });
  });
});

describe("GET /api/help/:feature", () => {
  test("returns game operations subtree", async () => {
    const res = await jsonRequest(ctx.app, "GET", "/api/help/game");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe("shelf");
    expect(body.children).toBeDefined();
    expect(body.children.game).toBeDefined();
  });

  test("returns 404 for nonexistent feature", async () => {
    const res = await jsonRequest(ctx.app, "GET", "/api/help/nonexistent");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain("nonexistent");
  });
});

describe("GET /api/config", () => {
  test("returns config with masked token", async () => {
    const res = await jsonRequest(ctx.app, "GET", "/api/config");
    expect(res.status).toBe(200);

    const body = await res.json();
    // Default config has no token, so bggAuthToken should be null
    expect(body.bggAuthToken).toBeNull();
  });
});

describe("PUT /api/config", () => {
  test("updates config and returns masked token", async () => {
    const putRes = await jsonRequest(ctx.app, "PUT", "/api/config", {
      bggAuthToken: "test-token",
    });
    expect(putRes.status).toBe(200);

    const putBody = await putRes.json();
    expect(putBody.bggAuthToken).toBe("***configured***");

    // Verify GET also shows the masked token
    const getRes = await jsonRequest(ctx.app, "GET", "/api/config");
    const getBody = await getRes.json();
    expect(getBody.bggAuthToken).toBe("***configured***");
  });
});
