import { beforeEach, describe, expect, test } from "bun:test";
import {
  AXIS_VALIDATION_CODES,
  CodedAxisValidationError,
  CollectionSchema,
  createInitialEntityMetadata,
  type AxisValidationCode,
  type Collection,
  type DisabledLegacyAxis,
} from "@shelf-judge/shared";
import { createAxisService, type AxisService } from "../../src/services/axis-service.js";
import { createStorageService, type StorageService } from "../../src/services/storage-service.js";
import type { Logger } from "../../src/services/logger.js";
import { createMockFileOps, type MockFileOps } from "../helpers/mock-file-ops.js";

const timestamp = "2026-08-24T12:00:00.000Z";

function disabledAxis(): DisabledLegacyAxis {
  return {
    id: "legacy-axis",
    name: "Legacy preference",
    description: "Preserve me",
    weight: 63,
    enabled: false,
    source: "legacy",
    reason: "unknown_legacy_field",
    legacyField: "futureMetric",
    legacyPayload: { originalSource: "external", originalField: "futureMetric" },
    preferenceShape: "sweet-spot",
    idealValue: 8,
    tolerance: "moderate",
    leanDirection: "higher",
    veto: { direction: "below", threshold: 3 },
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-02-01T00:00:00.000Z",
  };
}

function game(id: string, rating: number): Collection["games"][number] {
  return {
    id,
    bggId: null,
    entityMetadata: createInitialEntityMetadata(null),
    name: "Game",
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    latestPlayCountCheck: null,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
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
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: { "legacy-axis": rating, "other-axis": 4 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function logSink(): Logger & { entries: string[] } {
  const entries: string[] = [];
  return {
    entries,
    log: (...values) => entries.push(`log ${values.map(String).join(" ")}`),
    warn: (...values) => entries.push(`warn ${values.map(String).join(" ")}`),
    error: (...values) => entries.push(`error ${values.map(String).join(" ")}`),
  };
}

let fileOps: MockFileOps;
let storageService: StorageService;
let axisService: AxisService;

beforeEach(() => {
  let id = 0;
  fileOps = createMockFileOps();
  storageService = createStorageService({
    dataDir: "/data",
    configPath: "/config/config.json",
    fileOps,
  });
  axisService = createAxisService({
    storageService,
    createId: () => `created-axis-${++id}`,
    now: () => timestamp,
  });
});

async function seedDisabledAxis(): Promise<void> {
  const collection = await storageService.loadCollection();
  await storageService.saveCollection({
    ...collection,
    axes: [...collection.axes, disabledAxis()],
    games: [game("game-1", 9), game("game-2", 6)],
  });
}

function expectCode(error: unknown, code: AxisValidationCode): void {
  expect(error).toBeInstanceOf(CodedAxisValidationError);
  if (!(error instanceof CodedAxisValidationError)) return;
  expect(error.code).toBe(code);
}

describe("AxisService current axis operations", () => {
  test("creates a personal axis and all four derived fields", async () => {
    const personal = await axisService.createAxis({
      name: "Fun",
      weight: 40,
      source: "personal",
    });
    expect(personal).toMatchObject({ source: "personal", enabled: true });

    const inputs = [
      { derivedField: "communityRating", configuration: {} },
      { derivedField: "weight", configuration: {} },
      { derivedField: "playerCountFit", configuration: { targetPlayerCount: 4 } },
      { derivedField: "playingTime", configuration: { maximumScoringTime: 240 } },
    ] as const;
    for (const input of inputs) {
      const axis = await axisService.createAxis({
        name: input.derivedField,
        weight: 50,
        source: "derived",
        ...input,
        ...(input.derivedField === "playingTime"
          ? { preferenceShape: "sweet-spot" as const, idealValue: 90, toleranceWidth: 30 }
          : {}),
      });
      expect(axis).toMatchObject({
        source: "derived",
        derivedField: input.derivedField,
        configuration: input.configuration,
      });
    }
  });

  test("allows duplicate derived fields", async () => {
    const input = {
      name: "At four",
      weight: 50,
      source: "derived" as const,
      derivedField: "playerCountFit" as const,
      configuration: { targetPlayerCount: 4 },
    };
    const first = await axisService.createAxis(input);
    const second = await axisService.createAxis(input);
    expect(first).toMatchObject({ derivedField: "playerCountFit" });
    expect(second).toMatchObject({ derivedField: "playerCountFit" });
    expect(first.id).not.toBe(second.id);
  });

  test("updates target and cap configuration through merged validation", async () => {
    const players = await axisService.createAxis({
      name: "Players",
      weight: 50,
      source: "derived",
      derivedField: "playerCountFit",
      configuration: { targetPlayerCount: 4 },
    });
    const updatedPlayers = await axisService.updateAxis(players.id, {
      configuration: { targetPlayerCount: 6 },
    });
    expect(updatedPlayers).toMatchObject({ configuration: { targetPlayerCount: 6 } });

    const time = await axisService.createAxis({
      name: "Time",
      weight: 50,
      source: "derived",
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 240 },
      preferenceShape: "sweet-spot",
      idealValue: 90,
      toleranceWidth: 30,
    });
    const updatedTime = await axisService.updateAxis(time.id, {
      configuration: { maximumScoringTime: 300 },
    });
    expect(updatedTime).toMatchObject({ configuration: { maximumScoringTime: 300 } });
  });

  test("rejects a merged cap that invalidates the curve with stable details", async () => {
    const axis = await axisService.createAxis({
      name: "Time",
      weight: 50,
      source: "derived",
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 240 },
      preferenceShape: "sweet-spot",
      idealValue: 90,
      toleranceWidth: 30,
      veto: { direction: "above", threshold: 180 },
    });
    try {
      await axisService.updateAxis(axis.id, { configuration: { maximumScoringTime: 120 } });
      throw new Error("expected update rejection");
    } catch (error) {
      expectCode(error, AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE);
      if (error instanceof CodedAxisValidationError) {
        expect(error.details.map(({ field }) => field)).toContain("veto");
      }
    }
  });

  test("rejects source and derived-field mutation", async () => {
    const axis = await axisService.createAxis({
      name: "Players",
      weight: 50,
      source: "derived",
      derivedField: "playerCountFit",
      configuration: { targetPlayerCount: 4 },
    });
    for (const input of [{ source: "personal" }, { derivedField: "playingTime" }]) {
      try {
        await axisService.updateAxis(axis.id, input);
        throw new Error("expected update rejection");
      } catch (error) {
        expectCode(error, AXIS_VALIDATION_CODES.INVALID_AXIS_PAYLOAD);
      }
    }
  });

  test("general create rejects tournament and delete protects the managed axis", async () => {
    try {
      await axisService.createAxis({ name: "Tournament", weight: 30, source: "tournament" });
      throw new Error("expected create rejection");
    } catch (error) {
      expectCode(error, AXIS_VALIDATION_CODES.INVALID_AXIS_PAYLOAD);
    }
    const tournament = (await axisService.listAxes()).find((axis) => axis.source === "tournament");
    expect(tournament).toBeDefined();
    if (tournament === undefined) return;
    try {
      await axisService.deleteAxis(tournament.id);
      throw new Error("expected delete rejection");
    } catch (error) {
      expectCode(error, AXIS_VALIDATION_CODES.TOURNAMENT_AXIS_MANAGED);
    }
  });

  test("lists and deletes disabled axes", async () => {
    await seedDisabledAxis();
    expect((await axisService.listAxes()).find((axis) => axis.id === "legacy-axis")).toMatchObject({
      enabled: false,
    });
    expect(await axisService.deleteAxis("legacy-axis")).toEqual({ deletedRatingsCount: 2 });
    expect(
      (await storageService.loadCollection()).games[0]?.ratings["legacy-axis"],
    ).toBeUndefined();
  });

  test("repairs a disabled axis while preserving common values, createdAt, and ratings", async () => {
    await seedDisabledAxis();
    const repaired = await axisService.repairLegacyAxis("legacy-axis", {
      derivedField: "communityRating",
      configuration: {},
    });
    expect(repaired).toMatchObject({
      id: "legacy-axis",
      name: "Legacy preference",
      description: "Preserve me",
      weight: 63,
      enabled: true,
      source: "derived",
      derivedField: "communityRating",
      configuration: {},
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: timestamp,
    });
    expect({
      preferenceShape: repaired.preferenceShape,
      idealValue: repaired.idealValue,
      tolerance: repaired.tolerance,
      toleranceWidth: repaired.toleranceWidth,
      leanDirection: repaired.leanDirection,
      veto: repaired.veto,
    }).toEqual({
      preferenceShape: "sweet-spot",
      idealValue: 8,
      tolerance: "moderate",
      toleranceWidth: undefined,
      leanDirection: "higher",
      veto: { direction: "below", threshold: 3 },
    });
    const persisted = await storageService.loadCollection();
    expect(persisted.axes.find(({ id }) => id === "legacy-axis")?.updatedAt).toBe(timestamp);
    expect(persisted.games.map(({ ratings }) => ratings)).toEqual([
      { "legacy-axis": 9, "other-axis": 4 },
      { "legacy-axis": 6, "other-axis": 4 },
    ]);
  });

  test("repair validation failure leaves storage and ratings byte-identical", async () => {
    await seedDisabledAxis();
    const before = fileOps.files.get("/data/collection.json");
    try {
      await axisService.repairLegacyAxis("legacy-axis", {
        derivedField: "weight",
        configuration: {},
      });
      throw new Error("expected repair rejection");
    } catch (error) {
      expectCode(error, AXIS_VALIDATION_CODES.INVALID_LEGACY_AXIS_REPAIR);
    }
    expect(fileOps.files.get("/data/collection.json")).toBe(before);
  });

  test("repair save failure leaves storage and ratings byte-identical", async () => {
    await seedDisabledAxis();
    const before = fileOps.files.get("/data/collection.json");
    storageService.saveCollection = () => Promise.reject(new Error("disk full"));
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(
      axisService.repairLegacyAxis("legacy-axis", {
        derivedField: "communityRating",
        configuration: {},
      }),
    ).rejects.toThrow("disk full");
    expect(fileOps.files.get("/data/collection.json")).toBe(before);
    const raw: unknown = JSON.parse(before ?? "{}");
    expect(CollectionSchema.parse(raw).games.map(({ ratings }) => ratings)).toEqual([
      { "legacy-axis": 9, "other-axis": 4 },
      { "legacy-axis": 6, "other-axis": 4 },
    ]);
  });

  test("ordinary update cannot mutate a disabled legacy axis", async () => {
    await seedDisabledAxis();
    try {
      await axisService.updateAxis("legacy-axis", { name: "Not repaired" });
      throw new Error("expected update rejection");
    } catch (error) {
      expectCode(error, AXIS_VALIDATION_CODES.INVALID_LEGACY_AXIS_REPAIR);
    }
  });

  test("logs attempts, outcomes, validation codes, configuration keys, and persistence failures", async () => {
    const sink = logSink();
    let loggedId = 0;
    const service = createAxisService({
      storageService,
      logger: sink,
      createId: () => `logged-axis-${++loggedId}`,
      now: () => timestamp,
    });
    const axis = await service.createAxis({
      name: "Players",
      weight: 50,
      source: "derived",
      derivedField: "playerCountFit",
      configuration: { targetPlayerCount: 4 },
    });
    await service.updateAxis(axis.id, { configuration: { targetPlayerCount: 5 } });
    await seedDisabledAxis();
    await service.repairLegacyAxis("legacy-axis", {
      derivedField: "communityRating",
      configuration: {},
      preferenceShape: "higher-is-better",
      idealValue: null,
      veto: null,
    });
    const doomed = await service.createAxis({
      name: "Doomed",
      weight: 50,
      source: "personal",
    });
    await service.deleteAxis(doomed.id);
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(
      service.updateAxis(axis.id, { configuration: { targetPlayerCount: 0 } }),
    ).rejects.toThrow();
    storageService.saveCollection = () => Promise.reject(new Error("save failed"));
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(service.deleteAxis(axis.id)).rejects.toThrow("save failed");

    const hasEntry = (...parts: string[]): boolean =>
      sink.entries.some((entry) => parts.every((part) => entry.includes(part)));

    expect(
      hasEntry(
        "axis create attempt",
        "source=derived",
        "derivedField=playerCountFit",
        "configurationKeys=targetPlayerCount",
      ),
    ).toBe(true);
    expect(
      hasEntry(
        "axis create completed",
        `axisId=${axis.id}`,
        "source=derived",
        "derivedField=playerCountFit",
      ),
    ).toBe(true);
    expect(hasEntry("axis update attempt", `axisId=${axis.id}`, "targetPlayerCount")).toBe(true);
    expect(
      hasEntry(
        "axis update completed",
        `axisId=${axis.id}`,
        "source=derived",
        "derivedField=playerCountFit",
      ),
    ).toBe(true);
    expect(
      hasEntry(
        "axis repair attempt",
        "axisId=legacy-axis",
        "source=legacy",
        "derivedField=communityRating",
      ),
    ).toBe(true);
    expect(
      hasEntry(
        "axis repair completed",
        "axisId=legacy-axis",
        "source=derived",
        "derivedField=communityRating",
      ),
    ).toBe(true);
    expect(hasEntry("axis delete attempt", `axisId=${doomed.id}`)).toBe(true);
    expect(
      hasEntry(
        "axis delete completed",
        `axisId=${doomed.id}`,
        "source=personal",
        "derivedField=none",
      ),
    ).toBe(true);
    expect(
      hasEntry(
        "axis update rejected",
        `axisId=${axis.id}`,
        "source=derived",
        "derivedField=playerCountFit",
        "code=invalid_target_player_count",
        '"field":"targetPlayerCount"',
      ),
    ).toBe(true);
    expect(
      hasEntry(
        "axis delete persistence failed",
        `axisId=${axis.id}`,
        "source=derived",
        "derivedField=playerCountFit",
        "save failed",
      ),
    ).toBe(true);
  });

  test("logs update, repair, and delete not-found outcomes", async () => {
    const sink = logSink();
    const service = createAxisService({ storageService, logger: sink });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(service.updateAxis("missing-update", { name: "Missing" })).rejects.toThrow(
      "Axis not found",
    );
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(
      service.repairLegacyAxis("missing-repair", {
        derivedField: "communityRating",
        configuration: {},
      }),
    ).rejects.toThrow("Axis not found");
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(service.deleteAxis("missing-delete")).rejects.toThrow("Axis not found");

    const hasEntry = (...parts: string[]): boolean =>
      sink.entries.some((entry) => parts.every((part) => entry.includes(part)));
    expect(hasEntry("axis update failed", "axisId=missing-update", "reason=not_found")).toBe(true);
    expect(hasEntry("axis repair failed", "axisId=missing-repair", "reason=not_found")).toBe(true);
    expect(hasEntry("axis delete failed", "axisId=missing-delete", "reason=not_found")).toBe(true);
  });
});
