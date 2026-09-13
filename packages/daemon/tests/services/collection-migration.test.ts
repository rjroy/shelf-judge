import { describe, expect, test } from "bun:test";
import {
  AxisSchema,
  CURRENT_COLLECTION_SCHEMA_VERSION,
  CollectionSchema,
  CollectionSchemaV5,
} from "@shelf-judge/shared";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  if (!isRecord(migrated)) throw new Error("Invalid v1 migration fixture");
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

function versionTwoGame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...historicalGame({
      bestPlayers: 3,
      ownership: "owned",
      boxDimensions: null,
      manualShelfId: null,
      bggData: {
        ...versionOneBggData(3),
        suggestedPlayerCounts: [{ playerCount: "3", best: 8, recommended: 2, notRecommended: 1 }],
      },
      numPlays: 4,
    }),
    ...overrides,
  };
}

function versionTwoCollection(games: Record<string, unknown>[]): Record<string, unknown> {
  const step = COLLECTION_MIGRATION_STEPS.find(({ fromVersion }) => fromVersion === 1);
  if (step === undefined) throw new Error("Missing v1 collection migration");
  const migrated = step.migrate(versionOneCollection(games), dependencies).data;
  if (!isRecord(migrated)) throw new Error("Invalid v2 migration fixture");
  return migrated;
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
    if (!isRecord(axes)) {
      throw new Error("Invalid v1 axes fixture");
    }
    const expectedAxes = AxisSchema.array().parse(axes.axes);
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
    expect(result.data.schemaVersion).toBe(6);
    expect(result.data.axes).toEqual(expectedAxes);
    expect(result.data.games.map(({ bestPlayers }) => bestPlayers)).toEqual([3, 4, null]);
    expect(result.data.games[0]?.bestPlayersInvalidEvidence).toBeNull();
    expect(result.data.games.map((game) => game.bggData?.bestPlayerCount)).toEqual([3, 3, null]);
    expect(JSON.stringify(result.data.games[0]?.ratings)).toBe(JSON.stringify(base.ratings));
  });

  test("keeps the frozen v1 BGG fallback for explicit null and malformed bestPlayers", () => {
    const base = historicalGame({
      ownership: "owned",
      boxDimensions: null,
      manualShelfId: null,
      bggData: versionOneBggData(3),
    });
    const v1ToV2 = COLLECTION_MIGRATION_STEPS.find(({ fromVersion }) => fromVersion === 1);
    if (v1ToV2 === undefined) throw new Error("Missing v1 collection migration");

    for (const fixture of [
      { id: "explicit-null", bestPlayers: null },
      { id: "malformed", bestPlayers: "not-a-count" },
    ]) {
      const v1 = versionOneCollection([{ ...base, ...fixture }]);
      const v2 = v1ToV2.migrate(v1, dependencies).data;
      if (!isRecord(v2) || !Array.isArray(v2.games)) {
        throw new Error("Invalid v2 migration result");
      }
      expect(v2.games.map((game) => (isRecord(game) ? game.bestPlayers : undefined))).toEqual([3]);

      const migrated = migrateCollection(v1, dependencies).data.games[0];
      expect(migrated?.bestPlayers).toBe(3);
      expect(migrated?.bestPlayersInvalidEvidence).toBeNull();
    }
  });

  test("preserves malformed bestPlayers supplied to v2 without using it as poll input", () => {
    const malformed = "not-a-count";
    const v2 = {
      ...versionOneCollection([]),
      schemaVersion: 2,
      games: [
        versionTwoGame({
          bestPlayers: malformed,
          bggData: {
            ...versionOneBggData(3),
            suggestedPlayerCounts: [
              { playerCount: "3", best: 8, recommended: 2, notRecommended: 1 },
            ],
          },
        }),
      ],
    };

    const game = migrateCollection(v2, dependencies).data.games[0];

    expect(game?.bestPlayers).toBeNull();
    expect(game?.bestPlayersInvalidEvidence).toEqual({ presence: "present", value: malformed });
    expect(game?.bggData?.bestPlayerCount).toBe(3);
    expect(game?.suggestedPlayerPoll).toMatchObject({
      status: "valid",
      state: "usable",
      buckets: [{ playerCount: "3", best: 8, recommended: 2, notRecommended: 1 }],
    });
  });

  test("moves legacy poll buckets exactly once with deterministic states", () => {
    const empty = versionTwoGame({
      id: "empty",
      bggData: { ...versionOneBggData(null), suggestedPlayerCounts: [] },
    });
    const usable = versionTwoGame({ id: "usable" });
    const unusable = versionTwoGame({
      id: "unusable",
      bggData: {
        ...versionOneBggData(null),
        suggestedPlayerCounts: [{ playerCount: "4+", best: 10, recommended: 0, notRecommended: 0 }],
      },
    });

    const result = migrateCollection(versionTwoCollection([empty, usable, unusable]), dependencies);

    expect(result.data.games.map((game) => game.suggestedPlayerPoll.state)).toEqual([
      "legacy-unknown",
      "usable",
      "unusable",
    ]);
    for (const game of result.data.games) {
      expect(game.suggestedPlayerPoll.source).toBe("legacy-unknown");
      expect(game.suggestedPlayerPoll.observedAt).toBeNull();
      expect(game.bggData).not.toHaveProperty("suggestedPlayerCounts");
    }
    expect(result.data.games[1]?.suggestedPlayerPoll).toMatchObject({
      buckets: [{ playerCount: "3", best: 8, recommended: 2, notRecommended: 1 }],
    });
  });

  test("normalizes malformed legacy compatibility fields and preserves exact JSON evidence", () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    const malformedPoll = [{ playerCount: 3, best: -1 }];
    const raw = versionTwoGame({
      numPlays: -1,
      playingTime: 0,
      minPlayers: unsafe,
      maxPlayers: 2,
      bestPlayers: unsafe,
      bggData: { ...versionOneBggData(unsafe), suggestedPlayerCounts: malformedPoll },
    });

    const game = migrateCollection({ ...versionTwoCollection([]), games: [raw] }, dependencies).data
      .games[0];

    expect(game).toMatchObject({
      minPlayers: null,
      maxPlayers: null,
      bestPlayers: null,
      playingTime: null,
      numPlays: null,
      playCountEvidence: {
        status: "invalid",
        evidence: { presence: "present", value: -1 },
      },
      durationEvidence: {
        status: "invalid",
        evidence: { presence: "present", value: 0 },
      },
      playerRangeEvidence: {
        status: "invalid",
        evidence: {
          minPlayers: { presence: "present", value: unsafe },
          maxPlayers: { presence: "present", value: 2 },
        },
      },
      suggestedPlayerPoll: {
        status: "invalid",
        buckets: [],
        evidence: { presence: "present", value: malformedPoll },
      },
      bestPlayersInvalidEvidence: { presence: "present", value: unsafe },
    });
  });

  test("normalizes every numeric legacy boundary deterministically", () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    const cases = [
      { id: "zero-range", minPlayers: 0, maxPlayers: 4 },
      { id: "negative-range", minPlayers: -1, maxPlayers: 4 },
      { id: "unsafe-range", minPlayers: 1, maxPlayers: unsafe },
      { id: "reversed-range", minPlayers: 5, maxPlayers: 2 },
      { id: "negative-duration", playingTime: -10 },
      { id: "unsafe-duration", playingTime: unsafe },
      { id: "fractional-duration", playingTime: 1.5 },
      { id: "unsafe-plays", numPlays: unsafe },
      { id: "fractional-plays", numPlays: 1.5 },
    ].map(({ id, ...fields }) => versionTwoGame({ id, ...fields }));

    const games = migrateCollection(versionTwoCollection(cases), dependencies).data.games;

    for (const game of games.slice(0, 4)) {
      expect(game.minPlayers).toBeNull();
      expect(game.maxPlayers).toBeNull();
      expect(game.playerRangeEvidence.status).toBe("invalid");
    }
    for (const game of games.slice(4, 7)) {
      expect(game.playingTime).toBeNull();
      expect(game.durationEvidence.status).toBe("invalid");
    }
    for (const game of games.slice(7)) {
      expect(game.numPlays).toBeNull();
      expect(game.playCountEvidence.status).toBe("invalid");
    }
  });

  test("rejects unsafe vote buckets without losing their original JSON", () => {
    const buckets = [
      {
        playerCount: "3",
        best: Number.MAX_SAFE_INTEGER + 1,
        recommended: 0,
        notRecommended: 0,
      },
    ];
    const raw = versionTwoGame({
      bggData: { ...versionOneBggData(null), suggestedPlayerCounts: buckets },
    });

    const poll = migrateCollection(versionTwoCollection([raw]), dependencies).data.games[0]
      ?.suggestedPlayerPoll;

    expect(poll).toEqual({
      status: "invalid",
      state: "unusable",
      buckets: [],
      evidence: { presence: "present", value: buckets },
      source: "legacy-unknown",
      observedAt: null,
    });
  });

  test("keeps unsafe player labels as factual unusable buckets with null compatibility", () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    const buckets = [{ playerCount: String(unsafe), best: 8, recommended: 2, notRecommended: 1 }];
    const raw = versionTwoGame({
      bestPlayers: unsafe,
      bggData: { ...versionOneBggData(unsafe), suggestedPlayerCounts: buckets },
    });

    const game = migrateCollection(versionTwoCollection([raw]), dependencies).data.games[0];

    expect(game?.bestPlayers).toBeNull();
    expect(game?.bggData?.bestPlayerCount).toBeNull();
    expect(game?.suggestedPlayerPoll).toMatchObject({
      status: "valid",
      state: "unusable",
      buckets,
    });
    expect(
      CollectionSchema.safeParse(migrateCollection(versionTwoCollection([raw]), dependencies).data)
        .success,
    ).toBe(true);
  });

  test("nulls non-positive, fractional, and unsafe legacy best-player projections", () => {
    for (const bestPlayerCount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const raw = versionTwoGame({
        bestPlayers: bestPlayerCount,
        bggData: versionOneBggData(bestPlayerCount),
      });

      const game = migrateCollection(versionTwoCollection([raw]), dependencies).data.games[0];

      expect(game?.bestPlayers).toBeNull();
      expect(game?.bggData?.bestPlayerCount).toBeNull();
    }
  });

  test("distinguishes missing legacy properties from explicit null", () => {
    const raw = versionTwoGame();
    delete raw.numPlays;
    delete raw.playingTime;
    delete raw.minPlayers;
    delete raw.bestPlayers;

    const game = migrateCollection(versionTwoCollection([raw]), dependencies).data.games[0];

    expect(game.playCountEvidence).toMatchObject({
      status: "invalid",
      evidence: { presence: "missing" },
    });
    expect(game.durationEvidence).toMatchObject({
      status: "invalid",
      evidence: { presence: "missing" },
    });
    expect(game.playerRangeEvidence).toMatchObject({
      status: "invalid",
      evidence: { minPlayers: { presence: "missing" } },
    });
    expect(game.bestPlayersInvalidEvidence).toBeNull();
  });

  test("produces equivalent v4 data from direct and chained historical versions", () => {
    const v0 = historicalCollection();
    const v1Step = COLLECTION_MIGRATION_STEPS[0]?.migrate(v0, dependencies).data;
    const v2Step = COLLECTION_MIGRATION_STEPS[1]?.migrate(v1Step, dependencies).data;
    if (v1Step === undefined || v2Step === undefined) throw new Error("Missing migration fixture");

    const fromZero = migrateCollection(v0, dependencies).data;
    expect(migrateCollection(v1Step, dependencies).data).toEqual(fromZero);
    expect(migrateCollection(v2Step, dependencies).data).toEqual(fromZero);
  });

  test("repeats default v0 migration byte-for-byte without injected IDs or time", () => {
    const raw = historicalCollection();

    expect(JSON.stringify(migrateCollection(raw).data)).toBe(
      JSON.stringify(migrateCollection(raw).data),
    );
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

  test("chains v0 through v6, inserts Tournament once, and is byte-stable at v6", () => {
    expect(
      COLLECTION_MIGRATION_STEPS.map(({ fromVersion, toVersion }) => ({ fromVersion, toVersion })),
    ).toEqual([
      { fromVersion: 0, toVersion: 1 },
      { fromVersion: 1, toVersion: 2 },
      { fromVersion: 2, toVersion: 3 },
      { fromVersion: 3, toVersion: 4 },
      { fromVersion: 4, toVersion: 5 },
      { fromVersion: 5, toVersion: 6 },
    ]);
    const first = migrateCollection(historicalCollection(), dependencies);
    expect(first.data.axes.filter((axis) => axis.source === "tournament")).toHaveLength(1);

    const second = migrateCollection(first.data, dependencies);
    expect(second.migrated).toBe(false);
    expect(JSON.stringify(second.data)).toBe(JSON.stringify(first.data));
  });

  test("migrates v5 directly by adding only honest missing notes", () => {
    const current = migrateCollection(historicalCollection(), dependencies).data;
    const v5 = {
      ...current,
      schemaVersion: 5 as const,
      games: current.games.map(({ ownerNote, ...game }, index) => {
        void ownerNote;
        return index === 0
          ? {
              ...game,
              bggData: {
                communityRating: 7.5,
                bayesAverage: 7,
                weight: 2.5,
                numWeightVotes: 10,
                description: "BGG prose must remain source evidence, never an owner note.",
                mechanics: [],
                categories: [],
                families: [],
                subdomains: [],
                bestPlayerCount: 3,
                fetchedAt: NOW,
              },
            }
          : game;
      }),
    };

    const result = migrateCollection(v5, dependencies);

    expect(result).toMatchObject({ migrated: true, sourceVersion: 5 });
    expect(result.data.games.map(({ ownerNote }) => ownerNote)).toEqual(
      v5.games.map(() => ({ state: "missing", version: 0, updatedAt: null })),
    );
    expect(
      result.data.games.map(({ ownerNote, ...game }) => {
        void ownerNote;
        return game;
      }),
    ).toEqual(v5.games);
    expect(result.data.intentions).toEqual(v5.intentions);
    expect(result.data.commandReceipts).toEqual(v5.commandReceipts);
  });

  test("preserves every validated field in the prose-rich v5 owner-note fixture", async () => {
    const fixture: unknown = await Bun.file(
      new URL("../fixtures/collection-schema-v5-owner-notes.json", import.meta.url),
    ).json();
    const validatedV5 = CollectionSchemaV5.parse(fixture);

    const result = migrateCollection(fixture, dependencies);

    expect(result).toMatchObject({ migrated: true, sourceVersion: 5 });
    expect(
      result.data.games.map(({ ownerNote, ...game }) => {
        expect(ownerNote).toEqual({ state: "missing", version: 0, updatedAt: null });
        return game;
      }),
    ).toEqual(validatedV5.games);
    expect(result.data.intentions).toEqual(validatedV5.intentions);
    expect(result.data.commandReceipts).toEqual(validatedV5.commandReceipts);
    expect(JSON.stringify(result.data.games.map(({ ownerNote }) => ownerNote))).not.toContain(
      "BGG description",
    );
  });

  test("v4 to v5 adds empty manual values and drops only irrecoverable affected score overrides", () => {
    const current = migrateCollection(historicalCollection(), dependencies).data;
    const playingTimeAxis = {
      id: "play-time-axis",
      name: "Play Time",
      description: null,
      weight: 50,
      enabled: true,
      source: "derived",
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 240 },
      createdAt: NOW,
      updatedAt: NOW,
    } as const;
    const playerCountAxis = {
      ...playingTimeAxis,
      id: "player-count-axis",
      name: "Player Count Fit",
      derivedField: "playerCountFit",
      configuration: { targetPlayerCount: 4 },
    } as const;
    const games = current.games.map(({ manualValues, ownerNote, ...game }) => {
      void manualValues;
      void ownerNote;
      return {
        ...game,
        ratings: {
          ...game.ratings,
          [playingTimeAxis.id]: 8,
          [playerCountAxis.id]: 7,
        },
      };
    });
    const result = migrateCollection({
      ...current,
      schemaVersion: 4,
      axes: [...current.axes, playingTimeAxis, playerCountAxis],
      games,
    });

    expect(result).toMatchObject({ migrated: true, sourceVersion: 4 });
    expect(result.data.games[0]?.manualValues).toEqual({ playingTime: null, playerCount: null });
    expect(result.data.games[0]?.ratings).toEqual({
      "axis-community": 9,
      "axis-unknown": 3,
    });
  });

  test("validates current collections on every pass and rejects malformed or future current data", () => {
    const current = migrateCollection(historicalCollection(), dependencies).data;
    expect(CollectionSchema.parse(migrateCollection(current, dependencies).data)).toEqual(current);
    expect(() => migrateCollection({ ...current, unexpected: true }, dependencies)).toThrow();
    expect(() => migrateCollection({ ...current, schemaVersion: 7 }, dependencies)).toThrow(
      "Unsupported collection schema version 7; current version is 6",
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

  test("migrates v3 source records without fabricating readiness, checks, or intentions", async () => {
    const fixture: unknown = await Bun.file(
      new URL("../fixtures/useful-profile-schema-v3.json", import.meta.url),
    ).json();

    const result = migrateCollection(fixture, dependencies);

    expect(result).toMatchObject({ migrated: true, sourceVersion: 3 });
    expect(result.data).toMatchObject({
      schemaVersion: 6,
      revision: 0,
      intentions: [],
      commandReceipts: [],
    });
    expect(result.data.games[0]?.entityMetadata.mechanic).toEqual({
      state: "refresh-needed",
      entities: [],
      observedAt: null,
      refreshFailure: null,
      correctionDestination: { operationId: "shelf.game.bgg.refresh" },
    });
    expect(result.data.games[0]?.entityMetadata.designer.state).toBe("refresh-needed");
    expect(result.data.games[0]?.entityMetadata.artist.state).toBe("refresh-needed");
    expect(result.data.games[0]?.bggData?.mechanics).toEqual([{ id: 7, name: "Legacy Mechanic" }]);
    expect(result.data.games[0]?.latestPlayCountCheck).toBeNull();
    expect(result.data.games[1]?.entityMetadata.mechanic.state).toBe("unrefreshable");
    expect(migrateCollection(result.data, dependencies).data).toEqual(result.data);
  });
});
