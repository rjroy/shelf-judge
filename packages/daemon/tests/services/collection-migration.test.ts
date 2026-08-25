import { describe, expect, test } from "bun:test";
import { CURRENT_COLLECTION_SCHEMA_VERSION, CollectionSchema } from "@shelf-judge/shared";
import {
  COLLECTION_MIGRATION_STEPS,
  migrateCollection,
} from "../../src/services/collection-migration.js";

const NOW = "2026-01-01T00:00:00.000Z";
const MIGRATED_AT = "2026-08-24T12:00:00.000Z";
const dependencies = {
  createId: () => "tournament-axis",
  now: () => MIGRATED_AT,
};

function legacyAxis(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "axis-community",
    name: "Community Rating",
    description: "Community score",
    weight: 67,
    source: "bgg",
    bggField: "communityRating",
    preferenceShape: "sweet-spot",
    idealValue: 8,
    tolerance: "strict",
    leanDirection: "higher",
    veto: { direction: "below", threshold: 4 },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function historicalGame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "game-1",
    bggId: 123,
    name: "Historical Game",
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    playingTime: 60,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    ratings: { "axis-community": 9, "axis-unknown": 3 },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function historicalCollection(
  axes: Record<string, unknown>[] = [legacyAxis()],
  games: Record<string, unknown>[] = [historicalGame()],
): Record<string, unknown> {
  return {
    id: "collection-1",
    name: "Historical",
    axes,
    games,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function versionOneCollection(games: Record<string, unknown>[]): Record<string, unknown> {
  const step = COLLECTION_MIGRATION_STEPS.find(({ fromVersion }) => fromVersion === 0);
  if (step === undefined) throw new Error("Missing v0 collection migration");
  const migrated = step.migrate(historicalCollection(), dependencies).data;
  if (typeof migrated !== "object" || migrated === null) {
    throw new Error("Invalid v1 migration fixture");
  }
  return { ...migrated, games };
}

function versionOneBggData(bestPlayerCount?: number | null): Record<string, unknown> {
  return {
    communityRating: 7.5,
    bayesAverage: 7,
    weight: 2.5,
    numWeightVotes: 10,
    description: null,
    mechanics: [],
    categories: [],
    families: [],
    subdomains: [],
    suggestedPlayerCounts: [],
    ...(bestPlayerCount === undefined ? {} : { bestPlayerCount }),
    fetchedAt: NOW,
  };
}

describe("migrateCollection", () => {
  test("preserves every score-relevant known-axis field, ID, and rating association", () => {
    const weight = legacyAxis({
      id: "axis-weight",
      name: "Complexity",
      bggField: "weight",
      preferenceShape: "lower-is-better",
      idealValue: null,
      tolerance: "flexible",
      leanDirection: null,
      veto: { direction: "above", threshold: 4.5 },
    });
    const raw = historicalCollection([legacyAxis(), weight]);

    const result = migrateCollection(raw, dependencies);

    expect(result).toMatchObject({
      migrated: true,
      sourceVersion: 0,
      convertedAxisCount: 2,
      disabledAxisCount: 0,
    });
    expect(result.data.schemaVersion).toBe(CURRENT_COLLECTION_SCHEMA_VERSION);
    expect(result.data.axes[0]).toEqual({
      id: "axis-community",
      name: "Community Rating",
      description: "Community score",
      weight: 67,
      enabled: true,
      source: "derived",
      derivedField: "communityRating",
      configuration: {},
      preferenceShape: "sweet-spot",
      idealValue: 8,
      tolerance: "strict",
      leanDirection: "higher",
      veto: { direction: "below", threshold: 4 },
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(result.data.axes[1]).toMatchObject({
      id: "axis-weight",
      source: "derived",
      derivedField: "weight",
      configuration: {},
      weight: 67,
      preferenceShape: "lower-is-better",
      veto: { direction: "above", threshold: 4.5 },
    });
    expect(result.data.games[0].ratings).toEqual({
      "axis-community": 9,
      "axis-unknown": 3,
    });
  });

  test("preserves structurally valid historical curves outside current native scales", () => {
    const community = legacyAxis({
      idealValue: 12,
      veto: { direction: "below", threshold: -2 },
    });
    const complexity = legacyAxis({
      id: "axis-weight",
      bggField: "weight",
      idealValue: 8,
      veto: { direction: "above", threshold: 9 },
    });

    const result = migrateCollection(historicalCollection([community, complexity]), dependencies);

    expect(result.data.axes[0]).toMatchObject({
      id: "axis-community",
      source: "derived",
      idealValue: 12,
      veto: { direction: "below", threshold: -2 },
    });
    expect(result.data.axes[1]).toMatchObject({
      id: "axis-weight",
      source: "derived",
      idealValue: 8,
      veto: { direction: "above", threshold: 9 },
    });
    expect(CollectionSchema.safeParse(result.data).success).toBe(true);
  });

  test("preserves complete unknown and malformed source snapshots as disabled axes", () => {
    const unknown = legacyAxis({
      id: "axis-unknown",
      bggField: "futureMetric",
      configuration: { nested: [1, { preserve: true }] },
      unrecognized: "complete snapshot",
    });
    const malformed = legacyAxis({
      id: "axis-malformed",
      source: "personal",
      bggField: "weight",
      custom: { original: true },
    });

    const result = migrateCollection(historicalCollection([unknown, malformed]), dependencies);

    expect(result.disabledAxisCount).toBe(2);
    expect(result.data.axes[0]).toMatchObject({
      id: "axis-unknown",
      enabled: false,
      source: "legacy",
      reason: "unknown_legacy_field",
      legacyField: "futureMetric",
      legacyPayload: unknown,
      preferenceShape: "sweet-spot",
      veto: { direction: "below", threshold: 4 },
    });
    expect(result.data.axes[1]).toMatchObject({
      id: "axis-malformed",
      enabled: false,
      source: "legacy",
      reason: "malformed_legacy_source_field",
      legacyField: "weight",
      legacyPayload: malformed,
    });
    expect(result.data.games[0].ratings["axis-unknown"]).toBe(3);
  });

  test("backfills every supported historical game field", () => {
    const result = migrateCollection(historicalCollection(), dependencies);
    expect(result.data.games[0]).toMatchObject({
      ownership: "owned",
      boxDimensions: null,
      manualShelfId: null,
    });

    const explicit = migrateCollection(
      historicalCollection(
        [legacyAxis()],
        [
          historicalGame({
            ownership: "previously-owned",
            boxDimensions: { width: 10, height: 12, depth: 3 },
            manualShelfId: "shelf-1",
          }),
        ],
      ),
      dependencies,
    );
    expect(explicit.data.games[0]).toMatchObject({
      ownership: "previously-owned",
      boxDimensions: { width: 10, height: 12, depth: 3 },
      manualShelfId: "shelf-1",
    });
  });

  test("migrates v1 best-player fields without changing axes or other game data", () => {
    const axes = COLLECTION_MIGRATION_STEPS[0].migrate(historicalCollection(), dependencies).data;
    if (typeof axes !== "object" || axes === null || !("axes" in axes)) {
      throw new Error("Invalid v1 axes fixture");
    }
    const base = {
      ...historicalGame({
        ownership: "owned",
        boxDimensions: null,
        manualShelfId: null,
      }),
    };
    const raw = versionOneCollection([
      { ...base, bggData: versionOneBggData(3) },
      { ...base, id: "game-2", bestPlayers: 4, bggData: versionOneBggData(3) },
      { ...base, id: "game-3", bggData: versionOneBggData() },
    ]);

    const result = migrateCollection(raw, dependencies);

    expect(result).toMatchObject({ migrated: true, sourceVersion: 1 });
    expect(result.data.schemaVersion).toBe(2);
    expect(result.data.axes).toEqual((axes as { axes: typeof result.data.axes }).axes);
    expect(result.data.games.map(({ bestPlayers }) => bestPlayers)).toEqual([3, 4, null]);
    expect(result.data.games.map((game) => game.bggData?.bestPlayerCount)).toEqual([3, 3, null]);
    expect(JSON.stringify(result.data.games[0]?.ratings)).toBe(JSON.stringify(base.ratings));
  });

  test("migrates the pinned historical game-shape fixture", async () => {
    const fixture: unknown = await Bun.file(
      new URL("../fixtures/collection-schema-v0-games.json", import.meta.url),
    ).json();

    const result = migrateCollection(fixture, dependencies);

    expect(
      result.data.games.map(({ ownership, boxDimensions, manualShelfId }) => ({
        ownership,
        boxDimensions,
        manualShelfId,
      })),
    ).toEqual([
      { ownership: "owned", boxDimensions: null, manualShelfId: null },
      { ownership: "previously-owned", boxDimensions: null, manualShelfId: null },
      {
        ownership: "owned",
        boxDimensions: { width: 10, height: 8, depth: 3 },
        manualShelfId: null,
      },
    ]);
  });

  test("chains v0 through v2, inserts Tournament once, and is byte-stable at v2", () => {
    expect(
      COLLECTION_MIGRATION_STEPS.map(({ fromVersion, toVersion }) => ({ fromVersion, toVersion })),
    ).toEqual([
      { fromVersion: 0, toVersion: 1 },
      { fromVersion: 1, toVersion: 2 },
    ]);
    const first = migrateCollection(historicalCollection(), dependencies);
    expect(first.data.axes.filter((axis) => axis.source === "tournament")).toHaveLength(1);

    const second = migrateCollection(first.data, dependencies);
    expect(second.migrated).toBe(false);
    expect(JSON.stringify(second.data)).toBe(JSON.stringify(first.data));
  });

  test("validates current collections on every pass and rejects malformed or future current data", () => {
    const current = migrateCollection(historicalCollection(), dependencies).data;
    expect(CollectionSchema.parse(migrateCollection(current, dependencies).data)).toEqual(current);
    expect(() => migrateCollection({ ...current, unexpected: true }, dependencies)).toThrow();
    expect(() => migrateCollection({ ...current, schemaVersion: 3 }, dependencies)).toThrow(
      "Unsupported collection schema version 3; current version is 2",
    );
    expect(() =>
      migrateCollection(
        {
          ...current,
          axes: [{ ...current.axes[0], weight: 101 }],
        },
        dependencies,
      ),
    ).toThrow();
  });
});
