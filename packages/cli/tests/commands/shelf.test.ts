import { describe, test, expect } from "bun:test";
import {
  shelfList,
  shelfAddUnit,
  shelfAddShelf,
  shelfRemoveUnit,
  shelfRemoveShelf,
} from "../../src/commands/shelf.js";
import { createMockClient } from "../helpers/mock-client.js";
import type { ShelfConfiguration, ShelfUnit } from "@shelf-judge/shared";

const unit1: ShelfUnit = {
  id: "unit-1",
  name: "Living Room Kallax",
  shelves: [
    { id: "shelf-1", name: "Top Shelf", width: 30, height: 12, depth: 15 },
    { id: "shelf-2", name: "Bottom Shelf", width: 30, height: null, depth: 15 },
  ],
};

const unit2: ShelfUnit = {
  id: "unit-2",
  name: "Office Bookcase",
  shelves: [],
};

const config: ShelfConfiguration = {
  units: [unit1, unit2],
  createdAt: "2026-04-13T00:00:00.000Z",
  updatedAt: "2026-04-13T00:00:00.000Z",
};

const emptyConfig: ShelfConfiguration = {
  units: [],
  createdAt: "2026-04-13T00:00:00.000Z",
  updatedAt: "2026-04-13T00:00:00.000Z",
};

async function expectThrows(fn: () => Promise<unknown>, match: string): Promise<void> {
  try {
    await fn();
    throw new Error(`Expected function to throw matching "${match}" but it did not throw`);
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(match);
  }
}

describe("shelf list", () => {
  test("empty config shows help message", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/shelf/config": { response: { ok: true, status: 200, data: emptyConfig } },
      },
    });
    const output = await shelfList(client, [], { json: false });
    expect(output).toContain("No shelf units configured");
    expect(output).toContain("add-unit");
  });

  test("shows unit names and shelf table", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/shelf/config": { response: { ok: true, status: 200, data: config } },
      },
    });
    const output = await shelfList(client, [], { json: false });
    expect(output).toContain("Living Room Kallax");
    expect(output).toContain("Office Bookcase");
    expect(output).toContain("Top Shelf");
    expect(output).toContain("Bottom Shelf");
    expect(output).toContain("(no shelves)");
  });

  test("unconstrained shelf shows --- for height", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/shelf/config": { response: { ok: true, status: 200, data: config } },
      },
    });
    const output = await shelfList(client, [], { json: false });
    expect(output).toContain("---");
    expect(output).toContain("unconstrained");
  });

  test("constrained shelf shows volume", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/shelf/config": { response: { ok: true, status: 200, data: config } },
      },
    });
    const output = await shelfList(client, [], { json: false });
    // 30 * 12 * 15 = 5,400
    expect(output).toContain("5,400");
  });

  test("--json outputs raw config", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/shelf/config": { response: { ok: true, status: 200, data: config } },
      },
    });
    const output = await shelfList(client, [], { json: true });
    const parsed = JSON.parse(output) as ShelfConfiguration;
    expect(parsed.units).toHaveLength(2);
    expect(parsed.units[0].name).toBe("Living Room Kallax");
  });

  test("throws on server error", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/shelf/config": {
          response: { ok: false, status: 500, data: { error: "disk full" } },
        },
      },
    });
    await expectThrows(() => shelfList(client, [], { json: false }), "disk full");
  });
});

describe("shelf add-unit", () => {
  const newUnit: ShelfUnit = { id: "unit-3", name: "Garage Shelf", shelves: [] };

  test("requires name argument", async () => {
    const client = createMockClient();
    await expectThrows(() => shelfAddUnit(client, [], { json: false }), "Usage");
  });

  test("returns confirmation message", async () => {
    const client = createMockClient({
      routes: {
        "POST /api/shelf/units": { response: { ok: true, status: 201, data: newUnit } },
      },
    });
    const output = await shelfAddUnit(client, ["Garage Shelf"], { json: false });
    expect(output).toContain("Garage Shelf");
    expect(output).toContain("unit-3");
  });

  test("--json outputs unit object", async () => {
    const client = createMockClient({
      routes: {
        "POST /api/shelf/units": { response: { ok: true, status: 201, data: newUnit } },
      },
    });
    const output = await shelfAddUnit(client, ["Garage Shelf"], { json: true });
    const parsed = JSON.parse(output) as ShelfUnit;
    expect(parsed.id).toBe("unit-3");
    expect(parsed.name).toBe("Garage Shelf");
  });
});

describe("shelf add-shelf", () => {
  test("requires 5 arguments", async () => {
    const client = createMockClient();
    await expectThrows(
      () => shelfAddShelf(client, ["unit-1", "Top", "30"], { json: false }),
      "Usage",
    );
  });

  test("validates width is positive", async () => {
    const client = createMockClient();
    await expectThrows(
      () => shelfAddShelf(client, ["unit-1", "Shelf", "0", "12", "15"], { json: false }),
      "Width must be a positive number",
    );
  });

  test("validates height is non-negative", async () => {
    const client = createMockClient();
    await expectThrows(
      () => shelfAddShelf(client, ["unit-1", "Shelf", "30", "-5", "15"], { json: false }),
      "Height must be a non-negative number",
    );
  });

  test("validates depth is positive", async () => {
    const client = createMockClient();
    await expectThrows(
      () => shelfAddShelf(client, ["unit-1", "Shelf", "30", "12", "0"], { json: false }),
      "Depth must be a positive number",
    );
  });

  test("height=0 maps to null (REQ-SHELF-33)", async () => {
    const updatedUnit: ShelfUnit = {
      id: "unit-1",
      name: "Living Room Kallax",
      shelves: [
        ...unit1.shelves,
        { id: "shelf-3", name: "New Shelf", width: 30, height: null, depth: 15 },
      ],
    };
    const client = createMockClient({
      routes: {
        "GET /api/shelf/config": { response: { ok: true, status: 200, data: config } },
        "PUT /api/shelf/units/unit-1": {
          response: { ok: true, status: 200, data: updatedUnit },
        },
      },
    });
    const output = await shelfAddShelf(client, ["unit-1", "New Shelf", "30", "0", "15"], {
      json: false,
    });
    expect(output).toContain("unconstrained");
    expect(output).toContain("New Shelf");
  });

  test("non-zero height preserved", async () => {
    const updatedUnit: ShelfUnit = {
      id: "unit-1",
      name: "Living Room Kallax",
      shelves: [
        ...unit1.shelves,
        { id: "shelf-3", name: "Mid Shelf", width: 30, height: 10, depth: 15 },
      ],
    };
    const client = createMockClient({
      routes: {
        "GET /api/shelf/config": { response: { ok: true, status: 200, data: config } },
        "PUT /api/shelf/units/unit-1": {
          response: { ok: true, status: 200, data: updatedUnit },
        },
      },
    });
    const output = await shelfAddShelf(client, ["unit-1", "Mid Shelf", "30", "10", "15"], {
      json: false,
    });
    expect(output).not.toContain("unconstrained");
    expect(output).toContain("Mid Shelf");
  });

  test("throws when unit not found", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/shelf/config": { response: { ok: true, status: 200, data: config } },
      },
    });
    await expectThrows(
      () => shelfAddShelf(client, ["nonexistent", "Shelf", "30", "12", "15"], { json: false }),
      "Shelf unit not found: nonexistent",
    );
  });
});

describe("shelf remove-unit", () => {
  test("requires unit-id argument", async () => {
    const client = createMockClient();
    await expectThrows(() => shelfRemoveUnit(client, [], { json: false }), "Usage");
  });

  test("returns confirmation message", async () => {
    const client = createMockClient({
      routes: {
        "DELETE /api/shelf/units/unit-1": {
          response: { ok: true, status: 200, data: { removed: true } },
        },
      },
    });
    const output = await shelfRemoveUnit(client, ["unit-1"], { json: false });
    expect(output).toContain("Removed");
    expect(output).toContain("unit-1");
  });
});

describe("shelf remove-shelf", () => {
  test("requires shelf-id argument", async () => {
    const client = createMockClient();
    await expectThrows(() => shelfRemoveShelf(client, [], { json: false }), "Usage");
  });

  test("finds parent unit and removes shelf", async () => {
    const updatedUnit: ShelfUnit = {
      id: "unit-1",
      name: "Living Room Kallax",
      shelves: [unit1.shelves[0]],
    };
    const client = createMockClient({
      routes: {
        "GET /api/shelf/config": { response: { ok: true, status: 200, data: config } },
        "PUT /api/shelf/units/unit-1": {
          response: { ok: true, status: 200, data: updatedUnit },
        },
      },
    });
    const output = await shelfRemoveShelf(client, ["shelf-2"], { json: false });
    expect(output).toContain("Removed");
    expect(output).toContain("shelf-2");
    expect(output).toContain("Living Room Kallax");
  });

  test("throws when shelf not found in any unit", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/shelf/config": { response: { ok: true, status: 200, data: config } },
      },
    });
    await expectThrows(
      () => shelfRemoveShelf(client, ["nonexistent"], { json: false }),
      "Shelf not found: nonexistent",
    );
  });
});
