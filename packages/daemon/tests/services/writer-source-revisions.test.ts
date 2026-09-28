import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createNicheRoutes } from "../../src/routes/niche.js";
import { createShelfService } from "../../src/services/shelf-service.js";
import { createStorageService } from "../../src/services/storage-service.js";
import { createTournamentService } from "../../src/services/tournament-service.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";

const dataDir = "/writer-revisions";

function setup() {
  const fileOps = createMockFileOps();
  const storage = createStorageService({
    dataDir,
    configPath: `${dataDir}/config.json`,
    fileOps,
  });
  return { fileOps, storage };
}

function revision(fileOps: ReturnType<typeof createMockFileOps>, filename: string): number {
  const raw = fileOps.files.get(`${dataDir}/${filename}`);
  if (raw === undefined) throw new Error(`Missing persisted ${filename}`);
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || !("revision" in value)) {
    throw new Error(`Missing revision in ${filename}`);
  }
  const current = value.revision;
  if (typeof current !== "number") throw new Error(`Invalid revision in ${filename}`);
  return current;
}

describe("higher-level source writer revisions", () => {
  test("tournament settings mutation advances once and repeated no-op does not advance", async () => {
    const { fileOps, storage } = setup();
    await storage.hydrateSourceVector?.();
    const tournament = createTournamentService({ storageService: storage });

    await tournament.updateSettings({ kFactorThreshold: 16 });
    expect(revision(fileOps, "tournament.json")).toBe(1);
    await tournament.updateSettings({ kFactorThreshold: 16 });
    expect(revision(fileOps, "tournament.json")).toBe(1);
  });

  test("niche route mutation advances persisted revision and a duplicate is a no-op", async () => {
    const { fileOps, storage } = setup();
    await storage.hydrateSourceVector?.();
    const { routes } = createNicheRoutes({ storageService: storage });
    const app = new Hono();
    app.route("/api", routes);
    const body = JSON.stringify({ type: "mechanic", name: "Drafting" });

    expect(
      (await app.request("/api/niches/settings/ignore", { method: "POST", body })).status,
    ).toBe(200);
    expect(revision(fileOps, "niche-settings.json")).toBe(1);
    expect(
      (await app.request("/api/niches/settings/ignore", { method: "POST", body })).status,
    ).toBe(200);
    expect(revision(fileOps, "niche-settings.json")).toBe(1);
  });

  test("shelf writer advances the durable revision but identical unit update does not", async () => {
    const { fileOps, storage } = setup();
    await storage.hydrateSourceVector?.();
    const shelves = createShelfService({ storageService: storage });
    const unit = await shelves.addUnit({ name: "Shelf Unit", shelves: [] });
    expect(revision(fileOps, "shelf-config.json")).toBe(1);
    const collectionRevision = (await storage.loadCollection()).revision;

    await shelves.updateUnit(unit.id, { name: unit.name });
    expect(revision(fileOps, "shelf-config.json")).toBe(1);
    expect((await storage.loadCollection()).revision).toBe(collectionRevision);
  });
});
